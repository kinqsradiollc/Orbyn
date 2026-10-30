import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool, readTransaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { readAssistantReviewOrigins } =
  await import("../src/modules/assistant-workspace/review-origins.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { readAssistantProfiles } =
  await import("../src/modules/assistant-workspace/profiles.js");
const app = await buildApiService(),
  h = helpers(app),
  network = await trapNetwork(),
  owners: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
  assert.deepEqual(network.calls, []);
});
async function person() {
  const p = await h.register("review-origins");
  owners.push(p.id);
  return p;
}
async function project(owner: string, name = "Current project") {
  return (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,$2) RETURNING id",
      [owner, name],
    )
  ).rows[0].id as string;
}
async function goal(
  owner: string,
  title: string,
  projectId: string | null = null,
) {
  return (
    await pool.query(
      "INSERT INTO goals(user_id,title,target,project_id) VALUES($1,$2,'A reviewed target',$3) RETURNING id",
      [owner, title, projectId],
    )
  ).rows[0].id as string;
}
async function routine(owner: string, instruction = "Current routine") {
  return (
    await pool.query(
      "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,$2,'FREQ=DAILY',now()+interval '1 day') RETURNING id",
      [owner, instruction],
    )
  ).rows[0].id as string;
}
async function task(
  owner: string,
  title = "Current task",
  projectId: string | null = null,
) {
  return (
    await pool.query(
      "INSERT INTO items(user_id,title,kind,project_id) VALUES($1,$2,'task',$3) RETURNING id",
      [owner, title, projectId],
    )
  ).rows[0].id as string;
}
type Source = { kind: "goal" | "routine" | "task"; id: string };
async function job(
  owner: string,
  options: {
    source?: Source;
    lane?: "background" | "overnight";
    project?: string;
    done?: boolean;
    dependencies?: boolean;
    title?: string;
  } = {},
) {
  const id = randomUUID(),
    chat = randomUUID(),
    lane = options.lane ?? "background",
    title = options.title ?? "Generated run title must not replace origin";
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,project_id) VALUES($1,$2,$3,$4,$5)",
    [
      chat,
      owner,
      title,
      lane === "overnight" ? "night" : "task",
      options.project ?? null,
    ],
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,sources_checked,run_state) VALUES($1,$2,$3,'queued',true,$4)",
    [
      id,
      owner,
      chat,
      {
        version: 1,
        request: {
          automation: {
            kind:
              lane === "overnight" ? "night" : (options.source?.kind ?? "task"),
            ...(options.source
              ? { source_kind: options.source.kind, id: options.source.id }
              : {}),
          },
        },
      },
    ],
  );
  if (options.source && options.dependencies !== false)
    await pool.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,$2,$3)",
      [id, options.source.kind, options.source.id],
    );
  if (options.done)
    await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
      id,
      { answer: "A useful retained result." },
    ]);
  return { id, chat };
}
const origins = (owner: string, ids: string[]) =>
  readTransaction((db) => readAssistantReviewOrigins(db, owner, ids), {
    primary: true,
    isolation: "repeatable read",
  });
const profiles = (owner: string, outcomes = true, includeOrigins = true) =>
  readTransaction(
    (db) =>
      readAssistantProfiles(db, owner, undefined, outcomes, includeOrigins),
    { primary: true, isolation: "repeatable read" },
  );

test("authoritative goal and routine identities survive different jobs/lanes, renamed sources and duplicate titles", async () => {
  const p = await person(),
    g = await goal(p.id, "Same name"),
    g2 = await goal(p.id, "Same name"),
    r = await routine(p.id, "  A current routine  ");
  const first = await job(p.id, {
      source: { kind: "goal", id: g },
      done: true,
    }),
    night = await job(p.id, {
      source: { kind: "goal", id: g },
      lane: "overnight",
      done: true,
    }),
    second = await job(p.id, { source: { kind: "goal", id: g2 }, done: true }),
    recurring = await job(p.id, {
      source: { kind: "routine", id: r },
      done: true,
    });
  // Terminal work checkpoints can be removed; retained work identity remains authoritative.
  await pool.query(
    "UPDATE ai_jobs SET run_state=NULL WHERE id=ANY($1::uuid[])",
    [[first.id, night.id, recurring.id]],
  );
  let map = await origins(p.id, [first.id, night.id, second.id, recurring.id]);
  assert.deepEqual(map.get(first.id), {
    kind: "goal",
    id: g,
    title: "Same name",
  });
  assert.deepEqual(map.get(night.id), map.get(first.id));
  assert.notEqual(map.get(second.id)!.id, g);
  assert.deepEqual(map.get(recurring.id), {
    kind: "routine",
    id: r,
    title: "A current routine",
  });
  await pool.query("UPDATE goals SET title='Renamed goal' WHERE id=$1", [g]);
  await pool.query("UPDATE agent_routines SET instruction=$2 WHERE id=$1", [
    r,
    "x".repeat(240),
  ]);
  map = await origins(p.id, [first.id, night.id, recurring.id]);
  assert.equal(map.get(first.id)!.title, "Renamed goal");
  assert.equal(map.get(night.id)!.id, g);
  assert.equal(map.get(recurring.id)!.title.length, 200);
  await pool.query("UPDATE goals SET title='  ' WHERE id=$1", [g]);
  assert.equal(
    (await origins(p.id, [first.id])).get(first.id)!.title,
    "Untitled goal",
  );
});
test("current authorized project groups task work and project chats while standalone tasks/chats retain their identities", async () => {
  const p = await person(),
    pr = await project(p.id),
    t = await task(p.id, "A task", pr),
    standalone = await task(p.id, "Standalone");
  const taskRun = await job(p.id, { source: { kind: "task", id: t } }),
    projectChat = await job(p.id, { project: pr }),
    taskOnly = await job(p.id, { source: { kind: "task", id: standalone } }),
    chat = await job(p.id, { title: "Legacy conversation" });
  const map = await origins(p.id, [
    taskRun.id,
    projectChat.id,
    taskOnly.id,
    chat.id,
  ]);
  assert.deepEqual(map.get(taskRun.id), {
    kind: "project",
    id: pr,
    title: "Current project",
  });
  assert.deepEqual(map.get(projectChat.id), map.get(taskRun.id));
  assert.deepEqual(map.get(taskOnly.id), {
    kind: "task",
    id: standalone,
    title: "Standalone",
  });
  assert.deepEqual(map.get(chat.id), {
    kind: "chat",
    id: chat.chat,
    title: "Legacy conversation",
  });
});
test("missing, foreign, assistant-off and revoked sources never leak or fall back to a broader chat origin", async () => {
  const p = await person(),
    other = await person(),
    pr = await project(p.id, "Private source project"),
    g = await goal(p.id, "Private goal", pr),
    foreign = await goal(other.id, "Foreign goal"),
    r = await routine(p.id);
  const goalRun = await job(p.id, {
      source: { kind: "goal", id: g },
      project: pr,
    }),
    foreignRun = await job(p.id, {
      source: { kind: "goal", id: foreign },
      dependencies: false,
    }),
    missing = await job(p.id, {
      source: { kind: "task", id: randomUUID() },
      dependencies: false,
    }),
    routineRun = await job(p.id, {
      source: { kind: "routine", id: r },
      dependencies: false,
    }),
    otherJob = await job(other.id);
  assert.equal(
    (await origins(p.id, [goalRun.id])).get(goalRun.id)!.kind,
    "goal",
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [pr]);
  await pool.query("DELETE FROM agent_routines WHERE id=$1", [r]);
  const map = await origins(p.id, [
    goalRun.id,
    foreignRun.id,
    missing.id,
    routineRun.id,
    otherJob.id,
  ]);
  assert.equal(map.size, 0);
  const page = await profiles(p.id);
  const all = page.profiles.flatMap((x) => x.work ?? []);
  assert.ok(!all.some((x) => x.job_id === goalRun.id));
  assert.ok(
    all
      .filter((x) =>
        [foreignRun.id, missing.id, routineRun.id].includes(x.job_id),
      )
      .every((x) => x.origin === null),
  );
  assert.ok(!JSON.stringify(page).includes("Foreign goal"));
  assert.ok(!JSON.stringify(page).includes("Private goal"));
  const visible = await job(p.id, { title: "Revoked provenance" });
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [visible.id, randomUUID()],
  );
  assert.equal((await origins(p.id, [visible.id])).size, 0);
});
test("profile negotiation decorates only selected outcome/work rows and preserves legacy fields and bounded lists", async () => {
  const p = await person(),
    g = await goal(p.id, "A shared origin");
  const done = await job(p.id, { source: { kind: "goal", id: g }, done: true }),
    active = await job(p.id, { source: { kind: "goal", id: g } });
  const old = await profiles(p.id, false, false),
    outcomesOnly = await profiles(p.id, true, false),
    originsOnly = await profiles(p.id, false, true),
    current = await profiles(p.id, true, true);
  for (const page of [old, outcomesOnly, originsOnly])
    assert.ok(
      page.profiles.every((profile) =>
        [...(profile.work ?? []), ...profile.outputs].every(
          (row) => !("origin" in row),
        ),
      ),
    );
  const bg = current.profiles[0];
  assert.deepEqual(bg.work!.find((x) => x.job_id === active.id)!.origin, {
    kind: "goal",
    id: g,
    title: "A shared origin",
  });
  assert.deepEqual(
    bg.outputs.find((x) => x.job_id === done.id)!.origin,
    bg.work![0].origin,
  );
  for (const headers of [
    { "x-orbyn-outcomes": "1" },
    { "x-orbyn-review-origins": "1" },
  ]) {
    const response = await app.inject({
      method: "GET",
      url: "/me/assistant/profiles",
      headers: { authorization: `Bearer ${p.token}`, ...headers },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(
      response
        .json()
        .profiles.every((profile: any) =>
          [...(profile.work ?? []), ...profile.outputs].every(
            (row) => !("origin" in row),
          ),
        ),
    );
  }
  const response = await app.inject({
    method: "GET",
    url: "/me/assistant/profiles",
    headers: {
      authorization: `Bearer ${p.token}`,
      "x-orbyn-outcomes": "1",
      "x-orbyn-review-origins": "1",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().profiles[0].outputs[0].origin.id, g);
  assert.ok(
    current.profiles.every(
      (profile) =>
        (profile.work?.length ?? 0) <= 20 && profile.outputs.length <= 5,
    ),
  );
});

test("team membership revocation removes project origins without exposing the old project or task title", async () => {
  const p = await person(),
    owner = await person();
  const team = await h.team(owner, "Review origin team", [[p, "member"]]);
  const pr = (
    await pool.query(
      "INSERT INTO projects(user_id,team_id,name) VALUES($1,$2,'Team-private project') RETURNING id",
      [owner.id, team],
    )
  ).rows[0].id;
  const t = (
    await pool.query(
      "INSERT INTO items(user_id,team_id,project_id,title,kind) VALUES($1,$2,$3,'Team-private task','task') RETURNING id",
      [owner.id, team, pr],
    )
  ).rows[0].id;
  const run = await job(p.id, { source: { kind: "task", id: t } });
  assert.equal((await origins(p.id, [run.id])).get(run.id)!.id, pr);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    p.id,
  ]);
  assert.equal((await origins(p.id, [run.id])).size, 0);
  const page = await profiles(p.id);
  assert.ok(!JSON.stringify(page).includes("Team-private"));
  assert.ok(
    !page.profiles.some((profile) =>
      profile.work?.some((row) => row.job_id === run.id),
    ),
  );
});

test("new review excludes only committed exact quiet deliveries before its bounded output selection", async () => {
  const p = await person(),
    r = await routine(p.id),
    watched = await task(p.id);
  const principal = await assistantPrincipal({
    id: p.id,
    name: p.name,
    role: "member",
  });
  const useful = await job(p.id, {
    source: { kind: "routine", id: r },
    done: true,
    title: "Older useful result",
  });
  const base = await job(p.id, {
    source: { kind: "routine", id: r },
    done: true,
    title: "Initial baseline result",
  });
  const baseId = randomUUID(),
    policy = { enabled: true, sources: [{ kind: "task", id: watched }] };
  await pool.query(
    `INSERT INTO assistant_quiet_checks(id,owner_id,routine_id,job_id,lane,policy_snapshot,projection_version,config_hash,provider_hash,scope_hash,intent_version,status,expected_count,checked_count,observed_at,snapshot_aggregate) VALUES($1,$2,$3,$4,'background',$5,1,'config','provider','scope',1,'baseline',1,1,now(),'[]')`,
    [baseId, p.id, r, base.id, policy],
  );
  // Synthetic committed delivery classifications test selection, not read-coverage verification.
  async function classify(
    run: { id: string; chat: string },
    check = true,
    intent = true,
  ) {
    if (check)
      await pool.query(
        `INSERT INTO assistant_quiet_checks(owner_id,routine_id,job_id,lane,policy_snapshot,projection_version,config_hash,provider_hash,scope_hash,intent_version,baseline_check_id,requested,status,expected_count,checked_count,observed_at,snapshot_aggregate) VALUES($1,$2,$3,'background',$4,1,'config','provider','scope',1,$5,true,'verified_unchanged',1,1,now(),'[]')`,
        [p.id, r, run.id, policy, baseId],
      );
    if (intent) {
      const dest = (
        await pool.query(
          "INSERT INTO assistant_conversation_streams(owner_id,chat_id) VALUES($1,$2) RETURNING id",
          [p.id, run.chat],
        )
      ).rows[0].id;
      const binding = (
        await pool.query(
          "INSERT INTO assistant_delivery_bindings(owner_id,work_kind,work_id,destination_id,reason,lane,sources_checked,timezone,grant_id) VALUES($1,'job',$2,$3,'personal','background',true,'UTC',$4) RETURNING id",
          [p.id, run.id, dest, principal.grant_id],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO assistant_delivery_intents(binding_id,event_key,state,reason,payload) VALUES($1,'result','suppressed','unchanged',$2)",
        [binding, { event: "result", work: { kind: "job", id: run.id } }],
      );
    }
  }
  const quiet = [];
  for (let i = 0; i < 6; i++) {
    const run = await job(p.id, {
      source: { kind: "routine", id: r },
      done: true,
      title: `Quiet check ${i}`,
    });
    await classify(run);
    quiet.push(run.id);
  }
  const bareCheck = await job(p.id, {
    source: { kind: "routine", id: r },
    done: true,
    title: "Useful despite same source versions",
  });
  await classify(bareCheck, true, false);
  const bareIntent = await job(p.id, {
    source: { kind: "routine", id: r },
    done: true,
    title: "Unqualified suppression metadata",
  });
  await classify(bareIntent, false, true);
  const failed = await job(p.id, { source: { kind: "routine", id: r } });
  await pool.query("UPDATE ai_jobs SET state='failed',result=$2 WHERE id=$1", [
    failed.id,
    { answer: "Failure remains visible" },
  ]);
  await classify(failed);
  const legacy = await profiles(p.id, true, false),
    current = await profiles(p.id, true, true);
  assert.ok(
    legacy.profiles[0].outputs.some((row) => quiet.includes(row.job_id)),
  );
  const selected = current.profiles[0].outputs.map((row) => row.job_id);
  assert.ok(!selected.some((id) => quiet.includes(id)));
  for (const id of [useful.id, base.id, bareCheck.id, bareIntent.id, failed.id])
    assert.ok(selected.includes(id), `Expected retained review result ${id}`);
  assert.equal(selected.length, 5);
});
test("older pending changes precede newer results and bounded output history is explicit", async () => {
  const p = await person(),
    r = await routine(p.id),
    old = await job(p.id, { source: { kind: "routine", id: r }, done: true });
  const proposal = (
    await pool.query(
      "INSERT INTO proposals(user_id,actions,expires_at) VALUES($1,'[]',now()+interval '1 hour') RETURNING id",
      [p.id],
    )
  ).rows[0].id;
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    old.id,
    {
      answer: "Review the saved changes",
      assistant_run: { proposal_id: proposal },
    },
  ]);
  for (let n = 0; n < 6; n++)
    await job(p.id, { source: { kind: "routine", id: r }, done: true });
  const current = await profiles(p.id),
    legacy = await profiles(p.id, true, false);
  assert.equal(current.profiles[0].outputs.length, 5);
  assert.equal(current.profiles[0].outputs[0].job_id, old.id);
  assert.equal(current.profiles[0].outputs[0].review_pending, true);
  assert.equal(current.profiles[0].outputs_truncated, true);
  assert.equal(legacy.profiles[0].outputs_truncated, undefined);
  assert.equal(legacy.profiles[0].outputs[0].review_pending, undefined);
  await pool.query("UPDATE proposals SET status='declined' WHERE id=$1", [
    proposal,
  ]);
  const resolved = await profiles(p.id);
  assert.ok(
    !resolved.profiles[0].outputs.some((row) => row.job_id === old.id),
    "Resolved old proposal returns to normal recency ordering",
  );
});

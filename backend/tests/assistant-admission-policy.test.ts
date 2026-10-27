import "./setup.js";
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const {
  assistantRuntimeHasRoom,
  applyAssistantAdmissionPolicy,
  AssistantAdmissionPolicyMismatch,
} = await import("../src/modules/ai/agent/runtime-slots.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const { claimMaintainedPageRun } =
  await import("../src/modules/documents/maintenance-runs.js");
const { claimScheduledAgenda } =
  await import("../src/modules/documents/agenda-summary-runs.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const owners: string[] = [];
const teams: string[] = [];
const initialEnvRevision = env.ASSISTANT_ADMISSION_REVISION;
let original: Record<string, number>;
const defaults = {
  global_limit: 8,
  interactive_limit: 4,
  background_limit: 2,
  overnight_limit: 2,
};
const current = async () =>
  (
    await pool.query(
      "SELECT revision,global_limit,interactive_limit,background_limit,overnight_limit FROM assistant_admission_policy WHERE id",
    )
  ).rows[0];
before(async () => {
  await migrate();
  original = await current();
});
afterEach(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [
    teams.splice(0),
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    owners.splice(0),
  ]);
  // Restore only this test's singleton fixture; operator commands never reset revisions.
  await pool.query(
    `UPDATE assistant_admission_policy SET revision=$1,global_limit=$2,
    interactive_limit=$3,background_limit=$4,overnight_limit=$5 WHERE id`,
    [
      original.revision,
      original.global_limit,
      original.interactive_limit,
      original.background_limit,
      original.overnight_limit,
    ],
  );
  env.ASSISTANT_ADMISSION_REVISION = initialEnvRevision;
});
after(async () => {
  await pool.end();
});
async function person() {
  const user = (
    await pool.query(
      "INSERT INTO users(email,password_hash,name) VALUES($1,'fixture','Admission fixture') RETURNING *",
      [`admission-${randomUUID()}@example.invalid`],
    )
  ).rows[0];
  owners.push(user.id);
  return user;
}
async function job(
  owner: string,
  lane: "interactive" | "background" | "overnight" = "background",
) {
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Admission fixture') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const state = initialAssistantRun({
    chat_id: chat,
    turn_id: randomUUID(),
    message: "Synthetic admission work",
    timezone: "UTC",
    history: [],
    scope: null,
    ...(lane !== "interactive"
      ? {
          automation: {
            kind: lane === "overnight" ? ("night" as const) : ("idea" as const),
          },
        }
      : {}),
  });
  return (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_state) VALUES($1,$2,$3,'queued',$4) RETURNING id",
      [owner, chat, state.request.turn_id, JSON.stringify(state)],
    )
  ).rows[0].id;
}
async function scoped(user: Awaited<ReturnType<typeof person>>) {
  const principal = await assistantPrincipal(user);
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Admission fixture','[]') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  const binding = (
    await pool.query(
      `INSERT INTO assistant_page_bindings(doc_id,user_id,agent_grant_id,snapshot,instruction,rrule,timezone,next_run_at)
    VALUES($1,$2,$3,'{"doc_version":1,"blocks":[{"id":"summary"}]}','Synthetic admission work','FREQ=DAILY','UTC',now()) RETURNING id`,
      [doc, user.id, principal.grant_id],
    )
  ).rows[0].id;
  const page = (
    await pool.query(
      `INSERT INTO assistant_page_runs(binding_id,user_id,agent_grant_id,binding_revision,doc_version,assistant_rules_revision,lane,scheduled_for)
    VALUES($1,$2,$3,1,1,1,'background',now()) RETURNING id`,
      [binding, user.id, principal.grant_id],
    )
  ).rows[0].id;
  const agenda = (
    await pool.query(
      `INSERT INTO agenda_summary_runs(user_id,doc_id,local_day,target_block_id,target_hash,snapshot,permission,expires_at,assistant_rules_revision)
    VALUES($1,$2,current_date,'summary','fixture','{}','{}',now()+interval '1 hour',1) RETURNING id`,
      [user.id, doc],
    )
  ).rows[0].id;
  return { page, agenda };
}
async function apply(changes: Partial<typeof defaults> = {}) {
  const p = await applyAssistantAdmissionPolicy({
    expected_revision: (await current()).revision,
    ...defaults,
    ...changes,
  });
  env.ASSISTANT_ADMISSION_REVISION = p.revision;
  return p;
}

test("migration seeds the existing caps once and policy application uses revision CAS", async () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(defaults).map((k) => [k, original[k]])),
    defaults,
  );
  const before = await current();
  const changes = {
    expected_revision: before.revision,
    ...defaults,
    background_limit: 1,
  };
  const applied = await Promise.allSettled([
    applyAssistantAdmissionPolicy(changes),
    applyAssistantAdmissionPolicy(changes),
  ]);
  assert.equal(applied.filter((p) => p.status === "fulfilled").length, 1);
  const rejected = applied.find(
    (p) => p.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.statusCode, 409);
  const saved = await current();
  assert.equal(saved.revision, before.revision + 1);
  assert.equal(saved.background_limit, 1);
  await migrate();
  assert.deepEqual(await current(), saved);
});

test("invalid policies cannot raise ceilings or write malformed limits", async () => {
  const before = await current();
  for (const changes of [
    { global_limit: 9 },
    { interactive_limit: 5 },
    { background_limit: 3 },
    { overnight_limit: 3 },
    { global_limit: -1 },
    { background_limit: 0.5 },
    { unexpected: 1 },
  ]) {
    await assert.rejects(
      applyAssistantAdmissionPolicy({
        expected_revision: before.revision,
        ...defaults,
        ...changes,
      }),
    );
    assert.deepEqual(await current(), before);
  }
  await assert.rejects(
    pool.query(
      "UPDATE assistant_admission_policy SET background_limit=3 WHERE id",
    ),
    { code: "23514" },
  );
  assert.deepEqual(await current(), before);
});

test("all three claim owners fail closed before budgets or lease takeover on revision mismatch", async () => {
  const user = await person(),
    id = await job(user.id),
    work = await scoped(user);
  await pool.query(
    "UPDATE assistant_page_runs SET state='running',lease_token=$2,lease_expires_at=now()-interval '1 minute' WHERE id=$1",
    [work.page, randomUUID()],
  );
  await pool.query(
    "UPDATE agenda_summary_runs SET state='running',lease_token=$2,lease_expires_at=now()-interval '1 minute' WHERE id=$1",
    [work.agenda, randomUUID()],
  );
  const beforePage = (
    await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
      work.page,
    ])
  ).rows[0];
  const beforeAgenda = (
    await pool.query("SELECT * FROM agenda_summary_runs WHERE id=$1", [
      work.agenda,
    ])
  ).rows[0];
  env.ASSISTANT_ADMISSION_REVISION = (await current()).revision + 1;
  await assert.rejects(
    claimAssistantJob("stale", "background"),
    AssistantAdmissionPolicyMismatch,
  );
  await assert.rejects(
    transaction((db) =>
      claimMaintainedPageRun(db, "background", new Date(), work.page),
    ),
    AssistantAdmissionPolicyMismatch,
  );
  await assert.rejects(
    claimScheduledAgenda(work.agenda),
    AssistantAdmissionPolicyMismatch,
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [id])).rows[0]
      .state,
    "queued",
  );
  assert.deepEqual(
    (
      await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
        work.page,
      ])
    ).rows[0],
    beforePage,
  );
  assert.deepEqual(
    (
      await pool.query("SELECT * FROM agenda_summary_runs WHERE id=$1", [
        work.agenda,
      ])
    ).rows[0],
    beforeAgenda,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_work_reservations WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    0,
  );
});

test("claims and reservations across job and page owners share capacity with Agenda leases", async () => {
  const user = await person(),
    work = await scoped(user),
    id = await job(user.id);
  const [claimedJob, claimedPage] = await Promise.all([
    claimAssistantJob("job-replica", "background"),
    transaction((db) =>
      claimMaintainedPageRun(db, "background", new Date(), work.page),
    ),
  ]);
  assert.equal(claimedJob?.id, id);
  assert.equal(claimedPage?.id, work.page);
  assert.equal(await claimScheduledAgenda(work.agenda), null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_work_reservations WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    2,
  );
  await pool.query(
    "UPDATE ai_jobs SET state='done',lease_until=NULL,claimed_by=NULL WHERE id=$1",
    [id],
  );
  await pool.query(
    "UPDATE agenda_summary_runs SET state='running',lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",
    [work.agenda, randomUUID()],
  );
  assert.equal(
    await transaction((db) => assistantRuntimeHasRoom(db, "background")),
    false,
  );
  assert.equal(
    await transaction((db) => assistantRuntimeHasRoom(db, "interactive")),
    true,
  );
});

test("lower policy drains existing leases and blocks new work until below the cap", async () => {
  const user = await person(),
    ids = await Promise.all([job(user.id), job(user.id), job(user.id)]);
  assert.ok(await claimAssistantJob("first", "background"));
  assert.ok(await claimAssistantJob("second", "background"));
  const before = (
    await pool.query(
      "SELECT id,claimed_by,lease_until FROM ai_jobs WHERE id=ANY($1::uuid[]) AND state='running' ORDER BY id",
      [ids],
    )
  ).rows;
  await apply({ global_limit: 1, background_limit: 1 });
  assert.equal(await claimAssistantJob("blocked", "background"), null);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT id,claimed_by,lease_until FROM ai_jobs WHERE id=ANY($1::uuid[]) AND state='running' ORDER BY id",
        [ids],
      )
    ).rows,
    before,
  );
  await pool.query(
    "UPDATE ai_jobs SET state='done',lease_until=NULL,claimed_by=NULL WHERE id=$1",
    [before[0].id],
  );
  assert.equal(await claimAssistantJob("still-full", "background"), null);
  await pool.query(
    "UPDATE ai_jobs SET state='done',lease_until=NULL,claimed_by=NULL WHERE id=$1",
    [before[1].id],
  );
  assert.ok(await claimAssistantJob("drained", "background"));
});

test("expired page lease recovery retains cumulative reservations under the compatible policy", async () => {
  const user = await person(),
    work = await scoped(user);
  const claimed = await transaction((db) =>
    claimMaintainedPageRun(db, "background", new Date(), work.page),
  );
  assert.ok(claimed);
  await pool.query(
    "UPDATE assistant_page_runs SET lease_expires_at=now()-interval '1 minute',token_estimate=100 WHERE id=$1",
    [work.page],
  );
  const recovered = await transaction((db) =>
    claimMaintainedPageRun(db, "background", new Date(), work.page),
  );
  assert.ok(recovered);
  assert.notEqual(recovered.lease_token, claimed.lease_token);
  const reservations = (
    await pool.query(
      "SELECT state,reported_tokens,reserved_tokens,starting_estimate FROM assistant_work_reservations WHERE page_run_id=$1 ORDER BY started_at",
      [work.page],
    )
  ).rows;
  assert.equal(reservations.length, 2);
  assert.equal(reservations[0].state, "settled");
  assert.equal(reservations[0].reported_tokens, 100);
  assert.equal(reservations[1].starting_estimate, 100);
  assert.equal(reservations[1].reserved_tokens, 19900);
});

test("missing policy fails closed and explicit zero-cap pause reserves no work", async () => {
  const user = await person();
  await job(user.id);
  await apply({ global_limit: 0 });
  assert.equal(await claimAssistantJob("paused", "background"), null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_work_reservations WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    0,
  );
  await transaction(async (db) => {
    await db.query("DELETE FROM assistant_admission_policy");
    await assert.rejects(
      assistantRuntimeHasRoom(db, "interactive"),
      AssistantAdmissionPolicyMismatch,
    );
    // Roll back the missing-row fixture, preserving the singleton for other tests.
    throw new Error("rollback missing policy fixture");
  }).catch((error) =>
    assert.equal(error.message, "rollback missing policy fixture"),
  );
});

// Synthetic measurement harness, not a fairness SLA. Queued age is observed
// separately from time-to-claim; unscoped/multi-space work is not called private.
test("queue-age report groups team work across accounts and separates private owners", async () => {
  const a = await person(),
    b = await person();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Admission measurement',$1) RETURNING id",
      [a.id],
    )
  ).rows[0].id;
  teams.push(team);
  const teamProject = (
    await pool.query(
      "INSERT INTO projects(user_id,team_id,name) VALUES($1,$2,'Team fixture') RETURNING id",
      [a.id, team],
    )
  ).rows[0].id;
  const privateProject = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Private fixture') RETURNING id",
      [a.id],
    )
  ).rows[0].id;
  const at = new Date();
  for (const [owner, target, age] of [
    [a.id, teamProject, 30000],
    [b.id, teamProject, 10000],
    [a.id, privateProject, 20000],
    [b.id, null, 5000],
  ] as const) {
    const id = await job(owner);
    await pool.query(
      "UPDATE ai_jobs SET created_at=$2,run_state=jsonb_set(run_state,'{request,scope}',$3::jsonb) WHERE id=$1",
      [
        id,
        new Date(at.getTime() - age),
        JSON.stringify(target ? { kind: "project", id: target } : null),
      ],
    );
  }
  const work = await scoped(b);
  await pool.query("UPDATE assistant_page_runs SET created_at=$2 WHERE id=$1", [
    work.page,
    new Date(at.getTime() - 7000),
  ]);
  await pool.query("UPDATE agenda_summary_runs SET created_at=$2 WHERE id=$1", [
    work.agenda,
    new Date(at.getTime() - 9000),
  ]);
  const report = (
    await pool.query(
      `WITH pending AS (
    SELECT j.user_id,CASE WHEN p.id IS NOT NULL THEN p.team_id WHEN i.id IS NOT NULL THEN i.team_id END AS team_id,
      (p.id IS NOT NULL OR i.id IS NOT NULL) AS known_scope,j.runtime_lane AS lane,j.created_at
      FROM ai_jobs j
      LEFT JOIN projects p ON j.run_state#>>'{request,scope,kind}'='project' AND p.id::text=j.run_state#>>'{request,scope,id}'
      LEFT JOIN items i ON j.run_state#>>'{request,scope,kind}'='task' AND i.id::text=j.run_state#>>'{request,scope,id}'
      WHERE j.user_id=ANY($1::uuid[]) AND j.state='queued' AND j.run_state->>'version'='1'
    UNION ALL SELECT r.user_id,d.team_id,true,r.lane,r.created_at FROM assistant_page_runs r JOIN docs d ON d.id=(SELECT doc_id FROM assistant_page_bindings WHERE id=r.binding_id)
      WHERE r.user_id=ANY($1::uuid[]) AND r.state='queued'
    UNION ALL SELECT r.user_id,d.team_id,true,'background',r.created_at FROM agenda_summary_runs r JOIN docs d ON d.id=r.doc_id
      WHERE r.user_id=ANY($1::uuid[]) AND r.state='queued'
  ), attributed AS (
    SELECT CASE WHEN team_id IS NOT NULL THEN 'team' WHEN known_scope THEN 'private' ELSE 'unscoped' END AS scope,
      coalesce(team_id,user_id) AS scope_id,lane,greatest(0,extract(epoch FROM ($2::timestamptz-created_at))*1000) AS age_ms FROM pending
  ) SELECT scope,scope_id,lane,count(*)::int AS queued,max(age_ms)::float8 AS oldest_ms,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY age_ms)::float8 AS median_ms
    FROM attributed GROUP BY scope,scope_id,lane ORDER BY scope,scope_id,lane`,
      [[a.id, b.id], at],
    )
  ).rows;
  assert.deepEqual(
    report.find((r) => r.scope === "team"),
    {
      scope: "team",
      scope_id: team,
      lane: "background",
      queued: 2,
      oldest_ms: 30000,
      median_ms: 20000,
    },
  );
  assert.equal(report.filter((r) => r.scope === "private").length, 2);
  assert.equal(
    report.find((r) => r.scope === "private" && r.scope_id === a.id)?.oldest_ms,
    20000,
  );
  assert.equal(
    report.find((r) => r.scope === "private" && r.scope_id === b.id)?.queued,
    2,
  );
  assert.equal(report.find((r) => r.scope === "unscoped")?.queued, 1);
  console.info(
    "Synthetic admission queue-age baseline:",
    JSON.stringify(
      report.map(({ scope, scope_id: _identity, ...metrics }) => ({
        scope,
        ...metrics,
      })),
    ),
  );
});

test("a fast replica clock cannot ignore eight live database leases across all work tables", async (t) => {
  const user = await person(),
    work = await scoped(user);
  for (let i = 0; i < 4; i++) {
    await job(user.id, "interactive");
    assert.ok(await claimAssistantJob(`interactive-${i}`, "interactive"));
  }
  for (let i = 0; i < 2; i++) {
    await job(user.id, "overnight");
    assert.ok(await claimAssistantJob(`overnight-${i}`, "overnight"));
  }
  await pool.query(
    "UPDATE assistant_page_runs SET state='running',lease_token=$2,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",
    [work.page, randomUUID()],
  );
  await pool.query(
    "UPDATE agenda_summary_runs SET state='running',lease_token=$2,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",
    [work.agenda, randomUUID()],
  );
  const queued = await job(user.id, "interactive");
  const reservations = (
    await pool.query(
      "SELECT count(*)::int n FROM assistant_work_reservations WHERE user_id=$1",
      [user.id],
    )
  ).rows[0].n;
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2099-01-01T00:00:00Z"),
  });
  try {
    assert.equal(new Date().getUTCFullYear(), 2099);
    assert.equal(
      await transaction((db) => assistantRuntimeHasRoom(db, "interactive")),
      false,
    );
    assert.equal(
      await claimAssistantJob("skewed-replica", "interactive"),
      null,
    );
    assert.equal(
      await transaction((db) =>
        claimMaintainedPageRun(db, "background", undefined, work.page),
      ),
      null,
    );
    assert.equal(await claimScheduledAgenda(work.agenda), null);
    assert.equal(
      (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [queued]))
        .rows[0].state,
      "queued",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM assistant_work_reservations WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].n,
      reservations,
    );
  } finally {
    t.mock.timers.reset();
  }
});

test("production page claim uses database time even when its process clock is far ahead", async (t) => {
  const user = await person(),
    work = await scoped(user);
  const before = (await pool.query("SELECT clock_timestamp() AS at")).rows[0]
    .at as Date;
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2099-01-01T00:00:00Z"),
  });
  let claimed;
  try {
    claimed = await transaction((db) =>
      claimMaintainedPageRun(db, "background", undefined, work.page),
    );
  } finally {
    t.mock.timers.reset();
  }
  assert.ok(claimed);
  const after = (await pool.query("SELECT clock_timestamp() AS at")).rows[0]
    .at as Date;
  assert.ok(claimed.lease_expires_at!.getTime() >= before.getTime() + 60000);
  assert.ok(claimed.lease_expires_at!.getTime() <= after.getTime() + 60000);
});

test("explicit admission fixture clocks require the server-side test marker", async () => {
  const at = new Date();
  assert.equal(
    await transaction((db) => assistantRuntimeHasRoom(db, "interactive", at)),
    true,
  );
  await assert.rejects(
    transaction(async (db) => {
      await db.query("SET LOCAL orbyn.environment='production'");
      return assistantRuntimeHasRoom(db, "interactive", at);
    }),
    /explicit assistant admission clock requires a marked test database/,
  );
  await assert.rejects(
    transaction(async (db) => {
      await db.query("SET LOCAL orbyn.environment='production'");
      return claimMaintainedPageRun(db, "background", at);
    }),
    /explicit assistant admission clock requires a marked test database/,
  );
  await assert.rejects(
    transaction((db) =>
      assistantRuntimeHasRoom(db, "interactive", new Date(NaN)),
    ),
    /valid date/,
  );
});

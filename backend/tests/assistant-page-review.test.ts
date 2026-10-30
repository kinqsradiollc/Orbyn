import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool, readTransaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { readAssistantPageReview } =
  await import("../src/modules/assistant-workspace/page-review.js");
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
  const p = await h.register("page-review");
  owners.push(p.id);
  const principal = await assistantPrincipal({
    id: p.id,
    name: p.name,
    role: "member",
  });
  return { ...p, principal };
}
async function pageRun(
  p: Awaited<ReturnType<typeof person>>,
  options: {
    state?: "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
    lane?: "background" | "overnight";
    expired?: boolean;
    project?: string;
    team?: string;
    comment?: boolean;
    parent?: string;
  } = {},
) {
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,team_id,project_id,title,content) VALUES($1,$2,$3,'Current page title',$4) RETURNING id,version",
      [
        p.id,
        options.team ?? null,
        options.project ?? null,
        JSON.stringify([
          {
            id: "selected",
            type: "paragraph",
            text: "PRIVATE page content must never enter review transport",
          },
        ]),
      ],
    )
  ).rows[0];
  const comment = options.comment
    ? (
        await pool.query(
          "INSERT INTO doc_comments(doc_id,user_id,body,parent_id) VALUES($1,$2,'@orbyn update this section',$3) RETURNING id,revision",
          [doc.id, p.id, options.parent ?? null],
        )
      ).rows[0]
    : null;
  const binding = (
    await pool.query(
      "INSERT INTO assistant_page_bindings(doc_id,user_id,agent_grant_id,snapshot,instruction,rrule,timezone,next_run_at,source_comment_id,source_comment_revision) VALUES($1,$2,$3,$4,'PRIVATE binding instructions','FREQ=DAILY','UTC',now(),$5,$6) RETURNING id,revision",
      [
        doc.id,
        p.id,
        p.principal.grant_id,
        {
          doc_version: doc.version,
          blocks: [{ block_id: "selected", position: 0 }],
        },
        comment?.id ?? null,
        comment?.revision ?? null,
      ],
    )
  ).rows[0];
  const lane = options.lane ?? "background",
    state = options.state ?? "queued";
  const night =
    lane === "overnight"
      ? (
          await pool.query(
            "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,current_date) ON CONFLICT(user_id,local_day) DO UPDATE SET updated_at=now() RETURNING id",
            [p.id],
          )
        ).rows[0].id
      : null;
  const run = (
    await pool.query(
      `INSERT INTO assistant_page_runs(binding_id,user_id,agent_grant_id,binding_revision,doc_version,assistant_rules_revision,lane,night_id,end_at,scheduled_for,state,lease_token,lease_expires_at,proposal,waiting_id,error_message)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11,$12,$13,$14,$15) RETURNING id,updated_at`,
      [
        binding.id,
        p.id,
        p.principal.grant_id,
        binding.revision,
        doc.version,
        p.principal.assistant_rules_revision ?? 1,
        lane,
        night,
        night ? new Date(Date.now() + 3600000) : null,
        state,
        state === "running" ? randomUUID() : null,
        state === "running"
          ? new Date(Date.now() + (options.expired ? -60000 : 60000))
          : null,
        state === "waiting"
          ? {
              expected_revision: binding.revision,
              replacements: [
                {
                  id: "selected",
                  type: "paragraph",
                  text: "PRIVATE generated proposal",
                },
              ],
            }
          : null,
        state === "waiting" ? randomUUID() : null,
        state === "failed" ? "PRIVATE raw error must not be transported" : null,
      ],
    )
  ).rows[0];
  return { doc, binding, run, comment };
}
const read = (owner: string, lane: "background" | "overnight" = "background") =>
  readTransaction(
    (db) => readAssistantPageReview(db, owner, lane, new Date()),
    { primary: true, isolation: "repeatable read" },
  );
const profiles = (owner: string, outcomes = true, origins = true) =>
  readTransaction(
    (db) => readAssistantProfiles(db, owner, undefined, outcomes, origins),
    { primary: true, isolation: "repeatable read" },
  );

test("read-only projection exposes bounded page identities across both lanes and every process state without generated content", async () => {
  const p = await person(),
    expected = [];
  for (const state of [
    "queued",
    "running",
    "waiting",
    "done",
    "failed",
    "cancelled",
  ] as const)
    expected.push(await pageRun(p, { state }));
  const recovering = await pageRun(p, { state: "running", expired: true }),
    night = await pageRun(p, { state: "waiting", lane: "overnight" });
  const result = await read(p.id),
    other = await read(p.id, "overnight");
  assert.equal(result.runs.length, 7);
  assert.equal(result.runs[0].state, "waiting");
  assert.ok(
    result.runs.some((r) => r.id === recovering.run.id && r.recovering),
  );
  assert.deepEqual(result.counts, {
    working: 1,
    waiting: 1,
    queued: 1,
    recovering: 1,
  });
  assert.equal(other.runs.length, 1);
  assert.equal(other.runs[0].id, night.run.id);
  assert.ok(
    result.runs.every(
      (r) =>
        r.origin.kind === "page" &&
        r.origin.id === r.doc_id &&
        r.title === "Current page title" &&
        r.work_kind === "page_update",
    ),
  );
  for (const word of [
    "PRIVATE",
    "proposal",
    "lease_token",
    "error_message",
    "estimated_tokens",
    "instruction",
  ])
    assert.ok(!JSON.stringify(result.runs).includes(word));
  await pool.query(
    "UPDATE assistant_page_bindings SET paused=true WHERE id=$1",
    [expected[2].binding.id],
  );
  assert.ok(
    (await read(p.id)).runs.some((r) => r.id === expected[2].run.id),
    "Pause does not erase admitted waiting history",
  );
});
test("negotiated profile combines authorized page counts and rows while legacy responses stay unchanged", async () => {
  const p = await person(),
    run = await pageRun(p, { state: "running" });
  for (const [outcomes, origins] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const page = await profiles(p.id, outcomes, origins);
    assert.equal(page.profiles[0].counts.working, 0);
    assert.equal(page.profiles[0].state, "idle");
    assert.ok(!("page_runs" in page.profiles[0]));
    assert.ok(!("page_runs_truncated" in page.profiles[0]));
  }
  const current = await profiles(p.id);
  assert.equal(current.profiles[0].state, "working");
  assert.equal(current.profiles[0].counts.working, 1);
  assert.equal(current.profiles[0].page_runs![0].id, run.run.id);
  assert.equal(current.profiles[0].work_truncated, false);
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
  assert.equal(response.json().profiles[0].page_runs[0].doc_id, run.doc.id);
});
test("twenty active plus five terminal page rows do not truncate each other and private rows do not inflate counts", async () => {
  const p = await person();
  for (let n = 0; n < 22; n++) await pageRun(p, { state: "waiting" });
  for (let n = 0; n < 7; n++) await pageRun(p, { state: "done" });
  const hidden = await pageRun(p, { state: "waiting" });
  await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [
    hidden.doc.id,
  ]);
  const result = await read(p.id);
  assert.equal(result.runs.filter((r) => r.state === "waiting").length, 20);
  assert.equal(result.runs.filter((r) => r.state === "done").length, 5);
  assert.equal(result.runs.length, 25);
  assert.equal(result.counts.waiting, 22);
  assert.equal(result.truncated, true);
  const page = await profiles(p.id);
  assert.equal(page.profiles[0].counts.waiting, 22);
  assert.equal(page.profiles[0].work_truncated, true);
  assert.equal(page.profiles[0].page_runs_truncated, true);
  assert.ok(!page.profiles[0].page_runs!.some((r) => r.id === hidden.run.id));
});
test("one eligibility statement retains complete counts and deterministic tied row ordering", async () => {
  const p = await person();
  const expected: { id: string; state: string }[] = [];
  for (const state of ["waiting", "running", "queued", "done"] as const) {
    const count = state === "done" ? 7 : 5;
    for (let index = 0; index < count; index++) {
      const value = await pageRun(p, {
        state,
        expired: state === "running" && index < 2,
      });
      expected.push({ id: value.run.id, state });
    }
  }
  await pool.query(
    "UPDATE assistant_page_runs SET updated_at='2026-10-30T12:00:00.123456Z' WHERE user_id=$1",
    [p.id],
  );
  const statements: string[] = [];
  const result = await readTransaction(
    (db) =>
      readAssistantPageReview(
        {
          query: ((...args: unknown[]) => {
            statements.push(String(args[0]));
            return Reflect.apply(db.query, db, args);
          }) as typeof db.query,
        },
        p.id,
        "background",
        new Date(),
      ),
    { primary: true, isolation: "repeatable read", jit: false },
  );
  assert.equal(
    statements.filter((sql) => sql.includes("FROM assistant_page_runs r"))
      .length,
    1,
    "counts and selected rows share one eligibility evaluation",
  );
  assert.deepEqual(result.counts, {
    working: 3,
    waiting: 5,
    queued: 5,
    recovering: 2,
  });
  const ids = (state: string) =>
    expected
      .filter((row) => row.state === state)
      .map((row) => row.id)
      .sort();
  assert.deepEqual(
    result.runs.map((row) => row.id),
    [
      ...ids("waiting"),
      ...ids("running"),
      ...ids("queued"),
      ...ids("done").slice(0, 5),
    ],
  );
  assert.equal(result.truncated, true);
  assert.ok(
    result.runs.every((row) => row.updated_at === "2026-10-30T12:00:00.123Z"),
  );
});
test("current project and grant/rule/privacy authority control titles and counts without effect-guard locks", async () => {
  const p = await person(),
    pr = (
      await pool.query(
        "INSERT INTO projects(user_id,name) VALUES($1,'Current scoped project') RETURNING id",
        [p.id],
      )
    ).rows[0].id;
  const run = await pageRun(p, { state: "failed", project: pr });
  assert.deepEqual((await read(p.id)).runs[0].origin, {
    kind: "project",
    id: pr,
    title: "Current scoped project",
  });
  await pool.query("UPDATE projects SET name='Renamed project' WHERE id=$1", [
    pr,
  ]);
  assert.equal((await read(p.id)).runs[0].origin.title, "Renamed project");
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [pr]);
  assert.equal((await read(p.id)).runs.length, 0);
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [pr]);
  await pool.query(
    "UPDATE agent_grants SET assistant_rules_revision=assistant_rules_revision+1 WHERE id=$1",
    [p.principal.grant_id],
  );
  assert.equal((await read(p.id)).runs.length, 0);
  // A fresh captured revision does not bypass current suspension/revocation.
  await pool.query(
    "UPDATE assistant_page_runs SET assistant_rules_revision=assistant_rules_revision+1 WHERE id=$1",
    [run.run.id],
  );
  await pool.query("UPDATE agent_grants SET suspended_at=now() WHERE id=$1", [
    p.principal.grant_id,
  ]);
  assert.equal((await read(p.id)).runs.length, 0);
  await assert.rejects(
    pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
      p.principal.grant_id,
    ]),
    /cannot be revoked/,
  );
  await pool.query(
    "UPDATE agent_grants SET suspended_at=NULL,personal=false WHERE id=$1",
    [p.principal.grant_id],
  );
  assert.equal((await read(p.id)).runs.length, 0);
});
test("withdrawn comment requests, revoked entry provenance and pruned runs fail closed", async () => {
  const p = await person(),
    reply = await pageRun(p, { state: "waiting", comment: true });
  assert.equal((await read(p.id)).runs[0].work_kind, "comment_reply");
  await pool.query(
    "UPDATE doc_comments SET body='Withdraw the request' WHERE id=$1",
    [reply.comment!.id],
  );
  assert.equal((await read(p.id)).runs.length, 0);
  const contextual = await pageRun(p, { state: "waiting" });
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Source conversation') RETURNING id",
      [p.id],
    )
  ).rows[0].id;
  const dest = (
    await pool.query(
      "INSERT INTO assistant_conversation_streams(owner_id,chat_id) VALUES($1,$2) RETURNING id",
      [p.id, chat],
    )
  ).rows[0].id;
  const entry = (
    await pool.query(
      "INSERT INTO assistant_conversation_entries(destination_id,sequence,kind,turn_id,role,payload,sources_checked) VALUES($1,1,'turn',$2,'user','{}',true) RETURNING id",
      [dest, randomUUID()],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO assistant_page_run_entry_sources(run_id,source_entry_id) VALUES($1,$2)",
    [contextual.run.id, entry],
  );
  assert.ok((await read(p.id)).runs.some((r) => r.id === contextual.run.id));
  await pool.query(
    "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [entry, randomUUID()],
  );
  assert.equal((await read(p.id)).runs.length, 0);
  await pool.query(
    "DELETE FROM assistant_conversation_entry_sources WHERE entry_id=$1",
    [entry],
  );
  await pool.query("DELETE FROM assistant_page_runs WHERE id=$1", [
    contextual.run.id,
  ]);
  assert.equal((await read(p.id)).runs.length, 0);
});
test("team membership and assistant page policy revocation remove page rows and private counts", async () => {
  const p = await person(),
    owner = await h.register("page-team-owner");
  owners.push(owner.id);
  const team = await h.team(owner, "Page team", [[p, "admin"]]);
  const run = await pageRun(p, { state: "waiting", team });
  assert.equal((await read(p.id)).counts.waiting, 1);
  await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
    team,
  ]);
  assert.equal((await read(p.id)).counts.waiting, 0);
  await pool.query("UPDATE teams SET assistant_allowed=true WHERE id=$1", [
    team,
  ]);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    p.id,
  ]);
  const result = await read(p.id);
  assert.equal(result.runs.length, 0);
  assert.equal(result.counts.waiting, 0);
  assert.equal(result.truncated, false);
  assert.ok(!JSON.stringify(result).includes(run.doc.id));
});

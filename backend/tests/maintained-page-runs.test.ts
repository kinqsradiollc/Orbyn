import { defaultNightShift } from "@orbyn/core";
import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UserRow } from "../src/lib/auth.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { createMaintainedPageBinding, updateMaintainedPageBinding } =
  await import("../src/modules/docs/maintenance.js");
const {
  queueMaintainedPageRun,
  claimMaintainedPageRun,
  guardMaintainedPageRun,
  stageMaintainedPageRun,
  applyMaintainedPageRun,
  waitMaintainedPageRun,
  decideMaintainedPageRun,
  renewMaintainedPageRun,
  PAGE_RUN_LEASE_MS,
  expireMaintainedPageRuns,
  failMaintainedPageRun,
} = await import("../src/modules/docs/maintenance-runs.js");
const people: string[] = [];
const time = new Date("2026-10-05T09:00:00Z");
const later = (ms: number) => new Date(time.getTime() + ms);
before(() => migrate());
afterEach(async () => {
  await pool.query("DELETE FROM ai_jobs WHERE user_id=ANY($1::uuid[])", [
    people,
  ]);
  await pool.query(
    "UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,waiting_id=NULL WHERE user_id=ANY($1::uuid[]) AND state IN ('queued','running','waiting')",
    [people],
  );
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [people]);
  await pool.end();
});
async function fixture(rule = "FREQ=DAILY", tokenBudget = 20000) {
  const id = randomUUID();
  people.push(id);
  const user = (
    await pool.query<UserRow>(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Page worker','unusable') RETURNING *",
      [id, `page-run-${id}@orbyn.test`],
    )
  ).rows[0];
  const principal = {
    ...(await assistantPrincipal(user)),
    assistant_lane: "background" as const,
  };
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'A page',$2::jsonb) RETURNING id,version",
      [
        id,
        JSON.stringify([
          { id: "human", type: "paragraph", text: "Private human material." },
          { id: "summary", type: "paragraph", text: "Selected summary." },
        ]),
      ],
    )
  ).rows[0];
  const input = {
    instruction: "Maintain only the summary.",
    rrule: rule,
    timezone: "UTC",
    next_run_at: time.toISOString(),
    block_ids: ["summary"],
    expected_doc_version: doc.version,
    paused: false,
    token_budget: tokenBudget,
  };
  const binding = await transaction((db) =>
    createMaintainedPageBinding(db, user, principal, doc.id, input),
  );
  return { user, principal, doc, binding, input };
}
async function queued(f: Awaited<ReturnType<typeof fixture>>) {
  const run = await transaction((db) =>
    queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, time, {
      kind: "background",
    }),
  );
  assert.ok(run);
  return run;
}
async function claimed() {
  const f = await fixture();
  const q = await queued(f);
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time),
  );
  assert.equal(run?.id, q.id);
  assert.ok(run?.lease_token);
  return { ...f, run: run! };
}
const proposal = {
  expected_revision: 1,
  replacements: [
    { id: "summary", type: "paragraph", text: "Generated update." },
  ],
};
const status = (code: number) => (error: any) => error.statusCode === code;

test("page budgets persist across updates and bind each queued run", async () => {
  const f = await fixture("FREQ=DAILY", 5000);
  assert.equal(f.binding.token_budget, 5000);
  const first = await queued(f);
  assert.equal(first.token_budget, 5000);
  const changed = await transaction((db) =>
    updateMaintainedPageBinding(
      db,
      f.user,
      f.principal,
      f.doc.id,
      f.binding.id,
      {
        ...f.input,
        expected_revision: f.binding.revision,
        token_budget: 10000,
      },
    ),
  );
  assert.equal(changed.token_budget, 10000);
  const previous = (
    await pool.query(
      "SELECT token_budget,state FROM assistant_page_runs WHERE id=$1",
      [first.id],
    )
  ).rows[0];
  assert.equal(previous.token_budget, 5000);
  assert.equal(previous.state, "cancelled");
  const next = await transaction((db) =>
    queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, time, {
      kind: "background",
    }),
  );
  assert.equal(next?.token_budget, 10000);
});

test("concurrent due scans queue exactly once with references only and advance the schedule atomically", async () => {
  const f = await fixture();
  const results = await Promise.all([
    transaction((db) =>
      queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, time, {
        kind: "background",
      }),
    ),
    transaction((db) =>
      queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, time, {
        kind: "background",
      }),
    ),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const run = results.find(Boolean)!;
  assert.equal(run.binding_revision, 1);
  assert.equal(run.doc_version, 1);
  assert.equal(
    run.assistant_rules_revision,
    f.principal.assistant_rules_revision,
  );
  const serialized = JSON.stringify(run);
  for (const text of [
    "Private human material",
    "Selected summary",
    "Maintain only the summary",
  ])
    assert.ok(!serialized.includes(text));
  const row = (
    await pool.query(
      "SELECT next_run_at,schedule_exhausted FROM assistant_page_bindings WHERE id=$1",
      [f.binding.id],
    )
  ).rows[0];
  assert.equal(row.next_run_at.toISOString(), "2026-10-06T09:00:00.000Z");
  assert.equal(row.schedule_exhausted, false);
});

test("one lane claims a job and an expired lease cannot overwrite its replacement worker", async () => {
  const f = await fixture();
  const q = await queued(f);
  assert.equal(
    await transaction((db) => claimMaintainedPageRun(db, "overnight", time)),
    null,
  );
  const claims = await Promise.all([
    transaction((db) => claimMaintainedPageRun(db, "background", time)),
    transaction((db) => claimMaintainedPageRun(db, "background", time)),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean)!;
  assert.equal(first.id, q.id);
  await transaction((db) =>
    renewMaintainedPageRun(db, first.id, first.lease_token!, later(1000)),
  );
  const newClock = later(PAGE_RUN_LEASE_MS + 1001);
  const second = await transaction((db) =>
    claimMaintainedPageRun(db, "background", newClock),
  );
  assert.ok(second);
  assert.notEqual(second.lease_token, first.lease_token);
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(
        db,
        first.id,
        first.lease_token!,
        proposal,
        100,
        newClock,
      ),
    ),
    status(409),
  );
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      second.id,
      second.lease_token!,
      proposal,
      100,
      newClock,
    ),
  );
  const recovered = await transaction((db) =>
    guardMaintainedPageRun(db, second.id, second.lease_token!, newClock),
  );
  assert.deepEqual(recovered.run.proposal, proposal);
  assert.deepEqual(
    recovered.blocks.map((b) => b.id),
    ["summary"],
  );
});

test("generated work is staged once and guarded apply finishes the job and page in one transaction", async () => {
  const { run, doc, binding } = await claimed();
  await transaction((db) =>
    stageMaintainedPageRun(db, run.id, run.lease_token!, proposal, 123, time),
  );
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(db, run.id, run.lease_token!, proposal, 123, time),
    ),
    status(409),
  );
  const result = await transaction((db) =>
    applyMaintainedPageRun(db, run.id, run.lease_token!, time),
  );
  assert.equal(result.doc.version, doc.version + 1);
  assert.equal(result.binding.revision, binding.revision + 1);
  assert.equal(
    (
      await pool.query("SELECT state FROM assistant_page_runs WHERE id=$1", [
        run.id,
      ])
    ).rows[0].state,
    "done",
  );
  const content = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [doc.id])
  ).rows[0].content;
  assert.equal(content[0].text, "Private human material.");
  assert.equal(content[1].text, "Generated update.");
  await assert.rejects(
    transaction((db) =>
      applyMaintainedPageRun(db, run.id, run.lease_token!, time),
    ),
    status(409),
  );
});

test("a finished schedule still executes its final queued occurrence", async () => {
  const f = await fixture("FREQ=DAILY;UNTIL=20261005T090000Z");
  const q = await queued(f);
  const b = (
    await pool.query(
      "SELECT paused,schedule_exhausted FROM assistant_page_bindings WHERE id=$1",
      [f.binding.id],
    )
  ).rows[0];
  assert.equal(b.paused, false);
  assert.equal(b.schedule_exhausted, true);
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time),
  );
  assert.equal(run?.id, q.id);
  await transaction((db) =>
    stageMaintainedPageRun(db, run!.id, run!.lease_token!, proposal, 10, time),
  );
  await transaction((db) =>
    applyMaintainedPageRun(db, run!.id, run!.lease_token!, time),
  );
  assert.equal(
    await transaction((db) =>
      queueMaintainedPageRun(
        db,
        f.user,
        f.principal,
        f.binding.id,
        later(86400000),
        { kind: "background" },
      ),
    ),
    null,
  );
});

test("binding edits invalidate in-flight work and delete generated results before any worker can publish", async () => {
  const f = await claimed();
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      f.run.id,
      f.run.lease_token!,
      proposal,
      10,
      time,
    ),
  );
  await transaction((db) =>
    updateMaintainedPageBinding(
      db,
      f.user,
      f.principal,
      f.doc.id,
      f.binding.id,
      { ...f.input, expected_revision: 1, instruction: "A new instruction." },
    ),
  );
  const row = (
    await pool.query(
      "SELECT state,proposal,lease_token FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(row.state, "cancelled");
  assert.equal(row.proposal, null);
  assert.equal(row.lease_token, null);
  await assert.rejects(
    transaction((db) =>
      applyMaintainedPageRun(db, f.run.id, f.run.lease_token!, time),
    ),
    status(409),
  );
});

test("grant rules captured at queue time cannot be refreshed away before model/staging/approval", async () => {
  const f = await claimed();
  await pool.query(
    "UPDATE agent_grants SET assistant_rules_revision=assistant_rules_revision+1 WHERE id=$1",
    [f.principal.grant_id],
  );
  await assert.rejects(
    transaction((db) =>
      guardMaintainedPageRun(db, f.run.id, f.run.lease_token!, time),
    ),
    status(403),
  );
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(
        db,
        f.run.id,
        f.run.lease_token!,
        proposal,
        10,
        time,
      ),
    ),
    status(403),
  );
  assert.equal(
    (
      await pool.query("SELECT proposal FROM assistant_page_runs WHERE id=$1", [
        f.run.id,
      ])
    ).rows[0].proposal,
    null,
  );
});

test("page and grant revocation prevent storing or applying generated results", async () => {
  const f = await claimed();
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [f.doc.id]);
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(
        db,
        f.run.id,
        f.run.lease_token!,
        proposal,
        10,
        time,
      ),
    ),
    status(409),
  );
  await pool.query("UPDATE agent_grants SET suspended_at=now() WHERE id=$1", [
    f.principal.grant_id,
  ]);
  await assert.rejects(
    transaction((db) =>
      guardMaintainedPageRun(db, f.run.id, f.run.lease_token!, time),
    ),
    status(403),
  );
});

test("a stale approval card cannot answer a later prompt and approval remains bound to current source/rules", async () => {
  const f = await claimed();
  await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
    f.principal.grant_id,
  ]);
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      f.run.id,
      f.run.lease_token!,
      proposal,
      10,
      time,
    ),
  );
  let review: any;
  try {
    await transaction((db) =>
      applyMaintainedPageRun(db, f.run.id, f.run.lease_token!, time),
    );
  } catch (error) {
    review = error;
  }
  assert.ok(review);
  const waitingId = await transaction((db) =>
    waitMaintainedPageRun(db, f.run.id, f.run.lease_token!, review, time),
  );
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(
        db,
        f.user.id,
        f.run.id,
        randomUUID(),
        true,
        time,
      ),
    ),
    status(409),
  );
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(
        db,
        randomUUID(),
        f.run.id,
        waitingId,
        true,
        time,
      ),
    ),
    status(404),
  );
  await pool.query("UPDATE assistant_page_runs SET attempts=5 WHERE id=$1", [
    f.run.id,
  ]);
  await transaction((db) =>
    decideMaintainedPageRun(db, f.user.id, f.run.id, waitingId, true, time),
  );
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(db, f.user.id, f.run.id, waitingId, true, time),
    ),
    status(409),
  );
  const decided = (
    await pool.query(
      "SELECT state,proposal,reviewed FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(decided.state, "done");
  assert.equal(decided.reviewed, true);
  assert.deepEqual(decided.proposal, proposal);
  assert.equal(
    await transaction((db) => claimMaintainedPageRun(db, "background", time)),
    null,
  );
});

test("night ownership keeps page work out of the background lane and night deadlines are enforced", async () => {
  const f = await fixture();
  await pool.query(
    `INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2::jsonb)
    ON CONFLICT(user_id) DO UPDATE SET night_shift=excluded.night_shift`,
    [
      f.user.id,
      JSON.stringify({
        ...defaultNightShift(),
        enabled: true,
        start: "08:00",
        end: "10:00",
      }),
    ],
  );
  assert.equal(
    await transaction((db) =>
      queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, time, {
        kind: "background",
      }),
    ),
    null,
  );
  const night = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,'2026-10-05') RETURNING id",
      [f.user.id],
    )
  ).rows[0].id;
  const q = await transaction((db) =>
    queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, time, {
      kind: "overnight",
      nightId: night,
      endAt: later(30000),
    }),
  );
  assert.ok(q);
  assert.equal(
    await transaction((db) => claimMaintainedPageRun(db, "background", time)),
    null,
  );
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "overnight", time),
  );
  assert.ok(run);
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(
        db,
        run!.id,
        run!.lease_token!,
        proposal,
        10,
        later(30000),
      ),
    ),
    status(409),
  );
});

test("generated output is bounded by target ownership and token budget", async () => {
  const f = await claimed();
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(
        db,
        f.run.id,
        f.run.lease_token!,
        {
          expected_revision: 1,
          replacements: [
            { id: "human", type: "paragraph", text: "Not owned." },
          ],
        },
        10,
        time,
      ),
    ),
    status(409),
  );
  await assert.rejects(
    transaction((db) =>
      stageMaintainedPageRun(
        db,
        f.run.id,
        f.run.lease_token!,
        proposal,
        20001,
        time,
      ),
    ),
    status(409),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT proposal,token_estimate FROM assistant_page_runs WHERE id=$1",
        [f.run.id],
      )
    ).rows[0].token_estimate,
    0,
  );
});

test("expired night/review work releases its schedule and removes staged private output", async () => {
  const f = await claimed();
  await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
    f.principal.grant_id,
  ]);
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      f.run.id,
      f.run.lease_token!,
      proposal,
      10,
      time,
    ),
  );
  let error: unknown;
  try {
    await transaction((db) =>
      applyMaintainedPageRun(db, f.run.id, f.run.lease_token!, time),
    );
  } catch (e) {
    error = e;
  }
  const waitingId = await transaction((db) =>
    waitMaintainedPageRun(db, f.run.id, f.run.lease_token!, error, time),
  );
  await transaction((db) =>
    expireMaintainedPageRuns(db, "background", later(7 * 86400000)),
  );
  const saved = (
    await pool.query(
      "SELECT state,proposal,waiting_id FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(saved.state, "cancelled");
  assert.equal(saved.proposal, null);
  assert.equal(saved.waiting_id, null);
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(
        db,
        f.user.id,
        f.run.id,
        waitingId,
        true,
        later(7 * 86400000),
      ),
    ),
    status(409),
  );
});

test("a replaced worker cannot terminate its successor, while a current failure clears output", async () => {
  const f = await claimed();
  const now = later(PAGE_RUN_LEASE_MS + 1);
  const successor = await transaction((db) =>
    claimMaintainedPageRun(db, "background", now),
  );
  assert.ok(successor?.lease_token);
  assert.equal(
    await transaction((db) =>
      failMaintainedPageRun(
        db,
        f.run.id,
        f.run.lease_token!,
        "provider_failed",
        now,
      ),
    ),
    false,
  );
  assert.equal(
    await transaction((db) =>
      failMaintainedPageRun(
        db,
        f.run.id,
        successor!.lease_token!,
        "provider_failed",
        now,
      ),
    ),
    true,
  );
  assert.equal(
    (
      await pool.query("SELECT state FROM assistant_page_runs WHERE id=$1", [
        f.run.id,
      ])
    ).rows[0].state,
    "failed",
  );
});

test("forbidden updates cannot queue or expose model context after authority changes", async () => {
  const f = await fixture();
  const rule = {
    id: randomUUID(),
    lane: "background",
    action: "edit",
    scope: { kind: "personal" },
    decision: "deny",
  };
  await pool.query(
    "UPDATE agent_grants SET assistant_rules=$2::jsonb WHERE id=$1",
    [f.principal.grant_id, JSON.stringify([rule])],
  );
  await assert.rejects(() => queued(f), status(403));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_page_runs WHERE binding_id=$1",
        [f.binding.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT next_run_at FROM assistant_page_bindings WHERE id=$1",
        [f.binding.id],
      )
    ).rows[0].next_run_at.toISOString(),
    time.toISOString(),
  );
  await pool.query(
    "UPDATE agent_grants SET assistant_rules='[]'::jsonb WHERE id=$1",
    [f.principal.grant_id],
  );
  const q = await queued(f);
  await pool.query(
    "UPDATE agent_grants SET assistant_rules=$2::jsonb WHERE id=$1",
    [f.principal.grant_id, JSON.stringify([rule])],
  );
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time, q.id),
  );
  assert.ok(run?.lease_token);
  await assert.rejects(
    transaction((db) =>
      guardMaintainedPageRun(db, run!.id, run!.lease_token!, time),
    ),
    status(403),
  );
  assert.equal(
    (
      await pool.query("SELECT proposal FROM assistant_page_runs WHERE id=$1", [
        run!.id,
      ])
    ).rows[0].proposal,
    null,
  );
});

test("page claims and chat claims share background capacity without consuming interactive slots", async () => {
  const first = await fixture();
  const second = await fixture();
  const third = await fixture();
  const runs = await Promise.all([
    queued(first),
    queued(second),
    queued(third),
  ]);
  const claimedPages = await Promise.all(
    runs.map((run) =>
      transaction((db) =>
        claimMaintainedPageRun(db, "background", time, run.id),
      ),
    ),
  );
  assert.equal(claimedPages.filter(Boolean).length, 2);
  // These fixture claims use a fixed schedule clock; the chat runner uses wall
  // time. Keep their leases live for the same duration on the runner's clock.
  await pool.query(
    "UPDATE assistant_page_runs SET lease_expires_at=clock_timestamp()+($2 * interval '1 millisecond') WHERE id=ANY($1::uuid[]) AND state='running'",
    [runs.map((run) => run.id), PAGE_RUN_LEASE_MS],
  );
  const { initialAssistantRun } =
    await import("../src/modules/ai/agent/run.js");
  const { claimAssistantJob } =
    await import("../src/modules/ai/agent/runner.js");
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Shared capacity') RETURNING id",
      [first.user.id],
    )
  ).rows[0];
  const enqueue = async (background: boolean) => {
    const checkpoint = initialAssistantRun({
      chat_id: chat.id,
      turn_id: randomUUID(),
      message: "Test shared slots",
      timezone: "UTC",
      history: [],
      scope: null,
      ...(background ? { automation: { kind: "idea" as const } } : {}),
    });
    return (
      await pool.query(
        "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_state) VALUES($1,$2,$3,'queued',$4) RETURNING id",
        [
          first.user.id,
          chat.id,
          checkpoint.request.turn_id,
          JSON.stringify(checkpoint),
        ],
      )
    ).rows[0];
  };
  await enqueue(true);
  assert.equal(
    await claimAssistantJob("background-overflow", "background"),
    null,
  );
  const interactive = await enqueue(false);
  assert.equal(
    (await claimAssistantJob("interactive-room", "interactive"))?.id,
    interactive.id,
  );
  await pool.query(
    "UPDATE assistant_page_runs SET lease_expires_at=now()-interval '1 second' WHERE id=ANY($1::uuid[]) AND state='running'",
    [runs.map((r) => r.id)],
  );
  assert.ok(await claimAssistantJob("background-after-expiry", "background"));
});

test("leased chat automation prevents a page claim until its lane has room", async () => {
  const f = await fixture();
  const run = await queued(f);
  const { initialAssistantRun } =
    await import("../src/modules/ai/agent/run.js");
  for (let i = 0; i < 2; i++) {
    const chat = (
      await pool.query(
        "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Occupied background') RETURNING id",
        [f.user.id],
      )
    ).rows[0];
    const checkpoint = initialAssistantRun({
      chat_id: chat.id,
      turn_id: randomUUID(),
      message: "Occupied",
      timezone: "UTC",
      history: [],
      scope: null,
      automation: { kind: "idea" },
    });
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_state,lease_until) VALUES($1,$2,$3,'running',$4,$5)",
      [
        f.user.id,
        chat.id,
        checkpoint.request.turn_id,
        JSON.stringify(checkpoint),
        later(60000),
      ],
    );
  }
  assert.equal(
    await transaction((db) =>
      claimMaintainedPageRun(db, "background", time, run.id),
    ),
    null,
  );
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',lease_until=NULL WHERE user_id=$1",
    [f.user.id],
  );
  assert.equal(
    (
      await transaction((db) =>
        claimMaintainedPageRun(db, "background", time, run.id),
      )
    )?.id,
    run.id,
  );
});

test("due producer queues once across replicas and leaves held/paused/future work unchanged", async () => {
  const { scanMaintainedPages } =
    await import("../src/worker/maintained-page-scan.js");
  const due = await fixture();
  const future = await fixture();
  const paused = await fixture();
  const suspended = await fixture();
  const stale = await fixture();
  await pool.query(
    "UPDATE assistant_page_bindings SET next_run_at=$2 WHERE id=$1",
    [future.binding.id, later(60000)],
  );
  await pool.query(
    "UPDATE assistant_page_bindings SET paused=true WHERE id=$1",
    [paused.binding.id],
  );
  await pool.query("UPDATE agent_grants SET suspended_at=$2 WHERE id=$1", [
    suspended.principal.grant_id,
    time,
  ]);
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [
    stale.doc.id,
  ]);
  const only = [due, future, paused, suspended, stale].map((f) => f.user.id);
  const counts = await Promise.all([
    scanMaintainedPages(time, { only }),
    scanMaintainedPages(time, { only }),
  ]);
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    1,
  );
  const runs = await pool.query(
    "SELECT binding_id FROM assistant_page_runs WHERE user_id=ANY($1::uuid[])",
    [only],
  );
  assert.deepEqual(
    runs.rows.map((r) => r.binding_id),
    [due.binding.id],
  );
  const unchanged = await pool.query(
    "SELECT next_run_at FROM assistant_page_bindings WHERE id=$1",
    [stale.binding.id],
  );
  assert.equal(unchanged.rows[0].next_run_at.toISOString(), time.toISOString());
  assert.equal(await scanMaintainedPages(time, { only }), 0);
});

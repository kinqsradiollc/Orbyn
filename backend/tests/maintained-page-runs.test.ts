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
  await pool.query(
    "UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,waiting_id=NULL WHERE user_id=ANY($1::uuid[]) AND state IN ('queued','running','waiting')",
    [people],
  );
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [people]);
  await pool.end();
});
async function fixture(rule = "FREQ=DAILY") {
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

test("a queued action that was already forbidden cannot expose context to a model worker", async () => {
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
  await queued(f);
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time),
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

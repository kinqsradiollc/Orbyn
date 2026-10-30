import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  markAssistantApplyStarted,
  reconcileAssistantApply,
  withAssistantApplyTransaction,
  AssistantApplyRollbackUncertain,
} = await import("../src/modules/ai/agent/effect-reconciliation.js");
const { AssistantLeaseLost, withAssistantLease } =
  await import("../src/modules/ai/agent/lease.js");
const owners: string[] = [];
const applied = {
  applied: true,
  structured: {
    status: "done",
    job: "plan_fixture",
    steps: [],
    pending: null,
  },
  why: [],
};
const pending = {
  applied: false,
  structured: {
    status: "pending_review",
    job: "plan_fixture",
    steps: [],
    pending: {
      status: "pending_review",
      proposal_id: "proposal:fixture",
      review_url: "/review",
      expires_at: "2050-01-03T00:00:00Z",
      changes: 1,
    },
  },
  why: ["Review required"],
};

before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});

async function fixture(tracking: 1 | null = 1) {
  const owner = randomUUID(),
    chat = randomUUID(),
    job = randomUUID(),
    claimant = `fixture-${randomUUID()}`;
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'fixture','Apply evidence fixture')",
    [owner, `${owner}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Private apply result')",
    [chat, owner],
  );
  await pool.query(
    `INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,sources_checked,claimed_by,lease_until,apply_tracking_version)
     VALUES($1,$2,$3,$4,'running',true,$5,now()+interval '5 minutes',$6)`,
    [job, owner, chat, randomUUID(), claimant, tracking],
  );
  const mark = () =>
    withAssistantLease(job, claimant, () =>
      transaction((db) => markAssistantApplyStarted(db, job, owner)),
    );
  const reconcile = (knownNotStarted = false) =>
    withAssistantLease(job, claimant, () =>
      reconcileAssistantApply(job, owner, { knownNotStarted }),
    );
  return { owner, chat, job, claimant, mark, reconcile };
}

test("only live tracked no-start evidence qualifies none; legacy, marked, malformed and missing evidence remain unknown", async () => {
  const fresh = await fixture();
  assert.deepEqual(await fresh.reconcile(), {
    kind: "unknown",
    reason: "missing_receipt",
  });
  assert.deepEqual(await fresh.reconcile(true), { kind: "none" });
  const legacy = await fixture(null);
  assert.deepEqual(await legacy.reconcile(true), {
    kind: "unknown",
    reason: "missing_receipt",
  });
  await fresh.mark();
  const first = (
    await pool.query("SELECT apply_started_at FROM ai_jobs WHERE id=$1", [
      fresh.job,
    ])
  ).rows[0].apply_started_at;
  await fresh.mark();
  assert.equal(
    (
      await pool.query("SELECT apply_started_at FROM ai_jobs WHERE id=$1", [
        fresh.job,
      ])
    ).rows[0].apply_started_at.getTime(),
    first.getTime(),
  );
  assert.deepEqual(await fresh.reconcile(true), {
    kind: "unknown",
    reason: "missing_receipt",
  });
  for (const receipt of [
    {},
    { applied: false, structured: null, why: [] },
    { ...pending, applied: true },
    { ...applied, why: "invalid" },
  ]) {
    await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
      fresh.job,
      receipt,
    ]);
    assert.deepEqual(await fresh.reconcile(true), {
      kind: "unknown",
      reason: "invalid_receipt",
    });
  }
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [fresh.job]);
  assert.deepEqual(await fresh.reconcile(true), {
    kind: "unknown",
    reason: "missing_job",
  });
});

test("marked effects and their receipt commit atomically; existing atomic old writer is rejected on an unmarked tracked job", async () => {
  const f = await fixture();
  const item = randomUUID();
  const write = () =>
    transaction(async (db) => {
      await db.query(
        "INSERT INTO items(id,user_id,title) VALUES($1,$2,'Atomic fixture effect')",
        [item, f.owner],
      );
      await db.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
        f.job,
        applied,
      ]);
    });
  await assert.rejects(write(), /ai_jobs_tracked_apply_marker/);
  assert.equal(
    (await pool.query("SELECT id FROM items WHERE id=$1", [item])).rowCount,
    0,
    "receipt constraint rejection rolls the whole effect transaction back",
  );
  assert.deepEqual(await f.reconcile(true), { kind: "none" });
  await f.mark();
  await write();
  assert.equal(
    (await pool.query("SELECT id FROM items WHERE id=$1", [item])).rowCount,
    1,
  );
  assert.deepEqual(await f.reconcile(), {
    kind: "receipt",
    effect: "applied",
    receipt: applied,
  });
  await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
    f.job,
    pending,
  ]);
  assert.deepEqual(await f.reconcile(), {
    kind: "receipt",
    effect: "pending_review",
    receipt: pending,
  });
  // Migration compatibility: old jobs keep their old writer contract, but
  // absence of their receipt never becomes a new positive no-write signal.
  const legacy = await fixture(null);
  await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
    legacy.job,
    applied,
  ]);
  assert.equal((await legacy.reconcile()).kind, "receipt");
});

test("reconciliation observes a same-job commit even when its caller loses the acknowledgement", async () => {
  const f = await fixture();
  await f.mark();
  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("SELECT id FROM ai_jobs WHERE id=$1 FOR UPDATE", [
      f.job,
    ]);
    await writer.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
      f.job,
      applied,
    ]);
    // The helper serializes on the same row as the effect transaction.
    const observation = f.reconcile();
    await assert.rejects(
      (async () => {
        await writer.query("COMMIT");
        throw new Error("Synthetic lost acknowledgement after commit");
      })(),
      /Synthetic lost acknowledgement/,
    );
    assert.deepEqual(await observation, {
      kind: "receipt",
      effect: "applied",
      receipt: applied,
    });
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
  }
});

test("owner, current job sources, chat authority and current lease gate all receipt contents", async () => {
  const f = await fixture();
  await f.mark();
  await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
    f.job,
    applied,
  ]);
  assert.deepEqual(await reconcileAssistantApply(f.job, randomUUID()), {
    kind: "unknown",
    reason: "missing_job",
  });
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [f.job, randomUUID()],
  );
  assert.deepEqual(await f.reconcile(), {
    kind: "unknown",
    reason: "restricted",
  });
  await pool.query("DELETE FROM assistant_job_sources WHERE job_id=$1", [
    f.job,
  ]);
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [f.chat, randomUUID(), randomUUID()],
  );
  assert.deepEqual(await f.reconcile(), {
    kind: "unknown",
    reason: "restricted",
  });
  await pool.query("DELETE FROM assistant_chat_sources WHERE chat_id=$1", [
    f.chat,
  ]);
  await assert.rejects(
    withAssistantLease(f.job, "stale-claimant", () =>
      reconcileAssistantApply(f.job, f.owner),
    ),
    AssistantLeaseLost,
  );
  await assert.rejects(
    withAssistantLease(f.job, "stale-claimant", () =>
      transaction((db) => markAssistantApplyStarted(db, f.job, f.owner)),
    ),
    AssistantLeaseLost,
  );
  await pool.query("UPDATE ai_jobs SET state='queued' WHERE id=$1", [f.job]);
  await assert.rejects(
    reconcileAssistantApply(f.job, f.owner),
    AssistantLeaseLost,
    "legacy no-context calls still cannot continue a queued/stopped job",
  );
});

test("query failure stays unknown and terminal metadata enforces only its server identity envelope", async () => {
  const f = await fixture();
  const realConnect = pool.connect;
  try {
    pool.connect = (async () => {
      throw new Error("Synthetic unavailable primary");
    }) as typeof pool.connect;
    assert.deepEqual(await f.reconcile(true), {
      kind: "unknown",
      reason: "unavailable",
    });
  } finally {
    pool.connect = realConnect;
  }
  for (const evidence of [
    [],
    { version: 1 },
    { version: 2, job_id: f.job },
    { version: 1, job_id: randomUUID() },
  ])
    await assert.rejects(
      pool.query("UPDATE ai_jobs SET terminal_evidence=$2 WHERE id=$1", [
        f.job,
        evidence,
      ]),
      /ai_jobs_terminal_evidence_identity/,
    );
  await pool.query("UPDATE ai_jobs SET terminal_evidence=$2 WHERE id=$1", [
    f.job,
    { version: 1, job_id: f.job },
  ]);
  assert.deepEqual(await f.reconcile(true), { kind: "none" });
});

test("acknowledged pre-commit rollback preserves error identity and qualifies only its marker; a fresh attempt clears proof", async () => {
  const f = await fixture();
  const item = randomUUID();
  class ApprovalFixture extends Error {}
  const original = new ApprovalFixture("Ask before this change");
  await assert.rejects(
    withAssistantLease(f.job, f.claimant, () =>
      withAssistantApplyTransaction(f.job, f.owner, async (db) => {
        await db.query(
          "INSERT INTO items(id,user_id,title) VALUES($1,$2,'Rolled back fixture')",
          [item, f.owner],
        );
        throw original;
      }),
    ),
    (error) => error === original,
    "the exact AskFirst-shaped error must survive a proven rollback",
  );
  assert.equal(
    (await pool.query("SELECT id FROM items WHERE id=$1", [item])).rowCount,
    0,
  );
  const proof = (
    await pool.query(
      "SELECT apply_started_at::text AS marker,apply_rolled_back_at>=apply_started_at AS rolled_back FROM ai_jobs WHERE id=$1",
      [f.job],
    )
  ).rows[0];
  assert.equal(proof.rolled_back, true);
  assert.deepEqual(await f.reconcile(), { kind: "none" });
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
      f.job,
      applied,
    ]),
    /ai_jobs_apply_rollback_proof/,
  );
  const renewed = await f.mark();
  assert.ok(Number.isFinite(Date.parse(renewed)));
  const fresh = (
    await pool.query(
      "SELECT apply_started_at::text AS marker,apply_rolled_back_at,apply_started_at>$2::timestamptz AS renewed FROM ai_jobs WHERE id=$1",
      [f.job, proof.marker],
    )
  ).rows[0];
  assert.equal(fresh.renewed, true);
  assert.equal(fresh.apply_rolled_back_at, null);
  assert.deepEqual(await f.reconcile(true), {
    kind: "unknown",
    reason: "missing_receipt",
  });
  const value = await withAssistantLease(f.job, f.claimant, () =>
    withAssistantApplyTransaction(f.job, f.owner, async (db) => {
      await db.query(
        "INSERT INTO items(id,user_id,title) VALUES($1,$2,'Fresh committed fixture')",
        [item, f.owner],
      );
      await db.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
        f.job,
        applied,
      ]);
      return "committed";
    }),
  );
  assert.equal(value, "committed");
  assert.equal((await f.reconcile()).kind, "receipt");
});

test("a lost COMMIT acknowledgement never writes negative proof even when a later ROLLBACK acknowledges", async () => {
  const f = await fixture();
  const original = new Error("Synthetic lost commit acknowledgement");
  const realConnect = pool.connect;
  let connections = 0;
  try {
    pool.connect = (async () => {
      const client = await realConnect.call(pool);
      if (++connections === 2) {
        const originalQuery = client.query;
        const query = client.query.bind(client);
        const release = client.release.bind(client);
        client.query = (async (...args: unknown[]) => {
          const result = await (
            query as (...args: unknown[]) => Promise<unknown>
          )(...args);
          if (args[0] === "COMMIT") throw original;
          return result;
        }) as typeof client.query;
        client.release = (error) => {
          client.query = originalQuery;
          release(error);
        };
      }
      return client;
    }) as typeof pool.connect;
    await assert.rejects(
      withAssistantLease(f.job, f.claimant, () =>
        withAssistantApplyTransaction(f.job, f.owner, async (db) => {
          await db.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
            f.job,
            applied,
          ]);
        }),
      ),
      (error) => error === original,
    );
  } finally {
    pool.connect = realConnect;
  }
  assert.equal(
    (
      await pool.query("SELECT apply_rolled_back_at FROM ai_jobs WHERE id=$1", [
        f.job,
      ])
    ).rows[0].apply_rolled_back_at,
    null,
  );
  assert.equal((await f.reconcile()).kind, "receipt");
});

for (const boundary of ["rollback", "proof", "marker"] as const)
  test(`failed ${boundary} cannot preserve an approval-shaped error as negative proof`, async () => {
    const f = await fixture();
    const original = new Error("Ask before applying");
    const realConnect = pool.connect;
    let connections = 0;
    let discarded = false;
    try {
      pool.connect = (async () => {
        const next = ++connections;
        if (boundary === "proof" && next === 3)
          throw new Error("Synthetic unavailable proof transaction");
        const client = await realConnect.call(pool);
        if (boundary === "marker" && next === 3)
          await client.query(
            "UPDATE ai_jobs SET apply_started_at=apply_started_at+interval '1 second' WHERE id=$1",
            [f.job],
          );
        if (boundary === "rollback" && next === 2) {
          const originalQuery = client.query;
          const query = client.query.bind(client);
          const release = client.release.bind(client);
          client.query = ((...args: unknown[]) => {
            if (args[0] === "ROLLBACK")
              return Promise.reject(new Error("Synthetic rollback failure"));
            return (query as (...args: unknown[]) => unknown)(...args);
          }) as typeof client.query;
          client.release = (error) => {
            discarded = error instanceof Error;
            client.query = originalQuery;
            release(error);
          };
        }
        return client;
      }) as typeof pool.connect;
      await assert.rejects(
        withAssistantLease(f.job, f.claimant, () =>
          withAssistantApplyTransaction(f.job, f.owner, async () => {
            throw original;
          }),
        ),
        (error) =>
          error instanceof AssistantApplyRollbackUncertain &&
          error !== original,
      );
    } finally {
      pool.connect = realConnect;
    }
    if (boundary === "rollback") assert.equal(discarded, true);
    assert.deepEqual(await f.reconcile(true), {
      kind: "unknown",
      reason: "missing_receipt",
    });
    assert.equal(
      (
        await pool.query(
          "SELECT apply_rolled_back_at FROM ai_jobs WHERE id=$1",
          [f.job],
        )
      ).rows[0].apply_rolled_back_at,
      null,
    );
  });

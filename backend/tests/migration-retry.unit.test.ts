import { test } from "node:test";
import assert from "node:assert/strict";
import { retryMigrationTransaction } from "../src/db/migration-retry.js";
import { lockMigrationJobTable } from "../src/db/migration-locks.js";

for (const [name, sql, present, expected] of [
  ["unrelated batch", ["ALTER TABLE docs ADD COLUMN fixture int"], true, []],
  ["empty batch", [], true, []],
  [
    "existing job table",
    ["ALTER TABLE ai_jobs ADD COLUMN fixture int"],
    true,
    [
      "SELECT to_regclass('ai_jobs') IS NOT NULL AS present",
      "LOCK TABLE ai_jobs IN ACCESS EXCLUSIVE MODE",
    ],
  ],
  [
    "fresh bootstrap",
    ["CREATE TABLE ai_jobs(id uuid)"],
    false,
    ["SELECT to_regclass('ai_jobs') IS NOT NULL AS present"],
  ],
] as const) {
  test(`migration prelock: ${name}`, async () => {
    const queries: string[] = [];
    const db = {
      query: async (text: string) => {
        queries.push(text);
        return { rows: [{ present }] };
      },
    };
    await lockMigrationJobTable(db as any, [...sql]);
    assert.deepEqual(queries, expected);
  });
}

test("successful migration transaction executes once", async () => {
  let calls = 0;
  await retryMigrationTransaction(async () => {
    calls++;
  });
  assert.equal(calls, 1);
});

test("deadlock retries the entire transaction after rollback and succeeds", async () => {
  const events: string[] = [];
  let calls = 0;
  await retryMigrationTransaction(
    async () => {
      calls++;
      events.push(`begin${calls}`, `ddl${calls}`);
      if (calls === 1) {
        events.push("rollback1");
        throw Object.assign(new Error("deadlock"), { code: "40P01" });
      }
      events.push("commit2");
    },
    {
      wait: async (ms) => {
        events.push(`wait${ms}`);
      },
      report: (attempt) => {
        events.push(`report${attempt}`);
      },
    },
  );
  assert.deepEqual(events, [
    "begin1",
    "ddl1",
    "rollback1",
    "report1",
    "wait250",
    "begin2",
    "ddl2",
    "commit2",
  ]);
});

test("persistent migration deadlock stops after three complete attempts", async () => {
  let calls = 0;
  const waits: number[] = [];
  const error = Object.assign(new Error("persistent deadlock"), {
    code: "40P01",
  });
  await assert.rejects(
    retryMigrationTransaction(
      async () => {
        calls++;
        throw error;
      },
      {
        wait: async (ms) => {
          waits.push(ms);
        },
      },
    ),
    (actual) => actual === error,
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 500]);
});

for (const code of ["42601", "23505", "08006", "40001", "55P03", undefined]) {
  test(`migration error ${code ?? "without SQLSTATE"} is not retried`, async () => {
    let calls = 0;
    const error = Object.assign(new Error("not a deadlock"), { code });
    await assert.rejects(
      retryMigrationTransaction(
        async () => {
          calls++;
          throw error;
        },
        {
          wait: async () => {
            assert.fail("Unexpected retry");
          },
        },
      ),
      (actual) => actual === error,
    );
    assert.equal(calls, 1);
  });
}

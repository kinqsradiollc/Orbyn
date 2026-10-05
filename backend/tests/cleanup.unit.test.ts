import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupFixtures } from "./cleanup.js";

test("fixture cleanup closes later resources and retains original failures", async () => {
  const databaseError = new Error("Database recovery");
  const closeError = new Error("Close failed");
  const calls: number[] = [];
  await assert.rejects(
    cleanupFixtures([
      () => {
        calls.push(1);
        throw databaseError;
      },
      async () => {
        calls.push(2);
        throw closeError;
      },
      () => {
        calls.push(3);
      },
      async () => {
        calls.push(4);
      },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [databaseError, closeError]);
      return true;
    },
  );
  assert.deepEqual(calls, [1, 2, 3, 4]);
});

test("fixture cleanup awaits each successful close in order", async () => {
  const calls: number[] = [];
  await cleanupFixtures([
    async () => {
      await Promise.resolve();
      calls.push(1);
    },
    () => {
      calls.push(2);
    },
  ]);
  assert.deepEqual(calls, [1, 2]);
});

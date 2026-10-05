import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { completeFeature } from "../src/modules/ai/providers/feature-call.js";
import { closeDatabase, pool } from "../src/db/pool.js";

// Every case rejects before acquiring a connection or sending any prompt.
after(() => closeDatabase());
const owner = randomUUID();
const page = { kind: "doc" as const, id: randomUUID(), version: 1 };
const messages = [
  { role: "user" as const, content: "Local fixture transcript" },
];

test("a recording summary requires its file and exactly one source page", async () => {
  for (const sources of [
    [],
    [page],
    [{ kind: "team" as const, id: randomUUID() }],
    [
      { ...page, recording_file_id: randomUUID() },
      { ...page, id: randomUUID() },
    ],
  ]) {
    await assert.rejects(
      completeFeature(owner, "recording_summary", sources, messages),
      (error: any) => error.statusCode === 400,
    );
  }
  assert.equal(pool.totalCount, 0);
});

test("other feature kinds cannot borrow recording-specific source authority", async () => {
  await assert.rejects(
    completeFeature(
      owner,
      "doc_ask",
      [{ ...page, recording_file_id: randomUUID() }],
      messages,
    ),
    (error: any) => error.statusCode === 400,
  );
  assert.equal(pool.totalCount, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
const { modelSnapshot, localIso } =
  await import("../src/modules/ai/snapshot.js");

test("the model sees local times and only the fields it needs", () => {
  const [item] = modelSnapshot(
    [
      {
        id: "a",
        version: 2,
        title: "Test",
        user_id: "secret-owner",
        created_at: new Date(),
        due_at: new Date("2026-09-27T02:45:00Z"),
        end_at: null,
        status: "done",
      },
    ],
    "Australia/Melbourne",
  );
  assert.equal(item.due_at, "2026-09-27T12:45:00+10:00");
  assert.equal(item.end_at, null);
  assert.equal("user_id" in item, false);
  assert.equal("created_at" in item, false);
  assert.equal(
    localIso("2027-01-08T07:00:00Z", "Australia/Melbourne"),
    "2027-01-08T18:00:00+11:00",
  );
  assert.equal(
    localIso("2026-09-27T02:45:00Z", "UTC"),
    "2026-09-27T02:45:00+00:00",
  );
});

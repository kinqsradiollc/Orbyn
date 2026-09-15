import { test } from "node:test";
import assert from "node:assert/strict";
// Pure unit tests for the AI plumbing: no database, network, or provider needed.
const { parseReply } = await import("../src/modules/ai/replySchema.js");
const { localTimeContext } = await import("../src/modules/ai/prompt.js");
const { localIso } = await import("../src/modules/ai/snapshot.js");

const reply = { summary: "Your week is clear.", actions: [] };

test("parses plain, fenced, and reasoning-prefixed replies", () => {
  for (const content of [
    JSON.stringify(reply),
    "```json\n" + JSON.stringify(reply) + "\n```",
    "<think>Let me check the planner first.</think>\n" + JSON.stringify(reply),
    "Here is the plan:\n" + JSON.stringify(reply) + "\nLet me know!",
  ])
    assert.deepEqual(parseReply(content), reply);
});

test("unwraps a small model echoing the JSON schema around its answer", () => {
  // Observed from a 9B local model: the answer nested under "properties".
  const echoed = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: reply,
    required: ["summary", "actions"],
  };
  assert.deepEqual(parseReply(JSON.stringify(echoed)), reply);
});

test("rejects replies that are not a valid plan", () => {
  assert.throws(() => parseReply("I can't help with that."));
  assert.throws(() =>
    parseReply(
      JSON.stringify({
        summary: "x",
        actions: [{ operation: "create", data: { title: "" } }],
      }),
    ),
  );
});

test("gives the model the local offset and upcoming daylight-saving changes", () => {
  // Melbourne is UTC+10 until the first Sunday of October 2026, then UTC+11.
  const melbourne = localTimeContext(
    "Australia/Melbourne",
    new Date("2026-09-14T08:00:00Z"),
  );
  assert.match(melbourne, /UTC\+10:00/);
  assert.match(melbourne, /2026-10-0\d the offset is \+11:00/);
  assert.match(
    localTimeContext("UTC", new Date("2026-09-14T08:00:00Z")),
    /stays \+00:00/,
  );
});

test("instants are shown as the user's wall-clock time with their offset", () => {
  assert.equal(
    localIso("2026-09-27T02:45:00Z", "Australia/Melbourne"),
    "2026-09-27T12:45:00+10:00",
  );
  assert.equal(
    localIso("2027-01-08T07:00:00Z", "Australia/Melbourne"),
    "2027-01-08T18:00:00+11:00",
  );
  assert.equal(
    localIso("2026-09-27T02:45:00Z", "UTC"),
    "2026-09-27T02:45:00+00:00",
  );
  assert.equal(localIso(null, "UTC"), null);
});

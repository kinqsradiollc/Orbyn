import { test } from "node:test";
import assert from "node:assert/strict";
// Pure unit tests for the AI plumbing: no database or provider needed.
process.env.AI_MODEL ||= "unit-test";
const { parseReply } = await import("../src/modules/ai/provider.js");
const { localTimeContext, systemPrompt } =
  await import("../src/modules/ai/prompt.js");

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
  assert.match(systemPrompt("UTC"), /do not repeat the schema/);
});

test("provider retries share one deadline instead of outlasting the client", async (t) => {
  const { askProvider } = await import("../src/modules/ai/provider.js");
  const deadlines: AbortSignal[] = [];
  const controller = new AbortController();
  let timeouts = 0;
  t.mock.method(AbortSignal, "timeout", () => {
    timeouts++;
    return controller.signal;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      deadlines.push(init.signal!);
      return deadlines.length === 1
        ? new Response("unavailable", { status: 503 })
        : Response.json({
            choices: [{ message: { content: JSON.stringify(reply) } }],
          });
    },
  );
  assert.deepEqual(await askProvider("Summarize", "UTC", []), reply);
  assert.equal(deadlines.length, 2);
  assert.equal(timeouts, 1);
  assert.equal(deadlines[0], deadlines[1]);
});

test("provider does not retry after the overall deadline expires", async (t) => {
  const { askProvider } = await import("../src/modules/ai/provider.js");
  const controller = new AbortController();
  let attempts = 0;
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    const error = new DOMException("Deadline expired", "TimeoutError");
    controller.abort(error);
    throw error;
  });
  await assert.rejects(
    askProvider("Summarize", "UTC", []),
    /could not return a valid plan/,
  );
  assert.equal(attempts, 1);
});

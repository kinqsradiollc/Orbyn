import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
const { REPLY_FORMAT, dropNulls } =
  await import("../src/modules/ai/replySchema.js");
const { parseReply, buildMessages } =
  await import("../src/modules/ai/provider.js");
const { complete } = await import("../src/modules/ai/providers/adapters.js");
const { AI_PROVIDERS } = await import("@orbyn/core");

test("Matilda is flagged for structured output; others are not", () => {
  assert.equal(AI_PROVIDERS.matilda.structuredOutput, "json_schema");
  assert.equal(AI_PROVIDERS.openai.structuredOutput, undefined);
  // Exactly the shape Matilda documents: no extra fields for its strict validator.
  assert.deepEqual(Object.keys(REPLY_FORMAT.json_schema), ["name", "schema"]);
});

test("a strict-schema reply with nulls parses, and defaults still apply", () => {
  const reply = parseReply(
    JSON.stringify({
      summary: "Added a call with Mum.",
      actions: [
        {
          operation: "create",
          item_id: null,
          version: null,
          data: {
            title: "Call Mum",
            notes: null,
            kind: "task",
            status: null,
            priority: null,
            due_at: "2026-09-18T18:00:00+10:00",
            end_at: null,
            reminder_minutes: null,
            team_id: null,
            progress: null,
          },
        },
      ],
    }),
  );
  const [action] = reply.actions;
  assert.equal(action.operation, "create");
  assert.equal("item_id" in action, false);
  assert.equal(action.data?.notes, "");
  assert.equal(action.data?.priority, "medium");
  assert.equal(action.data?.reminder_minutes, 30);
  assert.equal(action.data?.end_at, null);
  assert.deepEqual(dropNulls("plain text"), "plain text");
  // Strict-schema replies arrive as lines and are joined back into Markdown.
  const lined = parseReply(
    JSON.stringify({
      summary: [
        "Here's your week:",
        "",
        "- **Call Mum** on Friday",
        "- Dentist",
      ],
      actions: [],
    }),
  );
  assert.equal(
    lined.summary,
    "Here's your week:\n\n- **Call Mum** on Friday\n- Dentist",
  );
  // Matilda invents ids for new items, sometimes not valid UUIDs: dropped.
  const invented = parseReply(
    JSON.stringify({
      summary: "Added.",
      actions: [
        {
          operation: "create",
          item_id: "7c1f7a56-4c3e-4d8a-2b1e-not-a-uuid",
          version: 1,
          data: { title: "Call Mum", kind: "task" },
        },
      ],
    }),
  );
  assert.equal("item_id" in invented.actions[0], false);
  assert.equal("version" in invented.actions[0], false);
});

test("only providers with structured output receive the reply schema", async () => {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const base = {
    format: "openai" as const,
    baseUrl,
    apiKey: "",
    model: "m",
    options: {},
    source: "database" as const,
  };
  const messages = [{ role: "user" as const, content: "hi" }];
  await complete(
    { ...base, kind: "matilda", structuredOutput: "json_schema" },
    messages,
    { responseFormat: REPLY_FORMAT },
  );
  await complete({ ...base, kind: "openai" }, messages, {
    responseFormat: REPLY_FORMAT,
  });
  server.close();
  assert.deepEqual(bodies[0].response_format, REPLY_FORMAT);
  assert.equal("response_format" in bodies[1], false);
  // The schema counts toward Matilda's request limit.
  const trimmed = buildMessages(
    { model: "matilda", ...AI_PROVIDERS.matilda },
    "hi",
    "UTC",
    Array.from({ length: 200 }, (_, n) => ({ id: n, title: "x".repeat(400) })),
  );
  const size = Buffer.byteLength(
    JSON.stringify({
      model: "matilda",
      messages: trimmed,
      response_format: REPLY_FORMAT,
    }),
  );
  assert.ok(size <= AI_PROVIDERS.matilda.limits!.maxBodyBytes);
});

test("Matilda answers questions in prose and uses the schema only for changes", async (t) => {
  const { askProvider } = await import("../src/modules/ai/provider.js");
  const bodies: Record<string, unknown>[] = [];
  let answer = "";
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: answer } }] });
    },
  );
  const matilda = {
    kind: "matilda",
    format: "openai" as const,
    baseUrl: "https://matilda.maincode.com/api/v1",
    apiKey: "mc_live_test_key_123456",
    model: "matilda",
    options: {},
    source: "database" as const,
    structuredOutput: "json_schema" as const,
  };
  answer = "Here's your week:\n\n- **Call Mum** on Friday at 6 pm";
  const summary = await askProvider(matilda, "Summarize my week", "UTC", []);
  assert.equal(summary.summary, answer);
  assert.deepEqual(summary.actions, []);
  assert.equal("response_format" in bodies[0], false);
  answer = JSON.stringify({
    summary: ["Added it."],
    actions: [
      {
        operation: "create",
        item_id: null,
        version: null,
        data: {
          title: "Call Mum",
          notes: null,
          kind: "task",
          status: null,
          priority: null,
          due_at: null,
          end_at: null,
          reminder_minutes: null,
          team_id: null,
          progress: null,
        },
      },
    ],
  });
  const change = await askProvider(
    matilda,
    "Add a task to call Mum",
    "UTC",
    [],
  );
  assert.equal(change.actions.length, 1);
  assert.deepEqual(bodies[1].response_format, REPLY_FORMAT);
});

test("proposals without words get a summary, and today is the user's local day", async () => {
  const { withSummary } = await import("../src/modules/ai/provider.js");
  const { answerPrompt } = await import("../src/modules/ai/prompt.js");
  const reply = withSummary({
    summary: " ",
    actions: [{ operation: "create", data: { title: "Plumber" } }],
  } as never);
  assert.equal(reply.summary, "Here's the change for you to review.");
  // 16:06 UTC on Monday is already Tuesday in Melbourne.
  const prompt = answerPrompt(
    "Australia/Melbourne",
    new Date("2026-09-14T16:06:00Z"),
  );
  assert.match(prompt, /it is Tuesday 15 September 2026/);
  assert.doesNotMatch(prompt, /Current UTC/);
});

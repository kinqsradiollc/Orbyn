import { test } from "node:test";
import assert from "node:assert/strict";
// Unit tests for the agent's provider protocol: no database or network.
const { rejectsTools, step, strictSchema, startingMode } =
  await import("../src/modules/ai/agent/protocol.js");
const { ProviderError } =
  await import("../src/modules/ai/providers/adapters.js");
const { TOOL_SPECS } = await import("../src/modules/ai/agent/tools.js");

const base = {
  kind: "openai-compatible",
  format: "openai" as const,
  baseUrl: "http://127.0.0.1:9/v1",
  apiKey: "",
  model: "unit-test",
  options: {},
  source: "database" as const,
};
const signal = new AbortController().signal;
const history = [
  { role: "system" as const, content: "You are Orbyn." },
  { role: "user" as const, content: "Find gym" },
  {
    role: "assistant" as const,
    content: "",
    tool_calls: [
      { id: "c1", name: "search_items", arguments: '{"query":"gym"}' },
    ],
  },
  {
    role: "tool" as const,
    tool_call_id: "c1",
    name: "search_items",
    content: '{"total":0,"items":[]}',
  },
];

/** Mocks fetch with one reply and returns what was sent. */
function reply(t: import("node:test").TestContext, body: unknown) {
  const sent: { url: string; body: Record<string, any> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return sent;
}

test("providers flagged for structured output start with the JSON protocol", () => {
  assert.equal(
    startingMode({ ...base, structuredOutput: "json_schema" }),
    "json",
  );
  assert.equal(startingMode(base), "native");
});

test("native OpenAI-style steps send tools and read tool calls", async (t) => {
  const sent = reply(t, {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [
            { id: "x", function: { name: "get_overview", arguments: "{}" } },
          ],
        },
      },
    ],
  });
  const out = await step(base, history, TOOL_SPECS, {
    mode: "native",
    toolsAllowed: true,
    signal,
  });
  assert.deepEqual(out.toolCalls, [
    { id: "x", name: "get_overview", arguments: "{}" },
  ]);
  assert.equal(sent[0].body.tool_choice, "auto");
  assert.equal(sent[0].body.tools.length, TOOL_SPECS.length);
  const [, , assistant, tool] = sent[0].body.messages;
  assert.equal(assistant.tool_calls[0].function.name, "search_items");
  assert.deepEqual(tool, {
    role: "tool",
    tool_call_id: "c1",
    content: '{"total":0,"items":[]}',
  });
});

test("the JSON protocol carries tool calls in a schema-checked reply", async (t) => {
  const sent = reply(t, {
    choices: [
      {
        message: {
          content: JSON.stringify({
            tool_calls: [
              {
                name: "search_items",
                arguments: { query: "gym", status: null, kind: null },
              },
            ],
            answer: null,
          }),
        },
      },
    ],
  });
  const ai = { ...base, structuredOutput: "json_schema" as const };
  const out = await step(ai, history, TOOL_SPECS, {
    mode: "json",
    toolsAllowed: true,
    signal,
  });
  assert.equal(out.toolCalls[0].name, "search_items");
  // The nulls a strict schema forces onto optional fields are removed.
  assert.deepEqual(JSON.parse(out.toolCalls[0].arguments), { query: "gym" });
  const body = sent[0].body;
  assert.equal(body.tools, undefined);
  assert.equal(body.response_format.json_schema.name, "orbyn_step");
  // Tool calls and results travel as plain text messages.
  assert.deepEqual(
    body.messages.map((m: { role: string }) => m.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(body.messages[3].content, /^\[Tool result: search_items\]/);
});

test("the JSON protocol reads answers, and prose as the answer", async (t) => {
  const ai = { ...base, structuredOutput: "json_schema" as const };
  reply(t, {
    choices: [
      {
        message: {
          content: JSON.stringify({
            tool_calls: [],
            answer: ["**Hi**", "- one"],
          }),
        },
      },
    ],
  });
  let out = await step(ai, history, TOOL_SPECS, {
    mode: "json",
    toolsAllowed: true,
    signal,
  });
  assert.deepEqual(out, { text: "**Hi**\n- one", toolCalls: [] });
  t.mock.restoreAll();
  reply(t, { choices: [{ message: { content: "Your week is clear." } }] });
  out = await step(ai, history, TOOL_SPECS, {
    mode: "json",
    toolsAllowed: true,
    signal,
  });
  assert.deepEqual(out, { text: "Your week is clear.", toolCalls: [] });
});

test("the JSON protocol reads one named field per tool", async (t) => {
  const ai = { ...base, structuredOutput: "json_schema" as const };
  const unused = Object.fromEntries(TOOL_SPECS.map((s) => [s.name, null]));
  const sent = reply(t, {
    choices: [
      {
        message: {
          content: JSON.stringify({
            ...unused,
            get_overview: false,
            list_teams: true,
            search_items: { query: "gym", status: null, kind: null },
            answer: null,
          }),
        },
      },
    ],
  });
  const out = await step(ai, history, TOOL_SPECS, {
    mode: "json",
    toolsAllowed: true,
    signal,
  });
  assert.deepEqual(
    out.toolCalls.map((c) => [c.name, JSON.parse(c.arguments)]),
    [
      ["search_items", { query: "gym" }],
      ["list_teams", {}],
    ],
  );
  const schema = sent[0].body.response_format.json_schema.schema;
  assert.deepEqual(schema.required, [
    ...TOOL_SPECS.map((s) => s.name),
    "answer",
  ]);
  assert.equal(schema.properties.get_overview.type, "boolean");
  assert.deepEqual(schema.properties.search_items.type, ["object", "null"]);
  // The tools are described in the system message even with a schema.
  assert.match(sent[0].body.messages[0].content, /- propose_create: /);

  // A tool field with only nulls in it is not a call.
  t.mock.restoreAll();
  reply(t, {
    choices: [
      {
        message: {
          content: JSON.stringify({
            ...unused,
            search_items: { query: null },
            get_overview: false,
            answer: ["Nothing yet."],
          }),
        },
      },
    ],
  });
  assert.deepEqual(
    await step(ai, history, TOOL_SPECS, {
      mode: "json",
      toolsAllowed: true,
      signal,
    }),
    { text: "Nothing yet.", toolCalls: [] },
  );
});

test("Anthropic steps use tool_use and tool_result blocks", async (t) => {
  const sent = reply(t, {
    type: "message",
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "tu1", name: "get_item", input: { id: "abc" } },
    ],
  });
  const ai = {
    ...base,
    kind: "anthropic",
    format: "anthropic" as const,
    baseUrl: "http://127.0.0.1:9/v1",
  };
  const out = await step(ai, history, TOOL_SPECS, {
    mode: "native",
    toolsAllowed: false,
    signal,
  });
  assert.deepEqual(out.toolCalls, [
    { id: "tu1", name: "get_item", arguments: '{"id":"abc"}' },
  ]);
  const body = sent[0].body;
  assert.equal(body.system, "You are Orbyn.");
  assert.deepEqual(body.tool_choice, { type: "none" });
  assert.deepEqual(
    body.messages.map((m: { role: string }) => m.role),
    ["user", "assistant", "user"],
  );
  assert.deepEqual(body.messages[1].content[0], {
    type: "tool_use",
    id: "c1",
    name: "search_items",
    input: { query: "gym" },
  });
  assert.equal(body.messages[2].content[0].type, "tool_result");
  assert.equal(body.messages[2].content[0].tool_use_id, "c1");
});

test("a provider that refuses tools is recognised", () => {
  assert.equal(
    rejectsTools(new ProviderError("http_400", "tools are not supported")),
    true,
  );
  assert.equal(rejectsTools(new ProviderError("http_400", "bad model")), false);
  assert.equal(rejectsTools(new Error("tools")), false);
});

test("strict schemas require every field and let optional ones be null", () => {
  const schema = strictSchema({
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["task", "event"] },
    },
  });
  assert.deepEqual(schema.required, ["id", "kind"]);
  assert.deepEqual((schema.properties as any).kind, {
    type: ["string", "null"],
    enum: ["task", "event", null],
  });
});

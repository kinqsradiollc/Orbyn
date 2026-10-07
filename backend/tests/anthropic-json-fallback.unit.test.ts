import { test } from "node:test";
import assert from "node:assert/strict";
import { step } from "../src/modules/ai/agent/protocol.js";
import { runAgent } from "../src/modules/ai/agent/loop.js";
import {
  ProviderError,
  type ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
const ai: ResolvedAi = {
  kind: "anthropic",
  format: "anthropic",
  baseUrl: "https://fixture.invalid/v1",
  apiKey: "inert-fixture-secret",
  model: "fixture-model",
  options: {},
  source: "database",
};
const tool = {
  name: "fixture_tool",
  description: "Inert fixture.",
  parameters: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
};
const usage = {
  input_tokens: 7,
  output_tokens: 3,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
function response(text: string, stop_reason = "end_turn") {
  return Response.json({
    id: "fixture-response",
    usage,
    stop_reason,
    content: [{ type: "text", text }],
  });
}

test("Anthropic JSON fallback retains Messages wire shape, parses tools and records native usage once", async (t) => {
  let calls = 0,
    observations: any[] = [];
  const signal = AbortSignal.timeout(1000);
  t.mock.method(globalThis, "fetch", async (input, init) => {
    calls++;
    assert.equal(String(input), ai.baseUrl + "/messages");
    assert.equal(init?.signal, signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-api-key"), ai.apiKey);
    assert.equal(headers.get("authorization"), null);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, ai.model);
    assert.equal(body.max_tokens, 8192);
    assert.ok(body.system.includes("Neutral system."));
    assert.equal(body.tools, undefined);
    assert.equal(body.response_format, undefined);
    assert.ok(
      body.messages.every(
        (m: any) => m.role === "user" || m.role === "assistant",
      ),
    );
    return response('{"fixture_tool":{"value":"OK"},"answer":null}');
  });
  const result = await step(
    {
      ...ai,
      recordUsage: async (...args) => {
        observations.push(args);
      },
    },
    [
      { role: "system", content: "Neutral system." },
      { role: "user", content: "Neutral fixture." },
    ],
    [tool],
    { mode: "json", toolsAllowed: true, signal },
  );
  assert.equal(calls, 1);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, tool.name);
  assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), { value: "OK" });
  assert.deepEqual(observations, [
    [
      {
        input_tokens: 7,
        output_tokens: 3,
        reasoning_tokens: null,
        cached_input_tokens: 0,
        cache_write_tokens: 0,
      },
      "fixture-response",
    ],
  ]);
});

test("actual durable loop recovers from Anthropic native tool rejection", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    paths.push(new URL(String(input)).pathname);
    if (paths.length === 1)
      return Response.json(
        { error: { message: "tools are not supported" } },
        { status: 400 },
      );
    assert.equal(paths.at(-1), "/v1/messages");
    return response('{"fixture_tool":{"value":"OK"},"answer":null}');
  });
  const result = await runAgent(
    ai,
    {
      user: { id: "00000000-0000-4000-8000-000000000000", role: "member" },
      timezone: "UTC",
      intentText: "Neutral fixture.",
      actions: [],
      clarification: null,
    },
    "Neutral fixture.",
    [],
    {},
    undefined,
    undefined,
    {
      systemPrompt: "Neutral system.",
      maxSteps: 2,
      tools: [tool],
      executeTool: async () => ({ content: "Recovered answer.", stop: true }),
    },
  );
  assert.equal(result.summary, "Recovered answer.");
  assert.deepEqual(paths, ["/v1/messages", "/v1/messages"]);
});

test("resumed Anthropic JSON history sends plain conversation rather than native tool blocks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input, init) => {
    assert.equal(String(input), ai.baseUrl + "/messages");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.tools, undefined);
    assert.ok(JSON.stringify(body.messages).includes("Tool result:"));
    return response("Final answer.");
  });
  const result = await step(
    ai,
    [
      { role: "user", content: "Neutral fixture." },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "fixture-call", name: tool.name, arguments: '{"value":"OK"}' },
        ],
      },
      {
        role: "tool",
        tool_call_id: "fixture-call",
        name: tool.name,
        content: "Tool result: OK",
      },
    ],
    [tool],
    { mode: "json", toolsAllowed: false, signal: AbortSignal.timeout(1000) },
  );
  assert.deepEqual(result, { text: "Final answer.", toolCalls: [] });
});

for (const status of [400, 401, 403, 429, 500])
  test(`Anthropic JSON HTTP ${status} is sanitized`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { message: ai.apiKey } }, { status }),
    );
    await assert.rejects(
      step(ai, [{ role: "user", content: "Neutral fixture." }], [tool], {
        mode: "json",
        toolsAllowed: true,
        signal: AbortSignal.timeout(1000),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.reason, `http_${status}`);
        assert.ok(!error.message.includes(ai.apiKey));
        return true;
      },
    );
  });

test("Anthropic JSON truncation does not publish partial tools", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    response('{"fixture_tool":{"value":"partial"}}', "max_tokens"),
  );
  await assert.rejects(
    step(ai, [], [tool], {
      mode: "json",
      toolsAllowed: true,
      signal: AbortSignal.timeout(1000),
    }),
    (error: unknown) =>
      error instanceof ProviderError && error.reason === "truncated",
  );
});

test("Anthropic JSON checks authority again before returning content", async (t) => {
  let allowed = true;
  t.mock.method(globalThis, "fetch", async () => {
    allowed = false;
    return response('{"fixture_tool":{"value":"OK"}}');
  });
  await assert.rejects(
    step(
      {
        ...ai,
        assertAuthority: async () => {
          if (!allowed) throw new Error("Authority revoked");
        },
      },
      [],
      [tool],
      { mode: "json", toolsAllowed: true, signal: AbortSignal.timeout(1000) },
    ),
    /Authority revoked/,
  );
});

test("Anthropic JSON error envelopes do not record usage or publish tools", async (t) => {
  let observations = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ type: "error", error: { message: ai.apiKey } }),
  );
  await assert.rejects(
    step(
      {
        ...ai,
        recordUsage: async () => {
          observations++;
        },
      },
      [],
      [tool],
      { mode: "json", toolsAllowed: true, signal: AbortSignal.timeout(1000) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.reason, "error_envelope");
      assert.ok(!error.message.includes(ai.apiKey));
      return true;
    },
  );
  assert.equal(observations, 0);
});

test("Anthropic JSON respects cancellation after a provider response", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return response('{"fixture_tool":{"value":"OK"}}');
  });
  await assert.rejects(
    step(ai, [], [tool], {
      mode: "json",
      toolsAllowed: true,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("private transport takes precedence and creates no managed Anthropic request or usage", async (t) => {
  let network = 0,
    observations = 0,
    privateCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("Unexpected managed request");
  });
  const result = await step(
    {
      ...ai,
      textTransport: async () => {
        privateCalls++;
        return "Private answer.";
      },
      recordUsage: async () => {
        observations++;
      },
    },
    [],
    [],
    { mode: "json", toolsAllowed: false, signal: AbortSignal.timeout(1000) },
  );
  assert.deepEqual(result, { text: "Private answer.", toolCalls: [] });
  assert.equal(privateCalls, 1);
  assert.equal(network, 0);
  assert.equal(observations, 0);
});

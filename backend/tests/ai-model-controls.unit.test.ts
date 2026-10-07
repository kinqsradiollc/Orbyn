import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiProviderInput,
  aiUsageSummary,
  aiModelCapabilities,
  aiModelControlError,
  editedAiModelOptions,
} from "@orbyn/core";
import {
  responsesControls,
  readOpenAiUsage,
} from "../src/modules/ai/providers/model-controls.js";
import {
  complete,
  type ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
import { step } from "../src/modules/ai/agent/protocol.js";
import { agentPrompt } from "../src/modules/ai/agent/prompt.js";
const ai: ResolvedAi = {
  kind: "openai",
  format: "openai",
  requestFormat: "responses",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "fixture-key",
  model: "gpt-6.1-sol",
  source: "database",
  providerId: "fixture-provider",
  cacheScope: "fixture-person",
  options: { reasoningEffort: "high", cacheMode: "explicit" },
};
const messages = [
  { role: "system" as const, content: "Stable instructions" },
  { role: "user" as const, content: "Untrusted dynamic content" },
];
for (const model of [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]) {
  test(`${model} uses its documented reasoning and modern cache capabilities`, () => {
    const caps = aiModelCapabilities("openai", model);
    assert.ok(caps.efforts.includes("max"));
    assert.equal(
      caps.efforts.includes("none"),
      !["gpt-6.1-sol", "gpt-6-astra"].includes(model),
    );
    assert.equal(caps.efforts.includes("minimal"), false);
    assert.equal(
      aiModelControlError("openai", model, {
        reasoningEffort: "max",
        cacheMode: "off",
      }),
      null,
    );
    assert.ok(
      aiModelControlError("openai", model, { reasoningEffort: "minimal" }),
    );
  });
}
test("strict shared inputs refuse unknown fields and unsupported effort names", () => {
  const base = { kind: "openai", name: "Fixture" };
  assert.equal(
    aiProviderInput.safeParse({
      ...base,
      options: { reasoningEffort: "ultra" },
    }).success,
    false,
  );
  assert.equal(
    aiProviderInput.safeParse({
      ...base,
      options: { cacheKey: "caller-owned" },
    }).success,
    false,
  );
  assert.equal(
    aiProviderInput.safeParse({
      ...base,
      options: { reasoningEffort: "high", cacheMode: "explicit" },
    }).success,
    true,
  );
});
test("unknown models keep defaults but never guess support for configured controls", () => {
  assert.equal(aiModelControlError("openai", "unknown-model", {}), null);
  assert.ok(
    aiModelControlError("openai", "unknown-model", { cacheMode: "explicit" }),
  );
  for (const kind of [
    "openai-compatible",
    "azure",
    "anthropic",
    "chatgpt_plan",
  ])
    assert.ok(aiModelControlError(kind, "gpt-6.1-sol", ai.options));
});
test("older cache retention cannot be sent as modern cache options", () => {
  assert.equal(
    aiModelControlError("openai", "gpt-5.5", { cacheRetention: "24h" }),
    null,
  );
  assert.ok(
    aiModelControlError("openai", "gpt-5.5", { cacheRetention: "in_memory" }),
  );
  assert.equal(
    aiModelControlError("openai", "gpt-4.1", { cacheRetention: "in_memory" }),
    null,
  );
  assert.ok(
    aiModelControlError("openai", "gpt-4.1", { cacheMode: "explicit" }),
  );
  assert.ok(
    aiModelControlError("openai", "gpt-6.1-sol", { cacheRetention: "24h" }),
  );
});
test("both client edits preserve connection fields and can remove all controls", () => {
  const current = {
    apiVersion: "fixture-version",
    reasoningEffort: "high" as const,
    cacheMode: "explicit" as const,
  };
  assert.deepEqual(editedAiModelOptions(current, "", "", ""), {
    apiVersion: "fixture-version",
  });
  assert.deepEqual(editedAiModelOptions(current, "low", "off", ""), {
    apiVersion: "fixture-version",
    reasoningEffort: "low",
    cacheMode: "off",
  });
  assert.equal(current.reasoningEffort, "high");
});
test("explicit cache separates unchanged instructions from dated planner data", () => {
  const one = agentPrompt(
    "UTC",
    { source: "first" },
    new Date("2026-10-01T10:00:00Z"),
  );
  const two = agentPrompt(
    "UTC",
    { source: "second" },
    new Date("2026-10-02T10:00:00Z"),
  );
  const a = responsesControls(ai, [{ role: "system", content: one }]) as any;
  const b = responsesControls(ai, [{ role: "system", content: two }]) as any;
  assert.deepEqual(a.input[0].content[0], b.input[0].content[0]);
  assert.notDeepEqual(a.input[0].content[1], b.input[0].content[1]);
  assert.equal(a.input[0].role, "developer");
  assert.equal(a.input[0].content[1].prompt_cache_breakpoint, undefined);
  assert.ok(a.input[0].content[1].text.includes("first"));
  assert.equal(a.reasoning.effort, "high");
});
test("cache off creates no breakpoint; implicit controls and cache keys stay scoped", () => {
  const off = responsesControls(
    { ...ai, options: { cacheMode: "off" } },
    messages,
  );
  assert.equal(JSON.stringify(off).includes("prompt_cache_breakpoint"), false);
  assert.deepEqual(off.prompt_cache_options, { mode: "explicit", ttl: "30m" });
  const implicit = responsesControls(
    { ...ai, options: { cacheMode: "implicit" } },
    messages,
  );
  assert.deepEqual(implicit.prompt_cache_options, {
    mode: "implicit",
    ttl: "30m",
  });
  assert.notEqual(
    implicit.prompt_cache_key,
    responsesControls({ ...ai, cacheScope: "other-person" }, messages)
      .prompt_cache_key,
  );
  assert.equal(JSON.stringify(implicit).includes("fixture-person"), false);
  assert.equal(
    JSON.stringify(messages).includes("prompt_cache_breakpoint"),
    false,
  );
});
test("usage absent, malformed or contradictory is unknown, never invented zero", () => {
  assert.deepEqual(readOpenAiUsage(undefined), {
    input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    cached_input_tokens: null,
    cache_write_tokens: null,
  });
  assert.deepEqual(
    readOpenAiUsage({
      input_tokens: 10,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 8, cache_write_tokens: 8 },
      output_tokens_details: { reasoning_tokens: 9 },
    }),
    {
      input_tokens: 10,
      output_tokens: 5,
      reasoning_tokens: null,
      cached_input_tokens: null,
      cache_write_tokens: null,
    },
  );
  assert.equal(
    readOpenAiUsage({ input_tokens: -1, output_tokens: Infinity }).input_tokens,
    null,
  );
});
for (const native of [false, true]) {
  test(`${native ? "native tools" : "direct completion"} maps selected controls and observed usage`, async (t) => {
    let body: any;
    let observed: any;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        status: "completed",
        usage: {
          input_tokens: 1200,
          output_tokens: 40,
          input_tokens_details: {
            cached_tokens: 1000,
            cache_write_tokens: 100,
          },
          output_tokens_details: { reasoning_tokens: 20 },
        },
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Fixture answer" }],
          },
        ],
      });
    });
    const target = {
      ...ai,
      recordUsage: async (usage: any) => {
        observed = usage;
      },
    };
    if (native)
      await step(target, messages, [], {
        mode: "native",
        toolsAllowed: false,
        signal: AbortSignal.timeout(1000),
      });
    else assert.equal(await complete(target, messages), "Fixture answer");
    assert.equal(body.model, ai.model);
    assert.equal(body.reasoning.effort, "high");
    assert.equal(body.prompt_cache_options.mode, "explicit");
    assert.equal(
      body.input[0].content[0].prompt_cache_breakpoint.mode,
      "explicit",
    );
    assert.equal(observed.cached_input_tokens, 1000);
    assert.equal(observed.cache_write_tokens, 100);
    assert.equal(observed.reasoning_tokens, 20);
    assert.equal(body.store, false);
  });
}
test("unsupported controls reject before network or private plan transport", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Must not send");
  });
  for (const target of [
    { ...ai, options: { reasoningEffort: "minimal" as const } },
    {
      ...ai,
      kind: "chatgpt_plan",
      textTransport: async () => {
        calls++;
        return "Must not send";
      },
    },
  ])
    await assert.rejects(
      complete(target, messages),
      (e: any) => e.reason === "unsupported_model_controls",
    );
  assert.equal(calls, 0);
});

test("usage labels preserve unknowns and do not invent totals or costs", () => {
  const unknown = {
    input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    cached_input_tokens: null,
    cache_write_tokens: null,
  };
  assert.equal(aiUsageSummary(unknown), "Token usage unavailable");
  assert.equal(
    aiUsageSummary({ ...unknown, input_tokens: 0, cached_input_tokens: 0 }),
    "Tokens: 0 input · 0 cached input",
  );
  assert.equal(
    aiUsageSummary({
      ...unknown,
      input_tokens: 100,
      output_tokens: 20,
      reasoning_tokens: 10,
      cached_input_tokens: 50,
    }),
    "Tokens: 100 input · 20 output · 50 cached input · 10 reasoning",
  );
});

test("embedding connections exclude generation controls while generation still rejects unsupported models", async () => {
  const { connection } = await import("../src/modules/ai/providers/resolve.js");
  const row = {
    id: "fixture",
    kind: "openai" as const,
    name: "Fixture",
    base_url: "https://api.openai.com/v1",
    api_key_encrypted: null,
    key_hint: "",
    options: {
      apiVersion: "connection-version",
      reasoningEffort: "high" as const,
      cacheMode: "explicit" as const,
    },
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    embedding_revision: "fixture",
  };
  const embedding = await connection(
    row,
    "text-embedding-3-small",
    "embedding",
  );
  assert.deepEqual(embedding.options, { apiVersion: "connection-version" });
  await assert.rejects(connection(row, "unknown-model"));
  assert.deepEqual(row.options, {
    apiVersion: "connection-version",
    reasoningEffort: "high",
    cacheMode: "explicit",
  });
});

for (const native of [false, true]) {
  test(`${native ? "native tools" : "direct completion"} retains reported usage from an incomplete response`, async (t) => {
    let observed: any;
    let responseId: unknown;
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        id: "response-incomplete-fixture",
        status: "incomplete",
        usage: { input_tokens: 50, output_tokens: 10 },
        output: [],
      }),
    );
    const target = {
      ...ai,
      recordUsage: async (usage: any, id?: unknown) => {
        observed = usage;
        responseId = id;
      },
    };
    await assert.rejects(
      native
        ? step(target, messages, [], {
            mode: "native",
            toolsAllowed: false,
            signal: AbortSignal.timeout(1000),
          })
        : complete(target, messages),
    );
    assert.equal(responseId, "response-incomplete-fixture");
    assert.equal(observed.input_tokens, 50);
    assert.equal(observed.output_tokens, 10);
  });
}

for (const kind of ["matilda", "openai-compatible", "azure"] as const) {
  test(`${kind} records compatible usage and response identity`, async (t) => {
    const observations: any[] = [];
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        id: "chatcmpl-fixture",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 10 },
          completion_tokens_details: { reasoning_tokens: 5 },
        },
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      }),
    );
    assert.equal(
      await complete(
        {
          ...ai,
          kind,
          format: kind === "azure" ? "azure" : "openai",
          requestFormat: undefined,
          model: "fixture",
          baseUrl: "https://fixture.invalid/v1",
          options: { apiVersion: "fixture-version" },
          recordUsage: async (...args) => {
            observations.push(args);
          },
        },
        messages,
      ),
      "OK",
    );
    assert.deepEqual(observations, [
      [
        {
          input_tokens: 100,
          output_tokens: 20,
          reasoning_tokens: 5,
          cached_input_tokens: 50,
          cache_write_tokens: 10,
        },
        "chatcmpl-fixture",
      ],
    ]);
  });
}

test("compatible usage is retained for truncated answers but not error envelopes", async (t) => {
  let observed = 0;
  let response: any = {
    usage: { prompt_tokens: 20, completion_tokens: 10 },
    choices: [{ message: { content: "Partial" }, finish_reason: "length" }],
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  const target: ResolvedAi = {
    ...ai,
    kind: "matilda",
    model: "matilda",
    requestFormat: undefined,
    baseUrl: "https://fixture.invalid/v1",
    options: {},
    recordUsage: async () => {
      observed++;
    },
  };
  await assert.rejects(complete(target, messages));
  assert.equal(observed, 1);
  response = { ...response, error: { message: "Fixture error" } };
  await assert.rejects(complete(target, messages));
  assert.equal(observed, 1);
});

test("compatible usage keeps missing and contradictory counters unknown", async () => {
  const { readChatCompletionUsage } =
    await import("../src/modules/ai/providers/model-controls.js");
  assert.deepEqual(
    readChatCompletionUsage(undefined),
    readOpenAiUsage(undefined),
  );
  assert.deepEqual(
    readChatCompletionUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 9, cache_write_tokens: 8 },
      completion_tokens_details: { reasoning_tokens: 6 },
    }),
    {
      input_tokens: 10,
      output_tokens: 5,
      reasoning_tokens: null,
      cached_input_tokens: null,
      cache_write_tokens: null,
    },
  );
  assert.equal(
    readChatCompletionUsage({ prompt_tokens: "10" }).input_tokens,
    null,
  );
  assert.equal(
    readChatCompletionUsage({ completion_tokens: -1 }).output_tokens,
    null,
  );
});

test("compatible usage collection preserves authority checks before dispatch and answer acceptance", async (t) => {
  let calls = 0;
  let revoked = true;
  let observations = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    revoked = true;
    return Response.json({
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ message: { content: "OK" } }],
    });
  });
  const target: ResolvedAi = {
    ...ai,
    kind: "matilda",
    model: "matilda",
    requestFormat: undefined,
    baseUrl: "https://fixture.invalid/v1",
    options: {},
    assertAuthority: async () => {
      if (revoked) throw new Error("Authority revoked");
    },
    recordUsage: async () => {
      observations++;
    },
  };
  await assert.rejects(complete(target, messages), /Authority revoked/);
  assert.equal(calls, 0);
  revoked = false;
  await assert.rejects(complete(target, messages), /Authority revoked/);
  assert.equal(calls, 1);
  // The completed request consumed tokens even though its answer is rejected.
  assert.equal(observations, 1);
});

test("private ChatGPT transport never acquires managed compatible usage", async (t) => {
  let observations = 0;
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No managed request allowed");
  });
  assert.equal(
    await complete(
      {
        ...ai,
        kind: "chatgpt_plan",
        options: {},
        textTransport: async () => "Private answer",
        recordUsage: async () => {
          observations++;
        },
      },
      messages,
    ),
    "Private answer",
  );
  assert.equal(observations, 0);
});

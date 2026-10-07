import { test } from "node:test";
import assert from "node:assert/strict";
import {
  complete,
  listModels,
  ProviderError,
  type ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
import { step } from "../src/modules/ai/agent/protocol.js";
import { readResponsesUsage } from "../src/modules/ai/providers/model-controls.js";
const ai: ResolvedAi = {
  kind: "perplexity",
  format: "openai",
  baseUrl: "https://api.perplexity.ai",
  apiKey: "fixture-secret",
  model: "openai/gpt-5.6-sol",
  options: {},
  source: "database",
};
const answer = {
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "fixture-ok" }],
    },
  ],
};
for (const baseUrl of [
  "https://api.perplexity.ai",
  "https://api.perplexity.ai/",
  "https://api.perplexity.ai/v1",
  "https://api.perplexity.ai/v1/",
])
  test(`native Perplexity catalog and completion normalize ${baseUrl}`, async (t) => {
    const requests: Array<{ url: string; body: any }> = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      requests.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json(
        String(url).endsWith("/models") ? { data: [{ id: ai.model }] } : answer,
      );
    });
    assert.deepEqual(await listModels({ ...ai, baseUrl }), [ai.model]);
    assert.equal(
      await complete({ ...ai, baseUrl, cacheScope: "private-opaque" }, [
        { role: "user", content: "Inert marker" },
      ]),
      "fixture-ok",
    );
    assert.equal(requests[0].url, "https://api.perplexity.ai/v1/models");
    assert.equal(requests[1].url, "https://api.perplexity.ai/v1/responses");
    assert.deepEqual(requests[1].body.tools, []);
    assert.equal(requests[1].body.store, false);
    assert.equal(requests[1].body.prompt_cache_key, undefined);
    assert.equal(requests[1].body.messages, undefined);
  });
for (const baseUrl of [
  "https://fixture.invalid/custom/v1",
  "https://api.perplexity.ai/router/v1",
  "https://api.perplexity.ai/custom/v1",
])
  test(`custom Perplexity preserves compatible resource ${baseUrl}`, async (t) => {
    let seen = "";
    t.mock.method(globalThis, "fetch", async (url) => {
      seen = String(url);
      return Response.json({
        choices: [{ message: { content: "compatible-ok" } }],
      });
    });
    assert.equal(
      await complete({ ...ai, baseUrl }, [
        { role: "user", content: "Inert marker" },
      ]),
      "compatible-ok",
    );
    assert.equal(seen, `${baseUrl}/chat/completions`);
  });
for (const model of [
  "sonar",
  "sonar-pro",
  "sonar-reasoning-pro",
  "sonar-deep-research",
  "r1-1776",
])
  test(`legacy Perplexity choice ${model} is preserved`, async (t) => {
    let seen = "";
    let body: any;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      seen = String(url);
      body = JSON.parse(String(init?.body));
      return Response.json({
        choices: [{ message: { content: "legacy-ok" } }],
      });
    });
    assert.equal(
      await complete({ ...ai, model }, [
        { role: "user", content: "Inert marker" },
      ]),
      "legacy-ok",
    );
    assert.equal(body.model, model);
    assert.equal(seen, "https://api.perplexity.ai/chat/completions");
  });
test("Perplexity function continuation retains the opaque thought signature and exact call id", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(
      requests.length === 1
        ? {
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "call_fixed",
                name: "read_fixture",
                arguments: "{}",
                thought_signature: "opaque-fixture-signature",
              },
            ],
          }
        : answer,
    );
  });
  const tools = [
    {
      name: "read_fixture",
      description: "Read inert fixture",
      parameters: { type: "object", properties: {} },
    },
  ];
  const opts = {
    mode: "native" as const,
    toolsAllowed: true,
    signal: AbortSignal.timeout(1000),
  };
  const first = await step(
    ai,
    [{ role: "user", content: "Inert marker" }],
    tools,
    opts,
  );
  assert.equal(first.responseItems?.[0].type, "function_call");
  assert.deepEqual(first.responseItems?.[0], {
    type: "function_call",
    call_id: "call_fixed",
    name: "read_fixture",
    arguments: "{}",
    thought_signature: "opaque-fixture-signature",
  });
  const second = await step(
    ai,
    [
      { role: "user", content: "Inert marker" },
      {
        role: "assistant",
        content: first.text,
        tool_calls: first.toolCalls,
        responseItems: first.responseItems,
      },
      {
        role: "tool",
        name: "read_fixture",
        tool_call_id: "call_fixed",
        content: "inert-result",
      },
    ],
    tools,
    opts,
  );
  assert.equal(second.text, "fixture-ok");
  assert.deepEqual(requests[1].input[1], first.responseItems?.[0]);
  assert.deepEqual(requests[1].input[2], {
    type: "function_call_output",
    call_id: "call_fixed",
    output: "inert-result",
  });
  assert.equal(requests[0].include, undefined);
  assert.deepEqual(
    requests[0].tools.map((x: any) => x.type),
    ["function"],
  );
  assert.equal(requests[0].store, false);
});
for (const thought_signature of [null, 1, {}, "", "x".repeat(65537)])
  test(`invalid Perplexity signature ${typeof thought_signature}:${String(thought_signature).length} is rejected`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call_fixed",
            name: "read_fixture",
            arguments: "{}",
            thought_signature,
          },
        ],
      }),
    );
    await assert.rejects(
      step(
        ai,
        [{ role: "user", content: "Inert" }],
        [{ name: "read_fixture", description: "Fixture", parameters: {} }],
        {
          mode: "native",
          toolsAllowed: true,
          signal: AbortSignal.timeout(1000),
        },
      ),
      ProviderError,
    );
  });
test("Perplexity reported cache counters preserve zeros and reject contradictory totals", () => {
  assert.deepEqual(
    readResponsesUsage(ai, {
      input_tokens: 10,
      output_tokens: 2,
      input_tokens_details: {
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 3,
      },
    }),
    {
      input_tokens: 10,
      output_tokens: 2,
      reasoning_tokens: null,
      cached_input_tokens: 4,
      cache_write_tokens: 3,
    },
  );
  assert.equal(
    readResponsesUsage(ai, {
      input_tokens: 1,
      input_tokens_details: { cache_read_input_tokens: 2 },
    }).cached_input_tokens,
    null,
  );
  assert.equal(
    readResponsesUsage(ai, {
      input_tokens_details: { cache_read_input_tokens: 0 },
    }).cached_input_tokens,
    0,
  );
  assert.equal(readResponsesUsage(ai, {}).cache_write_tokens, null);
});

for (const status of [400, 401, 403, 404, 429, 500])
  test(`Perplexity native HTTP ${status} remains a sanitized provider failure`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json(
        { error: { message: "fixture-secret failure" } },
        { status },
      ),
    );
    await assert.rejects(
      complete(ai, [{ role: "user", content: "Inert" }]),
      (error: unknown) =>
        error instanceof ProviderError &&
        !error.message.includes("fixture-secret"),
    );
  });
test("native Perplexity rejects authority changed after receiving output", async (t) => {
  let checks = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(answer));
  await assert.rejects(
    complete(
      {
        ...ai,
        assertAuthority: async () => {
          if (++checks > 1) throw new Error("authority-changed");
        },
      },
      [{ role: "user", content: "Inert" }],
    ),
    /authority-changed/,
  );
  assert.ok(checks > 1);
});
test("aborted native Perplexity call never dispatches", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(answer);
  });
  await assert.rejects(
    complete(ai, [{ role: "user", content: "Inert" }], {
      signal: AbortSignal.abort(),
    }),
  );
  assert.equal(calls, 0);
});
test("native Perplexity rejects unexpected hosted tools and calls after tools are disabled", async (t) => {
  const tools = [
    { name: "read_fixture", description: "Fixture", parameters: {} },
  ];
  for (const output of [
    [{ type: "web_search_call", id: "hosted" }],
    [
      {
        type: "function_call",
        call_id: "fixed",
        name: "read_fixture",
        arguments: "{}",
      },
    ],
  ]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ status: "completed", output }),
    );
    await assert.rejects(
      step(ai, [{ role: "user", content: "Inert" }], tools, {
        mode: "native",
        toolsAllowed: false,
        signal: AbortSignal.timeout(1000),
      }),
      ProviderError,
    );
    t.mock.restoreAll();
  }
});
test("native Perplexity JSON fallback uses the same recipient and application parser", async (t) => {
  let request: any;
  let url = "";
  t.mock.method(globalThis, "fetch", async (input, init) => {
    url = String(input);
    request = JSON.parse(String(init?.body));
    return Response.json({
      ...answer,
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ read_fixture: true, answer: null }),
            },
          ],
        },
      ],
    });
  });
  const result = await step(
    ai,
    [{ role: "user", content: "Inert" }],
    [{ name: "read_fixture", description: "Fixture", parameters: {} }],
    { mode: "json", toolsAllowed: true, signal: AbortSignal.timeout(1000) },
  );
  assert.equal(url, "https://api.perplexity.ai/v1/responses");
  assert.deepEqual(request.tools, []);
  assert.equal(result.toolCalls[0].name, "read_fixture");
});

test("actual Perplexity agent loop resumes its serialized function context without executing twice", async (t) => {
  const { runAgent } = await import("../src/modules/ai/agent/loop.js");
  const { connection } = await import("../src/modules/ai/providers/resolve.js");
  const resolved = await connection(
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "perplexity",
      name: "Inert fixture",
      base_url: ai.baseUrl,
      api_key_encrypted: null,
      key_hint: "",
      enabled: true,
      options: {},
      created_at: new Date(),
      updated_at: new Date(),
      embedding_revision: "1",
    },
    ai.model,
  );
  let calls = 0;
  let executions = 0;
  let checkpoint: any;
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.perplexity.ai/v1/responses");
    requests.push(JSON.parse(String(init?.body)));
    calls++;
    return Response.json(
      calls === 1
        ? {
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "fixed-call",
                name: "read_fixture",
                arguments: "{}",
                thought_signature: "opaque-resume-signature",
              },
            ],
          }
        : answer,
    );
  });
  const context = () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000000",
      role: "member" as const,
    },
    timezone: "UTC",
    intentText: "Inert fixture.",
    actions: [],
    clarification: null,
  });
  const options = {
    systemPrompt: "Answer briefly.",
    maxSteps: 3,
    tools: [
      {
        name: "read_fixture",
        description: "Inert fixture",
        parameters: { type: "object", properties: {} },
      },
    ],
    executeTool: async () => {
      executions++;
      return { content: "inert result", isError: false };
    },
  };
  await assert.rejects(
    runAgent(
      resolved,
      context(),
      "Inert fixture.",
      [],
      {},
      undefined,
      undefined,
      {
        ...options,
        checkpoint: async (state) => {
          if (state.messages.some((m) => m.role === "tool")) {
            checkpoint = JSON.parse(JSON.stringify(state));
            throw new Error("fixture restart");
          }
        },
      },
    ),
    /fixture restart/,
  );
  assert.equal(calls, 1);
  assert.equal(executions, 1);
  assert.ok(checkpoint);
  const resumed = await runAgent(
    resolved,
    context(),
    "Inert fixture.",
    [],
    {},
    undefined,
    undefined,
    { ...options, resume: checkpoint },
  );
  assert.equal(resumed.summary, "fixture-ok");
  assert.equal(executions, 1);
  assert.equal(calls, 2);
  assert.ok(
    requests[1].input.some(
      (item: any) =>
        item.type === "function_call" &&
        item.call_id === "fixed-call" &&
        item.thought_signature === "opaque-resume-signature",
    ),
  );
  assert.ok(
    requests[1].input.some(
      (item: any) =>
        item.type === "function_call_output" &&
        item.call_id === "fixed-call" &&
        item.output === "inert result",
    ),
  );
});

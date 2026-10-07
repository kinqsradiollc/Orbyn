import { test } from "node:test";
import assert from "node:assert/strict";
import { step, type AgentMessage } from "../src/modules/ai/agent/protocol.js";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";

const ai: ResolvedAi = {
  kind: "openai",
  format: "openai",
  requestFormat: "responses",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "fixture-key",
  model: "gpt-6.1-sol",
  options: {},
  source: "database",
};
const tools = [
  {
    name: "lookup",
    description: "Read a fixture",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
];
const messages: AgentMessage[] = [
  { role: "system", content: "Keep the selected model." },
  { role: "user", content: "Look up the fixture." },
];

test("managed OpenAI agent tools use Responses and keep selected model and optional schemas", async () => {
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call_fixture",
            name: "lookup",
            arguments: '{"query":"fixture"}',
          },
        ],
      }),
    );
  };
  try {
    const result = await step(ai, messages, tools, {
      mode: "native",
      toolsAllowed: true,
      signal: new AbortController().signal,
    });
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.body.model, ai.model);
    assert.equal(request.body.store, false);
    assert.equal(request.body.parallel_tool_calls, false);
    assert.equal(request.body.tool_choice, "auto");
    assert.equal(request.body.tools[0].name, "lookup");
    assert.equal(request.body.tools[0].strict, false);
    assert.equal(request.body.tools[0].function, undefined);
    assert.deepEqual(result.toolCalls, [
      { id: "call_fixture", name: "lookup", arguments: '{"query":"fixture"}' },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

const callItem = {
  type: "function_call",
  call_id: "call_fixture",
  name: "lookup",
  arguments: '{"query":"fixture"}',
};
const reasoningItem = {
  type: "reasoning",
  id: "rs_fixture",
  summary: [],
  encrypted_content: "opaque-fixture-context",
};
const answerItem = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Fixture complete." }],
};
const options = {
  mode: "native" as const,
  toolsAllowed: true,
  signal: new AbortController().signal,
};

test("documented legacy and current OpenAI models retain the selected model on Responses", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ status: "completed", output: [answerItem] });
  });
  const models = [
    "gpt-3.5-turbo-0125",
    "gpt-4-0613",
    "gpt-4o-mini",
    "o3",
    "gpt-6.1-sol",
  ];
  for (const model of models)
    await step({ ...ai, model }, messages, tools, options);
  assert.deepEqual(
    requests.map((request) => request.body.model),
    models,
  );
  assert.ok(
    requests.every(
      (request) => request.url === "https://api.openai.com/v1/responses",
    ),
  );
});

test("Responses replay retains encrypted reasoning and exact call/output identity after serialization", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      status: "completed",
      output: requests.length === 1 ? [reasoningItem, callItem] : [answerItem],
    });
  });
  const first = await step(ai, messages, tools, options);
  const continued: AgentMessage[] = JSON.parse(
    JSON.stringify([
      ...messages,
      {
        role: "assistant",
        content: first.text,
        tool_calls: first.toolCalls,
        responseItems: first.responseItems,
      },
      {
        role: "tool",
        tool_call_id: first.toolCalls[0].id,
        name: "lookup",
        content: "Fixture result",
      },
    ]),
  );
  const result = await step(ai, continued, tools, {
    ...options,
    toolsAllowed: false,
  });
  assert.equal(result.text, "Fixture complete.");
  assert.deepEqual(requests[1].input.slice(-3), [
    reasoningItem,
    callItem,
    {
      type: "function_call_output",
      call_id: "call_fixture",
      output: "Fixture result",
    },
  ]);
  assert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]);
  assert.equal(requests[1].tool_choice, "none");
});

test("Responses refuses incomplete, failed, unexpected or ambiguous tool replies before completion", async (t) => {
  let body: unknown;
  let completions = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(body));
  for (const value of [
    { status: "incomplete", output: [callItem] },
    { status: "failed", output: [callItem] },
    { status: "completed", output: [{ ...callItem, call_id: "" }] },
    { status: "completed", output: [{ ...callItem, name: "unknown" }] },
    { status: "completed", output: [{ ...callItem, arguments: {} }] },
    { status: "completed", output: [{ ...callItem, status: "in_progress" }] },
    { status: "completed", output: [callItem, callItem] },
    {
      status: "completed",
      output: [callItem, { ...callItem, call_id: "second" }],
    },
    { status: "completed", output: [{ type: "web_search_call" }] },
    {
      status: "completed",
      output: [{ ...reasoningItem, encrypted_content: undefined }],
    },
    { status: "completed", output: [{ type: "message", content: [{}] }] },
    { status: "completed", output: [{ ...answerItem, role: "user" }] },
    { status: "completed", output: [{ ...answerItem, status: "in_progress" }] },
    { status: "completed", output: [null] },
  ]) {
    body = value;
    await assert.rejects(
      step(
        {
          ...ai,
          recordCompletion: async () => {
            completions++;
          },
        },
        messages,
        tools,
        options,
      ),
    );
  }
  body = { status: "completed", output: [callItem] };
  await assert.rejects(
    step(ai, messages, tools, { ...options, toolsAllowed: false }),
  );
  assert.equal(completions, 0);
});

test("the private ChatGPT plan transport remains isolated from managed native Responses", async (t) => {
  let network = 0;
  let privateCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("Managed credentials must not be used");
  });
  const result = await step(
    {
      ...ai,
      structuredOutput: "json_schema",
      operationId: "private-operation",
      textTransport: async (wire, signal, operationId) => {
        privateCalls++;
        assert.equal(operationId, "private-operation");
        assert.equal(signal, options.signal);
        assert.ok(
          wire.some((message) => message.content.includes("ONE JSON object")),
        );
        return JSON.stringify({
          lookup: null,
          answer: ["Private plan answer."],
        });
      },
    },
    messages,
    tools,
    { ...options, mode: "json" },
  );
  assert.equal(result.text, "Private plan answer.");
  assert.equal(privateCalls, 1);
  assert.equal(network, 0);
});

test("Responses authority denial and cancellation prevent a provider call", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("Unexpected request");
  });
  await assert.rejects(
    step(
      {
        ...ai,
        assertAuthority: async () => {
          throw new Error("Changed provider choice");
        },
      },
      messages,
      tools,
      options,
    ),
    /Changed provider choice/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    step(ai, messages, tools, { ...options, signal: controller.signal }),
  );
  assert.equal(network, 0);
});

test("compatible and Azure endpoints retain their chat protocol even for a GPT model", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: "Compatible answer" } },
      ],
    });
  });
  await step(
    { ...ai, baseUrl: "https://fixture.invalid/v1" },
    messages,
    tools,
    options,
  );
  await step(
    { ...ai, format: "azure", options: { apiVersion: "fixture-version" } },
    messages,
    tools,
    options,
  );
  assert.ok(
    requests.every((request) => request.url.includes("chat/completions")),
  );
  assert.ok(
    requests.every(
      (request) => request.body.tools[0].function.name === "lookup",
    ),
  );
});

test("actual agent loop checkpoints Responses context before tools and replays it on the next call", async (t) => {
  const { runAgent } = await import("../src/modules/ai/agent/loop.js");
  const requests: any[] = [];
  const checkpoints: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      status: "completed",
      output: requests.length === 1 ? [reasoningItem, callItem] : [answerItem],
    });
  });
  const result = await runAgent(
    ai,
    {
      user: { id: "00000000-0000-4000-8000-000000000000", role: "admin" },
      timezone: "UTC",
      intentText: "Look up a fixture",
      actions: [],
      clarification: null,
    },
    "Look up a fixture",
    [],
    {},
    undefined,
    undefined,
    {
      tools,
      executeTool: async () => ({ content: "Fixture result", isError: false }),
      checkpoint: async (checkpoint) => {
        checkpoints.push(JSON.parse(JSON.stringify(checkpoint)));
      },
    },
  );
  assert.equal(result.summary, "Fixture complete.");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input.slice(-3), [
    reasoningItem,
    callItem,
    {
      type: "function_call_output",
      call_id: "call_fixture",
      output: "Fixture result",
    },
  ]);
  assert.ok(
    checkpoints.some((checkpoint) =>
      checkpoint.messages.some(
        (message: any) =>
          message.responseItems?.[0]?.encrypted_content ===
          reasoningItem.encrypted_content,
      ),
    ),
  );
});

for (const stopAfterTool of [false, true]) {
  test(`Responses resumes a serialized checkpoint ${stopAfterTool ? "after" : "before"} the tool result without repeating provider work`, async (t) => {
    const { runAgent } = await import("../src/modules/ai/agent/loop.js");
    const requests: any[] = [];
    let executions = 0;
    let saved:
      import("../src/modules/ai/agent/loop.js").AgentLoopCheckpoint | undefined;
    const interrupted = new Error("Fixture process stopped");
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({
        status: "completed",
        output:
          requests.length === 1 ? [reasoningItem, callItem] : [answerItem],
      });
    });
    const context = () => ({
      user: {
        id: "00000000-0000-4000-8000-000000000000",
        role: "admin" as const,
      },
      timezone: "UTC",
      intentText: "Look up a fixture",
      actions: [],
      clarification: null,
    });
    const executeTool = async () => {
      executions++;
      return { content: "Fixture result", isError: false };
    };
    await assert.rejects(
      runAgent(
        ai,
        context(),
        "Look up a fixture",
        [],
        {},
        undefined,
        undefined,
        {
          tools,
          executeTool,
          checkpoint: async (checkpoint) => {
            const hasCall = checkpoint.messages.some(
              (message) =>
                message.role === "assistant" && message.tool_calls?.length,
            );
            const hasResult = checkpoint.messages.some(
              (message) => message.role === "tool",
            );
            if (hasCall && hasResult === stopAfterTool) {
              saved = JSON.parse(JSON.stringify(checkpoint));
              throw interrupted;
            }
          },
        },
      ),
      (error) => error === interrupted,
    );
    assert.ok(saved);
    assert.equal(requests.length, 1);
    assert.equal(executions, stopAfterTool ? 1 : 0);
    const result = await runAgent(
      ai,
      context(),
      "Look up a fixture",
      [],
      {},
      undefined,
      undefined,
      { tools, executeTool, resume: saved },
    );
    assert.equal(result.summary, "Fixture complete.");
    assert.equal(executions, 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].input.slice(-3), [
      reasoningItem,
      callItem,
      {
        type: "function_call_output",
        call_id: "call_fixture",
        output: "Fixture result",
      },
    ]);
  });
}

test("oversized encrypted Responses context is refused before executing a tool", async (t) => {
  const { runAgent } = await import("../src/modules/ai/agent/loop.js");
  let executions = 0;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({
      status: "completed",
      output: [
        { ...reasoningItem, encrypted_content: "x".repeat(64_000) },
        callItem,
      ],
    });
  });
  await assert.rejects(
    runAgent(
      ai,
      {
        user: { id: "00000000-0000-4000-8000-000000000000", role: "admin" },
        timezone: "UTC",
        intentText: "Look up a fixture",
        actions: [],
        clarification: null,
      },
      "Look up a fixture",
      [],
      {},
      undefined,
      undefined,
      {
        tools,
        executeTool: async () => {
          executions++;
          return { content: "Must not execute", isError: false };
        },
      },
    ),
    /The provider reply exceeded the bounded reply size/,
  );
  assert.equal(requests, 1);
  assert.equal(executions, 0);
});

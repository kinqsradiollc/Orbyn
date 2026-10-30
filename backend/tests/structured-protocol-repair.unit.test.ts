import { mockProviderTransport } from "./provider-transport-fixture.js";
mockProviderTransport();
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runAgent,
  type AgentLoopCheckpoint,
} from "../src/modules/ai/agent/loop.js";
import { goalUnitResult } from "../src/modules/ai/agent/lead.js";
import {
  ProviderError,
  type ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
import { classifyTerminalEvidence } from "../src/modules/ai/agent/terminal-evidence.js";
const criterion = "00000000-0000-4000-8000-000000000001";
const goal_result = {
  criterion_id: criterion,
  decision: "ready",
  note: "Read only the fictional sentence.",
};
const valid = JSON.stringify({
  finish: { answer: "The paper kite is blue.", steps: [], goal_result },
  answer: null,
});
const ambiguous =
  '{"write":{"title":"Never execute this"},"finish":{"answer":"The paper kite is blue.","goal_result":{"note":"cut off\n\n' +
  valid;
const tools = [
  {
    name: "finish",
    description: "Return the answer and exact criterion decision.",
    parameters: {
      type: "object",
      properties: {
        answer: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        goal_result: {
          type: "object",
          properties: {
            criterion_id: { type: "string" },
            decision: { type: "string" },
            note: { type: "string" },
          },
          required: ["criterion_id", "decision", "note"],
        },
      },
      required: ["answer", "steps", "goal_result"],
    },
  },
  {
    name: "write",
    description: "Must never execute from malformed text.",
    parameters: { type: "object", properties: { title: { type: "string" } } },
  },
];
const context = () => ({
  user: { id: criterion, role: "member" as const },
  timezone: "UTC",
  intentText: "Read the fictional sentence.",
  actions: [],
  clarification: null,
});
function fixture(
  t: import("node:test").TestContext,
  replies: { content: string; finish_reason?: string }[],
  beforeReply?: (index: number) => void,
) {
  const requests: Record<string, unknown>[] = [],
    usage: unknown[] = [];
  let completions = 0,
    allowed = true;
  const ai: ResolvedAi = {
    kind: "openai-compatible",
    format: "openai",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "",
    model: "local-structured-fixture",
    options: {},
    source: "database",
    structuredOutput: "json_schema",
    assertAuthority: async () => {
      if (!allowed)
        throw new ProviderError("provider_changed", "Selection changed");
    },
    recordUsage: async (value) => {
      usage.push(value);
    },
    recordCompletion: async () => {
      completions++;
    },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const index = requests.length;
      requests.push(JSON.parse(String(init.body)));
      beforeReply?.(index);
      const reply = replies[Math.min(index, replies.length - 1)];
      return Response.json({
        id: `reply-${index}`,
        usage: { prompt_tokens: 17, completion_tokens: 11 },
        choices: [
          {
            message: { content: reply.content },
            finish_reason: reply.finish_reason ?? "stop",
          },
        ],
      });
    },
  );
  return {
    ai,
    requests,
    usage,
    get completions() {
      return completions;
    },
    revoke() {
      allowed = false;
    },
  };
}
test("a completed malformed envelope repairs within the same bounded loop and preserves finish.goal_result", async (t) => {
  const f = fixture(t, [{ content: ambiguous }, { content: valid }]),
    budget = { used: 0, limit: 20000 };
  let finished: unknown,
    writes = 0;
  const result = await runAgent(
    f.ai,
    context(),
    "Read only: The paper kite is blue.",
    [],
    {},
    undefined,
    undefined,
    {
      tools,
      maxSteps: 4,
      tokenBudget: budget,
      executeTool: async (call) => {
        if (call.name === "write") {
          writes++;
          throw new Error("No write is authorized");
        }
        const args = JSON.parse(call.arguments);
        finished = goalUnitResult.parse(args.goal_result);
        return { content: args.answer, stop: true };
      },
    },
  );
  assert.equal(result.summary, "The paper kite is blue.");
  assert.deepEqual(finished, goal_result);
  assert.equal(writes, 0);
  assert.equal(f.requests.length, 2);
  assert.equal(f.completions, 2);
  assert.equal(f.usage.length, 2);
  assert.ok(
    JSON.stringify(f.requests[1]).includes("exactly one complete JSON object"),
  );
  assert.ok(
    !JSON.stringify(f.requests[1]).includes("Never execute this"),
    "Malformed response is not replayed as an assistant instruction",
  );
  assert.ok(
    budget.used >
      Math.ceil(Buffer.byteLength(ambiguous) / 4) +
        Math.ceil(Buffer.byteLength(valid) / 4),
  );
  assert.ok(
    budget.used < budget.limit,
    "Known received bytes replace the output reserve while both responses remain charged",
  );
});
test("repeated malformed completed responses exhaust the existing two attempts with no public answer or effects", async (t) => {
  const f = fixture(t, [{ content: ambiguous }]);
  let calls = 0;
  await assert.rejects(
    runAgent(
      f.ai,
      context(),
      "Read the sentence.",
      [],
      {},
      undefined,
      undefined,
      {
        tools,
        maxSteps: 4,
        tokenBudget: { used: 0, limit: 20000 },
        executeTool: async () => {
          calls++;
          return { content: "not allowed" };
        },
      },
    ),
    (error) =>
      error instanceof ProviderError && error.reason === "invalid_protocol",
  );
  assert.equal(f.requests.length, 2);
  assert.equal(f.usage.length, 2);
  assert.equal(calls, 0);
});
test("budget exhaustion after invalid structured output fails closed without a final prose bypass", async (t) => {
  const budget = { used: 0, limit: 20000 };
  const f = fixture(t, [{ content: ambiguous }], () => {
    budget.limit = budget.used;
  });
  let toolsRan = 0;
  await assert.rejects(
    runAgent(
      f.ai,
      context(),
      "Read the sentence.",
      [],
      {},
      undefined,
      undefined,
      {
        tools,
        maxSteps: 4,
        tokenBudget: budget,
        executeTool: async () => {
          toolsRan++;
          return { content: "never" };
        },
      },
    ),
    (error) =>
      error instanceof ProviderError && error.reason === "invalid_protocol",
  );
  assert.equal(f.requests.length, 1);
  assert.equal(toolsRan, 0);
  assert.ok(budget.used > 0);
});
test("completed truncation repairs safely, while current authority still fences the next request", async (t) => {
  const f = fixture(t, [
    { content: valid, finish_reason: "length" },
    { content: valid },
  ]);
  let boundaries = 0,
    toolsRan = 0;
  await assert.rejects(
    runAgent(
      f.ai,
      context(),
      "Read the sentence.",
      [],
      {},
      undefined,
      undefined,
      {
        tools,
        maxSteps: 4,
        beforeProvider: async () => {
          if (++boundaries === 2) f.revoke();
        },
        executeTool: async () => {
          toolsRan++;
          return { content: "never" };
        },
      },
    ),
    (error) =>
      error instanceof ProviderError && error.reason === "provider_changed",
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.usage.length, 1);
  assert.equal(toolsRan, 0);
});
test("completed malformed protocol reasons cannot authorize a fresh automatic attempt", () => {
  for (const reason of ["invalid_protocol", "truncated"])
    assert.equal(
      classifyTerminalEvidence({
        job_id: criterion,
        error: { kind: "provider", reason },
        effects: {
          mode: "live",
          applyStarted: false,
          originalKnownNoWrite: true,
        },
        observed_at: "2026-10-30T00:00:00.000Z",
      }).retry,
      "never",
    );
});

test("a saved malformed-response checkpoint stays failclosed when a replacement has no repair budget", async (t) => {
  const f = fixture(t, [{ content: ambiguous }]),
    budget = { used: 0, limit: 20000 };
  let saved: AgentLoopCheckpoint | undefined,
    toolsRan = 0;
  const options = {
    tools,
    maxSteps: 4,
    tokenBudget: budget,
    executeTool: async () => {
      toolsRan++;
      return { content: "never" };
    },
  };
  await assert.rejects(
    runAgent(
      f.ai,
      context(),
      "Read the sentence.",
      [],
      {},
      undefined,
      undefined,
      {
        ...options,
        checkpoint: async (checkpoint) => {
          if (checkpoint.completed_protocol_failure) {
            saved = structuredClone(checkpoint);
            throw new Error("simulated worker loss after repair checkpoint");
          }
        },
      },
    ),
    /simulated worker loss/,
  );
  assert.ok(saved);
  assert.deepEqual(saved.completed_protocol_failure, {
    reason: "invalid_protocol",
    attempts: 1,
  });
  assert.equal(saved.pending_provider, undefined);
  budget.limit = budget.used;
  await assert.rejects(
    runAgent(
      f.ai,
      context(),
      "Read the sentence.",
      [],
      {},
      undefined,
      undefined,
      { ...options, resume: saved },
    ),
    (error) =>
      error instanceof ProviderError && error.reason === "invalid_protocol",
  );
  assert.equal(
    f.requests.length,
    1,
    "A final prose call cannot bypass a retained malformed protocol state",
  );
  assert.equal(toolsRan, 0);
});

test("a managed repair debit checkpoint cannot reset the two-attempt allowance after worker replacement", async (t) => {
  const f = fixture(t, [{ content: ambiguous }, { content: valid }]),
    budget = { used: 0, limit: 20000 };
  let saved: AgentLoopCheckpoint | undefined;
  const options = {
    tools,
    maxSteps: 4,
    tokenBudget: budget,
    executeTool: async () => ({ content: "never" }),
  };
  await assert.rejects(
    runAgent(f.ai, context(), "Read.", [], {}, undefined, undefined, {
      ...options,
      checkpoint: async (value) => {
        if (value.completed_protocol_failure?.attempts === 2) {
          saved = structuredClone(value);
          throw new Error("crash after repair debit");
        }
      },
    }),
    /crash after repair debit/,
  );
  assert.ok(saved);
  assert.equal(saved.completed_protocol_failure?.attempts, 2);
  assert.equal(saved.pending_provider, undefined);
  await assert.rejects(
    runAgent(f.ai, context(), "Read.", [], {}, undefined, undefined, {
      ...options,
      resume: saved,
    }),
    (error) =>
      error instanceof ProviderError && error.reason === "invalid_protocol",
  );
  assert.equal(
    f.requests.length,
    1,
    "No third/new managed dispatch is authorized by replacement",
  );
});
test("a private repair resumes its exact existing operation ID without granting a third operation", async () => {
  const calls: string[] = [],
    responses = new Map<string, string>();
  let saved: AgentLoopCheckpoint | undefined, secondId: string | undefined;
  const ai: ResolvedAi = {
    kind: "chatgpt_plan",
    format: "openai",
    baseUrl: "",
    apiKey: "",
    model: "fixture-private",
    options: {},
    source: "database",
    structuredOutput: "json_schema",
    textTransport: async (_wire, _signal, id) => {
      assert.ok(id);
      calls.push(id);
      if (!responses.has(id))
        responses.set(id, responses.size === 0 ? ambiguous : valid);
      return responses.get(id)!;
    },
  };
  const options = {
    tools,
    maxSteps: 4,
    tokenBudget: { used: 0, limit: 20000 },
    executeTool: async (
      call: import("../src/modules/ai/agent/protocol.js").ToolCall,
    ) => {
      const args = JSON.parse(call.arguments);
      goalUnitResult.parse(args.goal_result);
      return { content: args.answer, stop: true };
    },
  };
  await assert.rejects(
    runAgent(ai, context(), "Read.", [], {}, undefined, undefined, {
      ...options,
      checkpoint: async (value) => {
        if (
          value.completed_protocol_failure?.attempts === 2 &&
          value.pending_provider?.wire_messages
        ) {
          saved = structuredClone(value);
          secondId = value.pending_provider.id;
          throw new Error("private repair interrupted before dispatch");
        }
      },
    }),
    /private repair interrupted/,
  );
  assert.ok(saved);
  assert.ok(secondId);
  const result = await runAgent(
    ai,
    context(),
    "Read.",
    [],
    {},
    undefined,
    undefined,
    { ...options, resume: saved },
  );
  assert.equal(result.summary, "The paper kite is blue.");
  assert.equal(calls.length, 2);
  assert.equal(calls[1], secondId);
  assert.equal(new Set(calls).size, 2);
});
test("an exhausted malformed completion checkpoint never dispatches again across another replacement", async (t) => {
  const f = fixture(t, [{ content: ambiguous }]),
    options = {
      tools,
      maxSteps: 4,
      tokenBudget: { used: 0, limit: 20000 },
      executeTool: async () => ({ content: "never" }),
    };
  let saved: AgentLoopCheckpoint | undefined;
  await assert.rejects(
    runAgent(f.ai, context(), "Read.", [], {}, undefined, undefined, {
      ...options,
      checkpoint: async (value) => {
        saved = structuredClone(value);
      },
    }),
    (error) =>
      error instanceof ProviderError && error.reason === "invalid_protocol",
  );
  assert.ok(saved);
  assert.equal(saved.completed_protocol_failure?.attempts, 2);
  assert.equal(f.requests.length, 2);
  await assert.rejects(
    runAgent(f.ai, context(), "Read.", [], {}, undefined, undefined, {
      ...options,
      resume: saved,
    }),
    (error) =>
      error instanceof ProviderError && error.reason === "invalid_protocol",
  );
  assert.equal(f.requests.length, 2);
});

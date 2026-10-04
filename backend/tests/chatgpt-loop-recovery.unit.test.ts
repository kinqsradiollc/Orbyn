import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runAgent,
  type AgentLoopCheckpoint,
} from "../src/modules/ai/agent/loop.js";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";
const context = () => ({
  user: { id: "00000000-0000-4000-8000-000000000000", role: "member" as const },
  timezone: "UTC",
  intentText: "Read",
  actions: [],
  clarification: null,
});
const base: ResolvedAi = {
  kind: "chatgpt_plan",
  format: "openai",
  baseUrl: "",
  apiKey: "",
  model: "fixture-model",
  options: {},
  source: "database",
  structuredOutput: "json_schema",
};
test("a crash after provider completion restores the same slot and exact wire input", async () => {
  let saved: AgentLoopCheckpoint | undefined,
    failed = false,
    charges = 0;
  const replies = new Map<string, string>(),
    calls: { id: string; wire: unknown }[] = [];
  const ai = {
    ...base,
    textTransport: async (wire: unknown, _signal: AbortSignal, id?: string) => {
      assert.ok(id);
      calls.push({ id, wire: structuredClone(wire) });
      if (!replies.has(id)) {
        charges++;
        replies.set(id, "Recovered answer.");
      }
      return replies.get(id)!;
    },
  };
  await assert.rejects(
    runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
      systemPrompt: "Original context",
      checkpoint: async (value) => {
        if (value.pending_provider?.raw_reply && !failed) {
          failed = true;
          throw new Error("crash before reply checkpoint");
        }
        saved = structuredClone(value);
      },
    }),
    /crash/,
  );
  assert.ok(saved?.pending_provider?.wire_messages);
  const resumed = structuredClone(saved!);
  resumed.messages[0] = { role: "system", content: "Updated clock context" };
  const result = await runAgent(
    ai,
    context(),
    "Read",
    [],
    {},
    undefined,
    undefined,
    {
      resume: resumed,
      checkpoint: async (value) => {
        saved = structuredClone(value);
      },
    },
  );
  assert.equal(result.summary, "Recovered answer.");
  assert.equal(charges, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, calls[1].id);
  assert.deepEqual(calls[0].wire, calls[1].wire);
});
test("a saved parsed reply and finished result recover without any transport, and authority still applies", async () => {
  let saved: AgentLoopCheckpoint | undefined,
    calls = 0,
    failed = false,
    allowed = true;
  const ai = {
    ...base,
    assertAuthority: async () => {
      if (!allowed) throw new Error("source revoked");
    },
    textTransport: async () => {
      calls++;
      return "Saved answer.";
    },
  };
  await assert.rejects(
    runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
      checkpoint: async (value) => {
        saved = structuredClone(value);
        if (value.pending_provider?.result && !failed) {
          failed = true;
          throw new Error("crash after commit");
        }
      },
    }),
    /crash/,
  );
  const result = await runAgent(
    ai,
    context(),
    "Read",
    [],
    {},
    undefined,
    undefined,
    {
      resume: saved,
      checkpoint: async (value) => {
        saved = structuredClone(value);
      },
    },
  );
  assert.equal(result.summary, "Saved answer.");
  assert.equal(calls, 1);
  assert.ok(saved?.finished_result);
  await runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
    resume: saved,
  });
  assert.equal(calls, 1);
  const continued = structuredClone(saved!);
  continued.messages.push({
    role: "user",
    content: "Here is the answer to your question.",
  });
  await runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
    resume: continued,
    checkpoint: async () => {},
  });
  assert.equal(
    calls,
    2,
    "a new person answer must not replay the finished loop forever",
  );
  allowed = false;
  await assert.rejects(
    runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
      resume: saved,
    }),
    /source revoked/,
  );
});
test("parallel private loops share the adapter but never the operation identity", async () => {
  const ids: string[] = [];
  const ai = {
    ...base,
    textTransport: async (
      _wire: unknown,
      _signal: AbortSignal,
      id?: string,
    ) => {
      assert.ok(id);
      ids.push(id);
      return "Independent answer.";
    },
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
        checkpoint: async () => {},
      }),
    ),
  );
  assert.equal(results.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test("finished context identity matches the bounded checkpoint projection", async () => {
  let saved: AgentLoopCheckpoint | undefined,
    calls = 0;
  const ai = {
    ...base,
    textTransport: async () => {
      calls++;
      return "Bounded answer.";
    },
  };
  const message = "x".repeat(7000);
  await runAgent(ai, context(), message, [], {}, undefined, undefined, {
    checkpoint: async (v) => {
      saved = structuredClone(v);
    },
  });
  assert.equal(
    saved!.messages.find((m) => m.role === "user")!.content.length,
    4000,
  );
  await runAgent(ai, context(), message, [], {}, undefined, undefined, {
    resume: saved,
  });
  assert.equal(calls, 1);
});

test("an interrupted private slot keeps its budget reservation instead of charging it again", async () => {
  let saved: AgentLoopCheckpoint | undefined,
    crash = true;
  const firstBudget = { limit: 100000, used: 0 };
  const text = "Recovered budget answer.";
  const ai = {
    ...base,
    textTransport: async () => {
      if (crash) throw new Error("process died");
      return text;
    },
  };
  await assert.rejects(
    runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
      tokenBudget: firstBudget,
      checkpoint: async (v) => {
        saved = structuredClone(v);
      },
    }),
    /process died/,
  );
  assert.ok(saved!.pending_provider!.reservation_charged);
  const reserved = firstBudget.used,
    recoveredBudget = { ...firstBudget };
  crash = false;
  await runAgent(ai, context(), "Read", [], {}, undefined, undefined, {
    resume: saved,
    tokenBudget: recoveredBudget,
    checkpoint: async () => {},
  });
  assert.equal(
    recoveredBudget.used,
    reserved - 8192 + Math.ceil(Buffer.byteLength(text + "[]") / 4),
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/modules/ai/agent/loop.js";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";

test("revoked admitted context stops before any provider transmission", async () => {
  let transmissions = 0;
  const ai: ResolvedAi = {
    kind: "chatgpt_plan",
    format: "openai",
    baseUrl: "",
    apiKey: "",
    model: "fixture-model",
    options: {},
    source: "database",
    structuredOutput: "json_schema",
    textTransport: async () => {
      transmissions++;
      return "Must not be sent";
    },
  };
  const context = {
    user: {
      id: "00000000-0000-4000-8000-000000000000",
      role: "member" as const,
    },
    timezone: "UTC",
    intentText: "Explain",
    actions: [],
    clarification: null,
  };
  await assert.rejects(
    runAgent(
      ai,
      context,
      "Explain",
      [{ role: "assistant", content: "Private admitted history" }],
      {},
      undefined,
      undefined,
      {
        beforeProvider: async () => {
          throw new Error("Context permission revoked");
        },
      },
    ),
    /Context permission revoked/,
  );
  assert.equal(transmissions, 0);
});

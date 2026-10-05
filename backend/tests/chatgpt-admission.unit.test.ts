import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiProviderChoice } from "@orbyn/core";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";
import { assistantProviderCapabilities } from "../src/modules/ai/providers/admission.js";
const choice: AiProviderChoice = {
  primary: "chatgpt",
  connection_id: "00000000-0000-4000-8000-000000000001",
  executor_id: "00000000-0000-4000-8000-000000000002",
  fallback_to_default: false,
  version: 1,
};
test("personal ChatGPT admission requires no managed provider or implicit fallback", async () => {
  let managedCalls = 0;
  const result = await assistantProviderCapabilities(
    "owner",
    async () => choice,
    async () => {
      managedCalls++;
      return null;
    },
  );
  assert.deepEqual(result, { enabled: true, tools: false });
  assert.equal(managedCalls, 0);
});
test("a revoked private binding cannot use managed admission without explicit fallback", async () => {
  let managedCalls = 0;
  const managed = async () => {
    managedCalls++;
    return { structuredOutput: undefined } as ResolvedAi;
  };
  assert.deepEqual(
    await assistantProviderCapabilities(
      "owner",
      async () => ({ ...choice, connection_id: null, executor_id: null }),
      managed,
    ),
    { enabled: false, tools: false },
  );
  assert.equal(managedCalls, 0);
  assert.deepEqual(
    await assistantProviderCapabilities(
      "owner",
      async () => ({
        ...choice,
        connection_id: null,
        executor_id: null,
        fallback_to_default: true,
      }),
      managed,
    ),
    { enabled: true, tools: false },
  );
  assert.equal(managedCalls, 1);
});
test("managed admission retains configured and structured-protocol capability behavior", async () => {
  const read = async () => ({
    ...choice,
    primary: "default" as const,
    connection_id: null,
    executor_id: null,
  });
  assert.deepEqual(
    await assistantProviderCapabilities("owner", read, async () => null),
    { enabled: false, tools: false },
  );
  assert.deepEqual(
    await assistantProviderCapabilities(
      "owner",
      read,
      async () => ({ structuredOutput: "json_schema" }) as ResolvedAi,
    ),
    { enabled: true, tools: false },
  );
  assert.deepEqual(
    await assistantProviderCapabilities(
      "owner",
      read,
      async () => ({}) as ResolvedAi,
    ),
    { enabled: true, tools: true },
  );
});

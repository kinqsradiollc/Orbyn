import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aiProviderChoiceInput, aiProviderChoice } from "@orbyn/core";
test("fallback is explicit and revocation preserves an unavailable ChatGPT choice", () => {
  assert.equal(
    aiProviderChoiceInput.safeParse({
      primary: "default",
      fallback_to_default: true,
      expected_version: 0,
    }).success,
    false,
  );
  assert.equal(
    aiProviderChoiceInput.safeParse({
      primary: "chatgpt",
      fallback_to_default: true,
      expected_version: 0,
    }).success,
    false,
  );
  assert.ok(
    aiProviderChoice.parse({
      primary: "chatgpt",
      connection_id: null,
      executor_id: null,
      fallback_to_default: false,
      version: 2,
    }),
  );
});
test("chat loop uses user routing; only known admission failures can change billing", async () => {
  const routing = await readFile(
    new URL("../src/modules/ai/providers/user-choice.ts", import.meta.url),
    "utf8",
  );
  assert.ok(routing.includes('result.phase === "admission"'));
  assert.ok(routing.includes("choice.fallback_to_default"));
  assert.ok(routing.includes("completion is unknown"));
  const run = await readFile(
    new URL("../src/modules/ai/agent/run.ts", import.meta.url),
    "utf8",
  );
  assert.ok(run.includes("await resolveUserAi(user.id, jobId"));
  const protocol = await readFile(
    new URL("../src/modules/ai/agent/protocol.ts", import.meta.url),
    "utf8",
  );
  assert.ok(protocol.includes("ai.operationId"));
});

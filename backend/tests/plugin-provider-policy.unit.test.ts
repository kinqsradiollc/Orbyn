import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Principal } from "../src/capabilities/policy.js";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";
import {
  assertPluginManagedProvider,
  callPluginManagedProvider,
  pluginInferenceInput,
  type PluginManagedPermission,
} from "../src/modules/plugin/provider-policy.js";

function fixture() {
  const permission: PluginManagedPermission = {
    user_id: randomUUID(),
    grant_id: randomUUID(),
    client_id: "https://host.invalid/client",
    version: 1,
    enabled: true,
    provider_id: randomUUID(),
    provider_revision: "captured-revision",
    model: "fixture-model",
    max_output_tokens: 512,
    daily_call_limit: 10,
  };
  const principal = {
    via: "plugin",
    user: { id: permission.user_id, name: "Person", role: "member" },
    grant_id: permission.grant_id,
    client: { id: permission.client_id, name: "Plugin" },
  } as Principal;
  const ai: ResolvedAi = {
    kind: "openai",
    format: "openai",
    source: "database",
    model: permission.model,
    baseUrl: "https://provider.invalid/v1",
    apiKey: "private-test-key",
    options: {},
    providerId: permission.provider_id,
    providerRevision: permission.provider_revision,
  };
  return {
    permission,
    principal,
    ai,
    input: { operation_id: randomUUID(), prompt: "Untrusted host text" },
  };
}

test("plugin inference host input cannot supply authority, endpoints or credentials", () => {
  const { input } = fixture();
  for (const field of [
    "user_id",
    "grant_id",
    "provider_id",
    "base_url",
    "api_key",
    "access_token",
    "model",
    "max_output_tokens",
    "callback",
    "source_refs",
  ])
    assert.equal(
      pluginInferenceInput.safeParse({ ...input, [field]: "injected" }).success,
      false,
      field,
    );
  assert.equal(
    pluginInferenceInput.safeParse({ ...input, prompt: "  " }).success,
    false,
  );
  assert.equal(
    pluginInferenceInput.safeParse({ ...input, prompt: "x".repeat(16001) })
      .success,
    false,
  );
  assert.equal(
    pluginInferenceInput.safeParse({
      ...input,
      operation_id: "not-an-operation",
    }).success,
    false,
  );
});

test("only explicit permission matching the plugin owner, grant and client admits a provider", () => {
  const f = fixture();
  assertPluginManagedProvider(f.principal, f.permission, f.ai);
  for (const permission of [
    { ...f.permission, enabled: false },
    { ...f.permission, user_id: randomUUID() },
    { ...f.permission, grant_id: randomUUID() },
    { ...f.permission, client_id: "other-client" },
    { ...f.permission, max_output_tokens: 0 },
    { ...f.permission, daily_call_limit: 101 },
  ])
    assert.throws(() =>
      assertPluginManagedProvider(f.principal, permission, f.ai),
    );
  for (const via of [
    "session",
    "oauth",
    "assistant",
    "agent_key",
    "legacy_key",
  ] as const)
    assert.throws(() =>
      assertPluginManagedProvider({ ...f.principal, via }, f.permission, f.ai),
    );
});

test("plan transports and first-party authority hooks cannot enter plugin inference", () => {
  const f = fixture();
  for (const injected of [
    { textTransport: async () => "personal plan" },
    { assertAuthority: async () => {} },
    { recordCompletion: async () => {} },
    { operationId: randomUUID() },
    { providerId: randomUUID() },
    { providerRevision: "new revision" },
    { model: "other-model" },
    { kind: "chatgpt" },
    { kind: "constructor" },
  ])
    assert.throws(() =>
      assertPluginManagedProvider(f.principal, f.permission, {
        ...f.ai,
        ...injected,
      }),
    );
  assert.throws(() =>
    assertPluginManagedProvider(f.principal, f.permission, null),
  );
});

test("managed plugin transport carries its captured output bound and sanitizes its result", async () => {
  const f = fixture();
  let checks = 0,
    calls = 0;
  const result = await callPluginManagedProvider(
    f.principal,
    f.permission,
    f.ai,
    f.input,
    async () => {
      checks++;
    },
    {
      send: async (ai, messages, options) => {
        calls++;
        assert.equal(ai.apiKey, "private-test-key");
        assert.deepEqual(messages, [{ role: "user", content: f.input.prompt }]);
        assert.equal(options?.maxOutputTokens, 512);
        assert.ok(options?.signal);
        return "Bounded answer";
      },
    },
  );
  assert.equal(checks, 2);
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    operation_id: f.input.operation_id,
    text: "Bounded answer",
    provider_id: f.permission.provider_id,
    model: f.permission.model,
    permission_version: 1,
  });
  assert.ok(!JSON.stringify(result).includes("private-test-key"));
});

test("stale permission rejects both before dispatch and before returning output", async () => {
  const f = fixture();
  let calls = 0,
    checks = 0;
  const send = async () => {
    calls++;
    return "answer";
  };
  await assert.rejects(
    callPluginManagedProvider(
      f.principal,
      f.permission,
      f.ai,
      f.input,
      async () => {
        throw new Error("revoked");
      },
      { send },
    ),
    /revoked/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    callPluginManagedProvider(
      f.principal,
      f.permission,
      f.ai,
      f.input,
      async () => {
        if (++checks === 2) throw new Error("changed permission");
      },
      { send },
    ),
    /changed permission/,
  );
  assert.equal(calls, 1);
});

test("provider failure is not retried or exposed as private upstream detail", async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(
    callPluginManagedProvider(
      f.principal,
      f.permission,
      f.ai,
      f.input,
      async () => {},
      {
        send: async () => {
          calls++;
          throw new Error("private-test-key private-account-detail");
        },
      },
    ),
    (error: any) => {
      assert.match(error.message, /outcome must be reviewed/);
      assert.doesNotMatch(
        error.message,
        /private-test-key|private-account-detail/,
      );
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("empty and excessive responses are refused without accepting a receipt", async () => {
  const f = fixture();
  for (const text of ["", "  ", "🎉".repeat(16385)])
    await assert.rejects(
      callPluginManagedProvider(
        f.principal,
        f.permission,
        f.ai,
        f.input,
        async () => {},
        { send: async () => text },
      ),
      /empty or exceeded/,
    );
});

test("captured provider and limits cannot be changed by another task during authority checking", async () => {
  const f = fixture();
  const result = await callPluginManagedProvider(
    f.principal,
    f.permission,
    f.ai,
    f.input,
    async () => {
      f.permission.max_output_tokens = 2048;
      f.permission.model = "changed-model";
      f.ai.apiKey = "changed-key";
      f.ai.textTransport = async () => {
        throw new Error("must not use plan");
      };
    },
    {
      send: async (ai, _messages, options) => {
        assert.equal(ai.apiKey, "private-test-key");
        assert.equal(ai.model, "fixture-model");
        assert.equal(ai.textTransport, undefined);
        assert.equal(options?.maxOutputTokens, 512);
        return "answer";
      },
    },
  );
  assert.equal(result.model, "fixture-model");
});

test("an aborted caller does not dispatch a provider call", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    callPluginManagedProvider(
      f.principal,
      f.permission,
      f.ai,
      f.input,
      async () => {},
      {
        signal: controller.signal,
        send: async () => {
          calls++;
          return "answer";
        },
      },
    ),
  );
  assert.equal(calls, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pluginAiPermissionInput, pluginAiPermissionView } from "@orbyn/core";
import { OrbynClient } from "@orbyn/api-client";
const provider = {
  id: randomUUID(),
  revision: "1",
  name: "Workspace provider",
  model: "fixture-model",
};
const choice = {
  id: provider.id,
  revision: provider.revision,
  model: provider.model,
};
const enable = {
  enabled: true,
  expected_version: 0,
  provider: choice,
  max_output_tokens: 512,
  daily_call_limit: 10,
};

test("plugin AI requires explicit reviewed provider and bounded allowances", () => {
  assert.equal(pluginAiPermissionInput.safeParse(enable).success, true);
  for (const field of ["provider", "max_output_tokens", "daily_call_limit"]) {
    const input = { ...enable } as Record<string, unknown>;
    delete input[field];
    assert.equal(
      pluginAiPermissionInput.safeParse(input).success,
      false,
      field,
    );
  }
  for (const input of [
    { ...enable, max_output_tokens: 2049 },
    { ...enable, daily_call_limit: 101 },
    { ...enable, expected_version: -1 },
    { ...enable, access_token: "secret" },
    { ...enable, provider: { ...choice, api_key: "secret" } },
  ])
    assert.equal(pluginAiPermissionInput.safeParse(input).success, false);
});
test("revocation cannot implicitly replace or authorize a provider", () => {
  assert.equal(
    pluginAiPermissionInput.safeParse({ enabled: false, expected_version: 2 })
      .success,
    true,
  );
  assert.equal(
    pluginAiPermissionInput.safeParse({ ...enable, enabled: false }).success,
    false,
  );
});
test("active permission must match the currently advertised workspace configuration", () => {
  const view = {
    grant_id: randomUUID(),
    enabled: true,
    active: true,
    version: 1,
    provider,
    available_provider: provider,
    max_output_tokens: 512,
    daily_call_limit: 10,
  };
  pluginAiPermissionView.parse(view);
  for (const available_provider of [
    null,
    { ...provider, revision: "2" },
    { ...provider, model: "other" },
  ])
    assert.equal(
      pluginAiPermissionView.safeParse({ ...view, available_provider }).success,
      false,
    );
  assert.equal(
    pluginAiPermissionView.safeParse({ ...view, enabled: false }).success,
    false,
  );
  assert.equal(
    pluginAiPermissionView.safeParse({ ...view, access_token: "secret" })
      .success,
    false,
  );
});
test("permission client reads without stale cache and validates before sending consent", async () => {
  const grant_id = randomUUID();
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "session",
    fetch: async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).has("if-none-match"), false);
      return Response.json({
        grant_id,
        enabled: false,
        active: false,
        version: 0,
        provider: null,
        available_provider: provider,
        max_output_tokens: 512,
        daily_call_limit: 10,
      });
    },
  });
  await client.pluginAiPermission(grant_id);
  await client.pluginAiPermission(grant_id);
  assert.equal(calls, 2);
  await assert.rejects(
    client.setPluginAiPermission(grant_id, {
      enabled: true,
      expected_version: 0,
    }),
  );
  assert.equal(calls, 2);
});

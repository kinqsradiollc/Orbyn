import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
import {
  agendaPrivateEnablementMessage,
  chatgptCatalogRead,
} from "@orbyn/core";
import { randomUUID } from "node:crypto";

test("catalog capability omission never implies bounded scheduled inference", () => {
  const binding = {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  const value = {
    executor_id: randomUUID(),
    binding,
    status: "ready",
    models: [],
    preference: { binding, model: null, version: 0 },
    published_at: null,
    expires_at: null,
    sequence: 0,
  };
  assert.equal(
    chatgptCatalogRead
      .parse(value)
      .capabilities?.includes("plan_inference_limits_v1") === true,
    false,
  );
  assert.deepEqual(
    chatgptCatalogRead.parse({ ...value, capabilities: ["plan_inference_v1"] })
      .capabilities,
    ["plan_inference_v1"],
  );
  assert.deepEqual(
    chatgptCatalogRead.parse({
      ...value,
      capabilities: ["plan_inference_v1", "plan_inference_limits_v1"],
    }).capabilities,
    ["plan_inference_v1", "plan_inference_limits_v1"],
  );
  assert.throws(() =>
    chatgptCatalogRead.parse({ ...value, capabilities: ["invented_limit"] }),
  );
});

test("scheduled settings refresh status and permission without cached authority and validate writes before dispatch", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const controller = new AbortController();
  let badReply = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "app-session",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/private-summary"))
        return Response.json(
          badReply ? { run: null, snapshot: "forbidden" } : { run: null },
        );
      return Response.json({
        id: null,
        enabled: false,
        active: false,
        version: 0,
        model: null,
      });
    },
  });
  await client.agendaPrivatePermission(controller.signal);
  await client.agendaPrivatePermission(controller.signal);
  await client.agendaPrivateSummary(controller.signal);
  await client.agendaPrivateSummary(controller.signal);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every((c) => !new Headers(c.init?.headers).has("if-none-match")),
  );
  await client.setAgendaPrivatePermission(
    {
      enabled: false,
      expected_version: 0,
      expected_provider_choice_version: 1,
    },
    controller.signal,
  );
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), {
    enabled: false,
    expected_version: 0,
    expected_provider_choice_version: 1,
  });
  const before = calls.length;
  await assert.rejects(
    client.setAgendaPrivatePermission({
      enabled: false,
      expected_version: 0,
      expected_provider_choice_version: 1,
      user_id: "other-owner",
    } as any),
  );
  assert.equal(calls.length, before);
  badReply = true;
  await assert.rejects(client.agendaPrivateSummary(controller.signal));
  assert.ok(
    calls.every(
      (c) =>
        new Headers(c.init?.headers).get("authorization") ===
        "Bearer app-session",
    ),
  );
});

test("both clients explain missing scheduling prerequisites and require both signed capabilities", () => {
  const catalog = {
    status: "ready",
    models: [{ slug: "selected" }],
    preference: { model: "selected" },
    capabilities: ["plan_inference_v1", "plan_inference_limits_v1"],
  };
  const data = { choice: { primary: "chatgpt" }, catalog };
  assert.equal(agendaPrivateEnablementMessage(data), null);
  assert.equal(
    agendaPrivateEnablementMessage({ ...data, choice: { primary: "default" } }),
    "Choose ChatGPT as your provider.",
  );
  assert.equal(
    agendaPrivateEnablementMessage({ ...data, catalog: null }),
    "Reconnect your ChatGPT device.",
  );
  assert.equal(
    agendaPrivateEnablementMessage({
      ...data,
      catalog: { ...catalog, status: "offline" },
    }),
    "Reconnect your ChatGPT device.",
  );
  assert.equal(
    agendaPrivateEnablementMessage({
      ...data,
      catalog: { ...catalog, preference: { model: "removed" } },
    }),
    "Choose an available ChatGPT model.",
  );
  for (const capabilities of [
    undefined,
    [],
    ["plan_inference_v1"],
    ["plan_inference_limits_v1"],
  ]) {
    assert.equal(
      agendaPrivateEnablementMessage({
        ...data,
        catalog: { ...catalog, capabilities },
      }),
      "This connection cannot enforce scheduled-run limits.",
    );
  }
});

test("scheduled catalog capability reads explicitly opt in while ordinary model reads retain their query contract", async () => {
  const connection_id = randomUUID(),
    executor_id = randomUUID();
  const binding = {
    user_id: randomUUID(),
    connection_id,
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  const calls: URL[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "app-session",
    fetch: async (url) => {
      const query = new URL(String(url));
      calls.push(query);
      return Response.json({
        executor_id,
        binding,
        status: "ready",
        models: [],
        preference: { binding, model: null, version: 0 },
        published_at: null,
        expires_at: null,
        sequence: 0,
        ...(query.searchParams.has("include_capabilities")
          ? { capabilities: ["plan_inference_v1"] }
          : {}),
      });
    },
  });
  const ordinary = await client.chatgptModels({ connection_id, executor_id });
  const scheduled = await client.chatgptModels(
    { connection_id, executor_id },
    undefined,
    true,
  );
  assert.equal(calls[0].searchParams.has("include_capabilities"), false);
  assert.equal(calls[1].searchParams.get("include_capabilities"), "1");
  assert.equal(ordinary.capabilities, undefined);
  assert.deepEqual(scheduled.capabilities, ["plan_inference_v1"]);
  assert.equal(
    scheduled.capabilities?.includes("plan_inference_limits_v1"),
    false,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrbynClient } from "@orbyn/api-client";

const selection = { connection_id: randomUUID(), executor_id: randomUUID() };
const binding = {
  user_id: randomUUID(),
  connection_id: selection.connection_id,
  issuer: "https://auth.openai.com" as const,
  subject: "fixture",
  client_id: "fixture-issued-client",
};
const preference = { binding, model: null, version: 0 };
const state = {
  executor_id: selection.executor_id,
  binding,
  status: "ready",
  models: [{ slug: "model-a", display_name: "A" }],
  preference,
  published_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 120_000).toISOString(),
  sequence: 1,
};

test("catalog client refreshes presence and validates exact selection/default responses", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  let response = state;
  let badDefault = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "orbyn-session",
    fetch: async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      if (init?.method === "PUT") {
        const input = JSON.parse(String(init.body));
        return Response.json({
          ...input.preference,
          version: badDefault ? 99 : input.preference.version + 1,
        });
      }
      return Response.json(response);
    },
  });
  assert.equal((await client.chatgptModels(selection)).status, "ready");
  response = { ...state, status: "offline" };
  assert.equal((await client.chatgptModels(selection)).status, "offline");
  assert.equal(
    calls.length,
    2,
    "catalog presence is never served from the read cache",
  );
  assert.equal(calls[0].url.pathname, "/models");
  assert.equal(
    calls[0].url.searchParams.get("connection_id"),
    selection.connection_id,
  );
  assert.equal(
    calls[0].url.searchParams.get("executor_id"),
    selection.executor_id,
  );
  const update = { selection, preference: { ...preference, model: "model-a" } };
  assert.equal((await client.selectChatgptDefault(update)).version, 1);
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), update);
  badDefault = true;
  await assert.rejects(client.selectChatgptDefault(update), /response changed/);
  response = { ...state, executor_id: randomUUID() };
  await assert.rejects(client.chatgptModels(selection), /selection changed/);
  response = { ...state, access_token: "must-not-return" } as typeof state;
  await assert.rejects(client.chatgptModels(selection));
  assert.ok(
    calls.every(
      (c) =>
        new Headers(c.init?.headers).get("authorization") ===
        "Bearer orbyn-session",
    ),
  );
});

test("executor publication client rejects credentials before sending and parses bounded public receipts", async () => {
  let count = 0;
  const catalog = {
    executor_id: selection.executor_id,
    binding,
    lease_epoch: 1,
    sequence: 1,
    models: [],
  };
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "orbyn-session",
    fetch: async (_url, init) => {
      count++;
      assert.equal(
        JSON.stringify(JSON.parse(String(init?.body))).includes("access_token"),
        false,
      );
      return Response.json({
        executor_id: selection.executor_id,
        lease_epoch: 1,
        sequence: 1,
        published_at: new Date().toISOString(),
      });
    },
  });
  const input = { catalog, signature: "A".repeat(86) };
  assert.equal((await client.publishChatgptModels(input)).sequence, 1);
  await assert.rejects(
    client.publishChatgptModels({
      ...input,
      access_token: "forbidden",
    } as typeof input),
  );
  await assert.rejects(
    client.beginChatgptExecutorLease({
      executor_id: selection.executor_id,
      proof_message: "arbitrary",
    } as { executor_id: string }),
  );
  assert.equal(count, 1);
});

test("device discovery always reads fresh and rejects secret or malformed metadata", async () => {
  const entry = {
    executor_id: selection.executor_id,
    connection_id: selection.connection_id,
    host_id: randomUUID(),
  };
  let count = 0;
  let body: unknown = [entry];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "orbyn-session",
    fetch: async (input) => {
      assert.equal(
        new URL(String(input)).pathname,
        "/ai/connections/chatgpt/executors",
      );
      count++;
      return Response.json(body);
    },
  });
  assert.deepEqual(await client.chatgptExecutors(), [entry]);
  assert.deepEqual(await client.chatgptExecutors(), [entry]);
  assert.equal(count, 2);
  body = [{ ...entry, public_key: "must-not-be-returned" }];
  await assert.rejects(client.chatgptExecutors());
  body = [{ ...entry, executor_id: "invalid" }];
  await assert.rejects(client.chatgptExecutors());
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrbynClient } from "@orbyn/api-client";

const id = randomUUID();
const identity = {
  id,
  issuer: "https://auth.openai.com",
  subject: "fixture",
  client_id: "oaiapp_fixture",
};
test("connection client sends only identity proof and validates uncached metadata", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "orbyn-session",
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, init });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/challenges"))
        return Response.json({
          id,
          nonce: "fixture-nonce-1234567890",
          expires_at: new Date().toISOString(),
        });
      if (path.endsWith("/complete")) return Response.json(identity);
      return Response.json([
        { ...identity, verified_at: new Date().toISOString() },
      ]);
    },
  });
  await client.startChatgptConnection();
  const linked = await client.finishChatgptConnection({
    challenge_id: id,
    client_id: identity.client_id,
    id_token: "fixture-id-proof",
  });
  assert.deepEqual(linked, identity);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    challenge_id: id,
    client_id: identity.client_id,
    id_token: "fixture-id-proof",
  });
  assert.equal((await client.chatgptConnections())[0].id, id);
  await client.chatgptConnections();
  assert.equal(
    calls.filter((c) => c.path === "/ai/connections/chatgpt").length,
    2,
  );
  await client.revokeChatgptConnection(id);
  assert.equal(calls.at(-1)?.init?.method, "DELETE");
  assert.ok(
    calls.every(
      (c) =>
        new Headers(c.init?.headers).get("authorization") ===
        "Bearer orbyn-session",
    ),
  );
});
test("connection client refuses unexpected plan tokens and invalid server metadata", async () => {
  let count = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async () => {
      count++;
      return Response.json([
        {
          ...identity,
          verified_at: new Date().toISOString(),
          access_token: "must-not-escape",
        },
      ]);
    },
  });
  await assert.rejects(
    client.startChatgptConnection({ access_token: "forbidden" } as never),
  );
  await assert.rejects(
    client.finishChatgptConnection({
      challenge_id: id,
      client_id: identity.client_id,
      id_token: "fixture",
      refresh_token: "forbidden",
    } as never),
  );
  assert.equal(count, 0);
  await assert.rejects(client.chatgptConnections());
});

test("refresh identity client sends only proof and rejects a substituted connection", async () => {
  let replace = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "owned-session",
    fetch: async (url, init) => {
      assert.equal(
        new URL(String(url)).pathname,
        "/ai/connections/chatgpt/refresh-identity",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        connection_id: id,
        id_token: "proof-only",
      });
      return Response.json({
        ...identity,
        ...(replace ? { id: randomUUID() } : {}),
      });
    },
  });
  assert.deepEqual(
    await client.verifyChatgptRefreshIdentity({
      connection_id: id,
      id_token: "proof-only",
    }),
    identity,
  );
  replace = true;
  await assert.rejects(
    client.verifyChatgptRefreshIdentity({
      connection_id: id,
      id_token: "proof-only",
    }),
    /registration changed/,
  );
  await assert.rejects(
    client.verifyChatgptRefreshIdentity({
      connection_id: id,
      id_token: "proof-only",
      access_token: "forbidden",
    } as never),
  );
});

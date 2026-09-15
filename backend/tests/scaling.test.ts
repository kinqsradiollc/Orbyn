import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { randomUUID } from "node:crypto";

// Use the test database as a stand-in "replica" so reads take the replica path.
process.env.DATABASE_READ_URL = process.env.TEST_DATABASE_URL;
const { buildApp } = await import("../src/app.js");
const { pool, readPool, reader, closeDatabase } =
  await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { OrbynClient } = await import("@orbyn/api-client");
const app = await buildApp();
let token = "";
let userId = "";

before(async () => {
  await migrate();
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `scale-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Scale",
    },
  });
  token = r.json().token;
  userId = r.json().user.id;
});

after(async () => {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await app.close();
  await closeDatabase();
});

const auth = () => ({ authorization: `Bearer ${token}` });

test("liveness never touches the database; readiness does", async () => {
  const live = await app.inject({ url: "/live" });
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().service, "all");
  assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
});

test("unchanged GET responses answer 304 without a body", async () => {
  const first = await app.inject({ url: "/items", headers: auth() });
  const etag = first.headers.etag as string;
  assert.ok(etag?.startsWith('W/"'));
  const again = await app.inject({
    url: "/items",
    headers: { ...auth(), "if-none-match": etag },
  });
  assert.equal(again.statusCode, 304);
  assert.equal(again.body, "");
  await app.inject({
    method: "POST",
    url: "/items",
    headers: auth(),
    payload: { title: "Changes the list" },
  });
  const changed = await app.inject({
    url: "/items",
    headers: { ...auth(), "if-none-match": etag },
  });
  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, etag);
});

test("lag-tolerant reads use the replica unless the client just wrote", () => {
  assert.notEqual(readPool, pool, "a separate replica pool exists");
  assert.equal(reader({}), readPool);
  assert.equal(reader({ "x-orbyn-consistency": "primary" }), pool);
});

test("the client asks for the primary right after writing and reuses unchanged bodies", async () => {
  const seen: { method: string; headers: Record<string, string> }[] = [];
  let listCalls = 0;
  const fakeFetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ method: init?.method ?? "GET", headers });
    if (init?.method === "POST")
      return Response.json({ id: "x" }, { status: 201 });
    listCalls++;
    if (headers["If-None-Match"] === 'W/"v1"')
      return new Response(null, { status: 304 });
    return Response.json([{ title: "cached" }], {
      headers: { ETag: 'W/"v1"' },
    });
  }) as typeof fetch;
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => "t",
    fetch: fakeFetch,
  });

  const first = await client.request<{ title: string }[]>("/items");
  first[0].title = "mutated by caller";
  const second = await client.request<{ title: string }[]>("/items");
  assert.equal(listCalls, 2);
  assert.equal(seen[1].headers["If-None-Match"], 'W/"v1"');
  assert.equal(
    second[0].title,
    "cached",
    "the remembered copy is not shared with callers",
  );
  assert.equal(seen[1].headers["X-Orbyn-Consistency"], undefined);

  await client.request("/items", { method: "POST", body: { title: "new" } });
  await client.request("/items");
  assert.equal(seen.at(-1)!.headers["X-Orbyn-Consistency"], "primary");
});

test("reads are retried once while a server copy restarts; writes never are", async () => {
  const { OrbynClient } = await import("@orbyn/api-client");
  let calls = 0;
  const flaky = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    if (calls === 1) return new Response("{}", { status: 503 });
    return Response.json(
      init?.method === "POST" ? { id: "x" } : [{ ok: true }],
    );
  }) as typeof fetch;
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => "t",
    fetch: flaky,
  });
  assert.deepEqual(await client.request("/items"), [{ ok: true }]);
  assert.equal(calls, 2, "the read was retried once");

  calls = 0;
  await assert.rejects(() =>
    client.request("/items", { method: "POST", body: {} }),
  );
  assert.equal(calls, 1, "the write was not retried");

  calls = 0;
  const dropped = (async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return Response.json([]);
  }) as typeof fetch;
  const again = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => "t",
    fetch: dropped,
  });
  assert.deepEqual(await again.request("/items"), []);
  assert.equal(calls, 2, "a dropped connection on a read is retried once");
});

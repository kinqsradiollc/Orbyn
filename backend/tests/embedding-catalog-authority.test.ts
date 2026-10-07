import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import "./setup.js";

const email = `embedding-catalog-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = email;
process.env.SECRETS_KEY = randomBytes(32).toString("base64");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
let hold = false;
let held: ServerResponse | undefined;
let arrived: (() => void) | undefined;
let calls = 0;
let paginated = false;
let catalogReply: unknown;
const server = createServer((req, res) => {
  calls++;
  if (paginated && !req.url?.includes("after_id=")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [{ id: "first-model" }],
        has_more: true,
        last_id: "first-model",
      }),
    );
    return;
  }
  const reply = () => {
    if (res.writableEnded) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(catalogReply ?? { data: [{ id: `${req.url}-model` }] }),
    );
  };
  if (hold) {
    held = res;
    arrived?.();
  } else reply();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const providers: string[] = [];
const owners: string[] = [];
let token: string;
let member: string;
let address = 10;
function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: object,
  auth = token,
  remoteAddress = `127.0.1.${address++}`,
) {
  return app.inject({
    method,
    url,
    remoteAddress,
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    ...(payload === undefined ? {} : { payload }),
  });
}
async function create(
  name = "Catalog fixture",
  kind: "openai" | "anthropic" | "together" = "openai",
) {
  const response = await call("POST", "/ai/providers", {
    kind,
    name,
    base_url: `${base}/original`,
    api_key: "fixture-catalog-key-12345",
  });
  assert.equal(response.statusCode, 201, response.body);
  const provider = response.json();
  providers.push(provider.id);
  return provider;
}
async function register(address: string) {
  const result = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: address,
      password: "disposable-catalog-password",
      name: "Catalog fixture",
    },
  });
  assert.equal(result.statusCode, 201, result.body);
  owners.push(result.json().user.id);
  return result.json().token as string;
}
before(async () => {
  await migrate();
  token = await register(email);
  member = await register(`catalog-member-${randomUUID()}@example.com`);
});
after(async () => {
  if (held && !held.writableEnded) held.end();
  await pool.query("DELETE FROM ai_providers WHERE id=ANY($1::uuid[])", [
    providers,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await app.close();
  await pool.end();
  server.close();
});

test("embedding catalog request enforces auth, validation and rate limits", async () => {
  const p = await create();
  assert.equal(
    (await call("POST", `/ai/providers/${p.id}/embedding-models`, {}, ""))
      .statusCode,
    401,
  );
  assert.equal(
    (await call("POST", `/ai/providers/${p.id}/embedding-models`, {}, member))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", `/ai/providers/${p.id}/embedding-models`, {
        expected_revision: "invalid",
      })
    ).statusCode,
    422,
  );
  const malformed = await app.inject({
    method: "POST",
    url: `/ai/providers/${p.id}/embedding-models`,
    remoteAddress: "127.0.3.1",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(
    (
      await call("POST", `/ai/providers/${randomUUID()}/embedding-models`, {
        expected_revision: "1",
      })
    ).statusCode,
    404,
  );
  for (let i = 0; i < 10; i++)
    await call(
      "POST",
      `/ai/providers/${p.id}/embedding-models`,
      {},
      token,
      "127.0.2.1",
    );
  assert.equal(
    (
      await call(
        "POST",
        `/ai/providers/${p.id}/embedding-models`,
        {},
        token,
        "127.0.2.1",
      )
    ).statusCode,
    429,
  );
});

test("stale embedding revision rejects before provider dispatch", async () => {
  const p = await create();
  await call("PUT", `/ai/providers/${p.id}`, { enabled: false });
  const before = calls;
  const result = await call("POST", `/ai/providers/${p.id}/embedding-models`, {
    expected_revision: p.embedding_revision,
  });
  assert.equal(result.statusCode, 409, result.body);
  assert.equal(calls, before);
});

for (const mutation of [
  "endpoint",
  "key",
  "options",
  "enabled",
  "roundtrip",
  "delete",
] as const) {
  test(`catalog rejects ${mutation} changes during fetch`, async () => {
    const p = await create();
    hold = true;
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pending = call("POST", `/ai/providers/${p.id}/embedding-models`, {
      expected_revision: p.embedding_revision,
    });
    try {
      await Promise.race([
        received,
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("Fixture not called")),
            5000,
          ).unref(),
        ),
      ]);
      if (mutation === "delete")
        assert.equal(
          (await call("DELETE", `/ai/providers/${p.id}`)).statusCode,
          204,
        );
      else {
        const changes =
          mutation === "key"
            ? { api_key: "fixture-replacement-key-12345" }
            : mutation === "options"
              ? { options: { apiVersion: "fixture-version" } }
              : mutation === "enabled"
                ? { enabled: false }
                : { base_url: `${base}/revised` };
        assert.equal(
          (await call("PUT", `/ai/providers/${p.id}`, changes)).statusCode,
          200,
        );
        if (mutation === "roundtrip")
          assert.equal(
            (
              await call("PUT", `/ai/providers/${p.id}`, {
                base_url: `${base}/original`,
              })
            ).statusCode,
            200,
          );
      }
    } finally {
      hold = false;
      arrived = undefined;
      held?.writeHead(200, { "Content-Type": "application/json" });
      held?.end(JSON.stringify({ data: [{ id: "obsolete-model" }] }));
      held = undefined;
    }
    const result = await pending;
    assert.equal(result.statusCode, 409, result.body);
    assert.ok(!result.body.includes("obsolete-model"));
  });
}

test("embedding discovery preserves assistant and semantic consent settings", async () => {
  const p = await create();
  const before = (await pool.query("SELECT * FROM ai_settings")).rows;
  const response = await call(
    "POST",
    `/ai/providers/${p.id}/embedding-models`,
    { expected_revision: p.embedding_revision },
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().provider_revision, p.embedding_revision);
  assert.equal(response.json().catalog_kind, "unclassified");
  assert.deepEqual(response.json().models, ["/original/models-model"]);
  assert.deepEqual(
    (await pool.query("SELECT * FROM ai_settings")).rows,
    before,
  );
  assert.equal(
    (await call("POST", `/ai/providers/${p.id}/embedding-models`, {}))
      .statusCode,
    400,
  );
});

test("current disabled embedding connection never dispatches discovery", async () => {
  const p = await create();
  const disabled = await call("PUT", `/ai/providers/${p.id}`, {
    enabled: false,
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  const before = calls;
  const response = await call(
    "POST",
    `/ai/providers/${p.id}/embedding-models`,
    {
      expected_revision: disabled.json().embedding_revision,
    },
  );
  assert.equal(response.statusCode, 409);
  assert.equal(calls, before);
});

test("embedding catalog errors and empty catalogs preserve settings and redact the key", async () => {
  const p = await create();
  const before = (await pool.query("SELECT * FROM ai_settings")).rows;
  try {
    catalogReply = { data: [] };
    const empty = await call("POST", `/ai/providers/${p.id}/embedding-models`, {
      expected_revision: p.embedding_revision,
    });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().models, []);
    for (const body of [
      { data: [{ id: 3 }] },
      { error: { message: "fixture-catalog-key-12345" } },
    ]) {
      catalogReply = body;
      const response = await call(
        "POST",
        `/ai/providers/${p.id}/embedding-models`,
        { expected_revision: p.embedding_revision },
      );
      assert.equal(response.statusCode, 502, response.body);
      assert.ok(!response.body.includes("fixture-catalog-key-12345"));
    }
    assert.deepEqual(
      (await pool.query("SELECT * FROM ai_settings")).rows,
      before,
    );
  } finally {
    catalogReply = undefined;
  }
});

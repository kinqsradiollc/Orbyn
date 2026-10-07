import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import "./setup.js";

const email = `catalog-admin-${randomUUID()}@example.com`;
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

test("catalog request enforces auth, validation and rate limits", async () => {
  const p = await create();
  assert.equal(
    (await call("POST", `/ai/providers/${p.id}/models`, {}, "")).statusCode,
    401,
  );
  assert.equal(
    (await call("POST", `/ai/providers/${p.id}/models`, {}, member)).statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", `/ai/providers/${p.id}/models`, {
        expected_revision: "invalid",
      })
    ).statusCode,
    422,
  );
  const malformed = await app.inject({
    method: "POST",
    url: `/ai/providers/${p.id}/models`,
    remoteAddress: "127.0.3.1",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(
    (await call("POST", `/ai/providers/${randomUUID()}/models`, {})).statusCode,
    404,
  );
  for (let i = 0; i < 10; i++)
    await call("POST", `/ai/providers/${p.id}/models`, {}, token, "127.0.2.1");
  assert.equal(
    (await call("POST", `/ai/providers/${p.id}/models`, {}, token, "127.0.2.1"))
      .statusCode,
    429,
  );
});

test("stale generation rejects before provider dispatch", async () => {
  const p = await create();
  await call("PUT", `/ai/providers/${p.id}`, { enabled: false });
  const before = calls;
  const result = await call("POST", `/ai/providers/${p.id}/models`, {
    expected_revision: p.controls_revision,
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
    const pending = call("POST", `/ai/providers/${p.id}/models`, {
      expected_revision: p.controls_revision,
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

test("same-kind connections remain independent and metadata/no-op edits preserve catalogs", async () => {
  const a = await create("First connection");
  const b = await create("Second connection");
  const renamed = await call("PUT", `/ai/providers/${a.id}`, {
    name: "Renamed connection",
  });
  assert.equal(renamed.json().controls_revision, a.controls_revision);
  const noOp = await call("PUT", `/ai/providers/${a.id}`, {
    base_url: `${base}/original`,
  });
  assert.equal(noOp.json().controls_revision, a.controls_revision);
  await call("PUT", `/ai/providers/${b.id}`, { enabled: false });
  const result = await call("POST", `/ai/providers/${a.id}/models`, {
    expected_revision: a.controls_revision,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().provider_revision, a.controls_revision);
  assert.deepEqual(result.json().models, ["/original/models-model"]);
});

test("paginated Anthropic catalog retains authority checks through the last page", async () => {
  const p = await create("Paginated connection", "anthropic");
  paginated = true;
  hold = true;
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const before = calls;
  const pending = call("POST", `/ai/providers/${p.id}/models`, {
    expected_revision: p.controls_revision,
  });
  try {
    await Promise.race([
      received,
      new Promise((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("Second page not called")),
          5000,
        ).unref(),
      ),
    ]);
    assert.equal(calls - before, 2);
    // This edit must finish while the second network response is held: no row
    // lock may span either external request.
    assert.equal(
      (await call("PUT", `/ai/providers/${p.id}`, { enabled: false }))
        .statusCode,
      200,
    );
  } finally {
    paginated = false;
    hold = false;
    arrived = undefined;
    held?.writeHead(200, { "Content-Type": "application/json" });
    held?.end(
      JSON.stringify({
        data: [{ id: "obsolete-last-model" }],
        has_more: false,
      }),
    );
    held = undefined;
  }
  const result = await pending;
  assert.equal(result.statusCode, 409, result.body);
  assert.ok(!result.body.includes("first-model"));
  assert.ok(!result.body.includes("obsolete-last-model"));
});

test("saved Together connection decodes its array catalog without changing configuration", async () => {
  const p = await create("Together catalog", "together");
  catalogReply = [
    { id: "b", type: "chat" },
    { id: "a", type: "embedding" },
    { id: "b" },
  ];
  try {
    const before = calls;
    const result = await call("POST", `/ai/providers/${p.id}/models`, {
      expected_revision: p.controls_revision,
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json().models, ["a", "b"]);
    assert.equal(result.json().provider_revision, p.controls_revision);
    assert.equal(calls - before, 1);
    const saved = (
      await pool.query(
        "SELECT kind,base_url,generation_revision::text FROM ai_providers WHERE id=$1",
        [p.id],
      )
    ).rows[0];
    assert.equal(saved.kind, "together");
    assert.equal(saved.base_url, `${base}/original`);
    assert.equal(saved.generation_revision, p.controls_revision);
    catalogReply = [{ id: "partial" }, { id: 42 }];
    const invalid = await call("POST", `/ai/providers/${p.id}/models`, {});
    assert.equal(invalid.statusCode, 502, invalid.body);
    assert.ok(!invalid.body.includes("partial"));
  } finally {
    catalogReply = undefined;
  }
});

test("saved Together array catalog is rejected if its connection changes in flight", async () => {
  const p = await create("Together authority", "together");
  hold = true;
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const pending = call("POST", `/ai/providers/${p.id}/models`, {
    expected_revision: p.controls_revision,
  });
  try {
    await Promise.race([
      received,
      new Promise((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("Together fixture not called")),
          5000,
        ).unref(),
      ),
    ]);
    assert.equal(
      (await call("PUT", `/ai/providers/${p.id}`, { enabled: false }))
        .statusCode,
      200,
    );
  } finally {
    hold = false;
    arrived = undefined;
    held?.writeHead(200, { "Content-Type": "application/json" });
    held?.end(JSON.stringify([{ id: "obsolete-together-model" }]));
    held = undefined;
  }
  const result = await pending;
  assert.equal(result.statusCode, 409, result.body);
  assert.ok(!result.body.includes("obsolete-together-model"));
});

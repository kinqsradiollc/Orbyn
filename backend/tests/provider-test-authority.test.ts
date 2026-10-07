import "./setup.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
const email = `probe-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = email;
process.env.SECRETS_KEY = randomBytes(32).toString("base64");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const key = "inert-probe-key-12345";
const success = {
  choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 7, completion_tokens: 3 },
};
let body: unknown = success;
let status = 200;
let held: ServerResponse | undefined;
let holding = false;
let arrived: (() => void) | undefined;
let calls = 0;
const answer = (res: ServerResponse) => {
  if (!res.writableEnded) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }
};
const server = createServer((_req, res) => {
  calls++;
  if (holding) {
    held = res;
    arrived?.();
  } else answer(res);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const providers: string[] = [];
const users: string[] = [];
let token: string;
let member: string;
let address = 10;
const call = (
  method: "POST" | "PUT" | "DELETE",
  url: string,
  payload?: object,
  auth = token,
  remoteAddress = `127.0.4.${address++}`,
) =>
  app.inject({
    method,
    url,
    remoteAddress,
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    ...(payload === undefined ? {} : { payload }),
  });
async function register(email: string) {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email,
      name: "Inert probe fixture",
      password: "disposable-probe-password",
    },
  });
  assert.equal(r.statusCode, 201);
  users.push(r.json().user.id);
  return r.json().token as string;
}
async function create(kind: "openai" | "anthropic" | "opencode" = "openai") {
  const r = await call("POST", "/ai/providers", {
    kind,
    name: "Inert probe fixture",
    base_url: `${base}/original`,
    api_key: key,
  });
  assert.equal(r.statusCode, 201, r.body);
  const p = r.json();
  providers.push(p.id);
  return p;
}
before(async () => {
  await migrate();
  token = await register(email);
  member = await register(`probe-member-${randomUUID()}@example.com`);
});
afterEach(() => {
  if (held && !held.writableEnded) answer(held);
  held = undefined;
  holding = false;
  arrived = undefined;
  status = 200;
  body = success;
});
after(async () => {
  if (held && !held.writableEnded) answer(held);
  await pool.query("DELETE FROM ai_providers WHERE id=ANY($1::uuid[])", [
    providers,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await app.close();
  await pool.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Mutate while the provider is waiting; no DB lock may span its request. */
async function during(
  p: any,
  mutate: () => Promise<void>,
  model = "fixture-model",
) {
  holding = true;
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const pending = call("POST", `/ai/providers/${p.id}/test`, {
    model,
    expected_revision: p.controls_revision,
  });
  await received;
  await mutate();
  answer(held!);
  holding = false;
  return pending;
}
test("provider test enforces auth, parsing, unknown IDs and rate limits", async () => {
  const p = await create();
  const route = `/ai/providers/${p.id}/test`;
  assert.equal((await call("POST", route, {}, "")).statusCode, 401);
  assert.equal((await call("POST", route, {}, member)).statusCode, 403);
  const bad = await app.inject({
    method: "POST",
    url: route,
    remoteAddress: "127.0.5.1",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(
    (
      await call("POST", route, {
        model: "fixture-model",
        expected_revision: "invalid",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call("POST", `/ai/providers/${randomUUID()}/test`, {
        model: "fixture-model",
      })
    ).statusCode,
    404,
  );
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await call(
          "POST",
          route,
          { model: "fixture-model" },
          token,
          "127.0.5.2",
        )
      ).statusCode,
      200,
    );
  assert.equal(
    (await call("POST", route, { model: "fixture-model" }, token, "127.0.5.2"))
      .statusCode,
    429,
  );
});
test("provider test checks displayed revision before dispatch and retains legacy calls", async () => {
  const p = await create();
  assert.equal(
    (await call("PUT", `/ai/providers/${p.id}`, { enabled: false })).statusCode,
    200,
  );
  const before = calls;
  assert.equal(
    (
      await call("POST", `/ai/providers/${p.id}/test`, {
        model: "fixture-model",
        expected_revision: p.controls_revision,
      })
    ).statusCode,
    409,
  );
  assert.equal(calls, before);
  const r = await call("POST", `/ai/providers/${p.id}/test`, {
    model: "fixture-model",
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ok, true);
  assert.equal(r.json().model, "fixture-model");
  assert.notEqual(r.json().provider_revision, p.controls_revision);
});
for (const change of [
  "endpoint",
  "key",
  "enabled",
  "options",
  "delete",
  "aba",
  "same-timestamp",
] as const) {
  test(`provider test rejects an in-flight ${change} change`, async () => {
    const p = await create();
    const r = await during(p, async () => {
      if (change === "delete") {
        assert.equal(
          (await call("DELETE", `/ai/providers/${p.id}`)).statusCode,
          204,
        );
        return;
      }
      const patch =
        change === "key"
          ? { api_key: "inert-replaced-key-12345" }
          : change === "enabled"
            ? { enabled: false }
            : change === "options"
              ? { options: { apiVersion: "fixture-v2" } }
              : { base_url: `${base}/changed` };
      assert.equal(
        (await call("PUT", `/ai/providers/${p.id}`, patch)).statusCode,
        200,
      );
      if (change === "aba")
        assert.equal(
          (
            await call("PUT", `/ai/providers/${p.id}`, {
              base_url: `${base}/original`,
            })
          ).statusCode,
          200,
        );
      if (change === "same-timestamp")
        await pool.query("UPDATE ai_providers SET updated_at=$2 WHERE id=$1", [
          p.id,
          p.updated_at,
        ]);
    });
    assert.equal(r.statusCode, 409, r.body);
    assert.ok(!r.body.includes(key));
    assert.equal(r.json().usage, undefined);
  });
}
for (const code of [400, 401, 403, 429, 500])
  test(`stable provider HTTP${code} reports a bound sanitized failure`, async () => {
    const p = await create();
    status = code;
    body = { error: { message: `Private failure ${key}` } };
    const r = await call("POST", `/ai/providers/${p.id}/test`, {
      model: "fixture-model",
      expected_revision: p.controls_revision,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ok, false);
    assert.equal(r.json().provider_revision, p.controls_revision);
    assert.equal(r.json().model, "fixture-model");
    assert.ok(!r.body.includes(key));
  });
test("provider failure after a revision change reports conflict rather than an old error", async () => {
  const p = await create();
  status = 401;
  body = { error: { message: `Private failure ${key}` } };
  const r = await during(p, async () => {
    assert.equal(
      (
        await call("PUT", `/ai/providers/${p.id}`, {
          base_url: `${base}/changed`,
        })
      ).statusCode,
      200,
    );
  });
  assert.equal(r.statusCode, 409);
  assert.ok(!r.body.includes(key));
});
for (const unchanged of ["metadata", "independent-provider"] as const)
  test(`provider test preserves ${unchanged} changes`, async () => {
    const p = await create();
    const other = unchanged === "independent-provider" ? await create() : p;
    const r = await during(p, async () => {
      assert.equal(
        (
          await call(
            "PUT",
            `/ai/providers/${other.id}`,
            unchanged === "metadata"
              ? { name: "Renamed fixture" }
              : { base_url: `${base}/other` },
          )
        ).statusCode,
        200,
      );
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ok, true);
    assert.equal(r.json().provider_revision, p.controls_revision);
  });
for (const [kind, model, reply] of [
  [
    "anthropic",
    "fixture-model",
    { stop_reason: "end_turn", content: [{ type: "text", text: "OK" }] },
  ],
  [
    "opencode",
    "gpt-6.1-sol",
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "OK" }],
        },
      ],
    },
  ],
  [
    "opencode",
    "gemini-3.8-flash",
    {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "OK" }] } },
      ],
    },
  ],
] as const)
  test(`native ${model} provider test also fences its accepted output`, async () => {
    const p = await create(kind);
    body = reply;
    const r = await during(
      p,
      async () => {
        assert.equal(
          (await call("PUT", `/ai/providers/${p.id}`, { enabled: false }))
            .statusCode,
          200,
        );
      },
      model,
    );
    assert.equal(r.statusCode, 409, r.body);
  });

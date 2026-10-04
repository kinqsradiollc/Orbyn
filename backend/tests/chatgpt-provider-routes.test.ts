import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork, bearer } from "./mcp-helpers.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const owners: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  assert.deepEqual(network.calls, []);
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
test("provider and inference routes require first-party sessions, valid bodies and bounded writes", async () => {
  const person = await h.register("provider-routes");
  owners.push(person.id);
  const key = (
    await h.call(person.token, "POST", "/me/api-keys", {
      name: "Provider fixture",
    })
  ).json().key;
  for (const [method, url, payload] of [
    [
      "PUT",
      "/ai/provider-choice",
      { primary: "default", fallback_to_default: false, expected_version: 0 },
    ],
    [
      "POST",
      "/ai/connections/chatgpt/inference/claim",
      { executor_id: randomUUID() },
    ],
    ["POST", "/ai/connections/chatgpt/inference/result", {}],
  ] as const) {
    assert.equal((await h.call(null, method, url, payload)).statusCode, 401);
    assert.equal((await h.call(key, method, url, payload)).statusCode, 403);
    const malformed = await app.inject({
      method,
      url,
      headers: { ...bearer(person.token), "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(
      (await h.call(person.token, method, url, { forbidden: true })).statusCode,
      422,
    );
    let limited = false;
    for (let n = 0; n < 35; n++) {
      const result = await h.call(person.token, method, url, {
        forbidden: true,
      });
      if (result.statusCode === 429) {
        limited = true;
        break;
      }
      assert.equal(result.statusCode, 422, result.body);
    }
    assert.ok(limited, `${url} must rate limit`);
  }
  assert.equal(
    (await h.call(null, "GET", "/ai/provider-choice")).statusCode,
    401,
  );
  assert.equal(
    (await h.call(key, "GET", "/ai/provider-choice")).statusCode,
    403,
  );
  const own = await h.call(person.token, "GET", "/ai/provider-choice");
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.headers["cache-control"], "no-store");
  assert.equal(own.json().primary, "default");
});

import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { buildApp } = await import("../src/app.js");
const { migrate } = await import("../src/db/migrate.js");
const { pool } = await import("../src/db/pool.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const users: string[] = [];
before(() => migrate());
after(async () => {
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
test("activity route authenticates, excludes keys, validates and bounds polling", async () => {
  const path = "/me/assistant/activity/background";
  assert.equal((await h.call(null, "GET", path)).statusCode, 401);
  const user = await h.register("activity-route");
  users.push(user.id);
  const key = (
    await h.call(user.token, "POST", "/me/api-keys", { name: "Activity test" })
  ).json() as { key: string };
  assert.equal((await h.call(key.key, "GET", path)).statusCode, 403);
  const read = await h.call(user.token, "GET", path);
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers["cache-control"], "private, no-store");
  assert.deepEqual(read.json(), {
    lane: "background",
    cursor: "0",
    has_more: false,
    last_activity_at: null,
    events: [],
  });
  assert.equal(
    (await h.call(user.token, "GET", `${path}?after=1`)).statusCode,
    400,
  );
  for (const suffix of ["?after=1.5", "?limit=101", "?owner_id=other"]) {
    const response = await h.call(user.token, "GET", path + suffix);
    assert.ok([400, 422].includes(response.statusCode), response.body);
  }
  let limited = false;
  for (let i = 0; i < 125; i++) {
    const response = await h.call(user.token, "GET", path);
    if (response.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(response.statusCode, 200);
  }
  assert.equal(limited, true);
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { defaultNightShift } from "@orbyn/core";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const ids: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
  await app.close();
  await pool.end();
});
async function person() {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `night-${randomUUID()}@example.test`,
      password: "a-long-test-password",
      name: "Night tester",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const { user, token } = response.json();
  ids.push(user.id);
  return {
    id: user.id as string,
    headers: { authorization: `Bearer ${token}` },
  };
}
test("night settings are off until opted in, use the workday and stay personal", async () => {
  const owner = await person();
  const other = await person();
  assert.equal(
    (await app.inject({ url: "/me/assistant/night-shift" })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/me/assistant/night-shift",
        payload: defaultNightShift(),
      })
    ).statusCode,
    401,
  );
  await pool.query(
    "INSERT INTO planner_prefs(user_id, timezone, work_start, work_end) VALUES($1, 'Australia/Melbourne', '07:30', '23:30') ON CONFLICT(user_id) DO UPDATE SET timezone = EXCLUDED.timezone, work_start = EXCLUDED.work_start, work_end = EXCLUDED.work_end",
    [owner.id],
  );
  const initial = await app.inject({
    url: "/me/assistant/night-shift",
    headers: owner.headers,
  });
  assert.equal(initial.statusCode, 200, initial.body);
  const defaults = initial.json();
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.start, "00:30");
  assert.equal(defaults.end, "06:30");
  assert.equal(defaults.timezone, "Australia/Melbourne");
  assert.equal(defaults.wait_for_ok, true);
  assert.ok(Object.values(defaults.kinds).every(Boolean));
  const saved = {
    ...defaults,
    enabled: true,
    start: "22:00",
    end: "07:00",
    wait_for_ok: false,
    kinds: { ...defaults.kinds, study: false },
  };
  const update = await app.inject({
    method: "PUT",
    url: "/me/assistant/night-shift",
    headers: owner.headers,
    payload: saved,
  });
  assert.equal(update.statusCode, 200, update.body);
  assert.deepEqual(
    (
      await app.inject({
        url: "/me/assistant/night-shift",
        headers: owner.headers,
      })
    ).json(),
    saved,
  );
  assert.equal(
    (
      await app.inject({
        url: "/me/assistant/night-shift",
        headers: other.headers,
      })
    ).json().enabled,
    false,
  );
  for (const payload of [
    { ...saved, timezone: "not-a-zone" },
    { ...saved, start: "25:00" },
    { ...saved, end: saved.start },
    { ...saved, user_id: other.id },
  ]) {
    const invalid = await app.inject({
      method: "PUT",
      url: "/me/assistant/night-shift",
      headers: owner.headers,
      payload,
    });
    assert.equal(invalid.statusCode, 422, invalid.body);
  }
});

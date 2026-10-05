import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
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

test("Agenda rewrite reports failed private summaries and requires authentication", async () => {
  const person = await h.register("agenda-summary-routes");
  owners.push(person.id);
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider) VALUES($1,'chatgpt')",
    [person.id],
  );
  const url = "/ai/agenda/today";
  assert.equal((await h.call(null, "POST", url, {})).statusCode, 401);
  const malformed = await app.inject({
    method: "POST",
    url,
    headers: { ...bearer(person.token), "content-type": "application/json" },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  const response = await h.call(person.token, "POST", url, {});
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().brief, false);
  assert.equal(response.json().briefing.status, "failed");
  assert.equal(response.json().briefing.provider, undefined);
  assert.equal(response.json().user_id, person.id);
  assert.equal(response.json().kind, "agenda");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [person.id],
      )
    ).rows[0].n,
    0,
  );
});

test("API keys cannot authorize an AI Agenda rewrite or private ChatGPT execution", async () => {
  const person = await h.register("agenda-key-routes");
  owners.push(person.id);
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider) VALUES($1,'chatgpt')",
    [person.id],
  );
  const key = (
    await h.call(person.token, "POST", "/me/api-keys", {
      name: "Agenda fixture",
    })
  ).json().key;
  const response = await h.call(key, "POST", "/ai/agenda/today", {});
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE user_id=$1",
        [person.id],
      )
    ).rows[0].n,
    0,
  );
});

test("a disabled account cannot rewrite an Agenda or transmit its facts", async () => {
  const person = await h.register("agenda-disabled-routes");
  owners.push(person.id);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [person.id]);
  const response = await h.call(person.token, "POST", "/ai/agenda/today", {});
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE user_id=$1",
        [person.id],
      )
    ).rows[0].n,
    0,
  );
});

test("AI Agenda rewrite is rate limited", async () => {
  const person = await h.register("agenda-limited-routes");
  owners.push(person.id);
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider) VALUES($1,'chatgpt')",
    [person.id],
  );
  let limited = false;
  for (let n = 0; n < 12; n++) {
    const response = await h.call(person.token, "POST", "/ai/agenda/today", {});
    if (response.statusCode === 429) {
      limited = true;
      break;
    }
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.ok(limited);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [person.id],
      )
    ).rows[0].n,
    0,
  );
});

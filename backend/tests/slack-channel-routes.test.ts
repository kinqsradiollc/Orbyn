import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { helpers, trapNetwork } from "./mcp-helpers.js";
import { slackChannelStatus } from "@orbyn/core";
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

test("mounted Slack installation endpoints expose only owner mapping and fail closed when unconfigured", async () => {
  const person = await h.register("channel-status");
  owners.push(person.id);
  const key = (
    await h.call(person.token, "POST", "/me/api-keys", {
      name: "channel fixture",
    })
  ).json().key;
  assert.equal(
    (await h.call(null, "GET", "/agent-channels/slack")).statusCode,
    401,
  );
  assert.equal(
    (await h.call(key, "GET", "/agent-channels/slack")).statusCode,
    403,
  );
  const own = await h.call(person.token, "GET", "/agent-channels/slack");
  assert.equal(own.statusCode, 200, own.body);
  assert.deepEqual(slackChannelStatus.parse(own.json()), {
    configured: false,
    connection: null,
  });
  assert.equal(own.headers["cache-control"], "no-store");
  assert.equal(
    (
      await h.call(
        person.token,
        "POST",
        "/agent-channels/slack/installations",
        {},
      )
    ).statusCode,
    503,
  );
  const result = await h.call(
    null,
    "GET",
    `/agent-channels/slack/callback?state=${"x".repeat(43)}&code=synthetic-code`,
  );
  assert.equal(result.statusCode, 503, result.body);
  assert.doesNotMatch(result.body, /synthetic-code|client_secret/);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM agent_channel_oauth_pending WHERE user_id=$1",
        [person.id],
      )
    ).rows[0].count,
    "0",
  );
});

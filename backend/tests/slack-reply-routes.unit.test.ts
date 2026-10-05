import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createService } from "../src/services/http.js";
import { pool } from "../src/db/pool.js";
import { createSlackReplyRoutes } from "../src/modules/agent-channels/reply-routes.js";
import { SlackInteractionError } from "../src/modules/agent-channels/slack-interactions.js";
const config = {
  clientId: "123.456",
  clientSecret: "fixture-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
const secret = "fixture-signing-secret";
function signed(value: unknown, form = false) {
  const raw = form
    ? new URLSearchParams({ payload: JSON.stringify(value) }).toString()
    : JSON.stringify(value);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    payload: raw,
    headers: {
      "content-type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`,
    },
  };
}
const button = () => ({
  type: "block_actions",
  api_app_id: config.appId,
  team: { id: "T123" },
  user: { id: "U123" },
  channel: { id: "D123" },
  container: { type: "message", message_ts: "1000.000001" },
  actions: [
    {
      type: "button",
      action_id: "orbyn.choice.0",
      value: randomUUID(),
      action_ts: "1001.000001",
    },
  ],
});
const event = () => ({
  type: "event_callback",
  api_app_id: config.appId,
  team_id: "T123",
  event_id: "Ev123",
  event: {
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "Answer",
    ts: "1001.000001",
    thread_ts: "1000.000001",
  },
});
test("real HTTP callback boundary authenticates before capture and preserves neighboring JSON parsing", async () => {
  mock.method(pool, "query", async () => ({ rows: [], rowCount: 0 }));
  let captures = 0,
    status = 0,
    enabled = true;
  const app = await createService("api", []);
  app.post("/fixture-json", async (r) => r.body);
  await app.register(
    createSlackReplyRoutes(
      async (_input, _config, _secret, deadline) => {
        captures++;
        assert.ok(deadline! > Date.now());
        if (status)
          throw new SlackInteractionError(
            status as 400 | 401 | 403 | 409 | 413,
          );
        return { received: true };
      },
      () => config,
      () => (enabled ? secret : undefined),
    ),
  );
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/interactions",
          ...signed(button(), true),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/events",
          ...signed(event()),
        })
      ).statusCode,
      200,
    );
    assert.equal(captures, 2);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/fixture-json",
          payload: { ordinary: "json" },
        })
      ).json().ordinary,
      "json",
    );
    const missing = await app.inject({
      method: "POST",
      url: "/agent-channels/slack/interactions",
      payload: "{}",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Bearer fixture",
      },
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/interactions",
          ...signed({ ...button(), api_app_id: "AOTHER" }, true),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/events",
          ...signed({ ...event(), api_app_id: "AOTHER" }),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/events",
          ...signed({ unsupported: true }),
        })
      ).statusCode,
      400,
    );
    assert.equal(captures, 2);
    status = 409;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/interactions",
          ...signed(button(), true),
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/events",
          ...signed(event()),
        })
      ).statusCode,
      200,
    );
    enabled = false;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/events",
          ...signed(event()),
        })
      ).statusCode,
      503,
    );
  } finally {
    await app.close();
    mock.restoreAll();
  }
});
test("HTTP callback challenge and ignored bot messages do not invoke capture; rate limits apply", async () => {
  mock.method(pool, "query", async () => ({ rows: [], rowCount: 0 }));
  let captures = 0;
  const app = await createService("api", []);
  await app.register(
    createSlackReplyRoutes(
      async () => {
        captures++;
        return { received: true };
      },
      () => config,
      () => secret,
    ),
  );
  try {
    const challenge = await app.inject({
      method: "POST",
      url: "/agent-channels/slack/events",
      ...signed({ type: "url_verification", challenge: "fixture" }),
    });
    assert.equal(challenge.statusCode, 200);
    assert.deepEqual(challenge.json(), { challenge: "fixture" });
    const value = event();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/agent-channels/slack/events",
          ...signed({ ...value, event: { ...value.event, bot_id: "B123" } }),
        })
      ).statusCode,
      200,
    );
    assert.equal(captures, 0);
    let limited = false;
    for (let i = 0; i < 35; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/agent-channels/slack/events",
        ...signed(value),
      });
      if (response.statusCode === 429) {
        limited = true;
        break;
      }
    }
    assert.equal(limited, true);
  } finally {
    await app.close();
    mock.restoreAll();
  }
});

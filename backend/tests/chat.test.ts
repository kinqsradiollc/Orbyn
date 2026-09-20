import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

// Capture outbound webhook posts instead of making real network calls.
const posts: { url: string; body: unknown }[] = [];
mock.method(
  globalThis,
  "fetch",
  async (url: string, init: { body: string }) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true } as Response;
  },
);

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assertChatUrl } = await import("../src/modules/chat/channel.js");
const { scanDigests } = await import("../src/worker/digest.js");
const { invalidateSettings } = await import("../src/lib/settings.js");

const app = await buildApp();
let token = "";
let userId = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  await pool
    .query("DELETE FROM system_settings WHERE key='smtp'")
    .catch(() => {});
  invalidateSettings();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `chat-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Chatter",
    },
  });
  token = reg.json().token;
  userId = reg.json().user.id;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("only real Slack/Discord https webhooks are accepted", () => {
  assert.throws(() => assertChatUrl("slack", "https://evil.test/hook"));
  assert.throws(() => assertChatUrl("slack", "http://hooks.slack.com/x"));
  assert.throws(() => assertChatUrl("discord", "https://hooks.slack.com/x"));
  assert.doesNotThrow(() =>
    assertChatUrl("slack", "https://hooks.slack.com/services/T/B/x"),
  );
  assert.doesNotThrow(() =>
    assertChatUrl("discord", "https://discord.com/api/webhooks/1/x"),
  );
});

test("connecting a webhook is validated, and the test posts the right shape", async () => {
  assert.equal(
    (
      await call("PUT", "/me/chat", {
        kind: "slack",
        url: "https://nope.test/x",
      })
    ).statusCode,
    422,
  );
  const ok = await call("PUT", "/me/chat", {
    kind: "slack",
    url: "https://hooks.slack.com/services/T/B/secret",
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().kind, "slack");
  assert.equal((await call("GET", "/me/chat")).json().kind, "slack");

  posts.length = 0;
  assert.equal((await call("POST", "/me/chat/test")).statusCode, 204);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://hooks.slack.com/services/T/B/secret");
  assert.ok("text" in (posts[0].body as object), "Slack uses { text }");
});

test("Discord uses a content field", async () => {
  await call("PUT", "/me/chat", {
    kind: "discord",
    url: "https://discord.com/api/webhooks/1/tok",
  });
  posts.length = 0;
  await call("POST", "/me/chat/test");
  assert.ok("content" in (posts[0].body as object), "Discord uses { content }");
});

test("the daily digest is posted to chat even without a mail server", async () => {
  await call("PUT", "/me/chat", {
    kind: "slack",
    url: "https://hooks.slack.com/services/T/B/secret",
  });
  await call("PUT", "/planner/prefs", {
    timezone: "UTC",
    digest: { morning: true, morning_time: "00:00" },
  });
  await pool.query("DELETE FROM digest_sends WHERE user_id=$1", [userId]);
  posts.length = 0;
  await scanDigests(new Date());
  const mine = posts.filter((p) => p.url.includes("hooks.slack.com"));
  assert.equal(mine.length, 1, "one digest posted to chat");
  assert.match((mine[0].body as { text: string }).text, /day ahead/i);
});

test("turning chat off stops the posts", async () => {
  assert.equal((await call("DELETE", "/me/chat")).statusCode, 204);
  assert.equal((await call("GET", "/me/chat")).json().kind, null);
  await pool.query("DELETE FROM digest_sends WHERE user_id=$1", [userId]);
  posts.length = 0;
  await scanDigests(new Date());
  assert.equal(posts.length, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendSlackDm,
  slackAgentMessage,
} from "../src/modules/agent-channels/slack-delivery.js";
const message = slackAgentMessage({
  event: "waiting",
  title: "<@UADMIN> *Private task*",
  question: "What next?",
  appUrl: "https://orbyn.example",
});
const opened = () => Response.json({ ok: true, channel: { id: "DFIXTURE" } });

test("Slack DM uses fixed endpoints, bot headers, owned room and plain-text accessible content", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const result = await sendSlackDm(
    "synthetic-bot-token",
    "UACTOR",
    message,
    async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1
        ? opened()
        : Response.json({
            ok: true,
            channel: "DFIXTURE",
            ts: "1234567890.123456",
          });
    },
  );
  assert.deepEqual(result, {
    state: "sent",
    channelId: "DFIXTURE",
    messageTs: "1234567890.123456",
  });
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "https://slack.com/api/conversations.open",
      "https://slack.com/api/chat.postMessage",
    ],
  );
  assert.ok(
    calls.every(
      (c) =>
        c.init?.redirect === "error" &&
        c.init.signal instanceof AbortSignal &&
        new Headers(c.init.headers).get("authorization") ===
          "Bearer synthetic-bot-token",
    ),
  );
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.channel, "DFIXTURE");
  assert.equal(body.mrkdwn, false);
  assert.equal(body.parse, "none");
  assert.equal(body.unfurl_links, false);
  assert.equal(body.unfurl_media, false);
  assert.equal(body.blocks[0].text.type, "plain_text");
  assert.equal(body.blocks[0].text.text, body.text);
  assert.equal(
    body.blocks[1].elements[0].text,
    "<https://orbyn.example/app|Open Orbyn>",
  );
  assert.doesNotMatch(
    JSON.stringify(body),
    /orbyn\.approve|response_url|"metadata"|"icon_url"/,
  );
});

test("Slack rate limit has bounded Retry-After and never retries inside the transport", async () => {
  for (const raw of ["2", "120", "999999", "bogus"]) {
    let calls = 0;
    const result = await sendSlackDm("fixture", "UACTOR", message, async () => {
      calls++;
      return new Response("private", {
        status: 429,
        headers: { "retry-after": raw },
      });
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      state: "limited",
      retryAfter:
        raw === "2" ? 5 : raw === "120" ? 120 : raw === "999999" ? 3600 : 60,
    });
  }
  let calls = 0;
  const result = await sendSlackDm("fixture", "UACTOR", message, async () =>
    ++calls === 1
      ? opened()
      : new Response("private", {
          status: 429,
          headers: { "retry-after": "30" },
        }),
  );
  assert.deepEqual(result, { state: "limited", retryAfter: 30 });
  assert.equal(calls, 2);
});

test("Slack post uncertainty, invalid receipts and private errors stay sanitized and unretried", async () => {
  for (const last of [
    () => {
      throw new Error("private-upstream-token");
    },
    () => new Response("private", { status: 500 }),
    () => Response.json({ ok: true, channel: "DOTHER", ts: "123.456" }),
    () =>
      Response.json({ ok: false, error: "internal_error", detail: "private" }),
    () => new Response("{"),
    () => new Response("x".repeat(65537)),
  ]) {
    let calls = 0;
    const result = await sendSlackDm("fixture", "UACTOR", message, async () =>
      ++calls === 1 ? opened() : last(),
    );
    assert.deepEqual(result, { state: "unknown" });
    assert.equal(calls, 2);
    assert.doesNotMatch(JSON.stringify(result), /private|token/);
  }
});

test("Slack explicit authentication refusal fails without storing upstream bodies", async () => {
  let calls = 0;
  const result = await sendSlackDm("fixture", "UACTOR", message, async () =>
    ++calls === 1
      ? opened()
      : Response.json({ ok: false, error: "token_revoked", detail: "private" }),
  );
  assert.deepEqual(result, { state: "failed" });
  assert.equal(calls, 2);
});

test("Unsafe website origins, invalid actors and oversized messages cannot dispatch", async () => {
  for (const appUrl of [
    "http://orbyn.example",
    "https://user:secret@orbyn.example",
    "https://orbyn.example#private",
    "https://orbyn.example?private=1",
  ]) {
    assert.throws(() => slackAgentMessage({ event: "done", appUrl }));
  }
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return opened();
  };
  assert.deepEqual(await sendSlackDm("fixture", "CCHANNEL", message, request), {
    state: "failed",
  });
  assert.deepEqual(
    await sendSlackDm(
      "fixture",
      "UACTOR",
      { text: "x".repeat(4001), blocks: [] },
      request,
    ),
    { state: "failed" },
  );
  assert.equal(calls, 0);
  const night = slackAgentMessage({
    event: "overnight",
    appUrl: "https://orbyn.example",
  });
  assert.equal(
    night.text,
    "Overnight results are ready\nOpen Orbyn to review.",
  );
});

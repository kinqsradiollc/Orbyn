import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createTeamsBotTokenCache,
  createTeamsTransport,
  teamsBotConfigDigest,
} from "../src/modules/agent-channels/teams-transport.js";
const config = {
  appId: randomUUID(),
  tenantId: randomUUID(),
  clientSecret: "fixture-bot-credential",
};
const target = {
  serviceUrl: "https://smba.trafficmanager.net/teams/",
  tenantId: randomUUID(),
  objectId: randomUUID(),
  conversationId: "a:private/conversation?x=1",
  userId: "29:reviewed-human",
  botId: `28:${config.appId}`,
};
const credential = () =>
  Response.json({
    token_type: "Bearer",
    access_token: "fixture.bot.token",
    expires_in: 3600,
  });
test("bot issuance uses only fixed tenant Microsoft endpoint and independent application credentials", async () => {
  let requests = 0;
  const token = createTeamsBotTokenCache(async (url, options) => {
    requests++;
    assert.equal(
      url,
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    );
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    const form = options?.body as URLSearchParams;
    assert.equal(form.get("grant_type"), "client_credentials");
    assert.equal(form.get("client_id"), config.appId);
    assert.equal(form.get("client_secret"), config.clientSecret);
    assert.equal(form.get("scope"), "https://api.botframework.com/.default");
    assert.equal(form.get("refresh_token"), null);
    assert.equal(form.get("code"), null);
    return credential();
  });
  assert.equal(await token(config), "fixture.bot.token");
  assert.equal(await token(config), "fixture.bot.token");
  assert.equal(requests, 1);
});
test("concurrent bot issuance deduplicates, expiry renews and credential rotation does not reuse cached token", async () => {
  let now = 100000,
    requests = 0;
  const token = createTeamsBotTokenCache(
    async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return credential();
    },
    () => now,
  );
  await Promise.all([token(config), token(config), token(config)]);
  assert.equal(requests, 1);
  now += 3571000;
  await token(config);
  assert.equal(requests, 2);
  await token({ ...config, clientSecret: "rotated-fixture-bot-credential" });
  assert.equal(requests, 3);
  assert.notEqual(
    teamsBotConfigDigest(config),
    teamsBotConfigDigest({ ...config, tenantId: randomUUID() }),
  );
});
test("invalid bot authority never invokes HTTP and failed issuance has no send or automatic retry", async () => {
  let calls = 0;
  const send = createTeamsTransport(async () => {
    calls++;
    throw Error("unavailable");
  });
  assert.deepEqual(
    await send({ ...config, tenantId: "attacker.example" }, target, "Status"),
    { state: "refused" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(await send(config, target, "Status"), {
    state: "unavailable",
  });
  assert.equal(calls, 1);
});
test("send uses only authenticated connector destination, encoded conversation path and bounded plain message", async () => {
  let calls = 0;
  const send = createTeamsTransport(async (url, options) => {
    calls++;
    if (calls === 1) return credential();
    assert.equal(
      url,
      `https://smba.trafficmanager.net/teams/v3/conversations/${encodeURIComponent(target.conversationId)}/activities`,
    );
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    assert.equal(
      (options?.headers as Record<string, string>).authorization,
      "Bearer fixture.bot.token",
    );
    const body = JSON.parse(options?.body as string);
    assert.equal(body.textFormat, "plain");
    assert.equal(body.text, "<b>Status</b>");
    assert.equal(body.from.id, target.botId);
    assert.equal(body.recipient.id, target.userId);
    assert.equal(body.channelData.tenant.id, target.tenantId);
    assert.equal(body.attachments, undefined);
    assert.ok(!JSON.stringify(body).includes(config.clientSecret));
    return Response.json({ id: "sent-activity" });
  });
  assert.deepEqual(await send(config, target, "<b>Status</b>"), {
    state: "sent",
    activityId: "sent-activity",
  });
  assert.equal(calls, 2);
});
test("untrusted destinations, other bot references and oversized or control-character messages are refused before credentials", async () => {
  let calls = 0;
  const send = createTeamsTransport(async () => {
    calls++;
    return credential();
  });
  for (const serviceUrl of [
    "http://smba.trafficmanager.net/teams/",
    "https://attacker.example/teams/",
    "https://smba.trafficmanager.net/teams/../v3/",
    "https://smba.trafficmanager.net/teams/?x=1",
    "https://smba.trafficmanager.net/teams/v3/",
  ]) {
    assert.deepEqual(await send(config, { ...target, serviceUrl }, "Status"), {
      state: "refused",
    });
  }
  assert.deepEqual(
    await send(config, { ...target, botId: `28:${randomUUID()}` }, "Status"),
    { state: "refused" },
  );
  assert.deepEqual(await send(config, target, "x".repeat(8001)), {
    state: "refused",
  });
  assert.deepEqual(await send(config, target, "Status\u0000private"), {
    state: "refused",
  });
  assert.equal(calls, 0);
});
test("explicit rate limit returns bounded provider delay without sending again", async () => {
  for (const [header, expected] of [
    ["15", 15],
    ["0", 1],
    ["99999", 3600],
    ["invalid", 30],
  ]) {
    let calls = 0;
    const send = createTeamsTransport(async () =>
      ++calls === 1
        ? credential()
        : new Response("", { status: 429, headers: { "retry-after": header } }),
    );
    assert.deepEqual(await send(config, target, "Status"), {
      state: "rate_limited",
      retryAfterSeconds: expected,
    });
    assert.equal(calls, 2);
  }
});
test("ambiguous send, malformed success and transport failure remain unknown without replay", async () => {
  for (const mode of ["timeout", "server", "malformed", "oversized"]) {
    let calls = 0;
    const send = createTeamsTransport(async () => {
      if (++calls === 1) return credential();
      if (mode === "timeout") throw Error("uncertain");
      if (mode === "server") return new Response("", { status: 503 });
      if (mode === "oversized") return new Response("x".repeat(32769));
      return Response.json({ not_id: "private" });
    });
    assert.deepEqual(await send(config, target, "Status"), {
      state: "unknown",
    });
    assert.equal(calls, 2);
  }
});
test("explicit unauthorized, removed or missing connector destination is refused without retry", async () => {
  for (const status of [401, 403, 404, 410]) {
    let calls = 0;
    const send = createTeamsTransport(async () =>
      ++calls === 1 ? credential() : new Response("", { status }),
    );
    assert.deepEqual(await send(config, target, "Status"), {
      state: "refused",
    });
    assert.equal(calls, 2);
  }
});
test("credential response size, type, lifetime and token contents are bounded before send", async () => {
  for (const value of [
    { token_type: "Basic", access_token: "fixture", expires_in: 3600 },
    {
      token_type: "Bearer",
      access_token: "fixture\r\nheader",
      expires_in: 3600,
    },
    { token_type: "Bearer", access_token: "x".repeat(16385), expires_in: 3600 },
    { token_type: "Bearer", access_token: "fixture", expires_in: 1 },
    { token_type: "Bearer", access_token: "fixture", expires_in: 86401 },
    "x".repeat(65537),
  ]) {
    let calls = 0;
    const send = createTeamsTransport(async () => {
      calls++;
      return typeof value === "string"
        ? new Response(value)
        : Response.json(value);
    });
    assert.deepEqual(await send(config, target, "Status"), {
      state: "unavailable",
    });
    assert.equal(calls, 1);
  }
});

test("failed credential acquisition releases the claim and emits no provider body or secret", async () => {
  let calls = 0;
  const token = createTeamsBotTokenCache(async () => {
    if (++calls === 1) throw Error(config.clientSecret);
    return credential();
  });
  await assert.rejects(token(config), (error: unknown) => {
    assert.equal((error as Error).message, "Teams bot credentials unavailable");
    assert.ok(!(error as Error).message.includes(config.clientSecret));
    return true;
  });
  assert.equal(await token(config), "fixture.bot.token");
  assert.equal(calls, 2);
});

test("complete question card is delivered as one bounded attachment with the original owned route", async () => {
  const { teamsQuestionCard } =
    await import("../src/modules/agent-channels/teams-question-card.js");
  const card = teamsQuestionCard(randomUUID(), {
    kind: "person",
    id: randomUUID(),
    question: "Choose a source?",
    choices: ["First", "Second"],
  })!;
  let requests = 0;
  const send = createTeamsTransport(async (_url, options) => {
    requests++;
    if (requests === 1) return credential();
    const body = JSON.parse(options?.body as string);
    assert.equal(body.text, "Owned update");
    assert.deepEqual(body.attachments, [card.attachment]);
    assert.equal(body.conversation.id, target.conversationId);
    assert.equal(body.recipient.id, target.userId);
    return Response.json({ id: "card-message" });
  });
  assert.deepEqual(await send(config, target, "Owned update", card), {
    state: "sent",
    activityId: "card-message",
  });
  assert.equal(requests, 2);
});
test("oversized card payload is refused before bot token acquisition or dispatch", async () => {
  const send = createTeamsTransport(async () => {
    assert.fail("No network for oversized card");
  });
  const forged = {
    attachment: {
      contentType: "application/vnd.microsoft.card.adaptive",
      content: { body: ["a".repeat(24577)] },
    },
  };
  assert.deepEqual(await send(config, target, "Owned update", forged as any), {
    state: "refused",
  });
});

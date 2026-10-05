import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatgptModels, chatgptDefaultStatus } from "@orbyn/core";
import { ChatgptPlanClient } from "@orbyn/api-client";

const catalog = {
  models: [
    {
      slug: "gpt-6.1-sol",
      display_name: "Sol",
      visibility: "list",
      secret_metadata: "not returned",
    },
    { slug: "hidden", visibility: "hidden" },
    { slug: "gpt-6-astra", display_name: "Astra", visibility: "list" },
    { slug: "gpt-6.1-sol", display_name: "Duplicate", visibility: "list" },
  ],
};
const account = {
  accountId: "account-a",
  workspaceId: "personal",
  clientId: "oaiapp_fixture_a",
};
const credential = async () => ({ ...account, accessToken: "fixture-token" });
const request = {
  model: "gpt-6.1-sol",
  input: [{ role: "user" as const, content: "hello" }],
};
const event = (type: string, rest = {}) =>
  `data: ${JSON.stringify({ type, ...rest })}\n\n`;
const done = event("response.completed", { response: { status: "completed" } });
function client(
  stream: string,
  calls: { url: string; init?: RequestInit }[] = [],
) {
  return new ChatgptPlanClient({
    account,
    credential,
    fetch: (async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith("/models")
        ? Response.json(catalog)
        : new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
    }) as typeof fetch,
  });
}

test("catalog strips hidden/extra metadata, deduplicates and preserves ordering", () => {
  assert.deepEqual(parseChatgptModels(catalog), [
    { slug: "gpt-6.1-sol", display_name: "Sol" },
    { slug: "gpt-6-astra", display_name: "Astra" },
  ]);
});
test("malformed display choices and wrong catalog shape fail closed", () => {
  assert.throws(() => parseChatgptModels({ data: [] }));
  assert.throws(() =>
    parseChatgptModels({
      models: [{ visibility: "list", slug: "bad\nslug", display_name: "Bad" }],
    }),
  );
  assert.throws(() => parseChatgptModels({ models: Array(1001).fill(null) }));
});
test("unavailable saved defaults do not choose a fallback", () => {
  const models = parseChatgptModels(catalog);
  assert.deepEqual(chatgptDefaultStatus(models, "old"), {
    status: "unavailable",
    slug: "old",
  });
  assert.deepEqual(chatgptDefaultStatus(models, null), {
    status: "unselected",
  });
  assert.equal(chatgptDefaultStatus(models, "gpt-6.1-sol").status, "available");
});
test("plan requests use the fixed endpoint, supported fields and observed completion", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const deltas: string[] = [];
  const result = await client(
    event("response.output_text.delta", { delta: "Hi" }) + done,
    calls,
  ).complete(
    { ...request, ...{ background: true } },
    { onText: (x) => deltas.push(x) },
  );
  assert.equal(result, "Hi");
  assert.deepEqual(deltas, ["Hi"]);
  assert.deepEqual(
    calls.map((x) => x.url),
    ["https://api.openai.com/v1/models", "https://api.openai.com/v1/responses"],
  );
  assert.deepEqual(JSON.parse(calls[1].init!.body as string), {
    ...request,
    store: false,
    stream: true,
  });
  assert.equal(calls[1].init!.redirect, "error");
  assert.equal(calls[1].init!.credentials, "omit");
});
test("a non-entitled model is rejected before inference", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await assert.rejects(
    client(done, calls).complete({ ...request, model: "hidden" }),
    /unavailable/,
  );
  assert.equal(calls.length, 1);
});
test("account/workspace switches never send credentials to another binding", async () => {
  let called = false;
  const c = new ChatgptPlanClient({
    account,
    credential: async () => ({ ...(await credential()), workspaceId: "team" }),
    fetch: (async () => {
      called = true;
      return Response.json(catalog);
    }) as typeof fetch,
  });
  await assert.rejects(c.models(), /account changed/);
  assert.equal(called, false);
});
test("another OAuth registration cannot reuse a selected account's plan client", async () => {
  let calls = 0;
  const c = new ChatgptPlanClient({
    account,
    credential: async () => ({
      ...(await credential()),
      clientId: "oaiapp_fixture_b",
    }),
    fetch: async () => {
      calls++;
      return Response.json(catalog);
    },
  });
  await assert.rejects(c.models(), /account changed/);
  assert.equal(calls, 0);
  assert.throws(
    () =>
      new ChatgptPlanClient({
        account: { ...account, clientId: "dynamic_agent_client" },
        credential,
      }),
    /account/,
  );
});
test("partial output, DONE without completion and incomplete events are not success", async () => {
  for (const stream of [
    event("response.output_text.delta", { delta: "partial" }),
    "data: [DONE]\n\n",
    event("response.incomplete"),
  ])
    await assert.rejects(client(stream).complete(request), /complet/);
});
test("provider errors never echo credentials or provider response bodies", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const c = new ChatgptPlanClient({
      account,
      credential,
      fetch: (async () =>
        new Response("fixture-token sensitive", { status })) as typeof fetch,
    });
    await assert.rejects(
      c.models(),
      (e: Error) =>
        !e.message.includes("fixture-token") &&
        !e.message.includes("sensitive"),
    );
  }
});
test("malformed events and non-stream responses fail", async () => {
  await assert.rejects(
    client("data: null\n\n").complete(request),
    /invalid stream/,
  );
  const c = new ChatgptPlanClient({
    account,
    credential,
    fetch: (async (url) =>
      String(url).endsWith("/models")
        ? Response.json(catalog)
        : Response.json({ output: [] })) as typeof fetch,
  });
  await assert.rejects(c.complete(request), /response stream/);
});
test("aborted work does not start another provider request", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: { url: string; init?: RequestInit }[] = [];
  await assert.rejects(
    client(done, calls).complete(request, { signal: controller.signal }),
  );
  assert.equal(calls.length, 0);
});
test("SSE handles split bytes and CRLF", async () => {
  const raw = event("response.output_text.delta", { delta: "héllo" }) + done;
  const bytes = new TextEncoder().encode(raw.replaceAll("\n", "\r\n"));
  const c = new ChatgptPlanClient({
    account,
    credential,
    fetch: (async (url) =>
      String(url).endsWith("/models")
        ? Response.json(catalog)
        : new Response(
            new ReadableStream({
              start(controller) {
                for (const byte of bytes)
                  controller.enqueue(Uint8Array.of(byte));
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          )) as typeof fetch,
  });
  assert.equal(await c.complete(request), "héllo");
});

test("catalog and inference streams have byte limits", async () => {
  const c = new ChatgptPlanClient({
    account,
    credential,
    fetch: (async () =>
      new Response("x".repeat(2 * 1024 * 1024 + 1))) as typeof fetch,
  });
  await assert.rejects(c.models(), /size/);
  await assert.rejects(
    client("x".repeat(4 * 1024 * 1024 + 1)).complete(request),
    /size/,
  );
});
test("SSE joins multiline data and ignores comment frames", async () => {
  const stream =
    ': keepalive\n\ndata: {"type":"response.output_text.delta",\ndata: "delta":"yes"}\n\n' +
    done;
  assert.equal(await client(stream).complete(request), "yes");
});
test("input is captured before awaiting the catalog", async () => {
  const mutable = {
    ...request,
    input: [{ role: "user" as const, content: "original" }],
  };
  let sent: unknown;
  const c = new ChatgptPlanClient({
    account,
    credential,
    fetch: (async (url, init) => {
      if (String(url).endsWith("/models")) {
        mutable.input[0].content = "changed";
        return Response.json(catalog);
      }
      sent = JSON.parse(init!.body as string);
      return new Response(done, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch,
  });
  await c.complete(mutable);
  assert.equal(
    (sent as { input: { content: string }[] }).input[0].content,
    "original",
  );
});

test("refusal events fail clearly rather than yielding an empty success", async () => {
  await assert.rejects(
    client(
      event("response.refusal.delta", { delta: "private provider reason" }) +
        done,
    ).complete(request),
    /declined/,
  );
});
test("missing account binding is rejected before any credential request", () => {
  assert.throws(
    () =>
      new ChatgptPlanClient({
        account: { ...account, accountId: "" },
        credential,
      }),
    /account/,
  );
});

test("only completed Responses usage is reported; missing or invalid counts remain unknown", async () => {
  for (const usage of [
    { input_tokens: 9, output_tokens: 3, total_tokens: 12 },
    undefined,
    { input_tokens: 9, output_tokens: 3, total_tokens: 99 },
  ]) {
    const reported: unknown[] = [];
    await client(
      event("response.output_text.delta", { delta: "hello" }) +
        event("response.completed", {
          response: { status: "completed", usage },
        }),
    ).complete(request, { onUsage: (value) => reported.push(value) });
    assert.deepEqual(reported, [usage?.total_tokens === 12 ? usage : null]);
  }
  const rejected: unknown[] = [];
  await assert.rejects(
    client(
      event("response.failed", {
        response: {
          error: { code: "subscription_sharing_usage_limit_exceeded" },
        },
      }),
    ).complete(request, { onUsage: (value) => rejected.push(value) }),
    /usage limit/,
  );
  assert.deepEqual(rejected, []);
});

test("missing media headers still require a valid completed event stream, never JSON or HTML", async () => {
  const responseFor = (body: string, mime?: string) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
      { headers: mime ? { "Content-Type": mime } : {} },
    );
  const make = (body: string, mime?: string) =>
    new ChatgptPlanClient({
      account,
      credential,
      fetch: (async (url) =>
        String(url).endsWith("/models")
          ? Response.json(catalog)
          : responseFor(body, mime)) as typeof fetch,
    });
  const usage = { input_tokens: 4, output_tokens: 2, total_tokens: 6 };
  const stream =
    event("response.output_text.delta", { delta: "Verified" }) +
    event("response.completed", { response: { status: "completed", usage } });
  const reported: unknown[] = [];
  assert.equal(
    await make(stream).complete(request, { onUsage: (u) => reported.push(u) }),
    "Verified",
  );
  assert.deepEqual(reported, [usage]);
  assert.equal(
    await make(stream, "Text/Event-Stream; charset=utf-8").complete(request),
    "Verified",
  );
  for (const body of [
    '{"status":"completed"}',
    "<html>not a stream</html>",
    event("response.output_text.delta", { delta: "partial" }),
  ]) {
    await assert.rejects(
      make(body).complete(request, {
        onUsage: () => assert.fail("incomplete output cannot publish usage"),
      }),
      /disconnected/,
    );
  }
  await assert.rejects(
    make("data: invalid-json\n\n").complete(request),
    /invalid stream/,
  );
  await assert.rejects(
    make(stream, "application/json").complete(request),
    /response stream/,
  );
});

test("private Responses wire refuses an unenforceable output-token limit", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await assert.rejects(
    client(done, calls).complete({ ...request, max_output_tokens: 321 }),
    /hard output-token limit/,
  );
  assert.equal(
    calls.length,
    0,
    "A required budget is never dropped or dispatched as unsupported input.",
  );
  const before = calls.length;
  for (const value of [0, -1, 1.5, 65537, NaN])
    await assert.rejects(
      client(done, calls).complete({ ...request, max_output_tokens: value }),
    );
  assert.equal(calls.length, before);
});

test("a required hard output budget is rejected before any public ChatGPT request when the route cannot enforce it", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await assert.rejects(
    client(done, calls).complete({ ...request, max_output_tokens: 512 }),
    /hard output-token limit/,
  );
  assert.equal(
    calls.length,
    0,
    "No model lookup or inference is dispatched without budget enforcement",
  );
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// Wire behaviour matching BrainRouter's common OpenAI-compatible profile.
const { complete, listModels, usesResponsesApi, ProviderError } =
  await import("../src/modules/ai/providers/adapters.js");

type Seen = { url: string; auth?: string; body: Record<string, unknown> };
const seen: Seen[] = [];
let reply: { status?: number; body: unknown } = { body: {} };
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    seen.push({
      url: req.url ?? "",
      auth: req.headers.authorization,
      body: raw ? JSON.parse(raw) : {},
    });
    res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
const ai = (over: Record<string, unknown> = {}) => ({
  kind: "openai-compatible",
  format: "openai" as const,
  baseUrl,
  apiKey: "",
  model: "m",
  options: {},
  source: "database" as const,
  ...over,
});
const hi = [{ role: "user" as const, content: "hi" }];
const answer = (message: unknown, extra: Record<string, unknown> = {}) => ({
  choices: [{ message, ...extra }],
});

test("blank keys: 'local' for local servers, the default key for opencode", async () => {
  reply = { body: answer({ content: "ok" }) };
  await complete(ai({ local: true }), hi);
  assert.equal(seen.at(-1)!.auth, "Bearer local");
  await complete(ai({ defaultApiKey: "public" }), hi);
  assert.equal(seen.at(-1)!.auth, "Bearer public");
  await complete(ai({ apiKey: "sk-real-key-1234567890" }), hi);
  assert.equal(seen.at(-1)!.auth, "Bearer sk-real-key-1234567890");
  await listModels(ai({ local: true })).catch(() => []);
  assert.equal(seen.at(-1)!.url, "/v1/models");
  assert.equal(seen.at(-1)!.auth, "Bearer local");
});

test("reply parsing: content parts, reasoning fallback, errors, truncation", async () => {
  reply = { body: answer({ content: [{ type: "text", text: "a" }, "b"] }) };
  assert.equal(await complete(ai(), hi), "ab");
  reply = { body: answer({ content: "", reasoning_content: '{"x":1}' }) };
  assert.equal(await complete(ai(), hi), '{"x":1}');
  reply = { body: { choices: [{ delta: { content: "streamed" } }] } };
  assert.equal(await complete(ai(), hi), "streamed");

  const reason = async () => {
    try {
      await complete(ai(), hi);
      return "none";
    } catch (e) {
      assert.ok(e instanceof ProviderError);
      return (e as InstanceType<typeof ProviderError>).reason;
    }
  };
  reply = { body: { error: { message: "upstream exploded" } } };
  assert.equal(await reason(), "error_envelope");
  reply = { body: { choices: [] } };
  assert.equal(await reason(), "no_choices");
  reply = { body: answer({ content: '{"summ' }, { finish_reason: "length" }) };
  assert.equal(await reason(), "truncated");
});

test("provider error text is shown, with the key masked", async () => {
  const key = "sk-secret-abcdefghijklmnop";
  reply = {
    status: 400,
    body: { error: { message: `Model not found for key ${key}` } },
  };
  await assert.rejects(
    () => complete(ai({ apiKey: key }), hi),
    (e: Error) =>
      /The provider says: Model not found for key ••••/.test(e.message) &&
      !e.message.includes(key),
  );
});

test("Anthropic's native API gets max_tokens 8192 and flags truncation", async () => {
  reply = {
    body: {
      content: [
        { type: "thinking", text: "hmm" },
        { type: "text", text: "hi" },
      ],
      stop_reason: "end_turn",
    },
  };
  const anthropic = ai({
    format: "anthropic",
    apiKey: "sk-ant-1234567890abcdef",
  });
  assert.equal(await complete(anthropic, hi), "hi");
  assert.equal(seen.at(-1)!.url, "/v1/messages");
  assert.equal(seen.at(-1)!.body.max_tokens, 8192);
  reply = {
    body: {
      content: [{ type: "text", text: "cut" }],
      stop_reason: "max_tokens",
    },
  };
  await assert.rejects(() => complete(anthropic, hi), /cut the reply off/);
});

test("OpenAI's Responses API is used exactly where BrainRouter uses it", () => {
  const openai = {
    requestFormat: "responses" as const,
    baseUrl: "https://api.openai.com/v1/",
  };
  assert.equal(usesResponsesApi({ ...openai, model: "gpt-5.1" }), true);
  assert.equal(usesResponsesApi({ ...openai, model: "o3-mini" }), true);
  assert.equal(usesResponsesApi({ ...openai, model: "llama-3" }), false);
  assert.equal(
    usesResponsesApi({
      ...openai,
      baseUrl: "https://example.com/v1",
      model: "gpt-5",
    }),
    false,
  );
  assert.equal(
    usesResponsesApi({ baseUrl: openai.baseUrl, model: "gpt-5" }),
    false,
  );
});

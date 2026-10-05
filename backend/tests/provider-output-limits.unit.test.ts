import { test } from "node:test";
import assert from "node:assert/strict";
import {
  complete,
  type ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
const base: ResolvedAi = {
  kind: "custom",
  format: "openai",
  baseUrl: "https://fixture.invalid/v1",
  apiKey: "fixture",
  model: "fixture-model",
  options: {},
  source: "database",
};

test("bounded completions use protocol-specific output limits without changing ordinary requests", async () => {
  const original = globalThis.fetch;
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, body: JSON.parse(String(init?.body)) });
    const data = url.endsWith("/messages")
      ? { stop_reason: "end_turn", content: [{ type: "text", text: "OK" }] }
      : url.endsWith("/responses")
        ? {
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "OK" }],
              },
            ],
          }
        : { choices: [{ finish_reason: "stop", message: { content: "OK" } }] };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try {
    const messages = [
      { role: "user" as const, content: "A bounded neutral request." },
    ];
    await complete(base, messages, { maxOutputTokens: 321 });
    assert.equal(seen.at(-1)!.body.max_tokens, 321);
    await complete({ ...base, kind: "openai" }, messages, {
      maxOutputTokens: 321,
    });
    assert.equal(seen.at(-1)!.body.max_completion_tokens, 321);
    await complete(
      { ...base, format: "azure", options: { apiVersion: "2024-10-21" } },
      messages,
      { maxOutputTokens: 321 },
    );
    assert.equal(seen.at(-1)!.body.max_completion_tokens, 321);
    await complete({ ...base, format: "anthropic" }, messages, {
      maxOutputTokens: 321,
    });
    assert.equal(seen.at(-1)!.body.max_tokens, 321);
    await complete(
      {
        ...base,
        kind: "openai",
        requestFormat: "responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.6",
      },
      messages,
      { maxOutputTokens: 321 },
    );
    assert.equal(seen.at(-1)!.body.max_output_tokens, 321);
    assert.equal(seen.at(-1)!.body.store, false);
    await complete(base, messages);
    assert.equal(seen.at(-1)!.body.max_tokens, undefined);
    const before = seen.length;
    for (const value of [0, -1, 1.5, 65537, NaN])
      await assert.rejects(
        complete(base, messages, { maxOutputTokens: value }),
      );
    assert.equal(seen.length, before);
  } finally {
    globalThis.fetch = original;
  }
});

test("successful HTTP error envelopes redact the configured provider key", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: "Rejected secret-provider-value-12345" },
      }),
      { status: 200 },
    );
  try {
    await assert.rejects(
      complete({ ...base, apiKey: "secret-provider-value-12345" }, [
        { role: "user", content: "Neutral" },
      ]),
      (error: any) => {
        assert.ok(!error.message.includes("secret-provider-value-12345"));
        assert.ok(error.message.includes("••••"));
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("private transport receives the validated output allowance and durable operation", async () => {
  const calls: unknown[][] = [];
  const ai: ResolvedAi = {
    ...base,
    operationId: "operation-fixture",
    textTransport: async (...args) => {
      calls.push(args);
      return "OK";
    },
  };
  const messages = [
    { role: "user" as const, content: "Neutral bounded input" },
  ];
  assert.equal(await complete(ai, messages, { maxOutputTokens: 321 }), "OK");
  assert.equal(calls[0][2], "operation-fixture");
  assert.equal(calls[0][3], 321);
  await complete(ai, messages);
  assert.equal(calls[1][3], undefined);
  for (const value of [0, -1, 1.5, 65537, NaN])
    await assert.rejects(complete(ai, messages, { maxOutputTokens: value }));
  assert.equal(calls.length, 2);
});

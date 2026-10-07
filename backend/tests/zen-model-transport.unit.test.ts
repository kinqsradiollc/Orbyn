import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { connection } from "../src/modules/ai/providers/resolve.js";
import { complete } from "../src/modules/ai/providers/adapters.js";
import {
  listModels,
  embed,
  ProviderError,
  usesResponsesApi,
} from "../src/modules/ai/providers/adapters.js";
import { readGeminiUsage } from "../src/modules/ai/providers/model-controls.js";
import { step, startingMode } from "../src/modules/ai/agent/protocol.js";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "opencode" as const,
  name: "Inert Zen fixture",
  base_url: "https://fixture.invalid/zen/v1",
  api_key_encrypted: null,
  key_hint: "",
  enabled: true,
  options: {},
  created_at: new Date(),
  updated_at: new Date(),
  embedding_revision: "1",
};

const cases = [
  ["gpt-6.1-sol", "responses"],
  ["grok-4.7", "responses"],
  ["claude-sonnet-4-6", "messages"],
  ["qwen3.8-flash", "messages"],
  ["gemini-3.8-flash", "gemini"],
] as const;
const metadata = JSON.parse(
  readFileSync(
    new URL("./fixtures/zen-model-transports-20261008.json", import.meta.url),
    "utf8",
  ),
) as { models: { id: string; protocol: string }[] };
for (const model of metadata.models) {
  test(`reviewed Zen model ${model.id} resolves and completes using ${model.protocol}`, async (t) => {
    const ai = await connection(row, model.id);
    t.mock.method(globalThis, "fetch", async (input) => {
      const suffix =
        model.protocol === "gemini"
          ? `models/${model.id}:generateContent`
          : model.protocol === "chat"
            ? "chat/completions"
            : model.protocol;
      assert.equal(String(input), `${row.base_url}/${suffix}`);
      return Response.json(
        model.protocol === "gemini"
          ? {
              candidates: [
                { finishReason: "STOP", content: { parts: [{ text: "OK" }] } },
              ],
            }
          : model.protocol === "messages"
            ? {
                stop_reason: "end_turn",
                content: [{ type: "text", text: "OK" }],
              }
            : model.protocol === "responses"
              ? {
                  output: [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "OK" }],
                    },
                  ],
                }
              : {
                  choices: [
                    { message: { content: "OK" }, finish_reason: "stop" },
                  ],
                },
      );
    });
    assert.equal(
      await complete(ai, [{ role: "user", content: "Inert fixture" }]),
      "OK",
    );
  });
}
for (const [model, protocol] of cases) {
  for (const surface of ["direct", "agent", "json"] as const) {
    test(`Zen ${model} ${surface} retains its documented protocol and saved destination`, async (t) => {
      const ai = await connection(row, model);
      let calls = 0;
      const text = surface === "json" ? '{"answer":["OK"]}' : "OK";
      t.mock.method(globalThis, "fetch", async (input, init) => {
        calls++;
        const path =
          protocol === "gemini" ? `models/${model}:generateContent` : protocol;
        assert.equal(String(input), `${row.base_url}/${path}`);
        const body = JSON.parse(String(init?.body));
        const headers = new Headers(init?.headers);
        assert.ok(!String(input).includes("public"));
        if (protocol === "responses") {
          assert.equal(headers.get("authorization"), "Bearer public");
          assert.equal(body.store, false);
          return Response.json({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text }],
              },
            ],
            usage: { input_tokens: 7, output_tokens: 3 },
          });
        }
        if (protocol === "messages") {
          assert.equal(headers.get("x-api-key"), "public");
          assert.equal(body.max_tokens, 8192);
          return Response.json({
            stop_reason: "end_turn",
            content: [{ type: "text", text }],
            usage: { input_tokens: 7, output_tokens: 3 },
          });
        }
        assert.equal(headers.get("x-goog-api-key"), "public");
        assert.ok(Array.isArray(body.contents));
        return Response.json({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text }] } },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 0,
          },
        });
      });
      const signal = AbortSignal.timeout(1000);
      if (surface === "direct")
        assert.equal(
          await complete(ai, [{ role: "user", content: "Inert fixture" }], {
            signal,
          }),
          "OK",
        );
      else {
        const result = await step(
          ai,
          [{ role: "user", content: "Inert fixture" }],
          surface === "json"
            ? [
                {
                  name: "fixture_tool",
                  description: "Inert fixture",
                  parameters: { type: "object", properties: {} },
                },
              ]
            : [],
          {
            mode: surface === "json" ? "json" : startingMode(ai),
            toolsAllowed: surface === "json",
            signal,
          },
        );
        assert.equal(result.text, "OK");
      }
      assert.equal(calls, 1);
    });
  }
}

test("Zen catalog and embedding selection stay independent of generation protocol", async (t) => {
  const catalog = await connection(row, "");
  assert.equal(catalog.format, "openai");
  const ai = await connection(row, "claude-sonnet-4-6", "embedding");
  assert.equal(ai.format, "openai");
  assert.equal(ai.requestFormat, undefined);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    return Response.json(
      path.endsWith("/models")
        ? { data: [{ id: "claude-sonnet-4-6" }] }
        : { data: [{ index: 0, embedding: [1, 0] }] },
    );
  });
  assert.deepEqual(await listModels(catalog), ["claude-sonnet-4-6"]);
  assert.deepEqual(await embed(ai, ["Inert fixture"]), [[1, 0]]);
  assert.deepEqual(paths, ["/zen/v1/models", "/zen/v1/embeddings"]);
});

test("model names and Responses flags do not select an unqualified gateway protocol", async () => {
  assert.equal((await connection(row, "gpt-future")).requestFormat, undefined);
  assert.equal(
    usesResponsesApi({
      kind: "opencode",
      requestFormat: "responses",
      model: "gpt-future",
      baseUrl: row.base_url,
    }),
    false,
  );
  assert.equal(
    usesResponsesApi({
      requestFormat: "responses",
      model: "gpt-6.1-sol",
      baseUrl: row.base_url,
    }),
    false,
  );
  assert.equal(
    usesResponsesApi({
      requestFormat: "responses",
      model: "gpt-6.1-sol",
      baseUrl: "https://api.openai.com/v1",
    }),
    true,
  );
  for (const model of ["jev-1.13", "jev-1.13-free"])
    await assert.rejects(connection(row, model));
});

test("Gemini resumed native-mode jobs use the JSON agent protocol on native content endpoint", async (t) => {
  const ai = await connection(row, "gemini-3.8-flash");
  let observations = 0;
  ai.recordUsage = async (usage) => {
    observations++;
    assert.equal(usage.output_tokens, 5);
    assert.equal(usage.reasoning_tokens, 2);
  };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    assert.ok(String(input).endsWith(":generateContent"));
    const body = JSON.parse(String(init?.body));
    assert.ok(
      body.contents.some((m: any) =>
        m.parts.some((p: any) => p.text.includes("Prior result")),
      ),
    );
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { thought: true, text: "PRIVATE THOUGHT" },
              { text: '{"fixture_tool":{"value":"OK"},"answer":null}' },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 3,
        thoughtsTokenCount: 2,
      },
    });
  });
  const result = await step(
    ai,
    [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "prior",
            name: "fixture_tool",
            arguments: '{"value":"before"}',
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "prior",
        name: "fixture_tool",
        content: "Prior result",
      },
    ],
    [
      {
        name: "fixture_tool",
        description: "Inert fixture",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      },
    ],
    { mode: "native", toolsAllowed: true, signal: AbortSignal.timeout(1000) },
  );
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, "fixture_tool");
  assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), { value: "OK" });
  assert.ok(!result.text.includes("PRIVATE THOUGHT"));
  assert.equal(observations, 1);
});

for (const status of [400, 401, 403, 429, 500]) {
  test(`Gemini HTTP ${status} errors stay sanitized`, async (t) => {
    const ai = {
      ...(await connection(row, "gemini-3.8-flash")),
      apiKey: "inert-sensitive-key",
    };
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { message: ai.apiKey } }, { status }),
    );
    await assert.rejects(
      complete(ai, []),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.reason === `http_${status}` &&
        !error.message.includes(ai.apiKey),
    );
  });
}

test("Gemini truncation and blocked output never publish a partial reply", async (t) => {
  const ai = await connection(row, "gemini-3.8-flash");
  for (const finishReason of ["MAX_TOKENS", "SAFETY"]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        candidates: [
          { finishReason, content: { parts: [{ text: "PARTIAL" }] } },
        ],
      }),
    );
    await assert.rejects(complete(ai, []));
    t.mock.restoreAll();
  }
});

test("Gemini rejects post-response authority change and cancellation", async (t) => {
  const controller = new AbortController();
  const ai = await connection(row, "gemini-3.8-flash");
  let checks = 0;
  ai.assertAuthority = async () => {
    if (++checks > 1) throw new Error("stale fixture authority");
  };
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "STALE" }] } },
      ],
    }),
  );
  await assert.rejects(complete(ai, []), /stale fixture authority/);
  ai.assertAuthority = undefined;
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return Response.json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "CANCELLED" }] } },
      ],
    });
  });
  await assert.rejects(
    complete(ai, [], { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("Gemini usage retains unknown fields and rejects contradictory cache counts", () => {
  assert.deepEqual(
    readGeminiUsage({
      promptTokenCount: 7,
      candidatesTokenCount: 3,
      thoughtsTokenCount: 2,
      cachedContentTokenCount: 1,
    }),
    {
      input_tokens: 7,
      output_tokens: 5,
      reasoning_tokens: 2,
      cached_input_tokens: 1,
      cache_write_tokens: null,
    },
  );
  const partial = readGeminiUsage({
    promptTokenCount: 7,
    candidatesTokenCount: 3,
    cachedContentTokenCount: 8,
  });
  assert.equal(partial.output_tokens, null);
  assert.equal(partial.cached_input_tokens, null);
  assert.equal(readGeminiUsage({ promptTokenCount: NaN }).input_tokens, null);
});

for (const body of [
  null,
  [],
  {},
  { candidates: {} },
  { candidates: [{ finishReason: "STOP", content: { parts: "bad" } }] },
  { candidates: [{ finishReason: "STOP", content: { parts: [null] } }] },
]) {
  test(`Gemini malformed response ${JSON.stringify(body)} is sanitized`, async (t) => {
    const ai = await connection(row, "gemini-3.8-flash");
    t.mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(
      complete(ai, []),
      (error: unknown) =>
        error instanceof ProviderError && error.reason === "invalid_body",
    );
  });
}

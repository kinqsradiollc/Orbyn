import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AI_PROVIDER_KINDS, type AiProviderKind } from "@orbyn/core";
import { step, startingMode } from "../src/modules/ai/agent/protocol.js";
import { connection } from "../src/modules/ai/providers/resolve.js";
import {
  complete,
  embed,
  listModels,
  ProviderError,
} from "../src/modules/ai/providers/adapters.js";

// Independent expectations: a new saved provider kind must be reviewed here,
// rather than inheriting a passing test from the same definition under test.
const expectedKinds = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "zenmux",
  "matilda",
  "groq",
  "azure",
  "openai-compatible",
  "opencode",
  "lmstudio",
  "ollama",
  "deepseek",
  "together",
  "fireworks",
  "mistral",
  "xai",
  "perplexity",
  "deepinfra",
  "nebius",
] as const;

test("every saved provider kind has an explicit runtime inventory entry", () => {
  assert.deepEqual([...AI_PROVIDER_KINDS].sort(), [...expectedKinds].sort());
});

async function savedConnection(kind: AiProviderKind) {
  return connection(
    {
      id: randomUUID(),
      kind,
      name: "Disposable provider fixture",
      base_url:
        kind === "openai"
          ? "https://api.openai.com/v1"
          : "https://fixture.invalid/v1",
      api_key_encrypted: null,
      key_hint: "",
      enabled: true,
      options: kind === "azure" ? { apiVersion: "2024-10-21" } : {},
      created_at: new Date(),
      updated_at: new Date(),
      embedding_revision: randomUUID(),
    },
    kind === "openai" ? "gpt-5.6" : "fixture-model",
  );
}

for (const kind of expectedKinds) {
  test(`${kind}: saved connection dispatches generation through its intended protocol`, async (t) => {
    const ai = await savedConnection(kind);
    ai.apiKey = "fixture-runtime-secret";
    const requests: {
      url: URL;
      headers: Headers;
      body: Record<string, unknown>;
    }[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: new URL(String(input)),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json(
          kind === "anthropic"
            ? {
                stop_reason: "end_turn",
                content: [{ type: "text", text: "OK" }],
              }
            : kind === "openai"
              ? {
                  status: "completed",
                  output: [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "OK" }],
                    },
                  ],
                }
              : {
                  choices: [
                    { finish_reason: "stop", message: { content: "OK" } },
                  ],
                },
        );
      },
    );
    assert.equal(
      await complete(ai, [
        { role: "system", content: "Neutral fixture." },
        { role: "user", content: "OK" },
      ]),
      "OK",
    );
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(
      request.url.pathname,
      kind === "anthropic"
        ? "/v1/messages"
        : kind === "openai"
          ? "/v1/responses"
          : kind === "azure"
            ? "/v1/openai/deployments/fixture-model/chat/completions"
            : "/v1/chat/completions",
    );
    if (kind === "anthropic") {
      assert.equal(request.headers.get("x-api-key"), ai.apiKey);
      assert.equal(request.headers.get("anthropic-version"), "2023-06-01");
      assert.equal(request.body.system, "Neutral fixture.");
      assert.equal(request.headers.get("authorization"), null);
    } else if (kind === "azure") {
      assert.equal(request.headers.get("api-key"), ai.apiKey);
      assert.equal(request.url.searchParams.get("api-version"), "2024-10-21");
      assert.equal(request.headers.get("authorization"), null);
    } else
      assert.equal(request.headers.get("authorization"), `Bearer ${ai.apiKey}`);
    if (kind === "openai") assert.equal(request.body.store, false);
    if (kind === "matilda") {
      assert.deepEqual(ai.limits, {
        maxBodyBytes: 65536,
        maxMessageChars: 16000,
      });
      assert.equal(ai.structuredOutput, "json_schema");
    }
  });

  test(`${kind}: catalog and embeddings follow the saved connection's capabilities`, async (t) => {
    const ai = await savedConnection(kind);
    const requests: {
      url: URL;
      headers: Headers;
      body: Record<string, unknown> | null;
    }[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({
          url,
          headers: new Headers(init?.headers),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json(
          url.pathname.endsWith("/models")
            ? kind === "together"
              ? [{ id: "fixture-model", type: "chat" }]
              : {
                  data: [{ id: "fixture-model" }],
                  ...(kind === "anthropic" ? { has_more: false } : {}),
                }
            : { data: [{ index: 0, embedding: [1, 0, 0] }] },
        );
      },
    );
    if (kind === "azure") {
      await assert.rejects(
        listModels(ai),
        (error: unknown) =>
          error instanceof ProviderError && error.reason === "unsupported",
      );
      assert.equal(requests.length, 0);
    } else assert.deepEqual(await listModels(ai), ["fixture-model"]);
    const before = requests.length;
    if (kind === "anthropic") {
      await assert.rejects(
        embed(ai, ["Neutral fixture."], { expectedDimensions: 3 }),
        (error: unknown) =>
          error instanceof ProviderError && error.reason === "unsupported",
      );
      assert.equal(requests.length, before);
    } else {
      assert.deepEqual(
        await embed(ai, ["Neutral fixture."], { expectedDimensions: 3 }),
        [[1, 0, 0]],
      );
      const request = requests.at(-1)!;
      assert.equal(
        request.url.pathname,
        kind === "azure"
          ? "/v1/openai/deployments/fixture-model/embeddings"
          : "/v1/embeddings",
      );
      assert.deepEqual(request.body?.input, ["Neutral fixture."]);
      if (kind === "azure") {
        assert.equal(request.url.searchParams.get("api-version"), "2024-10-21");
        assert.equal(request.body?.model, undefined);
      } else assert.equal(request.body?.model, ai.model);
    }
    // Blank-key transports retain their documented local/public behavior.
    if (kind === "lmstudio" || kind === "ollama")
      assert.equal(requests[0].headers.get("authorization"), "Bearer local");
    if (kind === "opencode")
      assert.equal(requests[0].headers.get("authorization"), "Bearer public");
  });
}

for (const kind of expectedKinds) {
  test(`${kind}: durable agent uses its declared native or JSON starting mode`, async (t) => {
    const ai = await savedConnection(kind);
    const mode = startingMode(ai);
    assert.equal(mode, kind === "matilda" ? "json" : "native");
    let body: Record<string, any> | undefined;
    let path: string | undefined;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        path = new URL(String(input)).pathname;
        body = JSON.parse(String(init?.body));
        return Response.json(
          kind === "anthropic"
            ? {
                stop_reason: "tool_use",
                content: [
                  {
                    type: "tool_use",
                    id: "fixture-call",
                    name: "fixture_tool",
                    input: { value: "OK" },
                  },
                ],
              }
            : kind === "openai"
              ? {
                  status: "completed",
                  output: [
                    {
                      type: "function_call",
                      call_id: "fixture-call",
                      name: "fixture_tool",
                      arguments: '{"value":"OK"}',
                      status: "completed",
                    },
                  ],
                }
              : kind === "matilda"
                ? {
                    choices: [
                      {
                        finish_reason: "stop",
                        message: {
                          content:
                            '{"fixture_tool":{"value":"OK"},"answer":null}',
                        },
                      },
                    ],
                  }
                : {
                    choices: [
                      {
                        finish_reason: "tool_calls",
                        message: {
                          tool_calls: [
                            {
                              id: "fixture-call",
                              function: {
                                name: "fixture_tool",
                                arguments: '{"value":"OK"}',
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
        );
      },
    );
    const result = await step(
      ai,
      [{ role: "user", content: "Neutral fixture." }],
      [
        {
          name: "fixture_tool",
          description: "Inert test tool.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      ],
      { mode, toolsAllowed: true, signal: AbortSignal.timeout(1000) },
    );
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, "fixture_tool");
    assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), {
      value: "OK",
    });
    assert.equal(
      path,
      kind === "anthropic"
        ? "/v1/messages"
        : kind === "openai"
          ? "/v1/responses"
          : kind === "azure"
            ? "/v1/openai/deployments/fixture-model/chat/completions"
            : "/v1/chat/completions",
    );
    if (kind === "matilda") {
      assert.equal(body?.response_format?.type, "json_schema");
      assert.equal(body?.tools, undefined);
    } else assert.equal(body?.tools?.length, 1);
    if (kind === "openai") assert.equal(body?.store, false);
  });
}

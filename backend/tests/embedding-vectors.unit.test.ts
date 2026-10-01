import { test } from "node:test";
import assert from "node:assert/strict";
import {
  embeddingVectors,
  EmbeddingResponseError,
  MAX_EMBEDDING_DIMENSIONS,
} from "../src/modules/ai/providers/embedding-vectors.js";
import { embed, ProviderError } from "../src/modules/ai/providers/adapters.js";

const rejected = (
  body: unknown,
  count: number,
  reason: string,
  dimensions?: number,
) =>
  assert.throws(
    () => embeddingVectors(body, count, dimensions),
    (error: unknown) =>
      error instanceof EmbeddingResponseError && error.reason === reason,
  );

test("embedding rows follow input indices, with positional compatibility for unindexed providers", () => {
  assert.deepEqual(
    embeddingVectors(
      {
        data: [
          { index: 1, embedding: [2, 3] },
          { index: 0, embedding: [1, 2] },
        ],
      },
      2,
      2,
    ),
    [
      [1, 2],
      [2, 3],
    ],
  );
  assert.deepEqual(
    embeddingVectors(
      { data: [{ embedding: [1, 2] }, { embedding: [2, 3] }] },
      2,
    ),
    [
      [1, 2],
      [2, 3],
    ],
  );
  assert.deepEqual(embeddingVectors({ data: [] }, 0), []);
});

test("Azure embeddings use the selected deployment and api-key without a generation model in the body", async (t) => {
  let captured: { url: string; init: RequestInit } | null = null;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    captured = { url: String(url), init };
    return new Response(
      JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }),
    );
  });
  const result = await embed(
    {
      format: "azure",
      baseUrl: "http://127.0.0.1:9999",
      apiKey: "azure-fixture-key",
      model: "generation-deployment",
      options: { apiVersion: "2024-10-21" },
    },
    ["passage"],
    { model: "embedding deployment", expectedDimensions: 2 },
  );
  assert.deepEqual(result, [[1, 2]]);
  assert.ok(captured);
  const request = captured as { url: string; init: RequestInit };
  assert.equal(
    request.url,
    "http://127.0.0.1:9999/openai/deployments/embedding%20deployment/embeddings?api-version=2024-10-21",
  );
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get("api-key"), "azure-fixture-key");
  assert.equal(headers.get("authorization"), null);
  assert.deepEqual(JSON.parse(request.init.body as string), {
    input: ["passage"],
  });
});

test("unsupported embedding routes and missing Azure versions are rejected without sending page text", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No provider request expected");
  });
  const common = {
    baseUrl: "http://127.0.0.1:9999",
    apiKey: "fixture-key",
    model: "fixture-model",
  };
  await assert.rejects(
    embed({ ...common, format: "anthropic" }, ["private page words"]),
    (error: unknown) =>
      error instanceof ProviderError && error.reason === "unsupported",
  );
  await assert.rejects(
    embed({ ...common, format: "azure" }, ["private page words"]),
    (error: unknown) =>
      error instanceof ProviderError && error.reason === "configuration",
  );
  assert.deepEqual(await embed({ ...common, format: "openai" }, []), []);
  assert.equal(fetch.mock.callCount(), 0);
});

test("embedding rows reject duplicate, missing, fractional, negative and out-of-range indices", () => {
  for (const indices of [
    [0, 0],
    [0, undefined],
    [0, 0.5],
    [-1, 1],
    [0, 2],
    [0, "1"],
  ])
    rejected(
      { data: indices.map((index) => ({ index, embedding: [1] })) },
      2,
      "embedding_index",
    );
});

test("embedding responses reject malformed counts and rows without exposing payloads", () => {
  for (const body of [null, {}, { data: {} }, { data: [] }])
    rejected(body, 1, "embedding_count");
  for (const row of [null, "secret-provider-output", 1, {}])
    rejected({ data: [row] }, 1, "embedding_vector");
  rejected({ data: [] }, -1, "embedding_count");
});

test("embedding vectors reject invalid numbers, float overflow, zero norms, holes and unsupported encoding", () => {
  for (const vector of [
    [],
    [0, 0],
    [1e-100],
    [NaN],
    [Infinity],
    [-Infinity],
    [1e40],
    ["1"],
    [null],
    [true],
    [1, , 2],
    "base64-secret-value",
  ])
    rejected({ data: [{ embedding: vector }] }, 1, "embedding_vector");
  rejected(
    { data: [{ embedding: new Array(MAX_EMBEDDING_DIMENSIONS + 1).fill(1) }] },
    1,
    "embedding_vector",
  );
});

test("embedding dimensions are consistent and match the verified configuration", () => {
  rejected(
    { data: [{ embedding: [1] }, { embedding: [1, 2] }] },
    2,
    "embedding_dimensions",
  );
  rejected({ data: [{ embedding: [1, 2] }] }, 1, "embedding_dimensions", 3);
  for (const dimensions of [0, -1, 0.5, NaN, MAX_EMBEDDING_DIMENSIONS + 1])
    rejected(
      { data: [{ embedding: [1] }] },
      1,
      "embedding_dimensions",
      dimensions,
    );
  assert.equal(
    embeddingVectors(
      { data: [{ embedding: new Array(3072).fill(1) }] },
      1,
      3072,
    )[0].length,
    3072,
  );
});

test("the actual embedding adapter orders rows and converts diagnostics to safe provider errors", async (t) => {
  let body: unknown = {
    data: [
      { index: 1, embedding: [2] },
      { index: 0, embedding: [1] },
    ],
  };
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(body), { status: 200 }),
  );
  const ai = {
    format: "openai" as const,
    baseUrl: "http://127.0.0.1:9999/v1",
    apiKey: "fixture-key",
    model: "fixture-embedding",
  };
  assert.deepEqual(
    await embed(ai, ["first passage", "second passage"], {
      expectedDimensions: 1,
    }),
    [[1], [2]],
  );
  body = { data: [{ embedding: ["fixture-key"] }] };
  await assert.rejects(
    embed(ai, ["passage"]),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.reason === "embedding_vector" &&
      !error.message.includes("fixture-key"),
  );
  body = { data: [{ embedding: [1, 2] }] };
  await assert.rejects(
    embed(ai, ["passage"], { expectedDimensions: 1 }),
    (error: unknown) =>
      error instanceof ProviderError && error.reason === "embedding_dimensions",
  );
});

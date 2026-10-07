import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDERS } from "@orbyn/core";
import {
  listEmbeddingModels,
  ProviderError,
} from "../src/modules/ai/providers/adapters.js";

for (const [kind, definition] of Object.entries(AI_PROVIDERS)) {
  test(`${kind} embedding discovery uses saved origin or explicit manual entry`, async () => {
    const original = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return new Response(
        JSON.stringify(
          kind === "together"
            ? [{ id: "candidate" }]
            : { data: [{ id: "candidate" }] },
        ),
      );
    };
    try {
      const result = await listEmbeddingModels({
        kind,
        format: definition.format,
        baseUrl: "https://fixture.invalid/v1",
        apiKey: "fixture-key",
      });
      const manual =
        definition.format === "azure" || definition.format === "anthropic";
      assert.equal(result.catalog_kind, manual ? "manual" : "unclassified");
      assert.deepEqual(result.models, manual ? [] : ["candidate"]);
      assert.deepEqual(
        requests,
        manual ? [] : ["https://fixture.invalid/v1/models"],
      );
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("native OpenRouter uses embedding-only catalog; custom origins never receive another destination", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(
      JSON.stringify({
        data: [
          { id: "embedding-b" },
          { id: "embedding-a" },
          { id: "embedding-a" },
        ],
      }),
    );
  };
  try {
    const native = await listEmbeddingModels({
      kind: "openrouter",
      format: "openai",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "fixture-key",
    });
    assert.equal(native.catalog_kind, "embedding");
    assert.deepEqual(native.models, ["embedding-a", "embedding-b"]);
    const custom = await listEmbeddingModels({
      kind: "openrouter",
      format: "openai",
      baseUrl: "https://fixture.invalid/api/v1",
      apiKey: "fixture-key",
    });
    assert.equal(custom.catalog_kind, "unclassified");
    assert.deepEqual(requests, [
      "https://openrouter.ai/api/v1/embeddings/models",
      "https://fixture.invalid/api/v1/models",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

for (const status of [400, 401, 403, 404, 429, 500]) {
  test(`embedding catalog HTTP ${status} is sanitized`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { message: "fixture-private-key" } }),
        { status },
      );
    try {
      await assert.rejects(
        listEmbeddingModels({
          kind: "openrouter",
          format: "openai",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "fixture-private-key",
        }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.reason, `http_${status}`);
          assert.ok(!error.message.includes("fixture-private-key"));
          return true;
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("malformed successful embedding catalog is rejected rather than published", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: 4 }] }));
  try {
    await assert.rejects(
      listEmbeddingModels({
        kind: "openrouter",
        format: "openai",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "fixture-key",
      }),
      (error: unknown) =>
        error instanceof ProviderError && error.reason === "invalid_catalog",
    );
  } finally {
    globalThis.fetch = original;
  }
});

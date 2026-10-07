import { test } from "node:test";
import assert from "node:assert/strict";
import { embed, ProviderError } from "../src/modules/ai/providers/adapters.js";
import { perplexityEmbeddingEndpoint } from "../src/modules/ai/providers/perplexity-embeddings.js";

const native = {
  kind: "perplexity",
  format: "openai" as const,
  baseUrl: "https://api.perplexity.ai",
  apiKey: "inert-private-test-key",
  model: "pplx-embed-v1-0.6b",
};
const encoded = (dimensions: number, first = 127) => {
  const bytes = Buffer.alloc(dimensions);
  bytes[0] = first;
  bytes[1] = 128;
  bytes[2] = 255;
  return bytes.toString("base64");
};
const invalid = (error: unknown) =>
  error instanceof ProviderError &&
  error.reason.startsWith("embedding_") &&
  !error.message.includes(native.apiKey);

for (const [model, dimensions] of [
  ["pplx-embed-v1-0.6b", 1024],
  ["pplx-embed-v1-4b", 2560],
] as const)
  test(`native ${model} requests signed int8 and validates the full ${dimensions} coordinates`, async (t) => {
    let request: { url: string; init?: RequestInit } | undefined;
    t.mock.method(
      globalThis,
      "fetch",
      async (url: unknown, init?: RequestInit) => {
        request = { url: String(url), init };
        return Response.json({
          data: [
            { index: 1, embedding: encoded(dimensions, 1) },
            { index: 0, embedding: encoded(dimensions) },
          ],
        });
      },
    );
    const result = await embed(
      { ...native, model },
      ["Inert first passage", "Inert second passage"],
      { expectedDimensions: dimensions },
    );
    assert.equal(request?.url, "https://api.perplexity.ai/v1/embeddings");
    assert.equal(
      new Headers(request!.init?.headers).get("authorization"),
      `Bearer ${native.apiKey}`,
    );
    assert.deepEqual(JSON.parse(String(request!.init?.body)), {
      model,
      input: ["Inert first passage", "Inert second passage"],
      encoding_format: "base64_int8",
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].length, dimensions);
    assert.deepEqual(result[0].slice(0, 3), [127, -128, -1]);
    assert.equal(result[1][0], 1, "input index order is preserved");
  });

for (const suffix of ["", "/", "/v1", "/v1/"])
  test(`native saved base ${suffix || "(root)"} does not duplicate v1`, () => {
    assert.equal(
      perplexityEmbeddingEndpoint({
        ...native,
        baseUrl: `https://api.perplexity.ai${suffix}`,
      }),
      "https://api.perplexity.ai/v1/embeddings",
    );
  });

for (const baseUrl of [
  "https://fixture.invalid/custom/v1",
  "http://api.perplexity.ai",
  "https://api.perplexity.ai:8443/v1",
  "https://api.perplexity.ai/proxy/v1",
])
  test(`custom saved endpoint retains compatible floats: ${baseUrl}`, async (t) => {
    let url: string | undefined;
    let body: Record<string, unknown> | undefined;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: unknown, init?: RequestInit) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return Response.json({ data: [{ index: 0, embedding: [1, 0, -1] }] });
      },
    );
    assert.deepEqual(
      await embed({ ...native, baseUrl }, ["Inert text"], {
        expectedDimensions: 3,
      }),
      [[1, 0, -1]],
    );
    assert.equal(url, `${baseUrl}/embeddings`);
    assert.equal(body?.encoding_format, undefined);
  });

test("other kinds cannot acquire the native decoder from a matching hostname", async (t) => {
  let url: string | undefined;
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    url = String(input);
    return Response.json({ data: [{ index: 0, embedding: encoded(1024) }] });
  });
  await assert.rejects(
    embed({ ...native, kind: "openai-compatible" }, ["Inert text"]),
    invalid,
  );
  assert.equal(url, "https://api.perplexity.ai/embeddings");
});

test("unknown native models and incompatible accepted dimensions fail before dispatch", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No request expected");
  });
  await assert.rejects(
    embed({ ...native, model: "unknown-native-model" }, ["Inert text"]),
    (error: unknown) =>
      error instanceof ProviderError && error.reason === "unsupported",
  );
  await assert.rejects(
    embed(native, ["Inert text"], { expectedDimensions: 128 }),
    invalid,
  );
  assert.deepEqual(await embed(native, []), []);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const [name, embedding] of [
  ["float array", [1, 0, 0]],
  ["missing", undefined],
  ["empty", ""],
  ["malformed base64", "!".repeat(1368)],
  ["binary packed width", encoded(128)],
  ["wrong full width", encoded(2560)],
  ["whitespace", encoded(1024).replace(/.$/, " ")],
  ["zero norm", Buffer.alloc(1024).toString("base64")],
] as const)
  test(`native embeddings reject ${name} without echoing output`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ data: [{ index: 0, embedding }], secret: native.apiKey }),
    );
    await assert.rejects(embed(native, ["Inert text"]), invalid);
  });

for (const rows of [
  [],
  [
    { index: 0, embedding: encoded(1024) },
    { index: 0, embedding: encoded(1024) },
  ],
  [{ index: 1, embedding: encoded(1024) }],
  [{ index: 0.5, embedding: encoded(1024) }],
])
  test("native decoding retains common count/index validation", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ data: rows }),
    );
    await assert.rejects(embed(native, ["Inert text"]), invalid);
  });

for (const status of [400, 401, 403, 429, 500])
  test(`native upstream HTTP${status} stays sanitized`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json(
        { error: { message: `Rejected ${native.apiKey}` } },
        { status },
      ),
    );
    await assert.rejects(
      embed(native, ["Inert text"]),
      (error: unknown) =>
        error instanceof ProviderError &&
        !error.message.includes(native.apiKey),
    );
  });

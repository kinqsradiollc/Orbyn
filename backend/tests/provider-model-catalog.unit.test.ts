import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listModels,
  ProviderError,
} from "../src/modules/ai/providers/adapters.js";

const connection = {
  kind: "custom" as const,
  format: "openai" as const,
  baseUrl: "https://fixture.invalid/v1",
  apiKey: "catalog-secret-value",
};

async function withCatalog(body: unknown, check: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status: 200 });
  try {
    await check();
  } finally {
    globalThis.fetch = original;
  }
}

test("catalog supports compatible and named model formats with stable deduplication", async () => {
  await withCatalog(
    { data: [{ id: "b" }, { id: "a" }], models: ["a", { name: "c" }] },
    async () => {
      assert.deepEqual(await listModels(connection), ["a", "b", "c"]);
    },
  );
  await withCatalog({ data: [] }, async () => {
    assert.deepEqual(await listModels(connection), []);
  });
});

test("successful HTTP catalog errors redact credentials", async () => {
  await withCatalog(
    { error: { message: `Denied ${connection.apiKey}` } },
    async () => {
      await assert.rejects(listModels(connection), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.reason, "error_envelope");
        assert.ok(!error.message.includes(connection.apiKey));
        return true;
      });
    },
  );
});

for (const body of [
  null,
  [],
  {},
  { data: {} },
  { models: "bad" },
  { data: [null] },
  { data: [{ id: 42 }] },
  { models: [{ name: {} }] },
  { models: [""] },
]) {
  test(`malformed catalog fails as a provider error: ${JSON.stringify(body)}`, async () => {
    await withCatalog(body, async () => {
      await assert.rejects(listModels(connection), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.reason, "invalid_catalog");
        return true;
      });
    });
  });
}

for (const status of [400, 401, 403, 404, 429, 500]) {
  test(`catalog HTTP ${status} remains a sanitized provider error`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: connection.apiKey } }), {
        status,
      });
    try {
      await assert.rejects(listModels(connection), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.reason, `http_${status}`);
        assert.ok(!error.message.includes(connection.apiKey));
        return true;
      });
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("malformed error detail does not become an internal exception", async () => {
  await withCatalog({ error: { message: 42 } }, async () => {
    await assert.rejects(
      listModels(connection),
      (error: unknown) =>
        error instanceof ProviderError && error.reason === "error_envelope",
    );
  });
});

test("Azure catalog remains manual and makes no remote request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Must not fetch");
  };
  try {
    await assert.rejects(
      listModels({ ...connection, format: "azure" }),
      (error: unknown) =>
        error instanceof ProviderError && error.reason === "unsupported",
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

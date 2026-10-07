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

test("Anthropic catalog follows same-endpoint cursors and combines every page", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(
      new Headers(init?.headers).get("x-api-key"),
      connection.apiKey,
    );
    assert.equal(
      new Headers(init?.headers).get("anthropic-version"),
      "2023-06-01",
    );
    return new Response(
      JSON.stringify(
        calls.length === 1
          ? { data: [{ id: "b" }], has_more: true, last_id: "b" }
          : { data: [{ id: "a" }, { id: "b" }], has_more: false, last_id: "b" },
      ),
    );
  };
  try {
    assert.deepEqual(await listModels({ ...connection, format: "anthropic" }), [
      "a",
      "b",
    ]);
    assert.deepEqual(calls, [
      connection.baseUrl + "/models",
      connection.baseUrl + "/models?after_id=b",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

for (const metadata of [
  { has_more: "true", last_id: "b" },
  { has_more: true },
  { has_more: true, last_id: "" },
  { has_more: true, last_id: "wrong" },
  { has_more: true, last_id: "b\n" },
]) {
  test(`Anthropic rejects malformed continuation: ${JSON.stringify(metadata)}`, async () => {
    await withCatalog({ data: [{ id: "b" }], ...metadata }, async () => {
      await assert.rejects(
        listModels({ ...connection, format: "anthropic" }),
        (error: unknown) =>
          error instanceof ProviderError && error.reason === "invalid_catalog",
      );
    });
  });
}

test("Anthropic rejects cursor cycles without returning partial results", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ data: [{ id: "b" }], has_more: true, last_id: "b" }),
    );
  };
  try {
    await assert.rejects(
      listModels({ ...connection, format: "anthropic" }),
      (error: unknown) =>
        error instanceof ProviderError && error.reason === "invalid_catalog",
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

for (const status of [400, 401, 403, 429, 500]) {
  test(`Anthropic later-page HTTP ${status} rejects the whole catalog safely`, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () =>
      ++calls === 1
        ? new Response(
            JSON.stringify({
              data: [{ id: "b" }],
              has_more: true,
              last_id: "b",
            }),
          )
        : new Response(
            JSON.stringify({ error: { message: connection.apiKey } }),
            { status },
          );
    try {
      await assert.rejects(
        listModels({ ...connection, format: "anthropic" }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.reason, `http_${status}`);
          assert.ok(!error.message.includes(connection.apiKey));
          return true;
        },
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("Anthropic pages share one timeout signal and encode opaque cursors on the saved endpoint", async () => {
  const original = globalThis.fetch;
  const cursor = "model&redirect=https://other.invalid/";
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (input, init) => {
    calls++;
    if (calls === 1) signal = init?.signal;
    else {
      assert.equal(init?.signal, signal);
      const url = new URL(String(input));
      assert.equal(url.origin, new URL(connection.baseUrl).origin);
      assert.deepEqual([...url.searchParams], [["after_id", cursor]]);
    }
    return new Response(
      JSON.stringify(
        calls === 1
          ? { data: [{ id: cursor }], has_more: true, last_id: cursor }
          : { data: [{ id: "a" }], has_more: false },
      ),
    );
  };
  try {
    assert.deepEqual(await listModels({ ...connection, format: "anthropic" }), [
      "a",
      cursor,
    ]);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("Anthropic bounds endless unique pages", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const id = `model-${++calls}`;
    return new Response(
      JSON.stringify({ data: [{ id }], has_more: true, last_id: id }),
    );
  };
  try {
    await assert.rejects(
      listModels({ ...connection, format: "anthropic" }),
      (error: unknown) =>
        error instanceof ProviderError && error.reason === "invalid_catalog",
    );
    assert.equal(calls, 100);
  } finally {
    globalThis.fetch = original;
  }
});

test("compatible catalogs do not inherit Anthropic cursor semantics", async () => {
  await withCatalog(
    { data: [{ id: "a" }], has_more: true, last_id: "a" },
    async () => {
      assert.deepEqual(await listModels(connection), ["a"]);
    },
  );
});

test("Together accepts its native array catalog with stable IDs and no metadata leakage", async () => {
  await withCatalog(
    [
      { id: "b", type: "chat", display_name: "Display" },
      { id: "a", type: "embedding" },
      { id: "b" },
    ],
    async () =>
      assert.deepEqual(await listModels({ ...connection, kind: "together" }), [
        "a",
        "b",
      ]),
  );
  await withCatalog([], async () =>
    assert.deepEqual(await listModels({ ...connection, kind: "together" }), []),
  );
});

for (const entry of [
  null,
  [],
  "a",
  {},
  { name: "a" },
  { id: 42 },
  { id: "" },
  { id: "a\n" },
  { id: "x".repeat(513) },
]) {
  test(`Together rejects malformed array record ${JSON.stringify(entry).slice(0, 60)}`, async () => {
    await withCatalog([{ id: "valid-first" }, entry], async () => {
      await assert.rejects(
        listModels({ ...connection, kind: "together" }),
        (error: unknown) =>
          error instanceof ProviderError && error.reason === "invalid_catalog",
      );
    });
  });
}

test("Together catalog preserves object/error contracts and bounded records", async () => {
  await withCatalog({ data: [{ id: "a" }] }, async () =>
    assert.deepEqual(await listModels({ ...connection, kind: "together" }), [
      "a",
    ]),
  );
  await withCatalog({ error: { message: connection.apiKey } }, async () => {
    await assert.rejects(
      listModels({ ...connection, kind: "together" }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.reason, "error_envelope");
        assert.ok(!error.message.includes(connection.apiKey));
        return true;
      },
    );
  });
  await withCatalog(
    Array.from({ length: 100_001 }, () => ({ id: "a" })),
    async () => {
      await assert.rejects(
        listModels({ ...connection, kind: "together" }),
        (error: unknown) =>
          error instanceof ProviderError && error.reason === "invalid_catalog",
      );
    },
  );
});

test("array normalization is specific to Together's compatible protocol", async () => {
  await withCatalog([{ id: "a" }], async () => {
    for (const ai of [
      connection,
      { ...connection, kind: "openai" },
      { ...connection, kind: "together", format: "anthropic" as const },
    ])
      await assert.rejects(
        listModels(ai),
        (error: unknown) =>
          error instanceof ProviderError && error.reason === "invalid_catalog",
      );
  });
});

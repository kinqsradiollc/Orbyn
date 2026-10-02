import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPublishedMedia } from "../src/modules/publish/media.js";
import { env } from "../src/config/env.js";

const file = {
  id: "11111111-1111-4111-8111-111111111111",
  mime: "image/png",
  bytes: 3,
};
const status = (code: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, code);
  assert.doesNotMatch(String(error), /signed|secret|private-bytes/);
  return true;
};
async function transport(run: () => Promise<void>, fetcher: typeof fetch) {
  const original = globalThis.fetch;
  const url = env.FILES_URL,
    secret = env.FILES_SECRET;
  env.FILES_URL = "http://files:8000";
  env.FILES_SECRET = "publication-unit-test-secret-at-least-32-characters";
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    env.FILES_URL = url;
    env.FILES_SECRET = secret;
  }
}

test("published media fetches only a signed first-party path with redirects denied", async () => {
  await transport(
    async () => {
      assert.deepEqual(
        await loadPublishedMedia(file, new AbortController().signal),
        Buffer.from([1, 2, 3]),
      );
    },
    async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "http://files:8000");
      assert.match(
        url.pathname,
        /^\/files\/r\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      );
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png", "content-length": "3" },
      });
    },
  );
});

test("published media rejects invalid and excessive metadata before fetching", async () => {
  await transport(
    async () => {
      for (const bytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN])
        await assert.rejects(
          loadPublishedMedia({ ...file, bytes }, new AbortController().signal),
          status(413),
        );
    },
    async () => {
      throw new Error("must not fetch");
    },
  );
});

for (const [label, body, mime, length] of [
  ["truncated", [1, 2], "image/png", null],
  ["oversized", [1, 2, 3, 4], "image/png", null],
  ["wrong MIME", [1, 2, 3], "text/html", null],
  ["wrong length", [1, 2, 3], "image/png", "4"],
] as const) {
  test(`published media rejects ${label} storage responses`, async () => {
    await transport(
      async () => {
        await assert.rejects(
          loadPublishedMedia(file, new AbortController().signal),
          status(503),
        );
      },
      async () =>
        new Response(new Uint8Array(body), {
          headers: {
            "content-type": mime,
            ...(length ? { "content-length": length } : {}),
          },
        }),
    );
  });
}

test("published media cancellation stops its stream and hides transport details", async () => {
  const controller = new AbortController();
  let cancelled = false;
  await transport(
    async () => {
      await assert.rejects(
        loadPublishedMedia(file, controller.signal),
        status(503),
      );
      assert.equal(cancelled, true);
    },
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            c.enqueue(new Uint8Array([1]));
            controller.abort();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "image/png" } },
      ),
  );
});

test("published media does not start fetching when the reader already disconnected", async () => {
  const controller = new AbortController();
  controller.abort();
  await transport(
    async () => {
      await assert.rejects(
        loadPublishedMedia(file, controller.signal),
        status(503),
      );
    },
    async () => {
      throw new Error("must not fetch");
    },
  );
});

test("published media refuses credential-bearing or unsupported service URLs", async () => {
  await transport(
    async () => {
      for (const url of [
        "http://user:secret@files:8000",
        "file:///private-bytes",
      ]) {
        env.FILES_URL = url;
        await assert.rejects(
          loadPublishedMedia(file, new AbortController().signal),
          status(503),
        );
      }
    },
    async () => {
      throw new Error("must not fetch");
    },
  );
});

test("published media hides storage failures without returning partial content", async () => {
  await transport(
    async () => {
      await assert.rejects(
        loadPublishedMedia(file, new AbortController().signal),
        status(503),
      );
    },
    async () => {
      throw new Error("secret signed path private-bytes");
    },
  );
});

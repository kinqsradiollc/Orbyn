import { test } from "node:test";
import assert from "node:assert/strict";
import type { DocBlock } from "@orbyn/core";
import type { Queryable } from "../src/db/pool.js";
import { exportImages } from "../src/modules/docs/export-images.js";

const id = "11111111-1111-4111-8111-111111111111";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=",
  "base64",
);
const block = {
  id: "picture",
  type: "image",
  file: id,
  text: "One pixel",
} as DocBlock;
const row = { id, mime: "image/png", bytes: png.length };
function database(rows: (typeof row)[] = [row]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const state = { rows };
  const db = {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: state.rows };
    },
  } as unknown as Queryable;
  return { db, state, calls };
}
function transport(body: Uint8Array = png, mime = "image/png") {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: URL, init: RequestInit) => {
    calls.push({ url: url.toString(), init });
    return new Response(body, { headers: { "content-type": mime } });
  };
  return {
    calls,
    options: {
      baseUrl: "http://files:8000",
      readPath: () => "/files/r/signed.test",
      fetch: fetcher as unknown as typeof fetch,
    },
  };
}
const status = (code: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, code);
  return true;
};

test("image exports deduplicate, authorize and embed first-party bytes", async () => {
  const db = database();
  const network = transport();
  const result = await exportImages(
    db.db,
    "owner",
    [block, block],
    network.options,
  );
  assert.equal(network.calls.length, 1);
  assert.equal(network.calls[0].url, "http://files:8000/files/r/signed.test");
  assert.equal(network.calls[0].init.redirect, "error");
  assert.equal(
    result.fileUrl(id),
    `data:image/png;base64,${png.toString("base64")}`,
  );
  assert.equal(result.fileUrl("other"), null);
  assert.match(db.calls[0].sql, /f.status = 'ready'/);
  assert.match(db.calls[0].sql, /page_file_refs/);
  assert.deepEqual(db.calls[0].values, ["owner", [id]]);
  await result.revalidate();
  assert.equal(db.calls.length, 2);
});

test("text-only exports perform no database or network work", async () => {
  const db = database();
  const network = transport();
  const result = await exportImages(db.db, "owner", [], network.options);
  await result.revalidate();
  assert.equal(db.calls.length, 0);
  assert.equal(network.calls.length, 0);
});

test("unavailable images fail before any file request", async () => {
  const db = database([]);
  const network = transport();
  await assert.rejects(
    exportImages(db.db, "owner", [block], network.options),
    status(404),
  );
  assert.equal(network.calls.length, 0);
});

test("image count and declared byte bounds are checked before fetching", async () => {
  const db = database([{ ...row, bytes: 4 * 1024 * 1024 + 1 }]);
  const network = transport();
  await assert.rejects(
    exportImages(db.db, "owner", [block], network.options),
    status(413),
  );
  const blocks = Array.from(
    { length: 33 },
    (_, i) =>
      ({
        ...block,
        file: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      }) as DocBlock,
  );
  await assert.rejects(
    exportImages(db.db, "owner", blocks, network.options),
    status(413),
  );
  assert.equal(network.calls.length, 0);
});

test("MIME, signature and actual stream size must agree with authorized metadata", async () => {
  for (const network of [
    transport(png, "image/jpeg"),
    transport(new Uint8Array(png.length)),
    transport(new Uint8Array(png.length + 1)),
  ]) {
    await assert.rejects(
      exportImages(database().db, "owner", [block], network.options),
      status(503),
    );
  }
});

test("authored or cross-origin read paths cannot leave the configured file service", async () => {
  const network = transport();
  for (const path of [
    "https://example.com/file",
    "//example.com/file",
    "/files/r/token?redirect=external",
  ]) {
    await assert.rejects(
      exportImages(database().db, "owner", [block], {
        ...network.options,
        readPath: () => path,
      }),
      status(503),
    );
  }
  assert.equal(network.calls.length, 0);
});

test("revocation and changed file metadata fence delivery after rendering", async () => {
  const db = database();
  const result = await exportImages(
    db.db,
    "owner",
    [block],
    transport().options,
  );
  db.state.rows = [];
  await assert.rejects(result.revalidate(), status(404));
  db.state.rows = [{ ...row, bytes: row.bytes + 1 }];
  await assert.rejects(result.revalidate(), status(409));
});

test("an already disconnected caller starts no file stream", async () => {
  const network = transport();
  await assert.rejects(
    exportImages(database().db, "owner", [block], {
      ...network.options,
      signal: AbortSignal.abort(),
    }),
    status(503),
  );
  assert.equal(network.calls.length, 0);
});

test("aggregate bytes and unsupported metadata fail before any file request", async () => {
  const network = transport();
  const ids = [
    id,
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const db = database(
    ids.map((id) => ({ ...row, id, bytes: 3 * 1024 * 1024 })),
  );
  await assert.rejects(
    exportImages(
      db.db,
      "owner",
      ids.map((file) => ({ ...block, file }) as DocBlock),
      network.options,
    ),
    status(413),
  );
  for (const value of [
    { ...row, mime: "image/svg+xml" },
    { ...row, bytes: -1 },
    { ...row, bytes: 1.5 },
  ]) {
    await assert.rejects(
      exportImages(database([value]).db, "owner", [block], network.options),
      status(422),
    );
  }
  assert.equal(network.calls.length, 0);
});

test("oversized streams are cancelled and their partial bytes never returned", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(png.length + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const network = transport();
  await assert.rejects(
    exportImages(database().db, "owner", [block], {
      ...network.options,
      fetch: (async () =>
        new Response(body, {
          headers: { "content-type": "image/png" },
        })) as typeof fetch,
    }),
    status(503),
  );
  assert.equal(cancelled, true);
});

test("encoded and literal traversal are rejected before the transport", async () => {
  const network = transport();
  for (const path of [
    "/files/r/../../internal/files/id",
    "/files/r/%2e%2e/internal",
    "/files/r/token/extra",
  ]) {
    await assert.rejects(
      exportImages(database().db, "owner", [block], {
        ...network.options,
        readPath: () => path,
      }),
      status(503),
    );
  }
  assert.equal(network.calls.length, 0);
});

test("real HTTP redirects are not followed, including to another file-store path", async () => {
  const { createServer } = await import("node:http");
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === "/files/r/signed.test") {
      res.writeHead(302, { location: "/unexpected" }).end();
    } else {
      redirected++;
      res.writeHead(200, { "content-type": "image/png" }).end(png);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await assert.rejects(
      exportImages(database().db, "owner", [block], {
        baseUrl: `http://127.0.0.1:${address.port}`,
        readPath: () => "/files/r/signed.test",
      }),
      status(503),
    );
    assert.equal(redirected, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

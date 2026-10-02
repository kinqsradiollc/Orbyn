import { test, before, after } from "node:test";
import * as Y from "yjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
let token = "";
let docId = "";

const register = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `crdt-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Editor",
      },
    })
  ).json().token as string;

before(async () => {
  await migrate();
  token = await register();
  docId = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "CRDT page",
        content: [{ type: "paragraph", text: "hello", id: "p1" }],
      },
    })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

const post = (url: string, body: unknown, as = token) =>
  app.inject({
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${as}`,
      "content-type": "application/json",
      "x-orbyn-editor": "e-test-1",
    },
    payload: body,
  });

const get = (url: string, as = token) =>
  app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${as}` },
  });

test("updates are filed in order and read back as base64", async () => {
  const put = await post(`/docs/${docId}/updates`, {
    updates: [
      Buffer.from("first-update").toString("base64"),
      Buffer.from("second-update").toString("base64"),
    ],
  });
  assert.equal(put.statusCode, 204, put.body);

  const read = await get(`/docs/${docId}/updates?since=0`);
  assert.equal(read.statusCode, 200);
  const { updates } = read.json();
  assert.equal(updates.length, 2);
  assert.equal(
    Buffer.from(updates[0].update, "base64").toString(),
    "first-update",
  );
  assert.equal(
    Buffer.from(updates[1].update, "base64").toString(),
    "second-update",
  );
  assert.ok(updates[1].seq > updates[0].seq);

  // A watermark in the middle serves only what came after it.
  const rest = await get(`/docs/${docId}/updates?since=${updates[0].seq}`);
  assert.equal(rest.json().updates.length, 1);
});

test("an oversized batch is refused, and a stranger cannot write", async () => {
  const big = await post(`/docs/${docId}/updates`, {
    updates: ["x".repeat(60_001)],
  });
  assert.equal(big.statusCode, 422);

  const stranger = await register();
  const foreign = await post(
    `/docs/${docId}/updates`,
    { updates: ["aGk="] },
    stranger,
  );
  assert.ok(
    foreign.statusCode === 403 || foreign.statusCode === 404,
    `a stranger's write is refused (${foreign.statusCode})`,
  );

  const read = await get(`/docs/${docId}/updates?since=0`, stranger);
  assert.ok(
    read.statusCode === 403 || read.statusCode === 404,
    `a stranger's read is refused (${read.statusCode})`,
  );
});

test("a real Yjs update round-trips through the log and converges", async () => {
  const { blocksToYDoc, yDocToBlocks, encodeYDoc, applyYUpdate } =
    await import("@orbyn/core");
  const doc = blocksToYDoc([
    { type: "paragraph", text: "typed here", id: "p1" },
  ]);
  const update = Buffer.from(encodeYDoc(doc)).toString("base64");
  // Where the log stands now, so the row this test posts can be picked
  // out exactly, whatever else lands in the page's log meanwhile.
  const before = (
    await pool.query(
      "SELECT COALESCE(MAX(seq), 0)::int AS n FROM doc_updates WHERE doc_id = $1",
      [docId],
    )
  ).rows[0].n;
  const put = await post(`/docs/${docId}/updates`, { updates: [update] });
  assert.equal(put.statusCode, 204);

  const read = await get(`/docs/${docId}/updates?since=${before}`);
  const rows = read.json().updates as { seq: number; update: string }[];
  assert.equal(
    rows.length,
    1,
    `exactly the row this test posted (status ${read.statusCode}, before ${before}, body ${read.body.slice(0, 300)})`,
  );
  // A fresh viewer with no containers of its own: applying the update is
  // how every replica is born (see the note on orderOf in doc-crdt.ts).
  const clone = new Y.Doc();
  applyYUpdate(clone, new Uint8Array(Buffer.from(rows[0].update, "base64")));
  const blocks = yDocToBlocks(clone);
  assert.equal(
    blocks.some((block) => "text" in block && block.text === "typed here"),
    true,
    `the typed line comes back (got: ${JSON.stringify(blocks)})`,
  );
});

test("a gone page takes its log with it", async () => {
  const made = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Doomed", content: [] },
    })
  ).json().id;
  await post(`/docs/${made}/updates`, { updates: ["aGk="] });
  // To Trash first (the ordinary delete), then gone for good.
  await app.inject({
    method: "DELETE",
    url: `/docs/${made}`,
    headers: { authorization: `Bearer ${token}` },
  });
  await app.inject({
    method: "DELETE",
    url: `/docs/${made}/forever`,
    headers: { authorization: `Bearer ${token}` },
  });
  const rows = (
    await pool.query(
      "SELECT COUNT(*)::int AS n FROM doc_updates WHERE doc_id = $1",
      [made],
    )
  ).rows[0];
  assert.equal(rows.n, 0);
});

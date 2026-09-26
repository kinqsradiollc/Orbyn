import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { hasVectors, semanticOn, measureQueued, nearest, passages } =
  await import("../src/modules/search/semantic.js");

const app = await buildApp();
let token = "";

before(async () => {
  await migrate();
  token = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `sem-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Searcher",
      },
    })
  ).json().token;
  await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Pricing memo",
      content: [
        {
          type: "paragraph",
          text: "We raise prices by ten per cent in October.",
          id: "p1",
        },
      ],
    },
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

test("the migration runs on a database without pgvector", async (t) => {
  // It is the stock image here, which is the point: everything below must
  // hold on the image the workspace actually runs. A local database that
  // ships pgvector (Postgres.app) can't show it, so the check is skipped
  // there rather than failing on the machine instead of the code.
  if (await hasVectors())
    return t.skip(
      "this test database has pgvector; the check needs the stock image",
    );
  const column = (
    await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ai_settings' AND column_name = 'semantic_search'`,
    )
  ).rowCount;
  assert.equal(column, 1, "the setting exists whether or not vectors do");
  const tables = (
    await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_name IN ('doc_embeddings', 'doc_embedding_queue')`,
    )
  ).rowCount;
  assert.equal(tables, 0, "and nothing that needs vectors was created");
});

test("semantic search is off, and everything that uses it is quiet", async () => {
  assert.equal(await semanticOn(), false);
  assert.equal(await measureQueued(), 0, "nothing is measured");
  assert.deepEqual(
    await nearest("00000000-0000-0000-0000-000000000000", "prices"),
    [],
    "and nothing is found by meaning",
  );
});

test("the word search is unaffected by any of it", async () => {
  const hits = (
    await app.inject({
      method: "GET",
      url: "/search?q=prices",
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Pricing memo");
});

test("only lines that say something are worth measuring", () => {
  const chosen = passages([
    { type: "paragraph", text: "We raise prices in October.", id: "p1" },
    // Too short to mean anything on its own.
    { type: "paragraph", text: "Yes.", id: "p2" },
    // No name, so nothing could point at it.
    { type: "paragraph", text: "An unnamed line with plenty of words." },
    { type: "divider", id: "p4" },
    {
      type: "heading",
      level: 1,
      text: "A heading with several words",
      id: "p5",
    },
  ]);
  assert.deepEqual(
    chosen.map((p) => p.block_id),
    ["p1", "p5"],
  );
});

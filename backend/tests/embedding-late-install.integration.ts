import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { hasVectors, forgetVectors, semanticOn } =
  await import("../src/modules/search/vectors.js");
after(async () => {
  await pool.end();
});

// Run only against a fresh stock-Postgres fixture restored into a pgvector
// server before vector is installed. The ordinary suite uses its stock DB.
test("late extension installation reuses recorded migrations and queues existing pages", async () => {
  assert.equal(await hasVectors(), false);
  assert.equal(
    (await pool.query("SELECT to_regclass('doc_embedding_queue') AS queue"))
      .rows[0].queue,
    null,
  );
  const fixture = (
    await pool.query("SELECT id FROM docs WHERE title='Late embedding fixture'")
  ).rows;
  assert.equal(
    fixture.length,
    1,
    "requires the dedicated restored stock fixture",
  );
  const applied = (
    await pool.query(
      "SELECT applied_at::text FROM migrations WHERE name='203_independent_embeddings.sql'",
    )
  ).rows[0]?.applied_at;
  assert.ok(
    applied,
    "independent schema migration was already recorded on stock Postgres",
  );
  await migrate();
  await migrate();
  forgetVectors();
  assert.equal(await hasVectors(), true);
  assert.equal(
    await semanticOn(),
    false,
    "installing the extension grants no consent",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT applied_at::text FROM migrations WHERE name='203_independent_embeddings.sql'",
      )
    ).rows[0].applied_at,
    applied,
    "old migration history is retained",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM doc_embedding_queue WHERE doc_id=$1",
        [fixture[0].id],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT atttypmod FROM pg_attribute WHERE attrelid='doc_embeddings'::regclass AND attname='embedding'",
      )
    ).rows[0].atttypmod,
    -1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT to_regclass('doc_embeddings_vector_idx') AS index",
      )
    ).rows[0].index,
    null,
  );
});

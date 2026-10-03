import "./setup.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
after(() => pool.end());

// Dedicated fresh pgvector fixture: populate the real pre-upgrade schema first.
test("independent embedding upgrade clears unbound legacy consent and vectors", async () => {
  assert.equal(
    (await pool.query("SELECT to_regclass('migrations') AS table")).rows[0]
      .table,
    null,
    "requires a fresh marked test database",
  );
  const directory = new URL("../migrations/", import.meta.url);
  await transaction(async (db) => {
    await db.query(
      "CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(directory))
      .filter(
        (name) =>
          name.endsWith(".sql") && name < "218_independent_embeddings.sql",
      )
      .sort()) {
      await db.query(await readFile(new URL(name, directory), "utf8"));
      await db.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    }
    await db.query("SELECT ensure_vectors()");
  });
  const user = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash) VALUES('embedding-upgrade@orbyn.test','Upgrade fixture','unusable') RETURNING id",
    )
  ).rows[0].id;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Legacy measured page') RETURNING id",
      [user],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET semantic_search=true,embedding_model='legacy-model',semantic_accepted_at=now(),semantic_accepted_by=$1",
    [user],
  );
  const vector = Array.from({ length: 1536 }, (_, index) =>
    index === 0 ? 1 : 0,
  );
  await pool.query(
    "INSERT INTO doc_embeddings(doc_id,block_id,quote,embedding,model) VALUES($1,'legacy','Legacy passage words', $2::vector,'legacy-model')",
    [doc, JSON.stringify(vector)],
  );
  assert.equal(
    (await pool.query("SELECT count(*)::integer AS count FROM doc_embeddings"))
      .rows[0].count,
    1,
  );
  await migrate();
  await migrate();
  assert.deepEqual(
    (
      await pool.query(
        "SELECT semantic_search,embedding_search_enabled,embedding_model,semantic_accepted_at,embedding_dimensions FROM ai_settings",
      )
    ).rows[0],
    {
      semantic_search: false,
      embedding_search_enabled: false,
      embedding_model: "legacy-model",
      semantic_accepted_at: null,
      embedding_dimensions: null,
    },
  );
  assert.equal(
    (await pool.query("SELECT count(*)::integer AS count FROM doc_embeddings"))
      .rows[0].count,
    0,
    "unproven legacy vectors cannot answer under a new destination",
  );
  await assert.rejects(
    pool.query("UPDATE ai_settings SET semantic_search=true"),
    (error: any) => error.code === "23514",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO doc_embeddings(doc_id,block_id,quote,embedding,model) VALUES($1,'stale','Legacy worker words',$2::vector,'legacy-model')",
      [doc, JSON.stringify(vector)],
    ),
    (error: any) => error.code === "23502",
  );
});

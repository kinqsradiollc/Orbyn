import { readdir, readFile } from "node:fs/promises";
import { transaction } from "./pool.js";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

/**
 * Apply every `migrations/*.sql` file not yet recorded, in filename order,
 * then make sure the vector setup matches the database. Safe to run
 * concurrently.
 */
export async function migrate() {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(786239)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((n) => n.endsWith(".sql"))
      .sort();
    for (const name of files) {
      const applied = await db.query("SELECT 1 FROM migrations WHERE name=$1", [
        name,
      ]);
      if (applied.rowCount) continue;
      await db.query(await readFile(new URL(name, MIGRATIONS_DIR), "utf8"));
      await db.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    }
    // Search by meaning: set up on every run, so swapping in an image with
    // pgvector later turns it on without re-running old migrations. A no-op
    // without the extension (see migrations/101_ensure_vectors.sql).
    await db.query("SELECT ensure_vectors()");
  });
}

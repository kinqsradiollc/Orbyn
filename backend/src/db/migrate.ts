import { readdir, readFile } from "node:fs/promises";
import { transaction } from "./pool.js";
import { retryMigrationTransaction } from "./migration-retry.js";
import {
  lockMigrationJobTable,
  lockMigrationDocumentTables,
} from "./migration-locks.js";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

/**
 * Apply every `migrations/*.sql` file not yet recorded, in filename order,
 * then make sure the vector setup matches the database. Safe to run
 * concurrently.
 */
export async function migrate() {
  await retryMigrationTransaction(
    () =>
      transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(786239)");
        await db.query(
          "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
        );
        const files = (await readdir(MIGRATIONS_DIR))
          .filter((n) => n.endsWith(".sql"))
          .sort();
        const pending: Array<{ name: string; sql: string }> = [];
        for (const name of files) {
          const applied = await db.query(
            "SELECT 1 FROM migrations WHERE name=$1",
            [name],
          );
          if (applied.rowCount) continue;
          pending.push({
            name,
            sql: await readFile(new URL(name, MIGRATIONS_DIR), "utf8"),
          });
        }
        // Old workers claim using a read followed by a write. Upgrading a
        // weaker migration lock after they start can deadlock (production231).
        await lockMigrationJobTable(
          db,
          pending.map((file) => file.sql),
        );
        await lockMigrationDocumentTables(
          db,
          pending.map((file) => file.sql),
        );
        for (const { name, sql } of pending) {
          try {
            await db.query(sql);
          } catch (error) {
            if (error && typeof error === "object")
              Object.assign(error, { migration: name });
            throw error;
          }
          await db.query("INSERT INTO migrations(name) VALUES($1)", [name]);
        }
        // Search by meaning: set up on every run, so swapping in an image with
        // pgvector later turns it on without re-running old migrations. A no-op
        // without the extension (see migrations/101_ensure_vectors.sql).
        await db.query("SELECT ensure_vectors()");
      }),
    {
      report: (attempt, error) => {
        const failure = error as { migration?: string };
        console.warn(
          JSON.stringify({
            event: "migration_deadlock_retry",
            attempt,
            code: "40P01",
            migration: failure.migration ?? null,
          }),
        );
      },
    },
  );
}

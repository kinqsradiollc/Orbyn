import type { Queryable } from "./pool.js";

/** Acquire the worker-table schema lock before the batch can hold weaker locks on it. */
export async function lockMigrationJobTable(
  db: Queryable,
  pendingSql: string[],
): Promise<void> {
  if (!pendingSql.some((sql) => /\bai_jobs\b/i.test(sql))) return;
  const exists = (
    await db.query("SELECT to_regclass('ai_jobs') IS NOT NULL AS present")
  ).rows[0].present;
  // A fresh database creates this table inside the migration transaction.
  if (exists) await db.query("LOCK TABLE ai_jobs IN ACCESS EXCLUSIVE MODE");
}

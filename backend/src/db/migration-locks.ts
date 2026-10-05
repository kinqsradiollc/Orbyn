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

/** Lock document relations before a pending batch can upgrade read locks during DDL. */
export async function lockMigrationDocumentTables(
  db: Queryable,
  pendingSql: string[],
): Promise<void> {
  if (!pendingSql.some((sql) => /\b(?:docs|doc_versions)\b/i.test(sql))) return;
  const present = (
    await db.query<{ docs: boolean; versions: boolean }>(
      "SELECT to_regclass('docs') IS NOT NULL AS docs, to_regclass('doc_versions') IS NOT NULL AS versions",
    )
  ).rows[0];
  const tables = [
    present.docs ? "docs" : null,
    present.versions ? "doc_versions" : null,
  ].filter(Boolean);
  if (tables.length)
    await db.query(`LOCK TABLE ${tables.join(", ")} IN ACCESS EXCLUSIVE MODE`);
}

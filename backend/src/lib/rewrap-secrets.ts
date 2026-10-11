import { env } from "../config/env.js";
import { transaction, type Db } from "../db/pool.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Upgrade database-wrapped credentials before production services restart.
 * Counts only; never returns or logs credential values. The entire conversion
 * rolls back on a missing key, malformed ciphertext or constraint failure.
 */
export async function rewrapLegacySecrets(): Promise<number> {
  if (!env.SECRETS_KEY) {
    if (process.env.NODE_ENV === "production")
      throw new Error("SECRETS_KEY is required before production migrations.");
    return 0;
  }
  return transaction(async (db: Db) => {
    await db.query("SELECT pg_advisory_xact_lock(786252)");
    let changed = 0;
    const columns = (
      await db.query<{ table_name: string; column_name: string }>(
        `SELECT c.table_name,c.column_name FROM information_schema.columns c
       JOIN information_schema.tables t USING(table_schema,table_name)
       WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
         AND c.data_type IN ('text','character varying')
         AND right(c.column_name,10)='_encrypted'`,
      )
    ).rows;
    for (const col of columns) {
      const table = identifier(col.table_name),
        column = identifier(col.column_name);
      const rows = (
        await db.query<{ at: string; value: string }>(
          `SELECT ctid::text AS at,${column} AS value FROM ${table}
         WHERE ${column} LIKE 'd1:%' FOR UPDATE`,
        )
      ).rows;
      for (const row of rows) {
        const wrapped = await encryptSecret(await decryptSecret(row.value));
        await db.query(`UPDATE ${table} SET ${column}=$1 WHERE ctid=$2::tid`, [
          wrapped,
          row.at,
        ]);
        changed++;
      }
    }
    const smtp = (
      await db.query<{ value: Record<string, unknown> }>(
        "SELECT value FROM system_settings WHERE key='smtp' FOR UPDATE",
      )
    ).rows[0];
    if (
      typeof smtp?.value.password_encrypted === "string" &&
      smtp.value.password_encrypted.startsWith("d1:")
    ) {
      smtp.value.password_encrypted = await encryptSecret(
        await decryptSecret(smtp.value.password_encrypted),
      );
      await db.query("UPDATE system_settings SET value=$1 WHERE key='smtp'", [
        JSON.stringify(smtp.value),
      ]);
      changed++;
    }
    const maintenance = (
      await db.query<{ id: string; value: string }>(
        `SELECT id,result->>'maintenance_output_encrypted' AS value FROM ai_jobs
       WHERE result->>'maintenance_output_encrypted' LIKE 'd1:%' FOR UPDATE`,
      )
    ).rows;
    for (const row of maintenance) {
      const wrapped = await encryptSecret(await decryptSecret(row.value));
      await db.query(
        `UPDATE ai_jobs SET result=jsonb_set(result,'{maintenance_output_encrypted}',to_jsonb($1::text)) WHERE id=$2`,
        [wrapped, row.id],
      );
      changed++;
    }
    // All known encrypted credential columns, maintenance results and SMTP storage have moved to
    // the external key. New production writes cannot recreate this key.
    await db.query("DELETE FROM app_secrets WHERE name='credentials_key'");
    return changed;
  });
}

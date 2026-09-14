import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "./db.js";
export async function migrate() {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(786239)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        !(await db.query("SELECT 1 FROM migrations WHERE name=$1", [name]))
          .rowCount
      ) {
        await db.query(await readFile(new URL(name, dir), "utf8"));
        await db.query("INSERT INTO migrations(name) VALUES($1)", [name]);
      }
    }
  });
}
if (
  process.argv[1]?.endsWith("/migrate.ts") ||
  process.argv[1]?.endsWith("/migrate.js")
) {
  await migrate();
  await pool.end();
}

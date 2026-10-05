import type { Db } from "../db/pool.js";
import { fail } from "@orbyn/core";

/** Keep the owner's Agenda facts/policies stable through validation and application. */
export async function lockAgendaSources(db: Db, owner: string): Promise<void> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('agenda-sources:' || $1::text, 0))",
    [owner],
  );
}

/** Reject a conflicting page edit without waiting while holding its owner's source fence. */
export async function lockAgendaSourcePage(
  db: Db,
  sql: string,
  values: unknown[],
) {
  await db.query("SAVEPOINT agenda_source_page_lock");
  try {
    const result = await db.query(sql + " NOWAIT", values);
    await db.query("RELEASE SAVEPOINT agenda_source_page_lock");
    return result;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "55P03" && code !== "40P01") throw error;
    // A failed NOWAIT aborts its subtransaction. Restore it before a claim
    // records a failed parent; the outer operation must not continue applying.
    await db.query("ROLLBACK TO SAVEPOINT agenda_source_page_lock");
    await db.query("RELEASE SAVEPOINT agenda_source_page_lock");
    fail(409, "The Agenda page is being changed. Start a fresh request.");
  }
}

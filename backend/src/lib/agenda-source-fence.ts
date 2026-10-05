import type { Db } from "../db/pool.js";

/** Keep the owner's Agenda facts/policies stable through validation and application. */
export async function lockAgendaSources(db: Db, owner: string): Promise<void> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('agenda-sources:' || $1::text, 0))",
    [owner],
  );
}

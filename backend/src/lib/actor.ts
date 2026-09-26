import type { Queryable } from "../db/pool.js";

/**
 * Who a transaction's changes are made by, for the database's own records:
 * the project timeline, page history and the activity triggers read
 * `orbyn.user_id` (the person) and `orbyn.agent_grant` (the outside agent's
 * connection acting for them, if any) from the transaction's settings.
 *
 * Every write path sets both through here, never one alone (a code check in
 * tests/actor-labels.test.ts holds to that). An inner service that doesn't
 * know about agents passes no grant and keeps the one the transaction was
 * opened with, so a change an agent started stays labelled with it all the
 * way down; a person's own request never has one, so its changes never are.
 * Both settings last until the transaction ends (set_config(…, true)).
 */
export async function actAs(
  db: Queryable,
  userId: string,
  grantId?: string | null,
): Promise<void> {
  await db.query(
    `SELECT set_config('orbyn.user_id', $1, true),
            set_config('orbyn.agent_grant',
              coalesce($2::text, current_setting('orbyn.agent_grant', true), ''),
              true)`,
    [userId, grantId ?? null],
  );
}

/** The agent connection the current transaction acts for, or null. */
export async function actingGrant(db: Queryable): Promise<string | null> {
  const row = (
    await db.query<{ grant_id: string | null }>(
      "SELECT nullif(current_setting('orbyn.agent_grant', true), '') AS grant_id",
    )
  ).rows[0];
  return row?.grant_id ?? null;
}

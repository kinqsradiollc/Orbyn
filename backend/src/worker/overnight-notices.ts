import { addDays } from "@orbyn/core";
import { transaction } from "../db/pool.js";
import { buildOvernightSection } from "./digest.js";

/** Queue the saved morning results once, without using a model or mail server. */
export async function queueOvernightNotices(
  now = new Date(),
  only?: string[],
): Promise<number> {
  return transaction(async (db) => {
    const nights = (
      await db.query<{
        id: string;
        user_id: string;
        day: string;
        name: string;
      }>(
        `SELECT n.id, n.user_id, n.local_day::text AS day, coalesce(a.name, 'Orbyn') AS name
       FROM assistant_nights n JOIN users u ON u.id = n.user_id
       JOIN agent_settings a ON a.user_id = u.id
       WHERE n.notified_at IS NULL AND NOT u.disabled
         AND ($2::uuid[] IS NULL OR n.user_id = ANY($2::uuid[]))
         AND (n.summary->>'end_at')::timestamptz <= $1
         AND (n.summary->>'end_at')::timestamptz > $1::timestamptz - interval '1 day'
         AND EXISTS(SELECT 1 FROM agent_grants g WHERE g.user_id = u.id AND g.kind = 'assistant'
           AND g.revoked_at IS NULL AND g.suspended_at IS NULL)
       ORDER BY n.local_day, n.id FOR UPDATE OF n SKIP LOCKED LIMIT 20`,
        [now, only ?? null],
      )
    ).rows;
    let queued = 0;
    for (const night of nights) {
      const section = await buildOvernightSection(
        night.user_id,
        addDays(night.day, 1),
        night.id,
      );
      if (section) {
        await db.query(
          `INSERT INTO notifications(user_id, item_version, channel, destination, title, body, state, kind, ref)
           SELECT u.id, 0, delivery.channel, delivery.destination, $2, $3,
             CASE WHEN delivery.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'assistant', $4
           FROM users u CROSS JOIN LATERAL (
             SELECT 'inapp' AS channel, u.id::text AS destination
             UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
           ) delivery WHERE u.id = $1`,
          [
            night.user_id,
            `${night.name} · Overnight`,
            section.firstLine,
            `overnight:${night.id}`,
          ],
        );
        queued++;
      }
      await db.query(
        "UPDATE assistant_nights SET notified_at = $2 WHERE id = $1",
        [night.id, now],
      );
    }
    return queued;
  });
}

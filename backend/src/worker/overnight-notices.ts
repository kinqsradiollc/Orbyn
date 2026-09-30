import { addDays } from "@orbyn/core";
import { transaction } from "../db/pool.js";
import { buildOvernightSection } from "./digest.js";
import { announceTo } from "../modules/presence/live.js";

/** Send one morning notice and refresh its saved card as late work settles. */
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
        notified_at: Date | null;
        active: boolean;
      }>(
        `SELECT n.id, n.user_id, n.local_day::text AS day, coalesce(a.name, 'Orbyn') AS name, n.notified_at,
         EXISTS(SELECT 1 FROM assistant_night_runs nr JOIN ai_jobs j ON j.id=nr.job_id
           WHERE nr.night_id=n.id AND j.state IN ('queued','running')) AS active
       FROM assistant_nights n JOIN users u ON u.id = n.user_id
       JOIN agent_settings a ON a.user_id = u.id
       WHERE NOT u.disabled
         AND ($2::uuid[] IS NULL OR n.user_id = ANY($2::uuid[]))
         AND (n.summary->>'end_at')::timestamptz <= $1
         AND (n.summary->>'end_at')::timestamptz > $1::timestamptz - interval '1 day'
         AND EXISTS(SELECT 1 FROM agent_grants g WHERE g.user_id = u.id AND g.kind = 'assistant'
           AND g.revoked_at IS NULL AND g.suspended_at IS NULL)
       ORDER BY (n.notified_at IS NULL) DESC, n.notice_checked_at NULLS FIRST, n.local_day, n.id FOR UPDATE OF n SKIP LOCKED LIMIT 20`,
        [now, only ?? null],
      )
    ).rows;
    let queued = 0;
    for (const night of nights) {
      await db.query(
        "UPDATE assistant_nights SET notice_checked_at=clock_timestamp() WHERE id=$1",
        [night.id],
      );
      const section = await buildOvernightSection(
        night.user_id,
        addDays(night.day, 1),
        night.id,
      );
      if (section && night.notified_at) {
        // The morning card is provisional while work is still settling. Refresh
        // that same card on material changes; keep the single push ownership.
        const changed = await db.query(
          "UPDATE notifications SET body=$2 WHERE user_id=$1 AND ref=$3 AND channel='inapp' AND body IS DISTINCT FROM $2 RETURNING id",
          [night.user_id, section.firstLine, `overnight:${night.id}`],
        );
        if (changed.rowCount)
          await announceTo(db, { user_id: night.user_id }, "changed", {
            area: "assistant",
          });
        continue;
      }
      if (section) {
        await db.query(
          `INSERT INTO notifications(user_id, item_version, channel, destination, title, body, state, kind, ref)
           SELECT u.id, 0, delivery.channel, delivery.destination, $2, CASE WHEN delivery.channel='push' AND $5 THEN 'Your night shift is ready to review. Some work is still settling; open Overnight for the latest results.' ELSE $3 END,
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
            night.active,
          ],
        );
        await announceTo(db, { user_id: night.user_id }, "changed", {
          area: "assistant",
        });
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

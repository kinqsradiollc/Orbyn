import { pool } from "../db/pool.js";
import { queueWebhookFor, queueWebhooks } from "../lib/webhooks.js";
import { blocksTime, calendarEntries } from "../modules/planner/calendar.js";
import { visibleItems } from "../lib/visibility.js";

/**
 * Webhook events the notifier sends on a schedule rather than on a change:
 * `event.starting` before each busy event and `block.started` when a time
 * block starts. Each goes once per webhook and occurrence (the delivery's
 * `dedupe_key`), however often the scan runs.
 */

/** Something that started this long ago still counts as just started. */
const GRACE_MS = 5 * 60_000;

/**
 * `event.starting`: for every active webhook that wants it, each busy event
 * (timed, not free, not closed) its owner can see that starts within the
 * webhook's `lead_minutes`, including team events.
 */
export async function scanEventStarting(now = new Date()) {
  const hooks = (
    await pool.query<{ id: string; user_id: string; lead_minutes: number }>(
      `SELECT w.id, w.user_id, w.lead_minutes FROM webhooks w
       JOIN users u ON u.id = w.user_id AND NOT u.disabled
       WHERE w.active AND 'event.starting' = ANY (w.events)
       ORDER BY w.user_id LIMIT 2000`,
    )
  ).rows;
  const byUser = new Map<string, typeof hooks>();
  for (const h of hooks)
    byUser.set(h.user_id, [...(byUser.get(h.user_id) ?? []), h]);
  for (const [userId, own] of byUser) {
    const lead = Math.max(...own.map((h) => h.lead_minutes)) * 60_000;
    const from = new Date(now.getTime() - GRACE_MS);
    const to = new Date(now.getTime() + lead + 1);
    const entries = (await calendarEntries(pool, userId, from, to)).filter(
      (e) => blocksTime(e) && Date.parse(e.start_at) > from.getTime(),
    );
    for (const e of entries)
      for (const h of own) {
        if (Date.parse(e.start_at) > now.getTime() + h.lead_minutes * 60_000)
          continue;
        await queueWebhookFor(
          pool,
          h.id,
          "event.starting",
          {
            item_id: e.item_id,
            title: e.title,
            start_at: e.start_at,
            end_at: e.end_at,
            occurrence: e.occurrence,
            location: e.location,
            meeting_url: e.meeting_url,
            team_id: e.team_id,
            lead_minutes: h.lead_minutes,
          },
          `event:${e.item_id}:${e.start_at}`,
        );
      }
  }
}

/** `block.started`: each time block that has just started, for its owner's webhooks. */
export async function scanBlocksStarted(now = new Date()) {
  const blocks = (
    await pool.query<{
      id: string;
      user_id: string;
      item_id: string;
      title: string;
      start_at: Date;
      end_at: Date;
    }>(
      `SELECT b.id, b.user_id, b.item_id, i.title, b.start_at, b.end_at
       FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.start_at <= $1 AND b.start_at > $1::timestamptz - make_interval(secs => $2)
         AND ${visibleItems("i", { user: "b.user_id" })}
         AND EXISTS (SELECT 1 FROM webhooks w WHERE w.user_id = b.user_id AND w.active
                     AND 'block.started' = ANY (w.events))
       LIMIT 2000`,
      [now, GRACE_MS / 1000],
    )
  ).rows;
  for (const b of blocks)
    await queueWebhooks(
      pool,
      "block.started",
      { user_id: b.user_id, team_id: null },
      {
        id: b.id,
        item_id: b.item_id,
        title: b.title,
        start_at: b.start_at.toISOString(),
        end_at: b.end_at.toISOString(),
      },
      `block:${b.id}:${b.start_at.toISOString()}`,
    );
}

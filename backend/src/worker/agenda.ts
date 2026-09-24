import { localDateKey } from "@orbyn/core";
import { pool } from "../db/pool.js";
import { todaysAgenda } from "../modules/docs/agenda.js";

/** Local hour past midnight in `tz`. */
const localHour = (now: Date, tz: string) =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(now),
  );

/**
 * "Written for you each morning": between 5 and 11 in each person's own
 * zone, write today's agenda for anyone who has used Orbyn this week and
 * doesn't have one yet, with the assistant's summary of the day when a
 * provider is connected. Opening the agenda before then still writes it on
 * the spot, without the summary. Each pass writes up to `limit` pages (25), so a
 * busy morning spreads over several passes.
 */
export async function scanMorningAgendas(
  now = new Date(),
  options: { limit?: number; only?: string[] } = {},
) {
  const limit = options.limit ?? 25;
  const people = (
    await pool.query<{ id: string; tz: string }>(
      `SELECT u.id, coalesce(p.timezone, 'UTC') AS tz FROM users u
         LEFT JOIN planner_prefs p ON p.user_id = u.id
        WHERE NOT u.disabled
          AND ($1::uuid[] IS NULL OR u.id = ANY ($1::uuid[]))
          AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id
                        AND s.last_seen_at > now() - interval '7 days')
        ORDER BY u.id`,
      [options.only ?? null],
    )
  ).rows.filter((p) => {
    const h = localHour(now, p.tz);
    return h >= 5 && h < 11;
  });
  // Five at a time, and no more than about a minute per pass, so the
  // assistant's summaries never hold up reminders on the same worker.
  const deadline = Date.now() + 60_000;
  let written = 0;
  let next = 0;
  const lane = async () => {
    while (next < people.length && written < limit && Date.now() < deadline) {
      const p = people[next++];
      // Any page for today counts, even one in Trash: a page thrown away
      // this morning is not written again behind its owner's back.
      const has = await pool.query(
        `SELECT 1 FROM docs WHERE user_id = $1 AND kind = 'agenda'
           AND agenda_date = $2::date LIMIT 1`,
        [p.id, localDateKey(now, p.tz)],
      );
      if (has.rowCount) continue;
      try {
        await todaysAgenda(p.id, { withBrief: true, now });
        written++;
      } catch {
        // One person's page failing must not stop everyone else's.
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, lane));
  return written;
}

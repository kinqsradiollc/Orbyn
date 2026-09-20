import { randomUUID } from "node:crypto";
import {
  addDays,
  clockMinutes,
  dayTime,
  localDateKey,
  type DigestPrefs,
} from "@orbyn/core";
import { pool } from "../db/pool.js";
import {
  blocksTime,
  calendarEntries,
  loadPrefs,
  timeBlocks,
} from "../modules/planner/calendar.js";
import { habitBlocksIn } from "../modules/planner/habits.js";
import { reviewFor } from "../modules/planner/plans.js";
import { appLink } from "../modules/booking/service.js";
import { emailEnabled, sendEmail } from "./channels/email.js";

/** "9:00 am" in the person's zone. */
function clockOf(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  })
    .format(new Date(iso))
    .toLowerCase();
}

const bullet = (s: string) => `• ${s}`;

/** The morning agenda: today's events, due tasks, set-aside time and habits. */
export async function buildMorning(
  userId: string,
  name: string,
  now: Date,
  tz: string,
): Promise<{ subject: string; lines: string[] }> {
  const today = localDateKey(now, tz);
  const dayEnd = dayTime(addDays(today, 1), 0, tz);
  const [entries, blocks, habits, review] = await Promise.all([
    calendarEntries(pool, userId, now, dayEnd),
    timeBlocks(pool, userId, now, dayEnd),
    habitBlocksIn(pool, userId, now, dayEnd),
    reviewFor(pool, userId, now),
  ]);
  const events = entries
    .filter((e) => e.kind === "event" && blocksTime(e) && e.end_at)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const dueTasks = entries
    .filter(
      (e) =>
        e.kind === "task" && e.status !== "done" && e.status !== "cancelled",
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const lines = [`Good morning, ${name}.`];
  if (!events.length && !dueTasks.length && !blocks.length && !habits.length)
    lines.push("Nothing scheduled today — a clear page.");
  if (events.length) {
    lines.push("Today’s events:");
    lines.push(
      ...events.map((e) => bullet(`${clockOf(e.start_at, tz)} — ${e.title}`)),
    );
  }
  if (dueTasks.length) {
    lines.push("Due today:");
    lines.push(...dueTasks.slice(0, 12).map((t) => bullet(t.title)));
  }
  if (blocks.length) {
    lines.push("Time you’ve set aside:");
    lines.push(
      ...blocks
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .map((b) =>
          bullet(
            `${clockOf(b.start_at, tz)}–${clockOf(b.end_at, tz)} — ${b.title}`,
          ),
        ),
    );
  }
  if (habits.length) {
    lines.push("Habits:");
    lines.push(
      ...habits.map((h) => bullet(`${clockOf(h.start_at, tz)} — ${h.name}`)),
    );
  }
  if (review.at_risk.length) {
    lines.push("Heads up — at risk of being late:");
    lines.push(...review.at_risk.slice(0, 3).map((t) => bullet(t.title)));
  }
  lines.push(`Open your day: ${appLink("/app")}`);
  return { subject: "Your day ahead", lines };
}

/** The evening review: what’s still open, and a look at tomorrow. */
export async function buildEvening(
  userId: string,
  name: string,
  now: Date,
  tz: string,
): Promise<{ subject: string; lines: string[] }> {
  const today = localDateKey(now, tz);
  const tomorrow = addDays(today, 1);
  const tomStart = dayTime(tomorrow, 0, tz);
  const tomEnd = dayTime(addDays(tomorrow, 1), 0, tz);
  const [review, done, tomorrowEntries] = await Promise.all([
    reviewFor(pool, userId, now),
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM items
         WHERE user_id = $1 AND status = 'done'
           AND updated_at >= $2 AND updated_at < $3`,
      [userId, dayTime(today, 0, tz).toISOString(), tomStart.toISOString()],
    ),
    calendarEntries(pool, userId, tomStart, tomEnd),
  ]);
  const finished = done.rows[0].n;
  const tomorrowEvents = tomorrowEntries
    .filter((e) => e.kind === "event" && blocksTime(e) && e.end_at)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const tomorrowTasks = tomorrowEntries.filter(
    (e) => e.kind === "task" && e.status !== "done" && e.status !== "cancelled",
  );

  const lines = [`Winding down, ${name}.`];
  lines.push(
    finished
      ? `You finished ${finished} thing${finished === 1 ? "" : "s"} today. Nice work.`
      : "A quieter day — that’s fine too.",
  );
  if (review.unfinished.length) {
    lines.push("Still open from earlier:");
    lines.push(...review.unfinished.slice(0, 8).map((b) => bullet(b.title)));
  }
  if (tomorrowEvents.length || tomorrowTasks.length) {
    lines.push("Tomorrow:");
    lines.push(
      ...tomorrowEvents
        .slice(0, 8)
        .map((e) => bullet(`${clockOf(e.start_at, tz)} — ${e.title}`)),
    );
    lines.push(...tomorrowTasks.slice(0, 8).map((t) => bullet(t.title)));
  } else lines.push("Nothing on the calendar for tomorrow yet.");
  lines.push(`Plan tomorrow: ${appLink("/app")}`);
  return { subject: "Today’s wrap-up", lines };
}

const build = {
  morning: buildMorning,
  evening: buildEvening,
} as const;
type Kind = keyof typeof build;

/** Local minutes past midnight, in `tz`. */
function localMinutes(now: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).formatToParts(now);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0");
  const m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/**
 * Send any digest that has come due. A person gets each digest once a day,
 * claimed by inserting a digest_sends row before sending, so several notifier
 * replicas never send twice. Runs only when a mail server is configured.
 */
export async function scanDigests(now = new Date()) {
  if (!(await emailEnabled())) return;
  const rows = (
    await pool.query<{
      user_id: string;
      email: string;
      name: string;
      timezone: string;
      digest: Partial<DigestPrefs> | null;
    }>(
      `SELECT p.user_id, u.email, u.name, p.timezone, p.digest
         FROM planner_prefs p JOIN users u ON u.id = p.user_id
        WHERE u.disabled = false
          AND ((p.digest->>'morning')::boolean OR (p.digest->>'evening')::boolean)`,
    )
  ).rows;
  for (const row of rows) {
    const tz = row.timezone || "UTC";
    const mins = localMinutes(now, tz);
    const on = localDateKey(now, tz);
    for (const kind of ["morning", "evening"] as Kind[]) {
      const d = row.digest ?? {};
      if (!d[kind]) continue;
      const at = clockMinutes(
        d[`${kind}_time`] ?? (kind === "morning" ? "07:00" : "17:00"),
      );
      if (mins < at) continue;
      // Claim the send; only the replica that inserts the row sends the email.
      const won = await pool.query(
        `INSERT INTO digest_sends (user_id, kind, on_date) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING user_id`,
        [row.user_id, kind, on],
      );
      if (!won.rowCount) continue;
      try {
        const { subject, lines } = await build[kind](
          row.user_id,
          row.name,
          now,
          tz,
        );
        await sendEmail({
          id: randomUUID(),
          destination: row.email,
          title: subject,
          body: lines.filter(Boolean).join("\n\n"),
        });
      } catch {
        // A failed send isn't retried today; a missed digest beats a repeat.
      }
    }
  }
}

import type { FastifyInstance } from "fastify";
import {
  addDays,
  calendarSubscriptionInput,
  calendarSubscriptionUpdate,
  dayTime,
  fail,
  localDateKey,
  localDaysBetween,
  occurrencesBetween,
  type CalendarSubscription,
  type ExternalEntry,
} from "@orbyn/core";
import {
  pool,
  reader,
  transaction,
  type Queryable as Db,
} from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { assertPublicUrl } from "../../lib/netguard.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { parseIcs, type IcsEvent } from "./icsParse.js";

/**
 * Calendars from other apps (timetables, holidays, a work calendar), read by
 * their ICS link. The notifier fetches each one hourly, and soon after it's
 * added; the events are kept read-only and shown on the owner's calendar.
 * They count as busy only when the subscription says so, and then only as
 * busy intervals: their details never reach teammates or booking pages.
 * Links must reach public addresses (checked on save and on every fetch and
 * redirect), so they can't make the server call its own network.
 */
const MAX_SUBSCRIPTIONS = 20;
const MAX_EVENTS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const REFRESH_EVERY = "1 hour";

const COLUMNS = `id, url, name, color, busy, last_fetched_at, last_error, event_count, created_at`;

type Fetched =
  | { status: "not_modified" }
  | {
      status: "ok";
      text: string;
      etag: string | null;
      last_modified: string | null;
    };

/**
 * GET a calendar link, following at most 3 redirects (each checked again),
 * within 15 seconds and 5 MB, and asking only for changes since last time.
 */
export async function fetchCalendar(
  url: string,
  cache: { etag: string | null; last_modified: string | null } = {
    etag: null,
    last_modified: null,
  },
): Promise<Fetched> {
  let current = url;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current, "calendar");
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: {
          Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
          "User-Agent": "Orbyn-Calendar/1",
          ...(cache.etag ? { "If-None-Match": cache.etag } : {}),
          ...(cache.last_modified
            ? { "If-Modified-Since": cache.last_modified }
            : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        (error as Error).name === "TimeoutError"
          ? "The calendar didn't answer within 15 seconds."
          : "Couldn't reach the calendar. Check the link.",
      );
    }
    if (response.status === 304) return { status: "not_modified" };
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get("location");
      if (!location) throw new Error("The calendar link redirected nowhere.");
      if (hop >= MAX_REDIRECTS)
        throw new Error("The calendar link redirected too many times.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`The calendar answered ${response.status}.`);
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES)
      throw new Error("The calendar is larger than 5 MB.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const body = response.body?.getReader();
    while (body) {
      const { done, value } = await body.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await body.cancel().catch(() => {});
        throw new Error("The calendar is larger than 5 MB.");
      }
      chunks.push(value);
    }
    return {
      status: "ok",
      text: new TextDecoder().decode(Buffer.concat(chunks)),
      etag: response.headers.get("etag"),
      last_modified: response.headers.get("last-modified"),
    };
  }
}

/** Replace a subscription's events with what `events` says, in one go. */
async function storeEvents(
  subscriptionId: string,
  events: IcsEvent[],
  fetched: { etag: string | null; last_modified: string | null },
) {
  await transaction(async (db) => {
    await db.query(
      "SELECT 1 FROM calendar_subscriptions WHERE id = $1 FOR UPDATE",
      [subscriptionId],
    );
    await db.query("DELETE FROM external_events WHERE subscription_id = $1", [
      subscriptionId,
    ]);
    for (let i = 0; i < events.length; i += 500)
      await db.query(
        `INSERT INTO external_events (subscription_id, uid, recurrence_id, title, starts_at,
           ends_at, all_day, location, rrule, exdates, timezone, transparent)
         SELECT $1, x.uid, x.recurrence_id, x.title, x.starts_at, x.ends_at, x.all_day,
           x.location, x.rrule,
           ARRAY(SELECT jsonb_array_elements_text(x.exdates)::timestamptz),
           x.timezone, x.transparent
         FROM jsonb_to_recordset($2::jsonb) AS x(uid text, recurrence_id timestamptz,
           title text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
           location text, rrule text, exdates jsonb, timezone text, transparent boolean)`,
        [subscriptionId, JSON.stringify(events.slice(i, i + 500))],
      );
    await db.query(
      `UPDATE calendar_subscriptions SET etag = $2, last_modified = $3,
         last_fetched_at = now(), last_error = NULL, event_count = $4
       WHERE id = $1`,
      [subscriptionId, fetched.etag, fetched.last_modified, events.length],
    );
  });
}

/**
 * Fetch one subscription now. A failure is recorded in `last_error` and the
 * events from the last good fetch stay.
 */
export async function refreshSubscription(id: string) {
  const sub = (
    await pool.query<{
      id: string;
      url: string;
      etag: string | null;
      last_modified: string | null;
      zone: string;
    }>(
      `SELECT s.id, s.url, s.etag, s.last_modified, coalesce(p.timezone, 'UTC') AS zone
       FROM calendar_subscriptions s LEFT JOIN planner_prefs p ON p.user_id = s.user_id
       WHERE s.id = $1`,
      [id],
    )
  ).rows[0];
  if (!sub) return;
  try {
    const got = await fetchCalendar(sub.url, sub);
    if (got.status === "not_modified") {
      await pool.query(
        "UPDATE calendar_subscriptions SET last_fetched_at = now(), last_error = NULL WHERE id = $1",
        [id],
      );
      return;
    }
    if (!/BEGIN:VCALENDAR/i.test(got.text))
      throw new Error("That link isn't an iCalendar (.ics) feed.");
    await storeEvents(id, parseIcs(got.text, sub.zone, MAX_EVENTS), got);
  } catch (error) {
    await pool.query(
      "UPDATE calendar_subscriptions SET last_fetched_at = now(), last_error = $2 WHERE id = $1",
      [
        id,
        ((error as Error).message || "The calendar couldn't be read.").slice(
          0,
          300,
        ),
      ],
    );
  }
}

/**
 * Refresh subscriptions not fetched in the last hour (new ones first). Each
 * is claimed by setting `last_fetched_at`, so several notifiers never fetch
 * the same one; they're fetched side by side.
 */
export async function refreshDueSubscriptions(limit = 3) {
  const due = (
    await pool.query<{ id: string }>(
      `UPDATE calendar_subscriptions SET last_fetched_at = now()
       WHERE id IN (
         SELECT s.id FROM calendar_subscriptions s JOIN users u ON u.id = s.user_id AND NOT u.disabled
         WHERE s.last_fetched_at IS NULL OR s.last_fetched_at < now() - interval '${REFRESH_EVERY}'
         ORDER BY s.last_fetched_at NULLS FIRST LIMIT $1
         FOR UPDATE OF s SKIP LOCKED)
       RETURNING id`,
      [limit],
    )
  ).rows;
  await Promise.all(due.map((s) => refreshSubscription(s.id)));
  return due.length;
}

type ExternalRow = {
  subscription_id: string;
  name: string;
  color: string;
  sub_busy: boolean;
  title: string;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  location: string;
  rrule: string | null;
  exdates: Date[];
  timezone: string;
  transparent: boolean;
};

/**
 * The owner's subscribed events overlapping [from, to), one per occurrence.
 * `onlyBusy` keeps the ones that count as busy: timed, not marked free, from
 * a subscription with "busy" on. `words` must all appear in the title or
 * location (search).
 */
export async function externalEntries(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  onlyBusy = false,
  words: string[] = [],
): Promise<ExternalEntry[]> {
  const rows = (
    await db.query<ExternalRow>(
      `SELECT e.subscription_id, s.name, s.color, s.busy AS sub_busy, e.title, e.starts_at,
              e.ends_at, e.all_day, e.location, e.rrule, e.exdates, e.timezone, e.transparent
       FROM external_events e JOIN calendar_subscriptions s ON s.id = e.subscription_id
       WHERE s.user_id = $1 AND e.starts_at < $3 AND (e.rrule IS NOT NULL OR e.ends_at > $2)
         AND ($4::boolean IS FALSE OR (s.busy AND NOT e.all_day AND NOT e.transparent))
         AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) w
                         WHERE (e.title || ' ' || e.location) NOT ILIKE w)
       ORDER BY e.starts_at LIMIT ${MAX_EVENTS}`,
      [userId, from, to, onlyBusy, words],
    )
  ).rows;
  const out: ExternalEntry[] = [];
  for (const r of rows) {
    const entry = (start: Date, end: Date): ExternalEntry => ({
      subscription_id: r.subscription_id,
      name: r.name,
      color: r.color,
      title: r.title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: r.all_day,
      location: r.location,
      busy: r.sub_busy && !r.all_day && !r.transparent,
    });
    if (!r.rrule) {
      out.push(entry(r.starts_at, r.ends_at));
      continue;
    }
    const length = r.ends_at.getTime() - r.starts_at.getTime();
    const days = r.all_day
      ? Math.max(1, localDaysBetween(r.starts_at, r.ends_at, r.timezone))
      : 0;
    for (const at of occurrencesBetween(
      r.starts_at,
      r.rrule,
      r.timezone,
      new Date(from.getTime() - length),
      to,
      r.exdates,
    )) {
      const end = r.all_day
        ? dayTime(addDays(localDateKey(at, r.timezone), days), 0, r.timezone)
        : new Date(at.getTime() + length);
      if (end > from) out.push(entry(at, end));
    }
  }
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

async function ownSubscription(db: Db, id: string, userId: string) {
  const row = (
    await db.query<CalendarSubscription>(
      `SELECT ${COLUMNS} FROM calendar_subscriptions WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Calendar not found");
  return row;
}

export async function subscriptionRoutes(app: FastifyInstance) {
  app.get("/me/calendar-subscriptions", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<CalendarSubscription>(
        `SELECT ${COLUMNS} FROM calendar_subscriptions WHERE user_id = $1 ORDER BY created_at, id`,
        [u.id],
      )
    ).rows;
  });

  app.post("/me/calendar-subscriptions", async (r, reply) => {
    const u = await authenticate(r);
    const d = calendarSubscriptionInput.parse(r.body);
    await assertPublicUrl(d.url, "calendar");
    const sub = await transaction(async (db) => {
      await db.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [u.id]);
      const count = (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM calendar_subscriptions WHERE user_id = $1",
          [u.id],
        )
      ).rows[0].n;
      if (count >= MAX_SUBSCRIPTIONS)
        fail(
          409,
          `You can subscribe to ${MAX_SUBSCRIPTIONS} calendars at most.`,
        );
      return (
        await db.query<CalendarSubscription>(
          `INSERT INTO calendar_subscriptions (user_id, url, name, color, busy)
           VALUES ($1, $2, $3, coalesce($4, '#6b8fb5'), $5) RETURNING ${COLUMNS}`,
          [u.id, d.url, d.name, d.color ?? null, d.busy],
        )
      ).rows[0];
    });
    reply.code(201);
    return sub;
  });

  app.put("/me/calendar-subscriptions/:id", async (r) => {
    const u = await authenticate(r);
    const d = calendarSubscriptionUpdate.parse(r.body);
    const current = await ownSubscription(pool, idParam(r), u.id);
    if (d.url && d.url !== current.url)
      await assertPublicUrl(d.url, "calendar");
    // A new link is fetched again from scratch soon; its old events stay until then.
    const moved = !!d.url && d.url !== current.url;
    return (
      await pool.query<CalendarSubscription>(
        `UPDATE calendar_subscriptions SET url = $3, name = $4, color = $5, busy = $6,
           etag = CASE WHEN $7 THEN NULL ELSE etag END,
           last_modified = CASE WHEN $7 THEN NULL ELSE last_modified END,
           last_fetched_at = CASE WHEN $7 THEN NULL ELSE last_fetched_at END
         WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
        [
          current.id,
          u.id,
          d.url ?? current.url,
          d.name ?? current.name,
          d.color ?? current.color,
          d.busy ?? current.busy,
          moved,
        ],
      )
    ).rows[0];
  });

  app.delete("/me/calendar-subscriptions/:id", async (r, reply) => {
    const u = await authenticate(r);
    const deleted = await pool.query(
      "DELETE FROM calendar_subscriptions WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!deleted.rowCount) fail(404, "Calendar not found");
    return reply.code(204).send();
  });

  // Fetch it now instead of waiting for the hourly refresh.
  app.post(
    "/me/calendar-subscriptions/:id/refresh",
    strictRateLimit,
    async (r) => {
      const u = await authenticate(r);
      const sub = await ownSubscription(pool, idParam(r), u.id);
      await refreshSubscription(sub.id);
      return ownSubscription(pool, sub.id, u.id);
    },
  );
}

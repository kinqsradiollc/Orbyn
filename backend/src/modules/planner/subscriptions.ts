import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  CALENDAR_KIND_DEFAULTS,
  addDays,
  calendarSubscriptionInput,
  calendarSubscriptionUpdate,
  dayTime,
  fail,
  HttpError,
  localDateKey,
  localDaysBetween,
  occurrencesBetween,
  type CalendarKind,
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
import { assertPublicUrl, publicFetch } from "../../lib/netguard.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { announceTo } from "../presence/live.js";
import { parseIcs, type IcsEvent } from "./icsParse.js";

/**
 * Calendars from other apps (timetables, exams, shifts, meetings, holidays),
 * read by their ICS link. Each is fetched as soon as it's added and hourly
 * after; an unchanged feed isn't rewritten, and a changed one tells the
 * owner's open apps. The events are kept read-only. A subscription's kind
 * sets its defaults (see CALENDAR_KIND_DEFAULTS): whether its events count
 * as busy, whether all-day ones block the day, reminders, and whether
 * teammates see the busy time. Only busy intervals ever leave the owner:
 * titles never reach teammates or booking pages.
 * Links must reach public addresses (checked on save and on every fetch and
 * redirect), so they can't make the server call its own network.
 */
const MAX_SUBSCRIPTIONS = 20;
const MAX_EVENTS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const REFRESH_EVERY = "1 hour";

const COLUMNS = `id, url, name, color, kind, busy, all_day_busy, visible, sharing,
  reminder_minutes, last_fetched_at, last_error, event_count, created_at`;

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
    let response: Response;
    try {
      // Checked (https, public addresses only) and called at the checked
      // address; a redirect comes back here to be checked in turn.
      response = await publicFetch(
        current,
        {
          headers: {
            Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
            "User-Agent": "Orbyn-Calendar/1",
            ...(cache.etag ? { "If-None-Match": cache.etag } : {}),
            ...(cache.last_modified
              ? { "If-Modified-Since": cache.last_modified }
              : {}),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
        "calendar",
      );
    } catch (error) {
      // A link refused by the check says why in its own words.
      if (error instanceof HttpError) throw error;
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
  hash: string,
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
         last_fetched_at = now(), last_error = NULL, event_count = $4, content_hash = $5
       WHERE id = $1`,
      [
        subscriptionId,
        fetched.etag,
        fetched.last_modified,
        events.length,
        hash,
      ],
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
      user_id: string;
      url: string;
      etag: string | null;
      last_modified: string | null;
      content_hash: string | null;
      last_error: string | null;
      zone: string;
    }>(
      `SELECT s.id, s.user_id, s.url, s.etag, s.last_modified, s.content_hash, s.last_error,
              coalesce(p.timezone, 'UTC') AS zone
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
    // Most feeds (Google's included) send no ETag, and Google stamps every
    // event with the time it was downloaded (DTSTAMP), so the text differs
    // each time, and lists them in a different order. Compare the events read
    // from it instead, in a fixed order: the same events in the same zone
    // aren't rewritten and no app is told.
    const events = parseIcs(got.text, sub.zone, MAX_EVENTS);
    const key = (e: IcsEvent) =>
      `${e.uid}\u0000${e.recurrence_id ?? ""}\u0000${e.starts_at}`;
    const hash = createHash("sha256")
      .update(sub.zone)
      .update("\n")
      .update(
        JSON.stringify([...events].sort((a, b) => (key(a) < key(b) ? -1 : 1))),
      )
      .digest("hex");
    if (hash === sub.content_hash && !sub.last_error) {
      await pool.query(
        `UPDATE calendar_subscriptions SET last_fetched_at = now(), last_error = NULL,
           etag = $2, last_modified = $3 WHERE id = $1`,
        [id, got.etag, got.last_modified],
      );
      return;
    }
    await storeEvents(id, events, got, hash);
    // Open apps re-read their calendar.
    await announceTo(pool, { user_id: sub.user_id }, "changed").catch(() => {});
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
  uid: string;
  name: string;
  color: string;
  kind: CalendarKind;
  sub_busy: boolean;
  all_day_busy: boolean;
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

export type ExternalOptions = {
  /** Only events that count as busy. */
  busy?: boolean;
  /**
   * Who is asking: "self" (you, your planner, your booking pages) or
   * "others" (teammates, your busy feed), who don't see subscriptions whose
   * sharing is "hidden".
   */
  audience?: "self" | "others";
  /** Only calendars shown on your calendar (not hidden ones). */
  visible?: boolean;
  /** Every word must appear in the title or location (search). */
  words?: string[];
};

/** An occurrence as the server keeps it: with the event's uid, for reminders. */
export type ExternalOccurrence = ExternalEntry & { uid: string };

/**
 * The owner's subscribed events overlapping [from, to), one per occurrence.
 * An event counts as busy when its calendar is busy, it isn't marked free in
 * the source, and it's timed, or all-day on a calendar whose all-day events
 * block the day (exams, leave).
 */
export async function externalOccurrences(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  options: ExternalOptions = {},
): Promise<ExternalOccurrence[]> {
  const rows = (
    await db.query<ExternalRow>(
      `SELECT e.subscription_id, e.uid, s.name, s.color, s.kind, s.busy AS sub_busy,
              s.all_day_busy, e.title, e.starts_at, e.ends_at, e.all_day, e.location,
              e.rrule, e.exdates, e.timezone, e.transparent
       FROM external_events e JOIN calendar_subscriptions s ON s.id = e.subscription_id
       WHERE s.user_id = $1 AND e.starts_at < $3 AND (e.rrule IS NOT NULL OR e.ends_at > $2)
         AND ($4::boolean IS FALSE OR (s.busy AND NOT e.transparent
                                       AND (NOT e.all_day OR s.all_day_busy)))
         AND ($5::boolean IS FALSE OR s.sharing = 'busy')
         AND ($6::boolean IS FALSE OR s.visible)
         AND NOT EXISTS (SELECT 1 FROM unnest($7::text[]) w
                         WHERE (e.title || ' ' || e.location) NOT ILIKE w)
       ORDER BY e.starts_at LIMIT ${MAX_EVENTS}`,
      [
        userId,
        from,
        to,
        !!options.busy,
        options.audience === "others",
        !!options.visible,
        options.words ?? [],
      ],
    )
  ).rows;
  const out: ExternalOccurrence[] = [];
  for (const r of rows) {
    const entry = (start: Date, end: Date): ExternalOccurrence => ({
      subscription_id: r.subscription_id,
      uid: r.uid,
      name: r.name,
      color: r.color,
      title: r.title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: r.all_day,
      location: r.location,
      busy: r.sub_busy && !r.transparent && (!r.all_day || r.all_day_busy),
      calendar_kind: r.kind,
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

/** The same, as the apps see them (without the source uid). */
export async function externalEntries(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  options: ExternalOptions = {},
): Promise<ExternalEntry[]> {
  return (await externalOccurrences(db, userId, from, to, options)).map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ uid, ...e }) => e,
  );
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
      // The kind picks the defaults; anything given explicitly wins.
      const kind = d.kind ?? "other";
      const preset = CALENDAR_KIND_DEFAULTS[kind];
      return (
        await db.query<CalendarSubscription>(
          `INSERT INTO calendar_subscriptions (user_id, url, name, color, kind, busy,
             all_day_busy, visible, sharing, reminder_minutes)
           VALUES ($1, $2, $3, coalesce($4, '#6b8fb5'), $5, $6, $7, $8, $9, $10)
           RETURNING ${COLUMNS}`,
          [
            u.id,
            d.url,
            d.name,
            d.color ?? null,
            kind,
            d.busy ?? preset.busy,
            d.all_day_busy ?? preset.all_day_busy,
            d.visible ?? true,
            d.sharing ?? preset.sharing,
            d.reminder_minutes === undefined
              ? preset.reminder_minutes
              : d.reminder_minutes,
          ],
        )
      ).rows[0];
    });
    // Read it straight away, so its events (or what's wrong with the link)
    // show as soon as it's added rather than at the next hourly refresh.
    await refreshSubscription(sub.id);
    reply.code(201);
    return ownSubscription(pool, sub.id, u.id);
  });

  app.put("/me/calendar-subscriptions/:id", async (r) => {
    const u = await authenticate(r);
    const d = calendarSubscriptionUpdate.parse(r.body);
    const current = await ownSubscription(pool, idParam(r), u.id);
    if (d.url && d.url !== current.url)
      await assertPublicUrl(d.url, "calendar");
    // A new link is fetched again from scratch soon; its old events stay until then.
    const moved = !!d.url && d.url !== current.url;
    const updated = (
      await pool.query<CalendarSubscription>(
        `UPDATE calendar_subscriptions SET url = $3, name = $4, color = $5, busy = $6,
           kind = $8, all_day_busy = $9, visible = $10, sharing = $11, reminder_minutes = $12,
           etag = CASE WHEN $7 THEN NULL ELSE etag END,
           last_modified = CASE WHEN $7 THEN NULL ELSE last_modified END,
           content_hash = CASE WHEN $7 THEN NULL ELSE content_hash END,
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
          d.kind ?? current.kind,
          d.all_day_busy ?? current.all_day_busy,
          d.visible ?? current.visible,
          d.sharing ?? current.sharing,
          d.reminder_minutes === undefined
            ? current.reminder_minutes
            : d.reminder_minutes,
        ],
      )
    ).rows[0];
    if (moved) {
      await refreshSubscription(current.id);
      return ownSubscription(pool, current.id, u.id);
    }
    // Busy time and what's shown changed: open apps re-read.
    await announceTo(pool, { user_id: u.id }, "changed").catch(() => {});
    return updated;
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

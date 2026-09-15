import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import {
  addDays,
  bookingPageInput,
  bookingPageUpdate,
  bookingRequest,
  dayTime,
  fail,
  localDateKey,
  publicSlotsQuery,
  type Booking,
  type BookingPage,
  type BookingReceipt,
  type BusyInterval,
  type PublicBookingPage,
} from "@orbyn/core";
import { z } from "zod";
import { env } from "../../config/env.js";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, digest, type UserRow } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { emailEnabled, sendEmail } from "../../worker/channels/email.js";
import { mutate } from "../items/service.js";
import {
  busyIntervals,
  loadPrefs,
  mergeIntervals,
} from "../planner/calendar.js";
import { freeSpans, workingSpans } from "../planner/plans.js";

/**
 * Booking pages: people outside Orbyn pick a time when every required host is
 * free. The public page only ever sees free times, never host calendars.
 * With email set up, a booking waits for the link sent to the booker;
 * without it, bookings are confirmed at once.
 */
const PAGE_COLUMNS = `p.id, p.owner_id, p.slug, p.title, p.description, p.durations, p.window_days,
  p.min_notice_minutes, p.buffer_minutes, p.max_per_day, p.location, p.meeting_url, p.active,
  p.created_at, p.updated_at,
  coalesce((SELECT json_agg(json_build_object('user_id', h.user_id, 'name', u.name, 'required', h.required)
                            ORDER BY h.required DESC, u.name)
            FROM booking_hosts h JOIN users u ON u.id = h.user_id WHERE h.page_id = p.id), '[]') AS hosts`;

const BOOKING_COLUMNS =
  "id, page_id, start_at, end_at, name, email, note, status, created_at";

const SLOT_STEP_MS = 15 * 60_000;
const MAX_SLOTS = 300;

type PageRow = BookingPage & { hosts: BookingPage["hosts"] };

async function pageById(
  db: Queryable,
  id: string,
): Promise<PageRow | undefined> {
  return (
    await db.query<PageRow>(
      `SELECT ${PAGE_COLUMNS} FROM booking_pages p WHERE p.id = $1`,
      [id],
    )
  ).rows[0];
}

async function pageBySlug(
  db: Queryable,
  slug: string,
): Promise<PageRow | undefined> {
  return (
    await db.query<PageRow>(
      `SELECT ${PAGE_COLUMNS} FROM booking_pages p WHERE p.slug = $1 AND p.active`,
      [slug],
    )
  ).rows[0];
}

/** Co-hosts must share a team with the owner. */
async function checkCoHosts(db: Db, ownerId: string, ids: string[]) {
  const others = ids.filter((id) => id !== ownerId);
  if (!others.length) return;
  const ok = (
    await db.query<{ n: number }>(
      `SELECT count(DISTINCT m.user_id)::int AS n FROM team_members m
       WHERE m.user_id = ANY ($2::uuid[])
         AND m.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)`,
      [ownerId, others],
    )
  ).rows[0].n;
  if (ok !== new Set(others).size)
    fail(422, "Co-hosts must be in one of your teams.");
}

async function setHosts(
  db: Db,
  pageId: string,
  ownerId: string,
  coHosts: { user_id: string; required: boolean }[],
) {
  await db.query("DELETE FROM booking_hosts WHERE page_id = $1", [pageId]);
  const hosts = new Map<string, boolean>([[ownerId, true]]);
  for (const h of coHosts)
    if (h.user_id !== ownerId) hosts.set(h.user_id, h.required);
  for (const [user, required] of hosts)
    await db.query(
      "INSERT INTO booking_hosts (page_id, user_id, required) VALUES ($1, $2, $3)",
      [pageId, user, required],
    );
}

/** Owners manage a page; hosts can see its bookings. */
async function requirePage(
  db: Queryable,
  id: string,
  u: UserRow,
  owner: boolean,
) {
  const page = await pageById(db, id);
  if (
    !page ||
    (owner
      ? page.owner_id !== u.id
      : !page.hosts.some((h) => h.user_id === u.id))
  )
    fail(404, "Booking page not found");
  return page;
}

type Span = { start: number; end: number };

/**
 * Free start times for a page between `from` and `to`: working time every
 * required host has free (events, buffers, travel and time blocks count as
 * busy), minus other bookings still held, with the page's buffer around
 * everything, its notice period, and its daily limit.
 */
export async function availableSlots(
  db: Queryable,
  page: PageRow,
  duration: number,
  from: Date,
  to: Date,
  now = new Date(),
  ignoreBookingId?: string,
): Promise<BusyInterval[]> {
  const earliest = Math.max(
    from.getTime(),
    now.getTime() + page.min_notice_minutes * 60_000,
  );
  const latest = Math.min(
    to.getTime(),
    now.getTime() + page.window_days * 86_400_000,
  );
  if (latest <= earliest) return [];
  const start = new Date(earliest);
  const end = new Date(latest);
  const required = page.hosts.filter((h) => h.required).map((h) => h.user_id);
  const buffer = page.buffer_minutes * 60_000;
  const holds = (
    await db.query<{ start_at: Date; end_at: Date }>(
      `SELECT b.start_at, b.end_at FROM bookings b
       WHERE b.page_id IN (SELECT page_id FROM booking_hosts WHERE user_id = ANY ($1::uuid[]))
         AND b.status = 'pending' AND b.hold_until > now()
         AND b.start_at < $3 AND b.end_at > $2 AND b.id IS DISTINCT FROM $4::uuid`,
      [required, start, end, ignoreBookingId ?? null],
    )
  ).rows.map((h) => ({
    start_at: h.start_at.toISOString(),
    end_at: h.end_at.toISOString(),
  }));
  let common: Span[] | null = null;
  for (const host of required) {
    const prefs = await loadPrefs(db, host);
    const busy = [...(await busyIntervals(db, host, start, end)), ...holds].map(
      (b) => ({
        start_at: new Date(Date.parse(b.start_at) - buffer).toISOString(),
        end_at: new Date(Date.parse(b.end_at) + buffer).toISOString(),
      }),
    );
    const free = freeSpans(
      workingSpans(prefs, start, end),
      mergeIntervals(busy),
    );
    common = common ? intersect(common, free) : free;
  }
  if (!common) return [];
  // The daily limit counts bookings on the owner's local day.
  const ownerPrefs = await loadPrefs(db, page.owner_id);
  const counts = new Map<string, number>();
  if (page.max_per_day) {
    const taken = (
      await db.query<{ start_at: Date }>(
        `SELECT start_at FROM bookings WHERE page_id = $1 AND status <> 'cancelled'
           AND (status = 'confirmed' OR hold_until > now()) AND start_at < $3 AND end_at > $2
           AND id IS DISTINCT FROM $4::uuid`,
        [page.id, start, end, ignoreBookingId ?? null],
      )
    ).rows;
    for (const t of taken) {
      const day = localDateKey(t.start_at, ownerPrefs.timezone);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const need = duration * 60_000;
  const slots: BusyInterval[] = [];
  for (const span of common) {
    for (
      let at = Math.ceil(span.start / SLOT_STEP_MS) * SLOT_STEP_MS;
      at + need <= span.end && slots.length < MAX_SLOTS;
      at += SLOT_STEP_MS
    ) {
      if (page.max_per_day) {
        const day = localDateKey(new Date(at), ownerPrefs.timezone);
        if ((counts.get(day) ?? 0) >= page.max_per_day) continue;
      }
      slots.push({
        start_at: new Date(at).toISOString(),
        end_at: new Date(at + need).toISOString(),
      });
    }
  }
  return slots;
}

function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

const whenLabel = (start: Date, end: Date, timeZone: string) => {
  const day = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  const until = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(end);
  return `${day} to ${until} (${timeZone})`;
};

const appLink = (path: string) => `${env.APP_URL.replace(/\/$/, "")}${path}`;

type BookingRow = Booking & {
  timezone: string;
  item_ids: string[];
  hold_until: Date;
  start_at: string | Date;
  end_at: string | Date;
};

/**
 * Confirm a booking: check the time is still free, put the event on every
 * host's calendar, tell the hosts, and email the booker.
 */
async function confirmBooking(db: Db, booking: BookingRow, page: PageRow) {
  const start = new Date(booking.start_at);
  const end = new Date(booking.end_at);
  const duration = (end.getTime() - start.getTime()) / 60_000;
  const free = await availableSlots(
    db,
    page,
    duration,
    start,
    end,
    new Date(
      Math.min(Date.now(), start.getTime() - page.min_notice_minutes * 60_000),
    ),
    booking.id,
  );
  if (!free.some((s) => s.start_at === start.toISOString()))
    fail(409, "That time was just taken. Pick another time.");
  const itemIds: string[] = [];
  for (const host of page.hosts) {
    const item = await mutate(
      db,
      { id: host.user_id, role: "member" },
      {
        operation: "create",
        data: {
          title: `${page.title} with ${booking.name}`.slice(0, 200),
          notes: [
            `Booked by ${booking.name} <${booking.email}> through /book/${page.slug}.`,
            booking.note,
          ]
            .filter(Boolean)
            .join("\n\n"),
          kind: "event",
          status: "todo",
          priority: "medium",
          due_at: start.toISOString(),
          end_at: end.toISOString(),
          reminder_minutes: 15,
          team_id: null,
          location: page.location,
          meeting_url: page.meeting_url,
        },
      },
    );
    itemIds.push(item!.id);
    const prefs = await loadPrefs(db, host.user_id);
    await db.query(
      `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
         title, body, state, kind, ref)
       VALUES ($1::uuid, $2, 0, 'inapp', $1::text, $3, $4, 'sent', 'booking', $5)
       ON CONFLICT (item_id, item_version, channel, destination, kind, ref) DO NOTHING`,
      [
        host.user_id,
        item!.id,
        `New booking: ${page.title}`,
        `${booking.name} booked ${whenLabel(start, end, prefs.timezone)}.`,
        booking.id,
      ],
    );
  }
  await db.query(
    "UPDATE bookings SET status = 'confirmed', item_ids = $2, confirm_token_hash = NULL WHERE id = $1",
    [booking.id, itemIds],
  );
  await queueWebhooks(
    db,
    "booking.confirmed",
    { user_id: page.owner_id, team_id: null },
    {
      id: booking.id,
      page: page.slug,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      name: booking.name,
      email: booking.email,
    },
  );
}

async function mail(to: string, title: string, body: string) {
  await sendEmail({ id: randomUUID(), destination: to, title, body });
}

async function cancelBooking(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  by: "booker" | "host",
) {
  await db.query(
    "UPDATE bookings SET status = 'cancelled', confirm_token_hash = NULL, cancel_token_hash = NULL WHERE id = $1",
    [booking.id],
  );
  if (booking.item_ids.length)
    await db.query("DELETE FROM items WHERE id = ANY ($1::uuid[])", [
      booking.item_ids,
    ]);
  if (by === "host" && (await emailEnabled()))
    await mail(
      booking.email,
      `Cancelled: ${page.title}`,
      `Your booking for ${whenLabel(new Date(booking.start_at), new Date(booking.end_at), booking.timezone)} was cancelled by the host.`,
    ).catch(() => {});
}

export async function bookingRoutes(app: FastifyInstance) {
  // ---- managing pages (signed in) ----------------------------------------------

  app.get("/booking-pages", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<BookingPage>(
        `SELECT ${PAGE_COLUMNS} FROM booking_pages p
         WHERE p.owner_id = $1 OR p.id IN (SELECT page_id FROM booking_hosts WHERE user_id = $1)
         ORDER BY p.created_at DESC`,
        [u.id],
      )
    ).rows;
  });

  app.post("/booking-pages", async (r, reply) => {
    const u = await authenticate(r);
    const d = bookingPageInput.parse(r.body);
    const page = await transaction(async (db) => {
      await checkCoHosts(
        db,
        u.id,
        d.co_hosts.map((h) => h.user_id),
      );
      const { id } = (
        await db
          .query<{ id: string }>(
            `INSERT INTO booking_pages (owner_id, slug, title, description, durations, window_days,
               min_notice_minutes, buffer_minutes, max_per_day, location, meeting_url, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [
              u.id,
              d.slug,
              d.title,
              d.description,
              [...new Set(d.durations)].sort((a, b) => a - b),
              d.window_days,
              d.min_notice_minutes,
              d.buffer_minutes,
              d.max_per_day,
              d.location,
              d.meeting_url,
              d.active,
            ],
          )
          .catch((error) =>
            (error as { code?: string }).code === "23505"
              ? fail(409, "That link is taken. Try another.")
              : Promise.reject(error),
          )
      ).rows[0];
      await setHosts(db, id, u.id, d.co_hosts);
      return pageById(db, id);
    });
    reply.code(201);
    return page;
  });

  app.put("/booking-pages/:id", async (r) => {
    const u = await authenticate(r);
    const d = bookingPageUpdate.parse(r.body);
    return transaction(async (db) => {
      const current = await requirePage(db, idParam(r), u, true);
      if (d.co_hosts)
        await checkCoHosts(
          db,
          u.id,
          d.co_hosts.map((h) => h.user_id),
        );
      const next = { ...current, ...d };
      await db
        .query(
          `UPDATE booking_pages SET slug=$2, title=$3, description=$4, durations=$5, window_days=$6,
             min_notice_minutes=$7, buffer_minutes=$8, max_per_day=$9, location=$10,
             meeting_url=$11, active=$12, updated_at=now() WHERE id=$1`,
          [
            current.id,
            next.slug,
            next.title,
            next.description,
            [...new Set(next.durations)].sort((a, b) => a - b),
            next.window_days,
            next.min_notice_minutes,
            next.buffer_minutes,
            next.max_per_day,
            next.location,
            next.meeting_url,
            next.active,
          ],
        )
        .catch((error) =>
          (error as { code?: string }).code === "23505"
            ? fail(409, "That link is taken. Try another.")
            : Promise.reject(error),
        );
      if (d.co_hosts) await setHosts(db, current.id, u.id, d.co_hosts);
      return pageById(db, current.id);
    });
  });

  app.delete("/booking-pages/:id", async (r, reply) => {
    const u = await authenticate(r);
    await transaction(async (db) => {
      const page = await requirePage(db, idParam(r), u, true);
      await db.query("DELETE FROM booking_pages WHERE id = $1", [page.id]);
    });
    return reply.code(204).send();
  });

  app.get("/booking-pages/:id/bookings", async (r) => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const page = await requirePage(db, idParam(r), u, false);
    return (
      await db.query<Booking>(
        `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE page_id = $1
           AND (status = 'confirmed' OR (status = 'pending' AND hold_until > now()))
           AND end_at > now() - interval '30 days'
         ORDER BY start_at LIMIT 200`,
        [page.id],
      )
    ).rows;
  });

  app.post("/booking-pages/:id/bookings/:bookingId/cancel", async (r) => {
    const u = await authenticate(r);
    return transaction(async (db) => {
      const page = await requirePage(db, idParam(r), u, false);
      const booking = (
        await db.query<BookingRow>(
          "SELECT * FROM bookings WHERE id = $1 AND page_id = $2 FOR UPDATE",
          [idParam(r, "bookingId"), page.id],
        )
      ).rows[0];
      if (!booking || booking.status === "cancelled")
        fail(404, "Booking not found");
      await cancelBooking(db, booking, page, "host");
      return { cancelled: true };
    });
  });

  // ---- the public page (no sign-in) ----------------------------------------------

  app.get("/book/:slug", async (r): Promise<PublicBookingPage> => {
    const { slug } = z.object({ slug: z.string().max(60) }).parse(r.params);
    const q = publicSlotsQuery.parse(r.query);
    const db = reader(r.headers);
    const page = await pageBySlug(db, slug.toLowerCase());
    if (!page) fail(404, "This booking page doesn't exist or is switched off.");
    const duration = q.duration ?? page.durations[0];
    if (!page.durations.includes(duration))
      fail(422, "Pick one of the offered lengths.");
    const firstDay = q.date ?? localDateKey(new Date(), q.timezone);
    const from = dayTime(firstDay, 0, q.timezone);
    const to = dayTime(addDays(firstDay, q.days), 0, q.timezone);
    return {
      slug: page.slug,
      title: page.title,
      description: page.description,
      durations: page.durations,
      location: page.location,
      has_meeting_link: !!page.meeting_url,
      hosts: page.hosts.map((h) => h.name),
      timezone: q.timezone,
      duration,
      slots: await availableSlots(db, page, duration, from, to),
    };
  });

  app.post(
    "/book/:slug",
    strictRateLimit,
    async (r, reply): Promise<BookingReceipt> => {
      const { slug } = z.object({ slug: z.string().max(60) }).parse(r.params);
      const d = bookingRequest.parse(r.body);
      const receipt = await transaction(async (db) => {
        const page = await pageBySlug(db, slug.toLowerCase());
        if (!page)
          fail(404, "This booking page doesn't exist or is switched off.");
        if (!page.durations.includes(d.duration))
          fail(422, "Pick one of the offered lengths.");
        // One booking at a time per page, so two people can't take the same slot.
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [page.id]);
        const start = new Date(d.start_at);
        const end = new Date(start.getTime() + d.duration * 60_000);
        const free = await availableSlots(db, page, d.duration, start, end);
        if (!free.some((s) => s.start_at === start.toISOString()))
          fail(409, "That time was just taken. Pick another time.");
        const confirmToken = randomBytes(24).toString("base64url");
        const cancelToken = randomBytes(24).toString("base64url");
        const booking = (
          await db.query<BookingRow>(
            `INSERT INTO bookings (page_id, start_at, end_at, name, email, note, timezone,
             confirm_token_hash, cancel_token_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              page.id,
              start,
              end,
              d.name,
              d.email,
              d.note,
              d.timezone,
              digest(confirmToken),
              digest(cancelToken),
            ],
          )
        ).rows[0];
        const when = whenLabel(start, end, d.timezone);
        const cancelLine = `To cancel: ${appLink(`/book/cancel/${cancelToken}`)}`;
        if (await emailEnabled()) {
          await mail(
            d.email,
            `Confirm your booking: ${page.title}`,
            [
              `Hi ${d.name},`,
              `Please confirm ${page.title} with ${page.hosts.map((h) => h.name).join(", ")} on ${when}:`,
              appLink(`/book/confirm/${confirmToken}`),
              "The time is held for 30 minutes.",
              cancelLine,
            ].join("\n\n"),
          ).catch(() =>
            fail(502, "Couldn't send the confirmation email. Try again."),
          );
          return { booking, needs: true };
        }
        // Without email there's no way to check the address, so confirm now.
        await confirmBooking(db, booking, page);
        return { booking, needs: false };
      });
      reply.code(201);
      return {
        id: receipt.booking.id,
        status: receipt.needs ? "pending" : "confirmed",
        start_at: new Date(receipt.booking.start_at).toISOString(),
        end_at: new Date(receipt.booking.end_at).toISOString(),
        needs_confirmation: receipt.needs,
      };
    },
  );

  app.post(
    "/book/confirm/:token",
    strictRateLimit,
    async (r): Promise<BookingReceipt> => {
      const { token } = z
        .object({ token: z.string().min(20).max(64) })
        .parse(r.params);
      return transaction(async (db) => {
        const booking = (
          await db.query<BookingRow>(
            "SELECT * FROM bookings WHERE confirm_token_hash = $1 FOR UPDATE",
            [digest(token)],
          )
        ).rows[0];
        if (!booking)
          fail(404, "This link has already been used or isn't valid.");
        if (booking.status !== "pending" || booking.hold_until <= new Date())
          fail(410, "This booking expired. Book again.");
        const page = await pageById(db, booking.page_id);
        if (!page?.active) fail(404, "This booking page is switched off.");
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [page.id]);
        await confirmBooking(db, booking, page);
        const start = new Date(booking.start_at);
        const end = new Date(booking.end_at);
        await mail(
          booking.email,
          `Confirmed: ${page.title}`,
          `You're booked for ${page.title} on ${whenLabel(start, end, booking.timezone)}.${
            page.location ? `\n\nWhere: ${page.location}` : ""
          }${page.meeting_url ? `\n\nJoin: ${page.meeting_url}` : ""}`,
        ).catch(() => {});
        return {
          id: booking.id,
          status: "confirmed",
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          needs_confirmation: false,
        };
      });
    },
  );

  app.post("/book/cancel/:token", strictRateLimit, async (r) => {
    const { token } = z
      .object({ token: z.string().min(20).max(64) })
      .parse(r.params);
    return transaction(async (db) => {
      const booking = (
        await db.query<BookingRow>(
          "SELECT * FROM bookings WHERE cancel_token_hash = $1 FOR UPDATE",
          [digest(token)],
        )
      ).rows[0];
      if (!booking || booking.status === "cancelled")
        fail(
          404,
          "This booking was already cancelled or the link isn't valid.",
        );
      const page = await pageById(db, booking.page_id);
      if (!page) fail(404, "Booking not found");
      await cancelBooking(db, booking, page, "booker");
      return { cancelled: true };
    });
  });
}

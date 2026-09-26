import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import {
  addDays,
  bookingNoteInput,
  bookingPageInput,
  bookingPageUpdate,
  bookingReason,
  bookingRequest,
  bookingReschedule,
  bookingsQuery,
  bookingStatsQuery,
  dayTime,
  DEFAULT_BOOKER_REMINDERS,
  fail,
  localDateKey,
  noShowInput,
  publicSlotsQuery,
  rescheduleSlotsQuery,
  type Booking,
  type BookingDetail,
  type BookingPage,
  type BookingReceipt,
  type BookingStats,
  type BookingView,
  type ManagedBooking,
  type PublicBookingPage,
} from "@orbyn/core";
import { z } from "zod";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, digest, type UserRow } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { encryptSecret } from "../../lib/secrets.js";
import { emailEnabled, sendEmail } from "../../worker/channels/email.js";
import { availableSlots, chooseHost, type PageRow } from "./availability.js";
import {
  checkCoHosts,
  managesTeam,
  PAGE_COLUMNS,
  pageById,
  pageFor,
} from "./pages.js";
import {
  answerLines,
  appLink,
  approve,
  awaitApproval,
  cancel,
  confirm,
  decline,
  logEvent,
  reschedule,
  whenLabel,
  type BookingRow,
} from "./service.js";
import { inMyTeams } from "../../lib/visibility.js";

/**
 * Booking pages: people outside Orbyn pick a time when every required host is
 * free. Hosts shape each page (hours, overrides, questions, approval, look)
 * and track every booking in one inbox. Public routes only ever see free
 * times and the booker's own booking.
 */
/** Pages `$1` owns, hosts, or manages as an owner or admin of the page's team. */
const MY_PAGES = `SELECT id FROM booking_pages WHERE owner_id = $1
  UNION SELECT page_id FROM booking_hosts WHERE user_id = $1
  UNION SELECT bp.id FROM booking_pages bp JOIN team_members tm
    ON tm.team_id = bp.team_id AND tm.user_id = $1 AND tm.role IN ('owner', 'admin')`;

/** Bookings on pages `$1` owns, hosts or manages, and from open invites they host. */
const MINE = `(b.page_id IN (${MY_PAGES})
  OR b.invite_id IN (SELECT id FROM open_invites WHERE owner_id = $1 OR $1 = ANY (co_host_ids)))`;

const BOOKING_SELECT = `SELECT b.id, b.page_id, b.invite_id,
  coalesce(p.title, oi.title) AS page_title, coalesce(p.slug, '') AS page_slug,
  b.start_at, b.end_at, b.name, b.email, b.note, b.answers,
  CASE WHEN b.status IN ('pending', 'awaiting_approval') AND b.hold_until <= now()
       THEN 'expired' ELSE b.status END AS status,
  b.no_show, b.host_note, b.cancel_reason, b.cancelled_by, b.reschedule_count, b.timezone,
  b.created_at, b.updated_at
  FROM bookings b LEFT JOIN booking_pages p ON p.id = b.page_id
  LEFT JOIN open_invites oi ON oi.id = b.invite_id`;

const VIEWS: Record<BookingView, { where: string; order: string }> = {
  upcoming: {
    where: `(b.status = 'confirmed' OR (b.status = 'pending' AND b.hold_until > now())) AND b.end_at >= now()`,
    order: "b.start_at",
  },
  needs_approval: {
    where: `b.status = 'awaiting_approval' AND b.hold_until > now()`,
    order: "b.start_at",
  },
  past: {
    where: `b.status = 'confirmed' AND b.end_at < now()`,
    order: "b.start_at DESC",
  },
  cancelled: {
    where: `(b.status IN ('cancelled', 'declined')
             OR (b.status IN ('pending', 'awaiting_approval') AND b.hold_until <= now()))`,
    order: "b.updated_at DESC",
  },
  all: { where: "true", order: "b.start_at DESC" },
};

const SLUG_TAKEN = "That link is taken. Try another.";
const taken = (error: unknown) =>
  (error as { code?: string }).code === "23505"
    ? fail(409, SLUG_TAKEN)
    : Promise.reject(error);

async function pageBySlug(db: Queryable, slug: string) {
  return (
    await db.query<PageRow>(
      `SELECT ${PAGE_COLUMNS} FROM booking_pages p WHERE p.slug = $1 AND p.active`,
      [slug.toLowerCase()],
    )
  ).rows[0];
}

/**
 * Who may edit a page: its owner, or an owner or admin of the page's team.
 * Who may see and act on its bookings: those, and its hosts. An open
 * invite's owner and co-hosts are its hosts.
 */
async function canEdit(db: Queryable, page: PageRow, u: UserRow) {
  if (page.owner_id === u.id) return true;
  return !!page.team_id && (await managesTeam(db, page.team_id, u.id));
}
const canHost = async (db: Queryable, page: PageRow, u: UserRow) =>
  page.hosts.some((h) => h.user_id === u.id) || (await canEdit(db, page, u));

/** A page `u` may edit (`owner`), or whose bookings they may act on. */
async function requirePage(
  db: Queryable,
  id: string,
  u: UserRow,
  owner: boolean,
) {
  const page = await pageById(db, id);
  if (
    !page ||
    !(owner ? await canEdit(db, page, u) : await canHost(db, page, u))
  )
    fail(404, "Booking page not found");
  return page;
}

/** The page or open invite of a booking `u` may act on. */
async function requireBookingPage(
  db: Queryable,
  booking: { page_id: string | null; invite_id: string | null },
  u: UserRow,
) {
  const page = await pageFor(db, booking);
  if (!page || !(await canHost(db, page, u))) fail(404, "Booking not found");
  return page;
}

/** Only an owner or admin of a team can make or take a page into it. */
async function requireTeamManager(db: Queryable, teamId: string, u: UserRow) {
  if (!(await managesTeam(db, teamId, u.id)))
    fail(
      403,
      "Only the team's owners and admins can manage its booking pages.",
    );
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

type PageFields = Omit<
  BookingPage,
  | "id"
  | "owner_id"
  | "hosts"
  | "counts"
  | "created_at"
  | "updated_at"
  | "team_name"
  | "can_edit"
>;

/** Every stored page column, in the order the queries below use. */
const pageValues = (p: PageFields) => [
  p.slug,
  p.title,
  p.description,
  [...new Set(p.durations)].sort((a, b) => a - b),
  p.window_days,
  p.min_notice_minutes,
  p.buffer_before_minutes,
  p.buffer_after_minutes,
  p.slot_interval_minutes,
  p.max_per_day,
  p.max_per_week,
  p.location,
  p.meeting_url,
  p.active,
  p.color,
  JSON.stringify(p.availability),
  JSON.stringify(
    [...p.date_overrides].sort((a, b) => a.date.localeCompare(b.date)),
  ),
  JSON.stringify(p.questions),
  p.requires_approval,
  p.allow_reschedule,
  p.event_title,
  p.confirmation_message,
  p.team_id ?? null,
  p.remind_before_minutes ?? DEFAULT_BOOKER_REMINDERS,
  p.assignment,
  JSON.stringify(p.routing ?? []),
];

/** Lock a booking that `u` can act on, with its page. */
async function bookingFor(db: Db, id: string, u: UserRow) {
  const booking = (
    await db.query<BookingRow>(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!booking) fail(404, "Booking not found");
  const page = await requireBookingPage(db, booking, u);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [page.id]);
  return { booking, page };
}

async function detail(db: Queryable, id: string): Promise<BookingDetail> {
  const row = (
    await db.query<
      Booking & { page_id: string | null; invite_id: string | null }
    >(`${BOOKING_SELECT} WHERE b.id = $1`, [id])
  ).rows[0];
  const page = (await pageFor(db, row))!;
  const events = (
    await db.query<BookingDetail["events"][number]>(
      `SELECT e.id, e.kind, e.actor, u.name AS actor_name, e.detail, e.created_at
       FROM booking_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.booking_id = $1 ORDER BY e.created_at, e.id`,
      [id],
    )
  ).rows;
  return {
    ...row,
    questions: page.questions,
    hosts: page.hosts,
    location: page.location,
    meeting_url: page.meeting_url,
    events,
  };
}

/** Check and tidy the booker's answers against the page's questions. */
function cleanAnswers(page: PageRow, raw: Record<string, string>) {
  const answers: Record<string, string> = {};
  for (const q of page.questions) {
    const value = (raw[q.id] ?? "").trim();
    if (!value) {
      if (q.required) fail(422, `Please answer “${q.label}”.`);
      continue;
    }
    if (q.type === "choice" && !q.options.includes(value))
      fail(422, `Pick one of the options for “${q.label}”.`);
    if (q.type === "phone" && !/^\+?[\d\s().-]{6,30}$/.test(value))
      fail(422, `Check the phone number for “${q.label}”.`);
    if (q.type !== "long_text" && value.length > 300)
      fail(422, `Keep “${q.label}” under 300 characters.`);
    answers[q.id] = value;
  }
  return answers;
}

const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The public view of a page (never host calendars). */
const publicPage = (page: PageRow) => ({
  slug: page.slug,
  title: page.title,
  description: page.description,
  durations: page.durations,
  location: page.location,
  has_meeting_link: !!page.meeting_url,
  hosts: page.hosts.map((h) => h.name),
  color: page.color,
  questions: page.questions,
  requires_approval: page.requires_approval,
  allow_reschedule: page.allow_reschedule,
});

const receipt = (
  booking: BookingRow,
  page: PageRow,
  needsEmail: boolean,
): BookingReceipt => ({
  id: booking.id,
  status: booking.status,
  start_at: booking.start_at.toISOString(),
  end_at: booking.end_at.toISOString(),
  needs_confirmation: needsEmail,
  needs_approval:
    booking.status === "awaiting_approval" ||
    (needsEmail && page.requires_approval),
  confirmation_message: page.confirmation_message,
});

/** A booking by its manage link, with its page, locked for changes. */
async function managed(db: Db, token: string) {
  const booking = (
    await db.query<BookingRow>(
      "SELECT * FROM bookings WHERE manage_token_hash = $1 FOR UPDATE",
      [digest(token)],
    )
  ).rows[0];
  if (!booking)
    fail(
      404,
      "This link isn't valid. Check the latest email about your booking.",
    );
  const page = (await pageFor(db, booking))!;
  return { booking, page };
}

function managedView(booking: BookingRow, page: PageRow): ManagedBooking {
  const now = new Date();
  const held =
    (booking.status === "pending" || booking.status === "awaiting_approval") &&
    booking.hold_until > now;
  const status =
    (booking.status === "pending" || booking.status === "awaiting_approval") &&
    !held
      ? "expired"
      : booking.status;
  const open = status === "confirmed" ? booking.end_at > now : held;
  return {
    booking: {
      id: booking.id,
      status,
      start_at: booking.start_at.toISOString(),
      end_at: booking.end_at.toISOString(),
      name: booking.name,
      duration: Math.round(
        (booking.end_at.getTime() - booking.start_at.getTime()) / 60_000,
      ),
      timezone: booking.timezone,
    },
    page: {
      slug: page.slug,
      title: page.title,
      color: page.color,
      location: page.location,
      has_meeting_link: !!page.meeting_url,
      hosts: page.hosts.map((h) => h.name),
      invite: !!page.invite,
    },
    can_reschedule: open && page.allow_reschedule && booking.start_at > now,
    can_cancel: open,
  };
}

const tokenParam = (params: unknown) =>
  z.object({ token: z.string().min(20).max(64) }).parse(params).token;

export async function bookingRoutes(app: FastifyInstance) {
  // ---- managing pages (signed in) ----------------------------------------------

  // Your pages, pages you host, and your teams' pages.
  app.get("/booking-pages", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<BookingPage>(
        `SELECT ${PAGE_COLUMNS},
           (p.owner_id = $1 OR p.team_id IN (SELECT team_id FROM team_members
              WHERE user_id = $1 AND role IN ('owner', 'admin'))) AS can_edit
         FROM booking_pages p
         WHERE p.owner_id = $1 OR p.id IN (SELECT page_id FROM booking_hosts WHERE user_id = $1)
           OR ${inMyTeams("p")}
         ORDER BY p.created_at DESC`,
        [u.id],
      )
    ).rows;
  });

  app.post("/booking-pages", async (r, reply) => {
    const u = await authenticate(r);
    const d = bookingPageInput.parse(r.body);
    const page = await transaction(async (db) => {
      if (d.team_id) await requireTeamManager(db, d.team_id, u);
      await checkCoHosts(
        db,
        u.id,
        d.co_hosts.map((h) => h.user_id),
        d.team_id,
      );
      const fields: PageFields = {
        ...d,
        buffer_before_minutes: d.buffer_before_minutes ?? d.buffer_minutes ?? 0,
        buffer_after_minutes: d.buffer_after_minutes ?? d.buffer_minutes ?? 0,
      };
      const { id } = (
        await db
          .query<{ id: string }>(
            `INSERT INTO booking_pages (owner_id, slug, title, description, durations,
               window_days, min_notice_minutes, buffer_before_minutes, buffer_after_minutes,
               slot_interval_minutes, max_per_day, max_per_week, location, meeting_url, active,
               color, availability, date_overrides, questions, requires_approval,
               allow_reschedule, event_title, confirmation_message, team_id,
               remind_before_minutes, assignment, routing)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
               $24,$25::smallint[],$26,$27)
             RETURNING id`,
            [u.id, ...pageValues(fields)],
          )
          .catch(taken)
      ).rows[0];
      await setHosts(db, id, u.id, d.co_hosts);
      return { ...(await pageById(db, id)), can_edit: true };
    });
    reply.code(201);
    return page;
  });

  app.put("/booking-pages/:id", async (r) => {
    const u = await authenticate(r);
    const d = bookingPageUpdate.parse(r.body);
    return transaction(async (db) => {
      const current = await requirePage(db, idParam(r), u, true);
      const { buffer_minutes, co_hosts, ...changes } = d;
      const next: PageFields = { ...current, ...changes };
      const team = next.team_id ?? null;
      // Taking a page into a team needs its owner or admin role there; making
      // a team's page personal again is for its owner.
      if (team !== (current.team_id ?? null)) {
        if (team) await requireTeamManager(db, team, u);
        else if (current.owner_id !== u.id)
          fail(403, "Only the page's owner can take it out of the team.");
      }
      if (co_hosts || team !== (current.team_id ?? null))
        await checkCoHosts(
          db,
          current.owner_id,
          (co_hosts ?? current.hosts).map((h) => h.user_id),
          team,
        );
      if (buffer_minutes !== undefined) {
        next.buffer_before_minutes = d.buffer_before_minutes ?? buffer_minutes;
        next.buffer_after_minutes = d.buffer_after_minutes ?? buffer_minutes;
      }
      await db
        .query(
          `UPDATE booking_pages SET slug=$2, title=$3, description=$4, durations=$5,
             window_days=$6, min_notice_minutes=$7, buffer_before_minutes=$8,
             buffer_after_minutes=$9, slot_interval_minutes=$10, max_per_day=$11,
             max_per_week=$12, location=$13, meeting_url=$14, active=$15, color=$16,
             availability=$17, date_overrides=$18, questions=$19, requires_approval=$20,
             allow_reschedule=$21, event_title=$22, confirmation_message=$23,
             team_id=$24, remind_before_minutes=$25::smallint[], assignment=$26,
             routing=$27, updated_at=now()
           WHERE id=$1`,
          [current.id, ...pageValues(next)],
        )
        .catch(taken);
      if (co_hosts) await setHosts(db, current.id, current.owner_id, co_hosts);
      return { ...(await pageById(db, current.id)), can_edit: true };
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

  // Older apps: one page's upcoming and recent bookings, and cancelling one.
  app.get("/booking-pages/:id/bookings", async (r) => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const page = await requirePage(db, idParam(r), u, false);
    return (
      await db.query<Booking>(
        `${BOOKING_SELECT} WHERE b.page_id = $1
           AND (b.status = 'confirmed' OR (b.status IN ('pending', 'awaiting_approval') AND b.hold_until > now()))
           AND b.end_at > now() - interval '30 days'
         ORDER BY b.start_at LIMIT 200`,
        [page.id],
      )
    ).rows;
  });

  app.post("/booking-pages/:id/bookings/:bookingId/cancel", async (r) => {
    const u = await authenticate(r);
    return transaction(async (db) => {
      const { booking, page } = await bookingFor(
        db,
        idParam(r, "bookingId"),
        u,
      );
      if (page.id !== idParam(r)) fail(404, "Booking not found");
      await cancel(db, booking, page, { actor: "host", userId: u.id }, "");
      return { cancelled: true };
    });
  });

  /** Search text as ILIKE patterns: every word must be in the name or email. */
  const searchWords = (text?: string) =>
    (text ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  // ---- tracking bookings (signed in) ----------------------------------------------

  app.get("/bookings", async (r) => {
    const u = await authenticate(r);
    const q = bookingsQuery.parse(r.query);
    const view = VIEWS[q.view];
    const words = searchWords(q.q);
    const rows = (
      await reader(r.headers).query<Booking & { total: number }>(
        `${BOOKING_SELECT.replace("SELECT b.id", "SELECT count(*) OVER()::int AS total, b.id")}
         WHERE ${MINE} AND ${view.where}
           AND ($2::uuid IS NULL OR b.page_id = $2)
           AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) w
                           WHERE (b.name || ' ' || b.email) NOT ILIKE w)
         ORDER BY ${view.order}, b.id LIMIT $4 OFFSET $5`,
        [u.id, q.page_id ?? null, words, q.limit, q.offset],
      )
    ).rows;
    return {
      rows: rows.map(({ total: _total, ...b }) => b),
      total: rows[0]?.total ?? 0,
    };
  });

  app.get("/bookings/stats", async (r): Promise<BookingStats> => {
    const u = await authenticate(r);
    const q = bookingStatsQuery.parse(r.query);
    const db = reader(r.headers);
    const counts = (
      await db.query<
        Omit<BookingStats, "next" | "pages" | "cancellation_rate">
      >(
        `SELECT
           count(*) FILTER (WHERE status = 'confirmed' AND end_at >= now())::int AS upcoming,
           count(*) FILTER (WHERE status = 'awaiting_approval' AND hold_until > now())::int AS needs_approval,
           count(*) FILTER (WHERE status = 'pending' AND hold_until > now())::int AS awaiting_email,
           count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
           count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
           count(*) FILTER (WHERE status = 'declined')::int AS declined,
           count(*) FILTER (WHERE no_show)::int AS no_show,
           count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last_30_days
         FROM bookings b WHERE ${MINE} AND ($2::uuid IS NULL OR b.page_id = $2)`,
        [u.id, q.page_id ?? null],
      )
    ).rows[0];
    const next =
      (
        await db.query<Booking>(
          `${BOOKING_SELECT} WHERE ${MINE} AND ($2::uuid IS NULL OR b.page_id = $2)
             AND b.status = 'confirmed' AND b.start_at >= now()
           ORDER BY b.start_at LIMIT 1`,
          [u.id, q.page_id ?? null],
        )
      ).rows[0] ?? null;
    const pages = (
      await db.query<BookingStats["pages"][number]>(
        `SELECT p.id AS page_id, p.title, p.slug,
           count(b.id) FILTER (WHERE b.status = 'confirmed' AND b.end_at >= now())::int AS upcoming,
           count(b.id) FILTER (WHERE b.status = 'awaiting_approval' AND b.hold_until > now())::int AS needs_approval,
           count(b.id)::int AS total
         FROM booking_pages p LEFT JOIN bookings b ON b.page_id = p.id
         WHERE p.id IN (${MY_PAGES})
         GROUP BY p.id ORDER BY p.created_at DESC`,
        [u.id],
      )
    ).rows;
    const decided = counts.confirmed + counts.cancelled;
    return {
      ...counts,
      cancellation_rate: decided
        ? Math.round((counts.cancelled / decided) * 100) / 100
        : 0,
      next,
      pages,
    };
  });

  app.get("/bookings/export.csv", async (r, reply) => {
    const u = await authenticate(r);
    const q = bookingsQuery.parse(r.query);
    const view = VIEWS[q.view];
    const rows = (
      await reader(r.headers).query<
        Booking & { questions: PageRow["questions"] }
      >(
        `${BOOKING_SELECT.replace("SELECT b.id", "SELECT coalesce(p.questions, '[]') AS questions, b.id")}
         WHERE ${MINE} AND ${view.where} AND ($2::uuid IS NULL OR b.page_id = $2)
           AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) w
                           WHERE (b.name || ' ' || b.email) NOT ILIKE w)
         ORDER BY ${view.order}, b.id LIMIT 5000`,
        [u.id, q.page_id ?? null, searchWords(q.q)],
      )
    ).rows;
    const header = [
      "Page",
      "Status",
      "Start (UTC)",
      "End (UTC)",
      "Name",
      "Email",
      "Note",
      "Answers",
      "No-show",
      "Host note",
      "Cancel reason",
      "Booked at (UTC)",
    ];
    const lines = [header.join(",")];
    for (const b of rows) {
      const answers = answerLines(
        { questions: b.questions } as PageRow,
        b.answers,
      ).join("; ");
      lines.push(
        [
          b.page_title,
          b.status,
          new Date(b.start_at).toISOString(),
          new Date(b.end_at).toISOString(),
          b.name,
          b.email,
          b.note,
          answers,
          b.no_show ? "yes" : "",
          b.host_note,
          b.cancel_reason,
          new Date(b.created_at).toISOString(),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="bookings.csv"')
      .send(`${lines.join("\r\n")}\r\n`);
  });

  app.get("/bookings/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const row = (
      await db.query<{ page_id: string | null; invite_id: string | null }>(
        "SELECT page_id, invite_id FROM bookings WHERE id = $1",
        [id],
      )
    ).rows[0];
    if (!row) fail(404, "Booking not found");
    await requireBookingPage(db, row, u);
    return detail(db, id);
  });

  // Times a host can move a booking to: its own time and events don't
  // count as busy, the page may be switched off, and notice doesn't apply.
  app.get("/bookings/:id/slots", async (r) => {
    const u = await authenticate(r);
    const q = rescheduleSlotsQuery.parse(r.query);
    const db = reader(r.headers);
    const booking = (
      await db.query<BookingRow>("SELECT * FROM bookings WHERE id = $1", [
        idParam(r),
      ])
    ).rows[0];
    if (!booking) fail(404, "Booking not found");
    const page = await requireBookingPage(db, booking, u);
    const duration = Math.round(
      (booking.end_at.getTime() - booking.start_at.getTime()) / 60_000,
    );
    const firstDay = q.date ?? localDateKey(new Date(), q.timezone);
    const from = dayTime(firstDay, 0, q.timezone);
    const to = dayTime(addDays(firstDay, q.days), 0, q.timezone);
    const now = Date.now();
    const slots = await availableSlots(db, page, duration, from, to, {
      now: new Date(now - page.min_notice_minutes * 60_000),
      ignoreBookingId: booking.id,
      ignoreItemIds: booking.item_ids,
    });
    return {
      timezone: q.timezone,
      duration,
      slots: slots.filter(
        (s) =>
          Date.parse(s.start_at) > now &&
          s.start_at !== booking.start_at.toISOString(),
      ),
    };
  });

  app.post("/bookings/:id/approve", async (r) => {
    const u = await authenticate(r);
    return transaction(async (db) => {
      const { booking, page } = await bookingFor(db, idParam(r), u);
      await approve(db, booking, page, u.id);
      return detail(db, booking.id);
    });
  });

  app.post("/bookings/:id/decline", async (r) => {
    const u = await authenticate(r);
    const d = bookingReason.parse(r.body ?? {});
    return transaction(async (db) => {
      const { booking, page } = await bookingFor(db, idParam(r), u);
      await decline(db, booking, page, u.id, d.reason);
      return detail(db, booking.id);
    });
  });

  app.post("/bookings/:id/cancel", async (r) => {
    const u = await authenticate(r);
    const d = bookingReason.parse(r.body ?? {});
    return transaction(async (db) => {
      const { booking, page } = await bookingFor(db, idParam(r), u);
      await cancel(
        db,
        booking,
        page,
        { actor: "host", userId: u.id },
        d.reason,
      );
      return detail(db, booking.id);
    });
  });

  app.post("/bookings/:id/reschedule", async (r) => {
    const u = await authenticate(r);
    const d = bookingReschedule.parse(r.body);
    return transaction(async (db) => {
      const { booking, page } = await bookingFor(db, idParam(r), u);
      await reschedule(db, booking, page, new Date(d.start_at), {
        actor: "host",
        userId: u.id,
      });
      return detail(db, booking.id);
    });
  });

  app.put("/bookings/:id/no-show", async (r) => {
    const u = await authenticate(r);
    const d = noShowInput.parse(r.body);
    return transaction(async (db) => {
      const { booking } = await bookingFor(db, idParam(r), u);
      if (booking.status !== "confirmed" || booking.start_at > new Date())
        fail(
          409,
          "You can mark a no-show once a confirmed booking has started.",
        );
      if (booking.no_show !== d.no_show) {
        await db.query(
          "UPDATE bookings SET no_show = $2, updated_at = now() WHERE id = $1",
          [booking.id, d.no_show],
        );
        await logEvent(
          db,
          booking.id,
          "no_show",
          { actor: "host", userId: u.id },
          d.no_show ? "Marked as a no-show" : "No-show cleared",
        );
      }
      return detail(db, booking.id);
    });
  });

  app.put("/bookings/:id/note", async (r) => {
    const u = await authenticate(r);
    const d = bookingNoteInput.parse(r.body);
    return transaction(async (db) => {
      const { booking } = await bookingFor(db, idParam(r), u);
      await db.query(
        "UPDATE bookings SET host_note = $2, updated_at = now() WHERE id = $1",
        [booking.id, d.host_note],
      );
      return detail(db, booking.id);
    });
  });

  // ---- the public page (no sign-in) ----------------------------------------------

  app.get("/book/:slug", async (r): Promise<PublicBookingPage> => {
    const { slug } = z.object({ slug: z.string().max(60) }).parse(r.params);
    const q = publicSlotsQuery.parse(r.query);
    const db = reader(r.headers);
    const page = await pageBySlug(db, slug);
    if (!page) fail(404, "This booking page doesn't exist or is switched off.");
    const duration = q.duration ?? page.durations[0];
    if (!page.durations.includes(duration))
      fail(422, "Pick one of the offered lengths.");
    const firstDay = q.date ?? localDateKey(new Date(), q.timezone);
    const from = dayTime(firstDay, 0, q.timezone);
    const to = dayTime(addDays(firstDay, q.days), 0, q.timezone);
    return {
      ...publicPage(page),
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
      const result = await transaction(async (db) => {
        const page = await pageBySlug(db, slug);
        if (!page)
          fail(404, "This booking page doesn't exist or is switched off.");
        if (!page.durations.includes(d.duration))
          fail(422, "Pick one of the offered lengths.");
        const answers = cleanAnswers(page, d.answers);
        // One booking at a time per page, so two people can't take the same slot.
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [page.id]);
        const start = new Date(d.start_at);
        const end = new Date(start.getTime() + d.duration * 60_000);
        const free = await availableSlots(db, page, d.duration, start, end);
        if (!free.some((s) => s.start_at === start.toISOString()))
          fail(409, "That time was just taken. Pick another time.");
        // Round-robin: give this booking to the fairest host free at the slot,
        // preferring a host a routing rule points to for these answers.
        const routed = page.routing.find(
          (rule) =>
            (answers[rule.question_id] ?? "").trim().toLowerCase() ===
            rule.equals.trim().toLowerCase(),
        )?.host_user_id;
        const assigned =
          page.assignment === "round_robin"
            ? await chooseHost(
                db,
                page,
                d.duration,
                start,
                end,
                undefined,
                routed,
              )
            : null;
        if (page.assignment === "round_robin" && !assigned)
          fail(409, "That time was just taken. Pick another time.");
        const confirmToken = randomBytes(24).toString("base64url");
        const manageToken = randomBytes(24).toString("base64url");
        const needsEmail = await emailEnabled();
        const booking = (
          await db.query<BookingRow>(
            `INSERT INTO bookings (page_id, start_at, end_at, name, email, note, timezone, answers,
             confirm_token_hash, manage_token_hash, manage_token_encrypted, assigned_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [
              page.id,
              start,
              end,
              d.name,
              d.email,
              d.note,
              d.timezone,
              JSON.stringify(answers),
              needsEmail ? digest(confirmToken) : null,
              digest(manageToken),
              await encryptSecret(manageToken),
              assigned,
            ],
          )
        ).rows[0];
        await logEvent(db, booking.id, "requested", { actor: "booker" });
        if (needsEmail) {
          await sendEmail({
            id: booking.id,
            destination: d.email,
            title: `Confirm your booking: ${page.title}`,
            body: [
              `Hi ${d.name},`,
              `Please confirm ${page.title} with ${page.hosts.map((h) => h.name).join(", ")} on ${whenLabel(start, end, d.timezone)}:`,
              appLink(`/book/confirm/${confirmToken}`),
              "The time is held for 30 minutes.",
              `To change or cancel it: ${appLink(`/book/manage/${manageToken}`)}`,
            ].join("\n\n"),
          }).catch(() =>
            fail(502, "Couldn't send the confirmation email. Try again."),
          );
        } else if (page.requires_approval)
          await awaitApproval(db, booking, page);
        // Without email there's no address to check, so it's confirmed now.
        else await confirm(db, booking, page, { actor: "system" });
        return receipt(booking, page, needsEmail);
      });
      reply.code(201);
      return result;
    },
  );

  app.post(
    "/book/confirm/:token",
    strictRateLimit,
    async (r): Promise<BookingReceipt> => {
      const token = tokenParam(r.params);
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
        const page = await pageFor(db, booking);
        if (!page?.active) fail(404, "This booking page is switched off.");
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [page.id]);
        await logEvent(db, booking.id, "email_confirmed", { actor: "booker" });
        if (page.requires_approval) await awaitApproval(db, booking, page);
        else await confirm(db, booking, page, { actor: "booker" });
        return receipt(booking, page, false);
      });
    },
  );

  // ---- the booker's manage link (no sign-in) ------------------------------------------

  app.get("/book/manage/:token", async (r): Promise<ManagedBooking> => {
    const token = tokenParam(r.params);
    return transaction(async (db) => {
      const { booking, page } = await managed(db, token);
      return managedView(booking, page);
    });
  });

  app.get("/book/manage/:token/slots", async (r) => {
    const token = tokenParam(r.params);
    const q = rescheduleSlotsQuery.parse(r.query);
    return transaction(async (db) => {
      const { booking, page } = await managed(db, token);
      const view = managedView(booking, page);
      if (!view.can_reschedule) fail(409, "This booking can't be moved.");
      const firstDay = q.date ?? localDateKey(new Date(), q.timezone);
      const from = dayTime(firstDay, 0, q.timezone);
      const to = dayTime(addDays(firstDay, q.days), 0, q.timezone);
      return {
        timezone: q.timezone,
        duration: view.booking.duration,
        slots: await availableSlots(db, page, view.booking.duration, from, to, {
          ignoreBookingId: booking.id,
          ignoreItemIds: booking.item_ids,
        }),
      };
    });
  });

  app.post("/book/manage/:token/reschedule", strictRateLimit, async (r) => {
    const token = tokenParam(r.params);
    const d = bookingReschedule.parse(r.body);
    return transaction(async (db) => {
      const { booking, page } = await managed(db, token);
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [page.id]);
      await reschedule(db, booking, page, new Date(d.start_at), {
        actor: "booker",
      });
      return managedView(booking, page);
    });
  });

  app.post("/book/manage/:token/cancel", strictRateLimit, async (r) => {
    const token = tokenParam(r.params);
    const d = bookingReason.parse(r.body ?? {});
    return transaction(async (db) => {
      const { booking, page } = await managed(db, token);
      await cancel(db, booking, page, { actor: "booker" }, d.reason);
      const fresh = (
        await db.query<BookingRow>("SELECT * FROM bookings WHERE id = $1", [
          booking.id,
        ])
      ).rows[0];
      return managedView(fresh, page);
    });
  });

  // Older emails: the separate cancel link.
  app.post("/book/cancel/:token", strictRateLimit, async (r) => {
    const token = tokenParam(r.params);
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
      const page = (await pageFor(db, booking))!;
      await cancel(db, booking, page, { actor: "booker" }, "");
      return { cancelled: true };
    });
  });
}

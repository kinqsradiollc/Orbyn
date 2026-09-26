import type { z } from "zod";
import {
  addDays,
  bookingPageInput,
  bookingPageUpdate,
  dayTime,
  DEFAULT_BOOKER_REMINDERS,
  fail,
  localDateKey,
  type BookingPage,
  type Booking,
  type BookingDetail,
  type BookingStats,
  type BookingView,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { inMyTeams } from "../../lib/visibility.js";
import { availableSlots, type PageRow } from "./availability.js";
import {
  checkCoHosts,
  managesTeam,
  PAGE_COLUMNS,
  pageById,
  pageFor,
} from "./pages.js";
import {
  approve,
  cancel,
  decline,
  logEvent,
  reschedule,
  type BookingRow,
} from "./service.js";

/**
 * Hosts' side of bookings: who may see and act on a page's bookings, the
 * inbox, stats, the times a booking can move to, and approving, declining,
 * cancelling, rescheduling, no-shows and private notes. The routes and the
 * agents' booking tools share these (agents' approve, decline, cancel and
 * reschedule always go through the person's Review inbox first).
 */

export /** Pages `$1` owns, hosts, or manages as an owner or admin of the page's team. */
const MY_PAGES = `SELECT id FROM booking_pages WHERE owner_id = $1
  UNION SELECT page_id FROM booking_hosts WHERE user_id = $1
  UNION SELECT bp.id FROM booking_pages bp JOIN team_members tm
    ON tm.team_id = bp.team_id AND tm.user_id = $1 AND tm.role IN ('owner', 'admin')`;

/** Bookings on pages `$1` owns, hosts or manages, and from open invites they host. */
export const MINE = `(b.page_id IN (${MY_PAGES})
  OR b.invite_id IN (SELECT id FROM open_invites WHERE owner_id = $1 OR $1 = ANY (co_host_ids)))`;

export const BOOKING_SELECT = `SELECT b.id, b.page_id, b.invite_id,
  coalesce(p.title, oi.title) AS page_title, coalesce(p.slug, '') AS page_slug,
  b.start_at, b.end_at, b.name, b.email, b.note, b.answers,
  CASE WHEN b.status IN ('pending', 'awaiting_approval') AND b.hold_until <= now()
       THEN 'expired' ELSE b.status END AS status,
  b.no_show, b.host_note, b.cancel_reason, b.cancelled_by, b.reschedule_count, b.timezone,
  b.created_at, b.updated_at
  FROM bookings b LEFT JOIN booking_pages p ON p.id = b.page_id
  LEFT JOIN open_invites oi ON oi.id = b.invite_id`;

export const VIEWS: Record<BookingView, { where: string; order: string }> = {
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

/**
 * Who may edit a page: its owner, or an owner or admin of the page's team.
 * Who may see and act on its bookings: those, and its hosts. An open
 * invite's owner and co-hosts are its hosts.
 */
export async function canEdit(db: Queryable, page: PageRow, u: UserRow) {
  if (page.owner_id === u.id) return true;
  return !!page.team_id && (await managesTeam(db, page.team_id, u.id));
}
export const canHost = async (db: Queryable, page: PageRow, u: UserRow) =>
  page.hosts.some((h) => h.user_id === u.id) || (await canEdit(db, page, u));

/** A page `u` may edit (`owner`), or whose bookings they may act on. */
export async function requirePage(
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
export async function requireBookingPage(
  db: Queryable,
  booking: { page_id: string | null; invite_id: string | null },
  u: UserRow,
) {
  const page = await pageFor(db, booking);
  if (!page || !(await canHost(db, page, u))) fail(404, "Booking not found");
  return page;
}

/** Lock a booking that `u` can act on, with its page. */
export async function bookingFor(db: Db, id: string, u: UserRow) {
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

export async function detail(
  db: Queryable,
  id: string,
): Promise<BookingDetail> {
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

/** Search text as ILIKE patterns: every word must be in the name or email. */
export const searchWords = (text?: string) =>
  (text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

/** Booking pages `userId` owns, hosts or can see in their teams. */
export async function listBookingPages(db: Queryable, userId: string) {
  return (
    await db.query<PageRow & { can_edit: boolean }>(
      `SELECT ${PAGE_COLUMNS},
         (p.owner_id = $1 OR p.team_id IN (SELECT team_id FROM team_members
            WHERE user_id = $1 AND role IN ('owner', 'admin'))) AS can_edit
       FROM booking_pages p
       WHERE p.owner_id = $1 OR p.id IN (SELECT page_id FROM booking_hosts WHERE user_id = $1)
         OR ${inMyTeams("p")}
       ORDER BY p.created_at DESC`,
      [userId],
    )
  ).rows;
}

/** One view of the bookings inbox, paged. */
export async function listBookings(
  db: Queryable,
  userId: string,
  q: {
    view: BookingView;
    q?: string;
    page_id?: string;
    limit: number;
    offset: number;
  },
): Promise<{ rows: Booking[]; total: number }> {
  const view = VIEWS[q.view];
  const words = searchWords(q.q);
  const rows = (
    await db.query<Booking & { total: number }>(
      `${BOOKING_SELECT.replace("SELECT b.id", "SELECT count(*) OVER()::int AS total, b.id")}
     WHERE ${MINE} AND ${view.where}
       AND ($2::uuid IS NULL OR b.page_id = $2)
       AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) w
                       WHERE (b.name || ' ' || b.email) NOT ILIKE w)
     ORDER BY ${view.order}, b.id LIMIT $4 OFFSET $5`,
      [userId, q.page_id ?? null, words, q.limit, q.offset],
    )
  ).rows;
  return {
    rows: rows.map(({ total: _total, ...b }) => b),
    total: rows[0]?.total ?? 0,
  };
}

/** Counts, the next booking and per-page totals. */
export async function bookingStats(
  db: Queryable,
  userId: string,
  pageId: string | null,
): Promise<BookingStats> {
  const counts = (
    await db.query<Omit<BookingStats, "next" | "pages" | "cancellation_rate">>(
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
      [userId, pageId],
    )
  ).rows[0];
  const next =
    (
      await db.query<Booking>(
        `${BOOKING_SELECT} WHERE ${MINE} AND ($2::uuid IS NULL OR b.page_id = $2)
         AND b.status = 'confirmed' AND b.start_at >= now()
       ORDER BY b.start_at LIMIT 1`,
        [userId, pageId],
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
      [userId],
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
}

/** One booking `u` may act on, with its answers, hosts and history. */
export async function bookingDetail(
  db: Queryable,
  u: UserRow,
  id: string,
): Promise<BookingDetail> {
  const row = (
    await db.query<{ page_id: string | null; invite_id: string | null }>(
      "SELECT page_id, invite_id FROM bookings WHERE id = $1",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Booking not found");
  await requireBookingPage(db, row, u);
  return detail(db, id);
}

/**
 * Times a host can move a booking to: its own time and events don't count
 * as busy, the page may be switched off, and notice doesn't apply.
 */
export async function bookingSlots(
  db: Queryable,
  u: UserRow,
  id: string,
  q: { timezone: string; date?: string; days: number },
) {
  const booking = (
    await db.query<BookingRow>("SELECT * FROM bookings WHERE id = $1", [id])
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
}

export type BookingActionInput =
  | { action: "approve" }
  | { action: "decline"; reason: string }
  | { action: "cancel"; reason: string }
  | { action: "reschedule"; start_at: string };

/**
 * Approve, decline, cancel or move a booking as its host. Each emails the
 * guest and fires the page's webhooks.
 */
export async function bookingAction(
  db: Db,
  u: UserRow,
  id: string,
  d: BookingActionInput,
): Promise<BookingDetail> {
  const { booking, page } = await bookingFor(db, id, u);
  if (d.action === "approve") await approve(db, booking, page, u.id);
  else if (d.action === "decline")
    await decline(db, booking, page, u.id, d.reason);
  else if (d.action === "cancel")
    await cancel(db, booking, page, { actor: "host", userId: u.id }, d.reason);
  else
    await reschedule(db, booking, page, new Date(d.start_at), {
      actor: "host",
      userId: u.id,
    });
  return detail(db, booking.id);
}

/** Mark a guest who didn't come (once a confirmed booking has started). */
export async function setNoShow(
  db: Db,
  u: UserRow,
  id: string,
  noShow: boolean,
): Promise<BookingDetail> {
  const { booking } = await bookingFor(db, id, u);
  if (booking.status !== "confirmed" || booking.start_at > new Date())
    fail(409, "You can mark a no-show once a confirmed booking has started.");
  if (booking.no_show !== noShow) {
    await db.query(
      "UPDATE bookings SET no_show = $2, updated_at = now() WHERE id = $1",
      [booking.id, noShow],
    );
    await logEvent(
      db,
      booking.id,
      "no_show",
      { actor: "host", userId: u.id },
      noShow ? "Marked as a no-show" : "No-show cleared",
    );
  }
  return detail(db, booking.id);
}

/** The host's private note on a booking (never shown to the guest). */
export async function setHostNote(
  db: Db,
  u: UserRow,
  id: string,
  note: string,
): Promise<BookingDetail> {
  const { booking } = await bookingFor(db, id, u);
  await db.query(
    "UPDATE bookings SET host_note = $2, updated_at = now() WHERE id = $1",
    [booking.id, note],
  );
  return detail(db, booking.id);
}

const SLUG_TAKEN = "That link is taken. Try another.";
const taken = (error: unknown) =>
  (error as { code?: string }).code === "23505"
    ? fail(409, SLUG_TAKEN)
    : Promise.reject(error);

/** Only an owner or admin of a team can make or take a page into it. */
export async function requireTeamManager(
  db: Queryable,
  teamId: string,
  u: UserRow,
) {
  if (!(await managesTeam(db, teamId, u.id)))
    fail(
      403,
      "Only the team's owners and admins can manage its booking pages.",
    );
}

export async function setHosts(
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

/** Make a booking page (a team's needs its owner or admin). */
export async function createBookingPage(
  db: Db,
  u: UserRow,
  input: z.input<typeof bookingPageInput>,
) {
  const d = bookingPageInput.parse(input);
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
}

/** Change a booking page (its owner, or the team's owners and admins). */
export async function updateBookingPage(
  db: Db,
  u: UserRow,
  id: string,
  input: z.input<typeof bookingPageUpdate>,
) {
  const d = bookingPageUpdate.parse(input);
  const current = await requirePage(db, id, u, true);
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
}

/** Remove a booking page (its owner, or the team's owners and admins). */
export async function deleteBookingPage(db: Db, u: UserRow, id: string) {
  const page = await requirePage(db, id, u, true);
  await db.query("DELETE FROM booking_pages WHERE id = $1", [page.id]);
}

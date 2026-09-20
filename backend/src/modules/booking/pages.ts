import { fail } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import type { InviteRow, PageRow } from "./availability.js";

/**
 * Looking up what a booking was made on: a booking page, or an open invite
 * (which stands in for a page whose hours are its windows). Shared by the
 * routes, the booking steps and the notifier.
 */
export const PAGE_COLUMNS = `p.id, p.owner_id, p.slug, p.title, p.description, p.durations, p.window_days,
  p.min_notice_minutes, p.buffer_before_minutes, p.buffer_after_minutes, p.slot_interval_minutes,
  p.max_per_day, p.max_per_week, p.location, p.meeting_url, p.active, p.color, p.availability,
  p.date_overrides, p.questions, p.assignment, p.requires_approval, p.allow_reschedule, p.event_title,
  p.confirmation_message, p.created_at, p.updated_at, p.team_id, p.remind_before_minutes,
  (SELECT name FROM teams WHERE id = p.team_id) AS team_name,
  coalesce((SELECT json_agg(json_build_object('user_id', h.user_id, 'name', u.name, 'required', h.required)
                            ORDER BY h.required DESC, u.name)
            FROM booking_hosts h JOIN users u ON u.id = h.user_id WHERE h.page_id = p.id), '[]') AS hosts,
  json_build_object(
    'upcoming', (SELECT count(*)::int FROM bookings b
                 WHERE b.page_id = p.id AND b.status = 'confirmed' AND b.end_at >= now()),
    'needs_approval', (SELECT count(*)::int FROM bookings b
                       WHERE b.page_id = p.id AND b.status = 'awaiting_approval' AND b.hold_until > now())
  ) AS counts`;

export async function pageById(db: Queryable, id: string) {
  return (
    await db.query<PageRow>(
      `SELECT ${PAGE_COLUMNS} FROM booking_pages p WHERE p.id = $1`,
      [id],
    )
  ).rows[0];
}

export const INVITE_COLUMNS = `oi.id, oi.owner_id, oi.title, oi.duration, oi.windows, oi.location,
  oi.meeting_url, oi.co_host_ids, oi.remind_before_minutes, oi.expires_at, oi.booking_id,
  oi.token_encrypted, oi.created_at,
  CASE WHEN oi.status = 'open' AND oi.expires_at <= now() THEN 'expired' ELSE oi.status END AS status`;

export async function inviteById(db: Queryable, id: string, lock = false) {
  return (
    await db.query<InviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM open_invites oi WHERE oi.id = $1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
}

/**
 * An open invite as a booking page: its owner and co-hosts are required
 * hosts, it has one length, no notice, buffers, questions or approval, and
 * its windows are its hours (see `availableSlots`).
 */
export async function inviteAsPage(
  db: Queryable,
  invite: InviteRow,
): Promise<PageRow> {
  const people = (
    await db.query<{ user_id: string; name: string }>(
      "SELECT id AS user_id, name FROM users WHERE id = ANY ($1::uuid[])",
      [[invite.owner_id, ...invite.co_host_ids]],
    )
  ).rows;
  const hosts = [
    ...people.filter((p) => p.user_id === invite.owner_id),
    ...people
      .filter((p) => p.user_id !== invite.owner_id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  ].map((p) => ({ ...p, required: true }));
  const at = invite.created_at.toISOString();
  return {
    id: invite.id,
    owner_id: invite.owner_id,
    slug: "",
    title: invite.title,
    description: "",
    durations: [invite.duration],
    window_days: 90,
    min_notice_minutes: 0,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    slot_interval_minutes: 15,
    max_per_day: null,
    max_per_week: null,
    location: invite.location,
    meeting_url: invite.meeting_url,
    active: invite.status !== "cancelled",
    color: "",
    availability: { mode: "working_hours" },
    date_overrides: [],
    questions: [],
    assignment: "collective",
    requires_approval: false,
    allow_reschedule: true,
    event_title: "{page} with {name}",
    confirmation_message: "",
    hosts,
    created_at: at,
    updated_at: at,
    team_id: null,
    remind_before_minutes: invite.remind_before_minutes.map(Number),
    invite,
  };
}

/** The page (or open invite) a booking was made on. */
export async function pageFor(
  db: Queryable,
  booking: { page_id: string | null; invite_id: string | null },
): Promise<PageRow | undefined> {
  if (booking.page_id) return pageById(db, booking.page_id);
  const invite = booking.invite_id
    ? await inviteById(db, booking.invite_id)
    : undefined;
  return invite ? inviteAsPage(db, invite) : undefined;
}

/** Whether someone is an owner or admin of a team. */
export async function managesTeam(
  db: Queryable,
  teamId: string,
  userId: string,
) {
  return !!(
    await db.query(
      `SELECT 1 FROM team_members
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, userId],
    )
  ).rowCount;
}

/**
 * Co-hosts of a personal page or invite must share a team with its owner;
 * those of a team's page must be in that team.
 */
export async function checkCoHosts(
  db: Queryable,
  ownerId: string,
  ids: string[],
  teamId: string | null = null,
) {
  const others = [...new Set(ids.filter((id) => id !== ownerId))];
  if (!others.length) return;
  const ok = (
    await db.query<{ n: number }>(
      `SELECT count(DISTINCT m.user_id)::int AS n FROM team_members m
       WHERE m.user_id = ANY ($2::uuid[])
         AND CASE WHEN $3::uuid IS NULL
           THEN m.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
           ELSE m.team_id = $3 END`,
      [ownerId, others, teamId],
    )
  ).rows[0].n;
  if (ok !== others.length)
    fail(
      422,
      teamId
        ? "Hosts of a team's page must be in the team."
        : "Co-hosts must be in one of your teams.",
    );
}

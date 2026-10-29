import { randomBytes, randomUUID } from "node:crypto";
import { fail, type WebhookEvent } from "@orbyn/core";
import { env } from "../../config/env.js";
import type { Db, Queryable } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { queueBookingEmail } from "../../worker/booking-email.js";
import { mutate, recordDeletions } from "../items/service.js";
import {
  availableSlots,
  chooseHost,
  pageTimeZone,
  type PageRow,
  type SlotOptions,
} from "./availability.js";
import { pageFor } from "./pages.js";

/**
 * What can happen to a booking: confirmed, held for a host's approval,
 * approved or declined, cancelled by either side, or moved. Every step lands
 * on the booking's timeline, tells the other side, and fires a webhook.
 */
export type BookingRow = {
  id: string;
  /** The page it was booked on, or null for a booking from an open invite. */
  page_id: string | null;
  invite_id: string | null;
  start_at: Date;
  end_at: Date;
  name: string;
  email: string;
  note: string;
  answers: Record<string, string>;
  status:
    "pending" | "awaiting_approval" | "confirmed" | "declined" | "cancelled";
  timezone: string;
  item_ids: string[];
  hold_until: Date;
  manage_token_hash: string | null;
  manage_token_encrypted: string | null;
  reschedule_count: number;
  no_show: boolean;
  assigned_user_id: string | null;
};

export type Actor = {
  actor: "host" | "booker" | "system";
  userId?: string | null;
};

export const appLink = (path: string) =>
  `${env.APP_URL.replace(/\/$/, "")}${path}`;

/** "Friday 18 September, 10:00 am to 10:30 am (Australia/Melbourne)". */
export function whenLabel(start: Date, end: Date, timeZone: string) {
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
}

export async function logEvent(
  db: Db,
  bookingId: string,
  kind: string,
  by: Actor,
  detail = "",
) {
  await db.query(
    // clock_timestamp, not now(): steps in one transaction keep their order.
    `INSERT INTO booking_events (booking_id, kind, actor, actor_id, detail, created_at)
     VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
    [bookingId, kind, by.actor, by.userId ?? null, detail.slice(0, 1000)],
  );
}

/** The hosts a booking actually involves: its assigned one for round-robin,
 * or all the page's hosts for a collective booking. */
export function effectiveHosts(page: PageRow, booking: BookingRow) {
  return booking.assigned_user_id
    ? page.hosts.filter((h) => h.user_id === booking.assigned_user_id)
    : page.hosts;
}

/** A team page's former owner must not receive new guest data by webhook. */
async function queuePageWebhook(
  db: Db,
  event: WebhookEvent,
  page: PageRow,
  data: Record<string, unknown>,
) {
  if (page.team_id) {
    const membership = await db.query(
      "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 FOR SHARE",
      [page.team_id, page.owner_id],
    );
    if (!membership.rowCount) return;
  }
  await queueWebhooks(
    db,
    event,
    { user_id: page.owner_id, team_id: null },
    data,
  );
}

/** In-app notices for the hosts. They point at the booking, not an event. */
async function notifyHosts(
  db: Db,
  page: PageRow,
  bookingId: string,
  title: string,
  body: string,
  except?: string | null,
  hosts = page.hosts,
) {
  for (const host of hosts) {
    if (host.user_id === except) continue;
    await db.query(
      `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
         title, body, state, kind, ref)
       VALUES ($1::uuid, NULL, 0, 'inapp', $1::text, $2, $3, 'sent', 'booking', $4)`,
      [host.user_id, title.slice(0, 200), body, bookingId],
    );
  }
}

/**
 * The booker's private manage link. Made once and kept encrypted, so every
 * email repeats the same link; only its hash is used to look it up.
 */
export async function manageLink(db: Db, booking: BookingRow) {
  let token: string;
  if (booking.manage_token_encrypted)
    token = await decryptSecret(booking.manage_token_encrypted);
  else {
    token = randomBytes(24).toString("base64url");
    await db.query(
      "UPDATE bookings SET manage_token_hash = $2, manage_token_encrypted = $3 WHERE id = $1",
      [booking.id, digest(token), await encryptSecret(token)],
    );
    booking.manage_token_encrypted = "set";
  }
  return appLink(`/book/manage/${token}`);
}

/** Save mail with the booking; the notifier sends only committed intents. */
async function mailBooker(
  db: Db,
  booking: BookingRow,
  subject: string,
  lines: string[],
) {
  await queueBookingEmail(db, booking.id, {
    destination: booking.email,
    title: subject,
    body: lines.filter(Boolean).join("\n\n"),
  });
}

export function eventTitle(
  page: PageRow,
  booking: Pick<BookingRow, "name" | "email">,
) {
  return page.event_title
    .replaceAll("{page}", page.title)
    .replaceAll("{name}", booking.name)
    .replaceAll("{email}", booking.email)
    .slice(0, 200);
}

/** Where a booking came from, for webhook payloads. */
const source = (page: PageRow) =>
  page.invite ? { page: null, invite_id: page.invite.id } : { page: page.slug };

/** An open invite's own link, for "pick another time". */
export async function inviteLink(invite: { token_encrypted: string }) {
  return appLink(`/invite/${await decryptSecret(invite.token_encrypted)}`);
}

/** The booker's answers as "Question: answer" lines. */
export function answerLines(page: PageRow, answers: Record<string, string>) {
  return page.questions
    .filter((q) => answers[q.id])
    .map((q) => `${q.label}: ${answers[q.id]}`);
}

/** Put the booking on every host's calendar. */
async function createHostEvents(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  hosts = effectiveHosts(page, booking),
) {
  const ids: string[] = [];
  for (const host of hosts) {
    // The event holds what the guest typed: outside agents are told so (and
    // their email address is masked) for as long as the event lasts, even
    // after the booking or its page is gone. Recorded first, so whatever is
    // written while the event is made already knows.
    const id = randomUUID();
    await db.query(
      "INSERT INTO item_sources (item_id, source) VALUES ($1, 'booking_guest')",
      [id],
    );
    const item = await mutate(
      db,
      { id: host.user_id, role: "member" },
      {
        operation: "create",
        data: {
          title: eventTitle(page, booking),
          notes: [
            page.invite
              ? `Booked by ${booking.name} <${booking.email}> through your open invite.`
              : `Booked by ${booking.name} <${booking.email}> through /book/${page.slug}.`,
            booking.note,
            answerLines(page, booking.answers).join("\n"),
          ]
            .filter(Boolean)
            .join("\n\n"),
          kind: "event",
          status: "todo",
          priority: "medium",
          due_at: booking.start_at.toISOString(),
          end_at: booking.end_at.toISOString(),
          reminder_minutes: 15,
          team_id: null,
          location: page.location,
          meeting_url: page.meeting_url,
        },
      },
      id,
    );
    ids.push(item!.id);
  }
  return ids;
}

/** A page can change assignment mode after a booking was made. */
export function bookingAvailabilityPage(
  page: PageRow,
  booking: BookingRow,
): PageRow {
  return {
    ...page,
    assignment: booking.assigned_user_id ? "round_robin" : "collective",
  };
}

/** Preserve a live round-robin assignee; only a departed host is replaced. */
export async function bookingSlotOptions(
  db: Queryable,
  page: PageRow,
  booking: BookingRow,
  lock = false,
): Promise<SlotOptions> {
  return {
    ignoreBookingId: booking.id,
    ignoreItemIds: (await currentHostEvents(db, booking, page, lock)).map(
      (item) => item.id,
    ),
    assignedHost:
      booking.assigned_user_id &&
      page.hosts.some((host) => host.user_id === booking.assigned_user_id)
        ? booking.assigned_user_id
        : undefined,
  };
}

/** Associations grant no authority over a former host's personal calendar.
 * Lock and retain only personal booking copies belonging to current hosts.
 * Detached copies stay unchanged, including their historical reminder settings. */
async function currentHostEvents(
  db: Queryable,
  booking: BookingRow,
  page: PageRow,
  lock = false,
) {
  const hosts = effectiveHosts(page, booking).map((host) => host.user_id);
  // Lock items before their source rows, matching item deletion and its source
  // cascade. A copy ignored by availability cannot change owner/scope or lose
  // booking provenance before the same transaction synchronizes it.
  const copies = (
    await db.query<{ id: string; user_id: string }>(
      `SELECT i.id, i.user_id FROM items i
     WHERE i.id = ANY ($1::uuid[]) AND i.user_id = ANY ($2::uuid[])
       AND i.team_id IS NULL
     ORDER BY i.id${lock ? " FOR UPDATE OF i" : ""}`,
      [booking.item_ids, hosts],
    )
  ).rows;
  const sources = (
    await db.query<{ item_id: string }>(
      `SELECT item_id FROM item_sources WHERE item_id = ANY ($1::uuid[])
       AND source = 'booking_guest' ORDER BY item_id${lock ? " FOR SHARE" : ""}`,
      [copies.map((copy) => copy.id)],
    )
  ).rows;
  const linked = new Set(sources.map((source) => source.item_id));
  return copies.filter((copy) => linked.has(copy.id));
}

/**
 * Check a time is still free for this booking. Hosts may approve or move a
 * booking inside the notice period; bookers may not.
 */
async function assertFree(
  db: Db,
  page: PageRow,
  booking: BookingRow,
  start: Date,
  end: Date,
  strict: boolean,
) {
  const duration = (end.getTime() - start.getTime()) / 60_000;
  const now = strict
    ? new Date()
    : new Date(
        Math.min(
          Date.now(),
          start.getTime() - page.min_notice_minutes * 60_000,
        ),
      );
  const options = await bookingSlotOptions(db, page, booking, true);
  const availabilityPage = bookingAvailabilityPage(page, booking);
  if (booking.assigned_user_id && !options.assignedHost) {
    const routed = page.routing.find(
      (rule) =>
        (booking.answers[rule.question_id] ?? "").trim().toLowerCase() ===
        rule.equals.trim().toLowerCase(),
    )?.host_user_id;
    const assigned = await chooseHost(
      db,
      availabilityPage,
      duration,
      start,
      end,
      now,
      routed,
      options,
    );
    if (!assigned)
      fail(409, "That time isn't free any more. Pick another time.");
    await db.query("UPDATE bookings SET assigned_user_id = $2 WHERE id = $1", [
      booking.id,
      assigned,
    ]);
    booking.assigned_user_id = assigned;
    options.assignedHost = assigned;
  }
  const free = await availableSlots(
    db,
    availabilityPage,
    duration,
    start,
    end,
    {
      ...options,
      now,
    },
  );
  if (!free.some((s) => s.start_at === start.toISOString()))
    fail(409, "That time isn't free any more. Pick another time.");
}

const place = (page: PageRow) =>
  [
    page.location ? `Where: ${page.location}` : "",
    page.meeting_url ? `Join: ${page.meeting_url}` : "",
  ].filter(Boolean);

/** Confirm: check the time, put it on the hosts' calendars, tell everyone. */
export async function confirm(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  by: Actor,
) {
  await assertFree(db, page, booking, booking.start_at, booking.end_at, false);
  const itemIds = await createHostEvents(db, booking, page);
  await db.query(
    `UPDATE bookings SET status = 'confirmed', item_ids = $2, confirm_token_hash = NULL,
       updated_at = now() WHERE id = $1`,
    [booking.id, itemIds],
  );
  booking.status = "confirmed";
  booking.item_ids = itemIds;
  await logEvent(db, booking.id, "confirmed", by);
  const tz = await pageTimeZone(db, page);
  await notifyHosts(
    db,
    page,
    booking.id,
    `New booking: ${page.title}`,
    `${booking.name} booked ${whenLabel(booking.start_at, booking.end_at, tz)}.`,
    by.userId,
    effectiveHosts(page, booking),
  );
  await queuePageWebhook(db, "booking.confirmed", page, {
    id: booking.id,
    ...source(page),
    start_at: booking.start_at.toISOString(),
    end_at: booking.end_at.toISOString(),
    name: booking.name,
    email: booking.email,
    answers: booking.answers,
  });
  const link = await manageLink(db, booking);
  await mailBooker(db, booking, `Confirmed: ${page.title}`, [
    `Hi ${booking.name},`,
    `You're booked for ${page.title} on ${whenLabel(booking.start_at, booking.end_at, booking.timezone)}.`,
    page.confirmation_message,
    ...place(page),
    `Need to change or cancel it? ${link}`,
  ]);
}

/** Hold the time for a host to approve, until they decide or it starts. */
export async function awaitApproval(
  db: Db,
  booking: BookingRow,
  page: PageRow,
) {
  await assertFree(db, page, booking, booking.start_at, booking.end_at, false);
  await db.query(
    `UPDATE bookings SET status = 'awaiting_approval', hold_until = start_at,
       confirm_token_hash = NULL, updated_at = now() WHERE id = $1`,
    [booking.id],
  );
  booking.status = "awaiting_approval";
  const tz = await pageTimeZone(db, page);
  await notifyHosts(
    db,
    page,
    booking.id,
    `Booking request: ${page.title}`,
    `${booking.name} asked for ${whenLabel(booking.start_at, booking.end_at, tz)}. Approve or decline it in Bookings.`,
    null,
    effectiveHosts(page, booking),
  );
  await queuePageWebhook(db, "booking.requested", page, {
    id: booking.id,
    ...source(page),
    start_at: booking.start_at.toISOString(),
    end_at: booking.end_at.toISOString(),
    name: booking.name,
    email: booking.email,
  });
  const link = await manageLink(db, booking);
  await mailBooker(db, booking, `Request received: ${page.title}`, [
    `Hi ${booking.name},`,
    `Your request for ${whenLabel(booking.start_at, booking.end_at, booking.timezone)} is waiting for the host to approve it. We'll email you when they decide.`,
    `To change or cancel it: ${link}`,
  ]);
}

const holding = (b: BookingRow) =>
  (b.status === "pending" || b.status === "awaiting_approval") &&
  b.hold_until > new Date();

export async function approve(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  userId: string,
) {
  if (booking.status !== "awaiting_approval" || !holding(booking))
    fail(409, "Only requests waiting for approval can be approved.");
  await logEvent(db, booking.id, "approved", { actor: "host", userId });
  await confirm(db, booking, page, { actor: "host", userId });
}

export async function decline(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  userId: string,
  reason: string,
) {
  if (booking.status !== "awaiting_approval" || !holding(booking))
    fail(409, "Only requests waiting for approval can be declined.");
  await db.query(
    `UPDATE bookings SET status = 'declined', cancel_reason = $2, cancelled_by = 'host',
       hold_until = now(), updated_at = now() WHERE id = $1`,
    [booking.id, reason],
  );
  await logEvent(db, booking.id, "declined", { actor: "host", userId }, reason);
  await queuePageWebhook(db, "booking.cancelled", page, {
    id: booking.id,
    ...source(page),
    status: "declined",
    reason,
  });
  await mailBooker(db, booking, `Not available: ${page.title}`, [
    `Hi ${booking.name},`,
    `Sorry, the host can't take ${whenLabel(booking.start_at, booking.end_at, booking.timezone)}.`,
    reason ? `Their note: ${reason}` : "",
    `Pick another time: ${appLink(`/book/${page.slug}`)}`,
  ]);
}

export async function cancel(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  by: Actor & { actor: "host" | "booker" },
  reason: string,
) {
  const open =
    booking.status === "confirmed"
      ? booking.end_at > new Date()
      : holding(booking);
  if (!open) fail(409, "This booking can't be cancelled any more.");
  const itemIds = (await currentHostEvents(db, booking, page, true)).map(
    (item) => item.id,
  );
  if (itemIds.length) {
    await recordDeletions(db, itemIds);
    await db.query("DELETE FROM items WHERE id = ANY ($1::uuid[])", [itemIds]);
  }
  await db.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3,
       item_ids = '{}', hold_until = now(), confirm_token_hash = NULL, cancel_token_hash = NULL,
       updated_at = now() WHERE id = $1`,
    [booking.id, by.actor, reason],
  );
  await logEvent(db, booking.id, "cancelled", by, reason);
  // An open invite opens again when its booker cancels (while it lasts); a
  // host cancelling withdraws it.
  let reopened = false;
  if (page.invite) {
    const row = (
      await db.query<{ status: string }>(
        `UPDATE open_invites SET
           status = CASE WHEN $2 = 'booker' AND expires_at > now() THEN 'open'
                         WHEN $2 = 'booker' THEN 'expired' ELSE 'cancelled' END,
           booking_id = CASE WHEN $2 = 'booker' THEN NULL ELSE booking_id END,
           updated_at = now()
         WHERE id = $1 AND booking_id = $3 RETURNING status`,
        [page.invite.id, by.actor, booking.id],
      )
    ).rows[0];
    reopened = row?.status === "open";
  }
  await queuePageWebhook(db, "booking.cancelled", page, {
    id: booking.id,
    ...source(page),
    status: "cancelled",
    cancelled_by: by.actor,
    reason,
  });
  const when = whenLabel(booking.start_at, booking.end_at, booking.timezone);
  if (by.actor === "host")
    await mailBooker(db, booking, `Cancelled: ${page.title}`, [
      `Hi ${booking.name},`,
      `Your booking for ${when} was cancelled by the host.`,
      reason ? `Their note: ${reason}` : "",
      page.invite ? "" : `Pick another time: ${appLink(`/book/${page.slug}`)}`,
    ]);
  else {
    const tz = await pageTimeZone(db, page);
    await notifyHosts(
      db,
      page,
      booking.id,
      `Cancelled: ${page.title}`,
      `${booking.name} cancelled ${whenLabel(booking.start_at, booking.end_at, tz)}.${
        reason ? ` Their note: ${reason}` : ""
      }`,
      null,
      effectiveHosts(page, booking),
    );
    await mailBooker(db, booking, `Cancelled: ${page.title}`, [
      `Hi ${booking.name},`,
      `Your booking for ${when} is cancelled.`,
      reopened
        ? `Changed your mind? Pick another time: ${await inviteLink(page.invite!)}`
        : "",
    ]);
  }
}

/**
 * The email reminding a booker of a confirmed booking, made when it's sent
 * so it carries the current manage link. Null when it shouldn't go any more:
 * the booking was cancelled or declined, moved (the reminder's `ref` keeps
 * the start it was queued for), or has started.
 */
export async function bookerReminder(db: Db, ref: string) {
  const [bookingId, epoch] = ref.split(":");
  const booking = (
    await db.query<BookingRow>("SELECT * FROM bookings WHERE id::text = $1", [
      bookingId,
    ])
  ).rows[0];
  if (
    !booking ||
    booking.status !== "confirmed" ||
    booking.start_at <= new Date() ||
    Math.round(booking.start_at.getTime() / 1000) !== Number(epoch)
  )
    return null;
  const page = await pageFor(db, booking, true);
  if (!page) return null;
  return {
    title: `Reminder: ${page.title}`,
    body: [
      `Hi ${booking.name},`,
      `A reminder: ${page.title} with ${page.hosts.map((h) => h.name).join(", ")} is on ${whenLabel(booking.start_at, booking.end_at, booking.timezone)}.`,
      ...place(page),
      `Need to change or cancel it? ${await manageLink(db, booking)}`,
    ].join("\n\n"),
  };
}

export async function reschedule(
  db: Db,
  booking: BookingRow,
  page: PageRow,
  start: Date,
  by: Actor & { actor: "host" | "booker" },
) {
  const open =
    booking.status === "confirmed"
      ? booking.end_at > new Date()
      : holding(booking);
  if (!open) fail(409, "This booking can't be moved any more.");
  if (by.actor === "booker" && !page.allow_reschedule)
    fail(
      403,
      "This page doesn't allow moving bookings. Cancel and book again instead.",
    );
  if (start.getTime() === booking.start_at.getTime())
    fail(409, "That's already the booked time.");
  const length = booking.end_at.getTime() - booking.start_at.getTime();
  const end = new Date(start.getTime() + length);
  const previousAssignee = booking.assigned_user_id;
  await assertFree(db, page, booking, start, end, by.actor === "booker");
  const tz = await pageTimeZone(db, page);
  const from = whenLabel(booking.start_at, booking.end_at, tz);
  await db.query(
    `UPDATE bookings SET start_at = $2, end_at = $3, reschedule_count = reschedule_count + 1,
       hold_until = CASE WHEN status = 'awaiting_approval' THEN $2 ELSE hold_until END,
       updated_at = now() WHERE id = $1`,
    [booking.id, start, end],
  );
  const retained = await currentHostEvents(db, booking, page, true);
  const itemIds = retained.map((item) => item.id);
  if (itemIds.length)
    await db.query(
      `UPDATE items SET due_at = $2, end_at = $3, version = version + 1,
         reminder_version = reminder_version + 1, updated_at = now()
       WHERE id = ANY ($1::uuid[])`,
      [itemIds, start, end],
    );
  booking.start_at = start;
  booking.end_at = end;
  // Reassignment creates the new assignee's copy. Ordinary moves never
  // recreate an event a host deliberately deleted or fan out ambiguous legacy
  // bookings whose assignee FK was cleared by account deletion.
  if (
    booking.status === "confirmed" &&
    previousAssignee &&
    previousAssignee !== booking.assigned_user_id &&
    !retained.length
  ) {
    itemIds.push(...(await createHostEvents(db, booking, page)));
  }
  await db.query("UPDATE bookings SET item_ids = $2 WHERE id = $1", [
    booking.id,
    itemIds,
  ]);
  booking.item_ids = itemIds;
  const to = whenLabel(start, end, tz);
  await logEvent(db, booking.id, "rescheduled", by, `From ${from} to ${to}`);
  await queuePageWebhook(db, "booking.rescheduled", page, {
    id: booking.id,
    ...source(page),
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    moved_by: by.actor,
  });
  if (by.actor === "booker")
    await notifyHosts(
      db,
      page,
      booking.id,
      `Rescheduled: ${page.title}`,
      `${booking.name} moved their booking from ${from} to ${to}.`,
      null,
      effectiveHosts(page, booking),
    );
  const link = await manageLink(db, booking);
  await mailBooker(db, booking, `Rescheduled: ${page.title}`, [
    `Hi ${booking.name},`,
    `${by.actor === "host" ? "The host moved your booking" : "Your booking is moved"} to ${whenLabel(start, end, booking.timezone)}.`,
    ...place(page),
    `To change or cancel it: ${link}`,
  ]);
}

import { randomBytes, randomUUID } from "node:crypto";
import { fail } from "@orbyn/core";
import { env } from "../../config/env.js";
import type { Db } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { emailEnabled, sendEmail } from "../../worker/channels/email.js";
import { mutate } from "../items/service.js";
import { availableSlots, pageTimeZone, type PageRow } from "./availability.js";

/**
 * What can happen to a booking: confirmed, held for a host's approval,
 * approved or declined, cancelled by either side, or moved. Every step lands
 * on the booking's timeline, tells the other side, and fires a webhook.
 */
export type BookingRow = {
  id: string;
  page_id: string;
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

/** In-app notices for the hosts. They point at the booking, not an event. */
async function notifyHosts(
  db: Db,
  page: PageRow,
  bookingId: string,
  title: string,
  body: string,
  except?: string | null,
) {
  for (const host of page.hosts) {
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

/** Email the booker. Best effort: a mail outage never undoes a booking step. */
async function mailBooker(
  booking: BookingRow,
  subject: string,
  lines: string[],
) {
  if (!(await emailEnabled())) return;
  await sendEmail({
    id: randomUUID(),
    destination: booking.email,
    title: subject,
    body: lines.filter(Boolean).join("\n\n"),
  }).catch(() => {});
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

/** The booker's answers as "Question: answer" lines. */
export function answerLines(page: PageRow, answers: Record<string, string>) {
  return page.questions
    .filter((q) => answers[q.id])
    .map((q) => `${q.label}: ${answers[q.id]}`);
}

/** Put the booking on every host's calendar. */
async function createHostEvents(db: Db, booking: BookingRow, page: PageRow) {
  const ids: string[] = [];
  for (const host of page.hosts) {
    const item = await mutate(
      db,
      { id: host.user_id, role: "member" },
      {
        operation: "create",
        data: {
          title: eventTitle(page, booking),
          notes: [
            `Booked by ${booking.name} <${booking.email}> through /book/${page.slug}.`,
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
    );
    ids.push(item!.id);
  }
  return ids;
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
  const free = await availableSlots(db, page, duration, start, end, {
    now,
    ignoreBookingId: booking.id,
    ignoreItemIds: booking.item_ids,
  });
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
  );
  await queueWebhooks(
    db,
    "booking.confirmed",
    { user_id: page.owner_id, team_id: null },
    {
      id: booking.id,
      page: page.slug,
      start_at: booking.start_at.toISOString(),
      end_at: booking.end_at.toISOString(),
      name: booking.name,
      email: booking.email,
      answers: booking.answers,
    },
  );
  const link = await manageLink(db, booking);
  await mailBooker(booking, `Confirmed: ${page.title}`, [
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
  );
  await queueWebhooks(
    db,
    "booking.requested",
    { user_id: page.owner_id, team_id: null },
    {
      id: booking.id,
      page: page.slug,
      start_at: booking.start_at.toISOString(),
      end_at: booking.end_at.toISOString(),
      name: booking.name,
      email: booking.email,
    },
  );
  const link = await manageLink(db, booking);
  await mailBooker(booking, `Request received: ${page.title}`, [
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
  await queueWebhooks(
    db,
    "booking.cancelled",
    { user_id: page.owner_id, team_id: null },
    {
      id: booking.id,
      page: page.slug,
      status: "declined",
      reason,
    },
  );
  await mailBooker(booking, `Not available: ${page.title}`, [
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
  if (booking.item_ids.length)
    await db.query("DELETE FROM items WHERE id = ANY ($1::uuid[])", [
      booking.item_ids,
    ]);
  await db.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3,
       item_ids = '{}', hold_until = now(), confirm_token_hash = NULL, cancel_token_hash = NULL,
       updated_at = now() WHERE id = $1`,
    [booking.id, by.actor, reason],
  );
  await logEvent(db, booking.id, "cancelled", by, reason);
  await queueWebhooks(
    db,
    "booking.cancelled",
    { user_id: page.owner_id, team_id: null },
    {
      id: booking.id,
      page: page.slug,
      status: "cancelled",
      cancelled_by: by.actor,
      reason,
    },
  );
  const when = whenLabel(booking.start_at, booking.end_at, booking.timezone);
  if (by.actor === "host")
    await mailBooker(booking, `Cancelled: ${page.title}`, [
      `Hi ${booking.name},`,
      `Your booking for ${when} was cancelled by the host.`,
      reason ? `Their note: ${reason}` : "",
      `Pick another time: ${appLink(`/book/${page.slug}`)}`,
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
    );
    await mailBooker(booking, `Cancelled: ${page.title}`, [
      `Hi ${booking.name},`,
      `Your booking for ${when} is cancelled.`,
    ]);
  }
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
  await assertFree(db, page, booking, start, end, by.actor === "booker");
  const tz = await pageTimeZone(db, page);
  const from = whenLabel(booking.start_at, booking.end_at, tz);
  await db.query(
    `UPDATE bookings SET start_at = $2, end_at = $3, reschedule_count = reschedule_count + 1,
       hold_until = CASE WHEN status = 'awaiting_approval' THEN $2 ELSE hold_until END,
       updated_at = now() WHERE id = $1`,
    [booking.id, start, end],
  );
  if (booking.item_ids.length)
    await db.query(
      `UPDATE items SET due_at = $2, end_at = $3, version = version + 1,
         reminder_version = reminder_version + 1, updated_at = now()
       WHERE id = ANY ($1::uuid[])`,
      [booking.item_ids, start, end],
    );
  booking.start_at = start;
  booking.end_at = end;
  const to = whenLabel(start, end, tz);
  await logEvent(db, booking.id, "rescheduled", by, `From ${from} to ${to}`);
  await queueWebhooks(
    db,
    "booking.rescheduled",
    { user_id: page.owner_id, team_id: null },
    {
      id: booking.id,
      page: page.slug,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      moved_by: by.actor,
    },
  );
  if (by.actor === "booker")
    await notifyHosts(
      db,
      page,
      booking.id,
      `Rescheduled: ${page.title}`,
      `${booking.name} moved their booking from ${from} to ${to}.`,
    );
  const link = await manageLink(db, booking);
  await mailBooker(booking, `Rescheduled: ${page.title}`, [
    `Hi ${booking.name},`,
    `${by.actor === "host" ? "The host moved your booking" : "Your booking is moved"} to ${whenLabel(start, end, booking.timezone)}.`,
    ...place(page),
    `To change or cancel it: ${link}`,
  ]);
}

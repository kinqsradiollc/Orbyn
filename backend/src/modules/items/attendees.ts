import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  describeRrule,
  fail,
  rsvpInput,
  type Attendee,
  type AttendeeStatus,
  type RsvpView,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { strictRateLimit } from "../../lib/params.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { settings } from "../../lib/settings.js";
import { emailEnabled } from "../../worker/channels/email.js";
import { loadOverrides } from "../planner/calendar.js";
import {
  FEED_COLUMNS,
  inviteCalendar,
  type CalendarPerson,
  type FeedItem,
} from "../planner/ics.js";

/**
 * People invited to an event by email. No account or calendar provider is
 * needed: each person gets an iCalendar invitation their own calendar app
 * understands, and a private link to answer yes, maybe or no. Invitations go
 * out through the notifier's email lane, queued in the same transaction as
 * the change (a rolled-back edit sends nothing, and a mail outage never fails
 * an edit), and only when SMTP is set up.
 */
export type InviteItem = FeedItem & { user_id: string };

export async function listAttendees(
  db: Queryable,
  itemId: string,
): Promise<Attendee[]> {
  return (
    await db.query<Attendee>(
      `SELECT id, email, name, status, responded_at FROM item_attendees
       WHERE item_id = $1 ORDER BY created_at, email`,
      [itemId],
    )
  ).rows;
}

/**
 * Make the invitee list `wanted`: new people get their own RSVP link (kept
 * encrypted, so every invitation repeats it), people left out are removed,
 * and names are updated. Returns who was added (attendee ids) and removed.
 */
export async function syncAttendees(
  db: Db,
  itemId: string,
  wanted: { email: string; name?: string }[],
) {
  const current = (
    await db.query<{
      id: string;
      email: string;
      name: string;
      status: AttendeeStatus;
    }>(
      "SELECT id, email, name, status FROM item_attendees WHERE item_id = $1",
      [itemId],
    )
  ).rows;
  const keep = new Set(wanted.map((w) => w.email));
  const removed = current.filter((c) => !keep.has(c.email));
  if (removed.length)
    await db.query("DELETE FROM item_attendees WHERE id = ANY ($1::uuid[])", [
      removed.map((r) => r.id),
    ]);
  const added: string[] = [];
  for (const w of wanted) {
    const found = current.find((c) => c.email === w.email);
    if (found) {
      if (w.name !== undefined && w.name !== found.name)
        await db.query("UPDATE item_attendees SET name = $2 WHERE id = $1", [
          found.id,
          w.name,
        ]);
      continue;
    }
    const token = randomBytes(24).toString("base64url");
    const { id } = (
      await db.query<{ id: string }>(
        `INSERT INTO item_attendees (item_id, email, name, token_hash, token_encrypted)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          itemId,
          w.email,
          w.name ?? "",
          digest(token),
          await encryptSecret(token),
        ],
      )
    ).rows[0];
    added.push(id);
  }
  return {
    added,
    removed: removed.map(({ email, name, status }) => ({
      email,
      name,
      status,
    })),
  };
}

/** The event as invitations describe it. */
export async function loadInviteItem(
  db: Queryable,
  itemId: string,
): Promise<InviteItem | undefined> {
  return (
    await db.query<InviteItem>(
      `SELECT ${FEED_COLUMNS}, i.user_id FROM items i WHERE i.id = $1`,
      [itemId],
    )
  ).rows[0];
}

/** An event and everyone invited to it, read before it's deleted. */
export async function inviteSnapshot(db: Db, itemId: string) {
  const item = await loadInviteItem(db, itemId);
  if (!item || item.kind !== "event") return null;
  const people = (
    await db.query<CalendarPerson>(
      "SELECT email, name, status FROM item_attendees WHERE item_id = $1",
      [itemId],
    )
  ).rows;
  return people.length ? { item, people } : null;
}

/** Invitations come from the SMTP sender's address, in the owner's name. */
async function organizer(
  db: Queryable,
  ownerId: string,
): Promise<CalendarPerson> {
  const from = (await settings()).smtp.from;
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  const name = (
    await db.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [
      ownerId,
    ])
  ).rows[0]?.name;
  return { email, name: name || "Orbyn" };
}

/** The zone times are written in: the item's own, or its owner's. */
async function zoneOf(db: Queryable, item: InviteItem) {
  if (item.timezone !== "UTC") return item.timezone;
  return (
    (
      await db.query<{ timezone: string }>(
        "SELECT timezone FROM planner_prefs WHERE user_id = $1",
        [item.user_id],
      )
    ).rows[0]?.timezone ?? "UTC"
  );
}

/** "Friday 18 September, 10:00 am to 10:30 am (Australia/Melbourne)", or a day for all-day events. */
export function eventWhen(
  item: Pick<InviteItem, "due_at" | "end_at" | "all_day" | "rrule">,
  timeZone: string,
) {
  const day = (at: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(at);
  const clock = (at: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  const start = new Date(item.due_at);
  let when: string;
  if (item.all_day) {
    const last = item.end_at
      ? new Date(new Date(item.end_at).getTime() - 1)
      : start;
    when =
      day(last) === day(start)
        ? `${day(start)} (all day)`
        : `${day(start)} to ${day(last)}`;
  } else
    when = `${day(start)}, ${clock(start)}${
      item.end_at ? ` to ${clock(new Date(item.end_at))}` : ""
    } (${timeZone})`;
  return item.rrule ? `${when} · ${describeRrule(item.rrule)}` : when;
}

const appLink = (path: string) => `${env.APP_URL.replace(/\/$/, "")}${path}`;

async function queueMail(
  db: Db,
  n: {
    ownerId: string;
    itemId: string | null;
    version: number;
    email: string;
    title: string;
    body: string;
    ical: string;
    ref: string;
  },
) {
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref, ical)
     VALUES ($1::uuid, $2::uuid, $3, 'email', $4::text, $5, $6, 'pending', 'invite', $7::text, $8)
     ON CONFLICT DO NOTHING`,
    [
      n.ownerId,
      n.itemId,
      n.version,
      n.email,
      n.title.slice(0, 200),
      n.body,
      n.ref,
      n.ical,
    ],
  );
}

/**
 * Email an event's invitation (METHOD:REQUEST) to everyone invited, or only
 * to the attendee ids in `only`. Each email carries the calendar part and
 * that person's RSVP links.
 */
export async function queueInvites(
  db: Db,
  itemId: string,
  options: { only?: string[]; updated?: boolean } = {},
) {
  if (!(await emailEnabled())) return;
  const item = await loadInviteItem(db, itemId);
  if (!item || item.kind !== "event") return;
  const people = (
    await db.query<CalendarPerson & { id: string; token_encrypted: string }>(
      `SELECT id, email, name, status, token_encrypted FROM item_attendees
       WHERE item_id = $1 ORDER BY created_at, email`,
      [itemId],
    )
  ).rows;
  if (!people.length) return;
  const from = await organizer(db, item.user_id);
  const ical = inviteCalendar(
    "REQUEST",
    item,
    from,
    people,
    (await loadOverrides(db, [itemId])).get(itemId),
  );
  const when = eventWhen(item, await zoneOf(db, item));
  for (const p of people) {
    if (options.only && !options.only.includes(p.id)) continue;
    const link = appLink(`/rsvp/${await decryptSecret(p.token_encrypted)}`);
    await queueMail(db, {
      ownerId: item.user_id,
      itemId,
      version: item.version,
      email: p.email,
      title: `${options.updated ? "Updated invitation" : "Invitation"}: ${item.title}`,
      body: [
        `${from.name} ${options.updated ? "changed" : "invited you to"} "${item.title}".`,
        `When: ${when}`,
        item.location ? `Where: ${item.location}` : "",
        item.meeting_url ? `Join: ${item.meeting_url}` : "",
        `Going? Yes: ${link}?r=accepted\nMaybe: ${link}?r=tentative\nNo: ${link}?r=declined`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      ical,
      ref: `REQUEST:${p.id}`,
    });
  }
}

/**
 * Tell people an event is off (METHOD:CANCEL): it was deleted, or they were
 * taken off it. `exists` is false once the event itself is gone.
 */
export async function queueCancellations(
  db: Db,
  item: InviteItem,
  people: CalendarPerson[],
  exists: boolean,
) {
  if (!people.length || item.kind !== "event" || !(await emailEnabled()))
    return;
  const from = await organizer(db, item.user_id);
  const ical = inviteCalendar("CANCEL", item, from, people);
  const when = eventWhen(item, await zoneOf(db, item));
  for (const p of people)
    await queueMail(db, {
      ownerId: item.user_id,
      itemId: exists ? item.id : null,
      version: item.version,
      email: p.email,
      title: `Cancelled: ${item.title}`,
      body: exists
        ? `${from.name} took you off "${item.title}" (${when}).`
        : `${from.name} cancelled "${item.title}" (${when}).`,
      ical,
      ref: `CANCEL:${p.email}`,
    });
}

const tokenParam = (params: unknown) =>
  z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).parse(params)
    .token;

type RsvpRow = {
  id: string;
  item_id: string;
  email: string;
  name: string;
  status: AttendeeStatus;
  title: string;
  due_at: Date;
  end_at: Date | null;
  all_day: boolean;
  timezone: string;
  rrule: string | null;
  location: string;
  meeting_url: string;
  user_id: string;
  organizer: string;
};

async function findInvitation(db: Queryable, token: string) {
  const row = (
    await db.query<RsvpRow>(
      `SELECT a.id, a.item_id, a.email, a.name, a.status, i.title, i.due_at, i.end_at,
              i.all_day, i.timezone, i.rrule, i.location, i.meeting_url, i.user_id,
              u.name AS organizer
       FROM item_attendees a JOIN items i ON i.id = a.item_id JOIN users u ON u.id = i.user_id
       WHERE a.token_hash = $1`,
      [digest(token)],
    )
  ).rows[0];
  if (!row) fail(404, "This invitation isn't available any more.");
  return row;
}

async function view(db: Queryable, row: RsvpRow): Promise<RsvpView> {
  const zone =
    row.timezone !== "UTC"
      ? row.timezone
      : ((
          await db.query<{ timezone: string }>(
            "SELECT timezone FROM planner_prefs WHERE user_id = $1",
            [row.user_id],
          )
        ).rows[0]?.timezone ?? "UTC");
  return {
    title: row.title,
    start_at: row.due_at.toISOString(),
    end_at: row.end_at ? row.end_at.toISOString() : null,
    all_day: row.all_day,
    timezone: zone,
    rrule: row.rrule,
    organizer: row.organizer,
    location: row.location,
    meeting_url: row.meeting_url,
    name: row.name,
    email: row.email,
    status: row.status,
  };
}

const ANSWER = {
  accepted: "accepted",
  declined: "declined",
  tentative: "might come to",
} as const;

/**
 * An invitee's private link: see the event and answer it. Reading never
 * changes anything (mail scanners open links), so the web page posts the
 * answer.
 */
export async function rsvpRoutes(app: FastifyInstance) {
  app.get("/rsvp/:token", async (r): Promise<RsvpView> => {
    const db = reader(r.headers);
    return view(db, await findInvitation(db, tokenParam(r.params)));
  });

  app.post("/rsvp/:token", strictRateLimit, async (r): Promise<RsvpView> => {
    const token = tokenParam(r.params);
    const d = rsvpInput.parse(r.body);
    return transaction(async (db) => {
      const row = await findInvitation(db, token);
      if (row.status !== d.status) {
        await db.query(
          "UPDATE item_attendees SET status = $2, responded_at = now() WHERE id = $1",
          [row.id, d.status],
        );
        // One notice per person, refreshed when they change their answer.
        const who = row.name || row.email;
        const when = eventWhen(row, (await view(db, row)).timezone);
        await db.query(
          `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
             title, body, state, kind, ref)
           VALUES ($1::uuid, $2::uuid, 0, 'inapp', $1::text, $3, $4, 'sent', 'rsvp', $5::text)
           ON CONFLICT ON CONSTRAINT notifications_once DO UPDATE
             SET title = EXCLUDED.title, body = EXCLUDED.body, read = false, created_at = now()`,
          [
            row.user_id,
            row.item_id,
            `${who} ${d.status === "tentative" ? "might come" : ANSWER[d.status]}: ${row.title}`.slice(
              0,
              200,
            ),
            `${who} ${ANSWER[d.status]} "${row.title}" (${when}).`,
            row.id,
          ],
        );
        row.status = d.status;
      }
      return view(db, row);
    });
  });
}

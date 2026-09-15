import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  fail,
  inviteBookingRequest,
  inviteQuery,
  openInviteInput,
  type BookingReceipt,
  type BookingStatus,
  type OpenInvite,
  type PublicInvite,
} from "@orbyn/core";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, digest } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { encryptSecret } from "../../lib/secrets.js";
import { availableSlots, type InviteRow } from "./availability.js";
import {
  checkCoHosts,
  INVITE_COLUMNS,
  inviteAsPage,
  inviteById,
} from "./pages.js";
import {
  cancel,
  confirm,
  inviteLink,
  logEvent,
  type BookingRow,
} from "./service.js";

/**
 * Open invites: a one-off private link offering hand-picked windows. The
 * person it's sent to picks a free time inside them (the owner and every
 * co-host must be free), which books it at once, like a booking page
 * without the email check: the link went to someone the owner chose. The
 * booker gets the usual manage link, and can move the booking within the
 * same windows. An invite expires at `expires_at` (the end of its last
 * window at the latest).
 */
const MAX_AHEAD_DAYS = 90;
const DAY = 86_400_000;

const tokenParam = (params: unknown) =>
  z.object({ token: z.string().min(20).max(64) }).parse(params).token;

/** The last moment any window offers. */
const lastEnd = (invite: Pick<InviteRow, "windows">) =>
  Math.max(...invite.windows.map((w) => Date.parse(w.end_at)));

/** An invite as its owner sees it: the link, co-hosts and the booking. */
async function ownerView(
  db: Queryable,
  invite: InviteRow,
): Promise<OpenInvite> {
  const coHosts = invite.co_host_ids.length
    ? (
        await db.query<{ user_id: string; name: string }>(
          "SELECT id AS user_id, name FROM users WHERE id = ANY ($1::uuid[]) ORDER BY name",
          [invite.co_host_ids],
        )
      ).rows
    : [];
  const booking = invite.booking_id
    ? ((
        await db.query<{
          id: string;
          name: string;
          email: string;
          start_at: Date;
          end_at: Date;
          status: BookingStatus;
        }>(
          "SELECT id, name, email, start_at, end_at, status FROM bookings WHERE id = $1",
          [invite.booking_id],
        )
      ).rows[0] ?? null)
    : null;
  return {
    id: invite.id,
    title: invite.title,
    duration: invite.duration,
    windows: invite.windows,
    location: invite.location,
    meeting_url: invite.meeting_url,
    co_hosts: coHosts,
    remind_before_minutes: invite.remind_before_minutes.map(Number),
    status: invite.status,
    expires_at: invite.expires_at.toISOString(),
    url: await inviteLink(invite),
    booking: booking && {
      ...booking,
      start_at: booking.start_at.toISOString(),
      end_at: booking.end_at.toISOString(),
    },
    created_at: invite.created_at.toISOString(),
  };
}

async function ownInvite(
  db: Queryable,
  id: string,
  userId: string,
  lock = false,
) {
  const invite = await inviteById(db, id, lock);
  if (!invite || invite.owner_id !== userId) fail(404, "Invite not found");
  return invite;
}

async function inviteByToken(db: Queryable, token: string, lock = false) {
  const invite = (
    await db.query<InviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM open_invites oi WHERE oi.token_hash = $1${lock ? " FOR UPDATE" : ""}`,
      [digest(token)],
    )
  ).rows[0];
  if (!invite) fail(404, "This invite link isn't valid. Ask for a new one.");
  return invite;
}

/** Open invites that ran out of time; the notifier runs this each cycle. */
export async function expireInvites(db: Queryable) {
  await db.query(
    `UPDATE open_invites SET status = 'expired', updated_at = now()
     WHERE status = 'open' AND expires_at <= now()`,
  );
}

export async function inviteRoutes(app: FastifyInstance) {
  // ---- your invites (signed in) -----------------------------------------------

  app.get("/open-invites", async (r) => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const rows = (
      await db.query<InviteRow>(
        `SELECT ${INVITE_COLUMNS} FROM open_invites oi
         WHERE oi.owner_id = $1 ORDER BY oi.created_at DESC LIMIT 200`,
        [u.id],
      )
    ).rows;
    return Promise.all(rows.map((i) => ownerView(db, i)));
  });

  app.post("/open-invites", async (r, reply): Promise<OpenInvite> => {
    const u = await authenticate(r);
    const d = openInviteInput.parse(r.body);
    const now = Date.now();
    const windows = d.windows
      .map((w) => ({
        start_at: new Date(w.start_at).toISOString(),
        end_at: new Date(w.end_at).toISOString(),
      }))
      .filter((w) => Date.parse(w.end_at) > now)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    if (!windows.length)
      fail(422, "Every window has already passed. Pick times ahead.");
    const end = lastEnd({ windows });
    if (end > now + MAX_AHEAD_DAYS * DAY)
      fail(422, `Windows can be up to ${MAX_AHEAD_DAYS} days ahead.`);
    const expires = Math.min(
      d.expires_at ? Date.parse(d.expires_at) : end,
      end,
    );
    if (expires <= now)
      fail(422, "The link would expire straight away. Pick a later time.");
    const invite = await transaction(async (db) => {
      await checkCoHosts(db, u.id, d.co_host_ids);
      const token = randomBytes(24).toString("base64url");
      const { id } = (
        await db.query<{ id: string }>(
          `INSERT INTO open_invites (owner_id, token_hash, token_encrypted, title, duration,
             windows, location, meeting_url, co_host_ids, remind_before_minutes, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::smallint[], $11) RETURNING id`,
          [
            u.id,
            digest(token),
            await encryptSecret(token),
            d.title,
            d.duration,
            JSON.stringify(windows),
            d.location,
            d.meeting_url,
            [...new Set(d.co_host_ids.filter((id) => id !== u.id))],
            d.remind_before_minutes,
            new Date(expires),
          ],
        )
      ).rows[0];
      return ownerView(db, (await inviteById(db, id))!);
    });
    reply.code(201);
    return invite;
  });

  app.get("/open-invites/:id", async (r): Promise<OpenInvite> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    return ownerView(db, await ownInvite(db, idParam(r), u.id));
  });

  // Withdraw an invite. A booking made from it is cancelled (the booker is told).
  app.delete("/open-invites/:id", async (r, reply) => {
    const u = await authenticate(r);
    await transaction(async (db: Db) => {
      const invite = await ownInvite(db, idParam(r), u.id, true);
      if (invite.status === "booked" && invite.booking_id) {
        const booking = (
          await db.query<BookingRow>(
            "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
            [invite.booking_id],
          )
        ).rows[0];
        if (
          !booking ||
          booking.status !== "confirmed" ||
          booking.end_at <= new Date()
        )
          fail(409, "This invite was already used, so it can't be withdrawn.");
        await cancel(
          db,
          booking,
          await inviteAsPage(db, invite),
          { actor: "host", userId: u.id },
          "",
        );
      } else if (invite.status !== "open")
        fail(409, "This invite isn't open any more.");
      await db.query(
        "UPDATE open_invites SET status = 'cancelled', updated_at = now() WHERE id = $1",
        [invite.id],
      );
    });
    return reply.code(204).send();
  });

  // ---- the invite link (no sign-in) --------------------------------------------------

  app.get("/invite/:token", async (r): Promise<PublicInvite> => {
    const token = tokenParam(r.params);
    const q = inviteQuery.parse(r.query);
    const db = reader(r.headers);
    const invite = await inviteByToken(db, token);
    const page = await inviteAsPage(db, invite);
    return {
      title: invite.title,
      hosts: page.hosts.map((h) => h.name),
      duration: invite.duration,
      location: invite.location,
      has_meeting_link: !!invite.meeting_url,
      status: invite.status,
      expires_at: invite.expires_at.toISOString(),
      timezone: q.timezone,
      slots:
        invite.status === "open"
          ? await availableSlots(
              db,
              page,
              invite.duration,
              new Date(),
              new Date(lastEnd(invite)),
            )
          : [],
    };
  });

  app.post(
    "/invite/:token",
    strictRateLimit,
    async (r, reply): Promise<BookingReceipt> => {
      const token = tokenParam(r.params);
      const d = inviteBookingRequest.parse(r.body);
      const result = await transaction(async (db) => {
        const invite = await inviteByToken(db, token, true);
        if (invite.status === "booked")
          fail(
            409,
            "This invite was already used. Check your email for the booking.",
          );
        if (invite.status === "expired")
          fail(410, "This invite has expired. Ask for a new one.");
        if (invite.status === "cancelled")
          fail(410, "This invite was withdrawn.");
        const page = await inviteAsPage(db, invite);
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          invite.id,
        ]);
        const start = new Date(d.start_at);
        const end = new Date(start.getTime() + invite.duration * 60_000);
        const free = await availableSlots(
          db,
          page,
          invite.duration,
          start,
          end,
        );
        if (!free.some((s) => s.start_at === start.toISOString()))
          fail(409, "That time was just taken. Pick another time.");
        const manageToken = randomBytes(24).toString("base64url");
        const booking = (
          await db.query<BookingRow>(
            `INSERT INTO bookings (invite_id, start_at, end_at, name, email, note, timezone,
               manage_token_hash, manage_token_encrypted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [
              invite.id,
              start,
              end,
              d.name,
              d.email,
              d.note,
              d.timezone,
              digest(manageToken),
              await encryptSecret(manageToken),
            ],
          )
        ).rows[0];
        await logEvent(db, booking.id, "requested", { actor: "booker" });
        await confirm(db, booking, page, { actor: "booker" });
        await db.query(
          `UPDATE open_invites SET status = 'booked', booking_id = $2, updated_at = now()
           WHERE id = $1`,
          [invite.id, booking.id],
        );
        return {
          id: booking.id,
          status: "confirmed" as const,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          needs_confirmation: false,
          needs_approval: false,
          confirmation_message: "",
        };
      });
      reply.code(201);
      return result;
    },
  );
}

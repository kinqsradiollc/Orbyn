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
  BOOKING_SELECT,
  MINE,
  VIEWS,
  bookingAction,
  bookingDetail,
  bookingFor,
  bookingSlots,
  bookingStats,
  canEdit,
  createBookingPage,
  deleteBookingPage,
  updateBookingPage,
  canHost,
  detail,
  listBookingPages,
  listBookings,
  requireBookingPage,
  requirePage,
  searchWords,
  setHostNote,
  setNoShow,
} from "./manage.js";
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

async function pageBySlug(db: Queryable, slug: string) {
  return (
    await db.query<PageRow>(
      `SELECT ${PAGE_COLUMNS} FROM booking_pages p WHERE p.slug = $1 AND p.active
         -- A team can pause its booking pages for people outside (OTH-04).
         AND (p.team_id IS NULL OR EXISTS (
           SELECT 1 FROM teams bt WHERE bt.id = p.team_id AND bt.booking_allowed))`,
      [slug.toLowerCase()],
    )
  ).rows[0];
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
    return listBookingPages(reader(r.headers), u.id);
  });

  app.post("/booking-pages", async (r, reply) => {
    const u = await authenticate(r);
    const d = bookingPageInput.parse(r.body);
    const page = await transaction((db) => createBookingPage(db, u, d));
    reply.code(201);
    return page;
  });

  app.put("/booking-pages/:id", async (r) => {
    const u = await authenticate(r);
    const d = bookingPageUpdate.parse(r.body);
    return transaction((db) => updateBookingPage(db, u, idParam(r), d));
  });

  app.delete("/booking-pages/:id", async (r, reply) => {
    const u = await authenticate(r);
    await transaction((db) => deleteBookingPage(db, u, idParam(r)));
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

  // ---- tracking bookings (signed in) ----------------------------------------------

  app.get("/bookings", async (r) => {
    const u = await authenticate(r);
    const q = bookingsQuery.parse(r.query);
    return listBookings(reader(r.headers), u.id, q);
  });

  app.get("/bookings/stats", async (r): Promise<BookingStats> => {
    const u = await authenticate(r);
    const q = bookingStatsQuery.parse(r.query);
    return bookingStats(reader(r.headers), u.id, q.page_id ?? null);
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
    return bookingDetail(reader(r.headers), u, idParam(r));
  });

  // Times a host can move a booking to: its own time and events don't
  // count as busy, the page may be switched off, and notice doesn't apply.
  app.get("/bookings/:id/slots", async (r) => {
    const u = await authenticate(r);
    const q = rescheduleSlotsQuery.parse(r.query);
    return bookingSlots(reader(r.headers), u, idParam(r), q);
  });

  app.post("/bookings/:id/approve", async (r) => {
    const u = await authenticate(r);
    return transaction((db) =>
      bookingAction(db, u, idParam(r), { action: "approve" }),
    );
  });

  app.post("/bookings/:id/decline", async (r) => {
    const u = await authenticate(r);
    const d = bookingReason.parse(r.body ?? {});
    return transaction((db) =>
      bookingAction(db, u, idParam(r), { action: "decline", reason: d.reason }),
    );
  });

  app.post("/bookings/:id/cancel", async (r) => {
    const u = await authenticate(r);
    const d = bookingReason.parse(r.body ?? {});
    return transaction((db) =>
      bookingAction(db, u, idParam(r), { action: "cancel", reason: d.reason }),
    );
  });

  app.post("/bookings/:id/reschedule", async (r) => {
    const u = await authenticate(r);
    const d = bookingReschedule.parse(r.body);
    return transaction((db) =>
      bookingAction(db, u, idParam(r), {
        action: "reschedule",
        start_at: d.start_at,
      }),
    );
  });

  app.put("/bookings/:id/no-show", async (r) => {
    const u = await authenticate(r);
    const d = noShowInput.parse(r.body);
    return transaction((db) => setNoShow(db, u, idParam(r), d.no_show));
  });

  app.put("/bookings/:id/note", async (r) => {
    const u = await authenticate(r);
    const d = bookingNoteInput.parse(r.body);
    return transaction((db) => setHostNote(db, u, idParam(r), d.host_note));
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

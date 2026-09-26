import { z } from "zod";
import { BOOKING_VIEWS } from "@orbyn/core";
import {
  bookingDetail,
  bookingSlots,
  bookingStats,
  listBookingPages,
  listBookings,
  setHostNote,
  setNoShow,
} from "../modules/booking/manage.js";
import { listOpenInvites, openInviteOf } from "../modules/booking/invites.js";
import { READ } from "./common.js";
import {
  both,
  cleanTitle,
  fencedTitle,
  labelled,
  maskEmails,
} from "./format.js";
import { appUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { actionChange, quoted } from "./shared.js";
import {
  EDITS,
  actorOf,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  idField,
  isoTime,
  refuseSecrets,
  writeOutput,
} from "./write.js";

/**
 * The booking add-on: booking pages and the bookings people outside Orbyn
 * made on them. It holds guests' names, emails and answers, so it is off
 * unless the connection was given bookings. What guests typed comes back
 * fenced as outside content (only "Booking" when the connection hides
 * outside content); guests' email addresses are always masked. Approving,
 * declining, cancelling and moving a booking email the guest, and changing
 * a booking page or an open invite changes what outsiders can book, so
 * those always wait in the person's Review inbox; a no-show mark and a
 * private note are made at once.
 */

/** Booking pages this connection's spaces reach, by id, with their team. */
async function reachablePages(ctx: CapabilityContext) {
  const pages = await listBookingPages(ctx.db, ctx.principal.user.id);
  const teams = new Set(ctx.principal.teams.map((t) => t.id));
  return new Map(
    pages
      .filter((p) =>
        p.team_id ? teams.has(p.team_id) : ctx.principal.personal,
      )
      .map((p) => [p.id, p]),
  );
}

const guest = (ctx: CapabilityContext, text: string) =>
  ctx.principal.flags.hide_outside_content
    ? "Booking"
    : fencedTitle(maskEmails(text), "booking_guest");

const when = (ctx: CapabilityContext, at: string | Date) =>
  both(at, ctx.timezone)!;

// --- get_bookings -----------------------------------------------------------

export const getBookings = defineCapability({
  name: "get_bookings",
  title: "Bookings",
  description:
    "Booking pages and bookings (view upcoming, needs_approval, past, cancelled or all; or one booking with its answers and history; slots_for: the times a booking could move to), with stats and open invites. Guests' names and answers are outside content; their email addresses are always masked.",
  input: z
    .object({
      view: z.enum(BOOKING_VIEWS).default("upcoming"),
      page: idField.optional(),
      booking: idField.optional(),
      slots_for: idField.optional(),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(5000).default(0),
    })
    .strict(),
  output: z.object({
    pages: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        active: z.boolean(),
        requires_approval: z.boolean(),
      }),
    ),
    bookings: z.array(
      z.object({
        id: z.string(),
        page: z.string().nullable(),
        guest: z.string(),
        status: z.string(),
        start: z.object({ at: z.string(), local: z.string() }),
        end: z.object({ at: z.string(), local: z.string() }),
        no_show: z.boolean(),
        note: z.string().nullable(),
      }),
    ),
    total: z.number(),
    detail: z
      .object({
        answers: z.array(
          z.object({ question: z.string(), answer: z.string() }),
        ),
        history: z.array(z.object({ at: z.string(), what: z.string() })),
        host_note: z.string(),
      })
      .nullable(),
    slots: z.array(
      z.object({ start: z.object({ at: z.string(), local: z.string() }) }),
    ),
    stats: z.object({
      upcoming: z.number(),
      needs_approval: z.number(),
      cancelled: z.number(),
      no_show: z.number(),
      last_30_days: z.number(),
    }),
    invites: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        expires: z.string(),
      }),
    ),
  }),
  annotations: READ,
  access: "read",
  toolset: "booking",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const me = ctx.principal.user.id;
    const actor = actorOf(ctx.principal);
    const pages = await reachablePages(ctx);
    if (a.page && !pages.has(a.page))
      throw new CapabilityError(
        "NOT_FOUND",
        "No booking page with that id is reachable from this connection.",
      );
    const found = await listBookings(ctx.db, me, {
      view: a.view,
      ...(a.page ? { page_id: a.page } : {}),
      limit: a.limit,
      offset: a.offset,
    });
    const allowed = (b: { page_id: string | null }) =>
      b.page_id ? pages.has(b.page_id) : ctx.principal.personal;
    const rows = found.rows.filter(allowed);
    const inReach = async (id: string) => {
      const row = (
        await ctx.db.query<{ page_id: string | null }>(
          "SELECT page_id FROM bookings WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (!row || !allowed(row))
        throw new CapabilityError(
          "NOT_FOUND",
          "No booking with that id is reachable from this connection.",
        );
    };
    let detail = null;
    if (a.booking) {
      await inReach(a.booking);
      const d = await bookingDetail(ctx.db, actor, a.booking);
      detail = {
        answers: d.questions
          .filter((q) => d.answers[q.id])
          .map((q) => ({
            question: cleanTitle(q.label),
            answer: ctx.principal.flags.hide_outside_content
              ? "[Hidden: text from a booking guest.]"
              : labelled(d.answers[q.id], "booking_guest"),
          })),
        history: d.events.map((e) => ({
          at: new Date(e.created_at).toISOString(),
          what: cleanTitle(e.detail || e.kind),
        })),
        host_note: labelled(d.host_note, "you"),
      };
    }
    let slots: { start: { at: string; local: string } }[] = [];
    if (a.slots_for) {
      await inReach(a.slots_for);
      const s = await bookingSlots(ctx.db, actor, a.slots_for, {
        timezone: ctx.timezone,
        days: 14,
      });
      slots = s.slots
        .slice(0, 50)
        .map((x) => ({ start: when(ctx, x.start_at) }));
    }
    const stats = await bookingStats(ctx.db, me, a.page ?? null);
    const invites = ctx.principal.personal
      ? (await listOpenInvites(ctx.db, me)).filter(
          (i) => i.status === "open" || i.status === "booked",
        )
      : [];
    const structured = {
      pages: [...pages.values()].map((p) => ({
        id: p.id,
        title: cleanTitle(p.title),
        active: p.active,
        requires_approval: p.requires_approval,
      })),
      bookings: rows.map((b) => ({
        id: b.id,
        page: b.page_title ? cleanTitle(b.page_title) : null,
        guest: guest(ctx, b.name),
        status: b.status,
        start: when(ctx, b.start_at),
        end: when(ctx, b.end_at),
        no_show: b.no_show,
        note:
          b.note && !ctx.principal.flags.hide_outside_content
            ? labelled(b.note, "booking_guest").slice(0, 1500)
            : null,
      })),
      total: found.total,
      detail,
      slots,
      stats: {
        upcoming: stats.upcoming,
        needs_approval: stats.needs_approval,
        cancelled: stats.cancelled,
        no_show: stats.no_show,
        last_30_days: stats.last_30_days,
      },
      invites: invites.map((i) => ({
        id: i.id,
        title: cleanTitle(i.title),
        status: i.status,
        expires: new Date(i.expires_at).toISOString(),
      })),
    };
    return {
      structured,
      markdown: [
        `${stats.upcoming} upcoming, ${stats.needs_approval} waiting for approval.`,
        ...structured.bookings.map(
          (b) =>
            `- ${b.start.local} ${b.guest} (${b.status}${b.page ? `, ${b.page}` : ""}) · ${b.id}`,
        ),
        ...(detail
          ? [
              "Answers:",
              ...detail.answers.map((x) => `- ${x.question}: ${x.answer}`),
            ]
          : []),
        ...(slots.length
          ? [
              "Could move to:",
              ...slots.slice(0, 20).map((s) => `- ${s.start.local}`),
            ]
          : []),
      ].join("\n"),
    };
  },
});

// --- booking_action ------------------------------------------------------------

const ACTIONS = [
  "no_show",
  "note",
  "approve",
  "decline",
  "cancel",
  "reschedule",
  "save_page",
  "delete_page",
  "create_invite",
  "withdraw_invite",
] as const;

export const bookingActionCapability = defineCapability({
  name: "booking_action",
  title: "Act on a booking",
  description:
    "Marks a no-show or keeps a private note on a booking (done at once). Approve, decline, cancel and reschedule email the guest, and saving or deleting a booking page or creating or withdrawing an open invite changes what outsiders can book, so these always go to the person's Review inbox.",
  input: z
    .object({
      action: z.enum(ACTIONS),
      booking: idField.optional(),
      no_show: z.boolean().optional(),
      note: z.string().max(4000).optional(),
      reason: z.string().trim().max(1000).optional(),
      start_at: isoTime
        .optional()
        .describe("For reschedule: a slot from get_bookings slots_for."),
      page: idField
        .optional()
        .describe("The booking page to change or delete."),
      invite: idField.optional(),
      fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("A page's or invite's fields, as the app saves them."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "booking",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    refuseSecrets(a.note, a.reason, JSON.stringify(a.fields ?? {}));
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const pages = await reachablePages(ctx);
    const need = <T>(v: T | undefined, what: string): T => {
      if (v === undefined)
        throw new CapabilityError("INVALID", `This action needs ${what}.`);
      return v;
    };
    const booking = async () => {
      const id = need(a.booking, "a booking");
      const row = (
        await db.query<{
          page_id: string | null;
          name: string;
          start_at: Date;
          status: string;
        }>(
          "SELECT page_id, name, start_at, status FROM bookings WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (
        !row ||
        (row.page_id ? !pages.has(row.page_id) : !ctx.principal.personal)
      )
        throw new CapabilityError(
          "NOT_FOUND",
          "No booking with that id is reachable from this connection.",
        );
      return { id, ...row };
    };
    const teamOf = (pageId: string | null) =>
      pageId ? (pages.get(pageId)?.team_id ?? null) : null;
    if (a.action === "no_show" || a.action === "note") {
      const b = await booking();
      if (destination(ctx, teamOf(b.page_id), "W2") === "review")
        throw new CapabilityError(
          "FORBIDDEN",
          "This connection can only suggest changes there.",
        );
      if (a.action === "no_show")
        await setNoShow(db, actor, b.id, need(a.no_show, "no_show"));
      else await setHostNote(db, actor, b.id, need(a.note, "a note"));
      return finishWrite(ctx, "A booking", {
        done: [
          {
            id: `booking:${b.id}`,
            title: `Booking ${when(ctx, b.start_at).local}`,
            url: `${appUrl()}/app`,
            version: null,
            change:
              a.action === "no_show"
                ? a.no_show
                  ? "Marked as a no-show"
                  : "No-show cleared"
                : "Note kept",
          },
        ],
      });
    }
    // Everything else waits for the person.
    const change = await (async () => {
      switch (a.action) {
        case "approve":
        case "decline":
        case "cancel":
        case "reschedule": {
          const b = await booking();
          destination(ctx, teamOf(b.page_id), "W3");
          const label = `the booking ${when(ctx, b.start_at).local}`;
          const verb = {
            approve: "Approve",
            decline: "Decline",
            cancel: "Cancel",
            reschedule: "Move",
          }[a.action];
          return actionChange({
            action: `booking.${a.action}`,
            target_id: b.id,
            title: `Booking ${when(ctx, b.start_at).local}`,
            team_id: teamOf(b.page_id),
            headline: `${verb} ${label} (the guest is emailed)`,
            rows: [
              ...(a.action === "reschedule"
                ? [
                    {
                      label: "When",
                      before: when(ctx, b.start_at).local,
                      after: when(ctx, need(a.start_at, "start_at")).local,
                    },
                  ]
                : []),
              ...(a.reason
                ? [{ label: "Reason", before: null, after: a.reason }]
                : []),
            ],
            input: {
              id: b.id,
              ...(a.action === "reschedule"
                ? { start_at: need(a.start_at, "start_at") }
                : {}),
              ...(a.action === "decline" || a.action === "cancel"
                ? { reason: a.reason ?? "" }
                : {}),
            },
          });
        }
        case "save_page": {
          const id = a.page ?? null;
          if (id && !pages.has(id))
            throw new CapabilityError(
              "NOT_FOUND",
              "No booking page with that id is reachable from this connection.",
            );
          const current = id ? pages.get(id)! : null;
          const fields = need(a.fields, "fields");
          destination(
            ctx,
            current?.team_id ??
              (fields.team_id as string | null | undefined) ??
              null,
            "W3",
          );
          const title = String(
            fields.title ?? current?.title ?? "Booking page",
          );
          return actionChange({
            action: "booking_page.save",
            target_id: id,
            title,
            team_id: current?.team_id ?? null,
            headline: id
              ? `Change the booking page ${quoted(title)}`
              : `New booking page ${quoted(title)}`,
            rows: Object.entries(fields)
              .slice(0, 20)
              .map(([k, v]) => ({
                label: k.replace(/_/g, " "),
                before: null,
                after: typeof v === "string" ? v : JSON.stringify(v),
              })),
            input: { id, page: fields },
          });
        }
        case "delete_page": {
          const id = need(a.page, "a page");
          const current = pages.get(id);
          if (!current)
            throw new CapabilityError(
              "NOT_FOUND",
              "No booking page with that id is reachable from this connection.",
            );
          destination(ctx, current.team_id ?? null, "W3");
          return actionChange({
            action: "booking_page.delete",
            target_id: id,
            title: current.title,
            team_id: current.team_id ?? null,
            headline: `Delete the booking page ${quoted(current.title)}`,
            input: { id },
          });
        }
        case "create_invite": {
          destination(ctx, null, "W3");
          const fields = need(a.fields, "fields");
          const title = String(fields.title ?? "Open invite");
          return actionChange({
            action: "invite.create",
            target_id: null,
            title,
            team_id: null,
            headline: `New open invite ${quoted(title)} (a link anyone who has it can book)`,
            rows: Object.entries(fields)
              .slice(0, 20)
              .map(([k, v]) => ({
                label: k.replace(/_/g, " "),
                before: null,
                after: typeof v === "string" ? v : JSON.stringify(v),
              })),
            input: fields,
          });
        }
        case "withdraw_invite": {
          destination(ctx, null, "W3");
          const invite = await openInviteOf(
            db,
            ctx.principal.user.id,
            need(a.invite, "an invite"),
          ).catch(() => {
            throw new CapabilityError(
              "NOT_FOUND",
              "No open invite with that id is yours.",
            );
          });
          return actionChange({
            action: "invite.withdraw",
            target_id: invite.id,
            title: invite.title,
            team_id: null,
            headline: `Withdraw the open invite ${quoted(invite.title)}${invite.booking ? " (its booking is cancelled and the guest emailed)" : ""}`,
            input: { id: invite.id },
          });
        }
        default:
          throw new CapabilityError("INVALID", "Unknown action.");
      }
    })();
    return finishWrite(ctx, "Bookings", { done: [], review: [change] });
  },
});

import { z } from "zod";
import {
  askReplyInput,
  askSettleInput,
  bookingPageInput,
  bookingPageUpdate,
  docReviewInput,
  fail,
  openInviteInput,
  projectUpdate,
  REVIEW_DELETABLE,
  workRecordInput,
  type ReviewAction,
  type ReviewChange,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { replyToAsk, settleAsk } from "../followthrough/asks.js";
import { reviewDoc } from "../followthrough/memory.js";
import { deleteProof, proofItem } from "../followthrough/proof.js";
import { createRecord, respondToRecord } from "../work-records/service.js";
import { decideSuggestion, deleteComment } from "../docs/comments.js";
import { removeProjectLink, updateProject } from "../projects/service.js";
import {
  bookingAction,
  createBookingPage,
  deleteBookingPage,
  updateBookingPage,
} from "../booking/manage.js";
import { createOpenInvite, withdrawOpenInvite } from "../booking/invites.js";
import { importData } from "../organize/portability.js";
import { deleteFolder, deleteList, deleteTag } from "../organize/service.js";
import { deleteView } from "../views/service.js";
import { deleteTemplate } from "../templates/service.js";
import { deletePageTemplate } from "../templates/pages.js";
import {
  deleteFrame,
  deleteHabit,
  deleteHabitBlock,
  deletePlace,
} from "../planner/routines.js";
import { loadTemplate, proposeFromTemplate } from "../templates/service.js";
import { applyProject } from "../ai/project-proposal.js";

/**
 * Changes of type "action" in the Review inbox: each runs its own service
 * when a person approves it, as that person, so their role and the
 * target's state are checked again then. `input` was checked when the
 * change was proposed and is checked again here; `stale` says why it can't
 * be applied as proposed any more (the target moved on or went).
 */

type ActionChange = Extract<ReviewChange, { type: "action" }>;

type Handler = {
  input: z.ZodType;
  stale?: (
    db: Queryable,
    userId: string,
    input: Record<string, unknown>,
    c: ActionChange,
  ) => Promise<string | null>;
  apply: (db: Db, u: UserRow, input: never, c: ActionChange) => Promise<void>;
};

const idOf = z.object({ id: z.uuid() });

async function askStatus(db: Queryable, id: string) {
  return (
    await db.query<{ status: string }>(
      "SELECT status FROM task_asks WHERE id = $1",
      [id],
    )
  ).rows[0]?.status;
}

async function bookingStatus(db: Queryable, id: string) {
  return (
    await db.query<{ status: string; start_at: Date }>(
      "SELECT status, start_at FROM bookings WHERE id = $1",
      [id],
    )
  ).rows[0];
}

/** A booking that was waiting (or confirmed) when proposed, still so. */
const bookingStale =
  (want: string[]) =>
  async (db: Queryable, _u: string, input: Record<string, unknown>) => {
    const b = await bookingStatus(db, String(input.id));
    if (!b) return "That booking is gone.";
    if (!want.includes(b.status))
      return "That booking changed since this was suggested.";
    return null;
  };

const deleteInput = z.object({
  kind: z.enum(REVIEW_DELETABLE),
  id: z.uuid(),
  /** The page a comment is on, the task a proof is on, the project a link is on. */
  parent_id: z.uuid().nullable().default(null),
});

const TABLE: Record<(typeof REVIEW_DELETABLE)[number], string> = {
  list: "lists",
  tag: "tags",
  folder: "folders",
  view: "saved_views",
  template: "project_templates",
  page_template: "page_templates",
  frame: "frames",
  habit: "habits",
  place: "places",
  comment: "doc_comments",
  proof: "item_proofs",
  project_link: "project_links",
  habit_session: "habit_blocks",
};

export const ACTIONS: Record<ReviewAction, Handler> = {
  "ask.reply": {
    input: idOf.extend({ reply: askReplyInput }),
    async stale(db, _u, input) {
      const status = await askStatus(db, String(input.id));
      return status === "open" ? null : "That ask was already answered.";
    },
    async apply(
      db,
      u,
      input: { id: string; reply: z.input<typeof askReplyInput> },
    ) {
      await replyToAsk(db, u as never, input.id, input.reply);
    },
  },
  "ask.settle": {
    input: idOf.extend({ settle: askSettleInput }),
    async stale(db, _u, input) {
      const status = await askStatus(db, String(input.id));
      return status === "open" || status === "countered"
        ? null
        : "That ask was already settled.";
    },
    async apply(
      db,
      u,
      input: { id: string; settle: z.input<typeof askSettleInput> },
    ) {
      await settleAsk(db, u as never, input.id, input.settle);
    },
  },
  "record.create": {
    input: workRecordInput,
    async apply(db, u, input: z.input<typeof workRecordInput>) {
      await createRecord(db, u, input);
    },
  },
  "record.respond": {
    input: idOf.extend({ decision: z.enum(["accept", "decline"]) }),
    async stale(db, _u, input) {
      const row = (
        await db.query<{ status: string }>(
          "SELECT status FROM work_records WHERE id = $1",
          [String(input.id)],
        )
      ).rows[0];
      return row?.status === "proposed"
        ? null
        : "That promise was already answered.";
    },
    async apply(db, u, input: { id: string; decision: "accept" | "decline" }) {
      await respondToRecord(db, u, input.id, input.decision);
    },
  },
  "suggestions.resolve": {
    input: idOf.extend({
      take: z.array(z.uuid()).max(100).default([]),
      leave: z.array(z.uuid()).max(100).default([]),
    }),
    async stale(db, _u, input) {
      const ids = [
        ...((input.take as string[]) ?? []),
        ...((input.leave as string[]) ?? []),
      ];
      const open = (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM doc_suggestions
            WHERE doc_id = $1 AND id = ANY ($2::uuid[]) AND status = 'open'`,
          [String(input.id), ids],
        )
      ).rows[0].n;
      return open === ids.length
        ? null
        : "Some of those suggestions were already decided.";
    },
    async apply(db, u, input: { id: string; take: string[]; leave: string[] }) {
      for (const sid of input.take)
        await decideSuggestion(db, u, input.id, sid, true);
      for (const sid of input.leave)
        await decideSuggestion(db, u, input.id, sid, false);
    },
  },
  "project.update": {
    input: idOf.extend({ patch: projectUpdate }),
    async stale(db, _u, input, c) {
      const row = (
        await db.query<{ updated_at: Date }>(
          "SELECT updated_at FROM projects WHERE id = $1",
          [String(input.id)],
        )
      ).rows[0];
      if (!row) return "The project is gone.";
      if (
        c.version !== null &&
        Math.floor(row.updated_at.getTime() / 1000) !== c.version
      )
        return "The project changed since this was suggested.";
      return null;
    },
    async apply(
      db,
      u,
      input: { id: string; patch: z.input<typeof projectUpdate> },
    ) {
      await updateProject(db, u, input.id, projectUpdate.parse(input.patch));
    },
  },
  "doc.review": {
    input: idOf.extend({ review: docReviewInput }),
    async apply(
      db,
      u,
      input: { id: string; review: z.input<typeof docReviewInput> },
    ) {
      await reviewDoc(db, u, input.id, input.review);
    },
  },
  "booking.approve": {
    input: idOf,
    stale: bookingStale(["awaiting_approval"]),
    async apply(db, u, input: { id: string }) {
      await bookingAction(db, u, input.id, { action: "approve" });
    },
  },
  "booking.decline": {
    input: idOf.extend({ reason: z.string().max(1000).default("") }),
    stale: bookingStale(["awaiting_approval"]),
    async apply(db, u, input: { id: string; reason: string }) {
      await bookingAction(db, u, input.id, {
        action: "decline",
        reason: input.reason,
      });
    },
  },
  "booking.cancel": {
    input: idOf.extend({ reason: z.string().max(1000).default("") }),
    stale: bookingStale(["confirmed", "pending", "awaiting_approval"]),
    async apply(db, u, input: { id: string; reason: string }) {
      await bookingAction(db, u, input.id, {
        action: "cancel",
        reason: input.reason,
      });
    },
  },
  "booking.reschedule": {
    input: idOf.extend({ start_at: z.iso.datetime({ offset: true }) }),
    stale: bookingStale(["confirmed"]),
    async apply(db, u, input: { id: string; start_at: string }) {
      await bookingAction(db, u, input.id, {
        action: "reschedule",
        start_at: input.start_at,
      });
    },
  },
  "booking_page.save": {
    input: z.object({
      id: z.uuid().nullable(),
      page: z.record(z.string(), z.unknown()),
    }),
    async stale(db, _u, input) {
      if (!input.id) return null;
      const found = (
        await db.query("SELECT 1 FROM booking_pages WHERE id = $1", [
          String(input.id),
        ])
      ).rowCount;
      return found ? null : "That booking page is gone.";
    },
    async apply(
      db,
      u,
      input: { id: string | null; page: Record<string, unknown> },
    ) {
      if (input.id)
        await updateBookingPage(
          db,
          u,
          input.id,
          bookingPageUpdate.parse(input.page),
        );
      else await createBookingPage(db, u, bookingPageInput.parse(input.page));
    },
  },
  "booking_page.delete": {
    input: idOf,
    async apply(db, u, input: { id: string }) {
      await deleteBookingPage(db, u, input.id);
    },
  },
  "invite.create": {
    input: openInviteInput,
    async apply(db, u, input: z.input<typeof openInviteInput>) {
      await createOpenInvite(db, u, input);
    },
  },
  "invite.withdraw": {
    input: idOf,
    async stale(db, _u, input) {
      const row = (
        await db.query<{ status: string }>(
          "SELECT status FROM open_invites WHERE id = $1",
          [String(input.id)],
        )
      ).rows[0];
      if (!row) return "That invite is gone.";
      return row.status === "open" || row.status === "booked"
        ? null
        : "That invite isn't open any more.";
    },
    async apply(db, u, input: { id: string }) {
      await withdrawOpenInvite(db, u, input.id);
    },
  },
  "template.use": {
    input: z.object({
      id: z.uuid(),
      title: z.string().max(120).optional(),
      team_id: z.uuid().nullable().default(null),
    }),
    async stale(db, userId, input) {
      const found = (
        await db.query("SELECT 1 FROM project_templates WHERE id = $1", [
          String(input.id),
        ])
      ).rowCount;
      return found ? null : "That template is gone.";
    },
    async apply(
      db,
      u,
      input: { id: string; title?: string; team_id: string | null },
    ) {
      // The app's own path, worked out now: the project and its tasks,
      // scheduled from the calendar as it is at approval.
      const template = await loadTemplate(db, u, input.id);
      const proposal = await proposeFromTemplate(db, u, template as never, {
        ...(input.title ? { title: input.title } : {}),
        team_id: input.team_id,
      });
      const stored = (
        await db.query<{ project: Record<string, unknown> }>(
          "SELECT project FROM proposals WHERE id = $1",
          [proposal.id],
        )
      ).rows[0].project;
      const made = await applyProject(db, u, stored as never);
      // The draft it went through is settled with it, so it never waits in
      // the inbox on its own.
      await db.query(
        `UPDATE proposals SET status = 'applied', applied = true, decided_at = now(),
           applied_project_id = $2 WHERE id = $1`,
        [proposal.id, made.project_id],
      );
    },
  },
  "tasks.import": {
    input: z.object({
      format: z.enum(["orbyn", "csv"]),
      data: z.string().max(200_000),
    }),
    async apply(db, u, input: { format: "orbyn" | "csv"; data: string }) {
      const summary = await importData(db, u, input.format, input.data, false);
      if (!summary.created && summary.errors.length)
        fail(422, summary.errors[0]);
    },
  },
  delete: {
    input: deleteInput,
    async stale(db, _u, input) {
      const table = TABLE[input.kind as keyof typeof TABLE];
      const found = (
        await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [
          String(input.id),
        ])
      ).rowCount;
      return found ? null : "It's already gone.";
    },
    async apply(db, u, input: z.output<typeof deleteInput>) {
      const parent = () => {
        if (!input.parent_id) fail(422, "The change is missing what it's on.");
        return input.parent_id!;
      };
      switch (input.kind) {
        case "list":
          return deleteList(db, u, input.id);
        case "tag":
          return deleteTag(db, u, input.id);
        case "folder":
          return deleteFolder(db, u, input.id);
        case "view":
          await deleteView(db, u, input.id);
          return;
        case "template":
          return deleteTemplate(db, u, input.id);
        case "page_template":
          return deletePageTemplate(db, u, input.id);
        case "frame":
          return deleteFrame(db, u.id, input.id);
        case "habit":
          return deleteHabit(db, u.id, input.id);
        case "place":
          return deletePlace(db, u.id, input.id);
        case "comment":
          return deleteComment(db, u, parent(), input.id);
        case "proof": {
          await proofItem(db, u, parent(), "items:write");
          return deleteProof(db, parent(), input.id);
        }
        case "project_link":
          return removeProjectLink(db, u, parent(), input.id);
        case "habit_session":
          return deleteHabitBlock(db, u.id, input.id);
      }
    },
  },
};

/** Why an action change can't be applied as proposed, or null. */
export async function actionStaleness(
  db: Queryable,
  userId: string,
  c: ActionChange,
): Promise<string | null> {
  const handler = ACTIONS[c.action];
  const parsed = handler.input.safeParse(c.input);
  if (!parsed.success) return "This change can't be read any more.";
  return handler.stale
    ? handler.stale(db, userId, parsed.data as Record<string, unknown>, c)
    : null;
}

/** Apply an action change as `u`, through its own service. */
export async function applyAction(db: Db, u: UserRow, c: ActionChange) {
  const handler = ACTIONS[c.action];
  const input = handler.input.parse(c.input);
  await handler.apply(db, u, input as never, c);
}

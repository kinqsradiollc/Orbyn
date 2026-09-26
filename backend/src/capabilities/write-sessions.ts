import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  planPreviewInput,
  type PlanMove,
  type ReviewChangeInput,
} from "@orbyn/core";
import { derivedKey } from "../lib/secrets.js";
import {
  moveSession,
  placeSessions,
  removeSession,
} from "../modules/planner/blocks.js";
import {
  computePlan,
  describePlan,
  fingerprint,
  workingFree,
} from "../modules/planner/plans.js";
import { cleanTitle, localTime } from "./format.js";
import { minutesText, projectId, uuidOf } from "./common.js";
import { READ } from "./common.js";
import { refUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import type { UndoOp } from "./undo.js";
import {
  ADDS,
  EDITS,
  MAX_BATCH,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  isoTime,
  idField,
  writeOutput,
  type DoneEntry,
} from "./write.js";
import { visibleItem } from "./write-tasks.js";

/**
 * Sessions (time set aside for a task): previewing a plan without touching
 * the calendar (plan_schedule), putting sessions on it (schedule_sessions)
 * and moving or removing them (reschedule_sessions). Sessions are always
 * the person's own and never email anyone; they go through the planner's
 * one write path (planner/blocks.ts), with the same checks as the app.
 */

/** A plan_token lasts this long, and works once. */
export const PLAN_TOKEN_MINUTES = 10;
/** More sessions than this at once go to review. */
export const DIRECT_SESSIONS = 20;

type Sealed = {
  /** The person and the connection it was made for. */
  u: string;
  g: string | null;
  /** The preview's inputs, and when it was worked out. */
  s: z.input<typeof planPreviewInput> & { project_id?: string };
  n: string;
  /** What the plan was made from, and what it placed. */
  f: string;
  d: string;
  /** Expiry (ms since the epoch). */
  x: number;
};

let planKey: Promise<Buffer> | null = null;
const key = () => (planKey ??= derivedKey("mcp-plan-token"));

const mac = async (body: string) =>
  createHmac("sha256", await key())
    .update(body)
    .digest("base64url");

/** What a plan places and moves, as one digest. */
function digestOf(
  blocks: { item_id: string; start_at: string; end_at: string }[],
  moves: PlanMove[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        blocks.map((b) => [b.item_id, b.start_at, b.end_at]),
        moves.map((m) => [m.block_id, m.start_at, m.end_at]),
      ]),
    )
    .digest("base64url");
}

/**
 * A short handle for a previewed plan, signed with a key derived from
 * Orbyn's secrets and bound to the person and the connection. It holds the
 * preview's inputs and digests, never the sessions themselves: applying it
 * works the plan out again and refuses it if anything came out different.
 */
export async function sealPlan(sealed: Sealed): Promise<string> {
  const body = Buffer.from(JSON.stringify(sealed)).toString("base64url");
  return `pt1.${body}.${await mac(body)}`;
}

/** The plan a token holds, when it is this connection's and still fresh. */
export async function openPlan(
  ctx: CapabilityContext,
  token: string,
): Promise<Sealed> {
  const bad = () =>
    new CapabilityError(
      "INVALID",
      "That plan_token isn't valid for this connection.",
      "Call plan_schedule again and use the plan_token it returns.",
    );
  const m = /^pt1\.([\w-]{10,6000})\.([\w-]{43})$/.exec(token.trim());
  if (!m) throw bad();
  const want = Buffer.from(await mac(m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
  const sealed = JSON.parse(
    Buffer.from(m[1], "base64url").toString(),
  ) as Sealed;
  const p = ctx.principal;
  if (sealed.u !== p.user.id || sealed.g !== p.grant_id) throw bad();
  if (sealed.x <= ctx.now.getTime())
    throw new CapabilityError(
      "STALE",
      "That plan expired.",
      "Call plan_schedule again for a fresh plan.",
    );
  return sealed;
}

const sessionOut = z.object({
  task: z.string(),
  title: z.string(),
  start_at: z.string(),
  end_at: z.string(),
  local: z.string(),
  part: z.string().nullable(),
});

// --- plan_schedule -----------------------------------------------------

export const planSchedule = defineCapability({
  name: "plan_schedule",
  title: "Preview a plan",
  description:
    "Previews sessions for open tasks over up to 14 days (working hours, frames, learned durations, the calendar) without changing anything: sessions, tasks that didn't fit and why, sessions that could move before a deadline, and a plan_token (10 minutes, once) for schedule_sessions.",
  input: z
    .object({
      days: z.number().int().min(1).max(14).optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("First day (YYYY-MM-DD, the person's time zone)."),
      tasks: z
        .array(z.string().trim().min(1).max(300))
        .max(100)
        .optional()
        .describe("Only plan these tasks."),
      project: z.string().trim().max(300).optional(),
    })
    .strict(),
  output: z.object({
    summary: z.string(),
    sessions: z.array(sessionOut),
    moves: z.array(
      z.object({
        session: z.string(),
        task: z.string(),
        title: z.string(),
        from_start_at: z.string(),
        start_at: z.string(),
        end_at: z.string(),
      }),
    ),
    unplaced: z.array(
      z.object({ task: z.string(), title: z.string(), reason: z.string() }),
    ),
    at_risk: z.array(
      z.object({ task: z.string(), title: z.string(), reason: z.string() }),
    ),
    planned_minutes: z.number(),
    free_minutes: z.number(),
    plan_token: z.string(),
    expires_at: z.string(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const p = ctx.principal;
    if (!p.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "Plans are made on the person's own calendar, which this connection can't reach.",
      );
    const input = {
      ...(a.days ? { days: a.days } : {}),
      ...(a.start_date ? { start_date: a.start_date } : {}),
      ...(a.tasks ? { item_ids: a.tasks.map((t) => uuidOf(t, "tasks")) } : {}),
      timezone: ctx.timezone,
    };
    const project = a.project ? projectId(a.project) : undefined;
    const state = {
      ...planPreviewInput.parse(input),
      ...(project ? { project_id: project } : {}),
    };
    const plan = await computePlan(dbOf(ctx), p.user.id, state, ctx.now);
    // Only what this connection can see: a plan may place team tasks, and
    // a connection without that team never hears of them.
    const reach = new Set<string | null>([null, ...(ctx.spaces.teamIds ?? [])]);
    const allowed = new Set(
      plan.tasks.filter((t) => reach.has(t.team_id ?? null)).map((t) => t.id),
    );
    const moves = (plan.result.moves ?? []) as PlanMove[];
    const sessions = plan.result.blocks.filter((b) => allowed.has(b.item_id));
    const expires = ctx.now.getTime() + PLAN_TOKEN_MINUTES * 60_000;
    const token = await sealPlan({
      u: p.user.id,
      g: p.grant_id,
      s: { ...input, ...(project ? { project_id: project } : {}) },
      n: ctx.now.toISOString(),
      f: fingerprint(plan.inputs),
      d: digestOf(plan.result.blocks, moves),
      x: expires,
    });
    const tz = ctx.timezone;
    const structured = {
      summary: describePlan(plan.result, plan.days),
      sessions: sessions.map((b) => ({
        task: `task:${b.item_id}`,
        title: cleanTitle(b.title),
        start_at: b.start_at,
        end_at: b.end_at,
        local: `${localTime(new Date(b.start_at), tz)}–${localTime(new Date(b.end_at), tz).slice(-5)}`,
        part: b.parts > 1 ? `${b.part} of ${b.parts}` : null,
      })),
      moves: moves
        .filter((m) => allowed.has(m.item_id))
        .map((m) => ({
          session: m.block_id,
          task: `task:${m.item_id}`,
          title: cleanTitle(m.title),
          from_start_at: m.from_start_at,
          start_at: m.start_at,
          end_at: m.end_at,
        })),
      unplaced: plan.result.unplaced
        .filter((u) => allowed.has(u.item_id))
        .map((u) => ({
          task: `task:${u.item_id}`,
          title: cleanTitle(u.title),
          reason: u.reason,
        })),
      at_risk: plan.result.at_risk
        .filter((u) => allowed.has(u.item_id))
        .map((u) => ({
          task: `task:${u.item_id}`,
          title: cleanTitle(u.title),
          reason: u.reason,
        })),
      planned_minutes: plan.result.planned_minutes,
      free_minutes: plan.result.capacity_minutes,
      plan_token: token,
      expires_at: new Date(expires).toISOString(),
    };
    const markdown = [
      structured.summary,
      ...structured.sessions
        .slice(0, 60)
        .map(
          (s) =>
            `- ${s.local} · ${s.title}${s.part ? ` (${s.part})` : ""} · ${s.task}`,
        ),
      ...structured.unplaced.map(
        (u) => `- Didn't fit: ${u.title} (${u.reason})`,
      ),
      "",
      `Nothing is on the calendar yet. To keep this plan, call schedule_sessions with plan_token (valid ${PLAN_TOKEN_MINUTES} minutes). Free working time: ${minutesText(structured.free_minutes)}.`,
    ].join("\n");
    return { structured, markdown };
  },
});

// --- schedule_sessions -------------------------------------------------

/** Sessions as the answers list them. */
const sessionEntry = (
  b: { id: string; item_id: string; title?: string; start_at: string },
  tz: string,
  change: string,
): DoneEntry => ({
  id: `task:${b.item_id}`,
  title: `${cleanTitle(b.title ?? "") || "Session"} · ${localTime(new Date(b.start_at), tz)}`,
  url: refUrl({ type: "task", id: b.item_id }),
  version: null,
  change: `${change} (session ${b.id})`,
});

export const scheduleSessions = defineCapability({
  name: "schedule_sessions",
  title: "Put sessions on the calendar",
  description:
    "Adds sessions to the person's calendar: a plan_token's plan, or sessions given (task, start, end). Clashing sessions or closed tasks are skipped; a plan whose calendar changed is refused as STALE. Up to 20 of the person's own sessions go directly; more, or team tasks, go to review.",
  input: z
    .object({
      plan_token: z.string().trim().max(8000).optional(),
      sessions: z
        .array(
          z
            .object({
              task: z.string().trim().min(1).max(300),
              start_at: isoTime,
              end_at: isoTime,
            })
            .strict(),
        )
        .max(50)
        .optional(),
      client_ref: clientRefInput,
    })
    .strict()
    .refine((a) => !!a.plan_token !== !!a.sessions?.length, {
      message: "Give either plan_token or sessions.",
    }),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    const p = ctx.principal;
    const db = dbOf(ctx);
    let blocks: {
      item_id: string;
      start_at: string;
      end_at: string;
      title: string;
    }[];
    let moves: PlanMove[] = [];
    if (a.plan_token) {
      const sealed = await openPlan(ctx, a.plan_token);
      const used = await db.query(
        `INSERT INTO mcp_request_state (id, grant_id, kind, value, expires_at, used_at)
         VALUES ($1, $2, 'plan_token', NULL, to_timestamp($3::double precision / 1000), now())
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          `plan:${createHash("sha256").update(a.plan_token).digest("base64url")}`,
          p.grant_id,
          sealed.x,
        ],
      );
      if (!used.rowCount)
        throw new CapabilityError(
          "STALE",
          "That plan was already put on the calendar.",
          "Call plan_schedule again for a new plan.",
        );
      const state = {
        ...planPreviewInput.parse(sealed.s),
        ...(sealed.s.project_id ? { project_id: sealed.s.project_id } : {}),
      };
      const again = await computePlan(db, p.user.id, state, new Date(sealed.n));
      const againMoves = (again.result.moves ?? []) as PlanMove[];
      if (
        fingerprint(again.inputs) !== sealed.f ||
        digestOf(again.result.blocks, againMoves) !== sealed.d
      )
        throw new CapabilityError(
          "STALE",
          "The calendar or the tasks changed since this plan was made.",
          "Call plan_schedule again and schedule the new plan.",
        );
      blocks = again.result.blocks;
      moves = againMoves;
    } else {
      blocks = [];
      for (const s of a.sessions!) {
        if (Date.parse(s.end_at) <= Date.parse(s.start_at))
          throw new CapabilityError(
            "INVALID",
            "A session must end after it starts.",
          );
        const item = await visibleItem(ctx, s.task);
        if (item.kind !== "task")
          throw new CapabilityError(
            "INVALID",
            "Only tasks have sessions; events are already on the calendar.",
          );
        blocks.push({
          item_id: item.id,
          start_at: new Date(s.start_at).toISOString(),
          end_at: new Date(s.end_at).toISOString(),
          title: item.title,
        });
      }
    }
    if (!blocks.length && !moves.length)
      return finishWrite(ctx, "Scheduling", { done: [] });
    const teams = (
      await db.query<{ id: string; team_id: string | null }>(
        "SELECT id, team_id FROM items WHERE id = ANY($1::uuid[])",
        [[...blocks, ...moves].map((b) => b.item_id)],
      )
    ).rows;
    const teamTasks = teams.some((t) => t.team_id);
    for (const t of teams) destination(ctx, t.team_id, "W1");
    const where = destination(ctx, null, "W1");
    const count = blocks.length + moves.length;
    if (where === "review" || teamTasks || count > DIRECT_SESSIONS) {
      if (count > 50)
        throw new CapabilityError(
          "INVALID",
          `That's ${count} sessions; a review holds at most 50.`,
          "Plan fewer days or tasks at a time.",
        );
      const review: ReviewChangeInput[] = [
        ...blocks.map((b): ReviewChangeInput => ({
          type: "session.add",
          item_id: b.item_id,
          title: b.title,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
        ...moves.map((m): ReviewChangeInput => ({
          type: "session.move",
          block_id: m.block_id,
          item_id: m.item_id,
          title: m.title,
          from_start_at: m.from_start_at,
          from_end_at: m.from_end_at,
          start_at: m.start_at,
          end_at: m.end_at,
        })),
      ];
      return finishWrite(ctx, "Scheduling", {
        done: [],
        review,
        reviewSummary: `Plan ${count} session${count === 1 ? "" : "s"}`,
      });
    }
    const applied = await placeSessions(db, p.user.id, null, blocks, moves);
    const undo: UndoOp[] = [
      ...applied.blocks.map((b): UndoOp => ({
        op: "block.delete",
        id: b.id,
        start_at: b.start_at,
        end_at: b.end_at,
      })),
      ...applied.moved.map((b): UndoOp => {
        const m = moves.find((x) => x.block_id === b.id)!;
        return {
          op: "block.move",
          id: b.id,
          start_at: m.from_start_at,
          end_at: m.from_end_at,
          to_start_at: b.start_at,
          to_end_at: b.end_at,
        };
      }),
    ];
    const skipped = applied.skipped + applied.moves_skipped;
    return finishWrite(ctx, "Scheduling", {
      done: [
        ...applied.blocks.map((b) => sessionEntry(b, ctx.timezone, "Planned")),
        ...applied.moved.map((b) => sessionEntry(b, ctx.timezone, "Moved")),
      ],
      skipped: skipped
        ? [
            {
              index: 0,
              reason: `${skipped} session${skipped === 1 ? "" : "s"} left out: the time is taken now, or the task is closed.`,
            },
          ]
        : [],
      undo,
    });
  },
});

// --- reschedule_sessions -----------------------------------------------

export const rescheduleSessions = defineCapability({
  name: "reschedule_sessions",
  title: "Move or remove sessions",
  description:
    "Moves sessions, pushes them to the next free working slot, or removes them (ids from get_calendar or fetch). Undo puts them back.",
  input: z
    .object({
      changes: z
        .array(
          z
            .object({
              session: idField,
              action: z.enum(["move", "next_free", "remove"]),
              start_at: isoTime.optional(),
              end_at: isoTime.optional(),
            })
            .strict()
            .refine((c) => c.action !== "move" || (c.start_at && c.end_at), {
              message: "A move needs start_at and end_at.",
            }),
        )
        .min(1)
        .max(MAX_BATCH),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const p = ctx.principal;
    const db = dbOf(ctx);
    const where = destination(ctx, null, "W2");
    const done: DoneEntry[] = [];
    const review: ReviewChangeInput[] = [];
    const undo: UndoOp[] = [];
    for (const c of a.changes) {
      const b = (
        await db.query<{
          id: string;
          item_id: string;
          start_at: Date;
          end_at: Date;
          source: string;
          plan_id: string | null;
          title: string;
          team_id: string | null;
        }>(
          `SELECT b.id, b.item_id, b.start_at, b.end_at, b.source, b.plan_id,
                  i.title, i.team_id
             FROM time_blocks b JOIN items i ON i.id = b.item_id
            WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`,
          [c.session, p.user.id],
        )
      ).rows[0];
      if (!b || (b.team_id && !(ctx.spaces.teamIds ?? []).includes(b.team_id)))
        throw new CapabilityError(
          "NOT_FOUND",
          "That session isn't on the person's calendar.",
          "Use a session id from get_calendar or get_today.",
        );
      const from = {
        start: b.start_at.toISOString(),
        end: b.end_at.toISOString(),
      };
      let to: { start_at: string; end_at: string } | null = null;
      if (c.action === "move") {
        if (Date.parse(c.end_at!) <= Date.parse(c.start_at!))
          throw new CapabilityError(
            "INVALID",
            "A session must end after it starts.",
          );
        to = {
          start_at: new Date(c.start_at!).toISOString(),
          end_at: new Date(c.end_at!).toISOString(),
        };
      } else if (c.action === "next_free") {
        const minutes = Math.round(
          (b.end_at.getTime() - b.start_at.getTime()) / 60_000,
        );
        const slot = await workingFree(
          db,
          p.user.id,
          minutes,
          [b.id],
          ctx.now,
          b.end_at,
        );
        if (!slot)
          throw new CapabilityError(
            "INVALID",
            `No free working slot of ${minutesText(minutes)} in the coming week for “${cleanTitle(b.title)}”.`,
            "Move it to a time you choose, or remove it.",
          );
        to = slot;
      }
      if (where === "review") {
        review.push(
          to
            ? {
                type: "session.move",
                block_id: b.id,
                item_id: b.item_id,
                title: b.title,
                from_start_at: from.start,
                from_end_at: from.end,
                start_at: to.start_at,
                end_at: to.end_at,
              }
            : {
                type: "session.remove",
                block_id: b.id,
                item_id: b.item_id,
                title: b.title,
                from_start_at: from.start,
                from_end_at: from.end,
              },
        );
        continue;
      }
      if (to) {
        const moved = await moveSession(
          db,
          p.user.id,
          b.id,
          to.start_at,
          to.end_at,
        );
        undo.push({
          op: "block.move",
          id: b.id,
          start_at: from.start,
          end_at: from.end,
          to_start_at: moved.start_at,
          to_end_at: moved.end_at,
        });
        done.push(
          sessionEntry({ ...moved, title: b.title }, ctx.timezone, "Moved"),
        );
      } else {
        await removeSession(db, p.user.id, b.id);
        undo.push({
          op: "blocks.restore",
          blocks: [
            {
              id: b.id,
              item_id: b.item_id,
              start_at: from.start,
              end_at: from.end,
              source: b.source,
              plan_id: b.plan_id,
            },
          ],
        });
        done.push(
          sessionEntry(
            {
              id: b.id,
              item_id: b.item_id,
              title: b.title,
              start_at: from.start,
            },
            ctx.timezone,
            "Removed",
          ),
        );
      }
    }
    return finishWrite(ctx, "Rescheduling", {
      done,
      review,
      reviewSummary: `Move or remove ${review.length} session${review.length === 1 ? "" : "s"}`,
      undo,
    });
  },
});

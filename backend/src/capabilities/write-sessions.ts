import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  planPreviewInput,
  HttpError,
  SESSION_OUTCOMES,
  type PlanMove,
  type ReviewChangeInput,
  type SessionOutcome,
} from "@orbyn/core";
import { queueWebhooks } from "../lib/webhooks.js";
import { keptOutFor } from "../lib/assistant-off.js";
import { checkIn, startSession } from "../modules/planner/check-in.js";
import { derivedKey } from "../lib/secrets.js";
import {
  blockById,
  duplicateSession,
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
import { appUrl, refUrl } from "./refs.js";
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
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  finishWrite,
  isoTime,
  idField,
  writeOutput,
  type DoneEntry,
} from "./write.js";
import { visibleItem } from "./write-tasks.js";
import { applyHabitPlan, habitPlan } from "../modules/planner/routines.js";
import {
  applyRevision,
  planRevision,
  studyOverview,
} from "../modules/study/service.js";

/**
 * Sessions (time set aside for a task): previewing a plan without touching
 * the calendar (plan_schedule), putting sessions on it (schedule_sessions)
 * and moving or removing them (reschedule_sessions). Sessions are always
 * the person's own and never email anyone; they go through the planner's
 * one write path (planner/blocks.ts), with the same checks as the app.
 */

/** A plan_token lasts this long, and works once. */
export const PLAN_TOKEN_MINUTES = 10;
/**
 * More sessions than this at once ask the person first (the ask-first
 * list's "more than 50 changes at once").
 */
export const DIRECT_SESSIONS = 50;

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
  /** A habit or revision plan instead of a task plan, and what it needs. */
  k?: "habits" | "revision";
  h?: { start_date?: string; days: number };
  r?: { key: string; minutes: number };
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
    "Previews sessions for the person's open tasks (team tasks once assigned to them; mode habits: their habits) over up to 14 days (working hours, frames, learned durations, the calendar), changing nothing: sessions, tasks that didn't fit and why, moves before a deadline, and a plan_token (10 minutes, once) for schedule_sessions.",
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
      mode: z
        .enum(["tasks", "habits"])
        .optional()
        .describe("habits: sessions for the person's habits instead."),
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
    if (a.mode === "habits") return planHabits(ctx, a.days ?? 7, a.start_date);
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
    ctx.progress?.(1, 3, "Reading the calendar, tasks and working hours");
    const plan = await computePlan(
      dbOf(ctx),
      p.user.id,
      state,
      ctx.now,
      await outOfSight(ctx),
    );
    ctx.progress?.(2, 3, "Placing sessions");
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
    ctx.progress?.(3, 3, "Plan ready");
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

/** What a habit or revision plan places, as one digest. */
const blocksDigest = (
  blocks: { id?: string; start_at: string; end_at: string }[],
) =>
  createHash("sha256")
    .update(
      JSON.stringify(blocks.map((b) => [b.id ?? "", b.start_at, b.end_at])),
    )
    .digest("base64url");

/** Habit sessions previewed (plan_schedule mode habits). */
async function planHabits(
  ctx: CapabilityContext,
  days: number,
  startDate: string | undefined,
) {
  const p = ctx.principal;
  const h = { ...(startDate ? { start_date: startDate } : {}), days };
  const plan = await habitPlan(ctx.db, p.user.id, h, ctx.now);
  const expires = ctx.now.getTime() + PLAN_TOKEN_MINUTES * 60_000;
  const token = await sealPlan({
    u: p.user.id,
    g: p.grant_id,
    s: {},
    n: ctx.now.toISOString(),
    f: "",
    d: blocksDigest(plan.blocks.map((b) => ({ id: b.habit_id, ...b }))),
    x: expires,
    k: "habits",
    h,
  });
  const tz = ctx.timezone;
  const minutes = plan.blocks.reduce(
    (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
    0,
  );
  const structured = {
    summary: plan.blocks.length
      ? `${plan.blocks.length} habit session${plan.blocks.length === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}.`
      : "No habit sessions to place.",
    sessions: plan.blocks.map((b) => ({
      task: `habit:${b.habit_id}`,
      title: cleanTitle(b.name),
      start_at: b.start_at,
      end_at: b.end_at,
      local: `${localTime(new Date(b.start_at), tz)}–${localTime(new Date(b.end_at), tz).slice(-5)}`,
      part: null,
    })),
    moves: [],
    unplaced: plan.summary
      .filter((s) => s.placed < s.needed)
      .map((s) => ({
        task: `habit:${s.habit_id}`,
        title: cleanTitle(s.name),
        reason: s.reason ?? `${s.placed} of ${s.needed} placed`,
      })),
    at_risk: [],
    planned_minutes: Math.round(minutes),
    free_minutes: 0,
    plan_token: token,
    expires_at: new Date(expires).toISOString(),
  };
  return {
    structured,
    markdown: [
      structured.summary,
      ...structured.sessions.map((s) => `- ${s.local} · ${s.title}`),
      ...structured.unplaced.map(
        (u) => `- Not all placed: ${u.title} (${u.reason})`,
      ),
      "",
      `Nothing is on the calendar yet. To keep these, call schedule_sessions with plan_token (valid ${PLAN_TOKEN_MINUTES} minutes).`,
    ].join("\n"),
  };
}

/**
 * A revision plan (plan_revision) as a plan_token: schedule_sessions works
 * it out again, and puts a "Revise for …" task with its sessions on the
 * calendar when nothing changed.
 */
export async function sealRevision(
  ctx: CapabilityContext,
  key: string,
  minutes: number,
  sessions: { start_at: string; end_at: string }[],
) {
  const p = ctx.principal;
  const expires = ctx.now.getTime() + PLAN_TOKEN_MINUTES * 60_000;
  return {
    token: await sealPlan({
      u: p.user.id,
      g: p.grant_id,
      s: {},
      n: ctx.now.toISOString(),
      f: "",
      d: blocksDigest(sessions),
      x: expires,
      k: "revision",
      r: { key, minutes },
    }),
    expires_at: new Date(expires).toISOString(),
  };
}

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

/**
 * Tasks in projects kept out of AI, left out of an agent's plans (their
 * sessions already on the calendar still count as busy): the agent never
 * hears of them, and never places their time.
 */
async function outOfSight(ctx: CapabilityContext) {
  const out = await keptOutFor(dbOf(ctx), ctx.principal.user.id);
  return { drop_item_ids: [...out.items] };
}

export const scheduleSessions = defineCapability({
  name: "schedule_sessions",
  title: "Put sessions on the calendar",
  description:
    "Adds sessions to the person's calendar: a plan_token's plan (from plan_schedule or plan_revision), or sessions given (task, start, end). Clashing sessions or closed tasks are skipped; a plan whose calendar changed is refused as STALE. Up to 50 at once, made directly at full power (undo takes them off).",
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
      if (sealed.k) return scheduleSealed(ctx, sealed);
      // The project a plan was limited to rides beside the app's own
      // settings, which don't name one (and refuse keys they don't know).
      const { project_id, ...settings } = sealed.s;
      const state = {
        ...planPreviewInput.parse(settings),
        ...(project_id ? { project_id } : {}),
      };
      const again = await computePlan(
        db,
        p.user.id,
        state,
        new Date(sealed.n),
        await outOfSight(ctx),
      );
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
    // Sessions are the person's own time, team tasks' too: at full power
    // they go straight on the calendar (undo takes them off); a connection
    // that asks or suggests, in any space the tasks are in, asks.
    const where = [null, ...teams.map((t) => t.team_id)].some(
      (team) => destination(ctx, team, "W1") === "review",
    )
      ? "review"
      : "direct";
    const count = blocks.length + moves.length;
    if (where === "review" || count > DIRECT_SESSIONS) {
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

/** Habit and revision plans: worked out again, then put on the calendar. */
async function scheduleSealed(ctx: CapabilityContext, sealed: Sealed) {
  const p = ctx.principal;
  const db = dbOf(ctx);
  const at = new Date(sealed.n);
  if (destination(ctx, null, "W1") === "review") throw cantWait(ctx, null);
  const stale = () =>
    new CapabilityError(
      "STALE",
      "The calendar changed since this plan was made.",
      "Preview it again and schedule the new plan.",
    );
  const undo: UndoOp[] = [];
  const done: DoneEntry[] = [];
  if (sealed.k === "habits") {
    const again = await habitPlan(db, p.user.id, sealed.h!, at);
    if (
      blocksDigest(again.blocks.map((b) => ({ id: b.habit_id, ...b }))) !==
      sealed.d
    )
      throw stale();
    if (!again.blocks.length)
      return finishWrite(ctx, "Scheduling", { done: [] });
    const before = new Set(
      (
        await db.query<{ id: string }>(
          "SELECT id FROM habit_blocks WHERE user_id = $1",
          [p.user.id],
        )
      ).rows.map((r) => r.id),
    );
    const placed = (
      await applyHabitPlan(db, p.user.id, {
        blocks: again.blocks.map((b) => ({
          habit_id: b.habit_id,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
      })
    ).filter((b) => !before.has(b.id));
    if (placed.length)
      undo.push({ op: "habit_blocks.delete", ids: placed.map((b) => b.id) });
    for (const b of placed)
      done.push({
        id: `habit:${b.habit_id}`,
        title: `${cleanTitle(b.name)} · ${localTime(new Date(b.start_at), ctx.timezone)}`,
        url: `${appUrl()}/app/today`,
        version: null,
        change: `Planned (habit session ${b.id})`,
      });
    return finishWrite(ctx, "Scheduling", {
      done,
      skipped:
        placed.length < again.blocks.length
          ? [
              {
                index: 0,
                reason: `${again.blocks.length - placed.length} left out: the time is taken now.`,
              },
            ]
          : [],
      undo,
    });
  }
  const r = sealed.r!;
  const overview = await studyOverview(p.user.id, at, db);
  const exam = overview.exams.find((e) => e.key === r.key);
  if (!exam) throw stale();
  const again = await planRevision(p.user.id, exam, r.minutes, at, db);
  if (blocksDigest(again.sessions) !== sealed.d) throw stale();
  if (!again.sessions.length)
    return finishWrite(ctx, "Scheduling", { done: [] });
  const made = await applyRevision(db, actorOf(p) as never, {
    key: r.key,
    sessions: again.sessions,
  });
  const task = (
    await db.query<{ version: number; title: string }>(
      "SELECT version, title FROM items WHERE id = $1",
      [made.item_id],
    )
  ).rows[0];
  undo.push({ op: "item.delete", id: made.item_id, version: task.version });
  done.push({
    id: `task:${made.item_id}`,
    title: cleanTitle(task.title),
    url: refUrl({ type: "task", id: made.item_id }),
    version: task.version,
    change: `Made, with ${made.block_ids.length} revision session${made.block_ids.length === 1 ? "" : "s"}`,
  });
  return finishWrite(ctx, "Scheduling", { done, undo });
}

// --- reschedule_sessions -----------------------------------------------

type SessionRow = {
  id: string;
  item_id: string;
  start_at: Date;
  end_at: Date;
  source: string;
  started_at: Date | null;
  outcome: string | null;
  outcome_at: Date | null;
  spent_added: number;
  counted: boolean;
  title: string;
  spent_minutes: number;
  estimate_minutes: number | null;
};

/**
 * Pin, unpin, duplicate, roll forward, start or check in one session: the
 * app's own session code, made as the person (activity says via the agent).
 * The agent acts for the person, so it may say how a session went.
 */
async function sessionState(
  ctx: CapabilityContext,
  b: SessionRow,
  c: {
    action: (typeof SESSION_ACTIONS)[number];
    start_at?: string;
    outcome?: SessionOutcome;
    more_minutes?: number;
  },
  undo: UndoOp[],
): Promise<DoneEntry> {
  const db = dbOf(ctx);
  const me = ctx.principal.user.id;
  const was: Extract<UndoOp, { op: "session.restore" }> = {
    op: "session.restore",
    id: b.id,
    item_id: b.item_id,
    block: {
      source: b.source,
      started_at: b.started_at?.toISOString() ?? null,
      outcome: b.outcome,
      outcome_at: b.outcome_at?.toISOString() ?? null,
      spent_added: b.spent_added,
      counted: b.counted,
    },
    item: null,
  };
  const entry = (change: string, block = b) =>
    sessionEntry(
      {
        id: block.id,
        item_id: b.item_id,
        title: b.title,
        start_at: new Date(block.start_at).toISOString(),
      },
      ctx.timezone,
      change,
    );
  switch (c.action) {
    case "pin":
    case "unpin":
      await db.query("UPDATE time_blocks SET source = $2 WHERE id = $1", [
        b.id,
        c.action === "pin" ? "manual" : "planner",
      ]);
      undo.push(was);
      return entry(c.action === "pin" ? "Pinned" : "Unpinned");
    case "duplicate":
    case "roll_forward": {
      if (c.action === "roll_forward" && b.end_at > ctx.now)
        throw new CapabilityError(
          "INVALID",
          "Only a session that has ended rolls forward.",
          "Use next_free to move one still to come.",
        );
      const made = await duplicateSession(
        db,
        me,
        b.id,
        c.action === "duplicate" ? c.start_at : undefined,
        ctx.now,
      );
      undo.push({
        op: "block.delete",
        id: made.id,
        start_at: new Date(made.start_at).toISOString(),
        end_at: new Date(made.end_at).toISOString(),
      });
      return entry(c.action === "duplicate" ? "Duplicated" : "Rolled forward", {
        ...b,
        id: made.id,
        start_at: new Date(made.start_at),
      });
    }
    case "start":
      await startSession(db, me, b.id, ctx.now);
      undo.push(was);
      return entry("Started");
    default: {
      was.item = {
        spent_minutes: b.spent_minutes,
        estimate_minutes: b.estimate_minutes,
      };
      const r = await checkIn(
        db,
        me,
        b.id,
        c.outcome!,
        c.more_minutes,
        ctx.now,
      );
      await queueWebhooks(
        db,
        "block.updated",
        { user_id: me, team_id: null },
        await blockById(db, b.id, me),
      );
      undo.push(was);
      return entry(
        `Checked in: ${c.outcome}, ${r.counted_minutes} min counted`,
      );
    }
  }
}

const SESSION_ACTIONS = [
  "move",
  "next_free",
  "remove",
  "pin",
  "unpin",
  "duplicate",
  "roll_forward",
  "start",
  "check_in",
] as const;

export const rescheduleSessions = defineCapability({
  name: "reschedule_sessions",
  title: "Change sessions",
  description:
    "Changes sessions (ids from get_calendar, get_today or get_work_patterns): move, next_free, remove, pin (replanning leaves it), unpin, duplicate (at start_at or the next free slot), roll_forward (a past one to the next free slot), start, check_in (outcome; more_minutes with more). Undo puts them back.",
  input: z
    .object({
      changes: z
        .array(
          z
            .object({
              session: idField,
              action: z.enum(SESSION_ACTIONS),
              start_at: isoTime.optional(),
              end_at: isoTime.optional(),
              outcome: z.enum(SESSION_OUTCOMES).optional(),
              more_minutes: z.number().int().min(5).max(1440).optional(),
            })
            .strict()
            .refine((c) => c.action !== "move" || (c.start_at && c.end_at), {
              message: "A move needs start_at and end_at.",
            })
            .refine((c) => c.action !== "check_in" || c.outcome, {
              message: "A check-in needs an outcome.",
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
          started_at: Date | null;
          outcome: string | null;
          outcome_at: Date | null;
          spent_added: number;
          counted: boolean;
          title: string;
          team_id: string | null;
          spent_minutes: number;
          estimate_minutes: number | null;
        }>(
          `SELECT b.id, b.item_id, b.start_at, b.end_at, b.source, b.plan_id,
                  b.started_at, b.outcome, b.outcome_at, b.spent_added, b.counted,
                  i.title, i.team_id, i.spent_minutes, i.estimate_minutes
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
      if (!["move", "next_free", "remove"].includes(c.action)) {
        // The session's own state (H6a): made directly, or not at all.
        if (where === "review") throw cantWait(ctx, null);
        try {
          done.push(await sessionState(ctx, b, c, undo));
        } catch (e) {
          // The app's "not now" answers (not on yet, no free time, a closed
          // task) are about the session, not a version.
          if (e instanceof HttpError && e.statusCode === 409)
            throw new CapabilityError("INVALID", e.message);
          throw e;
        }
        continue;
      }
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

import { z } from "zod";
import { addDays, localDateKey, weekdayOf } from "./time.js";
import type { Plan } from "./types.js";

/**
 * Follow-through: seeing whether plans hold, what changed while you were
 * away, what a change would do before you make it, which pages have gone
 * quiet, agreeing on dates instead of assuming them, how much of a team's
 * week meetings take, and what got done — with the proof.
 */

const instant = z.iso.datetime({ offset: true });
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// ---- plan reality check ------------------------------------------------------

/** How much of what was planned on each weekday actually got done, lately. */
export type PlanReality = {
  /** Days looked back over. */
  window_days: number;
  /** False until there's enough planned time behind us to say anything. */
  enough: boolean;
  /** Share of planned time that got done, all days together (0–1). */
  rate: number | null;
  by_weekday: {
    /** 0 = Sunday. */
    weekday: number;
    /** Days of this weekday that had anything planned. */
    days: number;
    planned_minutes: number;
    kept_minutes: number;
    rate: number | null;
  }[];
};

/** Below this much planned time in the window, there's nothing to say yet. */
export const REALITY_MIN_MINUTES = 180;

export type RealityDay = {
  day: string;
  planned_minutes: number;
  /** What history says will get done of it. */
  likely_minutes: number;
  /** Planned noticeably more than usually gets done that weekday. */
  stretch: boolean;
};

const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

const hours = (m: number) => {
  const h = Math.round((m / 60) * 2) / 2;
  return h < 1 ? `${Math.round(m)} min` : `${h} h`;
};

/**
 * A plan held up against how plans have gone lately: per day, what's likely
 * to get done, and one sentence about the day that stretches most.
 */
export function realityCheck(
  plan: Pick<Plan, "blocks"> &
    Partial<Pick<Plan, "tasks" | "capacity_minutes">>,
  reality: PlanReality | null,
  timeZone: string,
): { days: RealityDay[]; message: string | null; note: string | null } {
  // What the plan itself shows, history or not: more work than free time,
  // and tasks with no estimate that were counted as half an hour.
  const tasks = plan.tasks?.filter((t) => t.included) ?? [];
  const wanted = tasks.reduce((n, t) => n + (t.estimate_minutes ?? 30), 0);
  const free = Math.max(0, plan.capacity_minutes ?? 0);
  const unknown = tasks.filter((t) => t.estimate_minutes === null).length;
  const notes = [
    tasks.length && wanted > free + 30
      ? `These tasks need about ${hours(wanted)}; only ${hours(free)} is free.`
      : "",
    unknown
      ? `${unknown} ${unknown === 1 ? "task has" : "tasks have"} no estimate and ${unknown === 1 ? "was" : "were"} counted as 30 min.`
      : "",
  ].filter(Boolean);
  const note = notes.length ? notes.join(" ") : null;
  if (!reality || !reality.enough || reality.rate === null)
    return { days: [], message: null, note };
  const byDay = new Map<string, number>();
  for (const b of plan.blocks) {
    const day = localDateKey(new Date(b.start_at), timeZone);
    byDay.set(
      day,
      (byDay.get(day) ?? 0) +
        (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
    );
  }
  const days = [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, planned]): RealityDay => {
      const w = reality.by_weekday.find((x) => x.weekday === weekdayOf(day));
      const rate = w?.rate ?? reality.rate!;
      // Typical time kept on this weekday, when there's history for it.
      const typical =
        w && w.days ? w.kept_minutes / w.days : Number.POSITIVE_INFINITY;
      return {
        day,
        planned_minutes: Math.round(planned),
        likely_minutes: Math.round(planned * rate),
        stretch: planned - typical >= 60 && rate < 0.85,
      };
    });
  const worst = days
    .filter((d) => d.stretch)
    .sort(
      (a, b) =>
        b.planned_minutes -
        b.likely_minutes -
        (a.planned_minutes - a.likely_minutes),
    )[0];
  const pct = Math.round(reality.rate * 100);
  const message = worst
    ? `On ${WEEKDAY_NAMES[weekdayOf(worst.day)]} you usually get through about ${hours(
        (reality.by_weekday.find((x) => x.weekday === weekdayOf(worst.day))
          ?.kept_minutes ?? 0) /
          Math.max(
            1,
            reality.by_weekday.find((x) => x.weekday === weekdayOf(worst.day))
              ?.days ?? 1,
          ),
      )}. This plan puts ${hours(worst.planned_minutes)} there.`
    : pct >= 85
      ? `Looks realistic: lately you finish about ${pct}% of what you plan.`
      : `Lately you finish about ${pct}% of what you plan, and no day here asks for more than usual.`;
  return { days, message, note };
}

// ---- what if -----------------------------------------------------------------

export const whatIfInput = z
  .object({
    days: z.number().int().min(1).max(14).default(7),
    add_tasks: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            estimate_minutes: z.number().int().min(5).max(10080),
            due_at: instant.nullable().default(null),
            priority: z.enum(["low", "medium", "high"]).default("medium"),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    days_off: z.array(dayKey).max(14).default([]),
    move_due: z
      .array(
        z.object({ item_id: z.uuid(), due_at: instant.nullable() }).strict(),
      )
      .max(20)
      .default([]),
    drop_item_ids: z.array(z.uuid()).max(50).default([]),
  })
  .strict()
  .refine(
    (d) =>
      d.add_tasks.length +
        d.days_off.length +
        d.move_due.length +
        d.drop_item_ids.length >
      0,
    "Say what would change",
  );
export type WhatIfInput = z.input<typeof whatIfInput>;

export type WhatIfSide = {
  planned_minutes: number;
  capacity_minutes: number;
  at_risk: { item_id: string; title: string }[];
  unplaced: { item_id: string; title: string }[];
};

export type WhatIfResult = {
  before: WhatIfSide;
  after: WhatIfSide;
  /** Late or left out after the change, but not before. */
  newly_late: string[];
  /** Late or left out before, but not after. */
  relieved: string[];
  /** The answer, in one sentence. */
  verdict: string;
};

export function whatIfVerdict(before: WhatIfSide, after: WhatIfSide) {
  const trouble = (s: WhatIfSide) =>
    new Map([...s.at_risk, ...s.unplaced].map((t) => [t.item_id, t.title]));
  const b = trouble(before);
  const a = trouble(after);
  const newly = [...a].filter(([id]) => !b.has(id)).map(([, t]) => t);
  const relieved = [...b].filter(([id]) => !a.has(id)).map(([, t]) => t);
  const free = Math.max(0, after.capacity_minutes - after.planned_minutes);
  const list = (xs: string[]) =>
    xs.length <= 2
      ? xs.join(" and ")
      : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`;
  const verdict = newly.length
    ? `${newly.length === 1 ? "1 task" : `${newly.length} tasks`} would run late or not fit: ${list(newly)}.`
    : relieved.length
      ? `It helps: ${list(relieved)} would fit in time.`
      : `It fits. You'd still have ${hours(free)} free.`;
  return { newly_late: newly, relieved, verdict };
}

// ---- re-entry brief ------------------------------------------------------------

/** Away at least this long, and there's a brief to come back to. */
export const REENTRY_AWAY_HOURS = 36;

export type ReentryLine = {
  item_id?: string;
  doc_id?: string;
  ask_id?: string;
  title: string;
  detail: string;
};

export type ReentryBrief = {
  away_from: string;
  away_until: string;
  days_away: number;
  assigned: ReentryLine[];
  changed: ReentryLine[];
  asks: ReentryLine[];
  mentions: ReentryLine[];
  due: ReentryLine[];
  pages: ReentryLine[];
};

// ---- memory decay ------------------------------------------------------------

export const FADING_DAYS = 90;
export const STALE_DAYS = 180;

export type Freshness = {
  state: "fresh" | "fading" | "stale";
  /** Days since it was last changed or confirmed. */
  days: number;
};

/** How long since a page was last changed or confirmed still true. */
export function pageFreshness(
  updatedAt: string,
  reviewedAt: string | null | undefined,
  now = new Date(),
): Freshness {
  const last = Math.max(
    Date.parse(updatedAt),
    reviewedAt ? Date.parse(reviewedAt) : 0,
  );
  const days = Math.floor((now.getTime() - last) / 86_400_000);
  return {
    state:
      days >= STALE_DAYS ? "stale" : days >= FADING_DAYS ? "fading" : "fresh",
    days,
  };
}

/** "5 months", "3 weeks", "12 days". */
export function ageLabel(days: number) {
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export const docReviewInput = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("still_true") }).strict(),
  z
    .object({
      verdict: z.literal("needs_update"),
      note: z.string().trim().max(1000).default(""),
    })
    .strict(),
]);

export type FadingDoc = {
  id: string;
  title: string;
  team_id: string | null;
  team_name: string | null;
  owner_name: string;
  updated_at: string;
  reviewed_at: string | null;
  freshness: Freshness;
};

// ---- negotiated plans ------------------------------------------------------------

export const ASK_STATUSES = [
  "open",
  "countered",
  "accepted",
  "declined",
  "withdrawn",
] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

/** Someone asked someone else to do a task by a date. */
export type TaskAsk = {
  id: string;
  item_id: string;
  item_title: string;
  asked_by: string;
  asked_by_name: string;
  asked_of: string;
  asked_of_name: string;
  status: AskStatus;
  /** What was asked for. */
  due_at: string | null;
  estimate_minutes: number | null;
  /** What was suggested instead. */
  counter_due_at: string | null;
  counter_estimate_minutes: number | null;
  message: string;
  reply: string;
  created_at: string;
  updated_at: string;
};

/** The person asked answers: yes, another date, or no. */
export const askReplyInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("accept"),
      message: z.string().trim().max(500).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("counter"),
      due_at: instant.nullable().optional(),
      estimate_minutes: z
        .number()
        .int()
        .min(5)
        .max(10080)
        .nullable()
        .optional(),
      message: z.string().trim().max(500).default(""),
    })
    .strict()
    .refine(
      (d) => d.due_at !== undefined || d.estimate_minutes !== undefined,
      "Suggest a date or a length",
    ),
  z
    .object({
      action: z.literal("decline"),
      message: z.string().trim().min(1, "Say why").max(500),
    })
    .strict(),
]);

/** The asker settles a suggestion: agree to it, keep theirs, or withdraw. */
export const askSettleInput = z
  .object({
    action: z.enum(["agree", "keep", "withdraw"]),
    message: z.string().trim().max(500).default(""),
  })
  .strict();

// ---- team attention budget -----------------------------------------------------

export const attentionBudgetInput = z
  .object({
    /** Meeting time per person per week; null for no budget. */
    meeting_budget_minutes: z
      .number()
      .int()
      .min(30)
      .max(40 * 60)
      .nullable(),
  })
  .strict();

export const attentionCheckInput = z
  .object({
    start_at: instant,
    end_at: instant,
    /** Who would be in it; everyone on the team when left out. */
    user_ids: z.array(z.uuid()).max(100).optional(),
    /** An event being edited, so it isn't counted twice. */
    item_id: z.uuid().optional(),
  })
  .strict()
  .refine(
    (d) => Date.parse(d.end_at) > Date.parse(d.start_at),
    "End after start",
  );

export type TeamAttention = {
  week_start: string;
  budget_minutes: number | null;
  members: {
    user_id: string;
    name: string;
    meeting_minutes: number;
    over: boolean;
  }[];
};

export type AttentionCheck = {
  budget_minutes: number | null;
  /** People this meeting would take over the budget. */
  over: { user_id: string; name: string; meeting_minutes: number }[];
};

/** The Monday a week starts on, as a day key. */
export function weekStartOf(day: string) {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

// ---- proof of progress -----------------------------------------------------------

export const proofInput = z
  .object({
    url: z
      .string()
      .trim()
      .max(2000)
      .url("That doesn't look like a link")
      .refine((u) => /^https?:\/\//i.test(u), "Links start with http")
      .nullable()
      .default(null),
    note: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine((d) => !!d.url || !!d.note, "Add a link or a note");

export type ItemProof = {
  id: string;
  item_id: string;
  user_id: string;
  user_name: string;
  url: string | null;
  note: string;
  created_at: string;
};

export type ProgressReport = {
  from: string;
  to: string;
  people: {
    user_id: string;
    name: string;
    done: {
      item_id: string;
      title: string;
      done_at: string;
      project: string | null;
      proofs: Pick<ItemProof, "url" | "note">[];
    }[];
  }[];
  /** The same, as text to paste anywhere. */
  markdown: string;
};

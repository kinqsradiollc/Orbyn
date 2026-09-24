import { createHash } from "node:crypto";
import {
  addDays,
  clockMinutes,
  dayTime,
  guessEstimate,
  hasTeamPermission,
  learnedRatio,
  itemBody,
  localDateKey,
  weekdayOf,
  type AtRiskTask,
  type GuessedEstimate,
  type BusyInterval,
  type Frame,
  type Item,
  type Plan,
  type PlanOptions,
  type PlannerPrefs,
  type PlannerReview,
  type PlanTask,
  type TimeBlock,
  type planPreviewInput,
  type planTuneInput,
} from "@orbyn/core";
import type { z } from "zod";
import type { Db as Tx, Queryable as Db } from "../../db/pool.js";
import { fail } from "@orbyn/core";
import { membershipRole, VISIBLE_ITEMS } from "../../lib/teams.js";
import { loadItem, mutate } from "../items/service.js";
import {
  busyIntervals,
  agendaEntries,
  loadPrefs,
  mergeIntervals,
  timeBlocks,
} from "./calendar.js";
import { loadFrames } from "./frames.js";
import { loadLearning, smartPlacementOf } from "./learning.js";
import {
  DEFAULT_ESTIMATE_MINUTES,
  remainingOf,
  schedule,
  type SchedulerResult,
  type SchedulerTask,
} from "./scheduler.js";

export { FRAME_COLUMNS, loadFrames } from "./frames.js";

export type PreviewInput = z.output<typeof planPreviewInput>;
export type TuneInput = z.output<typeof planTuneInput>;

type Pin = { item_id: string; start_at: string; end_at: string };

/**
 * Everything a plan is made from, stored with it so tuning can make it again
 * with one thing changed: the preview request plus the tuning so far.
 */
type PlanState = PreviewInput & {
  include_item_ids: string[];
  estimates: Record<string, number>;
  pinned_blocks: Pin[];
};

const stateOf = (d: Partial<PlanState>): PlanState => ({
  ...d,
  use_frames: d.use_frames ?? true,
  keep_free: d.keep_free ?? [],
  exclude_item_ids: d.exclude_item_ids ?? [],
  include_item_ids: d.include_item_ids ?? [],
  estimates: d.estimates ?? {},
  pinned_blocks: d.pinned_blocks ?? [],
});

type Candidate = SchedulerTask & { version: number };

/**
 * A task's open subtasks and the minutes they still need (on alias `i`), so
 * a parent's own estimate isn't counted on top of them (`remainingOf`).
 */
export const CHILD_COLUMNS = `
  (SELECT count(*)::int FROM items c
   WHERE c.parent_id = i.id AND c.status NOT IN ('done', 'cancelled')) AS open_children,
  coalesce((SELECT sum(greatest(0, coalesce(c.estimate_minutes, ${DEFAULT_ESTIMATE_MINUTES}) - c.spent_minutes))
            FROM items c WHERE c.parent_id = i.id AND c.status NOT IN ('done', 'cancelled')), 0)::int
    AS children_remaining`;

/**
 * Open tasks the planner considers: your personal tasks and team tasks
 * assigned to you, narrowed by `scope`. Naming tasks (`only`) lets it plan
 * any task you can see; `include` adds tasks you can see to either.
 */
export async function candidateTasks(
  db: Db,
  userId: string,
  options: {
    only?: string[];
    include?: string[];
    scope?: PreviewInput["scope"] | null;
  } = {},
): Promise<Candidate[]> {
  const scope = options.scope;
  const rows = (
    await db.query<Candidate & { due_at: Date | null }>(
      `SELECT i.id, i.title, i.priority, i.status, i.due_at, i.estimate_minutes,
              i.spent_minutes, i.list_id, i.team_id, i.version,
              coalesce((SELECT array_agg(x.tag_id ORDER BY x.tag_id) FROM item_tags x WHERE x.item_id = i.id), '{}') AS tag_ids,
              coalesce((SELECT sum(extract(epoch FROM (b.end_at - greatest(b.start_at, now()))) / 60)
                        FROM time_blocks b
                        WHERE b.item_id = i.id AND b.user_id = $1 AND b.end_at > now()), 0)::int
                AS scheduled_minutes,
              (SELECT max(b.end_at) FROM time_blocks b WHERE b.item_id=i.id AND b.user_id=$1 AND b.end_at>now()) AS scheduled_end_at,
              coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'ready_at',
                CASE WHEN p.status='done' THEN '1970-01-01T00:00:00Z'::timestamptz
                WHEN p.status NOT IN ('blocked','cancelled') AND
                  coalesce((SELECT sum(extract(epoch FROM (b.end_at-greatest(b.start_at,now())))/60) FROM time_blocks b WHERE b.item_id=p.id AND b.user_id=$1 AND b.end_at>now()),0)
                  >= greatest(0,coalesce(p.estimate_minutes,30)-p.spent_minutes)
                THEN coalesce((SELECT max(b.end_at) FROM time_blocks b WHERE b.item_id=p.id AND b.user_id=$1 AND b.end_at>now()), '1970-01-01T00:00:00Z'::timestamptz)
                ELSE NULL END) ORDER BY p.id)
                FROM item_dependencies dep JOIN items p ON p.id=dep.prerequisite_id WHERE dep.item_id=i.id), '[]'::jsonb) AS dependencies,
              ${CHILD_COLUMNS}
       FROM items i
       WHERE i.kind = 'task' AND i.status NOT IN ('done', 'cancelled') AND (
         (i.id = ANY ($3::uuid[]) AND ${VISIBLE_ITEMS})
         OR CASE WHEN $2::uuid[] IS NULL
           THEN (($4::boolean AND i.team_id IS NULL AND i.user_id = $1)
               OR (i.assignee_id = $1
                 AND i.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
                 AND ($5::uuid[] IS NULL OR i.team_id = ANY ($5::uuid[]))))
             AND (cardinality($6::uuid[]) = 0 OR i.list_id = ANY ($6::uuid[]))
           ELSE i.id = ANY ($2::uuid[]) AND ${VISIBLE_ITEMS} END)
       ORDER BY i.due_at NULLS LAST, i.created_at LIMIT 300`,
      [
        userId,
        options.only ?? null,
        options.include ?? [],
        scope?.personal ?? true,
        scope?.team_ids ?? null,
        scope?.list_ids ?? [],
      ],
    )
  ).rows;
  return rows.map((t) => ({
    ...t,
    due_at: t.due_at ? new Date(t.due_at).toISOString() : null,
    scheduled_end_at: t.scheduled_end_at
      ? new Date(t.scheduled_end_at).toISOString()
      : null,
  }));
}

const hoursLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A sentence or three about a plan, for the preview and the assistant. */
export function describePlan(result: SchedulerResult, days: number) {
  const tasks = new Set(result.blocks.map((b) => b.item_id)).size;
  const notes: string[] = [];
  if (result.unplaced.length)
    notes.push(`${plural(result.unplaced.length, "task")} couldn't be placed.`);
  if (result.at_risk.length)
    notes.push(`${plural(result.at_risk.length, "task")} may run late.`);
  if (!result.blocks.length)
    return result.unplaced.length
      ? `Nothing fits yet. ${notes.join(" ")}`
      : "There's nothing to plan: no open task needs time.";
  return [
    `${plural(tasks, "task")} in ${plural(result.blocks.length, "session")} over ${plural(days, "day")}, using ${hoursLabel(result.planned_minutes)} of ${hoursLabel(result.capacity_minutes)} free.`,
    ...notes,
    ...(result.notes ?? []),
  ].join(" ");
}

/** The calendar, frames and tasks a plan is made from. */
async function planInputs(db: Db, userId: string, state: PlanState, now: Date) {
  const prefs = await loadPrefs(db, userId);
  // Someone who hasn't chosen a time zone yet plans in their device's.
  const tz =
    prefs.timezone === "UTC" && state.timezone
      ? state.timezone
      : prefs.timezone;
  const today = localDateKey(now, tz);
  const start =
    state.start_date && state.start_date > today ? state.start_date : today;
  const days = state.days ?? prefs.horizon_days;
  const from = dayTime(start, 0, tz);
  const to = dayTime(addDays(start, days), 0, tz);
  // Pinned tasks are in the plan, whatever the scope or exclusions say.
  const include = [
    ...new Set([
      ...state.include_item_ids,
      ...state.pinned_blocks.map((p) => p.item_id),
    ]),
  ];
  const [busy, frames, tasks] = await Promise.all([
    busyIntervals(db, userId, from, to),
    loadFrames(db, userId),
    candidateTasks(db, userId, {
      only: state.item_ids,
      include,
      scope: state.scope,
    }),
  ]);
  return { prefs, tz, start, days, from, to, busy, frames, tasks, include };
}

/**
 * A fingerprint of what a plan was made from: busy time, frames, working
 * hours and the tasks' planning fields. When it changes the plan is stale.
 */
function fingerprint(inputs: Awaited<ReturnType<typeof planInputs>>) {
  const p = inputs.prefs;
  return createHash("sha256")
    .update(
      JSON.stringify({
        start: inputs.start,
        days: inputs.days,
        tz: inputs.tz,
        hours: [p.work_days, p.work_start, p.work_end],
        busy: inputs.busy,
        frames: inputs.frames.map((f: Frame) => [
          f.id,
          f.days,
          f.rrule,
          f.start_time,
          f.end_time,
          f.exdates,
          f.timezone,
          f.filters,
        ]),
        tasks: [...inputs.tasks]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((t) => [
            t.id,
            t.priority,
            t.status,
            t.due_at,
            t.estimate_minutes,
            t.spent_minutes,
            t.list_id,
            t.team_id,
            t.tag_ids,
            t.open_children,
            t.children_remaining,
            t.dependencies,
            t.scheduled_end_at,
          ]),
      }),
    )
    .digest("hex");
}

/**
 * A "what if" laid over the real calendar and tasks: tasks that don't exist
 * yet, whole days off, deadlines moved, tasks dropped. Nothing is saved.
 */
export type PlanScenario = {
  add_tasks?: {
    id: string;
    title: string;
    estimate_minutes: number;
    due_at: string | null;
    priority?: "low" | "medium" | "high";
  }[];
  days_off?: string[];
  move_due?: { item_id: string; due_at: string | null }[];
  drop_item_ids?: string[];
};

/**
 * Work out a plan without keeping it: the scheduler's answer, and what went
 * into it. `scenario` lays a "what if" over the real inputs.
 */
export async function computePlan(
  db: Db,
  userId: string,
  d: PreviewInput | PlanState,
  now = new Date(),
  scenario: PlanScenario = {},
) {
  const state = stateOf(d);
  const inputs = await planInputs(db, userId, state, now);
  const { prefs, tz, start, days, from, to, include } = inputs;
  const moved = new Map(
    (scenario.move_due ?? []).map((m) => [m.item_id, m.due_at]),
  );
  const dropped = new Set(scenario.drop_item_ids ?? []);
  const tasks: Candidate[] = [
    ...inputs.tasks
      .filter((t) => !dropped.has(t.id))
      .map((t) => (moved.has(t.id) ? { ...t, due_at: moved.get(t.id)! } : t)),
    ...(scenario.add_tasks ?? []).map((t): Candidate => ({
      id: t.id,
      title: t.title,
      priority: t.priority ?? "medium",
      status: "todo",
      due_at: t.due_at,
      estimate_minutes: t.estimate_minutes,
      spent_minutes: 0,
      scheduled_minutes: 0,
      list_id: null,
      tag_ids: [],
      team_id: null,
      version: 0,
    })),
  ];
  const daysOff = (scenario.days_off ?? []).map((day) => ({
    start_at: dayTime(day, 0, tz).toISOString(),
    end_at: dayTime(addDays(day, 1), 0, tz).toISOString(),
  }));
  for (const p of state.pinned_blocks)
    if (
      Date.parse(p.start_at) < from.getTime() ||
      Date.parse(p.end_at) > to.getTime()
    )
      fail(422, "Pinned sessions must be inside the days planned.");
  const excluded = new Set(
    state.exclude_item_ids.filter((id) => !include.includes(id)),
  );
  // What this person's history says: how long their tasks really take
  // (applied only when they opt in), the hours that go well and how much a
  // day usually holds (see learning.ts).
  const learning = await loadLearning(db, userId, tz, now);
  const guessed = new Map<string, GuessedEstimate>();
  const tuned = (t: Candidate): SchedulerTask => {
    if (state.estimates[t.id])
      return { ...t, estimate_minutes: state.estimates[t.id] };
    if (!prefs.learn_estimates) return t;
    if (t.estimate_minutes != null) {
      const r = learnedRatio(t, learning.durations);
      if (r !== 1)
        return { ...t, estimate_minutes: Math.round(t.estimate_minutes * r) };
      return t;
    }
    // No estimate: plan for what similar finished tasks took, not 30 minutes.
    // A parent with open subtasks is planned through them instead.
    if (t.open_children) return t;
    const guess = guessEstimate(t, learning.durations);
    if (!guess) return t;
    guessed.set(t.id, guess);
    return { ...t, estimate_minutes: guess.minutes };
  };
  const planned = tasks.filter((t) => !excluded.has(t.id)).map(tuned);
  const options: PlanOptions = {
    start_date: start,
    days,
    pad_percent: state.pad_percent ?? prefs.pad_percent,
    split: state.split ?? true,
    break_level: state.break_level ?? prefs.break_level,
    use_frames: state.use_frames,
    timezone: tz,
    scope: state.scope ?? null,
    keep_free: state.keep_free,
    item_ids: state.item_ids ?? null,
    include_item_ids: state.include_item_ids,
    exclude_item_ids: state.exclude_item_ids,
    estimates: state.estimates,
    pinned_blocks: state.pinned_blocks,
  };
  const result = schedule({
    tasks: planned,
    busy: [...inputs.busy, ...state.keep_free, ...daysOff],
    frames: inputs.frames,
    useFrames: options.use_frames,
    days: Array.from({ length: days }, (_, i) => addDays(start, i)),
    timezone: tz,
    workDays: prefs.work_days,
    workStart: prefs.work_start,
    workEnd: prefs.work_end,
    padPercent: options.pad_percent,
    split: options.split,
    splitAfterMinutes: prefs.split_after_minutes,
    minBlockMinutes: prefs.min_block_minutes,
    breakLevel: options.break_level,
    pinned: state.pinned_blocks,
    smart: smartPlacementOf(learning, prefs),
    now,
  });
  return {
    state,
    inputs,
    tasks,
    excluded,
    options,
    result,
    start,
    days,
    guessed,
  };
}

/**
 * Build a plan, store it for an hour, and return it. Nothing else is saved.
 * `d` is a preview request, or the stored state of a plan being tuned.
 */
export async function makePlan(
  db: Db,
  userId: string,
  d: PreviewInput | PlanState,
  now = new Date(),
  estimatesSaved: string[] = [],
): Promise<Plan> {
  const {
    state,
    inputs,
    tasks,
    excluded,
    options,
    result,
    start,
    days,
    guessed,
  } = await computePlan(db, userId, d, now);
  const summary = describePlan(result, days);
  const checklist = planTasks(tasks, excluded, state, result, guessed);
  // Tuning makes the same days again, even once tomorrow has become today.
  const stored: PlanState = { ...state, start_date: start };
  const row = (
    await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO plans (user_id, starts_on, days, options, blocks, unplaced)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, expires_at`,
      [
        userId,
        start,
        days,
        JSON.stringify({
          input: stored,
          resolved: options,
          at_risk: result.at_risk,
          capacity_minutes: result.capacity_minutes,
          planned_minutes: result.planned_minutes,
          summary,
          tasks: checklist,
          fingerprint: fingerprint(inputs),
          estimates_saved: estimatesSaved,
        }),
        JSON.stringify(result.blocks),
        JSON.stringify(result.unplaced),
      ],
    )
  ).rows[0];
  return {
    id: row.id,
    starts_on: start,
    days,
    ...result,
    applied: false,
    expires_at: row.expires_at.toISOString(),
    summary,
    tasks: checklist,
    options,
    superseded_by: null,
    estimates_saved: estimatesSaved,
  };
}

/** Every task the plan looked at, in or out, with how much time it got and why. */
function planTasks(
  tasks: Candidate[],
  excluded: Set<string>,
  state: PlanState,
  result: SchedulerResult,
  guessed: Map<string, GuessedEstimate>,
): PlanTask[] {
  return tasks.map((t) => {
    const minutes = result.blocks
      .filter((b) => b.item_id === t.id)
      .reduce(
        (sum, b) =>
          sum + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
        0,
      );
    const guess = guessed.get(t.id) ?? null;
    const estimate =
      state.estimates[t.id] ?? t.estimate_minutes ?? guess?.minutes ?? null;
    const remaining =
      remainingOf({ ...t, estimate_minutes: estimate }) - t.scheduled_minutes;
    const unplaced = result.unplaced.find((u) => u.item_id === t.id);
    const included = !excluded.has(t.id);
    let reason: string | null = null;
    if (!included) reason = "Left out of this plan.";
    else if (unplaced) reason = unplaced.reason;
    else if (!minutes && remaining <= 0)
      reason = "It already has sessions planned.";
    return {
      item_id: t.id,
      title: t.title,
      due_at: t.due_at,
      priority: t.priority,
      team_id: t.team_id,
      list_id: t.list_id,
      estimate_minutes: estimate,
      estimate_tuned: state.estimates[t.id] !== undefined,
      estimate_guess: guess && { minutes: guess.minutes, basis: guess.basis },
      included,
      planned_minutes: Math.round(minutes),
      reason,
      at_risk: result.at_risk.some((a) => a.item_id === t.id),
    };
  });
}

type PlanRow = {
  id: string;
  starts_on: string | Date;
  days: number;
  options: {
    input?: Partial<PlanState>;
    resolved?: PlanOptions;
    at_risk?: Plan["at_risk"];
    capacity_minutes?: number;
    planned_minutes?: number;
    summary?: string;
    tasks?: PlanTask[];
    fingerprint?: string;
    superseded_by?: string;
    estimates_saved?: string[];
  };
  blocks: Plan["blocks"];
  unplaced: Plan["unplaced"];
  applied: boolean;
  expires_at: Date;
};

const PLAN_COLUMNS =
  "id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, days, options, blocks, unplaced, applied, expires_at";

async function planRow(db: Db, id: string, userId: string, lock = false) {
  const row = (
    await db.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1 AND user_id = $2${lock ? " FOR UPDATE" : ""}`,
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Plan not found");
  return row;
}

export async function planById(
  db: Db,
  id: string,
  userId: string,
): Promise<Plan> {
  const row = await planRow(db, id, userId);
  return {
    id: row.id,
    starts_on: String(row.starts_on),
    days: row.days,
    blocks: row.blocks,
    unplaced: row.unplaced,
    at_risk: row.options.at_risk ?? [],
    capacity_minutes: row.options.capacity_minutes ?? 0,
    planned_minutes: row.options.planned_minutes ?? 0,
    applied: row.applied,
    expires_at: row.expires_at.toISOString(),
    summary: row.options.summary ?? "",
    tasks: row.options.tasks ?? [],
    ...(row.options.resolved ? { options: row.options.resolved } : {}),
    superseded_by: row.options.superseded_by ?? null,
    estimates_saved: row.options.estimates_saved ?? [],
  };
}

/**
 * Save tuned estimates on the tasks, through `mutate()`, for the tasks the
 * user can edit. Returns the ids saved.
 */
async function saveEstimates(
  db: Tx,
  actor: { id: string; role: "admin" | "member" },
  estimates: Record<string, number>,
) {
  const saved: string[] = [];
  for (const [id, minutes] of Object.entries(estimates)) {
    const row = (
      await db.query<{
        team_id: string | null;
        estimate_minutes: number | null;
      }>(
        `SELECT i.team_id, i.estimate_minutes FROM items i
         WHERE i.id = $2 AND i.kind = 'task' AND ${VISIBLE_ITEMS}`,
        [actor.id, id],
      )
    ).rows[0];
    if (!row || row.estimate_minutes === minutes) continue;
    if (row.team_id) {
      const role = await membershipRole(row.team_id, actor.id, db);
      if (!role || !hasTeamPermission(role, "items:write")) continue;
    }
    const item: Item = await loadItem(db, id);
    const { version, ...data } = itemBody(item);
    const iso = (v: unknown) =>
      v ? new Date(v as string).toISOString() : null;
    await mutate(db, actor, {
      operation: "update",
      item_id: id,
      version,
      data: {
        ...data,
        due_at: iso(item.due_at),
        end_at: iso(item.end_at),
        estimate_minutes: minutes,
      },
    });
    saved.push(id);
  }
  return saved;
}

/**
 * Make a plan again with some tuning (tasks in or out, estimates, pinned
 * blocks, keep-free times, scope). The old plan is replaced: it expires now
 * and points at the new one.
 */
export async function tunePlan(
  db: Tx,
  actor: { id: string; role: "admin" | "member" },
  id: string,
  d: TuneInput,
  now = new Date(),
): Promise<Plan> {
  const row = await planRow(db, id, actor.id, true);
  if (row.applied) fail(409, "This plan was already applied.");
  if (row.options.superseded_by)
    fail(409, "This plan was replaced by a newer one.");
  if (row.expires_at <= now) fail(409, "This plan expired. Make a new one.");
  const prev = stateOf(row.options.input ?? {});
  const next: PlanState = {
    ...prev,
    include_item_ids: d.include_item_ids ?? prev.include_item_ids,
    exclude_item_ids: d.exclude_item_ids ?? prev.exclude_item_ids,
    estimates: { ...prev.estimates, ...d.estimates },
    keep_free: d.keep_free ?? prev.keep_free,
    pinned_blocks: d.pinned_blocks ?? prev.pinned_blocks,
    scope: d.scope === undefined ? prev.scope : (d.scope ?? undefined),
  };
  const saved =
    d.save_estimates && d.estimates
      ? await saveEstimates(db, actor, d.estimates)
      : [];
  const plan = await makePlan(db, actor.id, next, now, saved);
  await db.query(
    `UPDATE plans SET expires_at = least(expires_at, now()),
       options = options || jsonb_build_object('superseded_by', $2::text)
     WHERE id = $1`,
    [row.id, plan.id],
  );
  return plan;
}

/**
 * Whether a plan no longer matches the calendar or tasks it was made from,
 * so the apps can make it again. Expired and replaced plans are stale too;
 * applied ones never are.
 */
export async function planStale(
  db: Db,
  id: string,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const row = await planRow(db, id, userId);
  if (row.applied) return false;
  if (row.options.superseded_by || row.expires_at <= now) return true;
  if (!row.options.fingerprint) return true;
  const inputs = await planInputs(
    db,
    userId,
    stateOf(row.options.input ?? {}),
    now,
  );
  return fingerprint(inputs) !== row.options.fingerprint;
}

type Span = { start: number; end: number };

/** Working hours between two instants, as spans. */
export function workingSpans(
  prefs: PlannerPrefs,
  from: Date,
  to: Date,
): Span[] {
  const spans: Span[] = [];
  const last = localDateKey(to, prefs.timezone);
  for (
    let day = localDateKey(from, prefs.timezone);
    day <= last;
    day = addDays(day, 1)
  ) {
    if (!prefs.work_days.includes(weekdayOf(day))) continue;
    const start = Math.max(
      dayTime(day, clockMinutes(prefs.work_start), prefs.timezone).getTime(),
      from.getTime(),
    );
    const end = Math.min(
      dayTime(day, clockMinutes(prefs.work_end), prefs.timezone).getTime(),
      to.getTime(),
    );
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/** Spans minus busy intervals. */
export function freeSpans(spans: Span[], busy: BusyInterval[]): Span[] {
  const merged = mergeIntervals(busy).map((b) => ({
    start: Date.parse(b.start_at),
    end: Date.parse(b.end_at),
  }));
  const out: Span[] = [];
  for (const span of spans) {
    let cursor = span.start;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= span.end) continue;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < span.end) out.push({ start: cursor, end: span.end });
  }
  return out;
}

const FIVE_MINUTES = 5 * 60_000;

/**
 * The next free working slot of `minutes` in the coming week, starting no
 * earlier than `after` (now when omitted).
 */
export async function workingFree(
  db: Db,
  userId: string,
  minutes: number,
  excludeBlockIds: string[] = [],
  now = new Date(),
  after?: Date,
): Promise<BusyInterval | null> {
  const prefs = await loadPrefs(db, userId);
  const earliest = Math.max(now.getTime(), after?.getTime() ?? 0);
  const from = new Date(Math.ceil(earliest / FIVE_MINUTES) * FIVE_MINUTES);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const busy = await busyIntervals(db, userId, from, to, {
    blocks: true,
    derived: true,
    excludeBlockIds,
  });
  const need = minutes * 60_000;
  const slot = freeSpans(workingSpans(prefs, from, to), busy).find(
    (s) => s.end - Math.ceil(s.start / FIVE_MINUTES) * FIVE_MINUTES >= need,
  );
  if (!slot) return null;
  const start = Math.ceil(slot.start / FIVE_MINUTES) * FIVE_MINUTES;
  return {
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + need).toISOString(),
  };
}

/**
 * The longest free working stretch left today, in minutes, or on the next
 * working day once today can't hold even one minimum block (the planner's
 * `min_block_minutes`): with a few minutes to go, today is over for planning
 * purposes. The priority score's size term compares estimates with it.
 */
export async function largestFreeMinutes(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<number> {
  const prefs = await loadPrefs(db, userId);
  const today = localDateKey(now, prefs.timezone);
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const from = i ? dayTime(day, 0, prefs.timezone) : now;
    const to = dayTime(addDays(day, 1), 0, prefs.timezone);
    const spans = workingSpans(prefs, from, to);
    if (!spans.length) continue;
    const busy = await busyIntervals(db, userId, from, to);
    const free = freeSpans(spans, busy);
    const largest = Math.round(
      Math.max(0, ...free.map((s) => (s.end - s.start) / 60_000)),
    );
    if (i === 0 && largest < prefs.min_block_minutes) continue;
    return largest;
  }
  return 0;
}

const REVIEW_DAYS = 14;

/**
 * Past blocks (ended before `before`) whose tasks are still open and have no
 * time set aside from `before` on: the work to roll forward.
 */
export async function unfinishedBlocks(
  db: Db,
  userId: string,
  before: Date,
): Promise<TimeBlock[]> {
  return (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.user_id = $1 AND b.end_at < $2 AND b.end_at > $2 - interval '14 days'
         AND i.status NOT IN ('done', 'cancelled') AND ${VISIBLE_ITEMS}
         AND NOT EXISTS (SELECT 1 FROM time_blocks f
                         WHERE f.item_id = b.item_id AND f.user_id = $1 AND f.start_at >= $2)
       ORDER BY b.start_at`,
      [userId, before],
    )
  ).rows.map((b) => ({
    ...b,
    start_at: new Date(b.start_at).toISOString(),
    end_at: new Date(b.end_at).toISOString(),
  }));
}

/**
 * Open tasks due in the next two weeks whose remaining estimate is more than
 * the free working time before they're due.
 */
export async function atRiskFor(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<AtRiskTask[]> {
  const horizon = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
  const [tasks, prefs] = await Promise.all([
    candidateTasks(db, userId),
    loadPrefs(db, userId),
  ]);
  const due = tasks.filter((t) => {
    if (!t.due_at || t.status === "blocked") return false;
    const at = Date.parse(t.due_at);
    return at > now.getTime() && at <= horizon.getTime();
  });
  if (!due.length) return [];
  const busy = await busyIntervals(db, userId, now, horizon, {
    blocks: false,
    derived: true,
  });
  const free = freeSpans(workingSpans(prefs, now, horizon), busy);
  const atRisk: AtRiskTask[] = [];
  for (const t of due) {
    const dueAt = Date.parse(t.due_at!);
    const remaining = Math.max(0, remainingOf(t) - t.scheduled_minutes);
    if (!remaining) continue;
    const freeMinutes = Math.round(
      free.reduce(
        (sum, s) =>
          sum + Math.max(0, Math.min(s.end, dueAt) - s.start) / 60_000,
        0,
      ),
    );
    if (remaining > freeMinutes)
      atRisk.push({
        item_id: t.id,
        title: t.title,
        due_at: t.due_at,
        reason: `Needs ${hoursLabel(remaining)} more, with ${hoursLabel(freeMinutes)} free before it's due.`,
        remaining_minutes: remaining,
        free_minutes: freeMinutes,
      });
  }
  return atRisk;
}

/** Open tasks that need time: yours and team tasks assigned to you. */
export const openTasks = (db: Db, userId: string) => candidateTasks(db, userId);

/** Unfinished blocks, tasks at risk of running late, and blocks that clash with events. */
export async function reviewFor(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<PlannerReview> {
  const horizon = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
  const [unfinished, entries, blocks, atRisk] = await Promise.all([
    unfinishedBlocks(db, userId, now),
    agendaEntries(db, userId, now, horizon, { hidden: true }),
    timeBlocks(db, userId, now, horizon),
    atRiskFor(db, userId, now),
  ]);
  // Only busy time clashes: your timed events and subscribed ones that count
  // as busy (a class, a shift, an exam day). Free events don't.
  const events = entries.filter((e) => e.busy);
  const nowIso = now.toISOString();
  const conflicts: PlannerReview["conflicts"] = [];
  for (const block of blocks) {
    if (block.start_at < nowIso) continue;
    const entry = events.find(
      (e) => e.start_at < block.end_at && block.start_at < e.end_at,
    );
    if (entry) conflicts.push({ block, entry });
  }
  return { unfinished, at_risk: atRisk, conflicts };
}

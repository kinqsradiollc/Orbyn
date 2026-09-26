import {
  HttpError,
  planDaysBefore,
  type BusyInterval,
  type Plan,
  type PlannedBlock,
  type PlanScope,
  type PlanTuneInput,
} from "@orbyn/core";
import { client } from "./api";
import { deviceTimeZone } from "./planning";

/** A 409: the plan expired or was replaced, so it can't be tuned any more. */
export const isConflict = (e: unknown) =>
  (e instanceof HttpError && e.statusCode === 409) ||
  (e as { status?: number } | null)?.status === 409;

/**
 * Tuning a proposed plan. Every change asks the server to make the plan again
 * (`PATCH /planner/plans/:id`) and answers with the new plan that replaces it.
 */
const tune = (plan: Plan, input: PlanTuneInput) =>
  client.tunePlan(plan.id, input);

const sameStart = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/** The plan's pinned blocks without `block`, to send back with a change. */
const pinsWithout = (plan: Plan, block: PlannedBlock) =>
  (plan.options?.pinned_blocks ?? []).filter(
    (p) =>
      !(p.item_id === block.item_id && sameStart(p.start_at, block.start_at)),
  );

/** Put a task in the plan, or leave it out. */
export function setIncluded(plan: Plan, itemId: string, included: boolean) {
  const include = plan.options?.include_item_ids ?? [];
  const exclude = plan.options?.exclude_item_ids ?? [];
  return tune(
    plan,
    included
      ? {
          include_item_ids: [...new Set([...include, itemId])],
          exclude_item_ids: exclude.filter((id) => id !== itemId),
        }
      : {
          include_item_ids: include.filter((id) => id !== itemId),
          exclude_item_ids: [...new Set([...exclude, itemId])],
        },
  );
}

/** Plan a task for this many minutes, and save that estimate on it when asked. */
export const setLength = (
  plan: Plan,
  itemId: string,
  minutes: number,
  save: boolean,
) => tune(plan, { estimates: { [itemId]: minutes }, save_estimates: save });

/**
 * Remove one proposed block. A task with only this block is left out; a split
 * task is planned for that much less time (the planner pads estimates, so the
 * padding comes off too).
 */
export function removeBlock(plan: Plan, block: PlannedBlock) {
  const pinned_blocks = pinsWithout(plan, block);
  const siblings = plan.blocks.filter((b) => b.item_id === block.item_id);
  if (siblings.length <= 1) {
    const exclude = plan.options?.exclude_item_ids ?? [];
    return tune(plan, {
      exclude_item_ids: [...new Set([...exclude, block.item_id])],
      pinned_blocks,
    });
  }
  const minutes = (b: PlannedBlock) =>
    (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000;
  const planned =
    plan.tasks?.find((t) => t.item_id === block.item_id)?.planned_minutes ??
    siblings.reduce((sum, b) => sum + minutes(b), 0);
  const pad = 1 + (plan.options?.pad_percent ?? 0) / 100;
  return tune(plan, {
    estimates: {
      [block.item_id]: Math.max(
        1,
        Math.round((planned - minutes(block)) / pad),
      ),
    },
    pinned_blocks,
  });
}

/** Keep a proposed block at new times; the rest of the plan fits around it. */
export const pinBlock = (
  plan: Plan,
  block: PlannedBlock,
  start: Date,
  end: Date,
) =>
  tune(plan, {
    pinned_blocks: [
      ...pinsWithout(plan, block),
      {
        item_id: block.item_id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
      },
    ],
  });

/** Let a pinned block move again; the plan places it wherever fits best. */
export const unpinBlock = (plan: Plan, block: PlannedBlock) =>
  tune(plan, { pinned_blocks: pinsWithout(plan, block) });

export const setKeepFree = (plan: Plan, keep_free: BusyInterval[]) =>
  tune(plan, { keep_free });

/** Which tasks the plan takes; null plans from everything. */
export const setScope = (plan: Plan, scope: PlanScope | null) =>
  tune(plan, { scope });

/**
 * Make the plan again against the calendar as it is now, keeping its tuning.
 * A plan that expired or was replaced can't be tuned, so it's previewed anew
 * with the same options and tuned again.
 */
export async function remakePlan(plan: Plan): Promise<Plan> {
  try {
    return await tune(plan, {});
  } catch (e) {
    const o = plan.options;
    if (!isConflict(e) || !o) throw e;
    const fresh = await client.previewPlan({
      start_date: o.start_date,
      days: o.days,
      pad_percent: o.pad_percent,
      split: o.split,
      break_level: o.break_level,
      use_frames: o.use_frames,
      keep_free: o.keep_free,
      exclude_item_ids: o.exclude_item_ids,
      timezone: o.timezone,
      ...(o.item_ids ? { item_ids: o.item_ids } : {}),
      ...(o.scope ? { scope: o.scope } : {}),
    });
    const tuned =
      o.include_item_ids.length ||
      Object.keys(o.estimates).length ||
      o.pinned_blocks.length;
    return tuned
      ? tune(fresh, {
          include_item_ids: o.include_item_ids,
          estimates: o.estimates,
          pinned_blocks: o.pinned_blocks,
        })
      : fresh;
  }
}

/** Days up to a deadline, counted in the planner's zone (the phone's for UTC). */
async function daysUntil(deadline?: string | null) {
  if (!deadline) return undefined;
  const zone = await client
    .getPlannerPrefs()
    .then((p) => (p.timezone === "UTC" ? deviceTimeZone() : p.timezone))
    .catch(() => deviceTimeZone());
  return planDaysBefore(deadline, new Date(), zone);
}

/**
 * A plan for one task alone ("Plan it" on a Today row), looking ahead as
 * far as its deadline, as the web does.
 */
export async function planOnly(itemId: string, deadline?: string | null) {
  const days = await daysUntil(deadline);
  return client.previewPlan({
    timezone: deviceTimeZone(),
    item_ids: [itemId],
    ...(days ? { days } : {}),
  });
}

/**
 * A fresh plan that makes sure one task is in it ("Plan it" on a notice),
 * looking ahead as far as the task's deadline (`deadline`, counted in the
 * planner's zone) as the web does.
 */
export async function planIncluding(
  itemId?: string | null,
  deadline?: string | null,
) {
  const days = await daysUntil(deadline);
  const plan = await client.previewPlan({
    timezone: deviceTimeZone(),
    ...(days ? { days } : {}),
  });
  if (
    !itemId ||
    plan.tasks?.some((t) => t.item_id === itemId && t.included) ||
    (!plan.tasks && plan.blocks.some((b) => b.item_id === itemId))
  )
    return plan;
  return tune(plan, { include_item_ids: [itemId] });
}

import { useCallback, useEffect, useState } from "react";
import { dependencyConflict } from "@orbyn/core";
import type {
  BusyInterval,
  HttpError,
  Item,
  Plan,
  PlannedBlock,
  PlanScope,
  PlanTuneInput,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

/** How often an open preview checks whether it went stale. */
const STALE_POLL_MS = 30_000;

/** A plan's tuning so far (plans made before tuning have none). */
export const tuningOf = (plan: Plan) => {
  const o = plan.options;
  return {
    keepFree: o?.keep_free ?? [],
    pinned: o?.pinned_blocks ?? [],
    include: o?.include_item_ids ?? [],
    exclude: o?.exclude_item_ids ?? [],
    scope: o?.scope ?? null,
  };
};

const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const without = (ids: string[], id: string) => ids.filter((x) => x !== id);
const withId = (ids: string[], id: string) => [...without(ids, id), id];

export type PlanTuning = ReturnType<typeof usePlanTuning>;

/**
 * Tuning a previewed plan. Every change asks the server for a new plan and
 * swaps to it (the old one expires). While `active`, it also checks whether
 * the plan went stale, every 30 seconds and whenever `stamp` (the calendar
 * data) changes, and `refresh` makes it again with the same options.
 */
export function usePlanTuning(
  plan: Plan | null,
  setPlan: (plan: Plan) => void,
  active: boolean,
  stamp: unknown,
  report: (e: unknown) => void,
  /** For what waits on what: a pin that breaks the order is refused. */
  items: Item[] = [],
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const planId = plan?.id;
  const live = !!plan && !plan.applied;
  const state = plan && live ? tuningOf(plan) : null;

  useEffect(() => {
    setStale(false);
    setError("");
  }, [planId]);

  const fail = (e: unknown) => {
    const status = (e as HttpError).status;
    if (status === 401) report(e);
    if (status === 409) {
      setStale(true);
      setError("This plan was replaced or has expired. Refresh it to go on.");
    } else setError(errorText(e));
  };

  /** Resolves true once the new plan is showing. */
  const tune = async (input: PlanTuneInput) => {
    if (!plan || plan.applied || pending) return false;
    setPending(true);
    setError("");
    try {
      setPlan(await client.tunePlan(plan.id, input));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setPending(false);
    }
  };

  const setIncluded = (itemId: string, included: boolean) =>
    state
      ? tune({
          include_item_ids: included
            ? withId(state.include, itemId)
            : without(state.include, itemId),
          exclude_item_ids: included
            ? without(state.exclude, itemId)
            : withId(state.exclude, itemId),
        })
      : Promise.resolve(false);

  const setEstimate = (itemId: string, minutes: number, save: boolean) =>
    tune({ estimates: { [itemId]: minutes }, save_estimates: save });

  const isPin = (
    p: { item_id: string; start_at: string },
    ghost: PlannedBlock,
  ) =>
    !!ghost.pinned &&
    p.item_id === ghost.item_id &&
    sameTime(p.start_at, ghost.start_at);

  /** A planned block dragged to a new time stays there. */
  const pin = (ghost: PlannedBlock, start: Date, end: Date) => {
    const clash =
      plan && dependencyConflict(ghost.item_id, start, end, plan, items);
    if (clash) {
      setError(clash);
      return Promise.resolve(false);
    }
    return state
      ? tune({
          pinned_blocks: [
            ...state.pinned.filter((p) => !isPin(p, ghost)),
            {
              item_id: ghost.item_id,
              start_at: start.toISOString(),
              end_at: end.toISOString(),
            },
          ],
        })
      : Promise.resolve(false);
  };

  /** × on a planned block: unpin it, or leave its task out. */
  const remove = (ghost: PlannedBlock) =>
    !state
      ? Promise.resolve(false)
      : ghost.pinned
        ? tune({ pinned_blocks: state.pinned.filter((p) => !isPin(p, ghost)) })
        : setIncluded(ghost.item_id, false);

  const keepFree = (start: Date, end: Date) =>
    state
      ? tune({
          keep_free: [
            ...state.keepFree,
            { start_at: start.toISOString(), end_at: end.toISOString() },
          ],
        })
      : Promise.resolve(false);

  const dropKeepFree = (range: BusyInterval) =>
    state
      ? tune({
          keep_free: state.keepFree.filter(
            (r) =>
              !(
                sameTime(r.start_at, range.start_at) &&
                sameTime(r.end_at, range.end_at)
              ),
          ),
        })
      : Promise.resolve(false);

  const setScope = (scope: PlanScope | null) => tune({ scope });

  /** Make the plan again with the same options and tuning. */
  const refresh = async () => {
    if (!plan) return;
    const o = plan.options;
    setPending(true);
    setError("");
    try {
      let next = await client.previewPlan(
        o
          ? {
              start_date: o.start_date,
              days: o.days,
              pad_percent: o.pad_percent,
              split: o.split,
              break_level: o.break_level,
              use_frames: o.use_frames,
              timezone: o.timezone,
              keep_free: o.keep_free,
              item_ids: o.item_ids ?? undefined,
              exclude_item_ids: o.exclude_item_ids,
              scope: o.scope ?? undefined,
            }
          : { start_date: plan.starts_on, days: plan.days },
      );
      setPlan(next);
      setStale(false);
      if (
        o &&
        (o.include_item_ids.length ||
          Object.keys(o.estimates).length ||
          o.pinned_blocks.length)
      ) {
        next = await client.tunePlan(next.id, {
          include_item_ids: o.include_item_ids,
          estimates: o.estimates,
          pinned_blocks: o.pinned_blocks,
        });
        setPlan(next);
      }
    } catch (e) {
      fail(e);
    } finally {
      setPending(false);
    }
  };

  const check = useCallback(async () => {
    if (!planId) return;
    try {
      setStale((await client.planStale(planId)).stale);
    } catch {
      // Try again on the next check.
    }
  }, [planId]);
  useEffect(() => {
    if (!active || !live) return;
    void check();
    const id = setInterval(() => void check(), STALE_POLL_MS);
    return () => clearInterval(id);
  }, [active, live, check, stamp]);

  return {
    pending,
    error,
    stale,
    /** The live plan's tuning, or null when there's nothing to tune. */
    state,
    tune,
    setIncluded,
    setEstimate,
    pin,
    remove,
    keepFree,
    dropKeepFree,
    setScope,
    refresh,
  };
}

import {
  dependencyConflict,
  planOutcome,
  type BusyInterval,
  type Item,
  type Plan,
  type PlannedBlock,
  type PlanPreviewInput,
  type PlanScope,
  type PlanTuneInput,
} from "@orbyn/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf, proposalsOf, statusOf } from "./model";

const STALE_POLL_MS = 30_000;

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

/**
 * One previewed plan and every change to it. Nothing is saved until Apply:
 * each change asks the server for a new plan and swaps to it. While open it
 * checks whether the plan went stale, every 30 seconds and whenever the
 * calendar data changes.
 */
export function usePlan(items: Item[], stamp: unknown) {
  const [plan, setPlanState] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  /** Ticks on offered moves, kept while the plan is tuned. */
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const live = !!plan && !plan.applied;
  const planId = plan?.id;
  const state = useMemo(
    () => (plan && live ? tuningOf(plan) : null),
    [plan, live],
  );
  const busy = useRef(false);

  useEffect(() => {
    setStale(false);
    setError("");
  }, [planId]);

  const fail = useCallback((failure: unknown, fallback: string) => {
    if (statusOf(failure) === 409) {
      setStale(true);
      setError("This plan was replaced or has expired. Refresh it to go on.");
    } else setError(messageOf(failure, fallback));
  }, []);

  /** Run one plan change at a time, keeping what's shown if it fails. */
  const run = useCallback(
    async (work: () => Promise<Plan | null>, fallback: string) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      setError("");
      try {
        const next = await work();
        if (next) setPlanState(next);
        return true;
      } catch (failure) {
        fail(failure, fallback);
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [fail],
  );

  const preview = useCallback(
    (input: PlanPreviewInput, include?: string[], projectId?: string) =>
      run(async () => {
        let next = projectId
          ? await client.planProject(projectId, input.timezone)
          : await client.previewPlan(input);
        // "Plan it": make sure the task is in, even outside the scope.
        if (
          include?.length &&
          !include.every((id) =>
            next.tasks?.some((t) => t.item_id === id && t.included),
          )
        )
          next = await client.tunePlan(next.id, { include_item_ids: include });
        setTicks({});
        return next;
      }, "Couldn't make a plan."),
    [run],
  );

  const show = useCallback((next: Plan | null) => {
    setPlanState(next);
    if (!next) setTicks({});
  }, []);

  const rollForward = useCallback(
    (ids?: string[]) =>
      run(() => client.rollForward(ids), "Couldn't plan the unfinished work."),
    [run],
  );

  const tune = useCallback(
    (input: PlanTuneInput) => {
      if (!plan || plan.applied) return Promise.resolve(false);
      return run(
        () => client.tunePlan(plan.id, input),
        "Couldn't update the plan.",
      );
    },
    [plan, run],
  );

  const setIncluded = useCallback(
    (itemId: string, included: boolean) =>
      state
        ? tune({
            include_item_ids: included
              ? withId(state.include, itemId)
              : without(state.include, itemId),
            exclude_item_ids: included
              ? without(state.exclude, itemId)
              : withId(state.exclude, itemId),
          })
        : Promise.resolve(false),
    [state, tune],
  );

  const setEstimate = useCallback(
    (itemId: string, minutes: number, save: boolean) =>
      tune({ estimates: { [itemId]: minutes }, save_estimates: save }),
    [tune],
  );

  /** A planned session moved by hand stays there; the rest plan around it. */
  const pin = useCallback(
    (ghost: PlannedBlock, start: Date, end: Date) => {
      const clash =
        plan && dependencyConflict(ghost.item_id, start, end, plan, items);
      if (clash) {
        setError(clash);
        return Promise.resolve(false);
      }
      if (!state) return Promise.resolve(false);
      const isThis = (p: { item_id: string; start_at: string }) =>
        !!ghost.pinned &&
        p.item_id === ghost.item_id &&
        sameTime(p.start_at, ghost.start_at);
      return tune({
        pinned_blocks: [
          ...state.pinned.filter((p) => !isThis(p)),
          {
            item_id: ghost.item_id,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
          },
        ],
      });
    },
    [items, plan, state, tune],
  );

  /** Unpin a pinned session, or leave its task out of the plan. */
  const remove = useCallback(
    (ghost: PlannedBlock) => {
      if (!state) return Promise.resolve(false);
      if (!ghost.pinned) return setIncluded(ghost.item_id, false);
      return tune({
        pinned_blocks: state.pinned.filter(
          (p) =>
            !(
              p.item_id === ghost.item_id &&
              sameTime(p.start_at, ghost.start_at)
            ),
        ),
      });
    },
    [setIncluded, state, tune],
  );

  const keepFree = useCallback(
    (start: Date, end: Date) =>
      state
        ? tune({
            keep_free: [
              ...state.keepFree,
              { start_at: start.toISOString(), end_at: end.toISOString() },
            ],
          })
        : Promise.resolve(false),
    [state, tune],
  );

  const dropKeepFree = useCallback(
    (range: BusyInterval) =>
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
        : Promise.resolve(false),
    [state, tune],
  );

  const setScope = useCallback(
    (scope: PlanScope | null) => tune({ scope }),
    [tune],
  );

  /** Make the plan again with the same options and tuning. */
  const refresh = useCallback(() => {
    if (!plan) return Promise.resolve(false);
    const o = plan.options;
    return run(async () => {
      let next = o?.project_id
        ? await client.planProject(o.project_id, o.timezone)
        : await client.previewPlan(
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
      if (
        o &&
        (o.include_item_ids.length ||
          Object.keys(o.estimates).length ||
          o.pinned_blocks.length)
      )
        next = await client.tunePlan(next.id, {
          include_item_ids: o.include_item_ids,
          estimates: o.estimates,
          pinned_blocks: o.pinned_blocks,
        });
      setStale(false);
      return next;
    }, "Couldn't refresh the plan.");
  }, [plan, run]);

  const check = useCallback(async () => {
    if (!planId) return;
    try {
      const { stale: now } = await client.planStale(planId);
      setStale(now);
    } catch {
      // Try again on the next check.
    }
  }, [planId]);

  useEffect(() => {
    if (!open || !live) return;
    void check();
    const id = setInterval(() => void check(), STALE_POLL_MS);
    return () => clearInterval(id);
  }, [open, live, check, stamp]);

  /** Save the plan: its sessions, and the moves ticked. */
  const apply = useCallback(async () => {
    if (!plan || busy.current) return null;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const moves = (plan.moves ?? []).filter(
        (m) => ticks[m.block_id] ?? m.selected,
      );
      const result = await client.applyPlan(plan.id, {
        moves: moves.map((m) => m.block_id),
      });
      setPlanState({ ...plan, applied: true });
      const firstAt = [
        ...plan.blocks.map((b) => b.start_at),
        ...moves.map((m) => m.start_at),
      ].sort()[0];
      return { text: planOutcome(result, plan.at_risk), at: firstAt };
    } catch (failure) {
      fail(failure, "Couldn't apply this plan.");
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [fail, plan, ticks]);

  const close = useCallback(() => {
    setOpen(false);
    setPlanState(null);
    setTicks({});
    setError("");
  }, []);

  const proposals = useMemo(
    () => (plan && !plan.applied ? proposalsOf(plan, ticks) : []),
    [plan, ticks],
  );

  return {
    plan,
    open,
    setOpen,
    close,
    pending,
    error,
    setError,
    stale,
    live,
    state,
    ticks,
    setTick: (id: string, on: boolean) => setTicks((t) => ({ ...t, [id]: on })),
    proposals,
    show,
    apply,
    preview,
    rollForward,
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

export type PlanState = ReturnType<typeof usePlan>;

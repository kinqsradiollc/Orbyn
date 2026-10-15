import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Switch } from "../components/Switch";
import {
  BREAK_LEVELS,
  dueDateOf,
  fitTone,
  localDateKey,
  PLAN_MAX_DAYS,
  planOutcome,
  type BreakLevel,
  type Item,
  type Plan,
  type PlannedBlock,
  type PlanScope,
  type PlanTask,
  type Team,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  ClockField,
  DateField,
  Field,
  NumberInput,
  TimeField,
} from "../components/Field";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { PlanView, tickedMoves } from "../components/PlanView";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { session } from "../lib/session";
import {
  deviceTimeZone,
  minutesLabel,
  parseMinutes,
  slotLabel,
} from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import {
  isConflict,
  pinBlock,
  remakePlan,
  removeBlock,
  setIncluded,
  setKeepFree,
  setLength,
  setScope,
  unpinBlock,
} from "../lib/plans";
import { usePlanStale } from "../hooks/usePlanStale";
import { HorizonView } from "../components/HorizonView";
import { RealityLine, WhatIfBox } from "../components/followthrough/PlanChecks";
import { PlanExperiments } from "../components/followthrough/PlanExperiments";
import { useRun } from "../hooks/useRun";
import { InlineDetails } from "../components/InlineDetails";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const DAYS = ["1", "2", "3", "4", "5", "6", "7", "14"] as const;
const DAY_LABELS = { "1": "Today" } as const;
/** Quick picks for padding, in percent; the saved setting joins them. */
const PADS = [0, 10, 15, 25, 50];
const BREAK_LABELS: Record<BreakLevel, string> = {
  none: "None",
  light: "Light",
  normal: "Normal",
  intense: "Often",
};
const TABS = ["plan", "days", "tasks", "free"] as const;
type PlanTab = (typeof TABS)[number];
const TAB_LABELS: Record<PlanTab, string> = {
  plan: "Timeline",
  days: "Days",
  tasks: "Tasks",
  free: "Keep free",
};
/** Personal tasks and team tasks assigned to you, from every team and list. */
const EVERYTHING: PlanScope = { personal: true, list_ids: [] };
const isEverything = (scope: PlanScope) =>
  scope.personal && !scope.team_ids && !scope.list_ids.length;

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const atClock = (day: string, clock: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = clock.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
};
const blockKey = (b: PlannedBlock) => `${b.item_id}-${b.start_at}`;
/** The day option for a number of days (1 to 7, or two weeks). */
const dayOption = (n: number) =>
  n >= 14 ? "14" : DAYS[Math.min(7, Math.max(1, Math.round(n) || 1)) - 1];
const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** "Due Fri 2 Oct, 3 pm · 1h planned of 2h". */
function taskLine(t: PlanTask) {
  const estimate = t.estimate_minutes
    ? minutesLabel(t.estimate_minutes) +
      (t.estimate_guess && !t.estimate_tuned
        ? t.estimate_guess.basis === "similar"
          ? " (like similar tasks)"
          : t.estimate_guess.basis === "typical"
            ? " (your usual task)"
            : ` (usual for this ${t.estimate_guess.basis})`
        : "")
    : "no estimate (counts as 30m)";
  return [
    // The deadline: an all-day task names its day, not its midnight.
    dueDateOf(t) ? `Due ${dueDateOf(t)}` : "",
    `${minutesLabel(t.planned_minutes) || "Nothing"} planned of ${estimate}${t.estimate_tuned ? ", changed for this plan" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Plan my day: choose how many days, how much to pad estimates, whether long
 * tasks split, how many breaks and which tasks to plan from, then preview a
 * plan that fits open tasks around events. The plan can be tuned before it's
 * applied: tasks in or out and their length, blocks removed or moved (a moved
 * block is pinned), and times kept free. Each change makes the plan again.
 * `seed` opens straight on a plan (unfinished work moved forward, or a plan
 * for a notice).
 */
export function PlanSheet({
  visible,
  seed,
  title,
  teams,
  items = [],
  onClose,
  onDismiss,
  onApplied,
  onShowOnCalendar,
  onShowDay,
}: {
  visible: boolean;
  /** For what waits on what, when a session moves to another day. */
  items?: Item[];
  seed: Plan | null;
  /** The sheet's title; "Move work forward" for a seed plan by default. */
  title?: string;
  /** For "Plan tasks from". */
  teams: Team[];
  onClose: () => void;
  onDismiss?: () => void;
  /** After a plan is applied, so the planner and calendar refresh. */
  onApplied: () => void;
  /** Show the plan as faint blocks on the calendar, to tune and apply there. */
  onShowOnCalendar?: (plan: Plan) => void;
  /** After a plan is applied: show the day of its first change on the calendar. */
  onShowDay?: (at: string) => void;
}) {
  const [bodyBusy, setBodyBusy] = useState(false);
  return (
    <Sheet
      visible={visible}
      hideClose={bodyBusy}
      title={title ?? (seed ? "Move work forward" : "Plan my day")}
      onClose={() => {
        if (!bodyBusy) onClose();
      }}
      onDismiss={onDismiss}
    >
      <Body
        key={seed?.id ?? "new"}
        seed={seed}
        teams={teams}
        items={items}
        onApplied={onApplied}
        onBusyChange={setBodyBusy}
        onDone={onClose}
        onShowOnCalendar={onShowOnCalendar}
        onShowDay={onShowDay}
      />
    </Sheet>
  );
}

function Body({
  seed,
  teams,
  items,
  onApplied,
  onBusyChange,
  onDone,
  onShowOnCalendar,
  onShowDay,
}: {
  onBusyChange: (busy: boolean) => void;
  seed: Plan | null;
  teams: Team[];
  items: Item[];
  onApplied: () => void;
  onDone: () => void;
  onShowOnCalendar?: (plan: Plan) => void;
  onShowDay?: (at: string) => void;
}) {
  const { lists } = usePlanning();
  const { busy: runBusy, error, setError, run: runBase } = useRun();
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [prefsVersion, setPrefsVersion] = useState(0);
  const busy = runBusy || prefsLoading;
  const mutation = useRef(false);
  const run = async <T,>(fn: () => Promise<T>) => {
    if (mutation.current) return;
    mutation.current = true;
    try {
      return await runBase(fn);
    } finally {
      mutation.current = false;
    }
  };
  useEffect(() => {
    onBusyChange(runBusy);
    return () => onBusyChange(false);
  }, [runBusy, onBusyChange]);
  // A seed plan (moved forward, or from the calendar) starts from its options.
  const o = seed?.options;
  /** The planner's saved zone: the server reads start_date as a day there. */
  const [zone, setZone] = useState<string | null>(null);
  const [workStart, setWorkStart] = useState("09:00");
  /** A session is being dragged: the page holds still. */
  const [dragging, setDragging] = useState(false);
  const today = localDateKey(new Date(), zone ?? deviceTimeZone());
  const [days, setDays] = useState<(typeof DAYS)[number]>(
    o ? dayOption(o.days) : "1",
  );
  const [pad, setPad] = useState(o?.pad_percent ?? 15);
  const [split, setSplit] = useState(o?.split ?? true);
  const [breakLevel, setBreakLevel] = useState<BreakLevel>(
    o?.break_level ?? "normal",
  );
  const [useFrames, setUseFrames] = useState(o?.use_frames ?? true);
  /** A chosen first day, or null for today (in the planner's zone). */
  const [startDate, setStartDate] = useState<string | null>(
    o?.start_date && o.start_date > today ? o.start_date : null,
  );
  const start = startDate && startDate > today ? startDate : today;
  const [scope, setScopeState] = useState<PlanScope>(
    seed?.options?.scope ?? EVERYTHING,
  );
  const [plan, setPlan] = useState<Plan | null>(seed);
  /** What applying did, in words, and where its first change landed. */
  const [saved, setSaved] = useState<{
    text: string;
    at: string | null;
  } | null>(null);
  /**
   * Ticks changed on offered moves, by session, kept while the plan is
   * tuned (each tuning makes a new plan with the same sessions).
   */
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<PlanTab>("plan");
  /** A proposed block being moved (pinned) with the day and time fields. */
  const [moving, setMoving] = useState<{ key: string; start: Date } | null>(
    null,
  );
  /** A task whose length is being changed. */
  const [length, setLengthForm] = useState<{
    itemId: string;
    text: string;
    save: boolean;
  } | null>(null);
  /** A time to keep free, being added. */
  const [adding, setAdding] = useState<{
    day: string;
    from: string;
    to: string;
  } | null>(null);
  const [stale, markStale] = usePlanStale(saved ? null : plan);

  // Start from the saved planning settings.
  useEffect(() => {
    let alive = true;
    const account = session.token;
    const current = () => alive && account === session.token;
    setPrefsLoading(true);
    setPrefsFailed(false);
    client
      .getPlannerPrefs()
      .then((p) => {
        if (!current()) return;
        setPrefsLoading(false);
        setZone(p.timezone);
        setWorkStart(p.work_start);
        // A seed plan keeps its own options.
        if (seed) return;
        setPad(p.pad_percent);
        setBreakLevel(p.break_level);
        setDays(dayOption(p.horizon_days));
      })
      .catch(() => {
        if (current()) {
          setPrefsLoading(false);
          setPrefsFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [seed, prefsVersion]);
  const pads = [...new Set([...PADS, pad])].sort((a, b) => a - b);
  const tunable = !!plan && !plan.applied && !saved;
  const keepFree = plan?.options?.keep_free ?? [];
  const tasks = plan?.tasks ?? [];

  /** Tune the plan; the plan that comes back replaces it on screen. */
  const change = (fn: (p: Plan) => Promise<Plan>) =>
    run(async () => {
      if (!plan) return;
      let next: Plan;
      try {
        next = await fn(plan);
      } catch (e) {
        // Expired or replaced: say so, and offer Refresh.
        if (isConflict(e)) return markStale();
        throw e;
      }
      setPlan(next);
      setMoving(null);
      setLengthForm(null);
      setAdding(null);
    });

  const preview = (dayCount = Number(days), include?: string[]) =>
    run(async () => {
      let next = o?.project_id
        ? await client.planProject(o.project_id, deviceTimeZone())
        : await client.previewPlan({
            start_date: start,
            days: dayCount,
            pad_percent: pad,
            split,
            break_level: breakLevel,
            use_frames: useFrames,
            timezone: deviceTimeZone(),
            // A seed plan keeps its tasks and the times it keeps free.
            ...(o?.item_ids ? { item_ids: o.item_ids } : {}),
            ...(o
              ? { keep_free: o.keep_free, exclude_item_ids: o.exclude_item_ids }
              : {}),
            ...(isEverything(scope) ? {} : { scope }),
          });
      // Tasks added by hand ("Plan it") stay in, even outside the scope.
      if (
        include?.length &&
        !include.every((id) =>
          next.tasks?.some((t) => t.item_id === id && t.included),
        )
      )
        next = await client.tunePlan(next.id, { include_item_ids: include });
      setPlan(next);
      // A fresh plan after one was applied starts from the planner's ticks.
      if (saved) setTicks({});
      setSaved(null);
      setTab("plan");
    });

  const chosen = plan ? tickedMoves(plan, ticks) : [];
  const apply = () =>
    run(async () => {
      if (!plan) return;
      const result = await client.applyPlan(plan.id, { moves: chosen });
      setSaved({
        text: planOutcome(result, plan.at_risk),
        at:
          [...result.blocks, ...result.moved]
            .map((b) => b.start_at)
            .sort()[0] ?? null,
      });
      // The ticks stay: the applied plan shows what was moved.
      onApplied();
    });
  /** "Look further ahead": the same plan over the most days it can cover. */
  const lookAhead = () => {
    setDays(dayOption(PLAN_MAX_DAYS));
    void preview(PLAN_MAX_DAYS, plan?.options?.include_item_ids);
  };

  const chooseScope = (next: PlanScope) => {
    if (busy) return;
    setScopeState(next);
    if (tunable)
      void change((p) => setScope(p, isEverything(next) ? null : next));
  };
  const allTeams = teams.map((t) => t.id);
  const teamOn = (id: string) => !scope.team_ids || scope.team_ids.includes(id);
  const toggleTeam = (id: string) => {
    const next = toggle(scope.team_ids ?? allTeams, id);
    chooseScope({
      ...scope,
      team_ids: allTeams.every((t) => next.includes(t)) ? undefined : next,
    });
  };

  const saveLength = () => {
    if (!length) return;
    const minutes = parseMinutes(length.text);
    if (minutes === null || minutes < 1 || minutes > 10080) {
      setError("A length runs from 1 to 10080 minutes.");
      return;
    }
    void change((p) => setLength(p, length.itemId, minutes, length.save));
  };
  const addFree = () => {
    if (!adding) return;
    const start = atClock(adding.day, adding.from);
    const end = atClock(adding.day, adding.to);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      setError("Choose a day, start and end time.");
      return;
    }
    if (end <= start) {
      setError("End time must be after start time.");
      return;
    }
    void change((p) =>
      setKeepFree(p, [
        ...keepFree,
        { start_at: start.toISOString(), end_at: end.toISOString() },
      ]),
    );
  };

  const moveForm = (b: PlannedBlock) => {
    if (!moving || moving.key !== blockKey(b)) return null;
    const blockLength = Date.parse(b.end_at) - Date.parse(b.start_at);
    return (
      <PlanEditSheet
        title="Move session"
        busy={busy}
        error={error}
        onClose={() => setMoving(null)}
      >
        <View style={s.editor}>
          <Field label="Day">
            <DateField
              label="Day"
              disabled={busy}
              value={dayKeyOf(moving.start)}
              onChange={(day) => {
                if (!day) return;
                const [y, m, d] = day.split("-").map(Number);
                const next = new Date(moving.start);
                next.setFullYear(y, m - 1, d);
                setMoving({ ...moving, start: next });
              }}
            />
          </Field>
          <Field label="Starts at" hint="Moved sessions stay pinned.">
            <TimeField
              label="Start time"
              disabled={busy}
              value={moving.start}
              onChange={(start) => setMoving({ ...moving, start })}
            />
          </Field>
          <View style={s.row}>
            <Button
              title="Pin here"
              icon="pin"
              disabled={busy}
              style={s.flex}
              onPress={() =>
                void change((p) =>
                  pinBlock(
                    p,
                    b,
                    moving.start,
                    new Date(moving.start.getTime() + blockLength),
                  ),
                )
              }
            />
            <Button
              secondary
              title="Cancel"
              disabled={busy}
              style={s.flex}
              onPress={() => setMoving(null)}
            />
          </View>
        </View>
      </PlanEditSheet>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      scrollEnabled={!dragging}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        {!moving && !length && !adding && (
          <ErrorBanner error={error} onDismiss={() => setError("")} />
        )}
        {prefsLoading && (
          <Text style={shared.small} accessibilityLiveRegion="polite">
            Loading planning settings…
          </Text>
        )}
        {prefsFailed && (
          <View style={s.stale} accessibilityRole="alert">
            <Text style={s.staleText}>
              Planning settings unavailable. Using current options.
            </Text>
            <SmallAction
              label="Retry"
              disabled={runBusy}
              onPress={() => setPrefsVersion((v) => v + 1)}
            />
          </View>
        )}
        <Text style={[shared.small, s.intro]}>
          Preview only. Apply saves changes.
        </Text>
        <View style={shared.card}>
          <Field label="Start on">
            <DateField
              label="First day to plan"
              disabled={busy}
              value={start}
              minimumDate={new Date()}
              onChange={(day) => day && setStartDate(day)}
            />
          </Field>
          <Text style={shared.label}>Days to plan</Text>
          <Segmented
            wrap
            accessibilityLabel="Days to plan"
            disabled={busy}
            options={DAYS}
            labels={start === today ? DAY_LABELS : undefined}
            value={days}
            onChange={setDays}
          />
          <InlineDetails title="Scheduling options">
            <Text style={[shared.label, s.labelTop]}>Padding</Text>
            <ChipRow label="Pad estimates by">
              {pads.map((n) => (
                <Chip
                  key={n}
                  label={`${n}%`}
                  accessibilityLabel={`${n}% extra time`}
                  disabled={busy}
                  selected={pad === n}
                  onPress={() => setPad(n)}
                />
              ))}
            </ChipRow>
            <View style={s.stepper}>
              <SmallAction
                label="−5%"
                disabled={busy || pad <= 0}
                onPress={() => setPad(Math.max(0, pad - 5))}
              />
              <Text style={s.stepperValue} accessibilityLiveRegion="polite">
                {pad}% extra time
              </Text>
              <SmallAction
                label="+5%"
                disabled={busy || pad >= 100}
                onPress={() => setPad(Math.min(100, pad + 5))}
              />
            </View>
            <Text style={[shared.label, s.labelTop]}>
              Breaks between sessions
            </Text>
            <Segmented
              accessibilityLabel="Breaks between sessions"
              disabled={busy}
              options={BREAK_LEVELS}
              labels={BREAK_LABELS}
              value={breakLevel}
              onChange={setBreakLevel}
            />
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchTitle}>Split long tasks</Text>
              </View>
              <Switch
                value={split}
                disabled={busy}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Split long tasks"
                onValueChange={setSplit}
              />
            </View>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchTitle}>Use frames</Text>
                <Text style={shared.small}>
                  Only schedule inside matching frames.
                </Text>
              </View>
              <Switch
                value={useFrames}
                disabled={busy}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Use frames"
                onValueChange={setUseFrames}
              />
            </View>
          </InlineDetails>
          <Button
            title={
              runBusy && !plan
                ? "Planning…"
                : seed
                  ? "Preview again"
                  : plan
                    ? "Preview again"
                    : "Preview plan"
            }
            icon="sparkles"
            disabled={busy}
            style={s.preview}
            onPress={() => void preview()}
          />
        </View>

        <View style={shared.card}>
          <InlineDetails
            title={`Plan for · ${[scope.personal ? "Personal" : "", teams.length ? (!scope.team_ids ? "All teams" : `${scope.team_ids.length} teams`) : "", scope.list_ids.length ? `${scope.list_ids.length} lists` : ""].filter(Boolean).join(" · ") || "No tasks"}`}
          >
            <Text style={shared.label}>Plan tasks from</Text>
            <ChipRow label="Plan tasks from" multi>
              <Chip
                multi
                label="Personal"
                disabled={busy}
                selected={scope.personal}
                onPress={() =>
                  chooseScope({ ...scope, personal: !scope.personal })
                }
              />
              {teams.map((t) => (
                <Chip
                  key={t.id}
                  multi
                  label={t.name}
                  disabled={busy}
                  selected={teamOn(t.id)}
                  onPress={() => toggleTeam(t.id)}
                />
              ))}
            </ChipRow>
            <Text style={[shared.small, s.hint]}>
              Team tasks count when they’re assigned to you.
            </Text>
            {lists.length > 0 && (
              <>
                <Text style={[shared.label, s.labelTop]}>Only these lists</Text>
                <ChipRow label="Only these lists" multi>
                  {lists.map((l) => (
                    <Chip
                      key={l.id}
                      multi
                      color={l.color}
                      label={l.name}
                      disabled={busy}
                      selected={scope.list_ids.includes(l.id)}
                      onPress={() =>
                        chooseScope({
                          ...scope,
                          list_ids: toggle(scope.list_ids, l.id),
                        })
                      }
                    />
                  ))}
                </ChipRow>
                <Text style={[shared.small, s.hint]}>
                  None chosen means any list.
                </Text>
              </>
            )}
          </InlineDetails>
        </View>

        {tunable && stale && (
          <View style={s.stale} accessibilityRole="alert">
            <Text style={s.staleText}>
              Calendar changed. Refresh this plan.
            </Text>
            <SmallAction
              label="Refresh"
              disabled={busy}
              onPress={() => void change(remakePlan)}
            />
          </View>
        )}

        {plan && (
          <View style={shared.card}>
            <Text style={[shared.sectionTitle, s.gapBelow]}>Proposed plan</Text>
            {tunable && (
              <RealityLine plan={plan} timeZone={zone ?? deviceTimeZone()} />
            )}
            {tunable && (
              <Segmented
                accessibilityLabel="Plan view"
                options={
                  plan.days > 1 ? TABS : TABS.filter((t) => t !== "days")
                }
                labels={TAB_LABELS}
                value={tab}
                disabled={busy}
                onChange={(next) => {
                  setTab(next);
                }}
              />
            )}
            {(!tunable || tab === "plan") && (
              <View style={tunable ? s.tabBody : undefined}>
                <PlanView
                  plan={plan}
                  ticks={ticks}
                  onTick={
                    tunable
                      ? (id, on) => setTicks((t) => ({ ...t, [id]: on }))
                      : undefined
                  }
                  onLookAhead={tunable ? lookAhead : undefined}
                  actions={
                    tunable
                      ? {
                          busy,
                          onMove: (b) => {
                            setError("");
                            setMoving(
                              moving?.key === blockKey(b)
                                ? null
                                : {
                                    key: blockKey(b),
                                    start: new Date(b.start_at),
                                  },
                            );
                          },
                          onRemove: (b) =>
                            void change((p) => removeBlock(p, b)),
                          onUnpin: (b) => void change((p) => unpinBlock(p, b)),
                        }
                      : undefined
                  }
                  below={moveForm}
                />
              </View>
            )}
            {tunable && tab === "days" && plan.days > 1 && (
              <View style={s.tabBody}>
                <HorizonView
                  plan={plan}
                  items={items}
                  timeZone={zone ?? deviceTimeZone()}
                  workStart={workStart}
                  busy={busy}
                  onDragging={setDragging}
                  onPin={(b, start, end) =>
                    void change((p) => pinBlock(p, b, start, end))
                  }
                  onPlace={(itemId, start, end) =>
                    void change((p) =>
                      client.tunePlan(p.id, {
                        include_item_ids: [
                          ...(p.options?.include_item_ids ?? []).filter(
                            (x) => x !== itemId,
                          ),
                          itemId,
                        ],
                        exclude_item_ids: (
                          p.options?.exclude_item_ids ?? []
                        ).filter((x) => x !== itemId),
                        pinned_blocks: [
                          ...(p.options?.pinned_blocks ?? []),
                          {
                            item_id: itemId,
                            start_at: start.toISOString(),
                            end_at: end.toISOString(),
                          },
                        ],
                      }),
                    )
                  }
                />
              </View>
            )}
            {tunable && tab === "tasks" && (
              <View style={s.tabBody}>
                <Text style={[shared.small, s.gapBelow]}>
                  Choose tasks and their planned time.
                </Text>
                {tasks.length === 0 && (
                  <Text style={shared.small}>
                    No open tasks were considered.
                  </Text>
                )}
                {tasks.map((t, n) => (
                  <View key={t.item_id} style={[s.task, n > 0 && s.divider]}>
                    <View style={s.taskTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.taskTitle, !t.included && s.leftOut]}>
                          {t.title}
                        </Text>
                        <Text style={shared.small}>{taskLine(t)}</Text>
                        {!!t.reason && (
                          <Text style={[shared.small, t.at_risk && s.warnText]}>
                            {t.reason}
                          </Text>
                        )}
                      </View>
                      {t.included &&
                      t.fit &&
                      fitTone(t.fit.status) === "warn" ? (
                        <Pill label={t.fit.label} tone="warning" />
                      ) : (
                        t.at_risk && <Pill label="At risk" tone="warning" />
                      )}
                      <Switch
                        value={t.included}
                        disabled={busy}
                        trackColor={{ true: colors.accent }}
                        accessibilityLabel={`Plan ${t.title}`}
                        onValueChange={(on) =>
                          void change((p) => setIncluded(p, t.item_id, on))
                        }
                      />
                    </View>
                    {t.included && length?.itemId !== t.item_id && (
                      <View style={s.taskActions}>
                        <SmallAction
                          label="Change length"
                          disabled={busy}
                          onPress={() => {
                            setError("");
                            setLengthForm({
                              itemId: t.item_id,
                              text: String(t.estimate_minutes ?? 30),
                              save: false,
                            });
                          }}
                        />
                      </View>
                    )}
                    {length?.itemId === t.item_id && (
                      <PlanEditSheet
                        title="Change estimate"
                        busy={busy}
                        error={error}
                        onClose={() => setLengthForm(null)}
                      >
                        <View style={s.editor}>
                          <Text style={s.taskTitle}>{t.title}</Text>
                          <Field label="Plan it for">
                            <NumberInput
                              value={length.text}
                              editable={!busy}
                              onChangeText={(text) =>
                                setLengthForm({ ...length, text })
                              }
                              suffix="minutes"
                              accessibilityLabel={`Minutes to plan for ${t.title}`}
                            />
                          </Field>
                          <View style={[s.switchRow, s.switchTight]}>
                            <Text style={[s.switchTitle, { flex: 1 }]}>
                              Save to the task
                            </Text>
                            <Switch
                              value={length.save}
                              disabled={busy}
                              trackColor={{ true: colors.accent }}
                              accessibilityLabel="Save this length to the task"
                              onValueChange={(save) =>
                                setLengthForm({ ...length, save })
                              }
                            />
                          </View>
                          <View style={s.row}>
                            <Button
                              title="Use this length"
                              icon="check"
                              disabled={busy}
                              style={s.flex}
                              onPress={saveLength}
                            />
                            <Button
                              secondary
                              title="Cancel"
                              disabled={busy}
                              style={s.flex}
                              onPress={() => setLengthForm(null)}
                            />
                          </View>
                        </View>
                      </PlanEditSheet>
                    )}
                  </View>
                ))}
                {!!plan.estimates_saved?.length && (
                  <Text style={[shared.small, s.gapAbove]}>
                    Saved the new length on{" "}
                    {plan.estimates_saved.length === 1
                      ? "1 task"
                      : `${plan.estimates_saved.length} tasks`}
                    .
                  </Text>
                )}
              </View>
            )}
            {tunable && tab === "free" && (
              <View style={s.tabBody}>
                <Text style={[shared.small, s.gapBelow]}>
                  These times stay free.
                </Text>
                {keepFree.map((r, n) => (
                  <View
                    key={`${r.start_at}-${n}`}
                    style={[s.freeRow, n > 0 && s.divider]}
                  >
                    <Text style={s.freeText}>
                      {slotLabel(r.start_at, r.end_at)}
                    </Text>
                    <SmallAction
                      label="Remove"
                      disabled={busy}
                      onPress={() =>
                        void change((p) =>
                          setKeepFree(
                            p,
                            keepFree.filter((_, i) => i !== n),
                          ),
                        )
                      }
                    />
                  </View>
                ))}
                {adding ? (
                  <PlanEditSheet
                    title="Keep time free"
                    busy={busy}
                    error={error}
                    onClose={() => setAdding(null)}
                  >
                    <View style={s.editor}>
                      <Field label="Day">
                        <DateField
                          label="Day to keep free"
                          disabled={busy}
                          value={adding.day}
                          onChange={(day) =>
                            day && setAdding({ ...adding, day })
                          }
                        />
                      </Field>
                      <View style={s.row}>
                        <Field label="From" style={s.flex}>
                          <ClockField
                            label="Free from"
                            disabled={busy}
                            value={adding.from}
                            onChange={(from) => setAdding({ ...adding, from })}
                          />
                        </Field>
                        <Field label="To" style={s.flex}>
                          <ClockField
                            label="Free until"
                            disabled={busy}
                            value={adding.to}
                            onChange={(to) => setAdding({ ...adding, to })}
                          />
                        </Field>
                      </View>
                      <View style={s.row}>
                        <Button
                          title="Keep it free"
                          icon="check"
                          disabled={busy}
                          style={s.flex}
                          onPress={addFree}
                        />
                        <Button
                          secondary
                          title="Cancel"
                          disabled={busy}
                          style={s.flex}
                          onPress={() => setAdding(null)}
                        />
                      </View>
                    </View>
                  </PlanEditSheet>
                ) : (
                  <Button
                    secondary
                    title="Add free time"
                    icon="plus"
                    disabled={busy || keepFree.length >= 20}
                    style={s.gapAbove}
                    onPress={() => {
                      setError("");
                      setAdding({
                        day: plan.starts_on,
                        from: "13:00",
                        to: "17:00",
                      });
                    }}
                  />
                )}
              </View>
            )}
          </View>
        )}

        {plan && !saved && (
          <>
            <Button
              title={runBusy ? "Saving…" : "Apply"}
              icon="check"
              disabled={
                busy ||
                plan.applied ||
                (plan.blocks.length === 0 && chosen.length === 0)
              }
              onPress={() => void apply()}
            />
            {onShowOnCalendar && !plan.applied && plan.blocks.length > 0 && (
              <Button
                secondary
                title="Show on calendar"
                icon="calendar"
                disabled={busy}
                onPress={() => onShowOnCalendar(plan)}
              />
            )}
          </>
        )}
        {saved && (
          <View style={s.saved}>
            <Icon
              name="check"
              size={16}
              color={colors.accent}
              strokeWidth={2.4}
            />
            <Text style={s.savedText} accessibilityRole="alert">
              {saved.text}
            </Text>
          </View>
        )}
        {saved && onShowDay && saved.at && (
          <Button
            secondary
            title="Show on calendar"
            icon="calendar"
            onPress={() => onShowDay(saved.at!)}
          />
        )}
        {saved && <Button secondary title="Done" onPress={onDone} />}
        <InlineDetails title="Planning tools">
          <WhatIfBox items={items} />
          <PlanExperiments />
        </InlineDetails>
      </View>
    </ScrollView>
  );
}

function PlanEditSheet({
  title,
  busy,
  error,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet
      visible
      title={title}
      hideClose={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          {!!error && (
            <Text
              style={[shared.small, { color: colors.danger }]}
              accessibilityRole="alert"
            >
              {error}
            </Text>
          )}
          {children}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 6 },
    labelTop: { marginTop: 12 },
    hint: { marginTop: 8 },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 10,
    },
    stepperValue: {
      flex: 1,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginTop: 12,
    },
    switchTight: { marginTop: 0, marginBottom: 14 },
    switchTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 3,
    },
    preview: { marginTop: 12, marginBottom: 0 },
    gapBelow: { marginBottom: 10 },
    gapAbove: { marginTop: 12, marginBottom: 0 },
    tabBody: { marginTop: 14 },
    stale: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
      borderRadius: radii.input,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 16,
    },
    staleText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.warning,
    },
    editor: { gap: 12 },
    inline: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 12,
      marginTop: 6,
      marginBottom: 10,
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    flex: { flex: 1, minWidth: 100, marginBottom: 0 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    task: { paddingVertical: 10 },
    taskTop: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
    },
    taskTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    leftOut: { color: colors.faint },
    warnText: { color: colors.warning },
    taskActions: { flexDirection: "row", marginTop: 6 },
    freeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
    },
    freeText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    saved: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 14,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.accentSoft,
    },
    savedText: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.accent,
    },
  }),
);

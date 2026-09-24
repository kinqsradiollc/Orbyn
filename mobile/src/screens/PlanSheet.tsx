import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import {
  BREAK_LEVELS,
  dueDateOf,
  localDateKey,
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
import { PlanView } from "../components/PlanView";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
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
import { FadeIn, animateLayout } from "../motion";
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
}) {
  return (
    <Sheet
      visible={visible}
      title={title ?? (seed ? "Move work forward" : "Plan my day")}
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body
        key={seed?.id ?? "new"}
        seed={seed}
        teams={teams}
        items={items}
        onApplied={onApplied}
        onDone={onClose}
        onShowOnCalendar={onShowOnCalendar}
      />
    </Sheet>
  );
}

function Body({
  seed,
  teams,
  items,
  onApplied,
  onDone,
  onShowOnCalendar,
}: {
  seed: Plan | null;
  teams: Team[];
  items: Item[];
  onApplied: () => void;
  onDone: () => void;
  onShowOnCalendar?: (plan: Plan) => void;
}) {
  const { lists } = usePlanning();
  const { busy, error, setError, run } = useRun();
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
  const [saved, setSaved] = useState<{
    blocks: number;
    skipped: number;
  } | null>(null);
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
    client
      .getPlannerPrefs()
      .then((p) => {
        if (!alive) return;
        setZone(p.timezone);
        setWorkStart(p.work_start);
        // A seed plan keeps its own options.
        if (seed) return;
        setPad(p.pad_percent);
        setBreakLevel(p.break_level);
        setDays(dayOption(p.horizon_days));
      })
      .catch(() => {
        // The defaults above still make a sensible plan.
      });
    return () => {
      alive = false;
    };
  }, [seed]);
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
      animateLayout();
      setPlan(next);
      setMoving(null);
      setLengthForm(null);
      setAdding(null);
    });

  const preview = () =>
    run(async () => {
      const next = await client.previewPlan({
        start_date: start,
        days: Number(days),
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
      animateLayout();
      setPlan(next);
      setSaved(null);
      setTab("plan");
    });

  const apply = () =>
    run(async () => {
      if (!plan) return;
      const result = await client.applyPlan(plan.id);
      animateLayout();
      setSaved({ blocks: result.blocks.length, skipped: result.skipped });
      onApplied();
    });

  const chooseScope = (next: PlanScope) => {
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
    if (end <= start) {
      setError("A time to keep free ends after it starts.");
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
      <FadeIn style={s.inline}>
        <Field label="Day">
          <DateField
            label="Day"
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
        <Field
          label="Starts at"
          hint="A session you move stays where you put it; the rest of the plan fits around it."
        >
          <TimeField
            label="Start time"
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
            style={s.flex}
            onPress={() => setMoving(null)}
          />
        </View>
      </FadeIn>
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
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          {seed
            ? "Here’s a plan to look over. Tune it if you like; nothing changes until you apply it."
            : "Orbyn fits your open tasks into free working time around your events. Nothing is saved until you apply the plan."}
        </Text>
        <View style={shared.card}>
          <Field label="Start on">
            <DateField
              label="First day to plan"
              value={start}
              minimumDate={new Date()}
              onChange={(day) => day && setStartDate(day)}
            />
          </Field>
          <Text style={shared.label}>How many days?</Text>
          <Segmented
            wrap
            accessibilityLabel="Days to plan"
            options={DAYS}
            labels={start === today ? DAY_LABELS : undefined}
            value={days}
            onChange={setDays}
          />
          <Text style={[shared.label, s.labelTop]}>Pad estimates by</Text>
          <ChipRow label="Pad estimates by">
            {pads.map((n) => (
              <Chip
                key={n}
                label={`${n}%`}
                accessibilityLabel={`${n}% extra time`}
                selected={pad === n}
                onPress={() => setPad(n)}
              />
            ))}
          </ChipRow>
          <View style={s.stepper}>
            <SmallAction
              label="−5%"
              disabled={pad <= 0}
              onPress={() => setPad(Math.max(0, pad - 5))}
            />
            <Text style={s.stepperValue} accessibilityLiveRegion="polite">
              {pad}% extra time
            </Text>
            <SmallAction
              label="+5%"
              disabled={pad >= 100}
              onPress={() => setPad(Math.min(100, pad + 5))}
            />
          </View>
          <Text style={[shared.small, s.hint]}>
            Extra time for the unexpected, 0 to 100%.
          </Text>
          <Text style={[shared.label, s.labelTop]}>
            Breaks between sessions
          </Text>
          <Segmented
            accessibilityLabel="Breaks between sessions"
            options={BREAK_LEVELS}
            labels={BREAK_LABELS}
            value={breakLevel}
            onChange={setBreakLevel}
          />
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchTitle}>Split long tasks</Text>
              <Text style={shared.small}>
                Long tasks become several sessions.
              </Text>
            </View>
            <Switch
              value={split}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Split long tasks"
              onValueChange={setSplit}
            />
          </View>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchTitle}>Use frames</Text>
              <Text style={shared.small}>
                Put tasks in the frames that match them, when you have any.
              </Text>
            </View>
            <Switch
              value={useFrames}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Use frames"
              onValueChange={setUseFrames}
            />
          </View>
          <Button
            title={
              busy && !plan
                ? "Planning…"
                : seed
                  ? "Plan again with these options"
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
        </View>

        {tunable && stale && (
          <View style={s.stale} accessibilityRole="alert">
            <Text style={s.staleText}>
              Your calendar changed since this plan was made.
            </Text>
            <SmallAction
              label="Refresh"
              disabled={busy}
              onPress={() => void change(remakePlan)}
            />
          </View>
        )}

        <WhatIfBox items={items} />
        <PlanExperiments />

        {plan && (
          <FadeIn style={shared.card}>
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
                onChange={(next) => {
                  animateLayout();
                  setTab(next);
                }}
              />
            )}
            {(!tunable || tab === "plan") && (
              <View style={tunable ? s.tabBody : undefined}>
                <PlanView
                  plan={plan}
                  actions={
                    tunable
                      ? {
                          busy,
                          onMove: (b) => {
                            animateLayout();
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
                  Every task the planner looked at. Switch one off to leave it
                  out, or change how long it gets.
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
                        <Text
                          style={[s.taskTitle, !t.included && s.leftOut]}
                          numberOfLines={2}
                        >
                          {t.title}
                        </Text>
                        <Text style={shared.small}>{taskLine(t)}</Text>
                        {!!t.reason && (
                          <Text style={[shared.small, t.at_risk && s.warnText]}>
                            {t.reason}
                          </Text>
                        )}
                      </View>
                      {t.at_risk && <Pill label="At risk" tone="warning" />}
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
                            animateLayout();
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
                      <FadeIn style={s.inline}>
                        <Field label="Plan it for">
                          <NumberInput
                            value={length.text}
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
                            style={s.flex}
                            onPress={() => setLengthForm(null)}
                          />
                        </View>
                      </FadeIn>
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
                  Times the plan leaves empty, like a Friday afternoon.
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
                  <FadeIn style={s.inline}>
                    <Field label="Day">
                      <DateField
                        label="Day to keep free"
                        value={adding.day}
                        onChange={(day) => day && setAdding({ ...adding, day })}
                      />
                    </Field>
                    <View style={s.row}>
                      <Field label="From" style={s.flex}>
                        <ClockField
                          label="Free from"
                          value={adding.from}
                          onChange={(from) => setAdding({ ...adding, from })}
                        />
                      </Field>
                      <Field label="To" style={s.flex}>
                        <ClockField
                          label="Free until"
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
                        style={s.flex}
                        onPress={() => setAdding(null)}
                      />
                    </View>
                  </FadeIn>
                ) : (
                  <Button
                    secondary
                    title="Add a time to keep free"
                    icon="plus"
                    disabled={busy || keepFree.length >= 20}
                    style={s.gapAbove}
                    onPress={() => {
                      animateLayout();
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
          </FadeIn>
        )}

        {plan && !saved && (
          <>
            <Button
              title={busy ? "Saving…" : "Apply plan"}
              icon="check"
              disabled={busy || plan.applied || plan.blocks.length === 0}
              onPress={() => void apply()}
            />
            {onShowOnCalendar && !plan.applied && plan.blocks.length > 0 && (
              <Button
                secondary
                title="See it on the calendar"
                icon="calendar"
                disabled={busy}
                onPress={() => onShowOnCalendar(plan)}
              />
            )}
          </>
        )}
        {saved && (
          <FadeIn style={s.saved}>
            <Icon
              name="check"
              size={16}
              color={colors.accent}
              strokeWidth={2.4}
            />
            <Text style={s.savedText} accessibilityRole="alert">
              Plan saved. {saved.blocks} session{saved.blocks === 1 ? "" : "s"}{" "}
              added to your calendar
              {saved.skipped
                ? `; ${saved.skipped} skipped because the time is taken.`
                : "."}
            </Text>
          </FadeIn>
        )}
        {saved && <Button secondary title="Done" onPress={onDone} />}
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 18 },
    labelTop: { marginTop: 18 },
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
      fontSize: 14,
      color: colors.text,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginTop: 18,
    },
    switchTight: { marginTop: 0, marginBottom: 14 },
    switchTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 3,
    },
    preview: { marginTop: 18, marginBottom: 0 },
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
    inline: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 12,
      marginTop: 6,
      marginBottom: 10,
    },
    row: { flexDirection: "row", gap: 10 },
    flex: { flex: 1, marginBottom: 0 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    task: { paddingVertical: 10 },
    taskTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    taskTitle: {
      fontFamily: fonts.semibold,
      fontSize: 14,
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
      fontSize: 14,
      color: colors.text,
    },
    saved: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 14,
    },
    savedText: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.accent,
    },
  }),
);

import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { InlineDetails } from "../../components/InlineDetails";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import type { Habit, HabitInput, HabitPlan, Priority } from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Segmented } from "../../components/Segmented";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import * as outbox from "../../lib/outbox";
import { deviceTimeZone, WEEK_ORDER, WEEKDAYS } from "../planner/planning";
import { Pressable } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DURATIONS = [15, 30, 45, 60, 90];
const daysLabel = (days: number[]) =>
  days.join(",") === "1,2,3,4,5"
    ? "weekdays"
    : days.length === 7
      ? "any day"
      : WEEK_ORDER.filter((d) => days.includes(d))
          .map((d) => WEEKDAYS[d])
          .join(", ");

/** Habits: flexible routines the planner fits into free time. */
export function HabitsSheet({
  visible,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Habits"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body key={session.token} active={visible} />
    </Sheet>
  );
}

type Draft = {
  name: string;
  cadence: number;
  period: "day" | "week";
  duration_minutes: number;
  days: number[];
  priority: Priority;
};
const blank: Draft = {
  name: "",
  cadence: 3,
  period: "week",
  duration_minutes: 30,
  days: ALL_DAYS,
  priority: "medium",
};

function Body({ active }: { active: boolean }) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [waitingSync, setWaitingSync] = useState(
    outbox.outboxState().entries.length > 0,
  );
  const [queued, setQueued] = useState<string[]>([]);
  const locked = busy || loading;
  useEffect(
    () =>
      outbox.subscribeOutbox((value) => {
        if (owns()) setWaitingSync(value.entries.length > 0);
      }),
    [],
  );
  const [remove, setRemove] = useState<Habit | null>(null);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (!owns() || !activeRef.current || operation.current || loading) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      operation.current = false;
      if (owns()) setBusy(false);
    }
  };
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [plan, setPlan] = useState<HabitPlan | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setLoadError("");
    client
      .listHabits()
      .then(
        (rows) => {
          if (
            alive &&
            owns() &&
            !operation.current &&
            outbox.outboxState().entries.length === 0
          ) {
            setHabits(rows);
            setQueued([]);
          }
        },
        (e) => {
          if (alive && owns()) setLoadError(errorText(e));
        },
      )
      .finally(() => {
        if (alive && owns()) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, retry]);
  useEffect(
    () =>
      outbox.whenSent(() => {
        if (
          owns() &&
          activeRef.current &&
          outbox.outboxState().entries.length === 0
        )
          setRetry((n) => n + 1);
      }),
    [],
  );

  const create = () =>
    run(async () => {
      if (!draft.name.trim()) return;
      const body: HabitInput = { ...draft, name: draft.name.trim() };
      const made = await outbox.createHabit(body);
      if (!owns()) return;
      const id =
        made && typeof made === "object" && "id" in made
          ? String(made.id)
          : `waiting-${Date.now()}`;
      const row: Habit = made ?? {
        ...draft,
        name: body.name,
        id,
        window_start: null,
        window_end: null,
        active: true,
        position: habits?.length ?? 0,
        created_at: new Date().toISOString(),
      };
      setHabits((all) => [...(all ?? []), row]);
      if (!made) setQueued((all) => [...all, id]);
      setDraft(blank);
      setPlan(null);
    });
  const update = (h: Habit, patch: Partial<HabitInput>) =>
    run(async () => {
      if (queued.includes(h.id)) return;
      const result = await outbox.updateHabit(h.id, h.name, patch);
      if (!owns()) return;
      setHabits((all) =>
        (all ?? []).map((x) =>
          x.id === h.id ? (result ?? { ...x, ...patch }) : x,
        ),
      );
      if (result === null) setQueued((all) => [...all, h.id]);
      setPlan(null);
    });
  const deleteHabit = (h: Habit) =>
    run(async () => {
      if (queued.includes(h.id)) return;
      const result = await outbox.deleteHabit(h.id, h.name);
      if (!owns()) return;
      setHabits((all) => (all ?? []).filter((x) => x.id !== h.id));
      if (result === null)
        setError("Deletion queued. Sync when you're online.");
      setPlan(null);
      setExpanded(null);
    });

  const planHabits = () =>
    run(async () => {
      const value = await client.planHabits({ days: 7 });
      if (owns()) setPlan(value ?? null);
    });
  const apply = () =>
    run(async () => {
      if (!plan || queued.length || outbox.outboxState().entries.length) return;
      await client.applyHabitPlan(
        plan.blocks.map((b) => ({
          habit_id: b.habit_id,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
      );
      if (owns()) setPlan(null);
    });

  const tz = deviceTimeZone();
  const when = (iso: string) =>
    new Date(iso).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  const activeCount = (habits ?? []).filter((h) => h.active).length;

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        {waitingSync && (
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            Changes waiting to sync.
          </Text>
        )}
        {loading && <Text style={shared.small}>Loading habits…</Text>}
        {!!loadError && (
          <View>
            <ErrorBanner error={loadError} />
            <Button
              title="Retry habits"
              disabled={busy || loading}
              onPress={() => setRetry((n) => n + 1)}
            />
          </View>
        )}
        {habits?.length === 0 && !loading && (
          <Text style={shared.small}>No habits yet.</Text>
        )}

        {(habits ?? []).map((h) => (
          <View key={h.id}>
            <View style={s.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: expanded === h.id }}
                disabled={locked}
                onPress={() => {
                  setExpanded(expanded === h.id ? null : h.id);
                }}
                style={s.row}
              >
                <View style={s.rowMain}>
                  <Text style={s.name}>
                    {h.name}
                    {!h.active ? "  · paused" : ""}
                  </Text>
                  <Text style={s.meta}>
                    {h.cadence}× / {h.period} · {h.duration_minutes} min ·{" "}
                    {daysLabel(h.days)}
                  </Text>
                </View>
                <Icon
                  name={expanded === h.id ? "chevronDown" : "chevronRight"}
                  size={18}
                  color={colors.muted}
                />
              </Pressable>
              {queued.includes(h.id) && (
                <Text style={shared.small}>Waiting to sync</Text>
              )}
              {expanded === h.id && (
                <HabitEditor
                  habit={h}
                  busy={locked || queued.includes(h.id)}
                  onSave={(patch) => update(h, patch)}
                  onDelete={() => setRemove(h)}
                />
              )}
            </View>
          </View>
        ))}

        {activeCount > 0 && (
          <View style={s.planCard}>
            <Button
              title="Plan this week"
              icon="calendar"
              secondary
              disabled={locked || !!loadError || waitingSync}
              onPress={planHabits}
            />
            {plan && plan.blocks.length > 0 && (
              <View style={s.proposal}>
                {plan.blocks.map((b) => (
                  <View
                    key={`${b.habit_id}-${b.start_at}`}
                    style={s.proposalRow}
                  >
                    <Text style={s.name}>{b.name}</Text>
                    <Text style={s.meta}>{when(b.start_at)}</Text>
                  </View>
                ))}
                {plan.summary
                  .filter((x) => x.reason)
                  .map((x) => (
                    <Text key={x.habit_id} style={s.note}>
                      {x.name}: {x.reason}
                    </Text>
                  ))}
                <Button
                  title="Add to calendar"
                  icon="check"
                  disabled={locked}
                  onPress={apply}
                />
              </View>
            )}
            {plan && plan.blocks.length === 0 && (
              <Text style={s.note}>No sessions proposed.</Text>
            )}
            {plan &&
              plan.blocks.length === 0 &&
              plan.summary
                .filter((x) => x.reason)
                .map((x) => (
                  <Text key={x.habit_id} style={s.note}>
                    {x.name}: {x.reason}
                  </Text>
                ))}
            {plan && (
              <SmallAction
                label="Dismiss plan"
                disabled={locked}
                onPress={() => setPlan(null)}
              />
            )}
          </View>
        )}

        <InlineDetails title="Add habit">
          <TextInput
            style={[shared.input, s.gap]}
            value={draft.name}
            editable={!locked}
            onChangeText={(name) => setDraft({ ...draft, name })}
            maxLength={60}
            placeholder="Habit name"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            accessibilityLabel="New habit name"
          />
          <Field label="How often" style={s.gap}>
            <View style={s.cadenceRow}>
              <SmallAction
                label="Less often"
                disabled={locked}
                onPress={() =>
                  setDraft({
                    ...draft,
                    cadence: Math.max(1, draft.cadence - 1),
                  })
                }
              />
              <Text style={s.cadence}>
                {draft.cadence}× / {draft.period}
              </Text>
              <SmallAction
                label="More often"
                disabled={locked}
                onPress={() =>
                  setDraft({
                    ...draft,
                    cadence: Math.min(
                      draft.period === "day" ? 6 : 21,
                      draft.cadence + 1,
                    ),
                  })
                }
              />
            </View>
          </Field>
          <View style={s.gap}>
            <Segmented
              disabled={locked}
              accessibilityLabel="Period"
              options={["week", "day"] as const}
              labels={{ week: "Per week", day: "Per day" }}
              value={draft.period}
              onChange={(period) =>
                setDraft({
                  ...draft,
                  period,
                  cadence: Math.min(draft.cadence, period === "day" ? 6 : 21),
                })
              }
            />
          </View>
          <View style={s.gap}>
            <ChipRow label="Each session">
              {DURATIONS.map((m) => (
                <Chip
                  key={m}
                  label={`${m}m`}
                  disabled={locked}
                  selected={draft.duration_minutes === m}
                  onPress={() => setDraft({ ...draft, duration_minutes: m })}
                />
              ))}
            </ChipRow>
          </View>
          <View style={s.gap}>
            <ChipRow label="Available days" multi>
              {WEEK_ORDER.map((d) => {
                const on = draft.days.includes(d);
                return (
                  <Chip
                    key={d}
                    multi
                    label={WEEKDAYS[d]}
                    selected={on}
                    disabled={locked}
                    onPress={() => {
                      const days = on
                        ? draft.days.filter((x) => x !== d)
                        : [...draft.days, d].sort((a, b) => a - b);
                      if (days.length) setDraft({ ...draft, days });
                    }}
                  />
                );
              })}
            </ChipRow>
          </View>
          <View style={s.gap}>
            <Segmented
              disabled={locked}
              accessibilityLabel="Priority"
              options={["high", "medium", "low"] as const}
              value={draft.priority}
              onChange={(priority) => setDraft({ ...draft, priority })}
            />
          </View>
          <Button
            title="Add habit"
            icon="plus"
            disabled={locked || !draft.name.trim()}
            onPress={create}
            style={s.gap}
          />
        </InlineDetails>
        <ActionSheet
          visible={!!remove}
          label="Delete habit"
          title={`Delete “${remove?.name ?? "habit"}”?`}
          message="Future sessions stay in your calendar."
          cancelLabel="Keep habit"
          actions={[
            {
              label: "Delete habit",
              destructive: true,
              disabled: busy,
              onPress: () => {
                if (remove) void deleteHabit(remove);
              },
            },
          ]}
          onClose={() => setRemove(null)}
        />
      </View>
    </ScrollView>
  );
}

function HabitEditor({
  habit,
  busy,
  onSave,
  onDelete,
}: {
  habit: Habit;
  busy: boolean;
  onSave: (patch: Partial<HabitInput>) => void;
  onDelete: () => void;
}) {
  return (
    <View style={s.editor}>
      <ChipRow label="Available days" multi>
        {WEEK_ORDER.map((d) => {
          const on = habit.days.includes(d);
          return (
            <Chip
              key={d}
              multi
              label={WEEKDAYS[d]}
              selected={on}
              disabled={busy}
              onPress={() => {
                const days = on
                  ? habit.days.filter((x) => x !== d)
                  : [...habit.days, d].sort((a, b) => a - b);
                if (days.length) onSave({ days });
              }}
            />
          );
        })}
      </ChipRow>
      <View style={s.editorRow}>
        <Segmented
          disabled={busy}
          accessibilityLabel="Priority"
          options={["high", "medium", "low"] as const}
          value={habit.priority}
          onChange={(priority) => onSave({ priority })}
        />
      </View>
      <View style={s.editorActions}>
        <SmallAction
          label={habit.active ? "Pause" : "Resume"}
          disabled={busy}
          onPress={() => onSave({ active: !habit.active })}
        />
        <MoreMenu
          label="Habit options"
          disabled={busy}
          actions={[
            { label: "Delete habit", destructive: true, onPress: onDelete },
          ]}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: 12,
      marginBottom: 8,
    },
    row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1, minWidth: 0 },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    meta: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      marginTop: 2,
    },
    note: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      marginTop: 6,
    },
    gap: { marginTop: 12 },
    cadenceRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    cadence: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      minWidth: 96,
      textAlign: "center",
    },
    editor: { marginTop: 12, gap: 12 },
    editorRow: { marginTop: 4 },
    editorActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 4,
    },
    planCard: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: 12,
      marginBottom: 8,
      gap: 12,
    },
    proposal: { gap: 8 },
    proposalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: 8,
    },
  }),
);

import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Habit, HabitInput, HabitPlan, Priority } from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { deviceTimeZone, WEEK_ORDER, WEEKDAYS } from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

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
      <Body />
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

function Body() {
  const { busy, error, setError, run } = useRun();
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [plan, setPlan] = useState<HabitPlan | null>(null);

  const reload = async () => setHabits(await client.listHabits());
  useEffect(() => {
    void run(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = () =>
    run(async () => {
      const body: HabitInput = {
        name: draft.name.trim(),
        cadence: draft.cadence,
        period: draft.period,
        duration_minutes: draft.duration_minutes,
        days: draft.days,
        priority: draft.priority,
      };
      await client.createHabit(body);
      await reload();
      animateLayout();
      setDraft(blank);
    });

  const planHabits = () =>
    run(async () => {
      setPlan((await client.planHabits({ days: 7 })) ?? null);
    });
  const apply = () =>
    run(async () => {
      if (!plan) return;
      await client.applyHabitPlan(
        plan.blocks.map((b) => ({
          habit_id: b.habit_id,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
      );
      animateLayout();
      setPlan(null);
    });

  const tz = deviceTimeZone();
  const when = (iso: string) =>
    new Date(iso).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  const active = (habits ?? []).filter((h) => h.active).length;

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          Routines like “Gym 3× a week”. The planner fits them into free time
          and moves them as your week changes.
        </Text>

        {(habits ?? []).map((h) => (
          <FadeIn key={h.id}>
            <View style={s.card}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  animateLayout();
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
                <Icon name="chevronRight" size={18} color={colors.muted} />
              </Pressable>
              {expanded === h.id && (
                <HabitEditor
                  habit={h}
                  busy={busy}
                  onSave={(patch) =>
                    run(async () => {
                      await client.updateHabit(h.id, patch);
                      await reload();
                    })
                  }
                  onDelete={() =>
                    Alert.alert(
                      `Delete ${h.name}?`,
                      "Its future sessions stay.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            void run(async () => {
                              await client.deleteHabit(h.id);
                              await reload();
                              animateLayout();
                              setExpanded(null);
                            }),
                        },
                      ],
                    )
                  }
                />
              )}
            </View>
          </FadeIn>
        ))}

        {active > 0 && (
          <View style={s.planCard}>
            <Button
              title={busy ? "Planning…" : "Plan this week’s habits"}
              icon="calendar"
              secondary
              disabled={busy}
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
                  disabled={busy}
                  onPress={apply}
                />
              </View>
            )}
            {plan && plan.blocks.length === 0 && (
              <Text style={s.note}>Your habits are on track this week.</Text>
            )}
          </View>
        )}

        <View style={s.card}>
          <Text style={shared.label}>New habit</Text>
          <TextInput
            style={[shared.input, s.gap]}
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
            maxLength={60}
            placeholder="Gym, Read, Deep work…"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            accessibilityLabel="New habit name"
          />
          <Field label="How often" style={s.gap}>
            <View style={s.cadenceRow}>
              <SmallAction
                label="–"
                disabled={busy}
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
                label="+"
                disabled={busy}
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
              accessibilityLabel="Period"
              options={["week", "day"] as const}
              labels={{ week: "Per week", day: "Per day" }}
              value={draft.period}
              onChange={(period) => setDraft({ ...draft, period })}
            />
          </View>
          <View style={s.gap}>
            <ChipRow label="Each session">
              {DURATIONS.map((m) => (
                <Chip
                  key={m}
                  label={`${m}m`}
                  selected={draft.duration_minutes === m}
                  onPress={() => setDraft({ ...draft, duration_minutes: m })}
                />
              ))}
            </ChipRow>
          </View>
          <View style={s.gap}>
            <ChipRow label="Days it can land on" multi>
              {WEEK_ORDER.map((d) => {
                const on = draft.days.includes(d);
                return (
                  <Chip
                    key={d}
                    multi
                    label={WEEKDAYS[d]}
                    selected={on}
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
              accessibilityLabel="Priority"
              options={["high", "medium", "low"] as const}
              value={draft.priority}
              onChange={(priority) => setDraft({ ...draft, priority })}
            />
          </View>
          <Button
            title="Add habit"
            icon="plus"
            disabled={busy || !draft.name.trim()}
            onPress={create}
            style={s.gap}
          />
        </View>
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
      <ChipRow label="Days it can land on" multi>
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
        <SmallAction
          label="Delete"
          disabled={busy}
          destructive
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginBottom: 16 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1 },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    meta: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      color: colors.muted,
      marginTop: 2,
    },
    note: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      color: colors.muted,
      marginTop: 6,
    },
    gap: { marginTop: 12 },
    cadenceRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    cadence: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      minWidth: 96,
      textAlign: "center",
    },
    editor: { marginTop: 12, gap: 12 },
    editorRow: { marginTop: 4 },
    editorActions: { flexDirection: "row", gap: 12, marginTop: 4 },
    planCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
      gap: 12,
    },
    proposal: { gap: 8 },
    proposalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
  }),
);

import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { dueDateOf, type Item } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  DateField,
  Field,
  NumberInput,
  TimeField,
} from "../../components/Field";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import {
  byPriority,
  minutesLabel,
  parseMinutes,
  slotLabel,
} from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { FadeIn, animateLayout } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

/** Tasks listed before "Show all". */
const SHOWN = 12;
const MIN_LENGTH = 5;
const MAX_LENGTH = 1440;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The next half hour from now, as a starting suggestion. */
const nextHalfHour = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
};

/**
 * "Tasks to place": open tasks, most pressing first, each with a form to set
 * time aside for it on any day (a time block of 5 to 1440 minutes).
 */
export function TasksToPlaceSheet({
  visible,
  items,
  canEdit,
  onClose,
  onBooked,
}: {
  visible: boolean;
  items: Item[];
  /** Whether you can set time aside for a task (not for team viewers). */
  canEdit: (item: Item) => boolean;
  onClose: () => void;
  /** A block was added; show its day. */
  onBooked: (start: Date) => void;
}) {
  return (
    <Sheet visible={visible} title="Tasks to place" onClose={onClose}>
      {visible && <Body items={items} canEdit={canEdit} onBooked={onBooked} />}
    </Sheet>
  );
}

function Body({
  items,
  canEdit,
  onBooked,
}: {
  items: Item[];
  canEdit: (item: Item) => boolean;
  onBooked: (start: Date) => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [start, setStart] = useState(nextHalfHour);
  const [lengthText, setLengthText] = useState("30");
  const [done, setDone] = useState("");
  const tasks = items
    .filter(
      (i) =>
        i.kind === "task" &&
        !["done", "cancelled"].includes(i.status) &&
        canEdit(i),
    )
    .sort(byPriority());
  const shown = all ? tasks : tasks.slice(0, SHOWN);
  const length = parseMinutes(lengthText);
  const lengthOk =
    length !== null && length >= MIN_LENGTH && length <= MAX_LENGTH;
  const end = new Date(start.getTime() + (length ?? 0) * 60_000);

  const pick = (task: Item) => {
    animateLayout();
    setDone("");
    if (open === task.id) return setOpen(null);
    setOpen(task.id);
    setLengthText(String(Math.min(MAX_LENGTH, task.estimate_minutes || 30)));
  };
  const pickDay = (day: string | null) => {
    if (!day) return;
    const [y, m, d] = day.split("-").map(Number);
    const next = new Date(start);
    next.setFullYear(y, m - 1, d);
    setStart(next);
  };
  const book = (task: Item) =>
    run(async () => {
      await client.createBlock({
        item_id: task.id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
      });
      animateLayout();
      setOpen(null);
      setDone(`Session planned for ${task.title}: ${slotLabel(start, end)}.`);
      onBooked(start);
    });

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
          Plan a session for a task. It shows on the calendar, and you can move
          it later.
        </Text>
        {!!done && (
          <Text style={s.done} accessibilityRole="alert">
            {done}
          </Text>
        )}
        {tasks.length === 0 ? (
          <Text style={shared.small}>No open tasks. A clear runway.</Text>
        ) : (
          <View style={s.list}>
            {shown.map((t, n) => (
              <View key={t.id} style={n > 0 && s.divider}>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title} numberOfLines={2}>
                      {t.title}
                    </Text>
                    <Text style={shared.small}>
                      {t.estimate_minutes
                        ? minutesLabel(t.estimate_minutes)
                        : "No estimate · 30m"}
                      {dueDateOf(t) ? ` · due ${dueDateOf(t)}` : ""}
                    </Text>
                  </View>
                  <SmallAction
                    label={open === t.id ? "Close" : "Schedule"}
                    disabled={busy}
                    onPress={() => pick(t)}
                  />
                </View>
                {open === t.id && (
                  <FadeIn style={s.form}>
                    <Field label="Day">
                      <DateField
                        label={`Day for ${t.title}`}
                        value={dayKey(start)}
                        onChange={pickDay}
                      />
                    </Field>
                    <Field label="Starts at">
                      <TimeField
                        label="Start time"
                        value={start}
                        onChange={setStart}
                      />
                    </Field>
                    <Field
                      label="Length"
                      hint={`${MIN_LENGTH} to ${MAX_LENGTH} minutes.`}
                    >
                      <NumberInput
                        value={lengthText}
                        onChangeText={setLengthText}
                        suffix="minutes"
                        accessibilityLabel={`Length in minutes, ${MIN_LENGTH} to ${MAX_LENGTH}`}
                      />
                    </Field>
                    <Button
                      title={
                        lengthOk
                          ? `Book ${slotLabel(start, end)}`
                          : "Pick a length"
                      }
                      icon="check"
                      disabled={busy || !lengthOk}
                      style={s.last}
                      onPress={() => void book(t)}
                    />
                  </FadeIn>
                )}
              </View>
            ))}
          </View>
        )}
        {tasks.length > SHOWN && (
          <Button
            secondary
            title={all ? "Show fewer" : `Show all ${tasks.length}`}
            onPress={() => {
              animateLayout();
              setAll(!all);
            }}
          />
        )}
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 18 },
    done: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
      marginBottom: 12,
    },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
      marginBottom: 2,
    },
    form: { paddingHorizontal: 14, paddingBottom: 14 },
    last: { marginBottom: 0 },
  }),
);

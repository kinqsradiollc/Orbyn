import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  dueDateOf,
  rowFitChip,
  stillToPlan,
  stillToPlanLabel,
  type Item,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  DateField,
  Field,
  NumberInput,
  TimeField,
} from "../../components/Field";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { Pill, chipTone } from "../../components/Pill";
import { SmallAction } from "../../components/SmallAction";
import { usePlanned } from "../../lib/plannedContext";
import { client } from "../../lib/api";
import {
  byPriority,
  minutesLabel,
  parseMinutes,
  slotLabel,
} from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { BottomSheet } from "../../components/BottomSheet";
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
 * time aside for it on any day (a session of 5 to 1440 minutes). Tasks
 * already on track are left out; the rest say how much is still to plan.
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
  const [pending, setPending] = useState(false);
  return (
    <Sheet
      visible={visible}
      title="Tasks to place"
      onClose={onClose}
      closeDisabled={pending}
    >
      {visible && (
        <Body
          items={items}
          canEdit={canEdit}
          onBooked={onBooked}
          onBusyChange={setPending}
        />
      )}
    </Sheet>
  );
}

function Body({
  items,
  canEdit,
  onBooked,
  onBusyChange,
}: {
  items: Item[];
  canEdit: (item: Item) => boolean;
  onBooked: (start: Date) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { busy, error, setError, run } = useRun();
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [start, setStart] = useState(nextHalfHour);
  const [lengthText, setLengthText] = useState("30");
  const [done, setDone] = useState("");
  const { byItem, feed } = usePlanned();
  const tasks = items
    .filter(
      (i) =>
        i.kind === "task" &&
        !["done", "cancelled"].includes(i.status) &&
        canEdit(i) &&
        stillToPlan(byItem.get(i.id)) !== 0,
    )
    .sort(byPriority(new Date(), items));
  const shown = all ? tasks : tasks.slice(0, SHOWN);
  /** Its status, when it's a warning ("At risk", "Short 2h"…). */
  const status = (t: Item) => {
    const chip = rowFitChip(byItem.get(t.id)?.fit);
    return chip && chip.tone === "warn" ? (
      <View style={s.status}>
        <Pill label={chip.text} tone={chipTone(chip.tone)} />
      </View>
    ) : null;
  };
  const length = parseMinutes(lengthText);
  const lengthOk =
    length !== null && length >= MIN_LENGTH && length <= MAX_LENGTH;
  const end = new Date(start.getTime() + (length ?? 0) * 60_000);

  const pick = (task: Item) => {
    if (saving.current) return;
    setError("");
    setStart(nextHalfHour());
    setDone("");
    if (open === task.id) return setOpen(null);
    setOpen(task.id);
    setLengthText(String(Math.min(MAX_LENGTH, task.estimate_minutes || 30)));
  };
  const pickDay = (day: string | null) => {
    if (!day || saving.current) return;
    const [y, m, d] = day.split("-").map(Number);
    const next = new Date(start);
    next.setFullYear(y, m - 1, d);
    setStart(next);
  };
  const selected = tasks.find((t) => t.id === open);
  const book = async (task: Item) => {
    if (
      saving.current ||
      !lengthOk ||
      !Number.isFinite(start.getTime()) ||
      !tasks.some((t) => t.id === task.id && canEdit(t))
    )
      return;
    saving.current = true;
    onBusyChange(true);
    try {
      await run(async () => {
        await client.createBlock({
          item_id: task.id,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
        });
        if (!alive.current) return;
        setOpen(null);
        setDone(`Scheduled ${task.title} · ${slotLabel(start, end)}`);
        onBooked(start);
      });
    } finally {
      saving.current = false;
      if (alive.current) onBusyChange(false);
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={sheetStyles.column}>
          {!selected && (
            <ErrorBanner error={error} onDismiss={() => setError("")} />
          )}
          <Text style={[shared.small, s.intro]}>Choose a task and time.</Text>
          {!!done && (
            <Text style={s.done} accessibilityRole="alert">
              {done}
            </Text>
          )}
          {tasks.length === 0 ? (
            <Text style={shared.small}>
              {feed
                ? "No tasks need scheduling."
                : "No editable tasks available."}
            </Text>
          ) : (
            <View style={s.list}>
              {shown.map((t, n) => (
                <View key={t.id} style={n > 0 && s.divider}>
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.title}>{t.title}</Text>
                      <Text style={shared.small}>
                        {placeLine(t, stillToPlan(byItem.get(t.id)))}
                      </Text>
                      {status(t)}
                    </View>
                    <SmallAction
                      label="Schedule"
                      disabled={busy}
                      onPress={() => pick(t)}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
          {tasks.length > SHOWN && (
            <Button
              secondary
              title={all ? "Show fewer" : `Show all ${tasks.length}`}
              onPress={() => {
                setAll(!all);
              }}
            />
          )}
        </View>
      </ScrollView>
      <BottomSheet
        visible={!!selected}
        title="Schedule task"
        onClose={() => setOpen(null)}
        closeDisabled={busy}
      >
        <Text style={shared.sectionTitle}>{selected?.title}</Text>
        <ErrorBanner error={error} onDismiss={() => setError("")} />

        <Field label="Day">
          <DateField
            label={`Day for ${selected?.title ?? "task"}`}
            value={dayKey(start)}
            onChange={pickDay}
            disabled={busy}
          />
        </Field>
        <Field label="Starts at">
          <TimeField
            label="Start time"
            value={start}
            onChange={setStart}
            disabled={busy}
          />
        </Field>
        <Field label="Length" hint={`${MIN_LENGTH}–${MAX_LENGTH} minutes`}>
          <NumberInput
            editable={!busy}
            value={lengthText}
            onChangeText={setLengthText}
            suffix="minutes"
            accessibilityLabel={`Length in minutes, ${MIN_LENGTH} to ${MAX_LENGTH}`}
          />
        </Field>
        <Button
          title={lengthOk ? "Schedule task" : "Pick a length"}
          icon="check"
          disabled={busy || !lengthOk}
          style={s.last}
          onPress={() => selected && void book(selected)}
        />

        {lengthOk && <Text style={shared.small}>{slotLabel(start, end)}</Text>}
      </BottomSheet>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 12 },
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
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },

    status: { flexDirection: "row", marginTop: 6 },
    last: { marginBottom: 0 },
  }),
);

/**
 * "2 h still to plan · due Fri 2 Oct, 5 pm", or, without the planned feed,
 * the estimate: "45 min · due …" ("No estimate · 30m").
 */
function placeLine(t: Item, toPlan: number | null) {
  const size =
    toPlan != null
      ? stillToPlanLabel(toPlan)
      : t.estimate_minutes
        ? minutesLabel(t.estimate_minutes)
        : "No estimate · 30m";
  const due = dueDateOf(t);
  return due ? `${size} · due ${due}` : size;
}

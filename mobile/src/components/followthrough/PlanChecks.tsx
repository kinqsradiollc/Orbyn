import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  addDays,
  localDateKey,
  realityCheck,
  type Item,
  type Plan,
  type PlanReality,
  type WhatIfResult,
} from "@orbyn/core";
import { Button } from "../Button";
import { Chip, ChipRow } from "../Chip";
import { Icon } from "../Icon";
import { Segmented } from "../Segmented";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../../lib/planning";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

/** The plan held up against how plans have gone lately, in one line. */
export function RealityLine({
  plan,
  timeZone,
}: {
  plan: Plan;
  timeZone: string;
}) {
  const [reality, setReality] = useState<PlanReality | null>(null);
  useEffect(() => {
    client.planReality().then(setReality, () => setReality(null));
  }, []);
  const { message, days, note } = realityCheck(plan, reality, timeZone);
  if (!message && !note) return null;
  const stretch = days.some((d) => d.stretch) || !!note?.includes("only");
  return (
    <View style={[s.line, stretch && s.lineBad]} accessibilityRole="summary">
      <Icon
        name="activity"
        size={14}
        color={stretch ? colors.danger : colors.accent}
      />
      <Text style={[s.lineText, stretch && s.lineTextBad]}>
        {[message, note].filter(Boolean).join(" ")}
      </Text>
    </View>
  );
}

const MODES = ["add", "off", "move"] as const;
type Mode = (typeof MODES)[number];
const HOURS = [1, 2, 4, 8, 16];

/**
 * "What if…": try a change before making it — a task taken on, a day off,
 * a deadline moved — and get the answer in one sentence. Nothing is saved.
 */
export function WhatIfBox({ items }: { items: Item[] }) {
  const zone = deviceTimeZone();
  const today = localDateKey(new Date(), zone);
  const days = Array.from({ length: 10 }, (_, n) => addDays(today, n));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(2);
  const [day, setDay] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tasks = items
    .filter(
      (i) =>
        i.kind === "task" && i.status !== "done" && i.status !== "cancelled",
    )
    .slice(0, 30);
  const endOf = (d: string) => new Date(`${d}T17:00:00`).toISOString();
  const label = (d: string) =>
    d === today
      ? "Today"
      : new Date(`${d}T12:00:00`).toLocaleDateString([], {
          weekday: "short",
          day: "numeric",
        });
  const ready =
    mode === "add"
      ? !!title.trim()
      : mode === "off"
        ? !!day
        : !!itemId && !!day;

  if (!open)
    return (
      <Button
        secondary
        title="What if…"
        icon="sparkles"
        style={s.openButton}
        onPress={() => setOpen(true)}
      />
    );
  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await client.whatIf({
          days: 7,
          ...(mode === "add"
            ? {
                add_tasks: [
                  {
                    title: title.trim(),
                    estimate_minutes: hours * 60,
                    due_at: day ? endOf(day) : null,
                  },
                ],
              }
            : mode === "off"
              ? { days_off: [day!] }
              : { move_due: [{ item_id: itemId!, due_at: endOf(day!) }] }),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const dayChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <ChipRow label="Day">
        {days.map((d) => (
          <Chip
            key={d}
            compact
            label={label(d)}
            selected={day === d}
            onPress={() => setDay(day === d ? null : d)}
          />
        ))}
      </ChipRow>
    </ScrollView>
  );
  return (
    <View style={[shared.card, s.box]}>
      <Text style={shared.sectionTitle}>What if…</Text>
      <Segmented
        options={MODES}
        value={mode}
        labels={{ add: "New task", off: "Day off", move: "Deadline" }}
        accessibilityLabel="What would change"
        onChange={(m) => {
          setMode(m);
          setResult(null);
        }}
      />
      {mode === "add" && (
        <>
          <TextInput
            style={shared.input}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            placeholder="Quarterly report"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Task"
          />
          <ChipRow label="Takes">
            {HOURS.map((h) => (
              <Chip
                key={h}
                compact
                label={`${h} h`}
                selected={hours === h}
                onPress={() => setHours(h)}
              />
            ))}
          </ChipRow>
          <Text style={shared.small}>Due (optional)</Text>
          {dayChips}
        </>
      )}
      {mode === "off" && dayChips}
      {mode === "move" && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <ChipRow label="Task">
              {tasks.map((t) => (
                <Chip
                  key={t.id}
                  compact
                  label={t.title}
                  selected={itemId === t.id}
                  onPress={() => setItemId(t.id)}
                />
              ))}
            </ChipRow>
          </ScrollView>
          <Text style={shared.small}>New due date</Text>
          {dayChips}
        </>
      )}
      <View style={s.actions}>
        <Button
          title={busy ? "Working it out…" : "Check"}
          disabled={!ready || busy}
          onPress={() => void run()}
          style={s.check}
        />
        <Button
          secondary
          title="Close"
          onPress={() => setOpen(false)}
          style={s.check}
        />
      </View>
      {!!error && <Text style={[shared.small, s.bad]}>{error}</Text>}
      {result && (
        <View
          style={[s.line, result.newly_late.length > 0 && s.lineBad]}
          accessibilityRole="alert"
        >
          <Text
            style={[s.lineText, result.newly_late.length > 0 && s.lineTextBad]}
          >
            {result.verdict} Nothing was changed.
          </Text>
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    line: {
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
      padding: 10,
      marginTop: 10,
      borderRadius: radii.input,
      backgroundColor: colors.soft,
    },
    lineBad: { backgroundColor: colors.dangerSoft },
    lineText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
    lineTextBad: { color: colors.danger },
    openButton: { marginTop: 12, marginBottom: 0 },
    box: { gap: 10, marginTop: 12 },
    actions: { flexDirection: "row", gap: 10 },
    check: { flex: 1, marginBottom: 0 },
    bad: { color: colors.danger },
  }),
);

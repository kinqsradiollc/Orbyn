import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  realityCheck,
  type Item,
  type Plan,
  type PlanReality,
  type WhatIfResult,
} from "@orbyn/core";
import { Button } from "../Button";
import { Chip, ChipRow } from "../Chip";
import { Icon } from "../Icon";
import { DateField } from "../Field";
import { Sheet, sheetStyles } from "../Sheet";
import { SmallAction } from "../SmallAction";
import { Segmented } from "../Segmented";
import { client } from "../../lib/api";
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
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    client.planReality().then(
      (next) => {
        if (alive) setReality(next);
      },
      () => {
        if (alive) {
          setReality(null);
          setError(true);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [version]);
  const { message, days, note } = realityCheck(plan, reality, timeZone);
  if (error)
    return (
      <View style={s.line}>
        <Text style={s.lineText} accessibilityRole="alert">
          Couldn't load planning history.
        </Text>
        <SmallAction
          label="Retry"
          disabled={false}
          onPress={() => setVersion((n) => n + 1)}
        />
      </View>
    );
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
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(2);
  const [day, setDay] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tasks = items.filter(
    (i) => i.kind === "task" && i.status !== "done" && i.status !== "cancelled",
  );
  const shownTasks = tasks.filter(
    (task) =>
      task.id === itemId ||
      task.title
        .toLocaleLowerCase()
        .includes(taskSearch.trim().toLocaleLowerCase()),
  );
  const endOf = (d: string) => new Date(`${d}T17:00:00`).toISOString();
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
    if (!ready || busy) return;
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
  return (
    <Sheet
      visible
      title="What if…"
      hideClose={busy}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={[sheetStyles.column, s.box]}>
          <Text style={shared.small}>Preview only. No changes are saved.</Text>
          <Segmented
            disabled={busy}
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
                editable={!busy}
                onChangeText={(value) => {
                  setTitle(value);
                  setResult(null);
                }}
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
                    disabled={busy}
                    label={`${h} h`}
                    selected={hours === h}
                    onPress={() => {
                      setHours(h);
                      setResult(null);
                    }}
                  />
                ))}
              </ChipRow>
              <DateField
                label="Due (optional)"
                value={day}
                disabled={busy}
                clearable
                onChange={(next) => {
                  setDay(next);
                  setResult(null);
                }}
              />
            </>
          )}
          {mode === "off" && (
            <DateField
              label="Day off"
              value={day}
              disabled={busy}
              onChange={(next) => {
                setDay(next);
                setResult(null);
              }}
            />
          )}
          {mode === "move" && (
            <>
              <Text style={shared.label}>Task</Text>
              <TextInput
                style={shared.input}
                value={taskSearch}
                editable={!busy}
                accessibilityLabel="Search tasks"
                placeholder="Search tasks"
                placeholderTextColor={colors.faint}
                onChangeText={setTaskSearch}
              />
              <ChipRow label="Task">
                {shownTasks.map((t) => (
                  <Chip
                    key={t.id}
                    compact
                    disabled={busy}
                    label={t.title}
                    selected={itemId === t.id}
                    onPress={() => {
                      setItemId(t.id);
                      setResult(null);
                    }}
                  />
                ))}
              </ChipRow>
              {!shownTasks.length && (
                <Text style={shared.small}>
                  {tasks.length ? "No matching tasks" : "No open tasks"}
                </Text>
              )}
              <DateField
                label="New due date"
                value={day}
                disabled={busy}
                onChange={(next) => {
                  setDay(next);
                  setResult(null);
                }}
              />
            </>
          )}
          <View style={s.actions}>
            <Button
              title={busy ? "Checking…" : "Check"}
              disabled={!ready || busy}
              onPress={() => void run()}
              style={s.check}
            />
            <Button
              secondary
              title="Close"
              disabled={busy}
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
                style={[
                  s.lineText,
                  result.newly_late.length > 0 && s.lineTextBad,
                ]}
              >
                {result.verdict}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </Sheet>
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
    box: { gap: 10 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    check: { flex: 1, minWidth: 100, marginBottom: 0 },
    bad: { color: colors.danger },
  }),
);

import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { TimeBlock } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  DateField,
  Field,
  NumberInput,
  TimeField,
} from "../../components/Field";
import { Sheet, sheetStyles } from "../../components/Sheet";
import {
  clockLabel,
  minutesLabel,
  parseMinutes,
  shortDay,
  slotLabel,
} from "../../lib/planning";
import { shared } from "../../styles";

/** Anything with times that can move: a time block, or an event occurrence. */
export type MoveTarget = Pick<
  TimeBlock,
  "id" | "title" | "start_at" | "end_at"
>;

/** Shortest and longest length a block can be given here, in minutes. */
const MIN_LENGTH = 5;
const MAX_LENGTH = 1440;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * "Move to…" for a block or event: pick a day, a start time and (for blocks
 * and events with an end) a length. With `duplicate`, the same fields place
 * a copy of the block instead; a copy keeps the block's length.
 */
export function MoveBlockSheet({
  block,
  title = "Move block",
  duplicate = false,
  onClose,
  onSave,
}: {
  /** The sheet's title ("Move event" for an event). */
  title?: string;
  /** The block to move; the sheet shows while this is set. */
  block: MoveTarget | null;
  /** Place a copy at the chosen start instead of moving it. */
  duplicate?: boolean;
  onClose: () => void;
  /** Save the new times; a thrown error shows in the sheet. */
  onSave: (start: Date, end: Date) => Promise<void>;
}) {
  return (
    <Sheet visible={!!block} title={title} onClose={onClose}>
      {block && (
        <Body
          key={block.id}
          block={block}
          duplicate={duplicate}
          onSave={onSave}
        />
      )}
    </Sheet>
  );
}

function Body({
  block,
  duplicate,
  onSave,
}: {
  block: MoveTarget;
  duplicate: boolean;
  onSave: (start: Date, end: Date) => Promise<void>;
}) {
  const was = Math.round(
    (Date.parse(block.end_at) - Date.parse(block.start_at)) / 60_000,
  );
  // Tasks with only a due time have no length to change.
  const timed = was > 0;
  const [start, setStart] = useState(() => new Date(block.start_at));
  const [lengthText, setLengthText] = useState(String(was));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const typed = parseMinutes(lengthText);
  const length = duplicate || !timed ? was : (typed ?? 0);
  const lengthOk =
    duplicate || !timed || (length >= MIN_LENGTH && length <= MAX_LENGTH);
  const end = new Date(start.getTime() + Math.max(0, length) * 60_000);
  const unchanged =
    start.getTime() === Date.parse(block.start_at) && length === was;

  const pickDay = (day: string | null) => {
    if (!day) return;
    const [y, m, d] = day.split("-").map(Number);
    const next = new Date(start);
    next.setFullYear(y, m - 1, d);
    setStart(next);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(start, end);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          {block.title}. Now{" "}
          {timed
            ? slotLabel(block.start_at, block.end_at)
            : `${shortDay(block.start_at)}, ${clockLabel(block.start_at)}`}
          .
        </Text>
        <View style={shared.card}>
          <Field label="Day">
            <DateField label="Day" value={dayKey(start)} onChange={pickDay} />
          </Field>
          <Field
            label="Starts at"
            hint={
              !timed
                ? undefined
                : duplicate
                  ? `The copy ends at ${clockLabel(end)}, the same ${minutesLabel(was)} as this block.`
                  : lengthOk
                    ? `Ends at ${clockLabel(end)}.`
                    : undefined
            }
            style={duplicate || !timed ? s.last : undefined}
          >
            <TimeField label="Start time" value={start} onChange={setStart} />
          </Field>
          {timed && !duplicate && (
            <Field
              label="Length"
              hint={`${MIN_LENGTH} to ${MAX_LENGTH} minutes.`}
              style={s.last}
            >
              <NumberInput
                value={lengthText}
                onChangeText={setLengthText}
                suffix="minutes"
                accessibilityLabel={`Length in minutes, ${MIN_LENGTH} to ${MAX_LENGTH}`}
              />
            </Field>
          )}
        </View>
        {!lengthOk && (
          <Text style={[shared.small, s.problem]}>
            Give it a length from {MIN_LENGTH} to {MAX_LENGTH} minutes.
          </Text>
        )}
        <Button
          title={
            busy
              ? duplicate
                ? "Duplicating…"
                : "Moving…"
              : duplicate
                ? "Duplicate here"
                : "Move it here"
          }
          icon="check"
          disabled={busy || !lengthOk || (!duplicate && unchanged)}
          onPress={() => void save()}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  intro: { marginTop: 0, marginBottom: 18 },
  last: { marginBottom: 0 },
  problem: { textAlign: "center", marginBottom: 10 },
});

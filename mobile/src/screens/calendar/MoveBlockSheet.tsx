import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { TimeBlock } from "@orbyn/core";

/** Anything with times that can move: a time block, or an event occurrence. */
export type MoveTarget = Pick<
  TimeBlock,
  "id" | "title" | "start_at" | "end_at"
>;
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { DateField, Field, TimeField } from "../../components/Field";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { clockLabel, minutesLabel, slotLabel } from "../../lib/planning";
import { shared } from "../../styles";

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * "Move to…" for a time block: pick a day and a start time. The block keeps
 * its length.
 */
export function MoveBlockSheet({
  block,
  title = "Move block",
  onClose,
  onSave,
}: {
  /** The sheet's title ("Move event" for an event). */
  title?: string;
  /** The block to move; the sheet shows while this is set. */
  block: MoveTarget | null;
  onClose: () => void;
  /** Save the new times; a thrown error shows in the sheet. */
  onSave: (start: Date, end: Date) => Promise<void>;
}) {
  return (
    <Sheet visible={!!block} title={title} onClose={onClose}>
      {block && <Body key={block.id} block={block} onSave={onSave} />}
    </Sheet>
  );
}

function Body({
  block,
  onSave,
}: {
  block: MoveTarget;
  onSave: (start: Date, end: Date) => Promise<void>;
}) {
  const length = Date.parse(block.end_at) - Date.parse(block.start_at);
  const [start, setStart] = useState(() => new Date(block.start_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = new Date(start.getTime() + length);

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
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          {block.title}. Now {slotLabel(block.start_at, block.end_at)}.
        </Text>
        <View style={shared.card}>
          <Field label="Day">
            <DateField label="Day" value={dayKey(start)} onChange={pickDay} />
          </Field>
          <Field
            label="Starts at"
            hint={`Ends at ${clockLabel(end)}, the same ${minutesLabel(length / 60_000)} as now.`}
            style={s.last}
          >
            <TimeField label="Start time" value={start} onChange={setStart} />
          </Field>
        </View>
        <Button
          title={busy ? "Moving…" : "Move it here"}
          icon="check"
          disabled={busy || start.getTime() === Date.parse(block.start_at)}
          onPress={() => void save()}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  intro: { marginTop: 0, marginBottom: 18 },
  last: { marginBottom: 0 },
});

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { hoursLabel, type Item, type WorkRecord } from "@orbyn/core";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

/**
 * A meeting's cost — its length times the people in it, time not money —
 * and what came out of it, kept as a record beside the meeting.
 */
export function MeetingOutcome({
  item,
  canWrite,
}: {
  item: Item;
  canWrite: boolean;
}) {
  const [records, setRecords] = useState<WorkRecord[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    client
      .listWorkRecords({
        kind: "meeting_outcome",
        source_item_id: item.id,
        limit: 20,
      })
      .then(setRecords, () => setRecords([]));
  }, [item.id]);
  useEffect(load, [load]);
  const minutes =
    item.due_at && item.end_at
      ? Math.min(
          1440,
          Math.round(
            (Date.parse(item.end_at) - Date.parse(item.due_at)) / 60_000,
          ),
        )
      : 0;
  const people = Math.min(100, Math.max(1, (item.attendees?.length ?? 0) + 1));
  if (!minutes || item.all_day) return null;
  const ended = Date.parse(item.end_at!) <= Date.now();
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await client.createWorkRecord({
        kind: "meeting_outcome",
        title: item.title.slice(0, 200),
        details: text.trim(),
        team_id: item.team_id ?? null,
        project_id: item.project_id ?? null,
        source_item_id: item.id,
        meeting_minutes: minutes,
        participant_count: people,
      });
      setText("");
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[shared.card, s.card]}>
      <View style={s.head}>
        <Text style={shared.sectionTitle}>Meeting</Text>
        <Text style={s.cost}>
          {hoursLabel(minutes * people)} of people’s time
        </Text>
      </View>
      <Text style={shared.small}>
        {hoursLabel(minutes)} × {people} {people === 1 ? "person" : "people"}.
      </Text>
      {records?.map((r) => (
        <Text key={r.id} style={s.outcome}>
          Came out of it: {r.details || r.outcome}
        </Text>
      ))}
      {canWrite && ended && records?.length === 0 && (
        <>
          <TextInput
            style={shared.input}
            value={text}
            onChangeText={setText}
            maxLength={4000}
            placeholder="What came out of it? A decision, a next step…"
            placeholderTextColor={colors.faint}
            accessibilityLabel="What came out of it"
          />
          <SmallAction
            label="Keep it"
            disabled={busy || !text.trim()}
            onPress={() => void save()}
          />
        </>
      )}
      {!!error && <Text style={[shared.small, s.bad]}>{error}</Text>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { gap: 8 },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    cost: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
    outcome: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    bad: { color: colors.danger },
  }),
);

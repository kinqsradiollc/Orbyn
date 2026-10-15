import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { hoursLabel, type Item, type WorkRecord } from "@orbyn/core";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

export function MeetingOutcome(
  props: Parameters<typeof MeetingOutcomeBody>[0],
) {
  return <MeetingOutcomeBody key={props.item.id} {...props} />;
}

/**
 * A meeting's cost — its length times the people in it, time not money —
 * and what came out of it, kept as a record beside the meeting.
 */
function MeetingOutcomeBody({
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
  const request = useRef(0);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    if (!mounted.current) return;
    const version = ++request.current;
    try {
      const rows = await client.listWorkRecords({
        kind: "meeting_outcome",
        source_item_id: item.id,
        limit: 20,
      });
      if (version === request.current) {
        setRecords(rows);
        setError("");
      }
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    }
  }, [item.id]);
  useEffect(() => {
    mounted.current = true;
    setRecords(null);
    setText("");
    setError("");
    void load();
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [load]);
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
    if (mutation.current || !canWrite || !ended || !text.trim()) return;
    mutation.current = true;
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
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
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
          Outcome: {r.details || r.outcome}
        </Text>
      ))}
      {canWrite && ended && records?.length === 0 && (
        <>
          <TextInput
            style={shared.input}
            editable={!busy}
            value={text}
            onChangeText={setText}
            maxLength={4000}
            placeholder="Decision or next step"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Meeting outcome"
          />
          <SmallAction
            label="Save outcome"
            disabled={busy || !text.trim()}
            onPress={() => void save()}
          />
        </>
      )}
      {records === null && !error && (
        <Text style={shared.small}>Loading outcomes…</Text>
      )}
      {!!error && (
        <View>
          <Text style={[shared.small, s.bad]} accessibilityRole="alert">
            {error}
          </Text>
          {records === null && (
            <SmallAction
              label="Retry"
              disabled={busy}
              onPress={() => {
                setError("");
                void load();
              }}
            />
          )}
        </View>
      )}
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
      flexWrap: "wrap",
      gap: 8,
    },
    cost: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
    outcome: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    bad: { color: colors.danger },
  }),
);

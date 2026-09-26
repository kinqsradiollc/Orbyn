import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { hoursLabel, type ExperimentEvidence as Evidence } from "@orbyn/core";
import { client } from "../../lib/api";
import { colors, fonts, themed } from "../../theme";

const pct = (r: number | null) =>
  r === null ? "—" : `${Math.round(r * 100)}%`;

/** An experiment's before and after, from real numbers. */
export function ExperimentEvidence({ id }: { id: string }) {
  const [e, setE] = useState<Evidence | null>(null);
  useEffect(() => {
    client.experimentEvidence(id).then(setE, () => setE(null));
  }, [id]);
  if (!e) return null;
  const rows: [string, string, string][] = [
    ["Plans kept", pct(e.before.kept_rate), pct(e.during.kept_rate)],
    [
      "Focus a week",
      hoursLabel(e.before.focus_minutes_per_week),
      hoursLabel(e.during.focus_minutes_per_week),
    ],
    [
      "Tasks done a week",
      String(e.before.tasks_done_per_week),
      String(e.during.tasks_done_per_week),
    ],
  ];
  return (
    <View style={s.table}>
      <View style={s.row}>
        <Text style={[s.label, s.head]} />
        <Text style={[s.cell, s.head]}>Before</Text>
        <Text style={[s.cell, s.head]}>During</Text>
      </View>
      {rows.map(([label, before, during]) => (
        <View
          key={label}
          style={s.row}
          accessible
          accessibilityLabel={`${label}: ${before} before, ${during} during`}
        >
          <Text style={s.label}>{label}</Text>
          <Text style={s.cell}>{before}</Text>
          <Text style={s.cell}>{during}</Text>
        </View>
      ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    table: { marginVertical: 6, gap: 2 },
    row: {
      flexDirection: "row",
      paddingVertical: 3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    label: {
      flex: 1.4,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    cell: {
      flex: 1,
      textAlign: "right",
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    head: { fontFamily: fonts.semibold, color: colors.textSoft },
  }),
);

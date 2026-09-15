import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { statusLabels, statusTones, type Status } from "@orbyn/core";
import { colors, fonts, radii } from "../theme";

const TONES = {
  accent: { bg: colors.accentSoft, fg: colors.accent },
  muted: { bg: colors.surfaceMuted, fg: colors.muted },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  warning: { bg: "#fbf3e2", fg: "#a3742b" },
} as const;

export type PillTone = keyof typeof TONES;

/** Small rounded label for roles and states (Owner, Admin, Disabled…). */
export function Pill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: PillTone;
}) {
  const t = TONES[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg }]}>
      <Text style={[s.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** Task status ("In progress", "Blocked"…) in the shared status colors. */
export function StatusPill({ status }: { status: Status }) {
  const t = statusTones[status];
  return (
    <View
      accessible
      accessibilityLabel={`Status: ${statusLabels[status]}`}
      style={[s.pill, s.status, { backgroundColor: t.bg }]}
    >
      <View style={[s.dot, { backgroundColor: t.fg }]} />
      <Text style={[s.text, { color: t.fg }]}>{statusLabels[status]}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "center",
  },
  status: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: fonts.semibold, fontSize: 11 },
});

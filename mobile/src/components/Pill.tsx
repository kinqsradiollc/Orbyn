import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii } from "../theme";

const TONES = {
  accent: { bg: colors.accentSoft, fg: colors.accent },
  muted: { bg: colors.surfaceMuted, fg: colors.muted },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
} as const;

/** Small rounded label for roles and states (Owner, Admin, Disabled…). */
export function Pill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg }]}>
      <Text style={[s.text, { color: t.fg }]}>{label}</Text>
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
  text: { fontFamily: fonts.semibold, fontSize: 11 },
});

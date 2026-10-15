import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, radii } from "../theme";

/**
 * Progress is shown immediately; the value is also available to assistive technology.
 */
export function ProgressBar({
  value,
  height = 4,
  color = colors.accent,
  track = colors.divider,
  label,
}: {
  /** 0-100. */
  value: number;
  height?: number;
  color?: string;
  track?: string;
  /** Spoken name, e.g. "Write report progress". */
  label?: string;
}) {
  const clamped = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={[
        s.track,
        { height, borderRadius: radii.pill, backgroundColor: track },
      ]}
    >
      <View
        style={[
          s.fill,
          { height, width: `${clamped}%`, backgroundColor: color },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  track: { flex: 1, overflow: "hidden" },
  fill: { minWidth: 0 },
});

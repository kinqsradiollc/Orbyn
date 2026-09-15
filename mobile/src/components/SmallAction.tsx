import React from "react";
import { StyleSheet, Text } from "react-native";
import { PressableScale } from "../motion";
import { colors, fonts, radii } from "../theme";

/** Compact outlined action for list rows (Make admin, Load models, Delete…). */
export function SmallAction({
  label,
  onPress,
  disabled,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  destructive?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        pressed && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text
        style={[
          s.actionText,
          { color: destructive ? colors.danger : colors.accent },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  action: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: radii.input - 3,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontFamily: fonts.semibold, fontSize: 13 },
});

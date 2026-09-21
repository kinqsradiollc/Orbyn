import React from "react";
import { StyleSheet, Text } from "react-native";
import { PressableScale } from "../motion";
import { colors, fonts, radii, themed } from "../theme";

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
      hitSlop={{ top: 6, bottom: 6 }}
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

const s = themed(() =>
  StyleSheet.create({
    action: {
      minHeight: 44,
      maxWidth: "100%",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radii.input - 3,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    actionText: {
      flexShrink: 1,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
  }),
);

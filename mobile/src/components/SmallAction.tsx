import React from "react";
import { StyleSheet, Text, type TextProps } from "react-native";
import { PressableScale } from "../motion";
import { controls, colors, fonts, radii, themed } from "../theme";

/** Compact outlined action for list rows (Make admin, Load models, Delete…). */
export function SmallAction({
  label,
  onPress,
  disabled,
  destructive = false,
  accessibilityLiveRegion,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  destructive?: boolean;
  quiet?: boolean;
  accessibilityLiveRegion?: TextProps["accessibilityLiveRegion"];
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        quiet && {
          borderWidth: 0,
          backgroundColor: "transparent",
          paddingHorizontal: 4,
        },
        pressed && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text
        accessibilityLiveRegion={accessibilityLiveRegion}
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
      minHeight: controls.tap,
      maxWidth: "100%",
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    actionText: {
      flexShrink: 1,
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 13,
    },
  }),
);

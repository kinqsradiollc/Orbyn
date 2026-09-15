import React from "react";
import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "../motion";
import { colors, fonts, radii, themed } from "../theme";

export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  /** Red text on a secondary surface, for delete and sign out. */
  destructive?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const quiet = secondary || destructive;
  const tint = destructive
    ? colors.danger
    : secondary
      ? colors.accent
      : colors.white;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        quiet && s.secondary,
        pressed && (quiet ? s.secondaryPressed : s.pressed),
        disabled && s.disabled,
        style,
      ]}
    >
      <Text style={[s.text, { color: tint }]}>{title}</Text>
      {icon && <Icon name={icon} size={16} color={tint} strokeWidth={2} />}
    </PressableScale>
  );
}

const s = themed(() =>
  StyleSheet.create({
    button: {
      minHeight: 48,
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 18,
      backgroundColor: colors.accent,
      borderRadius: radii.input,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    pressed: { backgroundColor: colors.accentPressed },
    secondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryPressed: { backgroundColor: colors.surfaceMuted },
    disabled: { opacity: 0.45 },
    text: { fontFamily: fonts.semibold, fontSize: 15 },
  }),
);

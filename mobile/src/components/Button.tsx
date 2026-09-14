import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radii } from "../theme";

export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        s.button,
        secondary && s.secondary,
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text
        style={[s.buttonText, secondary && { color: colors.secondaryText }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: "#436e4f",
    borderRadius: radii.input,
    alignItems: "center",
    marginBottom: 12,
  },
  secondary: {
    backgroundColor: "#f3f6ed",
    borderWidth: 1,
    borderColor: "#dce5d2",
  },
  buttonText: { fontSize: 13, fontWeight: "600", color: colors.white },
});

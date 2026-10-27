import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../../motion";
import { colors, fonts, radii, themed } from "../../../theme";
export type DocumentEditorMode = "note" | "markdown" | "latex";
/** All editing formats stay visible, with touch-sized controls that can wrap. */
export function DocEditorModes({
  value,
  disabled = false,
  latexOnly = false,
  onChange,
}: {
  value: DocumentEditorMode;
  disabled?: boolean;
  latexOnly?: boolean;
  onChange: (mode: DocumentEditorMode) => void;
}) {
  return (
    <View style={styles.modes} accessibilityLabel="Document editor">
      {(
        [
          ["note", "Note"],
          ["markdown", "Markdown"],
          ["latex", "LaTeX"],
        ] as const
      )
        .filter(([mode]) => !latexOnly || mode !== "markdown")
        .map(([mode, label]) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityState={{ selected: value === mode, disabled }}
            disabled={disabled}
            style={[
              styles.target,
              value === mode && styles.selected,
              disabled && styles.disabled,
            ]}
            onPress={() => onChange(mode)}
          >
            <Text style={[styles.label, value === mode && styles.active]}>
              {label}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}
const styles = themed(() =>
  StyleSheet.create({
    modes: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 2,
    },
    target: {
      minHeight: 44,
      paddingHorizontal: 10,
      justifyContent: "center",
      borderRadius: radii.input,
    },
    selected: { backgroundColor: colors.surfaceMuted },
    disabled: { opacity: 0.5 },
    label: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
    active: { color: colors.text },
  }),
);

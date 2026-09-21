import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { PressableScale } from "../motion";
import { controls, colors, fonts, radii, themed } from "../theme";

/**
 * A choice chip: single choice (radio) or one of many (checkbox). Selected
 * chips fill with the accent, or with `color` for lists and tags.
 */
export function Chip({
  label,
  selected,
  onPress,
  color,
  multi = false,
  disabled = false,
  compact = false,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Dot and selected colour, e.g. a list's colour. */
  color?: string;
  /** Checkbox semantics instead of radio. */
  multi?: boolean;
  disabled?: boolean;
  /**
   * Half the height and a smaller face, for a row of chips that is chrome
   * rather than the point of the screen. The target stays a thumb's worth
   * through hitSlop; only the pill shrinks.
   */
  compact?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const tint = color ?? colors.accent;
  return (
    <PressableScale
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      hitSlop={compact ? { top: 9, bottom: 9 } : { top: 4, bottom: 4 }}
      onPress={onPress}
      style={[
        s.chip,
        compact && s.compact,
        selected && { backgroundColor: tint, borderColor: tint },
        disabled && s.disabled,
      ]}
    >
      {color && !selected && (
        <View style={[s.dot, { backgroundColor: color }]} />
      )}
      <Text
        numberOfLines={1}
        style={[
          s.text,
          compact && s.compactText,
          selected && { color: colors.white },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/** Chips that wrap onto more lines. */
export function ChipRow({
  children,
  label,
  multi = false,
  style,
}: {
  children: React.ReactNode;
  /** Spoken name of the group. */
  label: string;
  multi?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[s.row, style]}
      accessibilityRole={multi ? undefined : "radiogroup"}
      accessibilityLabel={label}
    >
      {children}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      // A chip is a button, and a button wants a finger's worth of height.
      // Everything else on the phone was raised to this; these were missed,
      // and they are the controls people tap most — the status filters.
      minHeight: controls.tap,
      maxWidth: "100%",
      paddingVertical: 8,
      paddingHorizontal: 13,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    compact: {
      minHeight: controls.compact,
      paddingVertical: 4,
      paddingHorizontal: 11,
    },
    compactText: { fontSize: 13 },
    disabled: { opacity: 0.45 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    text: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
  }),
);

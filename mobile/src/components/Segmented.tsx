import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii } from "../theme";

/**
 * iOS-style segmented control. With `wrap`, segments become chips that flow
 * onto extra lines, for option lists of unknown length (teams).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  wrap = false,
  disabled = false,
  accessibilityLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Display text per option; options without a label are shown capitalised. */
  labels?: Partial<Record<T, string>>;
  wrap?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={[s.segmented, wrap && s.wrap, disabled && s.disabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const active = option === value;
        const label = labels?.[option];
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option)}
            style={[s.segment, wrap && s.chip, active && s.segmentActive]}
          >
            <Text
              numberOfLines={1}
              style={[
                s.segmentText,
                !label && s.capitalize,
                active && s.segmentTextActive,
              ]}
            >
              {label ?? option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.input,
    padding: 3,
  },
  wrap: { flexWrap: "wrap", gap: 3 },
  disabled: { opacity: 0.6 },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.input - 3,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  chip: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: "auto",
    paddingHorizontal: 14,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: "#1d2b23",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  capitalize: { textTransform: "capitalize" },
  segmentTextActive: { fontFamily: fonts.semibold, color: colors.accent },
});

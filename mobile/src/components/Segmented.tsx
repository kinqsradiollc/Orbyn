import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii, themed } from "../theme";

/**
 * iOS-style segmented control. With `wrap`, segments become chips that flow
 * onto extra lines, for option lists of unknown length (teams).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  badges,
  wrap = false,
  disabled = false,
  accessibilityLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Display text per option; options without a label are shown capitalised. */
  labels?: Partial<Record<T, string>>;
  /** A count shown after an option's text, e.g. requests waiting; 0 hides it. */
  badges?: Partial<Record<T, number>>;
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
        const badge = badges?.[option] ?? 0;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled }}
            accessibilityLabel={
              badge > 0 ? `${label ?? option}, ${badge}` : undefined
            }
            disabled={disabled}
            onPress={() => onChange(option)}
            style={[s.segment, wrap && s.chip, active && s.segmentActive]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={[
                s.segmentText,
                !label && s.capitalize,
                active && s.segmentTextActive,
              ]}
            >
              {label ?? option}
            </Text>
            {badge > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{badge > 99 ? "99+" : badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
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
      minWidth: 0,
      minHeight: 40,
      flexDirection: "row",
      gap: 6,
      borderRadius: radii.input - 3,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8,
    },
    chip: {
      // Reset the segment's `flex: 1`: in Yoga it forces a zero flex basis, so
      // chips would share one row at equal widths instead of wrapping.
      flex: 0,
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: "auto",
      paddingHorizontal: 14,
    },
    segmentActive: {
      backgroundColor: colors.surface,
      shadowColor: colors.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    segmentText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.muted,
    },
    capitalize: { textTransform: "capitalize" },
    segmentTextActive: { fontFamily: fonts.semibold, color: colors.accent },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: colors.highText,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.white,
    },
  }),
);

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Icon } from "./Icon";
import { FadeIn } from "../motion";
import { colors, fonts, radii, themed } from "../theme";

/**
 * Inline error message. Renders nothing when there is no error; tap to dismiss
 * when `onDismiss` is given. Slides down and fades in when it appears.
 */
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <FadeIn from="down" style={s.banner}>
      <Text accessibilityRole="alert" style={s.text}>
        {error}
      </Text>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          hitSlop={10}
          onPress={onDismiss}
        >
          <Icon name="x" size={16} color={colors.danger} />
        </Pressable>
      )}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.dangerSoft,
      borderRadius: radii.input,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 16,
    },
    text: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 19,
      color: colors.danger,
    },
  }),
);

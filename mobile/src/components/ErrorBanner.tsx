import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";

/**
 * Inline error message. Renders nothing when there is no error; tap to dismiss
 * when `onDismiss` is given. Remains stable when it appears.
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
    <View style={s.banner}>
      <Text accessibilityRole="alert" style={s.text}>
        {error}
      </Text>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          style={{
            minWidth: 44,
            minHeight: 44,
            justifyContent: "center",
            alignItems: "center",
          }}
          onPress={onDismiss}
        >
          <Icon name="x" size={16} color={colors.danger} />
        </Pressable>
      )}
    </View>
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

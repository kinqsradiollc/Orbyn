import React from "react";
import { Pressable, Text } from "react-native";
import { shared } from "../styles";

/** Inline error message. Renders nothing when there is no error; tap to dismiss when `onDismiss` is given. */
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  const text = (
    <Text accessibilityRole="alert" style={shared.error}>
      {error}
    </Text>
  );
  return onDismiss ? <Pressable onPress={onDismiss}>{text}</Pressable> : text;
}

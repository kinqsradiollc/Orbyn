import React, { useEffect, useSyncExternalStore } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Pressable } from "../motion";
import { currentAlert, settleAlert, subscribeAlerts } from "../lib/alert";
import { colors, fonts, radii, spacing, themed, tint } from "../theme";

/** One app-owned confirmation above the current web sheet, with queued requests. */
export function AlertHost() {
  const request = useSyncExternalStore(
    subscribeAlerts,
    currentAlert,
    () => null,
  );
  useEffect(() => {
    if (!request || Platform.OS !== "web") return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [request?.id]);
  if (Platform.OS !== "web" || !request) return null;
  const dismiss = () => settleAlert(request.id);
  return (
    <Modal
      key={request.id}
      accessibilityLabel={request.title}
      transparent
      visible
      animationType="none"
      onRequestClose={dismiss}
    >
      <View style={s.backdrop}>
        <View
          style={s.dialog}
          accessibilityViewIsModal
          accessibilityLabel={request.title}
        >
          <ScrollView style={s.body} contentContainerStyle={s.content}>
            <Text accessibilityRole="header" style={s.title}>
              {request.title}
            </Text>
            {!!request.message && (
              <Text style={s.message}>{request.message}</Text>
            )}
          </ScrollView>
          <View style={s.actions}>
            {request.buttons.map((button, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                onPress={() => settleAlert(request.id, button)}
                style={({ pressed }) => [s.button, pressed && s.pressed]}
              >
                <Text
                  style={[s.label, button.style === "destructive" && s.danger]}
                >
                  {button.text ?? "OK"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.page,
      backgroundColor: tint(colors.shadow, 0.35),
    },
    dialog: {
      width: "100%",
      maxWidth: 440,
      maxHeight: "90%",
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    body: { flexGrow: 0, flexShrink: 1 },
    content: { padding: spacing.page, gap: 8 },
    title: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
    message: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSoft,
    },
    actions: {
      padding: spacing.page,
      paddingTop: 0,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      justifyContent: "flex-end",
    },
    button: {
      minHeight: 44,
      maxWidth: "100%",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
      justifyContent: "center",
    },
    pressed: { backgroundColor: colors.accentSoft },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.accent,
      flexShrink: 1,
    },
    danger: { color: colors.danger },
  }),
);

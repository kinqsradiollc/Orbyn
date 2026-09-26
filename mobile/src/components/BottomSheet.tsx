import React, { useEffect, useRef } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ToastHost } from "./Toast";
import { colors, fonts, radii, spacing, themed, tint } from "../theme";

/**
 * A sheet that rises from the bottom over whatever is open, with a small
 * grab handle and an optional title: the + sheet, a page's Info and the
 * share sheet. A tap on the dimmed space above it closes it. `afterClose`
 * runs once it has gone, for anything that opens next (on iOS another
 * sheet can't open while this one is still leaving).
 */
export function BottomSheet({
  visible,
  title,
  label,
  onClose,
  afterClose,
  footer,
  children,
}: {
  visible: boolean;
  title?: string;
  /** What the sheet is, for screen readers, when it has no title. */
  label?: string;
  onClose: () => void;
  afterClose?: () => void;
  /** Kept below the scrolling part: the sheet's one main button. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const after = useRef(afterClose);
  after.current = afterClose;
  // Only iOS reports the dismissal; elsewhere the sheet is gone at once.
  const was = useRef(visible);
  useEffect(() => {
    if (was.current && !visible && Platform.OS !== "ios") after.current?.();
    was.current = visible;
  }, [visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? () => after.current?.() : undefined}
    >
      <KeyboardAvoidingView
        style={s.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={s.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <View
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
          accessibilityViewIsModal
          accessibilityLabel={title ?? label}
        >
          <View style={s.handle} />
          {!!title && (
            <Text style={s.title} accessibilityRole="header">
              {title}
            </Text>
          )}
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.body}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer && <View style={s.footer}>{footer}</View>}
        </View>
        <ToastHost />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    fill: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: tint(colors.shadow, 0.35),
    },
    sheet: {
      maxHeight: "88%",
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
      paddingTop: 8,
      borderTopLeftRadius: radii.card,
      borderTopRightRadius: radii.card,
      backgroundColor: colors.background,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      borderRadius: radii.pill,
      marginBottom: 8,
      backgroundColor: colors.border,
    },
    title: {
      paddingHorizontal: spacing.page,
      paddingBottom: 6,
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.text,
    },
    scroll: { flexGrow: 0 },
    body: { paddingHorizontal: spacing.page, paddingBottom: 8, gap: 4 },
    footer: { paddingHorizontal: spacing.page, paddingTop: 8 },
  }),
);

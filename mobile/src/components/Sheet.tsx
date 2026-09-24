import React, { useRef } from "react";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { ToastHost } from "./Toast";
import { controls, colors, fonts, spacing, themed } from "../theme";

/**
 * Page sheet shared by Teams and the Admin console: the same Modal pattern as
 * ItemEditor (pageSheet on iOS, full screen on Android) with a header that can
 * show a back chevron for pages pushed inside the sheet.
 */
export function Sheet({
  visible,
  title,
  onClose,
  onBack,
  onDismiss,
  avoidKeyboard = true,
  actions,
  hideClose = false,
  centerTitle = false,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Buttons for the header's right side, before the close button. */
  actions?: React.ReactNode;
  /** Leave the close button out, when Back already closes (a page's header). */
  hideClose?: boolean;
  /** A short title in the middle of the header rather than after Back. */
  centerTitle?: boolean;
  /** Shows a back chevron that returns to the previous page in the sheet. */
  onBack?: () => void;
  /** iOS: called once the dismiss animation has finished. */
  onDismiss?: () => void;
  /** Disable when the content already handles keyboard overlap. */
  avoidKeyboard?: boolean;
  children: React.ReactNode;
}) {
  const area = useRef<View>(null);
  const keyboard = useKeyboardInset(area, visible && avoidKeyboard);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      // iOS calls this after a pageSheet swipe-down has already dismissed the
      // sheet, so it must close; Android's back button pops the pushed page.
      onRequestClose={Platform.OS === "android" && onBack ? onBack : onClose}
      onDismiss={onDismiss}
    >
      <SafeAreaProvider>
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={s.sheet}
        >
          <View style={s.header}>
            {onBack && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={10}
                onPress={onBack}
                style={s.round}
              >
                <Icon name="chevronLeft" size={18} color={colors.textSoft} />
              </Pressable>
            )}
            {centerTitle ? (
              <>
                <View
                  style={[StyleSheet.absoluteFill, s.centered]}
                  pointerEvents="none"
                >
                  <Text
                    style={[s.title, s.centeredTitle]}
                    numberOfLines={1}
                    accessibilityRole="header"
                  >
                    {title}
                  </Text>
                </View>
                <View style={s.spacer} />
              </>
            ) : (
              <Text style={s.title} numberOfLines={1}>
                {title}
              </Text>
            )}
            {actions}
            {!hideClose && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                onPress={onClose}
                style={s.round}
              >
                <Icon name="x" size={18} color={colors.textSoft} />
              </Pressable>
            )}
          </View>
          <View
            ref={area}
            collapsable={false}
            onLayout={keyboard.onLayout}
            style={{ flex: 1, paddingBottom: keyboard.inset }}
          >
            {children}
          </View>
          {/* A sheet covers the app, so a toast raised in it shows here. */}
          <ToastHost />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/** A round icon button for a sheet's header, the same size as Back and Close. */
export function HeaderButton({
  icon,
  label,
  onPress,
  on = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Whether what it opens is open. */
  on?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: on }}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        s.round,
        (on || pressed) && { backgroundColor: colors.accentSoft },
      ]}
    >
      <Icon
        name={icon}
        size={18}
        color={on ? colors.accent : colors.textSoft}
      />
    </Pressable>
  );
}

export const sheetStyles = StyleSheet.create({
  body: { padding: spacing.page, paddingBottom: 40 },
  column: { width: "100%", maxWidth: 600, alignSelf: "center" },
});

const s = themed(() =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: spacing.page,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    spacer: { flex: 1 },
    centered: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 112,
    },
    centeredTitle: { flex: 0, fontSize: 15, textAlign: "center" },
    title: {
      flex: 1,
      fontFamily: fonts.display,
      fontSize: 18,
      letterSpacing: -0.4,
      color: colors.text,
    },
    round: {
      width: 44,
      height: controls.tap,
      borderRadius: 22,
      backgroundColor: colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);

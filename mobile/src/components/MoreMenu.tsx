import React, { useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Pressable } from "../motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { useSwipeDown } from "../hooks/useSwipeDown";
import { colors, controls, fonts, radii, themed, tint } from "../theme";

export type MoreAction = {
  label: string;
  onPress: () => void;
  /** A line icon before the verb (the + sheet, a row's long-press menu). */
  icon?: IconName;
  /** Red, and listed last: delete, leave, remove. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * The "⋯" beside a title. Managing a thing (rename, delete, leave) is rare,
 * so it lives in a sheet instead of a row of buttons over the content;
 * the title stays the first thing you read.
 */
export function MoreMenu({
  label,
  actions,
  title,
  disabled = false,
}: {
  /** What the menu is for, e.g. "Project options". */
  label: string;
  actions: MoreAction[];
  /** The thing's name, shown at the top of the sheet. */
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        hitSlop={8}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.trigger,
          pressed && { backgroundColor: colors.surfaceMuted },
          disabled && { opacity: 0.45 },
        ]}
      >
        <Icon name="more" size={18} color={colors.textSoft} />
      </Pressable>
      <ActionSheet
        visible={open}
        label={label}
        title={title}
        actions={actions}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/**
 * A menu that rises from the bottom (MOB-04): a grab handle, the thing it is
 * for, its actions as rows of one height with no lines between them, and
 * Cancel. Pulled down by the handle, or a tap above it, it closes. The
 * chosen action runs once the menu has gone (on iOS a new sheet, or the
 * share sheet, can't open while this one is still leaving).
 */
export function ActionSheet({
  visible,
  label,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  /** What the menu is for, read out to screen readers. */
  label: string;
  /** Shown at the top, muted: the thing the actions are for. */
  title?: string;
  actions: MoreAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const chosen = useRef<(() => void) | null>(null);
  const shown = [
    ...actions.filter((a) => !a.destructive),
    ...actions.filter((a) => a.destructive),
  ];
  const run = () => {
    const next = chosen.current;
    chosen.current = null;
    next?.();
  };
  const swipe = useSwipeDown(visible, onClose);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? run : undefined}
    >
      <View style={s.fill}>
        <Pressable
          quiet
          style={s.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={onClose}
        />
        <Animated.View
          style={[
            s.sheet,
            { paddingBottom: Math.max(insets.bottom, 12) },
            { transform: [{ translateY: swipe.offset }] },
          ]}
          accessibilityRole="menu"
          accessibilityLabel={label}
          accessibilityViewIsModal
        >
          <View {...swipe.handlers} style={s.grab}>
            <View style={s.handle} />
            {!!title && (
              <Text style={s.title} numberOfLines={2}>
                {title}
              </Text>
            )}
          </View>
          <ScrollView style={s.actionList} keyboardShouldPersistTaps="handled">
            {shown.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="menuitem"
                disabled={a.disabled}
                onPress={() => {
                  chosen.current = a.onPress;
                  onClose();
                  // Only iOS waits for the menu to go before the next thing,
                  // and not for ever should the dismissal go unreported.
                  if (Platform.OS !== "ios") run();
                  else setTimeout(run, 600);
                }}
                style={({ pressed }) => [
                  s.item,
                  pressed && { backgroundColor: colors.surfaceMuted },
                  a.disabled && { opacity: 0.45 },
                ]}
              >
                {a.icon && (
                  <Icon
                    name={a.icon}
                    size={18}
                    color={a.destructive ? colors.danger : colors.textSoft}
                  />
                )}
                <Text
                  style={[
                    s.itemText,
                    a.destructive && { color: colors.danger },
                  ]}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              s.item,
              s.cancelRow,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={[s.itemText, s.cancel]}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    trigger: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
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
      width: "100%",
      maxWidth: 640,
      maxHeight: "88%",
      alignSelf: "center",
      paddingTop: 8,
      paddingHorizontal: 8,
      borderTopLeftRadius: radii.card,
      borderTopRightRadius: radii.card,
      backgroundColor: colors.surface,
    },
    grab: { paddingBottom: 4 },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      borderRadius: radii.pill,
      marginBottom: 6,
      backgroundColor: colors.border,
    },
    title: {
      paddingHorizontal: 16,
      paddingBottom: 6,
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.muted,
    },
    actionList: { flexShrink: 1, minHeight: 0 },
    // Rows share a minimum height; long labels wrap with room on every side.
    item: {
      minHeight: controls.tap + 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radii.input,
    },
    itemText: {
      flexShrink: 1,
      minWidth: 0,
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    cancelRow: { marginTop: 4 },
    cancel: { textAlign: "center", color: colors.textSoft },
  }),
);

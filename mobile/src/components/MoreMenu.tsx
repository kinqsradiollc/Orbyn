import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Pressable, useReducedMotion } from "../motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { session } from "../lib/session";
import { Icon, type IconName } from "./Icon";
import { useSwipeDown } from "../hooks/useSwipeDown";
import { colors, controls, fonts, radii, themed, tint } from "../theme";

export type MoreAction = {
  label: string;
  /** Stable identity when different choices share a label. */
  id?: string;
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
  cancelLabel = "Cancel",
  message,
}: {
  visible: boolean;
  /** What the menu is for, read out to screen readers. */
  label: string;
  /** Shown at the top, muted: the thing the actions are for. */
  title?: string;
  actions: MoreAction[];
  /** Selected actions close before their deferred callback runs. */
  onClose: (selection?: "selected") => void;
  /** A clearer dismissal verb for confirmation sheets, e.g. Keep task. */
  cancelLabel?: string;
  /** Full explanation for a confirmation, wrapped within the scrolling sheet. */
  message?: string;
}) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const chosen = useRef<{ run: () => void; owner: string } | null>(null);
  const mounted = useRef(true);
  const committed = useRef(false);
  const owner = useRef(session.token);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      chosen.current = null;
      if (fallback.current !== null) clearTimeout(fallback.current);
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    owner.current = session.token;
    committed.current = false;
    chosen.current = null;
    if (fallback.current !== null) clearTimeout(fallback.current);
    fallback.current = null;
  }, [visible]);
  const shown = [
    ...actions.filter((a) => !a.destructive),
    ...actions.filter((a) => a.destructive),
  ];
  const run = () => {
    const next = chosen.current;
    chosen.current = null;
    if (fallback.current !== null) clearTimeout(fallback.current);
    fallback.current = null;
    if (mounted.current && next?.owner === session.token) next.run();
  };
  const swipe = useSwipeDown(visible, onClose);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === "web" || reducedMotion ? "none" : "slide"}
      onRequestClose={() => onClose()}
      onDismiss={Platform.OS === "ios" ? run : undefined}
    >
      <View style={s.fill}>
        <Pressable
          quiet
          style={s.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={() => onClose()}
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
          </View>
          <ScrollView style={s.actionList} keyboardShouldPersistTaps="handled">
            {!!title && <Text style={s.title}>{title}</Text>}
            {!!message && <Text style={s.message}>{message}</Text>}
            {shown.map((a) => (
              <Pressable
                key={a.id ?? a.label}
                accessibilityRole="menuitem"
                disabled={a.disabled}
                onPress={() => {
                  if (
                    !mounted.current ||
                    committed.current ||
                    owner.current !== session.token ||
                    a.disabled
                  )
                    return;
                  committed.current = true;
                  chosen.current = { run: a.onPress, owner: owner.current };
                  onClose("selected");
                  // Only iOS waits for the menu to go before the next thing,
                  // and not for ever should the dismissal go unreported.
                  if (Platform.OS !== "ios") run();
                  else fallback.current = setTimeout(run, 600);
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
            onPress={() => onClose()}
            style={({ pressed }) => [
              s.item,
              s.cancelRow,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={[s.itemText, s.cancel]}>{cancelLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    trigger: {
      width: controls.tap,
      height: controls.tap,
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
    message: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.textSoft,
    },
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

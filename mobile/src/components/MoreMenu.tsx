import React, { useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import { colors, controls, fonts, radii, themed, tint } from "../theme";

export type MoreAction = {
  label: string;
  onPress: () => void;
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
 * A menu that rises from the bottom: a list of actions and Cancel. The
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? run : undefined}
    >
      <Pressable
        style={s.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
      >
        <View
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
          accessibilityRole="menu"
          accessibilityLabel={label}
        >
          <View style={s.group}>
            {!!title && (
              <Text style={s.title} numberOfLines={2}>
                {title}
              </Text>
            )}
            {shown.map((a, n) => (
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
                  (n > 0 || !!title) && s.divided,
                  pressed && { backgroundColor: colors.surfaceMuted },
                  a.disabled && { opacity: 0.45 },
                ]}
              >
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
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              s.group,
              s.item,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={[s.itemText, s.cancel]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
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
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: tint(colors.shadow, 0.35),
    },
    sheet: { gap: 8, paddingHorizontal: 12, paddingTop: 12 },
    group: {
      overflow: "hidden",
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    title: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.muted,
    },
    item: {
      minHeight: controls.tap + 8,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    divided: { borderTopWidth: 1, borderTopColor: colors.divider },
    itemText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    cancel: { fontFamily: fonts.semibold, color: colors.textSoft },
  }),
);

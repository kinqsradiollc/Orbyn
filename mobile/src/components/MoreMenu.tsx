import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
  disabled = false,
}: {
  /** What the menu is for, e.g. "Project options". */
  label: string;
  actions: MoreAction[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const shown = [
    ...actions.filter((a) => !a.destructive),
    ...actions.filter((a) => a.destructive),
  ];
  if (!shown.length) return null;
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
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={s.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={() => setOpen(false)}
        >
          <View
            style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
            accessibilityRole="menu"
            accessibilityLabel={label}
          >
            <View style={s.group}>
              {shown.map((a, n) => (
                <Pressable
                  key={a.label}
                  accessibilityRole="menuitem"
                  disabled={a.disabled}
                  onPress={() => {
                    setOpen(false);
                    a.onPress();
                  }}
                  style={({ pressed }) => [
                    s.item,
                    n > 0 && s.divided,
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
              onPress={() => setOpen(false)}
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
    </>
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

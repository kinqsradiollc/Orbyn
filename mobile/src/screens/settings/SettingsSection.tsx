import React, { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

const REMEMBER = "orbyn-settings-open";

const openSet = (): Set<string> => {
  try {
    return new Set(JSON.parse(readLocal(REMEMBER) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

/**
 * One settings section, folded away until it is wanted.
 *
 * Settings had grown to one screen of nearly a thousand lines, so finding
 * anything meant scrolling past everything else. This is the same fold the
 * desktop uses, so the two read alike: the heading that was a label above
 * the card becomes the thing you press to open it, and what you opened last
 * time is still open when you come back.
 */
export function SettingsSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => defaultOpen || openSet().has(title));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    const all = openSet();
    if (next) all.add(title);
    else all.delete(title);
    saveLocal(REMEMBER, JSON.stringify([...all]));
  };

  return (
    <View style={[shared.card, s.section]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [s.head, pressed && s.headPressed]}
      >
        <Text style={s.title}>{title}</Text>
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open && <View style={s.body}>{children}</View>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: { padding: 0, overflow: "hidden" },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
    },
    headPressed: { backgroundColor: colors.surfaceMuted },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
    },
    body: {
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 16,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
  }),
);

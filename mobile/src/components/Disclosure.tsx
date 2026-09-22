import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { colors, fonts, radii, themed } from "../theme";

/** Keeps long mobile forms navigable without discarding their mounted state. */
export function Disclosure({
  title,
  detail,
  initiallyOpen = false,
  children,
}: {
  title: string;
  detail: string;
  initiallyOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={s.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [s.heading, pressed && { opacity: 0.65 }]}
      >
        <View style={s.copy}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.detail}>{detail}</Text>
        </View>
        <Icon
          name={open ? "chevronDown" : "chevronRight"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      <View style={[s.body, !open && s.hidden]}>{children}</View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: {
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 16,
      minHeight: 76,
    },
    copy: { flex: 1, minWidth: 0, gap: 4 },
    title: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
    detail: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
    },
    body: { paddingHorizontal: 16, paddingBottom: 16 },
    hidden: { display: "none" },
  }),
);

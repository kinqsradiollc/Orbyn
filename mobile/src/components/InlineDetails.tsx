import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../motion";
import { Icon } from "./Icon";
import { colors, fonts, themed } from "../theme";

/** Optional row detail without another card or a clipped preview. */
export function InlineDetails({
  title,
  children,
  reveal = false,
}: {
  title: string;
  children: React.ReactNode;
  /** Keep invalid fields discoverable while their error remains active. */
  reveal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || reveal;
  return (
    <View style={s.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => setOpen(!open)}
        style={s.trigger}
      >
        <Text style={s.label}>{title}</Text>
        <Icon
          name={expanded ? "chevronDown" : "chevronRight"}
          size={16}
          color={colors.muted}
        />
      </Pressable>
      <View style={[s.body, !expanded && s.hidden]}>{children}</View>
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    root: { minWidth: 0 },
    trigger: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    label: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
    body: { gap: 6, paddingBottom: 8 },
    hidden: { display: "none" },
  }),
);

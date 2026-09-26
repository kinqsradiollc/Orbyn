import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { colors, fonts, themed } from "../theme";

/** A compact introduction that gives mobile workspaces a consistent hierarchy. */
export function ScreenIntro({
  icon,
  title,
  detail,
}: {
  icon: IconName;
  title: string;
  detail: string;
}) {
  return (
    <View style={s.intro}>
      <View style={s.badge}>
        <Icon name={icon} size={24} color={colors.accent} />
      </View>
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      <Text style={s.detail}>{detail}</Text>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { gap: 8, marginBottom: 22 },
    badge: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 34,
      letterSpacing: -0.7,
      color: colors.text,
    },
    detail: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
    },
  }),
);

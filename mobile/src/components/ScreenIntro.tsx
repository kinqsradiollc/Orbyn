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
      <View style={s.heading}>
        <View style={s.badge}>
          <Icon name={icon} size={18} color={colors.accent} />
        </View>
        <Text accessibilityRole="header" style={s.title}>
          {title}
        </Text>
      </View>
      {detail && <Text style={s.detail}>{detail}</Text>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { gap: 6, marginBottom: 14 },
    heading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    badge: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: fonts.bold,
      flex: 1,
      minWidth: 0,
      fontSize: 18,
      lineHeight: 26,
      letterSpacing: -0.2,
      color: colors.text,
    },
    detail: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
    },
  }),
);

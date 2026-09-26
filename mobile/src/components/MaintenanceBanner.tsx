import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Maintenance } from "@orbyn/core";
import { Icon } from "./Icon";
import { FadeIn } from "../motion";
import { colors, fonts, themed } from "../theme";

export const maintenanceTone = themed(() => ({
  bg: colors.warningSoft,
  fg: colors.warning,
  border: colors.warningBorder,
}));

/** "today at 3:30 PM", or "Sep 16, 3:30 PM" on another day. */
export function formatUntil(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return date.toDateString() === new Date().toDateString()
    ? `today at ${time}`
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * Slim notice under the app header while maintenance mode is on. Members are
 * told changes are paused; admins, who can keep working, are reminded it's on.
 */
export function MaintenanceBanner({
  maintenance,
  admin,
}: {
  maintenance: Maintenance | null;
  admin: boolean;
}) {
  if (!maintenance?.enabled) return null;
  const headline = admin
    ? "Maintenance mode is on. Members can't make changes."
    : "Orbyn is under maintenance. You can view everything, but changes are paused.";
  const details = [
    maintenance.message.trim(),
    maintenance.until ? `Expected back ${formatUntil(maintenance.until)}.` : "",
  ].filter(Boolean);
  return (
    <FadeIn from="down" style={s.banner}>
      <View
        style={s.row}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={[headline, ...details].join(" ")}
      >
        <Icon name="clock" size={15} color={maintenanceTone.fg} />
        <View style={{ flex: 1 }}>
          <Text style={s.headline}>{headline}</Text>
          {details.length > 0 && (
            <Text style={s.details} numberOfLines={3}>
              {details.join(" ")}
            </Text>
          )}
        </View>
      </View>
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    banner: {
      backgroundColor: maintenanceTone.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: maintenanceTone.border,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      paddingVertical: 8,
    },
    headline: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      lineHeight: 17,
      color: maintenanceTone.fg,
    },
    details: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 17,
      color: maintenanceTone.fg,
      marginTop: 1,
    },
  }),
);

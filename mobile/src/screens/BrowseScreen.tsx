import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hasSystemPermission, type User } from "@orbyn/core";
import { Icon, type IconName } from "../components/Icon";
import { FadeIn } from "../motion";
import { shared } from "../styles";
import { colors, fonts, themed } from "../theme";

/** Every destination the tab bar has no room for. */
export type Destination =
  | "agenda"
  | "projects"
  | "docs"
  | "lists"
  | "teams"
  | "booking"
  | "admin"
  | "settings";

type Row = {
  to: Destination;
  icon: IconName;
  title: string;
  detail: string;
  adminOnly?: boolean;
};

/**
 * The same three groups, in the same order, with the same words as the
 * desktop sidebar — minus the five sections that have a tab of their own.
 * Anything the desktop can reach in one click is one tap from here.
 */
const GROUPS: { label: string; rows: Row[] }[] = [
  {
    label: "TODAY",
    rows: [
      {
        to: "agenda",
        icon: "sun",
        title: "Agenda",
        detail: "Written for you each morning",
      },
    ],
  },
  {
    label: "YOUR WORK",
    rows: [
      {
        to: "projects",
        icon: "boxes",
        title: "Projects",
        detail: "Work grouped into stages",
      },
      {
        to: "docs",
        icon: "fileText",
        title: "Docs",
        detail: "Notes, briefs and meeting notes",
      },
      {
        to: "lists",
        icon: "list",
        title: "Lists",
        detail: "Somewhere for each kind of task",
      },
    ],
  },
  {
    label: "SHARED",
    rows: [
      {
        to: "teams",
        icon: "users",
        title: "Teams",
        detail: "The people you plan with",
      },
      {
        to: "booking",
        icon: "calendar",
        title: "Booking",
        detail: "Let people find a time with you",
      },
      {
        to: "admin",
        icon: "shieldCheck",
        title: "Admin",
        detail: "Accounts, teams and every change",
        adminOnly: true,
      },
    ],
  },
  {
    label: "YOUR SPACE",
    rows: [
      {
        to: "settings",
        icon: "settings",
        title: "Settings",
        detail: "Your space, just the way you like it",
      },
    ],
  },
];

export function BrowseScreen({
  user,
  onOpen,
}: {
  user: User | null;
  onOpen: (to: Destination) => void;
}) {
  const admin = hasSystemPermission(user?.role, "admin:access");
  return (
    <>
      {GROUPS.map((group, n) => {
        const rows = group.rows.filter((r) => !r.adminOnly || admin);
        if (!rows.length) return null;
        return (
          <FadeIn key={group.label} delay={n * 40}>
            <View style={shared.card}>
              <Text style={shared.eyebrow}>{group.label}</Text>
              <View style={s.rows}>
                {rows.map((row) => (
                  <Pressable
                    key={row.to}
                    accessibilityRole="button"
                    accessibilityLabel={row.title}
                    accessibilityHint={row.detail}
                    onPress={() => onOpen(row.to)}
                    style={({ pressed }) => [s.row, pressed && s.pressed]}
                  >
                    <Icon name={row.icon} size={18} color={colors.muted} />
                    <View style={s.text}>
                      <Text style={s.title}>{row.title}</Text>
                      <Text style={s.detail}>{row.detail}</Text>
                    </View>
                    <Icon name="chevronRight" size={16} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            </View>
          </FadeIn>
        );
      })}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    rows: { marginTop: 6 },
    // A row is a destination, so it is a target a thumb can find.
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingVertical: 8,
    },
    pressed: { opacity: 0.6 },
    text: { flex: 1, gap: 2 },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    detail: { color: colors.muted, fontSize: 12 },
  }),
);

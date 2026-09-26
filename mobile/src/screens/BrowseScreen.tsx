import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  hasSystemPermission,
  VIEW_SOURCE_LABELS,
  type SavedView,
  type User,
} from "@orbyn/core";
import { Icon, type IconName } from "../components/Icon";
import { FadeIn } from "../motion";
import { shared } from "../styles";
import { colors, fonts, themed } from "../theme";

/** Every destination the tab bar has no room for. */
export type Destination =
  | "search"
  | "planning"
  | "agenda"
  | "projects"
  | "docs"
  | "views"
  | "study"
  | "lists"
  | "progress"
  | "teams"
  | "booking"
  | "admin"
  | "changes"
  | "whatsnew"
  | "settings";

type Row = {
  to: Destination;
  icon: IconName;
  title: string;
  detail: string;
  adminOnly?: boolean;
};

/**
 * The main workspaces lead on a phone; planning and settings follow below.
 */
const GROUPS: { label: string; rows: Row[] }[] = [
  {
    label: "YOUR WORK",
    rows: [
      {
        to: "search",
        icon: "search",
        title: "Search & do",
        detail: "Pages, tasks and projects, and anything Orbyn can do",
      },
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
        to: "views",
        icon: "table",
        title: "Views",
        detail: "Saved filters as lists, tables, boards and calendars",
      },
      {
        to: "study",
        icon: "graduationCap",
        title: "Study",
        detail: "Flashcards from your pages, planned around exams",
      },
      {
        to: "lists",
        icon: "list",
        title: "Lists",
        detail: "Somewhere for each kind of task",
      },
      {
        to: "progress",
        icon: "check",
        title: "Done this week",
        detail: "What got finished, with the proof",
      },
    ],
  },
  {
    label: "PLAN YOUR DAY",
    rows: [
      {
        to: "planning",
        icon: "calendar",
        title: "Planning",
        detail: "Working hours, focus time and routines",
      },
      {
        to: "agenda",
        icon: "sun",
        title: "Agenda",
        detail: "Written for you each morning",
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
        to: "changes",
        icon: "activity",
        title: "Recent changes",
        detail: "Who changed which team page or task",
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
      {
        to: "whatsnew",
        icon: "sparkles",
        title: "What's new",
        detail: "What changed in Orbyn lately",
      },
    ],
  },
];

export function BrowseScreen({
  user,
  onOpen,
  pinnedViews = [],
  onOpenView,
}: {
  user: User | null;
  onOpen: (to: Destination) => void;
  /** Saved views pinned here, first of all. */
  pinnedViews?: SavedView[];
  onOpenView?: (id: string) => void;
}) {
  const admin = hasSystemPermission(user?.role, "admin:access");
  return (
    <>
      {pinnedViews.length > 0 && onOpenView && (
        <FadeIn>
          <View style={shared.card}>
            <Text style={shared.eyebrow}>PINNED VIEWS</Text>
            <View style={s.rows}>
              {pinnedViews.map((v, index) => (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityLabel={v.name}
                  onPress={() => onOpenView(v.id)}
                  style={({ pressed }) => [
                    s.row,
                    index > 0 && s.rowDivider,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={s.iconTile}>
                    <Icon name="table" size={19} color={colors.accent} />
                  </View>
                  <View style={s.text}>
                    <Text style={s.title}>{v.name}</Text>
                    <Text style={s.detail}>
                      {VIEW_SOURCE_LABELS[v.source]}
                      {v.team_name ? ` · ${v.team_name}` : ""}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.faint} />
                </Pressable>
              ))}
            </View>
          </View>
        </FadeIn>
      )}
      {GROUPS.map((group, n) => {
        const rows = group.rows.filter((r) => !r.adminOnly || admin);
        if (!rows.length) return null;
        return (
          <FadeIn key={group.label} delay={n * 40}>
            <View style={shared.card}>
              <Text style={shared.eyebrow}>{group.label}</Text>
              <View style={s.rows}>
                {rows.map((row, index) => (
                  <Pressable
                    key={row.to}
                    accessibilityRole="button"
                    accessibilityLabel={row.title}
                    accessibilityHint={row.detail}
                    onPress={() => onOpen(row.to)}
                    style={({ pressed }) => [
                      s.row,
                      index > 0 && s.rowDivider,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={s.iconTile}>
                      <Icon name={row.icon} size={19} color={colors.accent} />
                    </View>
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
    rows: { marginTop: 4 },
    // A row is a destination, so it is a target a thumb can find.
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 66,
      paddingVertical: 10,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    iconTile: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
    },
    pressed: { opacity: 0.6 },
    text: { flex: 1, gap: 2 },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    detail: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);

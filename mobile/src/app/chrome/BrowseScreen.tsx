import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  arrangeEntries,
  hasSystemPermission,
  VIEW_SOURCE_LABELS,
  type SavedView,
  type SidebarArrangement,
  type StarredItem,
  type User,
} from "@orbyn/core";
import { InlineDetails } from "../../components/InlineDetails";
import { CONCEPT_ICON, Icon, type IconName } from "../../components/Icon";
import { Pressable } from "../../motion";
import { shared } from "../../styles";
import { colors, fonts, themed } from "../../theme";

/** Every destination the tab bar has no room for. */
export type Destination =
  | "search"
  | "planning"
  | "agenda"
  | "projects"
  | "docs"
  | "memory"
  | "agent"
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
export const GROUPS: { label: string; rows: Row[] }[] = [
  {
    label: "YOUR WORK",
    rows: [
      {
        to: "search",
        icon: "search",
        title: "Search & do",
        detail: "Find pages, tasks and projects",
      },
      {
        to: "projects",
        icon: CONCEPT_ICON.project,
        title: "Projects",
        detail: "Work grouped into stages",
      },
      {
        to: "docs",
        icon: CONCEPT_ICON.page,
        title: "Docs",
        detail: "Your pages",
      },
      {
        to: "memory",
        icon: "sparkles",
        title: "Memory",
        detail: "Saved memory and sources",
      },
      {
        to: "agent",
        icon: "fileText",
        title: "Agent notes",
        detail: "Notes from your assistant",
      },
      {
        to: "views",
        icon: "table",
        title: "Views",
        detail: "Saved lists, boards and calendars",
      },
      {
        to: "study",
        icon: CONCEPT_ICON.study,
        title: "Study",
        detail: "Flashcards and study plans",
      },
      {
        to: "lists",
        icon: "listChecks",
        title: "Lists",
        detail: "Your task lists",
      },
      {
        to: "progress",
        icon: "check",
        title: "Done this week",
        detail: "Completed work",
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
        icon: CONCEPT_ICON.agenda,
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
        detail: "Your teams",
      },
      {
        to: "changes",
        icon: "activity",
        title: "Recent changes",
        detail: "Team page and task activity",
      },
      {
        to: "booking",
        icon: "calendarCheck",
        title: "Booking",
        detail: "Shared availability",
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
        detail: "Account and preferences",
      },
      {
        to: "whatsnew",
        icon: "sparkles",
        title: "What's new",
        detail: "Recent updates",
      },
    ],
  },
];

/** Stored arrangement keys remain the original titles across display renames. */
export const destinationLabel = (title: string) =>
  title === "Docs" ? "Library" : title === "Agenda" ? "Daily brief" : title;

const defaultGroups = [
  { label: "WORK", destinations: ["projects", "views", "lists"] },
  { label: "LIBRARY", destinations: ["docs", "agenda", "memory", "agent"] },
  { label: "STUDY", destinations: ["study"] },
] as const;
const utilityDestinations: Destination[] = [
  "planning",
  "progress",
  "teams",
  "changes",
  "booking",
  "admin",
  "whatsnew",
];
const allRows = GROUPS.flatMap((group) => group.rows);

/** Rows that always show, however Workspace is arranged. */
export const ALWAYS_ROWS = ["Search & do", "Settings"];

const STAR_ICONS: Record<StarredItem["kind"], IconName> = {
  doc: CONCEPT_ICON.page,
  heading: "hash",
  task: CONCEPT_ICON.task,
  project: CONCEPT_ICON.project,
  view: "table",
};

export function BrowseScreen({
  user,
  onOpen,
  pinnedViews = [],
  onOpenView,
  starred = [],
  onOpenStarred,
  arrangement,
}: {
  user: User | null;
  onOpen: (to: Destination) => void;
  /** Saved views pinned here, first of all. */
  pinnedViews?: SavedView[];
  onOpenView?: (id: string) => void;
  /** What's starred (NAV-07), and opening one of them. */
  starred?: StarredItem[];
  onOpenStarred?: (item: StarredItem) => void;
  /** The one Arrange list (NAV-08), shared with the web's sidebar. */
  arrangement?: SidebarArrangement;
}) {
  const [allStarred, setAllStarred] = useState(false);
  const [allViews, setAllViews] = useState(false);
  const admin = hasSystemPermission(user?.role, "admin:access");
  const customized =
    !!arrangement &&
    (arrangement.order.length > 0 || arrangement.hidden.length > 0);
  const navigationGroups = customized
    ? GROUPS
    : defaultGroups.map((group) => ({
        label: group.label,
        rows: group.destinations.flatMap((to) =>
          allRows.filter((row) => row.to === to),
        ),
      }));
  const renderRows = (rows: Row[]) => (
    <View style={s.rows}>
      {rows.map((row, index) => (
        <Pressable
          key={row.to}
          accessibilityRole="button"
          accessibilityLabel={destinationLabel(row.title)}
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
            <Text style={s.title}>{destinationLabel(row.title)}</Text>
          </View>
          <Icon name="chevronRight" size={16} color={colors.faint} />
        </Pressable>
      ))}
    </View>
  );
  const hidden = (title: string) =>
    !ALWAYS_ROWS.includes(title) && !!arrangement?.hidden.includes(title);
  return (
    <>
      {starred.length > 0 && onOpenStarred && !hidden("Starred") && (
        <View>
          <View style={s.group}>
            <Text style={shared.eyebrow}>STARRED</Text>
            <View style={s.rows}>
              {(allStarred ? starred : starred.slice(0, 8)).map(
                (item, index) => (
                  <Pressable
                    key={`${item.kind}:${item.id}:${item.block_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    accessibilityHint={item.hint ?? undefined}
                    onPress={() => onOpenStarred(item)}
                    style={({ pressed }) => [
                      s.row,
                      index > 0 && s.rowDivider,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={s.iconTile}>
                      <Icon
                        name={STAR_ICONS[item.kind]}
                        size={19}
                        color={colors.accent}
                      />
                    </View>
                    <View style={s.text}>
                      <Text style={[s.title, item.closed && s.closed]}>
                        {item.title}
                      </Text>
                      {item.hint ? (
                        <Text style={s.detail}>{item.hint}</Text>
                      ) : null}
                    </View>
                    <Icon name="chevronRight" size={16} color={colors.faint} />
                  </Pressable>
                ),
              )}
            </View>
            {starred.length > 8 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: allStarred }}
                onPress={() => setAllStarred((v) => !v)}
                style={s.more}
              >
                <Text style={s.moreText}>
                  {allStarred
                    ? "Show fewer"
                    : `Show all starred (${starred.length})`}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {pinnedViews.length > 0 && onOpenView && (
        <View>
          <View style={s.group}>
            <Text style={shared.eyebrow}>PINNED VIEWS</Text>
            <View style={s.rows}>
              {(allViews ? pinnedViews : pinnedViews.slice(0, 8)).map(
                (v, index) => (
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
                ),
              )}
            </View>
            {pinnedViews.length > 8 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: allViews }}
                onPress={() => setAllViews((v) => !v)}
                style={s.more}
              >
                <Text style={s.moreText}>
                  {allViews
                    ? "Show fewer"
                    : `Show all pinned views (${pinnedViews.length})`}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {!customized && renderRows(allRows.filter((row) => row.to === "search"))}
      {navigationGroups.map((group) => {
        const rows = arrangeEntries(
          group.rows.filter((r) => !r.adminOnly || admin),
          (r) => r.title,
          arrangement,
        ).filter((r) => !hidden(r.title));
        if (!rows.length) return null;
        return (
          <View key={group.label}>
            <View style={s.group}>
              <Text style={shared.eyebrow}>{group.label}</Text>
              {renderRows(rows)}
            </View>
          </View>
        );
      })}
      {!customized && (
        <>
          <InlineDetails title="More tools">
            {renderRows(
              allRows.filter(
                (row) =>
                  utilityDestinations.includes(row.to) &&
                  (!row.adminOnly || admin),
              ),
            )}
          </InlineDetails>
          {renderRows(allRows.filter((row) => row.to === "settings"))}
        </>
      )}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    group: { marginBottom: 16 },
    more: { minHeight: 44, justifyContent: "center", paddingVertical: 8 },
    moreText: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
    rows: { marginTop: 4 },
    // A row is a destination, so it is a target a thumb can find.
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingVertical: 8,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    iconTile: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    detail: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    closed: { color: colors.muted, textDecorationLine: "line-through" },
  }),
);

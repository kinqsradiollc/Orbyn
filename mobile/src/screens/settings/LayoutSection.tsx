import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  moveEntry,
  START_SCREEN_LABELS,
  START_SCREENS,
  toggleSidebarHidden,
  arrangeEntries,
  type SidebarArrangement,
  type StartScreen,
} from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { Switch } from "../../components/Switch";
import { SmallAction } from "../../components/SmallAction";
import { setStartScreen, startScreen } from "../../lib/accountPrefs";
import { ALWAYS_ROWS, GROUPS } from "../BrowseScreen";
import { colors, fonts, radii, themed } from "../../theme";

/** What opens at start on this phone (NAV-12). */
export function StartChoice() {
  const [start, setStart] = useState<StartScreen>(startScreen);
  return (
    <View style={s.body}>
      <Text style={s.hint}>
        What Orbyn shows when it opens. Saved on this phone only.
      </Text>
      <ChipRow label="Open to">
        {START_SCREENS.map((id) => (
          <Chip
            key={id}
            compact
            label={START_SCREEN_LABELS[id]}
            selected={start === id}
            onPress={() => {
              setStart(id);
              setStartScreen(id);
            }}
          />
        ))}
      </ChipRow>
    </View>
  );
}

/**
 * Arrange (NAV-08): the one list of what Workspace (and the web's sidebar)
 * shows, and in what order. It follows the account.
 */
export function ArrangeList({
  arrangement,
  onChange,
  isAdmin,
}: {
  arrangement: SidebarArrangement;
  onChange: (next: SidebarArrangement) => void;
  isAdmin: boolean;
}) {
  const groups = GROUPS.map((g) => ({
    label: g.label,
    titles: arrangeEntries(
      g.rows.filter((r) => !r.adminOnly || isAdmin),
      (r) => r.title,
      arrangement,
      true,
    ).map((r) => r.title),
  }));
  const reorder = (group: string, titles: string[]) =>
    onChange({
      ...arrangement,
      order: groups.flatMap((g) => (g.label === group ? titles : g.titles)),
    });
  const row = (group: string, titles: string[], title: string, i: number) => {
    const fixed = ALWAYS_ROWS.includes(title);
    const shown = fixed || !arrangement.hidden.includes(title);
    return (
      <View key={title} style={s.row}>
        <Text style={[s.name, !shown && s.off]} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move ${title} up`}
          disabled={i === 0}
          hitSlop={8}
          onPress={() => reorder(group, moveEntry(titles, title, -1))}
          style={[s.arrow, i === 0 && s.dim]}
        >
          <Icon name="arrowUp" size={16} color={colors.textSoft} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move ${title} down`}
          disabled={i === titles.length - 1}
          hitSlop={8}
          onPress={() => reorder(group, moveEntry(titles, title, 1))}
          style={[s.arrow, i === titles.length - 1 && s.dim]}
        >
          <Icon name="arrowDown" size={16} color={colors.textSoft} />
        </Pressable>
        <Switch
          value={shown}
          disabled={fixed}
          trackColor={{ true: colors.accent }}
          accessibilityLabel={`Show ${title}`}
          onValueChange={() =>
            onChange(toggleSidebarHidden(arrangement, title))
          }
        />
      </View>
    );
  };
  return (
    <View style={s.body}>
      <Text style={s.hint}>
        Show, hide and reorder what Workspace lists. The same list arranges the
        sidebar on the web.
      </Text>
      {groups.map((g) => (
        <View key={g.label} style={s.group}>
          <Text style={s.label}>{g.label}</Text>
          {g.titles.map((t, i) => row(g.label, g.titles, t, i))}
        </View>
      ))}
      <View style={s.group}>
        <Text style={s.label}>MORE</Text>
        <View style={s.row}>
          <Text style={s.name}>Starred</Text>
          <Switch
            value={!arrangement.hidden.includes("Starred")}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Show Starred"
            onValueChange={() =>
              onChange(toggleSidebarHidden(arrangement, "Starred"))
            }
          />
        </View>
      </View>
      {(arrangement.order.length > 0 || arrangement.hidden.length > 0) && (
        <SmallAction
          label="Back to how it came"
          disabled={false}
          onPress={() => onChange({ order: [], hidden: [] })}
        />
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 12 },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    group: { gap: 4 },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.6,
      color: colors.muted,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    name: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    off: { color: colors.muted },
    arrow: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    dim: { opacity: 0.35 },
  }),
);

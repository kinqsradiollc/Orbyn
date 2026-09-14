import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { groupItems, type Item } from "@orbyn/core";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { ItemCard } from "./ItemCard";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

export type ListHandlers = {
  busy: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
  onAdd: () => void;
  /** False for items whose checkbox should be disabled (team items you only view). */
  canToggle?: (item: Item) => boolean;
};

/** Stats, section header, item rows and the empty state shared by Today / Tasks / Calendar. */
export function PlannerList({
  items,
  visible,
  listed = visible,
  title,
  showStats = true,
  empty = {
    title: "A little breathing room.",
    body: "Your day is open. Add something worth making time for.",
  },
  busy,
  onToggle,
  onEdit,
  onAdd,
  canToggle,
  children,
}: ListHandlers & {
  /** Every item, for the stats. */
  items: Item[];
  /** Items matching the tab's filter; decides whether the empty state shows. */
  visible: Item[];
  /** Items actually rendered (defaults to `visible`). */
  listed?: Item[];
  title: string;
  showStats?: boolean;
  empty?: { title: string; body: string };
  /** Rendered between the stats and the section title (the Tasks search box). */
  children?: React.ReactNode;
}) {
  const groups = groupItems(items);
  const stats = [
    { value: groups.today.length, label: "Due today" },
    { value: groups.done.length, label: "Completed" },
    { value: groups.overdue.length, label: "Overdue" },
  ];
  return (
    <>
      {showStats && (
        <View style={s.stats}>
          {stats.map((stat, n) => (
            <View key={stat.label} style={[s.stat, n > 0 && s.statDivider]}>
              <Text style={s.statValue}>{stat.value}</Text>
              <Text style={shared.small}>{stat.label}</Text>
            </View>
          ))}
        </View>
      )}
      {children}
      <View style={s.heading}>
        <Text style={shared.sectionTitle}>{title}</Text>
        <View style={s.count}>
          <Text style={s.countText}>{listed.length}</Text>
        </View>
      </View>
      {listed.length > 0 && (
        <View style={s.list}>
          {listed.map((i, n) => (
            <ItemCard
              key={i.id}
              item={i}
              busy={busy}
              first={n === 0}
              readOnly={canToggle ? !canToggle(i) : false}
              onToggle={onToggle}
              onEdit={onEdit}
            />
          ))}
        </View>
      )}
      {!listed.length && (
        <View style={[shared.card, shared.empty]}>
          <View style={shared.emptyIcon}>
            <Icon name="sun" size={26} color={colors.accent} />
          </View>
          <Text style={shared.sectionTitle}>{empty.title}</Text>
          <Text style={[shared.subtitle, s.emptyText]}>{empty.body}</Text>
          <Button secondary icon="plus" title="Make a plan" onPress={onAdd} />
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  stats: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: 16,
    marginBottom: 22,
  },
  stat: { flex: 1, paddingHorizontal: 16 },
  statDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.text,
    marginBottom: 2,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  count: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
  list: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden",
    marginBottom: 20,
  },
  emptyText: { textAlign: "center", marginBottom: 16 },
});

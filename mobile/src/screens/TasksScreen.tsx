import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  byDueDate,
  searchItems,
  emptyPlans,
  emptySearch,
  statusLabels,
  statusOrder,
  statusTones,
  type Item,
  type Status,
} from "@orbyn/core";
import { Icon } from "../components/Icon";
import { PlannerList, type ListHandlers } from "../components/PlannerList";
import { animateLayout, PressableScale } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

/** Case-insensitive match against the item's title and notes together. */
export const matchesSearch = (item: Item, search: string) =>
  (item.title + " " + item.notes).toLowerCase().includes(search.toLowerCase());

type Filter = "all" | Status;
const FILTERS: Filter[] = ["all", ...statusOrder];
const filterLabel = (f: Filter) => (f === "all" ? "All" : statusLabels[f]);

export function TasksScreen({
  items,
  search,
  onSearch,
  ...handlers
}: ListHandlers & {
  items: Item[];
  search: string;
  onSearch: (search: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const found = searchItems(items, search);
  const count = (f: Filter) =>
    f === "all" ? found.length : found.filter((i) => i.status === f).length;
  const visible = found
    .filter((i) => filter === "all" || i.status === filter)
    .sort(byDueDate);
  const empty = search.trim()
    ? emptySearch
    : filter === "all"
      ? emptyPlans
      : {
          title: `Nothing ${statusLabels[filter].toLowerCase()}.`,
          body: "Tasks with this status will show up here.",
        };
  return (
    <PlannerList
      visible={visible}
      title={filter === "all" ? "All items" : statusLabels[filter]}
      empty={empty}
      {...handlers}
    >
      <View style={s.search}>
        <View style={s.icon} pointerEvents="none">
          <Icon name="search" size={17} color={colors.muted} />
        </View>
        <TextInput
          style={[shared.input, s.input]}
          placeholder="Find something…"
          placeholderTextColor={colors.faint}
          value={search}
          onChangeText={onSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search your plans"
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScroll}
        contentContainerStyle={s.chips}
        accessibilityRole="tablist"
        accessibilityLabel="Filter by status"
      >
        {FILTERS.map((f) => {
          const active = f === filter;
          const tone = f === "all" ? null : statusTones[f];
          const n = count(f);
          return (
            <PressableScale
              key={f}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${filterLabel(f)}, ${n} item${n === 1 ? "" : "s"}`}
              onPress={() => {
                animateLayout();
                setFilter(f);
              }}
              style={[
                s.chip,
                active && {
                  backgroundColor: tone?.bg ?? colors.accent,
                  borderColor: tone?.fg ?? colors.accent,
                },
              ]}
            >
              {tone && <View style={[s.dot, { backgroundColor: tone.fg }]} />}
              <Text
                style={[
                  s.chipText,
                  active && { color: tone?.fg ?? colors.white },
                ]}
              >
                {filterLabel(f)}
              </Text>
              <Text
                style={[
                  s.chipCount,
                  active && { color: tone?.fg ?? colors.white },
                ]}
              >
                {n}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </PlannerList>
  );
}

const s = StyleSheet.create({
  search: { marginBottom: 12, justifyContent: "center" },
  icon: { position: "absolute", left: 15, zIndex: 1 },
  input: { paddingLeft: 42 },
  chipScroll: { marginHorizontal: -20, marginBottom: 20 },
  chips: { gap: 8, paddingHorizontal: 20 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textSoft,
  },
  chipCount: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
});

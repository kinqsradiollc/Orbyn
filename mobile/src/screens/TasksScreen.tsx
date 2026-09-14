import React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import {
  byDueDate,
  searchItems,
  emptyPlans,
  emptySearch,
  type Item,
} from "@orbyn/core";
import { Icon } from "../components/Icon";
import { PlannerList, type ListHandlers } from "../components/PlannerList";
import { colors } from "../theme";
import { shared } from "../styles";

/** Case-insensitive match against the item's title and notes together. */
export const matchesSearch = (item: Item, search: string) =>
  (item.title + " " + item.notes).toLowerCase().includes(search.toLowerCase());

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
  const visible = searchItems(items, search).slice().sort(byDueDate);
  return (
    <PlannerList
      items={items}
      visible={visible}
      title="All items"
      showStats={false}
      empty={search.trim() ? emptySearch : emptyPlans}
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
    </PlannerList>
  );
}

const s = StyleSheet.create({
  search: { marginBottom: 22, justifyContent: "center" },
  icon: { position: "absolute", left: 15, zIndex: 1 },
  input: { paddingLeft: 42 },
});

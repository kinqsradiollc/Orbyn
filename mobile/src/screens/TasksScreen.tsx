import React from "react";
import { TextInput } from "react-native";
import { byDueDate, type Item } from "@orbyn/core";
import { PlannerList, type ListHandlers } from "../components/PlannerList";
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
  const visible = items.filter((i) => matchesSearch(i, search)).sort(byDueDate);
  return (
    <PlannerList
      items={items}
      visible={visible}
      title="All your plans"
      {...handlers}
    >
      <TextInput
        style={shared.input}
        placeholder="Find something…"
        value={search}
        onChangeText={onSearch}
      />
    </PlannerList>
  );
}

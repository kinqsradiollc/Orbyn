import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Item } from "@orbyn/core";
import { Button } from "./Button";
import { ItemCard } from "./ItemCard";
import { colors } from "../theme";
import { shared } from "../styles";

export type ListHandlers = {
  busy: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
  onAdd: () => void;
};

/** Stats card, section title, item rows and the empty state shared by Today / Tasks / Calendar. */
export function PlannerList({
  items,
  visible,
  listed = visible,
  title,
  busy,
  onToggle,
  onEdit,
  onAdd,
  children,
}: ListHandlers & {
  /** Every item, for the stats. */
  items: Item[];
  /** Items matching the tab's filter; decides whether the empty state shows. */
  visible: Item[];
  /** Items actually rendered (defaults to `visible`). */
  listed?: Item[];
  title: string;
  /** Rendered between the stats and the section title (the Tasks search box). */
  children?: React.ReactNode;
}) {
  return (
    <>
      <View style={s.stats}>
        <View>
          <Text style={s.statValue}>
            {items.filter((i) => i.status === "todo").length}
          </Text>
          <Text style={shared.small}>In your orbit</Text>
        </View>
        <View>
          <Text style={s.statValue}>
            {items.filter((i) => i.status === "done").length}
          </Text>
          <Text style={shared.small}>Completed</Text>
        </View>
      </View>
      {children}
      <Text style={shared.sectionTitle}>{title}</Text>
      {listed.map((i) => (
        <ItemCard
          key={i.id}
          item={i}
          busy={busy}
          onToggle={onToggle}
          onEdit={onEdit}
        />
      ))}
      {!visible.length && (
        <View style={shared.empty}>
          <Text style={s.emptyIcon}>☼</Text>
          <Text style={shared.sectionTitle}>A little breathing room.</Text>
          <Text style={shared.subtitle}>
            Add something worth making time for.
          </Text>
          <Button secondary title="Make a plan" onPress={onAdd} />
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#e6ebdf",
    borderRadius: 12,
    padding: 23,
    marginBottom: 27,
  },
  statValue: {
    fontSize: 30,
    fontWeight: "500",
    color: "#486147",
    marginBottom: 6,
  },
  emptyIcon: { fontSize: 40, color: "#a9bb93", marginBottom: 20 },
});

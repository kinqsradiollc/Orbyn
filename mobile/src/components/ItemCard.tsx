import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dateLabel, type Item } from "@orbyn/core";
import { colors } from "../theme";
import { shared } from "../styles";

export function ItemCard({
  item,
  busy,
  onToggle,
  onEdit,
}: {
  item: Item;
  busy: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
}) {
  const done = item.status === "done";
  return (
    <View style={s.item}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={"Complete " + item.title}
        disabled={busy}
        onPress={() => onToggle(item)}
      >
        <Text style={[s.checkbox, done && { color: colors.accent }]}>
          {done ? "☑" : "□"}
        </Text>
      </Pressable>
      <Pressable style={{ flex: 1 }} onPress={() => onEdit(item)}>
        <Text
          style={[
            shared.itemTitle,
            done && {
              textDecorationLine: "line-through",
              color: colors.muted,
            },
          ]}
        >
          {item.title}
        </Text>
        <Text style={shared.small}>
          {dateLabel(item.due_at)} · {item.kind} · {item.priority}
        </Text>
      </Pressable>
      <Text style={s.arrow}>↗</Text>
    </View>
  );
}

const s = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 17,
    borderWidth: 1,
    borderColor: "#e8edde",
    backgroundColor: colors.white,
    borderRadius: 9,
    marginBottom: 10,
  },
  checkbox: { fontSize: 26, color: "#becab4" },
  arrow: { fontSize: 20, color: "#9dac90" },
});

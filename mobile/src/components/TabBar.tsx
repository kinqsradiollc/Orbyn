import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TABS, type Tab } from "../app/tabs";
import { colors } from "../theme";

export function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <View style={s.tabs}>
      {TABS.map(({ name, icon }) => (
        <Pressable
          key={name}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === name }}
          onPress={() => onChange(name)}
          style={s.tab}
        >
          <Text style={[s.tabIcon, tab === name && s.selected]}>{icon}</Text>
          <Text style={[s.tabText, tab === name && s.selected]}>{name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: "#e2e8d8",
    backgroundColor: colors.white,
  },
  tab: { flex: 1, alignItems: "center", gap: 5 },
  tabIcon: { fontSize: 23, color: "#a9b39f" },
  tabText: { fontSize: 9, color: "#9da793" },
  selected: { color: "#426b43" },
});

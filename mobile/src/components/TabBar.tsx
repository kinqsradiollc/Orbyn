import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TABS, type Tab } from "../app/tabs";
import { Icon } from "./Icon";
import { colors, fonts, spacing } from "../theme";

/** Bottom navigation. Extends under the home indicator and pads for it. */
export function TabBar({
  tab,
  unread,
  onChange,
}: {
  tab: Tab;
  unread: boolean;
  onChange: (tab: Tab) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        s.bar,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={s.row}>
        {TABS.map(({ name, label, icon }) => {
          const active = tab === name;
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              onPress={() => onChange(name)}
              style={s.tab}
            >
              <View style={[s.iconWrap, active && s.iconActive]}>
                <Icon
                  name={icon}
                  size={20}
                  color={active ? colors.accent : colors.faint}
                  strokeWidth={active ? 2 : 1.8}
                />
                {name === "Inbox" && unread && <View style={s.dot} />}
              </View>
              <Text
                numberOfLines={1}
                style={[s.label, active && s.labelActive]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  row: {
    flexDirection: "row",
    width: "100%",
    maxWidth: spacing.maxContent,
    alignSelf: "center",
  },
  tab: { flex: 1, alignItems: "center", gap: 3 },
  iconWrap: {
    width: 48,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: { backgroundColor: colors.accentSoft },
  dot: {
    position: "absolute",
    top: 5,
    right: 13,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.highText,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  label: { fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  labelActive: { fontFamily: fonts.semibold, color: colors.accent },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TABS, type Tab } from "../tabs";
import { Icon, type IconName } from "../../components/Icon";
import { Pressable } from "../../motion";
import { colors, fonts, radii, spacing, themed } from "../../theme";

/** Bottom navigation. Extends under the home indicator and pads for it. */
export function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
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
        {TABS.map(({ name, label, icon }) => (
          <TabButton
            key={name}
            label={label}
            icon={icon}
            active={tab === name}
            onPress={() => onChange(name)}
          />
        ))}
      </View>
    </View>
  );
}

/** Stable navigation with visible selection and full scaling labels. */
function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.tab, active && s.tabActive]}
    >
      <View style={s.iconWrap}>
        {active && <View style={s.pill} />}
        <Icon
          name={icon}
          size={20}
          color={active ? colors.accent : colors.faint}
          strokeWidth={active ? 2 : 1.8}
        />
      </View>
      <Text style={[s.label, active && s.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
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
    tab: {
      flex: 1,
      minHeight: 58,
      minWidth: 0,
      paddingHorizontal: 2,
      paddingVertical: 4,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      marginHorizontal: 2,
      borderRadius: radii.input,
    },
    tabActive: { backgroundColor: colors.accentSoft },
    iconWrap: {
      width: 52,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    pill: {
      position: "absolute",
      top: -3,
      left: 18,
      right: 18,
      height: 3,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    label: {
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.muted,
      textAlign: "center",
      flexShrink: 1,
    },
    labelActive: { fontFamily: fonts.semibold, color: colors.accent },
  }),
);

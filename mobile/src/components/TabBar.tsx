import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { motion } from "@orbyn/core";
import { TABS, type Tab } from "../app/tabs";
import { Icon, type IconName } from "./Icon";
import { easeOut, pop, usePressScale, useReducedMotion } from "../motion";
import { colors, fonts, spacing, themed } from "../theme";

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

/**
 * One tab. When it becomes active its pill fades and scales in and the icon
 * bounces (1 → 1.12 → 1); it shrinks slightly while pressed.
 */
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
  const reduced = useReducedMotion();
  const press = usePressScale();
  const on = useRef(new Animated.Value(active ? 1 : 0)).current;
  const bounce = useRef(new Animated.Value(1)).current;
  const wasActive = useRef(active);

  useEffect(() => {
    if (wasActive.current === active) return;
    wasActive.current = active;
    if (reduced) {
      on.setValue(active ? 1 : 0);
      return;
    }
    Animated.timing(on, {
      toValue: active ? 1 : 0,
      duration: motion.base,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
    if (active) pop(bounce).start();
  }, [active, reduced, on, bounce]);

  const pillScale = on.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[s.tab, active && s.tabActive]}
    >
      <Animated.View style={[s.iconWrap, press.style]}>
        <Animated.View
          style={[s.pill, { opacity: on, transform: [{ scale: pillScale }] }]}
        />
        <Animated.View style={{ transform: [{ scale: bounce }] }}>
          <Icon
            name={icon}
            size={20}
            color={active ? colors.accent : colors.faint}
            strokeWidth={active ? 2 : 1.8}
          />
        </Animated.View>
      </Animated.View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[s.label, active && s.labelActive]}
      >
        {label}
      </Text>
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
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      marginHorizontal: 2,
      borderRadius: 15,
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
      borderRadius: 2,
      backgroundColor: colors.accent,
    },
    label: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
    labelActive: { fontFamily: fonts.semibold, color: colors.accent },
  }),
);

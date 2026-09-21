import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { motion } from "@orbyn/core";
import { TABS, type Tab } from "../app/tabs";
import { Icon, type IconName } from "./Icon";
import {
  easeOut,
  isReducedMotion,
  pop,
  usePressScale,
  useReducedMotion,
} from "../motion";
import { colors, fonts, spacing, themed } from "../theme";

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
        {TABS.map(({ name, label, icon }) => (
          <TabButton
            key={name}
            label={label}
            icon={icon}
            active={tab === name}
            unread={name === "Inbox" && unread}
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
  unread,
  onPress,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  unread: boolean;
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
      style={s.tab}
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
        {unread && <UnreadDot />}
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

/** Inbox badge; pops in (0 → 1.12 → 1) when unread reminders arrive. */
function UnreadDot() {
  const scale = useRef(new Animated.Value(isReducedMotion() ? 1 : 0)).current;
  useEffect(() => {
    if (!isReducedMotion()) pop(scale).start();
  }, [scale]);
  return <Animated.View style={[s.dot, { transform: [{ scale }] }]} />;
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
    tab: { flex: 1, minHeight: 44, alignItems: "center", gap: 3 },
    iconWrap: {
      width: 48,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    pill: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 15,
      backgroundColor: colors.accentSoft,
    },
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
  }),
);

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { motion } from "@orbyn/core";
import { Icon } from "./Icon";
import { easeOut, isReducedMotion, pop } from "../motion";
import { colors, fonts, radii, themed } from "../theme";

/** Mounted hosts, newest last. Only the newest shows, so one in a sheet wins. */
const hosts: ((title: string) => void)[] = [];

/**
 * Celebrate a finished task: a short card whose check pops out of a burst of
 * dots, and a tiny tap on Android. Under reduced motion the card just
 * appears, with no burst or vibration.
 */
export function celebrate(title: string) {
  hosts[hosts.length - 1]?.(title);
}

const VISIBLE_MS = 1700;
const VISIBLE_REDUCED_MS = 2400;
const SPARKS = 8;
const SPARK_DISTANCE = 26;

/**
 * Where celebrations show: one in the app and one in each sheet that can
 * finish a task. `bottom` keeps the card clear of the tab bar.
 */
export function CelebrationHost({ bottom = 24 }: { bottom?: number }) {
  const [shown, setShown] = useState<{ title: string; id: number } | null>(
    null,
  );
  useEffect(() => {
    const show = (title: string) => setShown({ title, id: Date.now() });
    hosts.push(show);
    return () => {
      const n = hosts.indexOf(show);
      if (n >= 0) hosts.splice(n, 1);
    };
  }, []);
  useEffect(() => {
    if (!shown) return;
    const reduced = isReducedMotion();
    AccessibilityInfo.announceForAccessibility(
      `Nicely done. ${shown.title} is done.`,
    );
    if (!reduced && Platform.OS === "android") Vibration.vibrate(12);
    const timer = setTimeout(
      () => setShown(null),
      reduced ? VISIBLE_REDUCED_MS : VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={[s.layer, { bottom }]}>
      <Card key={shown.id} title={shown.title} />
    </View>
  );
}

function Card({ title }: { title: string }) {
  const reduced = isReducedMotion();
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const badge = useRef(new Animated.Value(reduced ? 1 : 0.5)).current;
  const burst = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const timing = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing: easeOut,
        useNativeDriver: true,
      });
    timing(enter, 1, motion.base).start();
    pop(badge, 1.25).start();
    timing(burst, 1, motion.slow * 1.6).start();
    const leave = setTimeout(
      () => timing(enter, 0, motion.base).start(),
      VISIBLE_MS - motion.base,
    );
    return () => clearTimeout(leave);
  }, [reduced, enter, badge, burst]);

  const rise = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [motion.distance * 2, 0],
  });
  const fade = burst.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [1, 1, 0],
  });
  const shrink = burst.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.4],
  });
  return (
    <Animated.View
      style={[s.card, { opacity: enter, transform: [{ translateY: rise }] }]}
    >
      <View style={s.badgeWrap}>
        {!reduced &&
          Array.from({ length: SPARKS }, (_, n) => {
            const angle = (n / SPARKS) * Math.PI * 2;
            const along = (distance: number) =>
              burst.interpolate({
                inputRange: [0, 1],
                outputRange: [0, distance],
              });
            return (
              <Animated.View
                key={n}
                style={[
                  s.spark,
                  {
                    backgroundColor: n % 2 ? colors.accent : colors.highText,
                    opacity: fade,
                    transform: [
                      { translateX: along(Math.cos(angle) * SPARK_DISTANCE) },
                      { translateY: along(Math.sin(angle) * SPARK_DISTANCE) },
                      { scale: shrink },
                    ],
                  },
                ]}
              />
            );
          })}
        <Animated.View style={[s.badge, { transform: [{ scale: badge }] }]}>
          <Icon name="check" size={18} color={colors.white} strokeWidth={3} />
        </Animated.View>
      </View>
      <View style={s.text}>
        <Text style={s.title}>Nicely done.</Text>
        <Text style={s.body} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Animated.View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    layer: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      maxWidth: 360,
      marginHorizontal: 20,
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.softBorder,
      borderRadius: radii.card,
      shadowColor: colors.shadow,
      shadowOpacity: 0.14,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    badgeWrap: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    spark: { position: "absolute", width: 6, height: 6, borderRadius: 3 },
    badge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    text: { flexShrink: 1 },
    title: { fontFamily: fonts.display, fontSize: 16, color: colors.text },
    body: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      marginTop: 1,
    },
  }),
);

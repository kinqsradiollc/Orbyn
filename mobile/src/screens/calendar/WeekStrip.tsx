import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  itemsOnDay,
  motion,
  sameDay,
  statusTones,
  type Item,
} from "@orbyn/core";
import { easeOut, isReducedMotion } from "../../motion";
import { colors, fonts } from "../../theme";
import { startOfWeek, weekDays } from "./dates";

const SWIPE_DISTANCE = 50;

/**
 * Seven days with plan dots colored by status. Swipe left or right for the
 * next or previous week; the selected day's pill glides between days.
 */
export function WeekStrip({
  selected,
  items,
  onSelect,
  onShiftWeek,
}: {
  selected: Date;
  items: Item[];
  onSelect: (day: Date) => void;
  /** +1 for next week, -1 for the previous one. */
  onShiftWeek: (direction: 1 | -1) => void;
}) {
  const [width, setWidth] = useState(0);
  const cell = width / 7;
  const slide = useRef(new Animated.Value(0)).current;
  const pill = useRef(new Animated.Value(0)).current;
  const days = weekDays(startOfWeek(selected));
  const index = selected.getDay();
  const weekKey = days[0].toDateString();

  // Latest values for the long-lived PanResponder.
  const latest = useRef({ width, onShiftWeek });
  latest.current = { width, onShiftWeek };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => slide.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const { width: w, onShiftWeek: shift } = latest.current;
        const swiped = Math.abs(g.dx) > SWIPE_DISTANCE || Math.abs(g.vx) > 0.5;
        if (!swiped) {
          Animated.timing(slide, {
            toValue: 0,
            duration: motion.fast,
            easing: easeOut,
            useNativeDriver: true,
          }).start();
          return;
        }
        const direction: 1 | -1 = g.dx < 0 ? 1 : -1;
        if (isReducedMotion()) {
          slide.setValue(0);
          shift(direction);
          return;
        }
        Animated.timing(slide, {
          toValue: -direction * w,
          duration: motion.fast,
          easing: easeOut,
          useNativeDriver: true,
        }).start(() => {
          shift(direction);
          slide.setValue(direction * w);
          Animated.timing(slide, {
            toValue: 0,
            duration: motion.base,
            easing: easeOut,
            useNativeDriver: true,
          }).start();
        });
      },
      onPanResponderTerminate: () => slide.setValue(0),
    }),
  ).current;

  // Glide within a week; jump when the week itself changes.
  const shownWeek = useRef(weekKey);
  useEffect(() => {
    const target = index * cell;
    if (shownWeek.current !== weekKey || isReducedMotion() || !cell) {
      pill.setValue(target);
    } else {
      Animated.timing(pill, {
        toValue: target,
        duration: motion.base,
        easing: easeOut,
        useNativeDriver: true,
      }).start();
    }
    shownWeek.current = weekKey;
  }, [index, cell, weekKey, pill]);

  const today = new Date();
  return (
    <View
      style={s.clip}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityHint="Swipe left or right to see other weeks"
      {...pan.panHandlers}
    >
      <Animated.View style={[s.row, { transform: [{ translateX: slide }] }]}>
        {cell > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              s.pill,
              { width: cell - 6, transform: [{ translateX: pill }] },
            ]}
          />
        )}
        {days.map((day) => {
          const active = sameDay(day, selected);
          const isToday = sameDay(day, today);
          const plans = itemsOnDay(items, day);
          return (
            <Pressable
              key={day.toDateString()}
              accessibilityRole="button"
              accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}, ${plans.length} plan${plans.length === 1 ? "" : "s"}`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(day)}
              style={s.day}
            >
              <Text
                style={[
                  s.weekday,
                  isToday && s.todayText,
                  active && s.activeText,
                ]}
              >
                {day.toLocaleDateString([], { weekday: "short" })}
              </Text>
              <View style={[s.dateWrap, isToday && !active && s.todayRing]}>
                <Text
                  style={[
                    s.date,
                    isToday && s.todayText,
                    active && s.activeText,
                  ]}
                >
                  {day.getDate()}
                </Text>
              </View>
              <View style={s.dots}>
                {plans.slice(0, 3).map((i) => (
                  <View
                    key={i.id}
                    style={[
                      s.dot,
                      {
                        // On the green pill a status dot could vanish; use white.
                        backgroundColor: active
                          ? colors.white
                          : statusTones[i.status].fg,
                      },
                    ]}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  clip: { overflow: "hidden" },
  row: { flexDirection: "row" },
  pill: {
    position: "absolute",
    left: 3,
    top: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: colors.accent,
  },
  day: { flex: 1, alignItems: "center", paddingVertical: 10, minHeight: 78 },
  weekday: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dateWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  todayRing: { borderColor: colors.accent },
  date: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  todayText: { color: colors.accent },
  activeText: { color: colors.white },
  dots: { height: 8, flexDirection: "row", gap: 3, marginTop: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

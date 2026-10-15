import React, { useRef, useState } from "react";
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { sameDay, type Status } from "@orbyn/core";
import { Pressable } from "../../motion";
import { colors, fonts, radii, themed, statusTones } from "../../theme";
import { startOfWeek, weekDays } from "./dates";

const SWIPE_DISTANCE = 50;

/**
 * Seven days with plan dots colored by status. Swipe left or right for the
 * next or previous week. Narrow panes scroll without squeezing touch targets.
 */
export function WeekStrip({
  selected,
  plansOn,
  onSelect,
  onShiftWeek,
}: {
  selected: Date;
  /** What's planned on a day, for the dots; `color` overrides the status colour. */
  plansOn: (day: Date) => { key: string; status: Status; color?: string }[];
  onSelect: (day: Date) => void;
  /** +1 for next week, -1 for the previous one. */
  onShiftWeek: (direction: 1 | -1) => void;
}) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const contentWidth = Math.max(
    width,
    Math.ceil(Math.max(44, 34 * fontScale) * 7),
  );
  const days = weekDays(startOfWeek(selected));
  const latest = useRef(onShiftWeek);
  latest.current = onShiftWeek;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > SWIPE_DISTANCE || Math.abs(g.vx) > 0.5)
          latest.current(g.dx < 0 ? 1 : -1);
      },
    }),
  ).current;
  const today = new Date();
  return (
    <View
      style={s.clip}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityHint="Swipe left or right to see other weeks"
      {...(contentWidth <= width ? pan.panHandlers : {})}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={contentWidth > width}
      >
        <View style={[s.row, { width: contentWidth }]}>
          {days.map((day) => {
            const active = sameDay(day, selected);
            const isToday = sameDay(day, today);
            const plans = plansOn(day);
            return (
              <Pressable
                key={day.toDateString()}
                accessibilityRole="button"
                accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}, ${plans.length} plan${plans.length === 1 ? "" : "s"}`}
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(day)}
                style={[s.day, active && s.dayActive]}
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
                      key={i.key}
                      style={[
                        s.dot,
                        {
                          // Keep the selected day aligned with its soft accent surface.
                          backgroundColor: active
                            ? colors.accent
                            : (i.color ?? statusTones[i.status].fg),
                        },
                      ]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    clip: { overflow: "hidden" },
    row: { flexDirection: "row" },
    day: {
      flex: 1,
      minWidth: 44,
      alignItems: "center",
      paddingVertical: 8,
      minHeight: 64,
    },
    dayActive: { backgroundColor: colors.accentSoft, borderRadius: radii.card },
    weekday: {
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.muted,
    },
    dateWrap: {
      minWidth: 32,
      minHeight: 32,
      paddingHorizontal: 4,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    todayRing: { borderColor: colors.accent },
    date: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    todayText: { color: colors.accent },
    activeText: { color: colors.accent },
    dots: { height: 8, flexDirection: "row", gap: 3, marginTop: 3 },
    dot: { width: 6, height: 6, borderRadius: radii.pill },
  }),
);

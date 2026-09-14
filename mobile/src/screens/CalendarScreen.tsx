import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import {
  addMonths,
  monthGrid,
  itemsOnDay,
  byDueDate,
  dayHeading,
  emptyDay,
  motion,
  sameDay,
  type Item,
} from "@orbyn/core";
import { PlannerList, type ListHandlers } from "../components/PlannerList";
import { Icon } from "../components/Icon";
import { FadeIn, PressableScale, easeOut, isReducedMotion } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

/** The same Sunday-first month grid as web, with a touch-friendly day agenda. */
export function CalendarScreen({
  items,
  ...handlers
}: ListHandlers & { items: Item[] }) {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const visible = itemsOnDay(items, selected).sort(byDueDate);
  const changeMonth = (amount: number) => {
    const next = addMonths(month, amount);
    setMonth(next);
    setSelected(next);
  };
  return (
    <>
      <View style={[shared.card, s.calendar]}>
        <View style={s.heading}>
          <Text style={[shared.sectionTitle, { marginBottom: 0, flex: 1 }]}>
            {month.toLocaleDateString([], { month: "long", year: "numeric" })}
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => changeMonth(-1)}
            style={s.control}
          >
            <Icon name="chevronLeft" size={20} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Go to today"
            onPress={() => {
              setMonth(new Date());
              setSelected(new Date());
            }}
            style={s.control}
          >
            <Text style={s.todayLabel}>Today</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Next month"
            onPress={() => changeMonth(1)}
            style={s.control}
          >
            <Icon name="chevronRight" size={20} />
          </PressableScale>
        </View>
        <View style={s.week}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <Text key={day} style={s.weekday}>
              {day}
            </Text>
          ))}
        </View>
        {monthGrid(month).map((week, n) => (
          <View key={n} style={s.week}>
            {week.map((day) => {
              const plans = itemsOnDay(items, day);
              const active = sameDay(day, selected);
              const today = sameDay(day, new Date());
              return (
                <Pressable
                  key={day.toISOString()}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}, ${plans.length} items`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setSelected(day);
                    if (day.getMonth() !== month.getMonth()) setMonth(day);
                  }}
                  style={[s.day, today && !active && s.today]}
                >
                  {active && <SelectedPill />}
                  <Text
                    style={[
                      s.dayText,
                      day.getMonth() !== month.getMonth() && {
                        color: colors.faint,
                      },
                      active && { color: colors.white },
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                  <View style={s.dots}>
                    {plans.slice(0, 3).map((i) => (
                      <View
                        key={i.id}
                        style={[
                          s.dot,
                          {
                            backgroundColor: active
                              ? colors.white
                              : i.status === "done"
                                ? colors.faint
                                : colors.accent,
                          },
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {/* Keyed by day so the agenda fades in when the selection changes. */}
      <FadeIn key={selected.toDateString()}>
        <PlannerList
          items={items}
          visible={visible}
          title={dayHeading(selected)}
          showStats={false}
          empty={emptyDay}
          {...handlers}
        />
      </FadeIn>
    </>
  );
}

/** The selected day's filled highlight; scales in when a day is chosen. */
function SelectedPill() {
  const progress = useRef(
    new Animated.Value(isReducedMotion() ? 1 : 0),
  ).current;
  useEffect(() => {
    if (isReducedMotion()) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  }, [progress]);
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.selected, { opacity: progress, transform: [{ scale }] }]}
    />
  );
}
const s = StyleSheet.create({
  calendar: { padding: 12 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    paddingLeft: 6,
  },
  control: { padding: 8, minHeight: 44, justifyContent: "center" },
  todayLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent },
  week: { flexDirection: "row" },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.muted,
    marginBottom: 9,
  },
  day: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    margin: 1,
  },
  selected: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  today: { backgroundColor: colors.accentSoft },
  dayText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  dots: { height: 7, flexDirection: "row", gap: 3, marginTop: 4 },
  dot: { width: 3, height: 3, borderRadius: radii.pill },
});

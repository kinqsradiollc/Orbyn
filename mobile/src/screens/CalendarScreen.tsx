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
  statusTones,
  type Item,
} from "@orbyn/core";
import {
  PlannerList,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
import { Icon } from "../components/Icon";
import {
  FadeIn,
  PressableScale,
  animateLayout,
  easeOut,
  isReducedMotion,
} from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";
import { addDays } from "./calendar/dates";
import { DayTimeline } from "./calendar/DayTimeline";
import { WeekStrip } from "./calendar/WeekStrip";

type Mode = "week" | "month";

/**
 * A swipeable week strip (or the Sunday-first month grid), then the selected
 * day as an hour-by-hour timeline and a list of its plans with progress.
 */
export function CalendarScreen({
  items,
  ...handlers
}: ListHandlers & { items: Item[] }) {
  const [mode, setMode] = useState<Mode>("week");
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date());
  const dayItems = itemsOnDay(items, selected).sort(byDueDate);

  const select = (day: Date) => {
    setSelected(day);
    if (day.getMonth() !== month.getMonth()) setMonth(day);
  };
  const step = (direction: 1 | -1) => {
    if (mode === "week") select(addDays(selected, 7 * direction));
    else {
      const next = addMonths(month, direction);
      setMonth(next);
      setSelected(next);
    }
  };
  const heading = (mode === "week" ? selected : month).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const unit = mode === "week" ? "week" : "month";
  return (
    <>
      <View style={[shared.card, s.calendar]}>
        <View style={s.heading}>
          <Text
            style={[shared.sectionTitle, s.headingText]}
            accessibilityRole="header"
          >
            {heading}
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Previous ${unit}`}
            onPress={() => step(-1)}
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
            accessibilityLabel={`Next ${unit}`}
            onPress={() => step(1)}
            style={s.control}
          >
            <Icon name="chevronRight" size={20} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              mode === "week" ? "Show the month grid" : "Show the week strip"
            }
            onPress={() => {
              animateLayout();
              setMonth(selected);
              setMode(mode === "week" ? "month" : "week");
            }}
            style={s.toggle}
          >
            <Icon name="calendar" size={14} color={colors.accent} />
            <Text style={s.toggleText}>
              {mode === "week" ? "Month" : "Week"}
            </Text>
          </PressableScale>
        </View>
        {mode === "week" ? (
          <WeekStrip
            selected={selected}
            items={items}
            onSelect={select}
            onShiftWeek={(d) => select(addDays(selected, 7 * d))}
          />
        ) : (
          <MonthGrid
            month={month}
            selected={selected}
            items={items}
            onSelect={select}
          />
        )}
      </View>

      {/* Keyed by day so the timeline and agenda fade in on a new selection. */}
      <FadeIn key={selected.toDateString()}>
        <SectionHeading
          title={dayHeading(selected)}
          count={dayItems.length}
          hint={
            sameDay(selected, new Date())
              ? "Today, hour by hour"
              : "Hour by hour"
          }
        />
        <DayTimeline day={selected} items={dayItems} onOpen={handlers.onOpen} />
        <PlannerList
          visible={dayItems}
          title="Plans for this day"
          empty={emptyDay}
          {...handlers}
        />
      </FadeIn>
    </>
  );
}

function MonthGrid({
  month,
  selected,
  items,
  onSelect,
}: {
  month: Date;
  selected: Date;
  items: Item[];
  onSelect: (day: Date) => void;
}) {
  const today = new Date();
  return (
    <>
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
            const isToday = sameDay(day, today);
            return (
              <Pressable
                key={day.toISOString()}
                accessibilityRole="button"
                accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}, ${plans.length} plan${plans.length === 1 ? "" : "s"}`}
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(day)}
                style={[s.day, isToday && !active && s.today]}
              >
                {active && <SelectedPill />}
                <Text
                  style={[
                    s.dayText,
                    day.getMonth() !== month.getMonth() && {
                      color: colors.faint,
                    },
                    isToday && { color: colors.accent },
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
                            : statusTones[i.status].fg,
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
  calendar: { padding: 12, marginBottom: 22 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingLeft: 6,
  },
  headingText: { flex: 1 },
  control: { padding: 8, minHeight: 44, justifyContent: "center" },
  todayLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.accent,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 32,
    marginLeft: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  toggleText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.accent,
  },
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
  dot: { width: 5, height: 5, borderRadius: radii.pill },
});

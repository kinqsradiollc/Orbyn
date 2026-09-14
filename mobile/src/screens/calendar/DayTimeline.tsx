import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { sameDay, statusLabels, statusTones, type Item } from "@orbyn/core";
import { PressableScale } from "../../motion";
import { colors, fonts, radii } from "../../theme";
import { shared } from "../../styles";
import {
  DAY_END,
  DAY_START,
  HOUR_HEIGHT,
  hourLabel,
  layoutDay,
  offsetFor,
  timeLabel,
} from "./dates";

const GUTTER = 56;
const PAD_TOP = 10;
const VIEW_HEIGHT = 440;
const HOURS = Array.from(
  { length: DAY_END - DAY_START + 1 },
  (_, i) => DAY_START + i,
);

/**
 * Hour rows from 6am to midnight with the day's plans placed by start time
 * and sized by duration; overlapping plans sit side by side. Untimed plans
 * go in the "All day / no time" row. Today shows a red current-time line.
 */
export function DayTimeline({
  day,
  items,
  onOpen,
}: {
  day: Date;
  /** Only the items on `day`. */
  items: Item[];
  onOpen: (item: Item) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const scroll = useRef<ScrollView>(null);
  const { placed, allDay } = layoutDay(items, day);
  const isToday = sameDay(day, now);
  const nowTop = offsetFor(day, now);
  const showNow =
    isToday && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) * HOUR_HEIGHT;

  // Scroll to the current hour today, otherwise to the first plan (or 8am).
  const dayKey = day.toDateString();
  const firstTop = placed[0]?.top;
  useEffect(() => {
    const target = isToday
      ? nowTop - HOUR_HEIGHT
      : (firstTop ?? 2 * HOUR_HEIGHT) - HOUR_HEIGHT / 2;
    const y = Math.max(0, target);
    const t = setTimeout(
      () => scroll.current?.scrollTo({ y, animated: false }),
      0,
    );
    return () => clearTimeout(t);
    // Only when the day changes, not on every minute tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  return (
    <View style={s.card}>
      <View style={s.allDay}>
        <Text style={s.allDayLabel}>All day{"\n"}no time</Text>
        <View style={s.allDayItems}>
          {allDay.length ? (
            allDay.map((item) => {
              const t = statusTones[item.status];
              return (
                <PressableScale
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, no set time, ${statusLabels[item.status]}. Opens task details`}
                  onPress={() => onOpen(item)}
                  style={[s.allDayChip, { backgroundColor: t.bg }]}
                >
                  <View style={[s.dot, { backgroundColor: t.fg }]} />
                  <Text
                    numberOfLines={1}
                    style={[s.allDayText, item.status === "done" && s.doneText]}
                  >
                    {item.title}
                  </Text>
                </PressableScale>
              );
            })
          ) : (
            <Text style={shared.small}>Nothing without a time</Text>
          )}
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={{ height: VIEW_HEIGHT }}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        accessibilityLabel="Day timeline"
      >
        <View
          style={{
            height: (DAY_END - DAY_START) * HOUR_HEIGHT + PAD_TOP * 2,
          }}
        >
          {HOURS.map((hour) => (
            <View
              key={hour}
              style={[
                s.hour,
                { top: PAD_TOP + (hour - DAY_START) * HOUR_HEIGHT },
              ]}
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={s.hourLabel}>{hourLabel(hour % 24)}</Text>
              <View style={s.hourLine} />
            </View>
          ))}
          <View style={[s.events, { top: PAD_TOP }]}>
            {placed.map((p) => {
              const t = statusTones[p.item.status];
              const compact = p.height < 44;
              const range = `${timeLabel(p.start)} – ${timeLabel(p.end)}`;
              return (
                <View
                  key={p.item.id}
                  style={{
                    position: "absolute",
                    top: p.top,
                    height: p.height,
                    left: `${(p.column / p.columns) * 100}%`,
                    width: `${100 / p.columns}%`,
                    paddingRight: 3,
                    paddingBottom: 2,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${p.item.title}, ${range}, ${statusLabels[p.item.status]}. Opens task details`}
                    onPress={() => onOpen(p.item)}
                    style={({ pressed }) => [
                      s.event,
                      { backgroundColor: t.bg, borderLeftColor: t.fg },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      numberOfLines={compact ? 1 : 2}
                      style={[
                        s.eventTitle,
                        p.item.status === "done" && s.doneText,
                      ]}
                    >
                      {p.item.title}
                    </Text>
                    {!compact && (
                      <Text
                        numberOfLines={1}
                        style={[s.eventTime, { color: t.fg }]}
                      >
                        {range}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
          {showNow && (
            <View
              pointerEvents="none"
              accessible
              accessibilityLabel={`Current time, ${timeLabel(now)}`}
              style={[s.now, { top: PAD_TOP + nowTop - 1 }]}
            >
              <View style={s.nowDot} />
              <View style={s.nowLine} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden",
    marginBottom: 22,
  },
  allDay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingRight: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  allDayLabel: {
    width: GUTTER - 4,
    textAlign: "right",
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 13,
    color: colors.muted,
  },
  allDayItems: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  allDayChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  allDayText: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.text,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  hour: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    height: 14,
    marginTop: -7,
  },
  hourLabel: {
    width: GUTTER - 4,
    textAlign: "right",
    paddingRight: 8,
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.faint,
  },
  hourLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  events: { position: "absolute", left: GUTTER, right: 6, bottom: 0 },
  event: {
    flex: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  eventTitle: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text,
  },
  eventTime: { fontFamily: fonts.medium, fontSize: 11, marginTop: 1 },
  doneText: { color: colors.faint, textDecorationLine: "line-through" },
  now: {
    position: "absolute",
    left: GUTTER - 5,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  nowDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.danger,
    marginTop: 1,
  },
  nowLine: { flex: 1, height: 2, backgroundColor: colors.danger },
});

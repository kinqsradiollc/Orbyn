import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
/** Fewest hours shown, so a quiet day still reads as a day. */
const MIN_HOURS = 8;
/** Where a quiet day that isn't today starts. */
const QUIET_START = 8;

/**
 * The whole hours a day needs: every timed plan, plus an hour either side of
 * now today, widened to at least MIN_HOURS inside the 6am-midnight window.
 */
function visibleHours(
  placed: { top: number; height: number }[],
  nowTop: number | null,
) {
  const toHour = (y: number) => DAY_START + y / HOUR_HEIGHT;
  const anchors: number[] = [];
  for (const p of placed) anchors.push(toHour(p.top), toHour(p.top + p.height));
  if (nowTop !== null) anchors.push(toHour(nowTop) - 1, toHour(nowTop) + 1);
  if (!anchors.length) anchors.push(QUIET_START);
  let start = Math.max(DAY_START, Math.floor(Math.min(...anchors)));
  let end = Math.min(DAY_END, Math.ceil(Math.max(...anchors)));
  if (end - start < MIN_HOURS) {
    end = Math.min(DAY_END, start + MIN_HOURS);
    start = Math.max(DAY_START, end - MIN_HOURS);
  }
  return { start, end };
}

/**
 * Hour rows covering the day's plans (and now, today), with plans placed by
 * start time and sized by duration; overlapping plans sit side by side.
 * Untimed plans go in the "All day / no time" row. Today shows a red
 * current-time line.
 *
 * The timeline is drawn at full height and never scrolls by itself: it sits
 * inside the page ScrollView, and a nested vertical ScrollView here took every
 * swipe that started on it, so the page seemed to scroll without moving.
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
  const { placed, allDay } = layoutDay(items, day);
  const isToday = sameDay(day, now);
  const nowTop = offsetFor(day, now);
  const showNow =
    isToday && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) * HOUR_HEIGHT;

  const { start, end } = visibleHours(placed, showNow ? nowTop : null);
  // layoutDay measures from DAY_START; shift everything up to the first shown hour.
  const shift = (start - DAY_START) * HOUR_HEIGHT;
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);

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
      <View
        accessibilityLabel="Day timeline"
        style={{ height: (end - start) * HOUR_HEIGHT + PAD_TOP * 2 }}
      >
        {hours.map((hour) => (
          <View
            key={hour}
            style={[s.hour, { top: PAD_TOP + (hour - start) * HOUR_HEIGHT }]}
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
                  top: p.top - shift,
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
            style={[s.now, { top: PAD_TOP + nowTop - shift - 1 }]}
          >
            <View style={s.nowDot} />
            <View style={s.nowLine} />
          </View>
        )}
      </View>
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

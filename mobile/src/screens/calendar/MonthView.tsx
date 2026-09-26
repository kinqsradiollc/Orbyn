import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { monthGrid, sameDay, type FrameOccurrence } from "@orbyn/core";
import { colors, fonts, radii, themed, tint } from "../../theme";
import { Icon } from "../../components/Icon";
import { covers } from "./dates";
import { layoutWeek, type MonthThing } from "./month";

/** Bars shown per week row before "+N more". */
const LANES = 3;
/** Row heights at the default text size; they grow with the user's text size. */
const LANE_HEIGHT = 17;
const DATE_HEIGHT = 26;
const MORE_HEIGHT = 16;
/** Bar text stops growing here so a week row stays a row, not a page. */
const MAX_SCALE = 1.5;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The month as a Sunday-first grid built from the calendar view: repeats as
 * occurrences, things spanning days as bars across them, time blocks
 * (dashed), subscribed events, planned blocks, and a mark per frame. Tap a
 * day to see it below; "+N more" opens that day on its own.
 */
export function MonthView({
  month,
  selected,
  things,
  sessions = [],
  frames,
  onSelect,
  onMore,
}: {
  month: Date;
  selected: Date;
  things: MonthThing[];
  /** Saved sessions, counted on the local day they start. */
  sessions?: { start_at: string }[];
  frames: FrameOccurrence[];
  onSelect: (day: Date) => void;
  /** Open a day whose things didn't all fit. */
  onMore: (day: Date) => void;
}) {
  const today = new Date();
  // Bar text scales with the user's text size; so must the rows that hold it.
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 600;
  const scale = Math.min(MAX_SCALE, fontScale);
  const lane = Math.round(LANE_HEIGHT * scale);
  const dateRow = Math.round((DATE_HEIGHT + (compact ? 0 : 16)) * scale);
  const moreRow = Math.round(MORE_HEIGHT * scale);
  return (
    <View>
      <View style={s.header}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={s.weekday}>
            {day}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week, w) => {
        const { bars, hidden, total } = layoutWeek(things, week, LANES);
        return (
          <View
            key={w}
            style={[
              s.week,
              {
                height: compact
                  ? Math.round(54 * scale)
                  : dateRow + LANES * lane + moreRow + 2,
              },
              w > 0 && s.weekDivider,
            ]}
          >
            {week.map((day, c) => {
              const active = sameDay(day, selected);
              const isToday = sameDay(day, today);
              const dayFrames = frames.filter((f) => covers(f, day));
              const count = total[c];
              const sessionTotal = sessions.filter((session) =>
                sameDay(new Date(session.start_at), day),
              ).length;
              return (
                <Pressable
                  key={day.toISOString()}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}, ${count ? `${count} on the calendar` : "nothing on the calendar"}, ${sessionTotal} sessions${dayFrames.length ? `, ${dayFrames.map((f) => f.name).join(", ")}` : ""}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(day)}
                  style={({ pressed }) => [
                    s.cell,
                    { left: `${(c / 7) * 100}%` },
                    active && s.cellActive,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={[s.cellHead, compact && s.compactHead]}>
                    <View
                      style={[
                        s.date,
                        compact && {
                          width: 30 * scale,
                          height: 30 * scale,
                          borderRadius: 15 * scale,
                        },
                        isToday && !active && s.dateToday,
                        active && s.dateActive,
                      ]}
                    >
                      <Text
                        maxFontSizeMultiplier={MAX_SCALE}
                        style={[
                          s.dateText,
                          compact && s.compactDate,
                          day.getMonth() !== month.getMonth() && s.otherMonth,
                          isToday && s.todayText,
                          active && s.activeText,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                    <View style={s.frameMarks}>
                      {dayFrames.slice(0, 3).map((f) => (
                        <View
                          key={`${f.frame_id}-${f.start_at}`}
                          style={[s.frameMark, { backgroundColor: f.color }]}
                        />
                      ))}
                    </View>
                  </View>
                  {sessionTotal > 0 ? (
                    compact ? (
                      // Too narrow for the word: the number and a clock,
                      // read out in full.
                      <View
                        accessible
                        accessibilityLabel={`${sessionTotal} ${sessionTotal === 1 ? "session" : "sessions"}`}
                        style={s.sessionCompact}
                      >
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={MAX_SCALE}
                          style={s.sessionCount}
                        >
                          {sessionTotal}
                        </Text>
                        <Icon name="clock" size={10} color={colors.accent} />
                      </View>
                    ) : (
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={MAX_SCALE}
                        style={s.sessionCount}
                      >
                        {sessionTotal}{" "}
                        {sessionTotal === 1 ? "session" : "sessions"}
                      </Text>
                    )
                  ) : (
                    compact &&
                    count > 0 && (
                      <View style={s.activityDots}>
                        {Array.from({ length: Math.min(count, 3) }, (_, n) => (
                          <View key={n} style={s.activityDot} />
                        ))}
                      </View>
                    )
                  )}
                </Pressable>
              );
            })}
            {!compact &&
              bars.map((b) => {
                const t = b.thing;
                return (
                  <View
                    key={`${t.key}-${w}`}
                    pointerEvents="none"
                    style={[
                      s.barWrap,
                      {
                        top: dateRow + b.lane * lane,
                        height: lane,
                        left: `${(b.startCol / 7) * 100}%`,
                        width: `${((b.endCol - b.startCol + 1) / 7) * 100}%`,
                      },
                    ]}
                  >
                    <View
                      style={[
                        s.bar,
                        t.look === "block" || t.look === "ghost"
                          ? {
                              borderColor: t.color,
                              backgroundColor:
                                t.look === "ghost"
                                  ? tint(t.color, 0.1)
                                  : colors.surface,
                            }
                          : {
                              backgroundColor: tint(t.color, 0.18),
                              borderLeftColor: t.color,
                            },
                        (t.look === "block" || t.look === "ghost") && s.dashed,
                        t.look === "external" && s.external,
                        b.continuesBefore && s.flatLeft,
                        b.continuesAfter && s.flatRight,
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={MAX_SCALE}
                        style={[s.barText, t.look === "done" && s.doneText]}
                      >
                        {t.title}
                      </Text>
                    </View>
                  </View>
                );
              })}
            {!compact &&
              hidden.map((n, c) =>
                n > 0 ? (
                  <Pressable
                    key={`more-${c}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${n} more on ${week[c].toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}. Opens that day`}
                    hitSlop={4}
                    onPress={() => onMore(week[c])}
                    style={[
                      s.more,
                      {
                        top: dateRow + LANES * lane,
                        height: moreRow,
                        left: `${(c / 7) * 100}%`,
                      },
                    ]}
                  >
                    <Text style={s.moreText} maxFontSizeMultiplier={MAX_SCALE}>
                      +{n}
                    </Text>
                  </Pressable>
                ) : null,
              )}
          </View>
        );
      })}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    sessionCompact: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      paddingTop: 2,
    },
    sessionCount: {
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.accent,
      textAlign: "center",
      paddingHorizontal: 2,
      paddingTop: 2,
    },
    compactHead: { justifyContent: "center", paddingLeft: 0 },
    compactDate: { fontSize: 15 },
    activityDots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 3,
      marginTop: 3,
    },
    activityDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.accent,
    },
    header: { flexDirection: "row" },
    weekday: {
      flex: 1,
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 10,
      color: colors.muted,
      marginBottom: 6,
    },
    /** Height set per render from the text size. */
    week: {},
    weekDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    cell: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: `${100 / 7}%`,
      borderRadius: 8,
    },
    cellActive: { backgroundColor: colors.accentSoft },
    pressed: { backgroundColor: colors.surfaceMuted },
    cellHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingTop: 3,
      paddingLeft: 3,
    },
    date: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    dateToday: { borderWidth: 1.5, borderColor: colors.accent },
    dateActive: { backgroundColor: colors.accent },
    dateText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
    otherMonth: { color: colors.faint },
    todayText: { color: colors.accent },
    activeText: { color: colors.white },
    frameMarks: { flexDirection: "row", gap: 2, flexShrink: 1 },
    frameMark: { width: 6, height: 3, borderRadius: 2 },
    barWrap: {
      position: "absolute",
      paddingHorizontal: 1,
      paddingBottom: 2,
    },
    bar: {
      flex: 1,
      borderLeftWidth: 2,
      borderRadius: 4,
      paddingHorizontal: 3,
      justifyContent: "center",
      overflow: "hidden",
    },
    dashed: { borderWidth: 1, borderLeftWidth: 1, borderStyle: "dashed" },
    external: { opacity: 0.85 },
    flatLeft: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
    flatRight: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
    barText: {
      fontFamily: fonts.medium,
      fontSize: 9,
      lineHeight: 12,
      color: colors.text,
    },
    doneText: { color: colors.faint, textDecorationLine: "line-through" },
    more: {
      position: "absolute",
      width: `${100 / 7}%`,
      justifyContent: "center",
      paddingLeft: 4,
      borderRadius: radii.pill,
    },
    moreText: {
      fontFamily: fonts.semibold,
      fontSize: 10,
      color: colors.accent,
    },
  }),
);

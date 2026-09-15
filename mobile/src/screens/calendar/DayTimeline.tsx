import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  sameDay,
  statusLabels,
  statusTones,
  type CalendarEntry,
  type DerivedBlock,
  type TimeBlock,
} from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { useNow } from "../../hooks/useNow";
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
  type Slot,
} from "./dates";

const GUTTER = 56;
const PAD_TOP = 10;
/** Fewest hours shown, so a quiet day still reads as a day. */
const MIN_HOURS = 8;
/** Where a quiet day that isn't today starts. */
const QUIET_START = 8;

/** An occurrence of an item, or time set aside for a task. */
export type TimelineSlot =
  | (Slot & { type: "entry"; entry: CalendarEntry })
  | (Slot & { type: "block"; block: TimeBlock });

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

const MORE = { name: "longpress", label: "More options" } as const;

/**
 * Hour rows covering the day's plans (and now, today), with entries placed by
 * start time and sized by duration; overlapping ones sit side by side. Time
 * blocks have a dashed outline; buffers and travel are faint bands. Untimed
 * plans go in the "All day / no time" row. Today shows a current-time line.
 * Long-press a block to move or delete it, or a repeating occurrence to skip it.
 *
 * The timeline is drawn at full height and never scrolls by itself: it sits
 * inside the page ScrollView, and a nested vertical ScrollView here took every
 * swipe that started on it, so the page seemed to scroll without moving.
 */
export function DayTimeline({
  day,
  slots,
  derived,
  onOpen,
  onBlockMenu,
  onEntryMenu,
}: {
  day: Date;
  /** Only the entries and blocks on `day`. */
  slots: TimelineSlot[];
  /** Buffers and travel around the day's events. */
  derived: DerivedBlock[];
  /** Open the task or event behind an entry or block. */
  onOpen: (itemId: string) => void;
  onBlockMenu: (block: TimeBlock) => void;
  /** Only called for repeating occurrences. */
  onEntryMenu: (entry: CalendarEntry) => void;
}) {
  const now = useNow(60_000);
  const { placed, allDay } = layoutDay(slots, day);
  const isToday = sameDay(day, now);
  const nowTop = offsetFor(day, now);
  const showNow =
    isToday && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) * HOUR_HEIGHT;

  const { start, end } = visibleHours(placed, showNow ? nowTop : null);
  // layoutDay measures from DAY_START; shift everything up to the first shown hour.
  const shift = (start - DAY_START) * HOUR_HEIGHT;
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const windowHeight = (end - start) * HOUR_HEIGHT;
  const bands = derived
    .map((d) => {
      const top = offsetFor(day, new Date(d.start_at)) - shift;
      const bottom = offsetFor(day, new Date(d.end_at)) - shift;
      return {
        d,
        top: Math.max(0, top),
        height: Math.min(windowHeight, bottom) - Math.max(0, top),
      };
    })
    .filter((b) => b.height > 2);

  const menuProps = (slot: TimelineSlot) => {
    const menu =
      slot.type === "block"
        ? () => onBlockMenu(slot.block)
        : slot.entry.occurrence
          ? () => onEntryMenu(slot.entry)
          : null;
    if (!menu) return {};
    return {
      onLongPress: menu,
      accessibilityActions: [MORE],
      onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
        if (e.nativeEvent.actionName === MORE.name) menu();
      },
    };
  };

  return (
    <View style={s.card}>
      <View style={s.allDay}>
        <Text style={s.allDayLabel}>All day{"\n"}no time</Text>
        <View style={s.allDayItems}>
          {allDay.length ? (
            allDay.map((slot) => {
              const title =
                slot.type === "entry" ? slot.entry.title : slot.block.title;
              const status =
                slot.type === "entry" ? slot.entry.status : slot.block.status;
              const itemId =
                slot.type === "entry" ? slot.entry.item_id : slot.block.item_id;
              const t = statusTones[status];
              return (
                <PressableScale
                  key={slot.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, no set time, ${statusLabels[status]}. Opens task details`}
                  onPress={() => onOpen(itemId)}
                  {...menuProps(slot)}
                  style={[s.allDayChip, { backgroundColor: t.bg }]}
                >
                  <View style={[s.dot, { backgroundColor: t.fg }]} />
                  <Text
                    numberOfLines={1}
                    style={[s.allDayText, status === "done" && s.doneText]}
                  >
                    {title}
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
        style={{ height: windowHeight + PAD_TOP * 2 }}
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
          {bands.map(({ d, top, height }) => (
            <View
              key={`${d.kind}-${d.item_id}-${d.start_at}`}
              pointerEvents="none"
              accessible
              accessibilityLabel={`${d.label}, ${timeLabel(new Date(d.start_at))} – ${timeLabel(new Date(d.end_at))}`}
              style={[s.band, d.kind === "travel" && s.travel, { top, height }]}
            >
              {height >= 14 && (
                <Text numberOfLines={1} style={s.bandText}>
                  {d.label}
                </Text>
              )}
            </View>
          ))}
          {placed.map((p) => {
            const slot = p.slot;
            const compact = p.height < 44;
            const range = `${timeLabel(p.start)} – ${timeLabel(p.end)}`;
            const box = {
              position: "absolute" as const,
              top: p.top - shift,
              height: p.height,
              left: `${(p.column / p.columns) * 100}%` as const,
              width: `${100 / p.columns}%` as const,
              paddingRight: 3,
              paddingBottom: 2,
            };
            if (slot.type === "block") {
              const b = slot.block;
              return (
                <View key={slot.key} style={box}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Time block for ${b.title}, ${range}. Opens task details`}
                    accessibilityHint="Long-press to move or delete this block"
                    onPress={() => onOpen(b.item_id)}
                    {...menuProps(slot)}
                    style={({ pressed }) => [
                      s.event,
                      s.block,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={s.blockTop}>
                      <Icon name="target" size={11} color={colors.accent} />
                      <Text
                        numberOfLines={compact ? 1 : 2}
                        style={[
                          s.eventTitle,
                          s.blockTitle,
                          b.status === "done" && s.doneText,
                        ]}
                      >
                        {b.title}
                      </Text>
                    </View>
                    {!compact && (
                      <Text numberOfLines={1} style={s.blockTime}>
                        {range}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            }
            const e = slot.entry;
            const t = statusTones[e.status];
            return (
              <View key={slot.key} style={box}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}, ${range}, ${statusLabels[e.status]}${e.occurrence ? ", repeats" : ""}. Opens task details`}
                  accessibilityHint={
                    e.occurrence
                      ? "Long-press to skip this occurrence"
                      : undefined
                  }
                  onPress={() => onOpen(e.item_id)}
                  {...menuProps(slot)}
                  style={({ pressed }) => [
                    s.event,
                    { backgroundColor: t.bg, borderLeftColor: t.fg },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={s.blockTop}>
                    {!!e.occurrence && (
                      <Icon name="repeat" size={10} color={t.fg} />
                    )}
                    <Text
                      numberOfLines={compact ? 1 : 2}
                      style={[s.eventTitle, e.status === "done" && s.doneText]}
                    >
                      {e.title}
                    </Text>
                  </View>
                  {!compact && (
                    <Text
                      numberOfLines={1}
                      style={[s.eventTime, { color: t.fg }]}
                    >
                      {range}
                      {e.location ? ` · ${e.location}` : ""}
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
  band: {
    position: "absolute",
    left: 0,
    right: 3,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  travel: { backgroundColor: colors.soft },
  bandText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.muted,
  },
  event: {
    flex: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  block: {
    borderWidth: 1.5,
    borderLeftWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  blockTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  blockTitle: { flex: 1, color: colors.accent },
  blockTime: {
    fontFamily: fonts.medium,
    fontSize: 11,
    marginTop: 1,
    color: colors.accent,
  },
  eventTitle: {
    flexShrink: 1,
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

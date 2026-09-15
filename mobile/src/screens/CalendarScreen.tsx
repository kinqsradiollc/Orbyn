import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  addMonths,
  monthGrid,
  itemsOnDay,
  byDueDate,
  dayHeading,
  describeRrule,
  emptyDay,
  motion,
  sameDay,
  statusTones,
  type CalendarEntry,
  type CalendarView,
  type Item,
  type TimeBlock,
} from "@orbyn/core";
import { Button } from "../components/Button";
import {
  PlannerList,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
import { Icon } from "../components/Icon";
import { useNow } from "../hooks/useNow";
import { client } from "../lib/api";
import { canJoin, rangeLabel, shortDay, slotLabel } from "../lib/planning";
import {
  FadeIn,
  PressableScale,
  animateLayout,
  easeOut,
  isReducedMotion,
} from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";
import { addDays, startOfWeek } from "./calendar/dates";
import { DayTimeline, type TimelineSlot } from "./calendar/DayTimeline";
import { WeekStrip } from "./calendar/WeekStrip";

type Mode = "week" | "month";
type Act = (fn: () => Promise<void>) => Promise<void>;

/** An item as a calendar entry, for when the calendar view isn't loaded. */
const entryFromItem = (i: Item): CalendarEntry => ({
  item_id: i.id,
  title: i.title,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  start_at: i.due_at ?? new Date().toISOString(),
  end_at: i.end_at,
  team_id: i.team_id,
  team_name: i.team_name ?? null,
  list_id: i.list_id ?? null,
  location: i.location ?? "",
  meeting_url: i.meeting_url ?? "",
  occurrence: null,
  rrule: i.rrule ?? null,
  version: i.version,
});

const onDay = (iso: string, day: Date) => sameDay(new Date(iso), day);

/**
 * A swipeable week strip (or the Sunday-first month grid), then the selected
 * day as an hour-by-hour timeline and a list of its plans with progress. The
 * week comes from the calendar view: repeating items as occurrences, time
 * blocks, and buffers and travel around events.
 */
export function CalendarScreen({
  items,
  act,
  onChanged,
  ...handlers
}: ListHandlers & {
  items: Item[];
  act: Act;
  /** Refresh the planner after a change that moves an item (skipping). */
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("week");
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<{
    start: number;
    data: CalendarView;
  } | null>(null);
  /** Bumped after a block or occurrence changes, to reload the week. */
  const [version, setVersion] = useState(0);
  const now = useNow(30_000);
  const dayItems = itemsOnDay(items, selected).sort(byDueDate);

  // One request per week shown, and again only when the planner's items
  // actually change (unchanged polls keep the same array) or after an edit.
  const weekStart = startOfWeek(selected).getTime();
  useEffect(() => {
    let alive = true;
    const from = new Date(weekStart);
    client
      .calendar(from.toISOString(), addDays(from, 7).toISOString())
      .then((data) => alive && setView({ start: weekStart, data }))
      .catch(() => {
        // Older servers have no calendar view; the items below still show.
      });
    return () => {
      alive = false;
    };
  }, [weekStart, items, version]);
  const week = view && view.start === weekStart ? view.data : null;

  const dayEntries = week
    ? week.entries.filter((e) => onDay(e.start_at, selected))
    : dayItems.map(entryFromItem);
  const slots: TimelineSlot[] = [
    ...dayEntries.map((entry): TimelineSlot => ({
      type: "entry",
      key: `entry-${entry.item_id}-${entry.occurrence ?? entry.start_at}`,
      start: new Date(entry.start_at),
      end: entry.end_at ? new Date(entry.end_at) : null,
      kind: entry.kind,
      entry,
    })),
    ...(week?.blocks ?? [])
      .filter((b) => onDay(b.start_at, selected))
      .map((block): TimelineSlot => ({
        type: "block",
        key: `block-${block.id}`,
        start: new Date(block.start_at),
        end: new Date(block.end_at),
        kind: "task",
        block,
      })),
  ];
  const derived = (week?.derived ?? []).filter(
    (d) => onDay(d.start_at, selected) || onDay(d.end_at, selected),
  );
  const joinable = (week?.entries ?? []).filter((e) => canJoin(e, now));

  const plansOn = (day: Date) =>
    week
      ? week.entries
          .filter((e) => onDay(e.start_at, day))
          .map((e) => ({ key: `${e.item_id}-${e.start_at}`, status: e.status }))
      : itemsOnDay(items, day).map((i) => ({ key: i.id, status: i.status }));

  const openItem = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item) handlers.onOpen(item);
    else void act(async () => handlers.onOpen(await client.getItem(itemId)));
  };
  const reload = () => setVersion((v) => v + 1);
  const blockMenu = (block: TimeBlock) =>
    Alert.alert(block.title, slotLabel(block.start_at, block.end_at), [
      {
        text: "Move to next free time",
        onPress: () =>
          void act(async () => {
            await client.rescheduleBlock(block.id);
            reload();
          }),
      },
      {
        text: "Delete block",
        style: "destructive",
        onPress: () =>
          void act(async () => {
            await client.deleteBlock(block.id);
            reload();
          }),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  const entryMenu = (entry: CalendarEntry) =>
    Alert.alert(
      entry.title,
      `${shortDay(entry.start_at)} · ${describeRrule(entry.rrule) || "Repeats"}`,
      [
        {
          text: "Skip this occurrence",
          style: "destructive",
          onPress: () =>
            void act(async () => {
              if (!entry.occurrence) return;
              await client.skipOccurrence(entry.item_id, entry.occurrence);
              reload();
              onChanged();
            }),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );

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
      {joinable.length > 0 && (
        <FadeIn style={[shared.card, s.join]}>
          <Text style={shared.label}>Happening now</Text>
          {joinable.map((e) => (
            <View key={`${e.item_id}-${e.start_at}`} style={s.joinRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.joinTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={shared.small}>
                  {e.end_at
                    ? rangeLabel(e.start_at, e.end_at)
                    : shortDay(e.start_at)}
                </Text>
              </View>
              <Button
                title="Join"
                icon="video"
                style={s.joinButton}
                onPress={() =>
                  void Linking.openURL(e.meeting_url).catch(() =>
                    Alert.alert("That meeting link couldn’t be opened."),
                  )
                }
              />
            </View>
          ))}
        </FadeIn>
      )}
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
            plansOn={plansOn}
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
          count={dayEntries.length}
          hint={
            sameDay(selected, new Date())
              ? "Today, hour by hour. Long-press a block or repeat for options."
              : "Hour by hour. Long-press a block or repeat for options."
          }
        />
        <DayTimeline
          day={selected}
          slots={slots}
          derived={derived}
          onOpen={openItem}
          onBlockMenu={blockMenu}
          onEntryMenu={entryMenu}
        />
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
  join: { paddingVertical: 14 },
  joinRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  joinTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  joinButton: { marginBottom: 0, minHeight: 44 },
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

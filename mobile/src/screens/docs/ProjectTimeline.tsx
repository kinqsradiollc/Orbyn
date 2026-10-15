import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import {
  projectTimeline,
  projectSessionTicks,
  type Item,
  type Project,
  type ProjectSession,
} from "@orbyn/core";
import { colors, fonts, radii, themed } from "../../theme";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * The project on one time axis.
 *
 * Each bar runs from when a task would have to start — its deadline less
 * its estimate — to its deadline (`deadlineOf`: an all-day task is due by
 * the end of its day), with a mark for today and one for the project's
 * deadline. It is the same reading of the same numbers the desktop shows;
 * only the drawing is different, because a phone has one column rather
 * than a wide chart.
 */
export function ProjectTimeline({
  project,
  tasks,
  sessions,
  onOpenItem,
}: {
  project: Project;
  tasks: Item[];
  sessions: ProjectSession[];
  onOpenItem: (item: Item) => void;
}) {
  const timeline = projectTimeline(project, tasks, new Date(), sessions);
  // A timeline can only place work that has a date; the rest is listed.
  const undated = tasks.filter((t) => !t.due_at);
  if (!timeline)
    return (
      <View style={s.wrap}>
        <Text style={s.eyebrow}>Timeline</Text>
        <Text style={s.empty}>Add a task date to see the timeline.</Text>
      </View>
    );

  const ticks = projectSessionTicks(timeline, sessions);
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const undatedWithSessions = undated.filter((item) =>
    ticks.some((tick) => tick.item_id === item.id),
  );
  const notShown = undated.filter(
    (item) => !undatedWithSessions.includes(item),
  );

  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>Timeline</Text>
      <Text style={s.range}>
        {day(timeline.start)} – {day(timeline.end)} · {timeline.days} day
        {timeline.days === 1 ? "" : "s"}
      </Text>

      {/* Today and the deadline are drawn once, across the whole chart, so
          every bar is read against the same two marks. */}
      <View style={s.chart}>
        {timeline.bars.map((bar) => (
          <Pressable
            key={bar.id}
            style={s.lane}
            accessibilityRole="button"
            accessibilityLabel={`${bar.title}${bar.stage ? `, ${bar.stage}` : ""}${bar.late ? ", overdue" : ""}${ticks
              .filter((t) => t.item_id === bar.id)
              .map((t) => `, session ${new Date(t.start_at).toLocaleString()}`)
              .join("")}`}
            onPress={() => {
              const item = byId.get(bar.id);
              if (item) onOpenItem(item);
            }}
          >
            <Text style={s.laneTitle}>{bar.title}</Text>
            <View style={s.track}>
              {timeline.todayAt !== null && (
                <View
                  style={[s.mark, s.today, { left: `${timeline.todayAt}%` }]}
                  pointerEvents="none"
                />
              )}
              {timeline.deadlineAt !== null && (
                <View
                  style={[
                    s.mark,
                    s.deadline,
                    { left: `${timeline.deadlineAt}%` },
                  ]}
                  pointerEvents="none"
                />
              )}

              <View
                style={[
                  s.bar,
                  { left: `${bar.left}%`, width: `${Math.max(bar.width, 2)}%` },
                  bar.done && s.barDone,
                  bar.late && s.barLate,
                ]}
              />
              {ticks
                .filter((tick) => tick.item_id === bar.id)
                .map((tick) => (
                  <View
                    key={tick.id}
                    style={[
                      s.session,
                      { left: `${tick.left}%`, width: `${tick.width}%` },
                    ]}
                  />
                ))}
            </View>
            <Text style={s.laneStage}>{bar.stage}</Text>
          </Pressable>
        ))}
        {undatedWithSessions.map((item) => (
          <Pressable
            key={item.id}
            style={s.lane}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}${ticks
              .filter((t) => t.item_id === item.id)
              .map((t) => `, session ${new Date(t.start_at).toLocaleString()}`)
              .join("")}`}
            onPress={() => onOpenItem(item)}
          >
            <Text style={s.laneTitle}>{item.title}</Text>
            <View style={s.track}>
              {timeline.todayAt !== null && (
                <View
                  style={[s.mark, s.today, { left: `${timeline.todayAt}%` }]}
                  pointerEvents="none"
                />
              )}
              {timeline.deadlineAt !== null && (
                <View
                  style={[
                    s.mark,
                    s.deadline,
                    { left: `${timeline.deadlineAt}%` },
                  ]}
                  pointerEvents="none"
                />
              )}

              {ticks
                .filter((tick) => tick.item_id === item.id)
                .map((tick) => (
                  <View
                    key={tick.id}
                    style={[
                      s.session,
                      { left: `${tick.left}%`, width: `${tick.width}%` },
                    ]}
                  />
                ))}
            </View>
          </Pressable>
        ))}
      </View>

      {notShown.length > 0 && (
        <View style={s.undated}>
          <Text style={s.undatedHead}>
            No date or session · {notShown.length}
          </Text>
          {notShown.map((t) => (
            <Text key={t.id} style={s.undatedItem}>
              {t.title}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: {
      gap: 8,
      marginTop: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    eyebrow: {
      color: colors.muted,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
    range: { color: colors.muted, fontSize: 13 },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    chart: { position: "relative", gap: 10 },
    mark: { position: "absolute", top: 0, bottom: 0, width: 1, zIndex: 2 },
    today: { backgroundColor: colors.accent },
    deadline: { backgroundColor: colors.danger },
    lane: { gap: 3, minHeight: 44, paddingVertical: 6 },
    laneTitle: { color: colors.text, fontSize: 13 },
    track: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    bar: {
      position: "absolute",
      top: 0,
      bottom: 0,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    barDone: { backgroundColor: colors.faint },
    barLate: { backgroundColor: colors.danger },
    session: {
      position: "absolute",
      top: 0,
      bottom: 0,
      minWidth: 5,
      borderWidth: 1,
      borderColor: colors.text,
      backgroundColor: colors.surface,
    },
    laneStage: { color: colors.muted, fontSize: 11 },
    undated: { gap: 2, marginTop: 4 },
    undatedHead: {
      color: colors.muted,
      fontSize: 11,
      letterSpacing: 0.6,
      fontFamily: fonts.semibold,
    },
    undatedItem: { color: colors.muted, fontSize: 13 },
  }),
);

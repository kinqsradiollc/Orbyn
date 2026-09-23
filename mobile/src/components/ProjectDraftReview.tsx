import { addDays, dayTime } from "@orbyn/core";
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ProjectDecomposition } from "@orbyn/core";
import { colors, fonts, radii, themed } from "../theme";

/** The same complete project review as web, with wrapping phone-sized rows. */
export function ProjectDraftReview({
  project,
}: {
  project: ProjectDecomposition;
}) {
  const time = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      timeZone: project.timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const due = (days: number) =>
    new Date(
      dayTime(
        addDays(project.start_date, days + 1),
        0,
        project.timezone,
      ).getTime() - 1,
    ).toLocaleDateString(undefined, {
      timeZone: project.timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const titles = new Map(project.tasks.map((t) => [t.id, t.title]));
  /**
   * The scheduler reports a task it could not fit as BOTH unplaced and at risk
   * ("A partial placement still helps"), which reads as two contradictory
   * warnings once they sit under the same subtask. Unplaced is the stronger
   * statement and already implies the deadline is in trouble, so at-risk is
   * shown only for tasks that were actually scheduled.
   */
  const warnings = (id: string) => {
    const blocking = project.unplaced.filter((t) => t.item_id === id);
    return blocking.length
      ? blocking
      : project.at_risk.filter((t) => t.item_id === id);
  };
  return (
    <View style={s.root}>
      <Text accessibilityRole="header" style={s.title}>
        {project.title}
      </Text>
      <Text style={s.meta}>
        Creates a project with a parent task and {project.tasks.length}{" "}
        subtasks. Times are in {project.timezone}. Review covers {project.days}{" "}
        days.
      </Text>
      {project.unplaced.length > 0 && (
        <Text style={s.warning}>
          {project.unplaced.length}{" "}
          {project.unplaced.length === 1 ? "subtask cannot" : "subtasks cannot"}{" "}
          be fully scheduled. Their unscheduled work needs another plan.
        </Text>
      )}
      {project.tasks.map((task) => (
        <View key={task.id} style={s.task}>
          <Text style={s.title}>{task.title}</Text>
          <Text style={s.meta}>
            {task.estimate_minutes} min estimated · Due {due(task.due_in_days)}
          </Text>
          {!!task.notes && <Text style={s.text}>{task.notes}</Text>}
          <Text style={s.meta}>
            {task.depends_on.length
              ? `After: ${task.depends_on.map((id) => titles.get(id)).join(", ")}`
              : "No prerequisites"}
          </Text>
          {project.blocks
            .filter((b) => b.item_id === task.id)
            .map((b, i) => (
              <Text key={i} style={s.text}>
                {time(b.start_at)} – {time(b.end_at)} ·{" "}
                {b.frame_name || "Working hours"}
              </Text>
            ))}
          {warnings(task.id).map((t, i) => (
            <Text style={s.warning} key={i}>
              {t.reason}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    root: { gap: 12, marginVertical: 16 },
    task: {
      gap: 8,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 16,
      lineHeight: 22,
      color: colors.text,
    },
    text: {
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      color: colors.text,
    },
    meta: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
      color: colors.muted,
    },
    warning: {
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 20,
      color: colors.text,
    },
  }),
);

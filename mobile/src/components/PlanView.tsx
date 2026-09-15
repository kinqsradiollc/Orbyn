import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Plan, PlannedBlock, UnplacedTask } from "@orbyn/core";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { ProgressBar } from "./ProgressBar";
import { dateLabel } from "@orbyn/core";
import { minutesLabel, rangeLabel, shortDay } from "../lib/planning";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

/** Blocks grouped by the day they start, in time order. */
function byDay(blocks: PlannedBlock[]) {
  const days = new Map<string, PlannedBlock[]>();
  for (const b of [...blocks].sort(
    (a, c) => Date.parse(a.start_at) - Date.parse(c.start_at),
  )) {
    const key = new Date(b.start_at).toDateString();
    days.set(key, [...(days.get(key) ?? []), b]);
  }
  return [...days.values()];
}

/**
 * A proposed plan: the summary, how full the time is, the timeline by day,
 * and the tasks that didn't fit or are at risk. Nothing here saves anything.
 */
export function PlanView({
  plan,
  limit,
}: {
  plan: Plan;
  /** Show at most this many blocks (the assistant's card). */
  limit?: number;
}) {
  const shown = limit ? plan.blocks.slice(0, limit) : plan.blocks;
  const hidden = plan.blocks.length - shown.length;
  const fill = plan.capacity_minutes
    ? Math.round((plan.planned_minutes / plan.capacity_minutes) * 100)
    : 0;
  return (
    <View>
      {!!plan.summary && <Text style={shared.body}>{plan.summary}</Text>}
      <View style={s.capacity}>
        <Text style={s.capacityText}>
          {minutesLabel(plan.planned_minutes) || "Nothing"} planned of{" "}
          {minutesLabel(plan.capacity_minutes) || "no"} free time
        </Text>
        <ProgressBar
          value={fill}
          height={6}
          track={colors.surfaceMuted}
          label="Planned share of free time"
        />
      </View>

      {shown.length === 0 ? (
        <Text style={[shared.small, s.gap]}>
          No blocks to place. Tasks need to be open, and an estimate helps the
          planner size them.
        </Text>
      ) : (
        byDay(shown).map((blocks) => (
          <View key={blocks[0].start_at} style={s.day}>
            <Text style={s.dayTitle} accessibilityRole="header">
              {shortDay(blocks[0].start_at)}
            </Text>
            {blocks.map((b, n) => (
              <View
                key={`${b.item_id}-${b.part}-${b.start_at}`}
                style={[s.block, n > 0 && s.divider]}
                accessible
                accessibilityLabel={`${rangeLabel(b.start_at, b.end_at)}, ${b.title}${b.parts > 1 ? `, part ${b.part} of ${b.parts}` : ""}`}
              >
                <Text style={s.time}>{rangeLabel(b.start_at, b.end_at)}</Text>
                <View style={s.blockMain}>
                  <Text style={s.blockTitle} numberOfLines={2}>
                    {b.title}
                  </Text>
                  {(b.parts > 1 || !!b.frame_name) && (
                    <Text style={shared.small}>
                      {[
                        b.parts > 1 ? `Part ${b.part} of ${b.parts}` : "",
                        b.frame_name ?? "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))
      )}
      {hidden > 0 && (
        <Text style={[shared.small, s.gap]}>
          And {hidden} more block{hidden === 1 ? "" : "s"}.
        </Text>
      )}

      <TaskNotes
        title="Didn’t fit"
        icon="clock"
        tasks={plan.unplaced}
        tone="muted"
      />
      <TaskNotes
        title="At risk"
        icon="alert"
        tasks={plan.at_risk}
        tone="warning"
      />
    </View>
  );
}

function TaskNotes({
  title,
  icon,
  tasks,
  tone,
}: {
  title: string;
  icon: "clock" | "alert";
  tasks: UnplacedTask[];
  tone: "muted" | "warning";
}) {
  if (!tasks.length) return null;
  return (
    <View style={s.notes}>
      <View style={s.notesHead}>
        <Icon
          name={icon}
          size={14}
          color={tone === "warning" ? "#a3742b" : colors.muted}
        />
        <Text style={s.notesTitle} accessibilityRole="header">
          {title}
        </Text>
        <Pill label={String(tasks.length)} tone={tone} />
      </View>
      {tasks.map((t) => (
        <View key={t.item_id} style={s.note}>
          <Text style={s.noteTitle}>{t.title}</Text>
          <Text style={shared.small}>
            {t.due_at ? `Due ${dateLabel(t.due_at)} · ` : ""}
            {t.reason}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  capacity: { gap: 8, marginTop: 12, marginBottom: 6 },
  capacityText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.textSoft,
  },
  gap: { marginTop: 10 },
  day: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  dayTitle: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
    marginBottom: 2,
  },
  block: { flexDirection: "row", gap: 10, paddingVertical: 8 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  time: {
    width: 118,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.accent,
    paddingTop: 1,
  },
  blockMain: { flex: 1 },
  blockTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  notes: { marginTop: 14 },
  notesHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  notesTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.text,
  },
  note: { paddingVertical: 6 },
  noteTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
});

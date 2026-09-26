import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  atRiskLine,
  dueDateOf,
  moveLine,
  PLAN_MAX_DAYS,
  type Plan,
  type PlanMove,
  type PlannedBlock,
  type UnplacedTask,
} from "@orbyn/core";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { ProgressBar } from "./ProgressBar";
import { SmallAction } from "./SmallAction";
import { minutesLabel, rangeLabel, shortDay } from "../lib/planning";
import { colors, fonts, radii, themed } from "../theme";
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

/** The moves ticked: the planner's choice unless changed here. */
export const tickedMoves = (plan: Plan, ticks: Record<string, boolean>) =>
  (plan.moves ?? [])
    .filter((m) => ticks[m.block_id] ?? m.selected)
    .map((m) => m.block_id);

/**
 * A proposed plan: the summary, how full the time is, the timeline by day,
 * late sessions it can move before their deadline, and the tasks that
 * didn't fit or are at risk. Nothing here saves anything.
 */
export function PlanView({
  plan,
  limit,
  actions,
  below,
  ticks,
  onTick,
  onLookAhead,
}: {
  plan: Plan;
  /** Ticks changed on the offered moves (by session); with `onTick`, they can be changed. */
  ticks?: Record<string, boolean>;
  onTick?: (blockId: string, on: boolean) => void;
  /** Plan again over more days (offered on tasks at risk). */
  onLookAhead?: () => void;
  /** Show at most this many blocks (the assistant's card). */
  limit?: number;
  /** Move and Remove on each block, while the plan can still be tuned. */
  actions?: {
    busy: boolean;
    onMove: (block: PlannedBlock) => void;
    onRemove: (block: PlannedBlock) => void;
    /** Let a pinned block move again; shown on pinned blocks. */
    onUnpin?: (block: PlannedBlock) => void;
  };
  /** Shown under a block, such as the form that moves it. */
  below?: (block: PlannedBlock) => React.ReactNode;
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

      {shown.length === 0
        ? !plan.moves?.length &&
          !plan.at_risk.length && (
            <Text style={[shared.small, s.gap]}>
              No sessions to place. Tasks need to be open, and an estimate helps
              the planner size them.
            </Text>
          )
        : byDay(shown).map((blocks) => (
            <View key={blocks[0].start_at} style={s.day}>
              <Text style={s.dayTitle} accessibilityRole="header">
                {shortDay(blocks[0].start_at)}
              </Text>
              {blocks.map((b, n) => (
                <View
                  key={`${b.item_id}-${b.part}-${b.start_at}`}
                  style={[n > 0 && s.divider]}
                >
                  <View
                    style={s.block}
                    accessible
                    accessibilityLabel={`${rangeLabel(b.start_at, b.end_at)}, ${b.title}${b.parts > 1 ? `, session ${b.part} of ${b.parts}` : ""}${b.pinned ? ", pinned" : ""}`}
                  >
                    <Text style={s.time}>
                      {rangeLabel(b.start_at, b.end_at)}
                    </Text>
                    <View style={s.blockMain}>
                      <Text style={s.blockTitle} numberOfLines={2}>
                        {b.title}
                      </Text>
                      {(b.parts > 1 || !!b.frame_name || !!b.pinned) && (
                        <Text style={shared.small}>
                          {[
                            b.pinned ? "Pinned" : "",
                            b.parts > 1
                              ? `Session ${b.part} of ${b.parts}`
                              : "",
                            b.frame_name ?? "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      )}
                    </View>
                  </View>
                  {actions && (
                    <View style={s.blockActions}>
                      <SmallAction
                        label="Move"
                        disabled={actions.busy}
                        onPress={() => actions.onMove(b)}
                      />
                      {b.pinned && actions.onUnpin && (
                        <SmallAction
                          label="Unpin"
                          disabled={actions.busy}
                          onPress={() => actions.onUnpin?.(b)}
                        />
                      )}
                      <SmallAction
                        label="Remove"
                        disabled={actions.busy}
                        onPress={() => actions.onRemove(b)}
                      />
                    </View>
                  )}
                  {below?.(b)}
                </View>
              ))}
            </View>
          ))}
      {hidden > 0 && (
        <Text style={[shared.small, s.gap]}>
          And {hidden} more session{hidden === 1 ? "" : "s"}.
        </Text>
      )}

      <Moves
        moves={plan.moves ?? []}
        chosen={tickedMoves(plan, ticks ?? {})}
        onTick={plan.applied ? undefined : onTick}
      />
      <TaskNotes
        title="At risk"
        icon="alert"
        tasks={plan.at_risk}
        tone="warning"
        onLookAhead={
          onLookAhead && plan.days < PLAN_MAX_DAYS && !plan.applied
            ? onLookAhead
            : undefined
        }
      />
      <TaskNotes
        title="Didn’t fit"
        icon="clock"
        tasks={plan.unplaced}
        tone="muted"
      />
    </View>
  );
}

/**
 * "Move sessions before their deadline (2)": each late session the plan can
 * move, with a rounded tick (the planner's own ticked, yours unticked).
 */
function Moves({
  moves,
  chosen,
  onTick,
}: {
  moves: PlanMove[];
  chosen: string[];
  onTick?: (blockId: string, on: boolean) => void;
}) {
  if (!moves.length) return null;
  return (
    <View style={s.notes}>
      <View style={s.notesHead}>
        <Icon name="arrowRight" size={14} color={colors.warning} />
        <Text style={s.notesTitle} accessibilityRole="header">
          Move sessions before their deadline
        </Text>
        <Pill label={String(moves.length)} tone="warning" />
      </View>
      {moves.map((m) => {
        const on = chosen.includes(m.block_id);
        const line = moveLine(m);
        return (
          <Pressable
            key={m.block_id}
            accessibilityRole="checkbox"
            accessibilityLabel={line}
            accessibilityState={{ checked: on, disabled: !onTick }}
            disabled={!onTick}
            onPress={() => onTick?.(m.block_id, !on)}
            hitSlop={6}
            style={({ pressed }) => [s.move, pressed && s.pressed]}
          >
            <View style={[s.check, on && s.checkOn]}>
              {on && <Icon name="check" size={13} color={colors.white} />}
            </View>
            <Text style={s.moveText}>{line}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TaskNotes({
  title,
  icon,
  tasks,
  tone,
  onLookAhead,
}: {
  title: string;
  icon: "clock" | "alert";
  tasks: UnplacedTask[];
  tone: "muted" | "warning";
  onLookAhead?: () => void;
}) {
  if (!tasks.length) return null;
  return (
    <View style={s.notes}>
      <View style={s.notesHead}>
        <Icon
          name={icon}
          size={14}
          color={tone === "warning" ? colors.warning : colors.muted}
        />
        <Text style={s.notesTitle} accessibilityRole="header">
          {title}
        </Text>
        <Pill label={String(tasks.length)} tone={tone} />
      </View>
      {tasks.map((t) => {
        // "needs 2h, 45m free before Fri 2 Oct, 5 pm", when the plan says.
        const line = atRiskLine(t);
        return (
          <View key={t.item_id} style={s.note}>
            <Text style={s.noteTitle}>{t.title}</Text>
            <Text style={shared.small}>
              {line
                ? line[0].toUpperCase() + line.slice(1)
                : `${dueDateOf(t) ? `Due ${dueDateOf(t)} · ` : ""}${t.reason}`}
            </Text>
          </View>
        );
      })}
      {/* One for them all: planning over more days. */}
      {onLookAhead && (
        <View style={s.noteAction}>
          <SmallAction
            label="Look further ahead"
            disabled={false}
            onPress={onLookAhead}
          />
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
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
      flexShrink: 0,
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.accent,
      paddingTop: 1,
    },
    blockMain: { flex: 1 },
    blockActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingLeft: 128,
      paddingBottom: 8,
    },
    blockTitle: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
    },
    notes: { marginTop: 14 },
    notesHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    notesTitle: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    note: { paddingVertical: 6 },
    noteTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    noteAction: { flexDirection: "row", marginTop: 6 },
    move: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 8,
      borderRadius: radii.input,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    check: {
      width: 22,
      height: 22,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    moveText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.text,
    },
  }),
);

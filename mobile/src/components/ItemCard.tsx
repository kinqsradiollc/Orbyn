import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  dateLabel,
  isClosed,
  plannedLabel,
  rowFitChip,
  statusLabels,
  statusOrder,
  type Item,
  type Priority,
  type Status,
} from "@orbyn/core";
import { Icon } from "./Icon";
import { PlanningMeta } from "./PlanningMeta";
import { Pill, StatusPill, chipTone } from "./Pill";
import { usePlanned } from "../lib/plannedContext";
import { ProgressBar } from "./ProgressBar";
import { SmallAction } from "./SmallAction";
import { shortDay } from "../lib/planning";
import {
  leftLabel,
  percentOf,
  stepsLabel,
  subtasksLabel,
  updatesLabel,
} from "../lib/progress";
import { pop, usePressScale, useReducedMotion, Pressable } from "../motion";
import { colors, fonts, radii, themed, statusTones } from "../theme";
import { tap } from "../lib/haptics";
import { copyLink } from "../lib/share";
import { ActionSheet, type MoreAction } from "./MoreMenu";

/** Every status a task can move to, closed ones last. */
const MOVE_STATUSES: Status[] = [...statusOrder, "cancelled"];
const PRIORITY_NAMES: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
/** Indent per subtask level. */
const INDENT = 22;

/**
 * One planner row: quick-complete checkbox, title, status pill, a slim progress
 * bar and checklist / update counts. Tapping the row opens the task detail.
 * Shrinks slightly while pressed; the check mark pops when the item becomes done.
 * Subtasks sit indented under their task, which can fold them away.
 */
export function ItemCard({
  item,
  busy,
  first = false,
  readOnly = false,
  onToggle,
  onOpen,
  score,
  onSetStatus,
  moveButton = false,
  depth = 0,
  subtasks,
  onMoveBy,
  onDragStart,
  onDragRelease,
  onPickUp,
}: {
  item: Item;
  busy: boolean;
  /** Hides the divider on the first row of a list card. */
  first?: boolean;
  /** Disables the checkbox, e.g. for team items you can only view. */
  readOnly?: boolean;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  /** The priority score, shown when the list is sorted by it. */
  score?: number | null;
  /** Change the status (long-press the card, or "Move to…"). */
  onSetStatus?: (item: Item, status: Status) => void;
  /** Show a "Move to…" status action on the card (the board). */
  moveButton?: boolean;
  /** How deep a subtask sits under the rows above it (0 for a task). */
  depth?: number;
  /** Its subtasks in this list, shown or folded away. */
  subtasks?: { count: number; open: boolean; onToggle: () => void };
  /** Manual order: move up (-1) or down (1) past the next task in its place. */
  onMoveBy?: { up: boolean; down: boolean; move: (dir: -1 | 1) => void };
  /** Manual order: a long press picks the row up to drag. */
  onDragStart?: (item: Item) => void;
  /** The finger lifted after a long press; true when the row was dragged. */
  onDragRelease?: () => boolean;
  /** The board: a long press picks the card up to move it to another column. */
  onPickUp?: (item: Item) => void;
}) {
  const done = item.status === "done";
  const cancelled = item.status === "cancelled";
  const percent = percentOf(item);
  const tone = statusTones[item.status];
  const reduced = useReducedMotion();
  const press = usePressScale();
  const tick = useRef(new Animated.Value(1)).current;
  // The tick box grows with the phone's text size, as the title does, but
  // never shrinks below 22 so its touch area stays full size.
  const box = Math.round(
    22 * Math.max(1, Math.min(2, useWindowDimensions().fontScale)),
  );
  const wasDone = useRef(done);
  const longPressed = useRef(false);
  useEffect(() => {
    if (done && !wasDone.current && !reduced) {
      tick.setValue(0.6);
      pop(tick).start();
    }
    wasDone.current = done;
  }, [done, reduced, tick]);
  const showProgress = item.kind === "task" || percent > 0;
  // "Planned 9:15" for a session today, and the task's status only within a
  // week of its deadline or with a session after it.
  const planned = usePlanned().byItem.get(item.id);
  const planning = item.kind === "task" && !isClosed(item.status);
  const plannedToday = planning ? plannedLabel(planned) : null;
  const fitChip = planning ? rowFitChip(planned?.fit) : null;
  const footer = [
    stepsLabel(item.steps_done, item.steps_total),
    subtasks ? "" : subtasksLabel(item),
    leftLabel(item),
    updatesLabel(item),
  ]
    .filter(Boolean)
    .join(" · ");
  const canMove = !!onSetStatus && !readOnly && item.kind === "task";
  const canReorder = !!onMoveBy && !readOnly;
  /**
   * The row's long-press menu (MOB-07), titled with the task: done or not,
   * open, its status and, in manual order, moving up or down, and its link.
   * Holding and moving still picks the row up to drag.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = () => {
    tap();
    setMenuOpen(true);
  };
  const menuActions: MoreAction[] = [
    ...(!readOnly
      ? [
          {
            label: done ? "Reopen" : "Mark done",
            icon: "check" as const,
            onPress: () => onToggle(item),
          },
        ]
      : []),
    { label: "Open", icon: "arrowRight", onPress: () => onOpen(item) },
    ...(canReorder && onMoveBy.up
      ? [
          {
            label: "Move up",
            icon: "arrowUp" as const,
            onPress: () => onMoveBy.move(-1),
          },
        ]
      : []),
    ...(canReorder && onMoveBy.down
      ? [
          {
            label: "Move down",
            icon: "arrowDown" as const,
            onPress: () => onMoveBy.move(1),
          },
        ]
      : []),
    ...(canMove
      ? MOVE_STATUSES.filter((st) => st !== item.status).map((st) => ({
          label:
            st === "cancelled" ? "Cancel task" : `Move to ${statusLabels[st]}`,
          icon: "list" as const,
          destructive: st === "cancelled",
          onPress: () => onSetStatus?.(item, st),
        }))
      : []),
    {
      label: "Copy link",
      icon: "link",
      onPress: () => void copyLink({ kind: "task", id: item.id }, item.title),
    },
  ];
  const actions = [
    ...(onPickUp
      ? [{ name: "longpress", label: "Move to another column" }]
      : [{ name: "longpress", label: "More for this task" }]),
    ...(canReorder && onMoveBy.up
      ? [{ name: "moveUp", label: "Move up" }]
      : []),
    ...(canReorder && onMoveBy.down
      ? [{ name: "moveDown", label: "Move down" }]
      : []),
  ];
  // Like the web's subtitle: the first line of the notes.
  const note =
    (item.notes ?? "")
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  const priorityTone = { high: s.high, medium: s.medium, low: s.low }[
    item.priority
  ];
  return (
    <Animated.View
      style={[
        s.row,
        !first && s.divider,
        depth > 0 && { paddingLeft: 16 + depth * INDENT },
        press.style,
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: busy || readOnly }}
        accessibilityLabel={(done ? "Reopen " : "Complete ") + item.title}
        disabled={busy || readOnly}
        hitSlop={12}
        onPress={() => {
          // A light tap under the thumb as a task is ticked off.
          if (!done) tap();
          onToggle(item);
        }}
        style={[
          s.check,
          { width: box, height: box },
          done && s.checked,
          readOnly && s.checkLocked,
        ]}
      >
        {done && (
          <Animated.View style={{ transform: [{ scale: tick }] }}>
            <Icon
              name="check"
              size={Math.round(box * 0.6)}
              color={colors.white}
              strokeWidth={3}
            />
          </Animated.View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}${depth > 0 ? ", subtask" : ""}`}
        accessibilityHint={
          onDragStart && canReorder
            ? "Shows steps, progress and updates. Long-press and drag to reorder."
            : "Shows steps, progress and updates"
        }
        style={({ pressed }) => [s.main, pressed && { opacity: 0.6 }]}
        onPressIn={press.onPressIn}
        onPressOut={() => {
          press.onPressOut();
          if (!longPressed.current) return;
          longPressed.current = false;
          // Held without moving: the menu, as without manual order.
          if (!onDragRelease?.()) menu();
        }}
        onPress={() => onOpen(item)}
        onLongPress={
          onDragStart && canReorder
            ? () => {
                longPressed.current = true;
                onDragStart(item);
              }
            : onPickUp
              ? () => {
                  tap();
                  onPickUp(item);
                }
              : menu
        }
        accessibilityActions={actions}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (name === "longpress" && onPickUp) onPickUp(item);
          else if (name === "longpress") menu();
          else if (name === "moveUp") onMoveBy?.move(-1);
          else if (name === "moveDown") onMoveBy?.move(1);
        }}
      >
        <View style={s.top}>
          <Text
            numberOfLines={2}
            style={[s.title, done && s.done, cancelled && s.cancelled]}
          >
            {item.title}
          </Text>
          <StatusPill status={item.status} />
        </View>
        {!!note && (
          <Text numberOfLines={1} style={s.note}>
            {note}
          </Text>
        )}
        <View style={s.meta}>
          <Icon
            name={item.kind === "event" ? "calendar" : "clock"}
            size={12}
            color={colors.muted}
          />
          <Text numberOfLines={1} style={s.metaText}>
            {item.all_day && item.due_at
              ? `${shortDay(item.due_at)} · All day`
              : dateLabel(item.due_at)}
            {item.kind === "event" ? " · Event" : ""}
          </Text>
          <Text
            style={[s.priority, priorityTone]}
            accessibilityLabel={`${PRIORITY_NAMES[item.priority]} priority`}
          >
            {PRIORITY_NAMES[item.priority]}
          </Text>
          {score != null && (
            <Text
              style={s.score}
              accessibilityLabel={`Priority score ${score.toFixed(1)}`}
            >
              {score.toFixed(1)}
            </Text>
          )}
          {!!item.team_name && (
            <View style={s.team}>
              <Icon name="users" size={10} color={colors.accent} />
              <Text numberOfLines={1} style={s.teamText}>
                {item.team_name}
              </Text>
            </View>
          )}
        </View>
        <PlanningMeta item={item} />
        {(!!plannedToday || !!fitChip) && (
          <View style={s.plan}>
            {!!plannedToday && <Pill label={plannedToday} tone="accent" />}
            {!!fitChip && (
              <Pill label={fitChip.text} tone={chipTone(fitChip.tone)} />
            )}
          </View>
        )}
        {showProgress && (
          <View style={s.progress}>
            <ProgressBar
              value={percent}
              color={tone.fg}
              label={`${item.title} progress`}
            />
            <Text style={s.percent}>{percent}%</Text>
          </View>
        )}
        {!!footer && (
          <Text numberOfLines={1} style={s.footer}>
            {footer}
          </Text>
        )}
        {subtasks && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${subtasksLabel(item) || `${subtasks.count} subtasks`}, ${subtasks.open ? "shown" : "hidden"}`}
            accessibilityHint={
              subtasks.open ? "Hides its subtasks" : "Shows its subtasks"
            }
            accessibilityState={{ expanded: subtasks.open }}
            hitSlop={8}
            onPress={subtasks.onToggle}
            style={s.subtasks}
          >
            <View style={subtasks.open && s.turned}>
              <Icon name="chevronRight" size={13} color={colors.accent} />
            </View>
            <Text style={s.subtasksText}>
              {subtasksLabel(item) ||
                `${subtasks.count} subtask${subtasks.count === 1 ? "" : "s"}`}
            </Text>
          </Pressable>
        )}
        {moveButton && canMove && (
          <View style={s.moveRow}>
            <SmallAction label="Move to…" disabled={busy} onPress={menu} />
          </View>
        )}
      </Pressable>
      <ActionSheet
        visible={menuOpen}
        label="Task menu"
        title={item.title}
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
      />
    </Animated.View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
      paddingVertical: 15,
      paddingHorizontal: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checked: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkLocked: { opacity: 0.5 },
    main: { flex: 1 },
    top: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    title: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    done: { color: colors.faint, textDecorationLine: "line-through" },
    cancelled: { color: colors.faint },
    meta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 5,
      marginTop: 4,
    },
    metaText: {
      flexShrink: 1,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
    },
    priority: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      borderRadius: radii.pill,
      overflow: "hidden",
      paddingHorizontal: 7,
      paddingVertical: 1,
      marginLeft: 3,
    },
    high: { color: colors.highText, backgroundColor: colors.highBg },
    medium: { color: colors.mediumText, backgroundColor: colors.mediumBg },
    low: { color: colors.lowText, backgroundColor: colors.lowBg },
    score: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.textSoft,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
      overflow: "hidden",
      paddingHorizontal: 6,
      paddingVertical: 1,
      marginLeft: 3,
    },
    note: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.textSoft,
      marginTop: 2,
    },
    moveRow: { flexDirection: "row", marginTop: 8 },
    plan: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    team: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      flexShrink: 1,
      maxWidth: 140,
      backgroundColor: colors.accentSoft,
      borderRadius: radii.pill,
      paddingHorizontal: 7,
      paddingVertical: 2,
      marginLeft: 3,
    },
    teamText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.accent,
    },
    progress: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 10,
    },
    percent: {
      minWidth: 34,
      textAlign: "right",
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.textSoft,
    },
    footer: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      marginTop: 6,
    },
    subtasks: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 4,
      marginTop: 8,
      minHeight: 24,
    },
    subtasksText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    turned: { transform: [{ rotate: "90deg" }] },
  }),
);

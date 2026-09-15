import React, { useEffect, useRef } from "react";
import {
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  dateLabel,
  statusLabels,
  statusOrder,
  type Item,
  type Priority,
  type Status,
} from "@orbyn/core";
import { Icon } from "./Icon";
import { PlanningMeta } from "./PlanningMeta";
import { StatusPill } from "./Pill";
import { ProgressBar } from "./ProgressBar";
import { SmallAction } from "./SmallAction";
import { shortDay } from "../lib/planning";
import { percentOf, stepsLabel, updatesLabel } from "../lib/progress";
import { pop, usePressScale, useReducedMotion } from "../motion";
import { colors, fonts, radii, themed, statusTones } from "../theme";

/**
 * One planner row: quick-complete checkbox, title, status pill, a slim progress
 * bar and checklist / update counts. Tapping the row opens the task detail.
 * Shrinks slightly while pressed; the check mark pops when the item becomes done.
 */
/** Every status a task can move to, closed ones last. */
const MOVE_STATUSES: Status[] = [...statusOrder, "cancelled"];
const PRIORITY_NAMES: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

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
}) {
  const done = item.status === "done";
  const percent = percentOf(item);
  const tone = statusTones[item.status];
  const reduced = useReducedMotion();
  const press = usePressScale();
  const tick = useRef(new Animated.Value(1)).current;
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current && !reduced) {
      tick.setValue(0.6);
      pop(tick).start();
    }
    wasDone.current = done;
  }, [done, reduced, tick]);
  const showProgress = item.kind === "task" || percent > 0;
  const footer = [
    stepsLabel(item.steps_done, item.steps_total),
    updatesLabel(item),
  ]
    .filter(Boolean)
    .join(" · ");
  const canMove = !!onSetStatus && !readOnly && item.kind === "task";
  const moveMenu = () =>
    Alert.alert(item.title, `Now ${statusLabels[item.status]}`, [
      ...MOVE_STATUSES.filter((st) => st !== item.status).map((st) => ({
        text: `Move to ${statusLabels[st]}`,
        onPress: () => onSetStatus?.(item, st),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
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
    <Animated.View style={[s.row, !first && s.divider, press.style]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: busy || readOnly }}
        accessibilityLabel={(done ? "Reopen " : "Complete ") + item.title}
        disabled={busy || readOnly}
        hitSlop={12}
        onPress={() => onToggle(item)}
        style={[s.check, done && s.checked, readOnly && s.checkLocked]}
      >
        {done && (
          <Animated.View style={{ transform: [{ scale: tick }] }}>
            <Icon name="check" size={13} color={colors.white} strokeWidth={3} />
          </Animated.View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
        accessibilityHint="Shows steps, progress and updates"
        style={({ pressed }) => [s.main, pressed && { opacity: 0.6 }]}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => onOpen(item)}
        onLongPress={canMove ? moveMenu : undefined}
        accessibilityActions={
          canMove ? [{ name: "longpress", label: "Change status" }] : undefined
        }
        onAccessibilityAction={(e) => {
          if (canMove && e.nativeEvent.actionName === "longpress") moveMenu();
        }}
      >
        <View style={s.top}>
          <Text numberOfLines={2} style={[s.title, done && s.done]}>
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
        {moveButton && canMove && (
          <View style={s.moveRow}>
            <SmallAction label="Move to…" disabled={busy} onPress={moveMenu} />
          </View>
        )}
      </Pressable>
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
      borderRadius: 7,
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
    meta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
    metaText: {
      flexShrink: 1,
      fontFamily: fonts.regular,
      fontSize: 12,
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
      fontSize: 10,
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
      fontSize: 12,
      color: colors.muted,
      marginTop: 6,
    },
  }),
);

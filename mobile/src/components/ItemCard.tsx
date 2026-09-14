import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { dateLabel, type Item, type Priority } from "@orbyn/core";
import { Icon } from "./Icon";
import { pop, usePressScale, useReducedMotion } from "../motion";
import { colors, fonts, radii } from "../theme";

const PRIORITY: Record<Priority, { bg: string; fg: string }> = {
  high: { bg: colors.highBg, fg: colors.highText },
  medium: { bg: colors.mediumBg, fg: colors.mediumText },
  low: { bg: colors.lowBg, fg: colors.lowText },
};

/**
 * One planner row, styled like the desktop `.item-row`. Shrinks slightly while
 * pressed; the check mark pops when the item becomes done.
 */
export function ItemCard({
  item,
  busy,
  first = false,
  readOnly = false,
  onToggle,
  onEdit,
}: {
  item: Item;
  busy: boolean;
  /** Hides the divider on the first row of a list card. */
  first?: boolean;
  /** Disables the checkbox, e.g. for team items you can only view. */
  readOnly?: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
}) {
  const done = item.status === "done";
  const tone = PRIORITY[item.priority];
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
  return (
    <Animated.View style={[s.row, !first && s.divider, press.style]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: busy || readOnly }}
        accessibilityLabel={(done ? "Reopen " : "Complete ") + item.title}
        disabled={busy || readOnly}
        hitSlop={12}
        onPress={() => onToggle(item)}
        style={[s.check, done && s.checked]}
      >
        {done && (
          <Animated.View style={{ transform: [{ scale: tick }] }}>
            <Icon name="check" size={13} color={colors.white} strokeWidth={3} />
          </Animated.View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"Edit " + item.title}
        style={({ pressed }) => [s.main, pressed && { opacity: 0.6 }]}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => onEdit(item)}
      >
        <Text numberOfLines={2} style={[s.title, done && s.done]}>
          {item.title}
        </Text>
        <View style={s.meta}>
          <Icon
            name={item.kind === "event" ? "calendar" : "clock"}
            size={12}
            color={colors.muted}
          />
          <Text numberOfLines={1} style={s.metaText}>
            {dateLabel(item.due_at)}
            {item.kind === "event" ? " · Event" : ""}
          </Text>
          {!!item.team_name && (
            <View style={s.team}>
              <Icon name="users" size={10} color={colors.accent} />
              <Text numberOfLines={1} style={s.teamText}>
                {item.team_name}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
      <View style={[s.pill, { backgroundColor: tone.bg }]}>
        <Text style={[s.pillText, { color: tone.fg }]}>{item.priority}</Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
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
    borderColor: "#cfd7ce",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: colors.accent, borderColor: colors.accent },
  main: { flex: 1 },
  title: {
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
  teamText: { fontFamily: fonts.semibold, fontSize: 10, color: colors.accent },
  pill: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 4 },
  pillText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    textTransform: "capitalize",
  },
});

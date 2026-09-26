import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../motion";
import {
  focusPhaseLabel,
  focusRemaining,
  focusRhythm,
  type FocusCurrent,
  type Item,
} from "@orbyn/core";
import { Icon } from "./Icon";
import { client } from "../lib/api";
import { deviceId } from "../lib/device";
import { onLive } from "../lib/live";
import { useNow } from "../hooks/useNow";
import { colors, fonts, radii, themed } from "../theme";

const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

/**
 * A focus session running while focus mode is closed — what, where, and how
 * long is left. On another device, "Continue here" picks it up on this phone;
 * on this one, "Back to focus" returns to it, so leaving focus never strands
 * a session with no way back in.
 */
export function FocusElsewhere({
  items,
  hidden,
  onOpen,
}: {
  items: Item[];
  hidden: boolean;
  onOpen: (item: Item) => void;
}) {
  const [current, setCurrent] = useState<FocusCurrent | null>(null);
  const load = useCallback(() => {
    client.currentFocus().then(setCurrent, () => {});
  }, []);
  useEffect(() => {
    load();
    return onLive((news) => {
      if (news.kind === "focus") load();
    });
  }, [load]);
  // Leaving focus may have paused, finished or kept the session.
  useEffect(() => {
    if (!hidden) load();
  }, [hidden, load]);
  const running = !!current?.state.ends_at;
  const now = useNow(1000, running && !hidden);

  if (!current || hidden) return null;
  const here = current.device_id === deviceId();
  const rhythm = focusRhythm(current.state.rhythm);
  const item = items.find((i) => i.id === current.state.item_id);
  const what = rhythm?.work ? focusPhaseLabel(rhythm, current.state) : "Focus";
  const left = running
    ? `${clock(focusRemaining(current.state, now.getTime()))} left`
    : "paused";
  return (
    <View style={s.bar} accessibilityRole="summary">
      <Icon name="clock" size={15} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>
          {here ? what : `${what} on ${current.device ?? "another device"}`} ·{" "}
          {left}
        </Text>
        {!!current.state.item_title && (
          <Text style={s.detail} numberOfLines={1}>
            {current.state.item_title}
          </Text>
        )}
      </View>
      {item && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={here ? "Back to focus" : "Continue here"}
          hitSlop={8}
          onPress={() => onOpen(item)}
          style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}
        >
          <Text style={s.actionText}>
            {here ? "Back to focus" : "Continue here"}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide for now"
        hitSlop={10}
        onPress={() => setCurrent(null)}
      >
        <Icon name="x" size={15} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginTop: 12,
      borderRadius: radii.input,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.softBorder,
    },
    title: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
    detail: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft },
    action: { paddingHorizontal: 6, paddingVertical: 4 },
    actionText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
  }),
);

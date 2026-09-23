import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { colors, fonts, radii, themed } from "../theme";
import type { outboxState } from "../lib/outbox";

type Outbox = ReturnType<typeof outboxState>;

/**
 * One line under the page title while something is off: no connection, or
 * changes made on this phone waiting to be sent, or one that needs a
 * decision. Hidden when everything is in sync. Tapping opens the details.
 */
export function SyncBar({
  outbox,
  onOpen,
}: {
  outbox: Outbox;
  onOpen: () => void;
}) {
  const waiting = outbox.entries.filter((e) => e.state === "pending").length;
  const needs = outbox.entries.filter((e) => e.state === "failed").length;
  if (!waiting && !needs && !outbox.offline) return null;
  const text = needs
    ? `${needs} ${needs === 1 ? "change needs" : "changes need"} you`
    : waiting
      ? `${outbox.offline ? "Offline · " : ""}${waiting} ${waiting === 1 ? "change" : "changes"} ${outbox.sending ? "sending…" : "waiting to sync"}`
      : "Offline · showing what was saved on this phone";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. Open sync details.`}
      onPress={onOpen}
      style={({ pressed }) => [
        s.bar,
        needs > 0 && s.needs,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icon
        name={outbox.offline ? "cloudOff" : needs ? "alert" : "refreshCw"}
        size={15}
        color={needs ? colors.danger : colors.accent}
      />
      <Text style={[s.text, needs > 0 && s.needsText]} numberOfLines={1}>
        {text}
      </Text>
      <View style={{ flex: 1 }} />
      <Icon name="chevronRight" size={15} color={colors.muted} />
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 40,
      paddingHorizontal: 12,
      marginTop: 12,
      borderRadius: radii.input,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.softBorder,
    },
    needs: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
    text: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
      flexShrink: 1,
    },
    needsText: { color: colors.danger },
  }),
);

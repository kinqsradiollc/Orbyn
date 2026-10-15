import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { colors, fonts, radii, themed } from "../theme";

/** Only the newest mounted host reports a confirmed task completion. */
const hosts: ((title: string) => void)[] = [];
export function celebrate(title: string) {
  hosts.at(-1)?.(title);
}

/** Compact status feedback without bursts, vibration or moving content. */
export function CelebrationHost({ bottom = 24 }: { bottom?: number }) {
  const [shown, setShown] = useState<{ title: string; id: number } | null>(
    null,
  );
  useEffect(() => {
    let serial = 0;
    const show = (title: string) => setShown({ title, id: ++serial });
    hosts.push(show);
    return () => {
      const index = hosts.indexOf(show);
      if (index >= 0) hosts.splice(index, 1);
    };
  }, []);
  useEffect(() => {
    if (!shown) return;
    AccessibilityInfo.announceForAccessibility(`${shown.title} completed.`);
    const timer = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={[s.layer, { bottom }]}>
      <View
        style={s.card}
        accessible
        accessibilityLabel={`${shown.title} completed.`}
      >
        <Icon name="check" size={16} color={colors.accent} />
        <Text style={s.text}>Task completed</Text>
      </View>
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    layer: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
    },
    text: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
  }),
);

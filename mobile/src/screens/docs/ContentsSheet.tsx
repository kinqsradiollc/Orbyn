import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OutlineEntry } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * A page's headings as its contents (NAV-03), from ⋯ → Contents or Info:
 * tap one to go to it. The section being read is marked.
 */
export function ContentsSheet({
  visible,
  outline,
  current,
  onJump,
  onClose,
}: {
  visible: boolean;
  outline: OutlineEntry[];
  current: number;
  onJump: (entry: OutlineEntry) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} title="Contents" onClose={onClose}>
      <ContentsList outline={outline} current={current} onJump={onJump} />
    </BottomSheet>
  );
}

/** The headings as rows, stepped in by level. */
export function ContentsList({
  outline,
  current,
  onJump,
}: {
  outline: OutlineEntry[];
  current: number;
  onJump: (entry: OutlineEntry) => void;
}) {
  if (!outline.length)
    return <Text style={s.empty}>This page has no headings yet.</Text>;
  return (
    <View style={s.list} accessibilityRole="list">
      {outline.map((entry, n) => {
        const here = n === current;
        return (
          <Pressable
            key={`${entry.index}-${entry.text}`}
            accessibilityRole="button"
            accessibilityState={{ selected: here }}
            accessibilityLabel={`${entry.text}, heading ${entry.level}`}
            onPress={() => onJump(entry)}
            style={({ pressed }) => [
              s.row,
              { paddingLeft: 12 + (entry.level - 1) * 14 },
              here && s.here,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text
              style={[s.text, entry.level > 1 && s.sub, here && s.hereText]}
              numberOfLines={1}
            >
              {entry.text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: { gap: 2, paddingBottom: 8 },
    row: {
      minHeight: 44,
      justifyContent: "center",
      paddingRight: 12,
      borderRadius: radii.input,
    },
    here: {
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    text: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    sub: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSoft },
    hereText: { fontFamily: fonts.semibold, color: colors.accent },
    empty: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      paddingVertical: 12,
    },
  }),
);

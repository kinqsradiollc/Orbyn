import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OutlineEntry } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Icon } from "../../components/Icon";
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
  starred,
  onStar,
}: {
  visible: boolean;
  outline: OutlineEntry[];
  current: number;
  onJump: (entry: OutlineEntry) => void;
  onClose: () => void;
  starred?: Set<string>;
  onStar?: (entry: OutlineEntry) => void;
}) {
  return (
    <BottomSheet visible={visible} title="Contents" onClose={onClose}>
      <ContentsList
        outline={outline}
        current={current}
        onJump={onJump}
        starred={starred}
        onStar={onStar}
      />
    </BottomSheet>
  );
}

/** The headings as rows, stepped in by level. */
export function ContentsList({
  outline,
  current,
  onJump,
  starred,
  onStar,
}: {
  outline: OutlineEntry[];
  current: number;
  onJump: (entry: OutlineEntry) => void;
  /** Starred headings by block id, and starring one (NAV-07). */
  starred?: Set<string>;
  onStar?: (entry: OutlineEntry) => void;
}) {
  if (!outline.length)
    return <Text style={s.empty}>This page has no headings yet.</Text>;
  return (
    <View style={s.list} accessibilityRole="list">
      {outline.map((entry, n) => {
        const here = n === current;
        const on = !!entry.id && !!starred?.has(entry.id);
        return (
          <View key={`${entry.index}-${entry.text}`} style={s.line}>
            <Pressable
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
            {onStar ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={
                  on ? `Unstar ${entry.text}` : `Star ${entry.text}`
                }
                hitSlop={10}
                onPress={() => onStar(entry)}
                style={s.star}
              >
                <Icon
                  name={on ? "starFilled" : "star"}
                  size={16}
                  color={on ? colors.accent : colors.muted}
                />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: { gap: 2, paddingBottom: 8 },
    line: { flexDirection: "row", alignItems: "center", gap: 4 },
    star: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    row: {
      flex: 1,
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

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii, themed } from "../../theme";

export type MentionPerson = { id: string; name: string; email: string };

/**
 * The people picker on the phone: typing "@" in a line shows the people who
 * can open the page, narrowed by what's typed, just above the keyboard
 * toolbar. Tapping one writes the mention into the line.
 */
export function MentionStrip({
  query,
  people,
  onPick,
}: {
  query: string;
  /** Null while loading. */
  people: MentionPerson[] | null;
  onPick: (person: MentionPerson) => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = (people ?? [])
    .filter(
      (p) =>
        !q ||
        p.name
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.startsWith(q)) ||
        p.email.toLowerCase().startsWith(q),
    )
    .slice(0, 8);
  return (
    <View style={s.strip} accessibilityLabel="Mention someone">
      {people === null ? (
        <Text style={s.note}>Finding people…</Text>
      ) : !matches.length ? (
        <Text style={s.note}>
          Nobody else who can open this page has that name.
        </Text>
      ) : (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.row}
        >
          {matches.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${p.name}`}
              onPress={() => onPick(p)}
              style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.chipText}>@{p.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    strip: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    row: { gap: 8, alignItems: "center", paddingVertical: 6 },
    chip: {
      minHeight: 32,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    chipText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    note: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  }),
);

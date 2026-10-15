import React, { useRef } from "react";
import { usePaneWidth } from "../../hooks/usePaneWidth";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SmallAction } from "../../components/SmallAction";
import { Pressable } from "../../motion";
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
  failed = false,
  onRetry,
}: {
  query: string;
  failed?: boolean;
  onRetry?: () => void;
  /** Null while loading. */
  people: MentionPerson[] | null;
  onPick: (person: MentionPerson) => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = (people ?? []).filter(
    (p) =>
      !q ||
      p.name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q)) ||
      p.email.toLowerCase().startsWith(q),
  );
  const latest = useRef({ people, failed, onPick });
  latest.current = { people, failed, onPick };
  const { width, onLayout } = usePaneWidth();
  const counts = new Map<string, number>();
  for (const person of people ?? []) {
    const name = person.name.trim().toLocaleLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return (
    <View
      onLayout={onLayout}
      style={s.strip}
      accessibilityLabel="Mention someone"
    >
      {failed ? (
        <View style={s.recovery}>
          <Text style={s.note} accessibilityRole="alert">
            Couldn't load people.
          </Text>
          {onRetry && (
            <SmallAction
              label="Retry people"
              onPress={onRetry}
              disabled={false}
            />
          )}
        </View>
      ) : people === null ? (
        <Text style={s.note}>Finding people…</Text>
      ) : !matches.length ? (
        <Text style={s.note}>
          {q ? "No matching people." : "No other people with access."}
        </Text>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(person) => person.id}
          initialNumToRender={8}
          maxToRenderPerBatch={12}
          keyboardShouldPersistTaps="always"
          style={s.list}
          nestedScrollEnabled
          contentContainerStyle={s.row}
          renderItem={({ item: p }) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${p.name}, ${p.email}`}
              onPress={() => {
                const current = latest.current;
                const person = current.people?.find(
                  (person) => person.id === p.id,
                );
                if (!current.failed && person) current.onPick(person);
              }}
              style={({ pressed }) => [
                s.chip,
                { maxWidth: Math.max(44, width - 24) },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={s.chipText}>@{p.name}</Text>
              {(counts.get(p.name.trim().toLocaleLowerCase()) ?? 0) > 1 && (
                <Text style={s.note}>{p.email}</Text>
              )}
            </Pressable>
          )}
        />
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
    recovery: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
    },
    list: { maxHeight: 180 },
    row: { gap: 4, paddingVertical: 6 },
    chip: {
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "flex-start",
      justifyContent: "center",
      paddingVertical: 8,
    },
    chipText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    note: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  }),
);

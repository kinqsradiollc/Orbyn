import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, radii, themed } from "../../theme";

/** One word of a line, with where it sits in the line's source. */
type Word = { text: string; start: number; end: number };

/** Split a line into words, keeping each one's place in the source. */
function words(source: string): Word[] {
  const out: Word[] = [];
  for (const m of source.matchAll(/\S+/g)) {
    const start = m.index ?? 0;
    out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out;
}

/**
 * Choose the words a remark is about, on a phone.
 *
 * There is no dragging a cursor through a sentence here: a phone selection
 * is for copying, and it never tells the app which characters were caught.
 * So the line is offered as its own words — tap where the remark starts, tap
 * where it ends, and the range between them is what the remark points at.
 * Tapping one word twice remarks on that word alone.
 */
export function WordPicker({
  source,
  onPick,
  onAsk,
  onCancel,
}: {
  source: string;
  onPick: (range: { start: number; end: number; quote: string }) => void;
  /** Offered when the assistant is available: ask it for these words. */
  onAsk?: (range: { start: number; end: number; quote: string }) => void;
  onCancel: () => void;
}) {
  const list = useMemo(() => words(source), [source]);
  const [selection, setSelection] = useState<{
    source: string;
    from: number | null;
    to: number | null;
  }>({ source, from: null, to: null });
  const from = selection.source === source ? selection.from : null;
  const to = selection.source === source ? selection.to : null;

  const low = from === null ? null : Math.min(from, to ?? from);
  const high = from === null ? null : Math.max(from, to ?? from);
  const inRange = (i: number) =>
    low !== null && high !== null && i >= low && i <= high;

  const tap = (i: number) => {
    if (from === null || to !== null) {
      setSelection({ source, from: i, to: null });
    } else setSelection({ source, from, to: i });
  };

  const chosen =
    low === null || high === null || !list[low] || !list[high]
      ? null
      : {
          start: list[low].start,
          end: list[high].end,
          quote: source.slice(list[low].start, list[high].end),
        };

  return (
    <View style={s.wrap}>
      <Text style={s.hint}>
        {from === null
          ? "Choose the first word."
          : to === null
            ? "Choose the last word."
            : "Selection ready"}
      </Text>
      <ScrollView
        style={s.wordScroll}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View style={s.words}>
          {list.map((w, i) => (
            <Pressable
              key={`${w.start}-${i}`}
              onPress={() => tap(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: inRange(i) }}
              accessibilityLabel={`Word ${w.text}`}
              style={({ pressed }) => [
                s.word,
                inRange(i) && s.wordOn,
                pressed && s.wordPressed,
              ]}
            >
              <Text style={[s.wordText, inRange(i) && s.wordTextOn]}>
                {w.text}
              </Text>
            </Pressable>
          ))}
        </View>
        {!list.length && <Text style={s.hint}>No words to select</Text>}
      </ScrollView>
      <View style={s.actions}>
        <SmallAction label="Cancel" disabled={false} onPress={onCancel} />
        {!!onAsk && (
          <SmallAction
            label="Ask AI"
            disabled={!chosen}
            onPress={() => chosen && onAsk(chosen)}
          />
        )}
        <Button
          title="Comment"
          disabled={!chosen}
          onPress={() => chosen && onPick(chosen)}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: {
      gap: 10,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    hint: { color: colors.muted, fontSize: 13 },
    wordScroll: { maxHeight: 260, minWidth: 0 },
    words: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    word: {
      minWidth: 44,
      minHeight: 44,
      maxWidth: "100%",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    wordOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    wordPressed: { opacity: 0.7 },
    wordText: { color: colors.text, fontSize: 15, flexShrink: 1 },
    wordTextOn: { color: colors.accent, fontFamily: fonts.semibold },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      gap: 8,
    },
  }),
);

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { plainText, type DocAnswer } from "@orbyn/core";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * Ask something about this page, answered from this page — the phone's side
 * of what the desktop has had in its margin. Nothing else is read: not your
 * other pages, not your schedule, so the answer can be checked against the
 * lines it names. Tapping a line takes you to it, which is the point: the
 * answer is a way into the page, not a replacement for reading it.
 */
export function DocAsk({
  docId,
  onGoToBlock,
}: {
  docId: string;
  /** Opens the remarks on a line the answer leant on. */
  onGoToBlock: (blockId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DocAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const ask = () => {
    const asked = question.trim();
    if (!asked || busy) return;
    setBusy(true);
    setProblem("");
    setAnswer(null);
    client
      .askDoc(docId, asked)
      .then(setAnswer)
      .catch((e: Error) => setProblem(e.message || "No answer."))
      .finally(() => setBusy(false));
  };

  if (!open)
    return (
      <View style={s.openRow}>
        <SmallAction
          label="Ask about this page"
          disabled={false}
          onPress={() => setOpen(true)}
        />
      </View>
    );

  return (
    <View style={s.card} accessibilityLabel="Ask about this page">
      <View style={s.head}>
        <Icon name="sparkles" size={15} color={colors.accent} />
        <Text style={s.title}>Ask about this page</Text>
        <View style={s.spacer} />
        <SmallAction
          label="Close"
          disabled={false}
          onPress={() => setOpen(false)}
        />
      </View>

      <TextInput
        style={s.input}
        value={question}
        multiline
        maxLength={1000}
        placeholder="What did we decide about pricing?"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Your question about this page"
        onChangeText={setQuestion}
      />
      <Button
        title={busy ? "Reading…" : "Ask"}
        disabled={busy || !question.trim()}
        onPress={ask}
      />

      {!!problem && <Text style={s.problem}>{problem}</Text>}

      {answer && (
        <View style={s.answer}>
          <Text style={s.answerText}>{answer.answer}</Text>
          {answer.sources.map((source) => (
            <Pressable
              key={source.block_id}
              accessibilityRole="button"
              accessibilityLabel={`Go to “${plainText(source.quote)}”`}
              onPress={() => onGoToBlock(source.block_id)}
              style={({ pressed }) => [s.source, pressed && s.sourcePressed]}
            >
              <Text style={s.sourceText} numberOfLines={3}>
                “{plainText(source.quote)}”
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    openRow: { flexDirection: "row", marginTop: 4 },
    card: {
      gap: 10,
      marginTop: 4,
      padding: 12,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    spacer: { flex: 1 },
    input: {
      minHeight: 64,
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      textAlignVertical: "top",
    },
    problem: { color: colors.danger, fontSize: 13, lineHeight: 19 },
    answer: { gap: 8 },
    answerText: { color: colors.text, fontSize: 15, lineHeight: 22 },
    // A line the answer leant on: tapping it opens that line's remarks.
    source: {
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
      backgroundColor: colors.surface,
    },
    sourcePressed: { opacity: 0.6 },
    sourceText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);

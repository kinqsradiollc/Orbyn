import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { DocComment } from "@orbyn/core";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, radii, themed } from "../../theme";
import type { DocCommentsState } from "./useDocComments";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * One run of remarks, with a box to add to it. The same thread is used under
 * a line and for the page as a whole, so a comment reads the same wherever
 * it is: who wrote it, when, and what it says.
 */
export function DocThread({
  comments,
  state,
  userId,
  /** What the line said, shown above a thread that belongs to one. */
  quote,
  placeholder,
  /** Set when adding should anchor the remark to a line. */
  anchor,
  autoFocus = false,
  onDone,
}: {
  comments: DocComment[];
  state: DocCommentsState;
  userId?: string;
  quote?: string | null;
  placeholder: string;
  anchor?: { block_id: string; quote: string };
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const body = draft;
    setDraft("");
    void state.add(body, anchor).then((ok) => {
      if (ok) onDone?.();
      else setDraft(body);
    });
  };

  return (
    <View style={styles.thread}>
      {!!quote && <Text style={styles.quote}>“{quote}”</Text>}

      {comments.map((c) => (
        <View
          key={c.id}
          style={[styles.comment, !!c.resolved_at && styles.faded]}
        >
          <View style={styles.head}>
            <Text style={styles.author}>{c.author}</Text>
            <Text style={styles.when}>{when(c.created_at)}</Text>
          </View>
          <Text style={styles.body}>{c.body}</Text>
          <View style={styles.actions}>
            <SmallAction
              label={c.resolved_at ? "Bring back" : "Resolve"}
              disabled={state.busy}
              onPress={() => state.setResolved(c, !c.resolved_at)}
            />
            {c.user_id === userId && (
              <SmallAction
                label="Remove"
                destructive
                disabled={state.busy}
                onPress={() => state.remove(c)}
              />
            )}
          </View>
        </View>
      ))}

      <TextInput
        style={styles.input}
        value={draft}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline
        autoFocus={autoFocus}
        maxLength={4000}
        onChangeText={setDraft}
        accessibilityLabel="New comment"
      />
      <View style={styles.send}>
        {!!onDone && (
          <SmallAction label="Cancel" disabled={false} onPress={onDone} />
        )}
        <Button
          title="Comment"
          disabled={state.busy || !draft.trim()}
          onPress={send}
        />
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    thread: { gap: 8 },
    quote: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
    },
    comment: {
      gap: 6,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    faded: { backgroundColor: colors.surfaceMuted },
    head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    author: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
    when: { color: colors.muted, fontSize: 12 },
    body: { color: colors.text, fontSize: 14, lineHeight: 20 },
    actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    input: {
      color: colors.text,
      fontSize: 14,
      minHeight: 56,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlignVertical: "top",
    },
    send: { flexDirection: "row", alignItems: "center", gap: 8 },
  }),
);

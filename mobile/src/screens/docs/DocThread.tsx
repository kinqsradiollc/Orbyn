import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { plainText, threadComments, type DocComment } from "@orbyn/core";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, radii, themed } from "../../theme";
import type { DocCommentsState } from "./useDocComments";
import { MentionInput } from "./MentionInput";

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
  anchor?: Parameters<DocCommentsState["add"]>[1];
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState("");
  /** The remark being answered, and what has been typed under it. */
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  /** Everyone each composer has named, kept by id so a rename still reads. */
  const namedDraft = useRef(new Map<string, string>());
  const namedReply = useRef(new Map<string, string>());
  const [mentions, setMentions] = useState<string[]>([]);
  const [replyMentions, setReplyMentions] = useState<string[]>([]);

  const send = () => {
    const body = draft;
    setDraft("");
    void state.add(body, { ...(anchor ?? {}), mentions }).then((ok) => {
      if (ok) {
        namedDraft.current.clear();
        setMentions([]);
        onDone?.();
      } else setDraft(body);
    });
  };

  const sendReply = () => {
    if (!reply) return;
    const body = reply.text;
    setReply(null);
    void state
      .add(body, { parent_id: reply.id, mentions: replyMentions })
      .then((ok) => {
        if (ok) {
          namedReply.current.clear();
          setReplyMentions([]);
        } else setReply({ id: reply.id, text: body });
      });
  };

  return (
    <View style={styles.thread}>
      {!!quote && <Text style={styles.quote}>“{plainText(quote)}”</Text>}

      {threadComments(comments).map(({ comment, replies }) => (
        <View key={comment.id} style={styles.group}>
          {/* A remark whose words have gone still says what it was about. */}
          {comment.detached && !!comment.quote && (
            <Text style={styles.gone}>
              “{plainText(comment.quote)}” — since removed
            </Text>
          )}
          {[comment, ...replies].map((c, depth) => (
            <View
              key={c.id}
              style={[
                styles.comment,
                depth > 0 && styles.reply,
                !!c.resolved_at && styles.faded,
              ]}
            >
              <View style={styles.head}>
                <Text style={styles.author}>{c.author}</Text>
                <Text style={styles.when}>{when(c.created_at)}</Text>
              </View>
              <Text style={styles.body}>{c.body}</Text>
              <View style={styles.actions}>
                {depth === 0 && (
                  <SmallAction
                    label={c.resolved_at ? "Bring back" : "Resolve"}
                    disabled={state.busy}
                    onPress={() => state.setResolved(c, !c.resolved_at)}
                  />
                )}
                {depth === 0 && !c.resolved_at && (
                  <SmallAction
                    label="Reply"
                    disabled={state.busy}
                    onPress={() =>
                      setReply((r) =>
                        r?.id === c.id ? null : { id: c.id, text: "" },
                      )
                    }
                  />
                )}
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
          {reply?.id === comment.id && (
            <View style={styles.replyBox}>
              <MentionInput
                docId={state.docId}
                value={reply.text}
                onChangeText={(text) => setReply({ id: comment.id, text })}
                onNamed={setReplyMentions}
                named={namedReply.current}
                placeholder="Reply…"
                autoFocus
                accessibilityLabel="Reply"
              />
              <View style={styles.send}>
                <SmallAction
                  label="Cancel"
                  disabled={false}
                  onPress={() => setReply(null)}
                />
                <Button
                  title="Reply"
                  disabled={state.busy || !reply.text.trim()}
                  onPress={sendReply}
                />
              </View>
            </View>
          )}
        </View>
      ))}

      <MentionInput
        docId={state.docId}
        value={draft}
        onChangeText={setDraft}
        onNamed={setMentions}
        named={namedDraft.current}
        placeholder={placeholder}
        autoFocus={autoFocus}
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
    group: { gap: 6 },
    gone: {
      color: colors.muted,
      fontSize: 12,
      textDecorationLine: "line-through",
    },
    reply: { marginLeft: 14, backgroundColor: colors.surfaceMuted },
    replyBox: { gap: 8, marginLeft: 14 },
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

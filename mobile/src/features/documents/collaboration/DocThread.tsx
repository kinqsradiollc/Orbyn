import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, ScrollView, View } from "react-native";
import { threadComments, type DocComment } from "@orbyn/core";
import { MoreMenu, ActionSheet } from "../../../components/MoreMenu";
import { session } from "../../../lib/session";
import { Button } from "../../../components/Button";
import { SmallAction } from "../../../components/SmallAction";
import { colors, fonts, radii, themed } from "../../../theme";
import type { DocCommentsState } from "./useDocComments";
import { InlineDetails } from "../../../components/InlineDetails";
import { MentionInput } from "../editor/MentionInput";
import { commentDraftScope, useCommentDraftGuard } from "./doc-comment-drafts";

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
export function DocThread(props: React.ComponentProps<typeof DocThreadBody>) {
  return (
    <DocThreadBody
      key={`${session.token}:${props.state.docId}:${props.anchor?.block_id ?? "page"}`}
      {...props}
    />
  );
}
function DocThreadBody({
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
  const [discard, setDiscard] = useState(false);
  const [replyOnly, setReplyOnly] = useState(false);
  const leaveResolver = useRef<((allow: boolean) => void) | null>(null);
  const pending = useRef(false);
  const [removing, setRemoving] = useState<DocComment | null>(null);
  const alive = useRef(true);
  const identity = {
    id: state.docId,
    block: anchor?.block_id,
    account: session.token,
  };
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      leaveResolver.current?.(false);
      leaveResolver.current = null;
    };
  }, []);
  const current = (owner: typeof identity) =>
    alive.current &&
    owner.id === identityRef.current.id &&
    owner.block === identityRef.current.block &&
    owner.account === session.token;
  /** The remark being answered, and what has been typed under it. */
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  /** Everyone each composer has named, kept by id so a rename still reads. */
  const namedDraft = useRef(new Map<string, string>());
  const namedReply = useRef(new Map<string, string>());
  const [mentions, setMentions] = useState<string[]>([]);
  const [replyMentions, setReplyMentions] = useState<string[]>([]);
  const edits = useRef({ draft, reply, busy: state.busy, identity });
  edits.current = { draft, reply, busy: state.busy, identity };
  const beforeLeave = async (onlyReply = false) => {
    if (
      !current(identity) ||
      pending.current ||
      edits.current.busy ||
      leaveResolver.current
    )
      return false;
    if (
      !(onlyReply
        ? edits.current.reply?.text.trim()
        : edits.current.draft.trim() || edits.current.reply?.text.trim())
    )
      return true;
    setReplyOnly(onlyReply);
    setDiscard(true);
    return new Promise<boolean>((resolve) => {
      leaveResolver.current = resolve;
    });
  };
  useCommentDraftGuard(commentDraftScope(anchor?.block_id), beforeLeave);
  const settleLeave = (allowed: boolean) => {
    const resolve = leaveResolver.current;
    leaveResolver.current = null;
    if (allowed && current(identity) && !pending.current && !state.busy) {
      if (!replyOnly) {
        setDraft("");
        namedDraft.current.clear();
        setMentions([]);
      }
      setReply(null);
      namedReply.current.clear();
      setReplyMentions([]);
      resolve?.(true);
    } else resolve?.(false);
  };

  const send = () => {
    if (pending.current || state.busy || !draft.trim() || !current(identity))
      return;
    pending.current = true;
    const body = draft;
    const owner = identity;
    void state
      .add(body, { ...(anchor ?? {}), mentions })
      .then((ok) => {
        if (ok && current(owner) && edits.current.draft === body) {
          setDraft("");
          namedDraft.current.clear();
          setMentions([]);
          onDone?.();
        }
      })
      .finally(() => {
        pending.current = false;
      });
  };

  const sendReply = () => {
    if (
      !reply ||
      pending.current ||
      state.busy ||
      !reply.text.trim() ||
      !current(identity)
    )
      return;
    pending.current = true;
    const body = reply.text;
    const owner = identity;
    void state
      .add(body, { parent_id: reply.id, mentions: replyMentions })
      .then((ok) => {
        if (
          ok &&
          current(owner) &&
          edits.current.reply?.id === reply.id &&
          edits.current.reply.text === body
        ) {
          setReply((shown) =>
            shown?.id === reply.id && shown.text === body ? null : shown,
          );
          namedReply.current.clear();
          setReplyMentions([]);
        }
      })
      .finally(() => {
        pending.current = false;
      });
  };

  return (
    <View style={styles.thread}>
      <ActionSheet
        visible={discard}
        label="Discard comment draft"
        title={replyOnly ? "Discard reply?" : "Discard comment edits?"}
        message={
          replyOnly
            ? "Your unsent reply will be discarded."
            : "Your unsent comment and reply will be discarded."
        }
        cancelLabel="Keep editing"
        actions={[
          {
            label: "Discard",
            destructive: true,
            disabled: state.busy,
            onPress: () => settleLeave(true),
          },
        ]}
        onClose={(selection) => {
          if (selection !== "selected") settleLeave(false);
          setDiscard(false);
        }}
      />
      <ActionSheet
        visible={!!removing}
        label="Remove comment"
        title="Remove this comment?"
        message="Also removes its replies."
        cancelLabel="Keep comment"
        onClose={() => setRemoving(null)}
        actions={[
          {
            label: "Remove",
            destructive: true,
            disabled: state.busy,
            onPress: () => {
              if (removing && current(identity)) state.remove(removing);
            },
          },
        ]}
      />
      {!!quote && (
        <InlineDetails title="Quoted text">
          <ScrollView style={{ maxHeight: 160 }}>
            <Text selectable style={styles.quote}>
              {quote}
            </Text>
          </ScrollView>
        </InlineDetails>
      )}

      {threadComments(comments).map(({ comment, replies }) => (
        <View key={comment.id} style={styles.group}>
          {/* A remark whose words have gone still says what it was about. */}
          {comment.detached && !!comment.quote && (
            <InlineDetails title="Removed text">
              <ScrollView style={{ maxHeight: 160 }}>
                <Text selectable style={styles.gone}>
                  {comment.quote}
                </Text>
              </ScrollView>
            </InlineDetails>
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
                <Text style={styles.author}>
                  {c.author}
                  {c.via_agent ? (
                    <Text style={styles.via}> · via {c.via_agent}</Text>
                  ) : null}
                </Text>
                <Text style={styles.when}>{when(c.created_at)}</Text>
                <MoreMenu
                  label={`Comment options for ${c.author}`}
                  disabled={state.busy}
                  actions={[
                    ...(depth === 0
                      ? [
                          {
                            label: c.resolved_at ? "Reopen" : "Resolve",
                            onPress: () => {
                              if (current(identity))
                                state.setResolved(c, !c.resolved_at);
                            },
                          },
                        ]
                      : []),
                    ...(depth === 0 && !c.resolved_at
                      ? [
                          {
                            label: "Reply",
                            onPress: () => {
                              if (!current(identity)) return;
                              void beforeLeave(true).then((allowed) => {
                                if (allowed && current(identity))
                                  setReply((one) =>
                                    one?.id === c.id
                                      ? null
                                      : { id: c.id, text: "" },
                                  );
                              });
                            },
                          },
                        ]
                      : []),
                    ...(c.user_id === userId
                      ? [
                          {
                            label: "Remove",
                            destructive: true,
                            onPress: () => {
                              if (current(identity)) setRemoving(c);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </View>
              <Text style={styles.body}>{c.body}</Text>
            </View>
          ))}
          {reply?.id === comment.id && (
            <View style={styles.replyBox}>
              <MentionInput
                docId={state.docId}
                editable={!state.busy}
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
                  disabled={state.busy}
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
        editable={!state.busy}
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
          <SmallAction
            label="Cancel"
            disabled={state.busy}
            onPress={() => {
              void beforeLeave().then((allow) => {
                if (allow && current(identity)) onDone?.();
              });
            }}
          />
        )}
        {/* A composer's own button, not a page's: the standing margin under
            every Button left it floating away from the box it belongs to. */}
        <Button
          title="Comment"
          style={styles.sendButton}
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
    sendButton: { marginBottom: 0, paddingHorizontal: 14 },
    group: { gap: 6 },
    gone: {
      color: colors.muted,
      fontSize: 13,
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
    head: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      gap: 8,
    },
    author: {
      flex: 1,
      flexShrink: 1,
      color: colors.text,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
    when: { color: colors.muted, fontSize: 13 },
    via: { color: colors.muted, fontFamily: fonts.regular },
    body: { color: colors.text, fontSize: 15, lineHeight: 20 },
    actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    input: {
      color: colors.text,
      fontSize: 15,
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlignVertical: "top",
    },
    send: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 8,
    },
  }),
);

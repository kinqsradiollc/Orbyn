import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { DocComment } from "@orbyn/core";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Remarks on a document, on the phone. One thread, as on the desktop, so a
 * note survives the blocks being rewritten around it. Resolved remarks fold
 * away but are kept: why something changed is often worth reading later.
 */
export function DocComments({
  docId,
  userId,
  report,
}: {
  docId: string;
  /** Whose comments offer a remove button. */
  userId?: string;
  report: (e: unknown) => void;
}) {
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * A tap can land twice before React has re-rendered the button as
   * disabled, which posted the same remark twice. The guard is a ref so it
   * is true the moment the first tap is handled.
   */
  const sending = useRef(false);

  const load = () =>
    client.listDocComments(docId).then(setComments, () => setComments([]));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const add = () => {
    const body = draft.trim();
    if (!body || sending.current) return;
    sending.current = true;
    setBusy(true);
    // Clear the box at once: the remark is on its way, and an empty box
    // cannot be sent again.
    setDraft("");
    client
      .addDocComment(docId, body)
      .then((made) => setComments((all) => [...(all ?? []), made]))
      .catch((e) => {
        // Put the words back rather than losing them.
        setDraft(body);
        report(e);
      })
      .finally(() => {
        sending.current = false;
        setBusy(false);
      });
  };

  const setResolved = (comment: DocComment, resolved: boolean) => {
    setBusy(true);
    client
      .resolveDocComment(docId, comment.id, resolved)
      .then(() => void load())
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remove = (comment: DocComment) => {
    setBusy(true);
    client
      .deleteDocComment(docId, comment.id)
      .then(() =>
        setComments((all) => all?.filter((c) => c.id !== comment.id) ?? all),
      )
      .catch(report)
      .finally(() => setBusy(false));
  };

  const open = (comments ?? []).filter((c) => !c.resolved_at);
  const done = (comments ?? []).filter((c) => c.resolved_at);

  const thread = (list: DocComment[], resolved: boolean) =>
    list.map((c) => (
      <View key={c.id} style={[styles.comment, resolved && styles.faded]}>
        <View style={styles.head}>
          <Text style={styles.author}>{c.author}</Text>
          <Text style={styles.when}>{when(c.created_at)}</Text>
        </View>
        <Text style={styles.body}>{c.body}</Text>
        <View style={styles.actions}>
          <SmallAction
            label={resolved ? "Bring back" : "Resolve"}
            disabled={busy}
            onPress={() => setResolved(c, !resolved)}
          />
          {c.user_id === userId && (
            <SmallAction
              label="Remove"
              destructive
              disabled={busy}
              onPress={() => remove(c)}
            />
          )}
        </View>
      </View>
    ));

  return (
    <View style={styles.section}>
      <Text style={styles.title}>
        Comments
        {open.length > 0 ? ` · ${open.length}` : ""}
      </Text>

      {comments === null ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : (
        <>
          {open.length === 0 && done.length === 0 && (
            <Text style={styles.empty}>
              No comments yet. Leave a note for whoever reads this next.
            </Text>
          )}

          {thread(open, false)}

          {done.length > 0 && (
            <>
              <Pressable onPress={() => setShowResolved((v) => !v)}>
                <Text style={styles.toggle}>
                  {showResolved ? "Hide" : "Show"} {done.length} resolved
                </Text>
              </Pressable>
              {showResolved && thread(done, true)}
            </>
          )}

          <TextInput
            style={styles.input}
            value={draft}
            placeholder="Leave a comment…"
            placeholderTextColor={colors.faint}
            multiline
            maxLength={4000}
            onChangeText={setDraft}
            accessibilityLabel="New comment"
          />
          <Button
            title="Comment"
            disabled={busy || !draft.trim()}
            onPress={add}
          />
        </>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    section: {
      gap: 10,
      marginTop: 18,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
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
    toggle: { color: colors.accent, fontSize: 13, fontFamily: fonts.semibold },
    input: {
      color: colors.text,
      fontSize: 14,
      minHeight: 64,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlignVertical: "top",
    },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);

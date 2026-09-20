import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  mergeDocs,
  parseDoc,
  serializeBlock,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import { DocBody } from "./DocBody";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

/** How long to wait after typing stops before saving. */
const SAVE_AFTER_MS = 900;

const EMPTY: DocBlock = { type: "paragraph", text: "" };

/**
 * Writing a document on the phone. A line is edited as the Markdown behind
 * it — "# " makes a heading, "- [ ] " a checkbox — which is the same thing
 * the desktop editor does, so a page written on either reads the same on the
 * other.
 */
export function DocEditor({
  doc,
  onChanged,
  onItemsChanged,
  report,
}: {
  doc: Doc;
  onChanged: (doc: Doc) => void;
  /** Called when a tick here may have changed a task. */
  onItemsChanged?: () => void;
  report: (e: unknown) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [blocks, setBlocks] = useState<DocBlock[]>(
    doc.content.length ? doc.content : [EMPTY],
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  const version = useRef(doc.version);
  /** Whether an edit here is waiting to be saved. */
  const dirty = useRef(false);
  /** Which line is open, readable from the live subscription. */
  const focusedRef = useRef<number | null>(null);
  const base = useRef<DocBlock[]>(doc.content);
  const live = useRef({ title: doc.title, blocks: doc.content });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  live.current = { title, blocks };
  focusedRef.current = focused;

  useEffect(() => {
    setTitle(doc.title);
    setBlocks(doc.content.length ? doc.content : [EMPTY]);
    version.current = doc.version;
    base.current = doc.content;
    dirty.current = false;
    setFocused(null);
    setNote("");
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The note is news, not a state to sit in.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 6_000);
    return () => clearTimeout(t);
  }, [note]);

  /** Fold a copy that was saved elsewhere into what is on screen. */
  const reconcile = useCallback((theirs: Doc): DocBlock[] => {
    const merge = mergeDocs(base.current, live.current.blocks, theirs.content);
    const next = merge.blocks.length ? merge.blocks : [EMPTY];
    version.current = theirs.version;
    base.current = theirs.content;
    setBlocks(next);
    setTitle(theirs.title);
    live.current = { title: theirs.title, blocks: next };
    setNote(
      merge.conflicts.length === 1
        ? "Someone else edited this. The line you changed is kept below theirs."
        : merge.conflicts.length > 1
          ? `Someone else edited this. The ${merge.conflicts.length} lines you changed are kept below theirs.`
          : "Updated with someone else's changes.",
    );
    return next;
  }, []);

  const persist = useCallback(
    async (nextTitle: string, nextBlocks: DocBlock[]) => {
      setSaving(true);
      try {
        const saved = await client.updateDoc(doc.id, {
          title: nextTitle,
          content: nextBlocks,
          version: version.current,
        });
        version.current = saved.version;
        base.current = saved.content;
        dirty.current = false;
        onChanged(saved);
      } catch (e) {
        // Someone saved first: take their copy, fold this edit into it and
        // save again rather than making the writer sort it out by hand.
        if ((e as { statusCode?: number }).statusCode === 409) {
          try {
            const merged = reconcile(await client.getDoc(doc.id));
            const saved = await client.updateDoc(doc.id, {
              title: live.current.title,
              content: merged,
              version: version.current,
            });
            version.current = saved.version;
            base.current = saved.content;
            dirty.current = false;
            onChanged(saved);
          } catch (again) {
            report(again);
          }
        } else report(e);
      } finally {
        setSaving(false);
      }
    },
    [doc.id, onChanged, reconcile, report],
  );

  /**
   * The subscription must outlive re-renders: it depends on the document,
   * not on callbacks that are rebuilt each time the page is typed into.
   * Without this the stream was torn down and reopened on every render,
   * which on a phone is a request storm rather than a nuisance.
   */
  const onEvent = useRef<(version: number) => void>(() => {});
  onEvent.current = (remote: number) => {
    if (remote && remote <= version.current) return;
    void client.getDoc(doc.id).then((theirs) => {
      if (theirs.version <= version.current) return;
      // A line open for editing counts as ours even before a keystroke.
      if (!dirty.current && focusedRef.current === null) {
        version.current = theirs.version;
        base.current = theirs.content;
        setTitle(theirs.title);
        setBlocks(theirs.content.length ? theirs.content : [EMPTY]);
        live.current = { title: theirs.title, blocks: theirs.content };
        setNote("Updated with someone else's changes.");
        onChanged(theirs);
        return;
      }
      const merged = reconcile(theirs);
      if (dirty.current) void persist(live.current.title, merged);
      else onChanged(theirs);
    }, report);
  };

  /**
   * Follow the document while it is open, so a page being written on a
   * desktop at the same time does not go stale in your hand.
   */
  useEffect(() => client.watchDoc(doc.id, (v) => onEvent.current(v)), [doc.id]);

  const queueSave = useCallback(
    (nextTitle: string, nextBlocks: DocBlock[]) => {
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void persist(nextTitle, nextBlocks),
        SAVE_AFTER_MS,
      );
    },
    [persist],
  );

  const update = (next: DocBlock[]) => {
    setBlocks(next);
    queueSave(title, next);
  };

  /** Open a line for editing, showing the Markdown behind it. */
  const openLine = (index: number) => {
    setDraft(serializeBlock(blocks[index]));
    setFocused(index);
  };

  /** Put an edited line back. Several lines of text become several blocks. */
  const commit = () => {
    if (focused === null) return;
    const parsed = parseDoc(draft);
    const next = blocks.slice();
    // An emptied line is removed, unless it is the only one left.
    if (!parsed.length) {
      if (next.length > 1) next.splice(focused, 1);
      else next.splice(focused, 1, EMPTY);
    } else next.splice(focused, 1, ...parsed);
    setFocused(null);
    update(next);
  };

  const addLine = () => {
    const next = [...blocks, EMPTY];
    setBlocks(next);
    setDraft("");
    setFocused(next.length - 1);
  };

  const toggle = (index: number) => {
    const next = blocks.map((b, i) =>
      i === index && b.type === "todo" ? { ...b, done: !b.done } : b,
    );
    setBlocks(next);
    // A tick is worth saving at once: it may finish a task.
    if (timer.current) clearTimeout(timer.current);
    void persist(title, next).then(() => onItemsChanged?.());
  };

  return (
    <View style={styles.page}>
      <TextInput
        style={styles.title}
        value={title}
        placeholder="Untitled"
        placeholderTextColor={colors.faint}
        maxLength={200}
        accessibilityLabel="Document title"
        onChangeText={(text) => {
          setTitle(text);
          queueSave(text, blocks);
        }}
      />

      <View style={styles.statusRow}>
        <Text style={styles.meta}>{saving ? "Saving…" : "Saved"}</Text>
        {!!note && (
          <Text style={styles.note} onPress={() => setNote("")}>
            {note}
          </Text>
        )}
      </View>

      <DocBody
        content={blocks}
        editing={focused}
        draft={draft}
        onDraftChange={setDraft}
        onCommit={commit}
        onEditBlock={openLine}
        onToggleTodo={toggle}
      />

      <SmallAction label="Add a line" disabled={false} onPress={addLine} />

      <Text style={styles.hint}>
        Tap a line to edit it. Start with # for a heading, - for a bullet, - [ ]
        for a checkbox, or put a formula between $ signs. Formulas read as
        symbols here and are typeset on the desktop.
      </Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    page: { gap: 10 },
    title: {
      color: colors.text,
      fontSize: 22,
      fontFamily: fonts.display,
      padding: 0,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    meta: { color: colors.muted, fontSize: 12 },
    note: {
      color: colors.muted,
      backgroundColor: colors.soft,
      fontSize: 12,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radii.pill,
      overflow: "hidden",
      flexShrink: 1,
    },
    hint: { color: colors.faint, fontSize: 12, lineHeight: 18 },
  }),
);

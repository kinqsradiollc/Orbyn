import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  BLOCK_KINDS,
  blockText,
  blockToType,
  carryBlockIds,
  newBlockId,
  mergeDocs,
  parseDoc,
  serializeBlock,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import { DocBody } from "./DocBody";
import { DocThread } from "./DocThread";
import type { DocCommentsState } from "./useDocComments";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

/** Kinds that carry on when Return is pressed at the end of a line. */
const LISTS = new Set<DocBlock["type"]>(["bullet", "numbered", "todo"]);
/** Kinds whose text may hold line breaks of its own. */
const MULTILINE = new Set<DocBlock["type"]>(["code", "math"]);

/** Short names for the toolbar, where a phone has no room for "Bulleted list". */
const SHORT: Record<string, string> = {
  paragraph: "Text",
  "heading-1": "H1",
  "heading-2": "H2",
  "heading-3": "H3",
  bullet: "\u2022 List",
  numbered: "1. List",
  todo: "\u2610 To-do",
  quote: "\u201C Quote",
  code: "Code",
  math: "\u2211 Maths",
  divider: "\u2014 Divider",
};
const kindKey = (k: (typeof BLOCK_KINDS)[number]) =>
  k.type === "heading" ? `heading-${k.level}` : k.type;

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
  comments,
  userId,
  onBlocksChange,
  onChanged,
  onItemsChanged,
  report,
}: {
  doc: Doc;
  /** The page's comments, so a line can show its own underneath. */
  comments: DocCommentsState;
  userId?: string;
  /** The lines as they stand, so comments can be matched to them before a save. */
  onBlocksChange?: (blocks: DocBlock[]) => void;
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
  /** The line whose remarks are open, and one waiting to be written on. */
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    blockId: string;
    quote: string;
  } | null>(null);
  /** Set when a line opens so the caret starts at its end; cleared on typing. */
  const [caret, setCaret] = useState<
    { start: number; end: number } | undefined
  >();
  const openWith = (text: string, index: number) => {
    setDraft(text);
    setCaret({ start: text.length, end: text.length });
    setFocused(index);
  };

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

  // What is on screen, for whoever needs to match something to a line before
  // the page has been saved.
  useEffect(() => {
    onBlocksChange?.(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

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

  // The same page, but a newer copy handed in from outside — a restore from
  // the history section below. Our own saves and live updates move
  // version.current first, so only a genuinely external change gets here.
  useEffect(() => {
    if (doc.version <= version.current) return;
    version.current = doc.version;
    base.current = doc.content;
    dirty.current = false;
    setTitle(doc.title);
    setBlocks(doc.content.length ? doc.content : [EMPTY]);
    live.current = { title: doc.title, blocks: doc.content };
    setFocused(null);
    setNote("Restored an earlier version.");
  }, [doc.version]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const openLine = (index: number) =>
    openWith(serializeBlock(blocks[index]), index);

  /**
   * Typing into the open line. A line break means Return was pressed: the
   * words before it stay here, the line is put away, and a new one opens
   * below — of the same kind for a list, plain otherwise. Code and maths
   * keep their line breaks, since those are part of the text.
   */
  const changeDraft = (text: string) => {
    // The first keystroke takes over from the placed caret.
    setCaret(undefined);
    if (focused === null) return setDraft(text);
    const kind = blocks[focused].type;
    const br = text.indexOf("\n");
    if (br < 0 || MULTILINE.has(kind)) return setDraft(text);
    const head = text.slice(0, br);
    const tail = text.slice(br + 1);
    const parsed = parseDoc(head);
    const current = parsed[0] ?? EMPTY;
    const next = blocks.slice();
    // Return on an empty list item leaves the list rather than adding one.
    if (
      LISTS.has(current.type) &&
      !("text" in current && current.text.trim())
    ) {
      next.splice(focused, 1, EMPTY);
      setDraft("");
      update(next);
      return;
    }
    const fresh: DocBlock = LISTS.has(current.type)
      ? blockToType(EMPTY, current.type)
      : EMPTY;
    next.splice(
      focused,
      1,
      ...carryBlockIds(blocks[focused], parsed.length ? parsed : [EMPTY]),
      fresh,
    );
    const at = focused + Math.max(parsed.length, 1);
    update(next);
    openWith(serializeBlock(fresh) + tail, at);
  };

  /** The open line as another kind of block, keeping its words. */
  const turnInto = (kind: (typeof BLOCK_KINDS)[number]) => {
    if (focused === null) return;
    const current = parseDoc(draft)[0] ?? EMPTY;
    const text = serializeBlock(blockToType(current, kind.type, kind.level));
    setDraft(text);
    setCaret({ start: text.length, end: text.length });
  };

  const moveLine = (by: -1 | 1) => {
    if (focused === null) return;
    const to = focused + by;
    if (to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    next[focused] = carryBlockIds(blocks[focused], [
      parseDoc(draft)[0] ?? EMPTY,
    ])[0];
    [next[focused], next[to]] = [next[to], next[focused]];
    update(next);
    setFocused(to);
  };

  /**
   * Remark on the open line. A line needs a name before anything can point
   * at it, so one is given here and saved with the page.
   */
  const commentOnLine = () => {
    if (focused === null) return;
    const parsed = parseDoc(draft)[0] ?? blocks[focused];
    const blockId = blocks[focused].id ?? newBlockId();
    const next = blocks.slice();
    next.splice(focused, 1, { ...parsed, id: blockId });
    setFocused(null);
    setBlocks(next);
    // Saved at once rather than on the usual delay: the remark about to be
    // written points at this name, and a name that is not saved is a remark
    // with nothing to hang on.
    if (timer.current) clearTimeout(timer.current);
    void persist(title, next);
    setPending({ blockId, quote: blockText(parsed).slice(0, 400) });
    setOpenThread(blockId);
  };

  const deleteLine = () => {
    if (focused === null) return;
    const next = blocks.slice();
    if (next.length > 1) next.splice(focused, 1);
    else next.splice(focused, 1, EMPTY);
    setFocused(null);
    update(next);
  };

  /**
   * Keep what has been typed without closing the line. Nothing is removed
   * here: an emptied line stays as a blank line until Done, Return or
   * Delete says otherwise.
   */
  const syncDraft = () => {
    if (focused === null) return;
    const parsed = parseDoc(draft);
    const next = blocks.slice();
    // Re-reading the Markdown makes fresh blocks that know nothing of what
    // pointed at the old line; its name goes back on the first of them.
    next.splice(
      focused,
      1,
      ...carryBlockIds(blocks[focused], parsed.length ? parsed : [EMPTY]),
    );
    if (parsed.length > 1) setFocused(focused + parsed.length - 1);
    update(next);
  };

  /** Put an edited line back. Several lines of text become several blocks. */
  const commit = () => {
    if (focused === null) return;
    let parsed = parseDoc(draft);
    // A bare "- " or "- [ ] " is an empty line that happens to have a
    // marker; putting it away should not leave a blank bullet on the page.
    if (parsed.length === 1 && "text" in parsed[0] && !parsed[0].text.trim())
      parsed = [];
    const next = blocks.slice();
    // An emptied line is removed, unless it is the only one left.
    if (!parsed.length) {
      if (next.length > 1) next.splice(focused, 1);
      else next.splice(focused, 1, EMPTY);
    } else next.splice(focused, 1, ...carryBlockIds(blocks[focused], parsed));
    setFocused(null);
    update(next);
  };

  const addLine = () => {
    const next = [...blocks, EMPTY];
    setBlocks(next);
    openWith("", next.length - 1);
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
        onDraftChange={changeDraft}
        onCommit={commit}
        onBlurLine={syncDraft}
        selection={caret}
        counts={comments.counts}
        onOpenComments={(blockId) =>
          setOpenThread((open) => (open === blockId ? null : blockId))
        }
        renderUnder={(blockId) => {
          const list = comments.anchored.get(blockId) ?? [];
          const waiting = pending?.blockId === blockId;
          if (openThread !== blockId && !waiting) return null;
          return (
            <DocThread
              comments={list}
              state={comments}
              userId={userId}
              quote={list[0]?.quote ?? pending?.quote}
              placeholder="Comment on this line…"
              autoFocus={waiting}
              anchor={{
                block_id: blockId,
                quote: list[0]?.quote ?? pending?.quote ?? "",
              }}
              // Stay open on the line just commented on, so the remark
              // that was written is there to read rather than folding away.
              onDone={() => {
                setPending(null);
                setOpenThread(blockId);
              }}
            />
          );
        }}
        onEditBlock={openLine}
        onToggleTodo={toggle}
      />

      {focused !== null ? (
        <View style={styles.tools}>
          <ChipRow label="Kind of line">
            {BLOCK_KINDS.map((kind) => {
              const key = kindKey(kind);
              const current = parseDoc(draft)[0] ?? EMPTY;
              const selected =
                (current.type === "heading"
                  ? `heading-${current.level}`
                  : current.type) === key;
              return (
                <Chip
                  key={key}
                  label={SHORT[key]}
                  selected={selected}
                  onPress={() => turnInto(kind)}
                  accessibilityLabel={kind.label}
                  accessibilityHint={kind.hint}
                />
              );
            })}
          </ChipRow>
          <View style={styles.toolRow}>
            <SmallAction
              label="Move up"
              disabled={focused === 0}
              onPress={() => moveLine(-1)}
            />
            <SmallAction
              label="Move down"
              disabled={focused >= blocks.length - 1}
              onPress={() => moveLine(1)}
            />
            <SmallAction
              label="Comment"
              disabled={false}
              onPress={commentOnLine}
            />
            <SmallAction
              label="Delete line"
              destructive
              disabled={false}
              onPress={deleteLine}
            />
            <View style={styles.spacer} />
            <SmallAction label="Done" disabled={false} onPress={commit} />
          </View>
        </View>
      ) : (
        <Pressable
          onPress={addLine}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        >
          <Text style={styles.addText}>+ Add a block</Text>
        </Pressable>
      )}

      <Text style={styles.hint}>
        Tap a line to edit it. Return starts a new line; on an empty list item
        it ends the list. The toolbar changes what a line is. Formulas read as
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
    tools: {
      gap: 8,
      padding: 10,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    toolRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    spacer: { flex: 1 },
    add: {
      minHeight: 36,
      justifyContent: "center",
      paddingHorizontal: 6,
      marginHorizontal: -6,
      borderRadius: radii.input,
    },
    addPressed: { backgroundColor: colors.surfaceMuted },
    addText: { color: colors.muted, fontSize: 14, fontFamily: fonts.semibold },
  }),
);

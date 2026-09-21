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
  modesFor,
  proposeEdit,
  MODE_LABELS,
  type Doc,
  type DocBlock,
  type DocMode,
  type DocAiAction,
  type DocSuggestion,
} from "@orbyn/core";
import { DocBody } from "./DocBody";
import { DocThread } from "./DocThread";
import { WordPicker } from "./WordPicker";
import { markRanges } from "./marks";
import { AskSheet } from "./AskSheet";
import { DocSuggestions } from "./DocSuggestions";
import type { DocCommentsState } from "./useDocComments";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
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
/** Where each page's chosen mode is remembered, between visits. */
const MODE_KEY = "orbyn-doc-mode:";

export function DocEditor({
  doc,
  comments,
  userId,
  onBlocksChange,
  onChanged,
  onItemsChanged,
  onDeleted,
  canWrite = true,
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
  /** Called once the page has been deleted, to leave the editor. */
  onDeleted?: () => void;
  /** False for a team page this reader may read but not change. */
  canWrite?: boolean;
  report: (e: unknown) => void;
}) {
  /**
   * A page opens the way it was last worked on, and always read-only for
   * someone who cannot change it: landing in an editor that will refuse the
   * first save is worse than not being offered one.
   */
  const [mode, setMode] = useState<DocMode>(() =>
    canWrite
      ? readLocal(MODE_KEY + doc.id) === "read"
        ? "read"
        : "edit"
      : "read",
  );
  const suggesting = mode === "suggest";
  /** Nothing typed changes the page itself in these modes. */
  const reading = mode === "read" || (!canWrite && !suggesting);
  const [suggestions, setSuggestions] = useState<DocSuggestion[]>([]);
  const [deciding, setDeciding] = useState(false);
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
    range_start?: number;
    range_end?: number;
  } | null>(null);
  /** Words chosen, waiting for what to ask the assistant for. */
  const [asking, setAsking] = useState<{
    blockId: string;
    start: number;
    end: number;
    quote: string;
  } | null>(null);
  /** A line whose words are being chosen, and the source to choose from. */
  const [picking, setPicking] = useState<{
    blockId: string;
    source: string;
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
  /**
   * Close the open line and make sure it has a saved name, so a remark
   * written next has something to hang on. Gives back the name and the line
   * as it now reads.
   */
  const settleLine = () => {
    if (focused === null) return null;
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
    return { blockId, source: blockText(parsed) };
  };

  const commentOnLine = () => {
    const line = settleLine();
    if (!line) return;
    setPending({ blockId: line.blockId, quote: line.source.slice(0, 400) });
    setOpenThread(line.blockId);
  };

  /** Comment on some of a line's words rather than all of it. */
  const commentOnWords = () => {
    const line = settleLine();
    if (!line) return;
    setPicking(line);
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
    // In suggesting mode nothing typed reaches the page; it becomes a
    // proposal when the line is put away.
    if (suggesting) return;
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

  /**
   * Turn what was typed into a proposed change.
   *
   * The line is compared with what the page still says, and the run that
   * differs becomes one proposal — which reads as "this became that" rather
   * than as a scatter of single characters.
   */
  const proposeLine = async () => {
    if (focused === null) return;
    const block = blocks[focused];
    setFocused(null);
    if (!block?.id) return;
    const change = proposeEdit(block.id, serializeBlock(block), draft);
    if (!change) return;
    try {
      const made = await client.proposeDocChanges(doc.id, [change]);
      setSuggestions((list) => [...list, ...made]);
      setNote("Suggested. It waits for someone to take it.");
    } catch (e) {
      report(e);
    }
  };

  /**
   * Ask the assistant for words in place of the chosen ones. What comes back
   * is a proposal like any other, so the page does not change until someone
   * takes it.
   */
  const assist = async (action: DocAiAction, instruction: string) => {
    const words = asking;
    if (!words) return;
    setAsking(null);
    setDeciding(true);
    try {
      const made = await client.assistDoc(doc.id, {
        block_id: words.blockId,
        range_start: words.start,
        range_end: words.end,
        action,
        instruction,
      });
      setSuggestions((list) => [...list, made]);
      setNote("Suggested. Take it or leave it.");
    } catch (e) {
      report(e);
    } finally {
      setDeciding(false);
    }
  };

  const loadSuggestions = useCallback(() => {
    client
      .listDocSuggestions(doc.id)
      .then(setSuggestions, () => setSuggestions([]));
  }, [doc.id]);

  useEffect(() => loadSuggestions(), [loadSuggestions]);

  /** Take a proposal into the page, or leave it. */
  const decide = (one: DocSuggestion, take: boolean) => {
    setDeciding(true);
    client
      .decideDocSuggestion(doc.id, one.id, take)
      .then(({ doc: saved }) => {
        if (saved) {
          version.current = saved.version;
          base.current = saved.content;
          setBlocks(saved.content);
          onChanged(saved);
        }
        loadSuggestions();
      })
      .catch(report)
      .finally(() => setDeciding(false));
  };

  const withdraw = (one: DocSuggestion) => {
    setDeciding(true);
    client
      .withdrawDocSuggestion(doc.id, one.id)
      .then(() => setSuggestions((list) => list.filter((x) => x.id !== one.id)))
      .catch(report)
      .finally(() => setDeciding(false));
  };

  /** Put an edited line back. Several lines of text become several blocks. */
  const commit = () => {
    if (focused === null) return;
    if (suggesting) return void proposeLine();
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

  /**
   * Turn the unticked checklist lines into real tasks. The server ties each
   * line to its task and hands the page back, so the lines follow them.
   */
  const makeTasks = () => {
    if (timer.current) clearTimeout(timer.current);
    void (async () => {
      try {
        if (dirty.current) await persist(title, blocks);
        const { created, doc: updated } = await client.docToTasks(doc.id);
        if (updated) {
          version.current = updated.version;
          base.current = updated.content;
          dirty.current = false;
          setBlocks(updated.content);
          onChanged(updated);
        }
        onItemsChanged?.();
        setNote(
          created === 0
            ? "Every item here is already a task."
            : `Added ${created} task${created === 1 ? "" : "s"} to your planner.`,
        );
      } catch (e) {
        report(e);
      }
    })();
  };

  const removePage = () =>
    confirmAction(
      `Delete “${title || "Untitled"}”?`,
      "This cannot be undone.",
      "Delete",
      () => {
        if (timer.current) clearTimeout(timer.current);
        client.deleteDoc(doc.id).then(() => onDeleted?.(), report);
      },
    );

  // Lines already tied to a task are not offered again.
  const openTodos = blocks.filter(
    (b) => b.type === "todo" && !b.done && !b.id && b.text.trim().length > 0,
  ).length;

  return (
    <View style={styles.page}>
      {reading ? (
        <Text style={styles.title} accessibilityRole="header">
          {title || "Untitled"}
        </Text>
      ) : (
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
      )}

      <DocSuggestions
        suggestions={suggestions}
        canDecide={canWrite}
        userId={userId}
        busy={deciding}
        onDecide={decide}
        onWithdraw={withdraw}
      />

      <View style={styles.statusRow}>
        {modesFor(canWrite).map((m) => (
          <SmallAction
            key={m}
            label={MODE_LABELS[m].name + (mode === m ? " ✓" : "")}
            disabled={mode === m}
            onPress={() => {
              // An open line would strand what was typed in it.
              setFocused(null);
              setMode(m);
              saveLocal(MODE_KEY + doc.id, m);
            }}
          />
        ))}
        <Text style={styles.meta}>
          {reading ? "" : saving ? "Saving…" : "Saved"}
        </Text>
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
        marks={markRanges(comments.anchored)}
        onOpenComments={(blockId) =>
          setOpenThread((open) => (open === blockId ? null : blockId))
        }
        renderUnder={(blockId) => {
          const list = comments.anchored.get(blockId) ?? [];
          const waiting = pending?.blockId === blockId;
          if (picking?.blockId === blockId)
            return (
              <WordPicker
                source={picking.source}
                onCancel={() => setPicking(null)}
                onAsk={(range) => {
                  setPicking(null);
                  setAsking({ blockId, ...range });
                }}
                onPick={(range) => {
                  setPicking(null);
                  setPending({
                    blockId,
                    quote: range.quote.slice(0, 400),
                    range_start: range.start,
                    range_end: range.end,
                  });
                  setOpenThread(blockId);
                }}
              />
            );
          if (asking?.blockId === blockId)
            return (
              <AskSheet
                quote={asking.quote}
                busy={deciding}
                onCancel={() => setAsking(null)}
                onAsk={(action, instruction) =>
                  void assist(action, instruction)
                }
              />
            );
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
                quote: pending?.quote ?? list[0]?.quote ?? "",
                range_start: pending?.range_start,
                range_end: pending?.range_end,
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
        onEditBlock={reading && !suggesting ? undefined : openLine}
        onToggleTodo={reading ? undefined : toggle}
      />

      {focused !== null && (!reading || suggesting) ? (
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
              label="Comment on words"
              disabled={!blockText(parseDoc(draft)[0] ?? EMPTY).trim()}
              onPress={commentOnWords}
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

      <View style={styles.pageActions}>
        {openTodos > 0 && (
          <SmallAction
            label={`Add ${openTodos} to my tasks`}
            disabled={false}
            onPress={makeTasks}
          />
        )}
        <SmallAction
          label="Delete page"
          destructive
          disabled={false}
          onPress={removePage}
        />
      </View>
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
    pageActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
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

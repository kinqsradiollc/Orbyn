import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { Icon, type IconName } from "../../components/Icon";
import { DocBody } from "./DocBody";
import { DocThread } from "./DocThread";
import { WordPicker } from "./WordPicker";
import { markRanges } from "./marks";
import { AskSheet } from "./AskSheet";
import { DocAsk } from "./DocAsk";
import { DocSuggestions } from "./DocSuggestions";
import type { DocCommentsState } from "./useDocComments";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { downloadDoc, downloadLabel, formatsHere } from "../../lib/download";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { DocViewers } from "./DocViewers";
import { PageFreshness } from "../../components/followthrough/PageFreshness";
import { confirmAction } from "../../lib/confirm";
import { controls, colors, fonts, radii, themed } from "../../theme";

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
      ? // The agenda is read more than written, so it opens for reading.
        (readLocal(MODE_KEY + doc.id) ??
          (doc.kind === "agenda" ? "read" : "edit")) === "read"
        ? "read"
        : "edit"
      : "read",
  );
  const suggesting = mode === "suggest";
  /**
   * Whether the page itself may change. A proposal is a stretch of one named
   * line, so a line added, taken away or moved cannot be proposed, and a
   * ticked box finishes a real task. While suggesting those all used to go
   * straight onto the page — the one thing suggesting is meant not to do.
   */
  const structural = !suggesting;
  /** Nothing typed changes the page itself in these modes. */
  const reading = mode === "read" || (!canWrite && !suggesting);
  const [suggestions, setSuggestions] = useState<DocSuggestion[]>([]);
  const [deciding, setDeciding] = useState(false);
  const [title, setTitle] = useState(doc.title);
  /** The lines tied to a task, as the server last said. */
  const linked = useMemo(
    () => new Set(doc.linked_block_ids ?? []),
    [doc.linked_block_ids],
  );
  const [blocks, setBlocks] = useState<DocBlock[]>(
    doc.content.length ? doc.content : [EMPTY],
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  /** Whether the shapes the page can be taken away in are showing. */
  const [formats, setFormats] = useState(false);
  /** Whether the conversation about this page is open. */
  const [talking, setTalking] = useState(false);
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
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const flushOnClose = useRef<() => void>(() => {});

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

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flushOnClose.current();
    };
  }, []);

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
    (nextTitle: string, nextBlocks: DocBlock[]) => {
      const write = async () => {
        setSaving(true);
        try {
          const saved = await client.updateDoc(doc.id, {
            title: nextTitle,
            content: nextBlocks,
            version: version.current,
          });
          version.current = saved.version;
          base.current = saved.content;
          dirty.current =
            live.current.title !== nextTitle ||
            live.current.blocks !== nextBlocks;
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
              dirty.current =
                live.current.title !== nextTitle ||
                live.current.blocks !== nextBlocks;
              onChanged(saved);
            } catch (again) {
              report(again);
            }
          } else report(e);
        } finally {
          setSaving(false);
        }
      };
      saveQueue.current = saveQueue.current.then(write, write);
      return saveQueue.current;
    },
    [doc.id, onChanged, reconcile, report],
  );

  flushOnClose.current = () => {
    if (!canWrite || suggesting) return;
    const next = live.current.blocks.slice();
    if (focused !== null && next[focused]) {
      const parsed = parseDoc(draft);
      next.splice(
        focused,
        1,
        ...carryBlockIds(next[focused], parsed.length ? parsed : [EMPTY]),
      );
    }
    if (dirty.current || JSON.stringify(next) !== JSON.stringify(base.current))
      void persist(live.current.title, next);
  };

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
      live.current = { title: nextTitle, blocks: nextBlocks };
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
    if (!structural) return;
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
  /**
   * Give any line a saved name, so a proposal made about it has something to
   * hang on. Saved at once for the same reason settleLine saves at once.
   */
  const nameBlockAt = (index: number): string => {
    const block = blocks[index];
    if (block.id) return block.id;
    const blockId = newBlockId();
    const next = blocks.slice();
    next[index] = { ...block, id: blockId };
    setBlocks(next);
    if (timer.current) clearTimeout(timer.current);
    void persist(title, next);
    return blockId;
  };

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
    if (!structural) return;
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

  // Save a paused edit while the keyboard stays open, not only after blur.
  useEffect(() => {
    if (focused === null || suggesting || reading) return;
    if (serializeBlock(blocks[focused] ?? EMPTY) === draft) return;
    const pending = setTimeout(syncDraft, 300);
    return () => clearTimeout(pending);
    // The draft is the source of this debounce; syncing blocks must not restart it.
  }, [draft, focused, suggesting, reading]);

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
    if (!structural) return;
    const next = [...blocks, EMPTY];
    setBlocks(next);
    openWith("", next.length - 1);
  };

  const toggle = (index: number) => {
    if (!structural) return;
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
        client.deleteDoc(doc.id).then(() => {
          flushOnClose.current = () => {};
          onDeleted?.();
        }, report);
      },
    );

  // Lines already tied to a task are not offered again. The server says
  // which: a line gets an id once it's remarked on, so an id alone doesn't
  // make it a task. An agenda's lines copy tasks you already have, so it
  // offers none.
  const openTodos =
    doc.kind === "agenda"
      ? 0
      : blocks.filter(
          (b) =>
            b.type === "todo" &&
            !b.done &&
            !(b.id && linked.has(b.id)) &&
            b.text.trim().length > 0,
        ).length;

  return (
    <View style={styles.page}>
      {reading ? (
        <Text style={styles.title} accessibilityRole="header">
          {title || "Untitled"}
        </Text>
      ) : (
        // A hidden text mirror supplies the full wrapping height. Native
        // multiline inputs can retain a one-line height after editing.
        <View style={styles.titleEditor}>
          <Text
            style={[styles.title, { opacity: 0 }]}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {(title || "Untitled") + "\u200b"}
          </Text>
          <TextInput
            style={[styles.title, StyleSheet.absoluteFill]}
            scrollEnabled={false}
            multiline
            textAlignVertical="top"
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
        </View>
      )}

      <DocSuggestions
        suggestions={suggestions}
        canDecide={canWrite}
        userId={userId}
        busy={deciding}
        onDecide={decide}
        onWithdraw={withdraw}
      />

      {/* The mode you are in is the filled chip, as it is on the desktop and
          as every other choice on the phone reads. It used to be the one
          greyed out, with a tick — which said "unavailable", not "here". */}
      {doc.kind === "doc" && <PageFreshness doc={doc} canWrite={canWrite} />}
      <View style={styles.statusRow}>
        <ChipRow label="How you're working on this page">
          {modesFor(canWrite).map((m) => (
            <Chip
              key={m}
              compact
              label={MODE_LABELS[m].name}
              selected={mode === m}
              accessibilityHint={MODE_LABELS[m].blurb}
              onPress={() => {
                // Commit the open line before changing what it is allowed to do.
                commit();
                setFocused(null);
                setMode(m);
                saveLocal(MODE_KEY + doc.id, m);
              }}
            />
          ))}
        </ChipRow>
        <DocViewers docId={doc.id} />
        <Text style={styles.meta}>
          {reading ? "" : saving ? "Saving…" : "Saved"}
        </Text>
      </View>

      {/* What a page can have done to it, as the icons the desktop's toolbar
          already uses. Three outlined text buttons stacked down the body read
          as a pile of unrelated offers; the same three on one row read as the
          page's own tools. Their own row, because a flex spacer only pushes
          on a row that has not wrapped. */}
      <View style={styles.pageTools}>
        <DocTool
          icon="sparkles"
          label="Talk about this page"
          on={talking}
          onPress={() => setTalking(true)}
        />
        <DocTool
          icon="share"
          label="Take this page away"
          on={formats}
          onPress={() => setFormats((v) => !v)}
        />
        <DocTool
          icon="trash"
          label="Delete this page"
          destructive
          onPress={removePage}
        />

        {!!note && (
          <Text style={styles.note} onPress={() => setNote("")}>
            {note}
          </Text>
        )}
      </View>

      <DocBody
        content={blocks}
        tasks={linked}
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
        onToggleTodo={reading || !structural ? undefined : toggle}
      />

      {focused !== null && (!reading || suggesting) ? (
        /* Eleven kinds of line wrapped over three rows and took 374pt of an
           812pt screen — half the phone, to say what one line is. They ride
           in one row that scrolls now, the way every phone editor does it,
           and the line's own actions ride in a second. */
        <View style={styles.tools}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolScroll}
          >
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
          </ScrollView>
          <View style={styles.toolBottom}>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.toolScroll}
            >
              <View style={styles.toolRow}>
                {structural && (
                  <>
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
                  </>
                )}
                <SmallAction
                  label="Comment"
                  disabled={false}
                  onPress={commentOnLine}
                />
                <SmallAction
                  label="On words"
                  disabled={!blockText(parseDoc(draft)[0] ?? EMPTY).trim()}
                  onPress={commentOnWords}
                />
                {structural && (
                  <SmallAction
                    label="Delete"
                    destructive
                    disabled={false}
                    onPress={deleteLine}
                  />
                )}
              </View>
            </ScrollView>
            {/* Out of the scroll, so the way out of the line is always
                where the thumb left it. */}
            <SmallAction label="Done" disabled={false} onPress={commit} />
          </View>
          {!structural && (
            <Text style={styles.hint}>
              While you are suggesting, a line’s words are yours to change.
              Moving and removing lines are the page’s to keep.
            </Text>
          )}
        </View>
      ) : (
        structural && (
          <Pressable
            onPress={addLine}
            accessibilityRole="button"
            style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
          >
            <Text style={styles.addText}>+ Add a block</Text>
          </Pressable>
        )
      )}

      {/* Four lines of instructions sat under every page, every time it was
          opened. It says the one thing that is not obvious, and only while
          there is a toolbar for it to be about. */}
      {focused !== null && structural && (
        <Text style={styles.hint}>
          Return starts a new line; on an empty list item it ends the list.
        </Text>
      )}

      {formats && (
        <View style={styles.pageActions}>
          {formatsHere().map((format) => (
            <SmallAction
              key={format}
              label={downloadLabel(format)}
              disabled={saving}
              onPress={() => void downloadDoc(doc.id, format).catch(report)}
            />
          ))}
        </View>
      )}

      {openTodos > 0 && (
        <View style={styles.pageActions}>
          <SmallAction
            label={`Add ${openTodos} to my tasks`}
            disabled={false}
            onPress={makeTasks}
          />
        </View>
      )}

      <DocAsk
        visible={talking}
        docId={doc.id}
        blocks={blocks}
        canWrite={canWrite || suggesting}
        onClose={() => setTalking(false)}
        onGoToBlock={(blockId) => setOpenThread(blockId)}
        onNameBlock={nameBlockAt}
        onSuggested={(made) => setSuggestions((list) => [...list, made])}
      />
    </View>
  );
}

/** One of a page's own tools: an icon, a thumb's worth of room, a name. */
function DocTool({
  icon,
  label,
  on = false,
  destructive = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  /** Whether what it opens is open. */
  on?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        on && styles.toolOn,
        pressed && styles.toolPressed,
      ]}
    >
      <Icon
        name={icon}
        size={17}
        color={destructive ? colors.danger : colors.muted}
      />
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    page: { gap: 16 },
    titleEditor: { minHeight: 44 },
    title: {
      color: colors.text,
      fontSize: 28,
      lineHeight: 36,
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
    toolRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    /* Rows that scroll rather than wrap, so the toolbar is two rows tall
       whatever a line can be turned into. */
    toolScroll: { paddingRight: 4 },
    toolBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
    toolFooter: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 2,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    spacer: { flex: 1 },
    pageActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
    },
    pageTools: {
      flexDirection: "row",
      justifyContent: "flex-start",
      flexWrap: "wrap",
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.input,
      gap: 4,
      marginTop: -2,
    },
    tool: {
      width: controls.tap,
      height: controls.tap,
      borderRadius: controls.tap / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    toolOn: { backgroundColor: colors.accentSoft },
    toolPressed: { backgroundColor: colors.surfaceMuted },
    danger: {
      flexDirection: "row",
      marginTop: 6,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    add: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 6,
      marginHorizontal: -6,
      borderRadius: radii.input,
    },
    addPressed: { backgroundColor: colors.surfaceMuted },
    addText: { color: colors.muted, fontSize: 14, fontFamily: fonts.semibold },
  }),
);

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  addedInlineTags,
  adoptTaskTicks,
  BLOCK_KINDS,
  blockDepth,
  blockText,
  blockToType,
  canRedo,
  canStyleLine,
  canUndo,
  carryBlockIds,
  carryNewIds,
  docStats,
  emptyUndo,
  EXPORT_LABELS,
  indentBlocks,
  keepStart,
  listLayout,
  pageFooter,
  pastedLines,
  recordUndo,
  redoStep,
  stylesAt,
  textToBlocks,
  toolbarLink,
  insertLink,
  linkMarkdown,
  linkQueryAt,
  type ObjectRef,
  toolbarStyle,
  undoStep,
  withDepth,
  wordsRange,
  newBlockId,
  mergeDocs,
  onlyTaskTicksMoved,
  parseDoc,
  serializeBlock,
  setTodoSource,
  ticksTakenFrom,
  proposeEdit,
  type Doc,
  type DocBlock,
  type DocMode,
  type DocAiAction,
  type DocSuggestion,
  type ExportFormat,
  type UndoStack,
} from "@orbyn/core";
import { DocBody } from "./DocBody";
import { DocThread } from "./DocThread";
import { WordPicker } from "./WordPicker";
import { markRanges } from "./marks";
import { AskSheet } from "./AskSheet";
import { DocAsk } from "./DocAsk";
import { DocSuggestions } from "./DocSuggestions";
import type { DocCommentsState } from "./useDocComments";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { downloadDoc, formatsHere } from "../../lib/download";
import { copyLink, shareLink, sharePageFile } from "../../lib/share";
import { setOpenDoc } from "../../lib/live";
import { SmallAction } from "../../components/SmallAction";
import { ActionSheet, type MoreAction } from "../../components/MoreMenu";
import { HeaderButton } from "../../components/Sheet";
import { SlotFill, type SlotHandle } from "../../components/Slot";
import type { DocNews } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { showToast } from "../../components/Toast";
import { tap } from "../../lib/haptics";
import { SaveTemplatePanel } from "./PageTemplates";
import { LineToolbar, kindKey, type LineKind } from "./LineToolbar";
import { PageInfo } from "./PageInfo";
import { LinkedHere, LinkPillProvider, useLinkPills } from "./links";
import { colors, fonts, radii, themed } from "../../theme";

/** Kinds that carry on when Return is pressed at the end of a line. */
const LISTS = new Set<DocBlock["type"]>(["bullet", "numbered", "todo"]);
/** Kinds whose text may hold line breaks of its own. */
const MULTILINE = new Set<DocBlock["type"]>(["code", "math"]);

/** How long to wait after typing stops before saving. */
const SAVE_AFTER_MS = 900;

const EMPTY: DocBlock = { type: "paragraph", text: "" };

/**
 * A line as it is typed: its Markdown, with the number it shows on the
 * page, so the third item of a list opens as "3. …" and not "1. …".
 */
const sourceOf = (list: DocBlock[], index: number): string =>
  serializeBlock(list[index] ?? EMPTY, listLayout(list)[index]?.number);

/**
 * Writing a document on the phone. A line is edited as the Markdown behind
 * it — "# " makes a heading, "- [ ] " a checkbox — which is the same thing
 * the desktop editor does, so a page written on either reads the same on the
 * other.
 */
/** Where each page's chosen mode is remembered, between visits. */
const MODE_KEY = "orbyn-doc-mode:";

/**
 * What to say when the only news is a task tied to a line being finished or
 * reopened: nothing when the page heard it came from the task itself (most
 * likely ticked beside the page), and no talk of anyone else otherwise.
 */
const taskNews = (by?: string) =>
  by === "task" ? "" : "A task on this page changed.";

export function DocEditor({
  doc,
  initialBlockId,
  onTargetOffset,
  comments,
  userId,
  onBlocksChange,
  onChanged,
  onItemsChanged,
  onDeleted,
  onUndoDelete,
  canWrite = true,
  headerSlot,
  toolbarSlot,
  onShowHistory,
  report,
}: {
  doc: Doc;
  /** A line to bring into view when the page opens (a source, a link). */
  initialBlockId?: string | null;
  /** Where that line sits, for the sheet to scroll to. */
  onTargetOffset?: (y: number) => void;
  /** The sheet's header, for the page's Info and ⋯ buttons. */
  headerSlot?: SlotHandle;
  /** The space over the keyboard, for the toolbar of the line being typed. */
  toolbarSlot?: SlotHandle;
  /** Open the page's history, below the page. */
  onShowHistory?: () => void;
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
  /** The page came back from Trash through the toast's Undo. */
  onUndoDelete?: (doc: Doc) => void;
  /** False for a team page this reader may read but not change. */
  canWrite?: boolean;
  report: (e: unknown) => void;
}) {
  // Opened: it leads the search's recent list, and ⌘K's on the web.
  useEffect(() => {
    void client.recordRecent("doc", doc.id).catch(() => {});
  }, [doc.id]);
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
  const bodyOffset = useRef<number | null>(null);
  const targetOffset = useRef<number | null>(null);
  const jumped = useRef(false);
  useEffect(() => {
    bodyOffset.current = null;
    targetOffset.current = null;
    jumped.current = false;
  }, [doc.id, initialBlockId]);
  const sendTarget = () => {
    if (
      jumped.current ||
      bodyOffset.current === null ||
      targetOffset.current === null
    )
      return;
    jumped.current = true;
    onTargetOffset?.(bodyOffset.current + targetOffset.current);
  };
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
  /** When the page was last saved, for the line at its end. */
  const [savedAt, setSavedAt] = useState(doc.updated_at);
  const [now, setNow] = useState(() => new Date());
  // "Saved 2 min ago" keeps up with the clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  /** Whether the conversation about this page is open. */
  const [talking, setTalking] = useState(false);
  /**
   * What someone else's edits just did to the page, shown under the title
   * as part of working together. Every other notice goes through the toast.
   */
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
    sel.current = { start: text.length, end: text.length };
    setSelection(sel.current);
    setFocused(index);
  };

  /** The page's tags, as the row under its title shows them. */
  const [tags, setTags] = useState(doc.tags ?? []);
  /**
   * The page as it stood when its #tags were last looked at. A #tag typed
   * since is added to the page when its line is put away; one that was
   * there already is not, so a tag taken off isn't put straight back.
   */
  const tagBase = useRef<DocBlock[]>(doc.content);
  /** Whether "Save as template" is open. */
  const [savingTemplate, setSavingTemplate] = useState(false);
  /** The page's Info, its ⋯ menu, and the two menus ⋯ leads to. */
  const [infoOpen, setInfoOpen] = useState(false);
  const [menu, setMenu] = useState<"page" | "share" | "export" | null>(null);
  /** Where the caret or selection is in the open line. */
  const sel = useRef({ start: 0, end: 0 });
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const lineInput = useRef<TextInput>(null);
  /**
   * Undo and Redo for the page (the keyboard's own undo only knows the line
   * being typed): the lines, which one is open, and what it holds.
   */
  type Snap = {
    title: string;
    blocks: DocBlock[];
    focused: number | null;
    draft: string;
  };
  const history = useRef<UndoStack<Snap>>(emptyUndo());
  const [, setHistoryShown] = useState(0);

  const version = useRef(doc.version);
  /**
   * The version the ticks on screen were taken from, sent with each save so
   * a tick already counted isn't counted again (see ticksTakenFrom). It
   * stays put while a tick made here is unsaved, even as other copies are
   * merged in.
   */
  const ticksFrom = useRef(doc.version);
  /** Whether an edit here is waiting to be saved. */
  const dirty = useRef(false);
  /** Which line is open, readable from the live subscription. */
  const focusedRef = useRef<number | null>(null);
  const base = useRef<DocBlock[]>(doc.content);
  const live = useRef({ title: doc.title, blocks: doc.content });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const flushOnClose = useRef<() => void>(() => {});

  /** The open line's Markdown, readable from callbacks made earlier. */
  const draftRef = useRef(draft);
  live.current = { title, blocks };
  focusedRef.current = focused;
  draftRef.current = draft;

  /**
   * What is on screen, with the open line as it's being typed: a tick typed
   * into its Markdown is on the page before the line is put back.
   */
  const onScreen = useCallback((): DocBlock[] => {
    const at = focusedRef.current;
    const shown = live.current.blocks;
    if (at === null || !shown[at]) return shown;
    const parsed = parseDoc(draftRef.current);
    const next = shown.slice();
    next.splice(
      at,
      1,
      ...carryBlockIds(shown[at], parsed.length ? parsed : [EMPTY]),
    );
    return next;
  }, []);

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
    ticksFrom.current = doc.version;
    base.current = doc.content;
    dirty.current = false;
    setFocused(null);
    setNote("");
    setTags(doc.tags ?? []);
    tagBase.current = doc.content;
    history.current = emptyUndo();
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the page is open, others see this phone is on it.
  useEffect(() => {
    setOpenDoc(doc.id);
    return () => setOpenDoc(null);
  }, [doc.id]);

  /** Add to the page the #tags typed into it since they were last looked at. */
  const settleTags = useRef<() => void>(() => {});
  /** Set once the page goes to Trash: there is nothing left to tag. */
  const gone = useRef(false);
  settleTags.current = () => {
    if (gone.current) return;
    const now = live.current.blocks;
    const added = addedInlineTags(tagBase.current, now);
    tagBase.current = now;
    if (!added.length || !canWrite) return;
    client
      .addDocTags(doc.id, added)
      .then(({ tags: next }) => setTags(next), report);
  };
  // Putting a line away (Done, Return, another line) is when a #tag typed
  // in it counts, not every keystroke on the way to "#physics".
  const lastFocused = useRef<number | null>(null);
  useEffect(() => {
    if (lastFocused.current !== null && lastFocused.current !== focused)
      settleTags.current();
    lastFocused.current = focused;
  }, [focused]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flushOnClose.current();
      settleTags.current();
    };
  }, []);

  // The same page, but a newer copy handed in from outside — a restore from
  // the history section below. Our own saves and live updates move
  // version.current first, so only a genuinely external change gets here.
  useEffect(() => {
    if (doc.version <= version.current) return;
    version.current = doc.version;
    ticksFrom.current = doc.version;
    base.current = doc.content;
    dirty.current = false;
    setTitle(doc.title);
    setBlocks(doc.content.length ? doc.content : [EMPTY]);
    live.current = { title: doc.title, blocks: doc.content };
    setFocused(null);
    history.current = emptyUndo();
    showToast({ text: "Restored an earlier version" });
  }, [doc.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // The note is news, not a state to sit in.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 6_000);
    return () => clearTimeout(t);
  }, [note]);

  /**
   * Fold a copy that was saved elsewhere into what is on screen. `by` is who
   * moved it on, when the live stream said.
   */
  const reconcile = useCallback(
    (theirs: Doc, by?: string): DocBlock[] => {
      const tasksOnly =
        theirs.title === live.current.title &&
        onlyTaskTicksMoved(base.current, theirs);
      const merge = mergeDocs(
        base.current,
        live.current.blocks,
        theirs.content,
      );
      const next = merge.blocks.length ? merge.blocks : [EMPTY];
      version.current = theirs.version;
      base.current = theirs.content;
      // Stepping back past someone else's edits would take them away.
      history.current = emptyUndo();
      setBlocks(next);
      setTitle(theirs.title);
      live.current = { title: theirs.title, blocks: next };
      // A tick kept from before the merge was made on the older copy, and
      // is still sent as one.
      ticksFrom.current = ticksTakenFrom(ticksFrom.current, theirs, onScreen());
      const news =
        merge.conflicts.length === 1
          ? "Someone else edited this. The line you changed is kept below theirs."
          : merge.conflicts.length > 1
            ? `Someone else edited this. The ${merge.conflicts.length} lines you changed are kept below theirs.`
            : tasksOnly
              ? taskNews(by)
              : "Updated with someone else's changes.";
      if (news) setNote(news);
      return next;
    },
    [onScreen],
  );

  /**
   * Take the ticks a save came back with for the lines tied to tasks. A
   * repeating task ticked here has moved on to its next occurrence and reads
   * unticked again; showing the old tick would send it back with the next
   * save. A line ticked or unticked again since keeps what was done here.
   * Whatever it took is saved straight away, so the page also says it to
   * anything that saves it without saying where its ticks came from.
   */
  const adoptTicks = useCallback((sent: DocBlock[], saved: Doc): boolean => {
    const { blocks: next, changed } = adoptTaskTicks(
      live.current.blocks,
      sent,
      saved,
    );
    if (!changed.length) return false;
    // The open line holds its own copy of its Markdown in the draft.
    const at = focusedRef.current;
    const open = at === null ? undefined : next[at];
    if (open?.type === "todo" && open.id && changed.includes(open.id)) {
      const done = open.done;
      draftRef.current = setTodoSource(draftRef.current, done);
      setDraft((d) => setTodoSource(d, done));
    }
    live.current = { ...live.current, blocks: next };
    setBlocks(next);
    return true;
  }, []);

  /** The latest `persist`, for a save that has to follow the one running. */
  const persistRef = useRef<
    (nextTitle: string, nextBlocks: DocBlock[]) => Promise<void>
  >(async () => {});
  /** Queue a save of what is on screen now, behind the one running. */
  const saveAgain = useCallback(() => {
    dirty.current = true;
    void persistRef.current(live.current.title, live.current.blocks);
  }, []);

  /**
   * A save came back: take its ticks, and note the version the ticks on
   * screen are now taken from. Anything that took a new tick is saved again,
   * after that, so the save says so.
   */
  const settle = useCallback(
    (sent: DocBlock[], saved: Doc) => {
      const took = adoptTicks(sent, saved);
      ticksFrom.current = ticksTakenFrom(ticksFrom.current, saved, onScreen());
      if (took) saveAgain();
    },
    [adoptTicks, saveAgain, onScreen],
  );

  const persist = useCallback(
    (nextTitle: string, nextBlocks: DocBlock[]) => {
      // The version these lines' ticks were taken from, as they are now. A
      // save queued behind one still running goes out after that one's
      // answer, but its ticks are still the ones from before it: the server
      // mustn't count them again.
      const from = ticksFrom.current;
      const write = async () => {
        setSaving(true);
        try {
          const saved = await client.updateDoc(
            doc.id,
            {
              title: nextTitle,
              content: nextBlocks,
              version: version.current,
            },
            { ticksFrom: from },
          );
          version.current = saved.version;
          base.current = saved.content;
          dirty.current =
            live.current.title !== nextTitle ||
            live.current.blocks !== nextBlocks;
          setSavedAt(saved.updated_at);
          setNow(new Date());
          settle(nextBlocks, saved);
          onChanged(saved);
        } catch (e) {
          // Someone saved first: take their copy, fold this edit into it and
          // save again rather than making the writer sort it out by hand.
          if ((e as { statusCode?: number }).statusCode === 409) {
            try {
              const merged = reconcile(await client.getDoc(doc.id));
              const mergedTitle = live.current.title;
              // Not theirs.version: a tick kept from before the merge was
              // made on the older copy (see reconcile).
              const saved = await client.updateDoc(
                doc.id,
                {
                  title: mergedTitle,
                  content: merged,
                  version: version.current,
                },
                { ticksFrom: ticksFrom.current },
              );
              version.current = saved.version;
              base.current = saved.content;
              dirty.current =
                live.current.title !== mergedTitle ||
                live.current.blocks !== merged;
              setSavedAt(saved.updated_at);
              settle(merged, saved);
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
    [doc.id, onChanged, reconcile, report, settle],
  );
  persistRef.current = persist;

  /**
   * The page with the open line's words in it, including any typed since
   * they were last put into the page (that happens after a short pause).
   */
  const pageWithDraft = (): DocBlock[] => {
    let next = live.current.blocks.slice();
    if (focused !== null && next[focused]) {
      const parsed = parseDoc(draft);
      next.splice(
        focused,
        1,
        ...carryBlockIds(next[focused], parsed.length ? parsed : [EMPTY]),
      );
      next = keepStart(next, focused);
    }
    return next;
  };
  const unsaved = (next: DocBlock[]) =>
    dirty.current || JSON.stringify(next) !== JSON.stringify(base.current);

  flushOnClose.current = () => {
    if (!canWrite || suggesting) return;
    const next = pageWithDraft();
    if (unsaved(next)) void persist(live.current.title, next);
  };

  /**
   * The subscription must outlive re-renders: it depends on the document,
   * not on callbacks that are rebuilt each time the page is typed into.
   * Without this the stream was torn down and reopened on every render,
   * which on a phone is a request storm rather than a nuisance.
   */
  const onEvent = useRef<(version: number, news: DocNews) => void>(() => {});
  onEvent.current = (
    remote: number,
    { trashed, tags: retagged, by }: DocNews,
  ) => {
    // Moved to Trash somewhere else: let the page go, rather than keep
    // typing into something every save will now refuse.
    if (trashed) {
      if (timer.current) clearTimeout(timer.current);
      dirty.current = false;
      flushOnClose.current = () => {};
      gone.current = true;
      onDeleted?.();
      showToast({
        text: `“${live.current.title || "Untitled"}” was moved to Trash. It can be restored from there.`,
      });
      return;
    }
    // Someone changed the page's tags: the row follows, the words stay.
    if (retagged) {
      void client
        .getDoc(doc.id)
        .then((theirs) => setTags(theirs.tags ?? []), report);
      return;
    }
    if (remote && remote <= version.current) return;
    void client.getDoc(doc.id).then((theirs) => {
      if (theirs.version <= version.current) return;
      // A line open for editing counts as ours even before a keystroke.
      if (!dirty.current && focusedRef.current === null) {
        const news =
          theirs.title === live.current.title &&
          onlyTaskTicksMoved(base.current, theirs)
            ? taskNews(by)
            : "Updated with someone else's changes.";
        version.current = theirs.version;
        ticksFrom.current = theirs.version;
        base.current = theirs.content;
        tagBase.current = theirs.content;
        setTags(theirs.tags ?? []);
        setTitle(theirs.title);
        setBlocks(theirs.content.length ? theirs.content : [EMPTY]);
        live.current = { title: theirs.title, blocks: theirs.content };
        history.current = emptyUndo();
        if (news) setNote(news);
        onChanged(theirs);
        return;
      }
      const merged = reconcile(theirs, by);
      if (dirty.current) void persist(live.current.title, merged);
      else onChanged(theirs);
    }, report);
  };

  /**
   * Follow the document while it is open, so a page being written on a
   * desktop at the same time does not go stale in your hand.
   */
  useEffect(
    () => client.watchDoc(doc.id, (v, news) => onEvent.current(v, news)),
    [doc.id],
  );

  const queueSave = useCallback(
    (nextTitle: string, nextBlocks: DocBlock[]) => {
      dirty.current = true;
      live.current = { title: nextTitle, blocks: nextBlocks };
      if (timer.current) clearTimeout(timer.current);
      // What is on screen when the clock runs out, not when it started: a
      // save or a merge that landed meanwhile may have changed it.
      timer.current = setTimeout(
        () => void persist(live.current.title, live.current.blocks),
        SAVE_AFTER_MS,
      );
    },
    [persist],
  );

  const update = (next: DocBlock[]) => {
    setBlocks(next);
    queueSave(title, next);
  };

  /**
   * Keep the page as it stands, before a change, for Undo. Typing (`kind`
   * "type") joins the step before it until a pause.
   */
  const remember = (kind?: string) => {
    history.current = recordUndo(
      history.current,
      { title, blocks, focused, draft },
      { kind, now: Date.now() },
    );
    setHistoryShown((n) => n + 1);
  };

  /** Show a state Undo or Redo came back to, and save it. */
  const restore = (to: Snap) => {
    const next = to.blocks.length ? to.blocks : [EMPTY];
    if (next !== blocks || to.title !== title) {
      setBlocks(next);
      setTitle(to.title);
      if (structural && canWrite) queueSave(to.title, next);
    }
    if (to.focused !== null && next[to.focused]) {
      setDraft(to.draft);
      setCaret({ start: to.draft.length, end: to.draft.length });
      sel.current = { start: to.draft.length, end: to.draft.length };
      setSelection(sel.current);
      setFocused(to.focused);
    } else setFocused(null);
    setHistoryShown((n) => n + 1);
  };
  const undo = () => {
    const step = undoStep(history.current, { title, blocks, focused, draft });
    if (!step) return;
    history.current = step.stack;
    restore(step.state);
  };
  const redo = () => {
    const step = redoStep(history.current, { title, blocks, focused, draft });
    if (!step) return;
    history.current = step.stack;
    restore(step.state);
  };

  /** Hand the keyboard back to the open line after a toolbar button. */
  const refocus = () => requestAnimationFrame(() => lineInput.current?.focus());

  /** The caret or selection moved in the open line. */
  const onSelect = (range: { start: number; end: number }) => {
    sel.current = range;
    setSelection(range);
    // Placed by the app a moment ago and moved since: the person's wins.
    if (caret && (caret.start !== range.start || caret.end !== range.end))
      setCaret(undefined);
  };

  /** A toolbar change to the open line, with the words it acted on chosen. */
  const applyEdit = (next: { text: string; start: number; end: number }) => {
    remember();
    setDraft(next.text);
    setCaret({ start: next.start, end: next.end });
    sel.current = { start: next.start, end: next.end };
    setSelection(sel.current);
    refocus();
  };

  /** Bold, Italic or Highlight on the chosen words, or off them. */
  const styleLine = (style: "bold" | "italic" | "highlight") => {
    const next = toolbarStyle(draft, sel.current.start, sel.current.end, style);
    if (!next) {
      showToast({ text: "Those words already have another style." });
      return refocus();
    }
    applyEdit(next);
  };

  /** Link the chosen words, or put the address in as a link. */
  const linkLine = (url: string): boolean => {
    const next = toolbarLink(draft, sel.current.start, sel.current.end, url);
    if (!next) return false;
    applyEdit(next);
    return true;
  };

  /**
   * "[[" typed before the caret in the open line: the picker searches the
   * words after it, and picking replaces them with the link.
   */
  const openKind = focused !== null ? blocks[focused]?.type : undefined;
  const bracket =
    focused !== null && openKind !== "code" && openKind !== "math"
      ? linkQueryAt(draft, selection.start)
      : null;

  /**
   * Put a link in the open line: where "[[words" was typed, or at the caret
   * (over the chosen words) from the toolbar's Link.
   */
  const insertPicked = (ref: ObjectRef, name: string) => {
    const { start, end } = sel.current;
    const next = bracket
      ? insertLink(draft, bracket.start, start, ref, name)
      : (() => {
          const link = linkMarkdown(ref, name);
          const rest = draft.slice(end);
          const space = rest.startsWith(" ") || !rest ? "" : " ";
          const text = draft.slice(0, start) + link + space + rest;
          return { text, caret: start + link.length + space.length };
        })();
    applyEdit({ text: next.text, start: next.caret, end: next.caret });
  };

  /** "Create page X" / "Create task X": made first, then linked. */
  const createAndLink = async (kind: "doc" | "task", name: string) => {
    try {
      if (kind === "doc") {
        const made = await client.createDoc({
          title: name,
          team_id: doc.team_id,
          project_id: doc.project_id,
        });
        insertPicked({ kind: "doc", id: made.id }, made.title);
      } else {
        const made = await client.createItem({
          title: name,
          ...(doc.team_id ? { team_id: doc.team_id } : {}),
          ...(doc.project_id ? { project_id: doc.project_id } : {}),
        });
        insertPicked({ kind: "task", id: made.id }, made.title);
        onItemsChanged?.();
      }
    } catch (e) {
      report(e);
    }
  };

  /** Live titles, ticks and deletions for the page's links. */
  const { pills, reload: reloadPills } = useLinkPills(blocks, report);
  const pillActions = useMemo(
    () => ({
      pills,
      onToggle: (id: string, done: boolean) =>
        void client
          .postItemUpdate(id, { status: done ? "done" : "todo" })
          .then(() => {
            reloadPills();
            onItemsChanged?.();
          }, report),
      onRestore: (id: string) =>
        void client.restoreDoc(id).then(() => reloadPills(), report),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pills],
  );
  /** How many places link to this page, for the line at its end. */
  const [linkedCount, setLinkedCount] = useState(0);

  /** Open a line for editing, showing the Markdown behind it. */
  const openLine = (index: number) => openWith(sourceOf(blocks, index), index);

  /**
   * Typing into the open line. A line break means Return was pressed: the
   * words before it stay here, the line is put away, and a new one opens
   * below — of the same kind for a list, plain otherwise. Code and maths
   * keep their line breaks, since those are part of the text.
   */
  const changeDraft = (text: string) => {
    // Return and a paste are steps of their own; typing runs together.
    remember(text.includes("\n") ? undefined : "type");
    // The first keystroke takes over from the placed caret.
    setCaret(undefined);
    if (focused === null) return setDraft(text);
    const kind = blocks[focused].type;
    const br = text.indexOf("\n");
    if (br < 0 || MULTILINE.has(kind)) return setDraft(text);
    // Lines arriving at once are a paste: each becomes a line of its own,
    // Markdown read as Markdown, rather than all but the first being left
    // in the line being typed. What changed is what tells them apart from
    // Return (see pastedLines), not how much longer the line got.
    if (pastedLines(draft, text) && structural) {
      const read = textToBlocks(text);
      const pasted = carryBlockIds(
        blocks[focused],
        read.length ? read : [EMPTY],
      );
      const next = blocks.slice();
      next.splice(focused, 1, ...pasted);
      const at = focused + pasted.length - 1;
      update(next);
      openWith(sourceOf(next, at), at);
      return;
    }
    const head = text.slice(0, br);
    const tail = text.slice(br + 1);
    const parsed = parseDoc(head);
    const current = parsed[0] ?? EMPTY;
    const next = blocks.slice();
    // Return on an empty list item steps it back out a level; at the left
    // edge it leaves the list rather than adding another item.
    if (
      LISTS.has(current.type) &&
      !("text" in current && current.text.trim())
    ) {
      if (blockDepth(blocks[focused]) > 0) {
        const out = indentBlocks(blocks, focused, -1);
        update(out);
        openWith(
          serializeBlock(current, listLayout(out)[focused]?.number),
          focused,
        );
        return;
      }
      next.splice(focused, 1, EMPTY);
      setDraft("");
      update(next);
      return;
    }
    const kept = carryBlockIds(
      blocks[focused],
      parsed.length ? parsed : [EMPTY],
    );
    // A new item goes in at the depth of the one Return was pressed on.
    const fresh: DocBlock = LISTS.has(current.type)
      ? withDepth(blockToType(EMPTY, current.type), blockDepth(kept[0]))
      : EMPTY;
    next.splice(focused, 1, ...kept, fresh);
    const at = focused + Math.max(parsed.length, 1);
    const placed = keepStart(next, focused);
    update(placed);
    // The new item opens with the number it will show.
    openWith(sourceOf(placed, at) + tail, at);
  };

  /** The open line as another kind of block, keeping its words. */
  const turnInto = (kind: (typeof BLOCK_KINDS)[number]) => {
    if (focused === null) return;
    remember();
    const current = parseDoc(draft)[0] ?? EMPTY;
    const text = serializeBlock(blockToType(current, kind.type, kind.level));
    setDraft(text);
    setCaret({ start: text.length, end: text.length });
    sel.current = { start: text.length, end: text.length };
    setSelection(sel.current);
    refocus();
  };

  /** The open line as it would stand with what has been typed into it. */
  const withDraft = (): DocBlock[] => {
    if (focused === null) return blocks;
    const next = blocks.slice();
    next[focused] = carryBlockIds(blocks[focused], [
      parseDoc(draft)[0] ?? EMPTY,
    ])[0];
    return keepStart(next, focused);
  };

  /**
   * Tuck the open list line in under the one above, or bring it out, with
   * the lines under it. It stays open, so typing carries on.
   */
  const indentLine = (by: 1 | -1) => {
    if (focused === null || !structural) return;
    const current = withDraft();
    const next = indentBlocks(current, focused, by);
    if (next === current) return;
    remember();
    update(next);
    refocus();
  };

  const moveLine = (by: -1 | 1) => {
    if (focused === null) return;
    if (!structural) return;
    const to = focused + by;
    if (to < 0 || to >= blocks.length) return;
    remember();
    const next = withDraft().slice();
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
    const placed = keepStart(next, focused);
    setFocused(null);
    setBlocks(placed);
    // Saved at once rather than on the usual delay: the remark about to be
    // written points at this name, and a name that is not saved is a remark
    // with nothing to hang on.
    if (timer.current) clearTimeout(timer.current);
    void persist(title, placed);
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
    remember();
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
    update(keepStart(next, focused));
  };

  // Save a paused edit while the keyboard stays open, not only after blur.
  useEffect(() => {
    if (focused === null || suggesting || reading) return;
    if (sourceOf(blocks, focused) === draft) return;
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
    // Compared with the line as it was shown for typing, number and all.
    const change = proposeEdit(block.id, sourceOf(blocks, focused), draft);
    if (!change) return;
    try {
      const made = await client.proposeDocChanges(doc.id, [change]);
      setSuggestions((list) => [...list, ...made]);
      showToast({ text: "Suggested. It waits for someone to take it." });
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
      showToast({ text: "Suggested. Take it or leave it." });
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
          ticksFrom.current = saved.version;
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
    remember();
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
    update(parsed.length ? keepStart(next, focused) : next);
  };

  const addLine = () => {
    if (!structural) return;
    remember();
    const next = [...blocks, EMPTY];
    setBlocks(next);
    openWith("", next.length - 1);
  };

  const toggle = (index: number) => {
    if (!structural) return;
    const line = blocks[index];
    if (line?.type === "todo" && !line.done) tap();
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
  const makeTasks = (only?: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    void (async () => {
      try {
        if (dirty.current) await persist(title, live.current.blocks);
        // A line just put away is still saving: the server needs its name.
        await saveQueue.current;
        // What the server works from; anything typed after this is newer.
        const sent = live.current.blocks;
        const { created, doc: updated } = await client.docToTasks(doc.id, only);
        if (updated && updated.version > version.current) {
          version.current = updated.version;
          ticksFrom.current = updated.version;
          base.current = updated.content;
          onChanged(updated);
          if (!dirty.current && live.current.blocks === sent)
            setBlocks(updated.content);
          else {
            // Typed into meanwhile: what is on screen stands, with the
            // names the server gave the lines it made tasks of.
            const now = live.current.blocks;
            const next = carryNewIds(sent, updated.content, now);
            if (next !== now) setBlocks(next);
            queueSave(live.current.title, next);
          }
        }
        onItemsChanged?.();
        showToast({
          text: only
            ? created === 0
              ? "That line is already a task."
              : "Added it to your tasks."
            : created === 0
              ? "Every item here is already a task."
              : `Added ${created} task${created === 1 ? "" : "s"} to your planner.`,
        });
      } catch (e) {
        report(e);
      }
    })();
  };

  /**
   * The toolbar's To-do: a line becomes a to-do; a to-do with words becomes
   * a task of its own (the line is put away and tied to it).
   */
  const todoLine = () => {
    if (focused === null) return;
    const current = parseDoc(draft)[0] ?? EMPTY;
    if (current.type !== "todo")
      return turnInto(BLOCK_KINDS.find((k) => k.type === "todo")!);
    const saved = blocks[focused];
    if (!structural || !blockText(current).trim()) return;
    if (saved?.type === "todo" && saved.id) return;
    const line = settleLine();
    if (!line) return;
    Keyboard.dismiss();
    makeTasks([line.blockId]);
  };

  /**
   * Ask the assistant about the chosen words (the whole line with nothing
   * chosen). The line is put away first, as a remark's is: what comes back
   * is a proposal about the words as they are saved.
   */
  const askLine = () => {
    if (focused === null) return;
    const whole = !canStyleLine(draft);
    const range = whole
      ? null
      : wordsRange(draft, sel.current.start, sel.current.end);
    const line = settleLine();
    if (!line) return;
    const start = Math.min(range?.start ?? 0, line.source.length);
    const end = Math.min(range?.end ?? line.source.length, line.source.length);
    if (end <= start) return;
    Keyboard.dismiss();
    setAsking({
      blockId: line.blockId,
      start,
      end,
      quote: line.source.slice(start, end),
    });
  };

  /** Hide keyboard: the line is put away with it. */
  const hideKeyboard = () => {
    commit();
    Keyboard.dismiss();
  };

  /** Change how the page is being worked on (Info). */
  const chooseMode = (m: DocMode) => {
    // Commit the open line before changing what it is allowed to do.
    commit();
    setFocused(null);
    setMode(m);
    saveLocal(MODE_KEY + doc.id, m);
  };

  /**
   * Delete the page: it moves to Trash for 30 days, and a toast offers Undo,
   * so nothing asks first.
   */
  const removePage = () => {
    if (timer.current) clearTimeout(timer.current);
    // What was just typed goes with it — the open line's words too, even
    // those not yet put into the page — so Undo brings all of it back.
    const last = canWrite && !suggesting ? pageWithDraft() : null;
    void (async () => {
      try {
        if (last && unsaved(last)) await persist(live.current.title, last);
        await client.deleteDoc(doc.id);
      } catch (e) {
        report(e);
        return;
      }
      flushOnClose.current = () => {};
      gone.current = true;
      onDeleted?.();
      showToast({
        text: `Moved “${title || "Untitled"}” to Trash`,
        action: {
          label: "Undo",
          run: () =>
            void client.restoreDoc(doc.id).then((back) => {
              if (onUndoDelete) onUndoDelete(back);
              else showToast({ text: `“${back.title || "Untitled"}” is back` });
            }, report),
        },
      });
    })();
  };

  // Whether the open line can be tucked under the line above it.
  const openBlocks = focused !== null ? withDraft() : blocks;
  const canIndent =
    focused !== null && indentBlocks(openBlocks, focused, 1) !== openBlocks;

  // Lines already tied to a task are not offered again.
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

  /** The line being typed, as the keyboard toolbar shows it. */
  const current = focused !== null ? (parseDoc(draft)[0] ?? EMPTY) : null;
  const saved = focused !== null ? blocks[focused] : undefined;
  const toolbar =
    focused !== null && current && (!reading || suggesting) ? (
      <LineToolbar
        suggesting={!structural}
        line={{
          kind: kindKey(
            current.type === "heading"
              ? { type: "heading", level: current.level }
              : { type: current.type },
          ),
          styles: stylesAt(draft, selection.start, selection.end),
          styleable: canStyleLine(draft),
          canUndo: canUndo(history.current),
          canRedo: canRedo(history.current),
          structural,
          canIndent: structural && canIndent,
          canOutdent: structural && blockDepth(openBlocks[focused]) > 0,
          isTask: saved?.type === "todo" && !!saved.id,
          hasWords: !!blockText(current).trim(),
          canMoveUp: focused > 0,
          canMoveDown: focused < blocks.length - 1,
        }}
        onUndo={undo}
        onRedo={redo}
        onKind={(kind: LineKind) => turnInto(kind)}
        onStyle={styleLine}
        onLink={linkLine}
        linkQuery={bracket ? bracket.query : null}
        projectName={doc.project_name}
        onPickLink={insertPicked}
        onCreateLink={(kind, name) => void createAndLink(kind, name)}
        report={report}
        onTodo={todoLine}
        onIndent={indentLine}
        onComment={commentOnLine}
        onAsk={askLine}
        onMove={moveLine}
        onCommentWords={commentOnWords}
        onDelete={deleteLine}
        onHide={hideKeyboard}
      />
    ) : null;

  /** The page's ⋯: Ask, Copy link, Share, Export, History, template and Trash. */
  const pageActions: MoreAction[] = [
    { label: "Ask about this page", onPress: () => setTalking(true) },
    {
      label: "Copy link",
      onPress: () =>
        void copyLink({ kind: "doc", id: doc.id }, title || "Untitled").catch(
          report,
        ),
    },
    { label: "Share…", onPress: () => setMenu("share") },
    { label: "Export…", onPress: () => setMenu("export") },
    { label: "History", onPress: () => onShowHistory?.() },
    { label: "Save as template", onPress: () => setSavingTemplate(true) },
    ...(canWrite
      ? [{ label: "Move to Trash", destructive: true, onPress: removePage }]
      : []),
  ];
  const shareActions: MoreAction[] = [
    {
      label: "Link",
      onPress: () =>
        void shareLink({ kind: "doc", id: doc.id }, title || "Untitled").catch(
          report,
        ),
    },
    {
      label: "Markdown file",
      onPress: () => void sharePageFile(doc.id, "md").catch(report),
    },
    {
      label: "PDF file",
      onPress: () => void sharePageFile(doc.id, "pdf").catch(report),
    },
  ];
  const exportActions: MoreAction[] = formatsHere().map(
    (format: ExportFormat) => ({
      label: EXPORT_LABELS[format].name,
      onPress: () => void downloadDoc(doc.id, format).catch(report),
    }),
  );
  const facts = pageFooter({
    ...docStats(blocks),
    savedAt,
    saving,
    now,
    linked: linkedCount,
  });

  return (
    <View style={styles.page}>
      {/* The page's header holds only Back, its title, Info and ⋯. */}
      {headerSlot && (
        <SlotFill slot={headerSlot}>
          <HeaderButton
            icon="info"
            label="Info"
            on={infoOpen}
            onPress={() => setInfoOpen(true)}
          />
          <HeaderButton
            icon="more"
            label="Page options"
            on={menu !== null}
            onPress={() => setMenu("page")}
          />
        </SlotFill>
      )}
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
              remember("title");
              setTitle(text);
              queueSave(text, blocks);
            }}
          />
        </View>
      )}

      {/* The page's tags, quietly under its title; Info changes them. */}
      {tags.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tags: ${tags.map((t) => t.name).join(", ")}. Open Info to change them.`}
          onPress={() => setInfoOpen(true)}
          style={styles.tags}
        >
          {tags.map((t) => (
            <View key={t.id} style={styles.tag}>
              <View style={[styles.tagDot, { backgroundColor: t.color }]} />
              <Text style={styles.tagText} numberOfLines={1}>
                {t.name}
              </Text>
            </View>
          ))}
        </Pressable>
      )}

      {!!note && (
        <Text style={styles.note} onPress={() => setNote("")}>
          {note}
        </Text>
      )}

      <DocSuggestions
        suggestions={suggestions}
        canDecide={canWrite}
        userId={userId}
        busy={deciding}
        onDecide={decide}
        onWithdraw={withdraw}
      />

      {savingTemplate && (
        <SaveTemplatePanel
          doc={doc}
          canShare={canWrite}
          onClose={() => setSavingTemplate(false)}
          onSaved={(t) =>
            showToast({
              text: `Saved “${t.name}” as a template. Start a page from it with From template.`,
            })
          }
        />
      )}

      <View
        onLayout={(event) => {
          bodyOffset.current = event.nativeEvent.layout.y;
          sendTarget();
        }}
      >
        <LinkPillProvider value={pillActions}>
          <DocBody
            content={blocks}
            targetBlockId={initialBlockId}
            onTargetLayout={(y) => {
              targetOffset.current = y;
              sendTarget();
            }}
            tasks={linked}
            editing={focused}
            draft={draft}
            onDraftChange={changeDraft}
            onCommit={commit}
            onBlurLine={syncDraft}
            selection={caret}
            onSelectionChange={onSelect}
            inputRef={lineInput}
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
        </LinkPillProvider>
      </View>

      {/* The toolbar rides on the keyboard (the sheet docks it there); a
          page shown anywhere else keeps it under the line. */}
      {toolbar &&
        (toolbarSlot ? (
          <SlotFill slot={toolbarSlot}>{toolbar}</SlotFill>
        ) : (
          toolbar
        ))}
      {focused === null && structural && (
        <Pressable
          onPress={addLine}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        >
          <Text style={styles.addText}>+ Add a block</Text>
        </Pressable>
      )}

      {/* Four lines of instructions sat under every page, every time it was
          opened. It says the one thing that is not obvious, and only while
          there is a toolbar for it to be about. */}
      {focused !== null && structural && (
        <Text style={styles.hint}>
          Return starts a new line; on an empty list item it ends the list.
        </Text>
      )}

      {/* One quiet line at the end of the page. */}
      <Text style={styles.footer}>{facts}</Text>
      <LinkedHere
        kind="doc"
        id={doc.id}
        onCount={setLinkedCount}
        report={report}
      />

      {openTodos > 0 && (
        <View style={styles.pageActions}>
          <SmallAction
            label={`Add ${openTodos} to my tasks`}
            disabled={false}
            onPress={() => makeTasks()}
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
      <PageInfo
        visible={infoOpen}
        doc={doc}
        tags={tags}
        mode={mode}
        canWrite={canWrite}
        reading={reading}
        facts={facts}
        onMode={chooseMode}
        onTags={setTags}
        onShowHistory={() => {
          setInfoOpen(false);
          onShowHistory?.();
        }}
        onClose={() => setInfoOpen(false)}
        report={report}
      />
      <ActionSheet
        visible={menu === "page"}
        label="Page options"
        title={title || "Untitled"}
        actions={pageActions}
        onClose={() => setMenu((m) => (m === "page" ? null : m))}
      />
      <ActionSheet
        visible={menu === "share"}
        label="Share this page"
        title="Share as"
        actions={shareActions}
        onClose={() => setMenu((m) => (m === "share" ? null : m))}
      />
      <ActionSheet
        visible={menu === "export"}
        label="Export this page"
        title="Export as"
        actions={exportActions}
        onClose={() => setMenu((m) => (m === "export" ? null : m))}
      />
    </View>
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
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: -6,
    },
    tag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      maxWidth: 180,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    tagDot: { width: 7, height: 7, borderRadius: 4 },
    tagText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.textSoft,
    },
    note: {
      alignSelf: "flex-start",
      color: colors.muted,
      backgroundColor: colors.soft,
      fontSize: 12,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radii.pill,
      overflow: "hidden",
    },
    hint: { color: colors.faint, fontSize: 12, lineHeight: 18 },
    footer: {
      color: colors.muted,
      fontSize: 11,
      lineHeight: 16,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      fontVariant: ["tabular-nums"],
    },
    pageActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4,
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

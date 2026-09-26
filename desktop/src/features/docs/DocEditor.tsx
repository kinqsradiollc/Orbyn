import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Bold,
  Check,
  Copy,
  Download,
  GripVertical,
  Highlighter,
  History,
  Italic,
  LayoutTemplate,
  Link,
  ListChecks,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  addedInlineTags,
  BLOCK_KINDS,
  blockDepth,
  blockToType,
  blockText,
  countWords,
  diffLine,
  docStats,
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  EXPORT_FORMATS,
  EXPORT_LABELS,
  htmlToBlocks,
  indentBlocks,
  isListBlock,
  isUrl,
  keepStart,
  linkRange,
  linkShortcut,
  listLayout,
  pageFooter,
  plainText,
  proposeEdit,
  restoreLine,
  styleRange,
  textToBlocks,
  withDepth,
  type DocAiAction,
  type ExportFormat,
  type DocMode,
  type DocSuggestion,
  type InlineStyle,
  type Restyled,
  carryBlockIds,
  mergeDocs,
  carryNewIds,
  newBlockId,
  parseDoc,
  serializeBlock,
  serializeDoc,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import type { CSSProperties } from "react";
import { useToast } from "../../components/Toast";
import { SharePageButton } from "../../components/ShareButton";
import type { DocNews } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { DocModeSwitch } from "./DocModeSwitch";
import { DocViewers } from "./DocViewers";
import { PageFreshness } from "./PageFreshness";
import { DocChat } from "./DocChat";
import { DocSuggestions } from "./DocSuggestions";
import type { Mark } from "./marks";
import { readSelection, type Picked } from "./selection";
import { BlockView } from "./DocBlocks";
import {
  DocBlockMenu,
  SlashMenu,
  todayText,
  type SlashItem,
} from "./DocBlockMenu";
import { DocComments } from "./DocComments";
import { DocChanges, DocHistory, type HistoryView } from "./DocHistory";
import { PageTags } from "./PageTags";
import { SaveTemplateDialog } from "./PageTemplates";

type Kind = (typeof BLOCK_KINDS)[number];

/** How soon after ⌘⇧V a paste counts as the plain paste it asked for. */
const PLAIN_PASTE_MS = 1_000;

/** How often "Saved 2 min ago" is brought up to date. */
const CLOCK_MS = 30_000;

/** The styles the selection bar and the shortcuts offer, in bar order. */
const STYLES: { style: InlineStyle; label: string; keys: string }[] = [
  { style: "bold", label: "Bold", keys: "⌘B" },
  { style: "italic", label: "Italic", keys: "⌘I" },
  { style: "highlight", label: "Highlight", keys: "⌘⇧H" },
];

/**
 * Put new words into a line being typed, as typing would: through the
 * browser's own editing, so ⌘Z takes it back, and falling back to setting
 * the text where that isn't there. Only the part that changed is replaced.
 */
function typeInto(el: HTMLTextAreaElement, made: Restyled): boolean {
  const change = diffLine(el.value, made.text);
  el.focus();
  if (change) {
    el.setSelectionRange(change.start, change.end);
    const typed =
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, change.text);
    if (!typed || el.value !== made.text) {
      // React only hears a change made through the element's own setter.
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(el, made.text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  el.setSelectionRange(made.start, made.end);
  return !!change;
}

/** Kinds that carry on when you press Enter at the end of a line. */
const LISTS = new Set<DocBlock["type"]>(["bullet", "numbered", "todo"]);

/** How long to wait after typing stops before saving. */
const SAVE_AFTER_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long the "someone else edited this" note stays up. */
const MERGE_NOTE_MS = 6_000;

/**
 * Re-read an edited line, so "# " or "- " changes the block's type. Pasting
 * several lines yields several blocks, which the caller splices in, so nothing
 * typed or pasted is dropped.
 */
function blocksFromSource(source: string): DocBlock[] {
  const parsed = parseDoc(source);
  return parsed.length ? parsed : [{ type: "paragraph", text: "" }];
}

/** How much room the button over a selection needs above the words. */
const BAR_HEIGHT = 44;

/**
 * Where to hang the button that acts on a selection.
 *
 * Above the words normally, so it does not cover what was just selected.
 * But the space above the first line of a page belongs to the title, and a
 * button floating over the title is worse than one below the words — so
 * when there is no room inside the page above the selection, it goes below.
 */
function barPlace(at: DOMRect, ceiling: number) {
  const above = at.top - BAR_HEIGHT;
  return {
    top: above < ceiling ? at.bottom + 8 : above,
    left: at.left + at.width / 2,
  };
}

/** Where each page's chosen mode is remembered, between visits. */
const MODE_KEY = "orbyn-doc-mode";

const rememberedMode = (docId: string): DocMode | null => {
  try {
    const all = JSON.parse(localStorage.getItem(MODE_KEY) ?? "{}");
    const m = all[docId];
    return m === "edit" || m === "read" || m === "suggest" ? m : null;
  } catch {
    return null;
  }
};

const rememberMode = (docId: string, mode: DocMode) => {
  try {
    const all = JSON.parse(localStorage.getItem(MODE_KEY) ?? "{}");
    localStorage.setItem(MODE_KEY, JSON.stringify({ ...all, [docId]: mode }));
  } catch {
    // Remembering is a convenience; a browser that refuses is not an error.
  }
};

/** Grow the title box to fit its text, where CSS field-sizing isn't there. */
const fitTitle = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

export function DocEditor({
  doc,
  onBack,
  onChanged,
  onDeleted,
  onItemsChanged,
  userId,
  canWrite = true,
  teamName,
  report,
  onUndoDelete,
}: {
  doc: Doc;
  /** Left out for the agenda, which has no list to go back to. */
  onBack?: () => void;
  onChanged: (doc: Doc) => void;
  onDeleted: (id: string) => void;
  /**
   * The page came back from Trash through the toast's Undo. Left out, the
   * toast says it is back and leaves it where it is.
   */
  onUndoDelete?: (doc: Doc) => void;
  /** Called after checklist lines are turned into real tasks. */
  onItemsChanged?: () => void;
  /** Whose comments show a remove button. */
  userId?: string;
  /** False for a team page this reader may read but not change. */
  canWrite?: boolean;
  /** The team a page belongs to, named when explaining why it is read-only. */
  teamName?: string | null;
  report: (e: unknown) => void;
}) {
  const toast = useToast();
  /**
   * A page opens the way it was last worked on, and always read-only for
   * someone who cannot change it — landing in an editor that will refuse
   * the first save is worse than not being offered one.
   */
  const [mode, setMode] = useState<DocMode>(() =>
    canWrite
      ? // The agenda is read more than written, so it opens for reading.
        (rememberedMode(doc.id) ?? (doc.kind === "agenda" ? "read" : "edit"))
      : "read",
  );
  const suggesting = mode === "suggest";
  /** Nothing typed changes the page itself in these modes. */
  const reading = mode === "read" || (!canWrite && !suggesting);
  const [suggestions, setSuggestions] = useState<DocSuggestion[]>([]);
  const [deciding, setDeciding] = useState(false);
  /** What a line being suggested on has been typed into, before it is sent. */
  const suggestDraft = useRef<string | null>(null);
  const [title, setTitle] = useState(doc.title);
  const [blocks, setBlocks] = useState<DocBlock[]>(
    doc.content.length ? doc.content : [{ type: "paragraph", text: "" }],
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const version = useRef(doc.version);
  const dirty = useRef(false);
  /**
   * The document as the server last had it. Merging needs this: it is what
   * tells an edit made here apart from one that arrived from somewhere else.
   */
  const base = useRef<DocBlock[]>(doc.content);
  /** Current state, readable from callbacks that were made earlier. */
  const live = useRef({ title: doc.title, blocks: [] as DocBlock[] });
  /**
   * What someone else's edits just did to the page, shown beside Saved as
   * part of working together. Every other notice goes through the toast.
   */
  const [note, setNote] = useState("");
  /** Which line is open for editing, readable from the live subscription. */
  const focusedRef = useRef<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const flushOnClose = useRef<() => void>(() => {});
  /** The block whose handle menu is open, and where to hang it. */
  const [menu, setMenu] = useState<{ index: number; at: DOMRect } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /** Words chosen for a comment, before anything has been written. */
  const [pending, setPending] = useState<{
    blockId: string;
    quote: string;
    range_start?: number;
    range_end?: number;
  } | null>(null);
  /** The line whose comment card is singled out, from either side. */
  const [activeComment, setActiveComment] = useState<string | null>(null);
  /** Stretches of each line that carry remarks, so the page can shade them. */
  const [commented, setCommented] = useState<Record<string, Mark[]>>({});
  /** A live selection, and where to hang the button that acts on it. */
  const [picked, setPicked] = useState<Picked | null>(null);
  /** Whether the list of things to ask the assistant for is showing. */
  const [askMenu, setAskMenu] = useState(false);
  /** Whether the list of shapes to download the page in is showing. */
  const [downloadMenu, setDownloadMenu] = useState(false);
  /** Whether the conversation about this page is open. */
  const [chat, setChat] = useState(false);
  /** Where each named line sits, measured from the top of the page. */
  const [tops, setTops] = useState<Record<string, number>>({});
  const pageRef = useRef<HTMLDivElement | null>(null);
  /** The bar over a selection, kept inside the page's own column. */
  const barRef = useRef<HTMLDivElement | null>(null);
  /** The lines themselves: the button over a selection stays inside them. */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const blockEls = useRef(new Map<string, HTMLElement>());
  /**
   * A "/" typed in a line, waiting for something to be picked: at the start
   * of an empty line, any kind of block; partway through, something to put
   * in the line, from `from` (where the "/" is) to the caret.
   */
  const [slash, setSlash] = useState<{
    index: number;
    query: string;
    at: DOMRect;
    insertsOnly: boolean;
    from: number;
  } | null>(null);
  /** A version chosen in history, shown on the page with what changed. */
  const [historyView, setHistoryView] = useState<HistoryView | null>(null);
  /** Words being made a link: the words, and the address typed so far. */
  const [linking, setLinking] = useState<{ words: Picked; url: string } | null>(
    null,
  );
  /** When the page was last saved, for the line at its end. */
  const [savedAt, setSavedAt] = useState(doc.updated_at);
  const [now, setNow] = useState(() => new Date());
  /**
   * When ⌘⇧V was last pressed. The paste it makes follows at once, so only
   * a paste within PLAIN_PASTE_MS of it is plain: a ⌘⇧V that pasted nothing
   * (an empty clipboard, a paste the browser blocked) doesn't turn the next
   * ordinary ⌘V plain.
   */
  const plainPaste = useRef(0);
  /** A line made by "New task" in the / menu, waiting for its words. */
  const pendingTask = useRef<string | null>(null);
  /** The page's tags, as its tag row shows them. */
  const [tags, setTags] = useState(doc.tags ?? []);
  /**
   * The page as it stood when its #tags were last looked at. A #tag typed
   * since then is added to the page when the line is left; one that was
   * already there is not, so a tag taken off isn't put straight back.
   */
  const tagBase = useRef<DocBlock[]>(doc.content);
  /** Whether "Save as template" is open. */
  const [savingTemplate, setSavingTemplate] = useState(false);

  // A different document replaces the editor's state entirely.
  useEffect(() => {
    setTitle(doc.title);
    setBlocks(
      doc.content.length ? doc.content : [{ type: "paragraph", text: "" }],
    );
    version.current = doc.version;
    base.current = doc.content;
    dirty.current = false;
    setSave("idle");
    setNote("");
    setFocused(null);
    setSavedAt(doc.updated_at);
    setHistoryView(null);
    setLinking(null);
    setTags(doc.tags ?? []);
    tagBase.current = doc.content;
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Leaving a line — Enter, the arrows, a click elsewhere — is when a #tag
  // typed in it counts, not every keystroke on the way to "#physics".
  const lastFocused = useRef<number | null>(null);
  useEffect(() => {
    if (lastFocused.current !== null && lastFocused.current !== focused)
      settleTags.current();
    lastFocused.current = focused;
  }, [focused]);

  // "Saved 2 min ago" keeps up with the clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);

  live.current = { title, blocks };
  focusedRef.current = focused;

  /**
   * Fold a copy of the document that came from elsewhere into what is on
   * screen. Lines only one side touched are kept as they are; where both
   * sides changed the same line, the version that is already saved stands
   * and the other is put back on the line below, so nothing typed is lost.
   * Returns the blocks now on screen.
   */
  const reconcile = useCallback((theirs: Doc): DocBlock[] => {
    const mine = live.current.blocks;
    const merge = mergeDocs(base.current, mine, theirs.content);
    const next = merge.blocks.length
      ? merge.blocks
      : [{ type: "paragraph", text: "" } as DocBlock];
    version.current = theirs.version;
    base.current = theirs.content;
    setBlocks(next);
    // The title is one field; whoever saved last has it.
    if (theirs.title !== live.current.title) setTitle(theirs.title);
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
        setSave("saving");
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
          setSave("saved");
          setSavedAt(saved.updated_at);
          setNow(new Date());
          onChanged(saved);
        } catch (e) {
          // Someone saved first. Take their copy, fold this edit into it and
          // save again, rather than making the writer sort it out by hand.
          if ((e as { statusCode?: number }).statusCode === 409) {
            try {
              const theirs = await client.getDoc(doc.id);
              const merged = reconcile(theirs);
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
              setSave("saved");
              onChanged(saved);
              return;
            } catch (again) {
              setSave("error");
              report(again);
              return;
            }
          }
          setSave("error");
          report(e);
        }
      };
      saveQueue.current = saveQueue.current.then(write, write);
      return saveQueue.current;
    },
    [doc.id, onChanged, reconcile, report],
  );

  flushOnClose.current = () => {
    if (!canWrite || !dirty.current) return;
    void persist(live.current.title, live.current.blocks);
  };

  /** Queue a save; typing again restarts the clock. */
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

  // Don't lose the last keystrokes when the editor closes.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flushOnClose.current();
      settleTags.current();
    };
  }, []);

  /**
   * The subscription must outlive re-renders: it depends on the document,
   * not on callbacks that are rebuilt each time the page is typed into.
   * Without this the stream was torn down and reopened on every keystroke.
   */
  const onEvent = useRef<(version: number, news: DocNews) => void>(() => {});
  onEvent.current = (remote: number, { trashed, tags: retagged }: DocNews) => {
    // Moved to Trash somewhere else: let the page go, rather than keep
    // typing into something every save will now refuse.
    if (trashed) {
      if (timer.current) clearTimeout(timer.current);
      dirty.current = false;
      flushOnClose.current = () => {};
      gone.current = true;
      onDeleted(doc.id);
      toast({
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
      // A line open for editing counts as ours even before a keystroke:
      // replacing the whole page would pull the text out from under it.
      if (!dirty.current && focusedRef.current === null) {
        version.current = theirs.version;
        base.current = theirs.content;
        tagBase.current = theirs.content;
        setTags(theirs.tags ?? []);
        setTitle(theirs.title);
        setBlocks(
          theirs.content.length
            ? theirs.content
            : [{ type: "paragraph", text: "" }],
        );
        setNote("Updated with someone else's changes.");
        onChanged(theirs);
        return;
      }
      const merged = reconcile(theirs);
      // Only send the merged page back when something of ours was waiting;
      // an open but untouched line has nothing to add.
      if (dirty.current) void persist(live.current.title, merged);
      else onChanged(theirs);
    }, report);
  };

  /**
   * Follow the document while it is open. When it changes somewhere else the
   * server says only that it moved on; the new copy is read here and folded
   * in, so two people can work on the same page at once.
   */
  useEffect(
    () => client.watchDoc(doc.id, (v, news) => onEvent.current(v, news)),
    [doc.id],
  );

  // The note is news, not a state to sit in.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), MERGE_NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  const update = (next: DocBlock[]) => {
    setBlocks(next);
    queueSave(title, next);
  };

  const editBlock = (index: number, source: string) => {
    // In suggesting mode nothing typed reaches the page: the line is held
    // aside and becomes a proposal when the line is left.
    if (suggesting) {
      suggestDraft.current = source;
      return;
    }
    const next = blocks.slice();
    // Re-reading the Markdown makes fresh blocks; the old line's name goes
    // back on the first of them, or its comments and its task lose it.
    next.splice(
      index,
      1,
      ...carryBlockIds(blocks[index], blocksFromSource(source)),
    );
    update(keepStart(next, index));
  };

  /**
   * Choose a line to comment on. A line needs a name before anything can
   * point at it, so one is given here and saved with the page.
   */
  /** Give a line a name, so a remark or a proposal can point at it. */
  const nameBlock = (index: number): string => {
    const block = blocks[index];
    if (block.id) return block.id;
    const blockId = newBlockId();
    const next = blocks.slice();
    next[index] = { ...block, id: blockId };
    update(next);
    return blockId;
  };

  const commentOn = (index: number) => {
    const block = blocks[index];
    const blockId = nameBlock(index);
    setPending({ blockId, quote: blockText(block).slice(0, 400) });
    setActiveComment(blockId);
  };

  /**
   * Comment on the words someone has selected.
   *
   * The line already has a name here — nothing can be selected in a line the
   * page has not rendered, and rendering needs the name — so unlike
   * commenting on a whole line this never has to write to the page first.
   */
  const commentOnSelection = (p: Picked) => {
    // The name this points at may only exist in the open editor, so the page
    // is saved now; the remark that follows then has a line to hang on.
    if (!base.current.some((b) => b.id === p.blockId)) queueSave(title, blocks);
    setPending({
      blockId: p.blockId,
      quote: p.quote.slice(0, 400),
      range_start: p.start,
      range_end: p.end,
    });
    setActiveComment(p.blockId);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
  };

  /**
   * Watch for words being selected on the page.
   *
   * A line without a name cannot carry a remark, so selecting inside one
   * gives it a name as soon as the selection settles, rather than at the
   * moment the button is pressed, when the page would re-render underneath
   * the selection and lose it.
   */
  useEffect(() => {
    const read = () => {
      const page = pageRef.current;
      if (!page) return;
      const found = readSelection(page);
      setPicked(found);
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

  /**
   * Every line a reader can select in needs a name before they select, or the
   * page is rewritten under a live selection and the words are lost. The
   * names are given here and kept only in the open editor: writing them back
   * would mean opening a document counted as editing it, which would reorder
   * the list of documents for everyone. They are saved with the first remark
   * that actually needs one.
   */
  useEffect(() => {
    if (!blocks.some((b) => !b.id && "text" in b && b.text.trim())) return;
    setBlocks((current) =>
      current.map((b) =>
        !b.id && "text" in b && b.text.trim() ? { ...b, id: newBlockId() } : b,
      ),
    );
  }, [blocks]);

  /**
   * Turn what was typed into a line into a proposed change.
   *
   * The line is compared with what the page still says, and the run that
   * differs becomes one proposal — which reads as "this became that" rather
   * than as a scatter of single characters.
   */
  const proposeLine = async (index: number) => {
    const typed = suggestDraft.current;
    suggestDraft.current = null;
    const block = blocks[index];
    if (typed === null || !block?.id) return;
    // Compared with the line as it was shown for typing, number and all.
    const change = proposeEdit(
      block.id,
      serializeBlock(block, layout[index]?.number),
      typed,
    );
    if (!change) return;
    try {
      const made = await client.proposeDocChanges(doc.id, [change]);
      setSuggestions((list) => [...list, ...made]);
      toast({ text: "Suggested. It waits for someone to take it." });
    } catch (e) {
      report(e);
    }
  };

  const loadSuggestions = useCallback(() => {
    client
      .listDocSuggestions(doc.id)
      .then(setSuggestions, () => setSuggestions([]));
  }, [doc.id]);

  useEffect(() => loadSuggestions(), [loadSuggestions]);

  /** Take a proposal into the page, or leave it. */
  const decide = (s: DocSuggestion, take: boolean) => {
    setDeciding(true);
    client
      .decideDocSuggestion(doc.id, s.id, take)
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

  const withdraw = (s: DocSuggestion) => {
    setDeciding(true);
    client
      .withdrawDocSuggestion(doc.id, s.id)
      .then(() => setSuggestions((list) => list.filter((x) => x.id !== s.id)))
      .catch(report)
      .finally(() => setDeciding(false));
  };

  /**
   * Where proposed changes fall in the page, so the words they would change
   * are shaded as well as listed. An insertion has no words of its own, so
   * it shades the character it would sit beside.
   */
  const proposedMarks: Record<string, Mark[]> = {};
  for (const block of blocks) if (block.id) proposedMarks[block.id] = [];
  for (const s of suggestions)
    if (s.status === "open" && !s.detached && proposedMarks[s.block_id])
      proposedMarks[s.block_id].push({
        start: s.range_start,
        end: Math.max(s.range_end, s.range_start + 1),
        proposed: true,
      });

  /**
   * Ask the assistant for words in place of the selected ones. What comes
   * back is a proposal like any other, so the page does not change until
   * somebody takes it — which is what makes this safe on a shared page.
   */
  const assist = async (words: Picked, action: DocAiAction) => {
    setAskMenu(false);
    let instruction = "";
    if (action === "custom") {
      const asked = window.prompt(
        "What should the assistant do with these words?",
      );
      if (!asked?.trim()) return;
      instruction = asked.trim();
    }
    setPicked(null);
    window.getSelection()?.removeAllRanges();
    toast({ text: "Asking the assistant…" });
    try {
      const made = await client.assistDoc(doc.id, {
        block_id: words.blockId,
        range_start: words.start,
        range_end: words.end,
        action,
        instruction,
      });
      setSuggestions((list) => [...list, made]);
      toast({ text: "Suggested. Take it or leave it." });
    } catch (e) {
      report(e);
    }
  };

  /** The line some selected words are in, and where it sits. */
  const lineOf = (words: Picked) => {
    const index = blocks.findIndex((b) => b.id === words.blockId);
    return index < 0 ? null : { index, block: blocks[index] };
  };

  /** Put a style on the selected words, straight into the page. */
  const styleWords = (words: Picked, style: InlineStyle) => {
    const at = lineOf(words);
    if (!at || at.block.type === "divider") return;
    const made = styleRange(at.block.text, words.start, words.end, style);
    if (!made) return;
    const next = blocks.slice();
    next[at.index] = { ...at.block, text: made.text };
    update(next);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
  };

  /** Make the selected words a link to the address typed in the bar. */
  const linkWords = () => {
    if (!linking) return;
    const at = lineOf(linking.words);
    if (!at || at.block.type === "divider") return setLinking(null);
    const made = linkRange(
      at.block.text,
      linking.words.start,
      linking.words.end,
      linking.url,
    );
    if (!made) {
      toast({ text: "That doesn't look like a web address.", tone: "warn" });
      return;
    }
    const next = blocks.slice();
    next[at.index] = { ...at.block, text: made.text };
    update(next);
    setLinking(null);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
  };

  /**
   * Make a task of the selected words: a checklist line under the line they
   * are in, turned into a task at once, so the task knows the page and the
   * line it came from.
   */
  const taskFromWords = (words: Picked) => {
    const at = lineOf(words);
    if (!at) return;
    const title = plainText(words.quote).trim().slice(0, 200);
    if (!title) return;
    const id = newBlockId();
    const next = blocks.slice();
    next.splice(
      at.index + 1,
      0,
      withDepth(
        { type: "todo", text: title, done: false, id },
        blockDepth(at.block),
      ),
    );
    update(next);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
    void linesToTasks([id]).then(
      (made) =>
        toast({
          text: made ? `Added “${title}” to your tasks` : "Already a task",
        }),
      report,
    );
  };

  // A press anywhere but the bar puts the link away.
  useEffect(() => {
    if (!linking) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".doc-selection-bar"))
        setLinking(null);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [linking]);

  // With words selected on the page, the style shortcuts work on them too.
  useEffect(() => {
    if (!picked || reading || suggesting || linking) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const style: InlineStyle | null =
        key === "b" && !e.shiftKey
          ? "bold"
          : key === "i" && !e.shiftKey
            ? "italic"
            : key === "h" && e.shiftKey
              ? "highlight"
              : null;
      if (style) {
        e.preventDefault();
        e.stopPropagation();
        styleWords(picked, style);
      } else if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setLinking({ words: picked, url: "" });
      }
    };
    // Capture, so ⌘K reaches the words before the command bar.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  /** Put a line in view and single it out, for an answer that cites it. */
  const goToBlock = (blockId: string) => {
    const el = blockEls.current.get(blockId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setActiveComment(blockId);
  };

  /**
   * A proposal is a stretch of one named line, so there is no way to propose
   * a line added, taken away, moved, copied, or a box ticked. Every one of
   * those used to go straight onto the page while suggesting, which is the
   * one thing suggesting is meant not to do.
   */
  const structural = !suggesting;

  const insertAfter = (index: number) => {
    if (!structural) return;
    const current = blocks[index];
    // A "New task" line being left becomes a task, but only once the new
    // line is on the page: the save that goes first then already holds it.
    const task = claimPendingTask(current);
    const next = blocks.slice();
    // Enter at the end of a list item makes another at the same depth; on an
    // empty one it steps back out a level, and at the left edge it leaves
    // the list, the way every editor since Word has.
    if (LISTS.has(current.type)) {
      if (!("text" in current) || current.text.trim() === "") {
        if (blockDepth(current) > 0) {
          update(indentBlocks(blocks, index, -1));
          return;
        }
        next[index] = { type: "paragraph", text: "" };
        update(next);
        // A line of another kind is a new input: open it again, so the
        // caret stays where the writer is.
        setFocused(null);
        requestAnimationFrame(() => setFocused(index));
        return;
      }
      next.splice(
        index + 1,
        0,
        withDepth(
          blockToType({ type: "paragraph", text: "" }, current.type),
          blockDepth(current),
        ),
      );
    } else next.splice(index + 1, 0, { type: "paragraph", text: "" });
    update(next);
    setFocused(index + 1);
    makePendingTask(task);
  };

  /** Tuck a list line in under the one above, or bring it back out. */
  const indent = (index: number, by: 1 | -1) => {
    if (!structural) return;
    const next = indentBlocks(blocks, index, by);
    if (next !== blocks) update(next);
  };

  /**
   * Turn checklist lines into real tasks: the ones named, or every open one
   * that isn't a task yet. The page is saved first so the server works from
   * what is on screen, and the answer ties each line to its task.
   */
  const linesToTasks = async (blockIds?: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current) await persist(live.current.title, live.current.blocks);
    // What the server works from; anything typed after this is newer.
    const sent = live.current.blocks;
    const { created, doc: updated } = await client.docToTasks(doc.id, blockIds);
    if (updated && updated.version > version.current) {
      version.current = updated.version;
      base.current = updated.content;
      setSavedAt(updated.updated_at);
      onChanged(updated);
      if (!dirty.current && live.current.blocks === sent) {
        setBlocks(updated.content);
        setSave("saved");
      } else {
        // The page moved on while the lines were being made tasks: a line
        // added by Enter, words typed somewhere else. What is on screen
        // stands, and is saved over the server's copy; only the names the
        // server gave lines are taken from it, so they stay tied to their
        // tasks.
        const now = live.current.blocks;
        const next = carryNewIds(sent, updated.content, now);
        if (next !== now) setBlocks(next);
        queueSave(live.current.title, next);
      }
    }
    onItemsChanged?.();
    return created;
  };

  /**
   * A line made by "New task" becomes a task once it has words and the
   * writer moves on from it (Enter, or leaving the line). Claiming it first
   * means it is made once, however the line is left.
   */
  const claimPendingTask = (block: DocBlock | undefined): string | null => {
    const id = pendingTask.current;
    if (!id || block?.id !== id) return null;
    pendingTask.current = null;
    return block.type === "todo" && block.text.trim() ? id : null;
  };
  const makePendingTask = (id: string | null) => {
    if (!id) return;
    void linesToTasks([id]).then(
      (made) => made && toast({ text: "Added to your tasks" }),
      report,
    );
  };
  const settlePendingTask = (index: number) =>
    makePendingTask(claimPendingTask(live.current.blocks[index]));

  /**
   * Put what is being typed into the open line, without going near the page.
   * The line is an uncontrolled textarea while suggesting, so it is written
   * to directly and the draft kept in step.
   */
  const setLineSource = (source: string) => {
    suggestDraft.current = source;
    const el = areaRef.current;
    if (!el) return;
    el.value = source;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  /** The same words as another kind of block. */
  const turnInto = (index: number, kind: Kind) => {
    // A line's kind lives in its own words — the "# " in front of them — so
    // while suggesting this is an ordinary change to the line, and becomes a
    // proposal like any other. It applies to what has been typed, not to
    // what the page still says.
    if (suggesting) {
      const typed =
        suggestDraft.current ??
        serializeBlock(blocks[index], layout[index]?.number);
      const current = blocksFromSource(typed)[0] ?? blocks[index];
      setLineSource(
        serializeBlock(blockToType(current, kind.type, kind.level)),
      );
      return;
    }
    const next = blocks.slice();
    next[index] = blockToType(blocks[index], kind.type, kind.level);
    update(next);
  };

  const moveBlock = (index: number, by: -1 | 1) => {
    if (!structural) return;
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    [next[index], next[to]] = [next[to], next[index]];
    update(next);
  };

  const duplicate = (index: number) => {
    if (!structural) return;
    const next = blocks.slice();
    const copy = { ...blocks[index] };
    // A copied checklist line is a new line, not the same task twice.
    if (copy.type === "todo") delete copy.id;
    next.splice(index + 1, 0, copy);
    update(next);
  };

  /**
   * A "/" at the start of an empty line asks what the line should be; one
   * typed after a space partway through a line offers what can go in it.
   */
  const watchSlash = (
    index: number,
    value: string,
    el: HTMLTextAreaElement,
  ) => {
    const kind = blocks[index].type;
    const m = /^\/([^\s]*)$/.exec(value);
    const upto = value.slice(0, el.selectionStart);
    // Partway through, a word after the "/" is needed first, so a slash in
    // "1 / 2" followed by Enter is still just a new line.
    const mid = /(?:^|\s)\/(\w+)$/.exec(upto);
    if (m && kind === "paragraph")
      setSlash({
        index,
        query: m[1],
        at: el.getBoundingClientRect(),
        insertsOnly: false,
        from: 0,
      });
    else if (mid && kind !== "code" && kind !== "math")
      setSlash({
        index,
        query: mid[1],
        at: el.getBoundingClientRect(),
        insertsOnly: true,
        from: upto.length - mid[1].length - 1,
      });
    else if (slash) setSlash(null);
  };

  const pickSlash = (item: SlashItem) => {
    if (!slash) return;
    if (item.kind === "date") {
      // Today's date goes where the "/" was, and typing carries on after it.
      const el = areaRef.current;
      setSlash(null);
      if (!el) return;
      const date = todayText();
      const caret = el.selectionStart;
      const text = el.value.slice(0, slash.from) + date + el.value.slice(caret);
      const at = slash.from + date.length;
      typeInto(el, { text, start: at, end: at });
      return;
    }
    if (item.kind === "task" && !suggesting) {
      const id = newBlockId();
      const next = blocks.slice();
      next[slash.index] = { type: "todo", text: "", done: false, id };
      pendingTask.current = id;
      setSlash(null);
      update(next);
      setFocused(null);
      const at = slash.index;
      requestAnimationFrame(() => setFocused(at));
      return;
    }
    const kind: Kind =
      item.kind === "block"
        ? item.block
        : BLOCK_KINDS.find((k) => k.type === "todo")!;
    if (suggesting) {
      setLineSource(
        serializeBlock(
          blockToType({ type: "paragraph", text: "" }, kind.type, kind.level),
        ),
      );
      setSlash(null);
      return;
    }
    const next = blocks.slice();
    next[slash.index] = blockToType(
      { type: "paragraph", text: "" },
      kind.type,
      kind.level,
    );
    setSlash(null);
    update(next);
    // Stay on the line, now of its new kind, ready to type into.
    setFocused(null);
    requestAnimationFrame(() => setFocused(slash.index));
  };

  const removeAt = (index: number) => {
    if (!structural) return;
    const next = blocks.slice();
    // A page is never empty: the last block goes back to a blank line.
    if (blocks.length === 1) next[0] = { type: "paragraph", text: "" };
    else next.splice(index, 1);
    update(next);
    setFocused(Math.max(0, index - 1));
  };

  const toggleTodo = (index: number) => {
    const b = blocks[index];
    if (b.type !== "todo" || !structural) return;
    const next = blocks.slice();
    next[index] = { ...b, done: !b.done };
    update(next);
  };

  /** Flip the box of the checklist line being typed, keeping the caret. */
  const tickLine = (el: HTMLTextAreaElement) => {
    const box = /^(\s*[-*]\s+\[)( |x|X)\]/.exec(el.value);
    if (!box) return;
    const at = box[1].length;
    typeInto(el, {
      text:
        el.value.slice(0, at) +
        (box[2] === " " ? "x" : " ") +
        el.value.slice(at + 1),
      start: el.selectionStart,
      end: el.selectionEnd,
    });
  };

  /**
   * Restyle the words selected in the line being typed — bold, italic, a
   * link — through the same path as typing, so it can be undone with ⌘Z and
   * becomes a proposal like any other edit while suggesting.
   */
  const restyle = (
    el: HTMLTextAreaElement,
    change: (text: string, start: number, end: number) => Restyled | null,
  ) => {
    const made = change(el.value, el.selectionStart, el.selectionEnd);
    if (!made) {
      toast({ text: "Those words already have another style.", tone: "warn" });
      return;
    }
    typeInto(el, made);
  };

  const onKey = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number,
  ) => {
    const value = e.currentTarget.value;
    const multiline =
      blocks[index].type === "code" || blocks[index].type === "math";
    const mod = e.metaKey || e.ctrlKey;
    // Tab tucks a list line under the one above; Shift+Tab brings it out.
    // Anywhere else Tab still moves on, as it does in any form.
    if (e.key === "Tab" && isListBlock(blocks[index]) && structural) {
      e.preventDefault();
      indent(index, e.shiftKey ? -1 : 1);
      return;
    }
    if (mod && !e.altKey && !multiline) {
      const key = e.key.toLowerCase();
      const style: InlineStyle | null =
        key === "b" && !e.shiftKey
          ? "bold"
          : key === "i" && !e.shiftKey
            ? "italic"
            : key === "e" && !e.shiftKey
              ? "code"
              : key === "h" && e.shiftKey
                ? "highlight"
                : null;
      if (style) {
        e.preventDefault();
        e.stopPropagation();
        restyle(e.currentTarget, (text, start, end) =>
          styleRange(text, start, end, style),
        );
        return;
      }
      // ⌘K in a line makes a link, rather than opening the command bar.
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        restyle(e.currentTarget, linkShortcut);
        return;
      }
      // ⌘⇧V: the next paste keeps only the words.
      if (key === "v" && e.shiftKey) plainPaste.current = Date.now();
      // ⌘⏎ ticks a checklist line, or unticks it. The box is flipped in the
      // line itself, as typing would, so the open line shows it, the next
      // keystroke keeps it and ⌘Z takes it back.
      if (e.key === "Enter" && blocks[index].type === "todo") {
        e.preventDefault();
        if (structural) tickLine(e.currentTarget);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !multiline) {
      e.preventDefault();
      insertAfter(index);
    } else if (e.key === "Backspace" && value === "" && blocks.length > 1) {
      e.preventDefault();
      removeAt(index);
    } else if (e.key === "ArrowUp" && index > 0 && !multiline) {
      e.preventDefault();
      setFocused(index - 1);
    } else if (
      e.key === "ArrowDown" &&
      index < blocks.length - 1 &&
      !multiline
    ) {
      e.preventDefault();
      setFocused(index + 1);
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
      setFocused(null);
    }
  };

  /**
   * Paste into a line. Copied pages, documents and web pages keep their
   * headings, lists, links and simple tables as lines of their own; several
   * lines of plain text are read as Markdown; ⌘⇧V takes the words as they
   * are. A web address pasted over words makes them a link. One line of text
   * pastes as it would anywhere.
   */
  const onPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    index: number,
  ) => {
    const plain = Date.now() - plainPaste.current < PLAIN_PASTE_MS;
    plainPaste.current = 0;
    const block = blocks[index];
    if (block.type === "code" || block.type === "math") return;
    const el = e.currentTarget;
    const text = e.clipboardData.getData("text/plain");
    const html = plain ? "" : e.clipboardData.getData("text/html");
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end && isUrl(text) && !/\n/.test(text.trim())) {
      const made = linkRange(el.value, start, end, text.trim());
      if (made) {
        e.preventDefault();
        typeInto(el, made);
        return;
      }
    }
    // A proposal is one line, so a paste while suggesting is only words.
    if (suggesting) return;
    let pasted = html ? htmlToBlocks(html) : [];
    if (!pasted.length) {
      if (!/\n/.test(text.trim())) return;
      pasted = textToBlocks(text, plain);
    }
    if (!pasted.length) return;
    e.preventDefault();
    // One plain paragraph: its words go in at the caret, styles and all.
    if (pasted.length === 1 && pasted[0].type === "paragraph") {
      const words = pasted[0].text;
      const at = start + words.length;
      typeInto(el, {
        text: el.value.slice(0, start) + words + el.value.slice(end),
        start: at,
        end: at,
      });
      return;
    }
    spliceLines(index, el.value.slice(0, start), pasted, el.value.slice(end));
  };

  /**
   * Put pasted lines into the page where the caret was. Words before the
   * caret keep their line, and the first pasted line's words join them;
   * words after the caret end the last pasted line. Plain lines pasted into
   * a list become items of it, and pasted lists nest under the line they
   * land in.
   */
  const spliceLines = (
    index: number,
    before: string,
    pasted: DocBlock[],
    after: string,
  ) => {
    const current = blocks[index];
    const line = blocksFromSource(before + after)[0];
    const depth = blockDepth(current);
    let lines = pasted;
    if (isListBlock(line) && lines.every((b) => b.type === "paragraph"))
      lines = lines.map((b) => withDepth(blockToType(b, line.type), depth));
    else if (depth)
      lines = lines.map((b) =>
        isListBlock(b) ? withDepth(b, blockDepth(b) + depth) : b,
      );
    const head = blocksFromSource(before)[0];
    let made: DocBlock[];
    if (blockText(head).trim() && lines[0].type !== "divider") {
      // Words before the caret: the first pasted line joins them.
      const joined = carryBlockIds(
        current,
        blocksFromSource(before + blockText(lines[0])),
      );
      made = [...joined, ...lines.slice(1)];
    } else {
      const [first, ...rest] = lines;
      made = [
        current.id && !first.id ? { ...first, id: current.id } : first,
        ...rest,
      ];
    }
    if (after.trim()) {
      const last = made[made.length - 1];
      if (
        last.type === "divider" ||
        last.type === "code" ||
        last.type === "math"
      )
        made.push({ type: "paragraph", text: after.trim() });
      else made[made.length - 1] = { ...last, text: last.text + after };
    }
    const next = blocks.slice();
    next.splice(index, 1, ...made);
    update(next);
    setFocused(null);
    const to = index + made.length - 1;
    requestAnimationFrame(() => setFocused(to));
  };

  // Keep the open textarea sized to its content.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focused]);

  /**
   * Where each named line sits, so the margin can put its card level with
   * it. Measured against the page rather than read from offsetTop, because
   * the rows are positioned and offsetTop would be relative to them.
   */
  const measure = useCallback(() => {
    const page = pageRef.current;
    if (!page) return;
    const from = page.getBoundingClientRect().top;
    const next: Record<string, number> = {};
    for (const [id, el] of blockEls.current)
      if (el.isConnected) next[id] = el.getBoundingClientRect().top - from;
    setTops((prev) => {
      const same =
        Object.keys(prev).length === Object.keys(next).length &&
        Object.entries(next).every(([k, v]) => prev[k] === v);
      return same ? prev : next;
    });
  }, []);

  useLayoutEffect(measure, [blocks, focused, showHistory, measure]);

  // The bar is centred over the words; near either edge of the page it is
  // nudged back so it never covers the library or runs off the window.
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.marginLeft = "0px";
    const bar = el.getBoundingClientRect();
    const page = pageRef.current?.getBoundingClientRect();
    const min = Math.max(8, page?.left ?? 8);
    const max = Math.min(
      window.innerWidth - 8,
      page?.right ?? window.innerWidth,
    );
    const shift =
      bar.left < min ? min - bar.left : bar.right > max ? max - bar.right : 0;
    el.style.marginLeft = `${shift}px`;
  });

  // The page reflows as it is typed into and as the window changes shape.
  useEffect(() => {
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [measure]);

  const markdown = useMemo(() => serializeDoc(blocks), [blocks]);
  /** Where each line sits in its list: its depth and its number. */
  const layout = useMemo(() => listLayout(blocks), [blocks]);
  const stats = useMemo(() => docStats(blocks), [blocks]);
  /** The words selected, with the line they are in and what can be done. */
  const words = linking?.words ?? picked;
  const pickedLine = words ? lineOf(words) : null;
  const canFormat = !reading && !suggesting && !!pickedLine;
  const styleable = (style: InlineStyle) =>
    !!words &&
    !!pickedLine &&
    pickedLine.block.type !== "divider" &&
    styleRange(pickedLine.block.text, words.start, words.end, style) !== null;

  /**
   * Take the page away as a file. The server decides what the file holds
   * and what it is called, so a page saved from a phone and a page saved
   * from here are the same file.
   */
  const download = async (format: ExportFormat) => {
    setDownloadMenu(false);
    toast({ text: `Making the ${EXPORT_LABELS[format].name} file…` });
    try {
      const { blob, name } = await client.exportDoc(doc.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast({ text: `Downloaded “${name}”` });
    } catch (e) {
      report(e);
    }
  };

  // Lines already tied to a task are not offered again.
  const openTodos = blocks.filter(
    (b) => b.type === "todo" && !b.done && !b.id && b.text.trim().length > 0,
  ).length;

  /** Turn the unticked checklist lines into real tasks. */
  const makeTasks = () =>
    void (async () => {
      try {
        // The server ties each line to its task and hands back the document;
        // adopting it keeps the ids, so the lines now follow their tasks.
        const created = await linesToTasks();
        toast({
          text:
            created === 0
              ? "Every item here is already a task."
              : `Added ${created} task${created === 1 ? "" : "s"} to your planner. Ticking one here ticks it there.`,
        });
      } catch (e) {
        report(e);
      }
    })();

  /**
   * Delete the page: it moves to Trash, and a toast offers Undo. Nothing
   * asks first, because nothing is lost — the page, its history and its
   * comments wait in Trash for 30 days.
   */
  const remove = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      // What was just typed goes with it, so Undo brings back all of it.
      if (dirty.current) await persist(title, blocks);
      await client.deleteDoc(doc.id);
    } catch (e) {
      report(e);
      return;
    }
    dirty.current = false;
    flushOnClose.current = () => {};
    gone.current = true;
    onDeleted(doc.id);
    toast({
      text: `Moved “${title || "Untitled"}” to Trash`,
      action: {
        label: "Undo",
        run: () =>
          void client.restoreDoc(doc.id).then((back) => {
            if (onUndoDelete) onUndoDelete(back);
            else toast({ text: `“${back.title || "Untitled"}” is back` });
          }, report),
      },
    });
  };

  return (
    <div className="doc-editor">
      <div className="doc-bar">
        {onBack && (
          <button className="text-button" onClick={onBack}>
            <ArrowLeft size={15} /> All documents
          </button>
        )}
        <span className="doc-save" role="status">
          {save === "saving" && (
            <>
              <Loader2 size={13} className="spin" /> Saving…
            </>
          )}
          {save === "saved" && (
            <>
              <Check size={13} /> Saved
            </>
          )}
          {save === "error" && "Not saved"}
        </span>
        {!!note && (
          <span className="doc-merged" role="status">
            <Users size={13} aria-hidden="true" /> {note}
          </span>
        )}
        <span className="doc-bar-actions">
          <DocViewers docId={doc.id} />
          <DocModeSwitch
            mode={mode}
            canWrite={canWrite}
            teamName={doc.team_name}
            onChange={(next) => {
              // Leaving an open line behind would strand what was typed in
              // it, so the page is settled before the mode changes.
              setFocused(null);
              setMode(next);
              rememberMode(doc.id, next);
            }}
          />
          {openTodos > 0 && !reading && (
            <button className="text-button" onClick={makeTasks}>
              <ListPlus size={15} /> Add {openTodos} to my tasks
            </button>
          )}
          {/* A conversation about the page sits beside the page's own tools,
              not in the margin: the margin is where the remarks live. */}
          <button
            className={"icon-button" + (chat ? " is-on" : "")}
            onClick={() => setChat((v) => !v)}
            aria-label="Talk about this page"
            aria-pressed={chat}
            title="Talk about this page"
          >
            <Sparkles size={15} />
          </button>
          <button
            className={"icon-button" + (showHistory ? " is-on" : "")}
            onClick={() => {
              if (showHistory) setHistoryView(null);
              setShowHistory((v) => !v);
            }}
            aria-label="Page history"
            aria-pressed={showHistory}
            title="Page history"
          >
            <History size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() => setSavingTemplate(true)}
            aria-label="Save as template"
            aria-haspopup="dialog"
            title="Save as template"
          >
            <LayoutTemplate size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(`# ${title}\n\n${markdown}`)
                .then(() => toast({ text: "Copied as Markdown" }), report)
            }
            aria-label="Copy as Markdown"
            title="Copy as Markdown"
          >
            <Copy size={15} />
          </button>
          {/* On a phone's browser: the system share sheet (SHR-07). */}
          <SharePageButton
            docId={doc.id}
            title={title || "Untitled"}
            onError={report}
          />
          <span className="doc-download">
            <button
              className={"icon-button" + (downloadMenu ? " is-on" : "")}
              onClick={() => setDownloadMenu((v) => !v)}
              aria-label="Download this page"
              aria-haspopup="menu"
              aria-expanded={downloadMenu}
              title="Download this page"
            >
              <Download size={15} />
            </button>
            {downloadMenu && (
              <ul className="doc-download-menu" role="menu">
                {EXPORT_FORMATS.map((format) => (
                  <li key={format}>
                    <button
                      role="menuitem"
                      onClick={() => void download(format)}
                    >
                      {EXPORT_LABELS[format].name}
                      <small>.{EXPORT_LABELS[format].extension}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>
          {!reading && (
            <button
              className="icon-button"
              onClick={() => void remove()}
              aria-label="Move to Trash"
              title="Move to Trash"
            >
              <Trash2 size={15} />
            </button>
          )}
        </span>
      </div>

      {/* The bar that acts on a selection follows the words themselves, so
          it reads as belonging to them rather than to the page. Styles and
          "Make task" change the page, so they are offered only while
          editing; commenting and asking work in every mode. */}
      {words && !pending && (
        <div
          ref={barRef}
          className="doc-selection-bar"
          style={barPlace(
            words.at,
            bodyRef.current?.getBoundingClientRect().top ?? 0,
          )}
          role="toolbar"
          aria-label="Selected words"
        >
          {linking ? (
            <form
              className="doc-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                linkWords();
              }}
            >
              <Link size={14} aria-hidden="true" />
              <input
                autoFocus
                aria-label="Web address for the link"
                placeholder="Paste or type a link"
                value={linking.url}
                onChange={(e) =>
                  setLinking({ ...linking, url: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setLinking(null);
                  }
                }}
              />
              <button
                type="submit"
                className="text-button"
                disabled={!linking.url.trim()}
              >
                Link
              </button>
            </form>
          ) : (
            <>
              {canFormat && (
                <>
                  {STYLES.map(({ style, label, keys }) => {
                    const Icon =
                      style === "bold"
                        ? Bold
                        : style === "italic"
                          ? Italic
                          : Highlighter;
                    return (
                      <button
                        key={style}
                        className="icon-button"
                        aria-label={label}
                        title={
                          styleable(style)
                            ? `${label} (${keys})`
                            : `${label}: these words already have another style`
                        }
                        disabled={!styleable(style)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => styleWords(words, style)}
                      >
                        <Icon size={15} aria-hidden="true" />
                      </button>
                    );
                  })}
                  <button
                    className="icon-button"
                    aria-label="Link"
                    title="Link (⌘K)"
                    disabled={
                      !pickedLine ||
                      pickedLine.block.type === "divider" ||
                      !linkRange(
                        pickedLine.block.text,
                        words.start,
                        words.end,
                        "https://x.x",
                      )
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setLinking({ words, url: "" })}
                  >
                    <Link size={15} aria-hidden="true" />
                  </button>
                  <span className="doc-selection-rule" aria-hidden="true" />
                </>
              )}
              <button
                className="text-button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commentOnSelection(words)}
              >
                <MessageSquarePlus size={14} aria-hidden="true" /> Comment
              </button>
              {/* Asking for words and saying something about them are the
                  two things anyone wants from a selection, so they sit
                  together. */}
              <button
                className="text-button"
                aria-haspopup="menu"
                aria-expanded={askMenu}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setAskMenu((v) => !v)}
              >
                <Sparkles size={14} aria-hidden="true" /> Ask assistant
              </button>
              {canFormat && (
                <button
                  className="text-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => taskFromWords(words)}
                >
                  <ListChecks size={14} aria-hidden="true" /> Make task
                </button>
              )}
              {askMenu && (
                <ul className="doc-ai-menu" role="menu">
                  {DOC_AI_ACTIONS.filter((a) => a !== "custom").map(
                    (action) => (
                      <li key={action}>
                        <button
                          role="menuitem"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void assist(words, action)}
                        >
                          {DOC_AI_LABELS[action].name}
                        </button>
                      </li>
                    ),
                  )}
                  <li>
                    <button
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void assist(words, "custom")}
                    >
                      {DOC_AI_LABELS.custom.name}…
                    </button>
                  </li>
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* Two columns and two children: the page with everything that belongs
          under it, and the margin. Ask, suggestions and the margin used to be
          three more children of the grid itself, so auto-placement put Ask in
          the margin and pushed the remarks below the page. */}
      <div
        className={
          "doc-layout" + (showHistory ? " has-history" : " has-comments")
        }
      >
        <div className="doc-main">
          {historyView && (
            <DocChanges
              view={historyView}
              current={blocks}
              title={title}
              canRestore={canWrite && structural}
              onCompare={(compare) =>
                setHistoryView({ ...historyView, compare })
              }
              onRestoreLine={(source, index) => {
                update(restoreLine(blocks, source, index));
                toast({ text: "Line restored" });
              }}
              onClose={() => setHistoryView(null)}
            />
          )}
          <div className="doc-page" ref={pageRef} hidden={!!historyView}>
            {doc.kind === "doc" && (
              <PageFreshness doc={doc} canWrite={canWrite} />
            )}
            {reading ? (
              <h1 className="doc-title is-reading">{title || "Untitled"}</h1>
            ) : (
              // A textarea so a long title wraps instead of running out of
              // the page; it is still one line of text, so Enter is ignored.
              <textarea
                id="doc-title"
                className="doc-title"
                rows={1}
                value={title}
                placeholder="Untitled"
                maxLength={200}
                ref={fitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                onChange={(e) => {
                  const next = e.target.value.replace(/\s*\n\s*/g, " ");
                  fitTitle(e.target);
                  setTitle(next);
                  queueSave(next, blocks);
                }}
              />
            )}
            <PageTags
              docId={doc.id}
              teamId={doc.team_id}
              tags={tags}
              canWrite={canWrite && !reading}
              // The library reads tags afresh on the way back to it.
              onChange={setTags}
              report={report}
            />

            <div className="doc-body" ref={bodyRef}>
              {blocks.map((block, index) =>
                focused === index && (!reading || suggesting) ? (
                  <textarea
                    key={`${index}-${block.type}`}
                    id={`doc-block-${index}`}
                    ref={areaRef}
                    className="doc-input"
                    // A nested line is typed where it reads, stepped in.
                    data-depth={layout[index].depth || undefined}
                    style={
                      layout[index].depth
                        ? ({ "--depth": layout[index].depth } as CSSProperties)
                        : undefined
                    }
                    rows={1}
                    defaultValue={serializeBlock(block, layout[index].number)}
                    onPaste={(e) => onPaste(e, index)}
                    onChange={(e) => {
                      e.currentTarget.style.height = "auto";
                      e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                      watchSlash(index, e.currentTarget.value, e.currentTarget);
                      editBlock(index, e.currentTarget.value);
                    }}
                    onKeyDown={(e) => {
                      // The slash menu owns Enter and the arrows while it is open.
                      if (
                        slash &&
                        ["Enter", "ArrowUp", "ArrowDown"].includes(e.key)
                      )
                        return;
                      onKey(e, index);
                    }}
                    onBlur={() => {
                      if (suggesting) void proposeLine(index);
                      else settlePendingTask(index);
                      setFocused((f) => (f === index ? null : f));
                    }}
                  />
                ) : (
                  <div
                    key={index}
                    data-block-id={block.id ?? undefined}
                    data-block-source={blockText(block)}
                    className={
                      "doc-block-row" +
                      (block.id && commented[block.id]?.length
                        ? " has-comment"
                        : "") +
                      (block.id && block.id === activeComment
                        ? " is-active"
                        : "")
                    }
                    ref={(el) => {
                      if (!block.id) return;
                      if (el) blockEls.current.set(block.id, el);
                      else blockEls.current.delete(block.id);
                    }}
                    onClick={() =>
                      block.id &&
                      commented[block.id]?.length &&
                      setActiveComment(block.id)
                    }
                  >
                    {!reading && (
                      <button
                        className="doc-handle"
                        aria-label="Block options"
                        aria-haspopup="menu"
                        onClick={(e) =>
                          setMenu({
                            index,
                            at: e.currentTarget.getBoundingClientRect(),
                          })
                        }
                      >
                        <GripVertical size={14} aria-hidden="true" />
                      </button>
                    )}
                    <div
                      className="doc-block"
                      role={reading && !suggesting ? undefined : "button"}
                      tabIndex={reading && !suggesting ? undefined : 0}
                      onClick={() => {
                        if (reading && !suggesting) return;
                        // A click that ends a drag is a selection, not a
                        // request to edit: opening the input here would throw
                        // the selected words away before they can be used.
                        if (!window.getSelection()?.isCollapsed) return;
                        setFocused(index);
                      }}
                      onKeyDown={(e) => {
                        if ((!reading || suggesting) && e.key === "Enter") {
                          e.preventDefault();
                          setFocused(index);
                        }
                      }}
                    >
                      <BlockView
                        block={block}
                        marks={
                          block.id
                            ? [
                                ...(commented[block.id] ?? []),
                                ...proposedMarks[block.id],
                              ]
                            : []
                        }
                        onToggleTodo={
                          structural ? () => toggleTodo(index) : undefined
                        }
                        number={layout[index].number}
                        depth={layout[index].depth}
                      />
                    </div>
                  </div>
                ),
              )}
              {!reading && structural && (
                <button
                  className="doc-add"
                  onClick={() => insertAfter(blocks.length - 1)}
                >
                  <Plus size={14} aria-hidden="true" /> Add a block
                  <kbd>/</kbd>
                </button>
              )}
              {menu && (
                <DocBlockMenu
                  anchor={menu.at}
                  block={blocks[menu.index]}
                  isFirst={menu.index === 0}
                  isLast={menu.index === blocks.length - 1}
                  onTurnInto={(kind) => turnInto(menu.index, kind)}
                  onMove={(by) => moveBlock(menu.index, by)}
                  onDuplicate={() => duplicate(menu.index)}
                  onComment={() => commentOn(menu.index)}
                  onDelete={() => removeAt(menu.index)}
                  onIndent={(by) => indent(menu.index, by)}
                  canIndent={indentBlocks(blocks, menu.index, 1) !== blocks}
                  canOutdent={indentBlocks(blocks, menu.index, -1) !== blocks}
                  structural={structural}
                  onClose={() => setMenu(null)}
                />
              )}
              {slash && (
                <SlashMenu
                  anchor={slash.at}
                  query={slash.query}
                  insertsOnly={slash.insertsOnly}
                  onPick={pickSlash}
                  onClose={() => setSlash(null)}
                />
              )}
            </div>

            {/* One quiet line at the end of the page. The Markdown help
                shows only while a line is open, when it is useful. */}
            {focused !== null && !reading && (
              <p className="doc-hint">
                Start a line with <code>#</code> for a heading, <code>-</code>{" "}
                for a bullet, <code>- [ ]</code> for a checkbox or{" "}
                <code>/</code> for more. <kbd>Tab</kbd> tucks a list item in;
                select words to style them.
              </p>
            )}
            <p className="doc-footer">
              {pageFooter({
                ...stats,
                selected: words ? countWords(plainText(words.quote)) : 0,
                savedAt,
                saving: save === "saving",
                failed: save === "error",
                now,
              })}
            </p>
          </div>
          {!showHistory && (
            <DocSuggestions
              suggestions={suggestions}
              canDecide={canWrite}
              userId={userId}
              busy={deciding}
              onDecide={decide}
              onWithdraw={withdraw}
            />
          )}
        </div>
        {!showHistory && (
          <>
            <DocComments
              docId={doc.id}
              blocks={blocks}
              tops={tops}
              userId={userId}
              pending={pending}
              onPendingChange={setPending}
              active={activeComment}
              onActiveChange={setActiveComment}
              onAnchors={setCommented}
              report={report}
            />
          </>
        )}
        {showHistory && (
          <DocHistory
            doc={doc}
            canWrite={canWrite}
            onClose={() => {
              setShowHistory(false);
              setHistoryView(null);
            }}
            viewing={historyView}
            onView={setHistoryView}
            report={report}
            onRestored={(restored) => {
              // The restored page is the page now: adopt it whole.
              version.current = restored.version;
              base.current = restored.content;
              dirty.current = false;
              setTitle(restored.title);
              setBlocks(
                restored.content.length
                  ? restored.content
                  : [{ type: "paragraph", text: "" }],
              );
              toast({ text: "Restored an earlier version" });
              onChanged(restored);
            }}
          />
        )}
      </div>

      {savingTemplate && (
        <SaveTemplateDialog
          doc={doc}
          canShare={canWrite}
          onClose={() => setSavingTemplate(false)}
          onSaved={(t) =>
            toast({
              text: `Saved “${t.name}” as a template. Start a page from it with From template.`,
            })
          }
        />
      )}

      {chat && (
        <DocChat
          docId={doc.id}
          blocks={blocks}
          canWrite={canWrite || suggesting}
          onGoToBlock={goToBlock}
          onNameBlock={nameBlock}
          onSuggested={(made) => setSuggestions((list) => [...list, made])}
          onClose={() => setChat(false)}
        />
      )}
    </div>
  );
}

import { useConfirm } from "../../components/Confirm";
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
  Check,
  Copy,
  Download,
  GripVertical,
  History,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  BLOCK_KINDS,
  blockToType,
  blockText,
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  EXPORT_FORMATS,
  EXPORT_LABELS,
  proposeEdit,
  type DocAiAction,
  type ExportFormat,
  type DocMode,
  type DocSuggestion,
  adoptTaskTicks,
  carryBlockIds,
  mergeDocs,
  newBlockId,
  parseDoc,
  serializeBlock,
  serializeDoc,
  setTodoSource,
  type Doc,
  type DocBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { DocModeSwitch } from "./DocModeSwitch";
import { DocViewers } from "./DocViewers";
import { PageFreshness } from "./PageFreshness";
import { DocChat } from "./DocChat";
import { DocSuggestions } from "./DocSuggestions";
import type { Mark } from "./marks";
import { readSelection, type Picked } from "./selection";
import { BlockView } from "./DocBlocks";
import { DocBlockMenu, SlashMenu } from "./DocBlockMenu";
import { DocComments } from "./DocComments";
import { DocHistory } from "./DocHistory";

type Kind = (typeof BLOCK_KINDS)[number];

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
}: {
  doc: Doc;
  /** Left out for the agenda, which has no list to go back to. */
  onBack?: () => void;
  onChanged: (doc: Doc) => void;
  onDeleted: (id: string) => void;
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
  const { ask, tell } = useConfirm();
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
  /** The lines tied to a task, as the server last said. */
  const linked = useMemo(
    () => new Set(doc.linked_block_ids ?? []),
    [doc.linked_block_ids],
  );
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
  /** The lines themselves: the button over a selection stays inside them. */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const blockEls = useRef(new Map<string, HTMLElement>());
  /** A line that starts with "/", waiting for a kind to be picked. */
  const [slash, setSlash] = useState<{
    index: number;
    query: string;
    at: DOMRect;
  } | null>(null);

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
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Take the ticks a save came back with for the lines tied to tasks. A
   * repeating task ticked here has moved on to its next occurrence and reads
   * unticked again; showing the old tick would send it back with the next
   * save. A line ticked or unticked again since keeps what was done here.
   * Whatever it took is saved straight away: the page has to have said a
   * line is unticked before ticking it again counts as a new tick.
   */
  const adoptTicks = useCallback((sent: DocBlock[], saved: Doc): boolean => {
    const { blocks: next, changed } = adoptTaskTicks(
      live.current.blocks,
      sent,
      saved,
    );
    if (!changed.length) return false;
    // A line open for editing holds its own copy of its Markdown.
    const at = focusedRef.current;
    const open = at === null ? undefined : next[at];
    if (
      areaRef.current &&
      open?.type === "todo" &&
      open.id &&
      changed.includes(open.id)
    )
      areaRef.current.value = setTodoSource(areaRef.current.value, open.done);
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
          if (adoptTicks(nextBlocks, saved)) saveAgain();
          setSave("saved");
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
              if (adoptTicks(merged, saved)) saveAgain();
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
    [doc.id, onChanged, reconcile, report, adoptTicks, saveAgain],
  );
  persistRef.current = persist;

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
      // What is on screen when the clock runs out, not when it started: a
      // save or a merge that landed meanwhile may have changed it.
      timer.current = setTimeout(
        () => void persist(live.current.title, live.current.blocks),
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
    };
  }, []);

  /**
   * The subscription must outlive re-renders: it depends on the document,
   * not on callbacks that are rebuilt each time the page is typed into.
   * Without this the stream was torn down and reopened on every keystroke.
   */
  const onEvent = useRef<(version: number) => void>(() => {});
  onEvent.current = (remote: number) => {
    if (remote && remote <= version.current) return;
    void client.getDoc(doc.id).then((theirs) => {
      if (theirs.version <= version.current) return;
      // A line open for editing counts as ours even before a keystroke:
      // replacing the whole page would pull the text out from under it.
      if (!dirty.current && focusedRef.current === null) {
        version.current = theirs.version;
        base.current = theirs.content;
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
  useEffect(() => client.watchDoc(doc.id, (v) => onEvent.current(v)), [doc.id]);

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
    update(next);
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
    const change = proposeEdit(block.id, serializeBlock(block), typed);
    if (!change) return;
    try {
      const made = await client.proposeDocChanges(doc.id, [change]);
      setSuggestions((list) => [...list, ...made]);
      setNote("Suggested. It waits for someone to take it.");
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
    setNote("Asking the assistant…");
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
      setNote("");
      report(e);
    }
  };

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
    const next = blocks.slice();
    // Enter at the end of a list item makes another; on an empty one it
    // leaves the list instead, the way every editor since Word has.
    if (LISTS.has(current.type)) {
      if (!("text" in current) || current.text.trim() === "") {
        next[index] = { type: "paragraph", text: "" };
        update(next);
        return;
      }
      next.splice(
        index + 1,
        0,
        blockToType({ type: "paragraph", text: "" }, current.type),
      );
    } else next.splice(index + 1, 0, { type: "paragraph", text: "" });
    update(next);
    setFocused(index + 1);
  };

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
      const typed = suggestDraft.current ?? serializeBlock(blocks[index]);
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

  /** A "/" at the start of an empty line asks what the line should be. */
  const watchSlash = (
    index: number,
    value: string,
    el: HTMLTextAreaElement,
  ) => {
    const m = /^\/([^\s]*)$/.exec(value);
    if (m && blocks[index].type === "paragraph")
      setSlash({ index, query: m[1], at: el.getBoundingClientRect() });
    else if (slash) setSlash(null);
  };

  const pickSlash = (kind: Kind) => {
    if (!slash) return;
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

  const onKey = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number,
  ) => {
    const value = e.currentTarget.value;
    const multiline =
      blocks[index].type === "code" || blocks[index].type === "math";
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

  // The page reflows as it is typed into and as the window changes shape.
  useEffect(() => {
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [measure]);

  const markdown = useMemo(() => serializeDoc(blocks), [blocks]);

  /**
   * Take the page away as a file. The server decides what the file holds
   * and what it is called, so a page saved from a phone and a page saved
   * from here are the same file.
   */
  const download = async (format: ExportFormat) => {
    setDownloadMenu(false);
    setNote(`Making the ${EXPORT_LABELS[format].name} file…`);
    try {
      const { blob, name } = await client.exportDoc(doc.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setNote("");
    } catch (e) {
      setNote("");
      report(e);
    }
  };

  // Lines already tied to a task are not offered again. The server says
  // which: every line gets an id once it's remarked on, so an id alone
  // doesn't make a line a task. An agenda's lines copy tasks you already
  // have, so it offers none.
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

  /** Turn the unticked checklist lines into real tasks. */
  const makeTasks = () =>
    void (async () => {
      // Save first so the server works from what's on screen.
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) await persist(title, blocks);
      try {
        const { created, doc: updated } = await client.docToTasks(doc.id);
        // The server ties each line to its task and hands back the document;
        // adopting it keeps the ids, so the lines now follow their tasks.
        if (updated) {
          version.current = updated.version;
          base.current = updated.content;
          dirty.current = false;
          setBlocks(updated.content);
          setSave("saved");
          onChanged(updated);
        }
        onItemsChanged?.();
        await tell({
          title:
            created === 0
              ? "Every item here is already a task."
              : `Added ${created} task${created === 1 ? "" : "s"} to your planner. Ticking one here ticks it there.`,
        });
      } catch (e) {
        report(e);
      }
    })();

  const remove = async () => {
    if (
      !(await ask({
        title: `Delete “${title || "Untitled"}”? This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void client
      .deleteDoc(doc.id)
      .then(() => {
        dirty.current = false;
        flushOnClose.current = () => {};
        onDeleted(doc.id);
      })
      .catch(report);
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
            onClick={() => setShowHistory((v) => !v)}
            aria-label="Page history"
            aria-pressed={showHistory}
            title="Page history"
          >
            <History size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(`# ${title}\n\n${markdown}`)
                .then(() => setNote("Copied as Markdown."), report)
            }
            aria-label="Copy as Markdown"
            title="Copy as Markdown"
          >
            <Copy size={15} />
          </button>
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
              onClick={remove}
              aria-label="Delete document"
              title="Delete document"
            >
              <Trash2 size={15} />
            </button>
          )}
        </span>
      </div>

      {/* The button that acts on a selection follows the words themselves,
          so it reads as belonging to them rather than to the page. */}
      {picked && !pending && (
        <div
          className="doc-selection-bar"
          style={barPlace(
            picked.at,
            bodyRef.current?.getBoundingClientRect().top ?? 0,
          )}
          role="toolbar"
          aria-label="Selected words"
        >
          <button
            className="text-button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commentOnSelection(picked)}
          >
            <MessageSquarePlus size={14} aria-hidden="true" /> Comment
          </button>
          {/* Asking for words and saying something about them are the two
              things anyone wants from a selection, so they sit together. */}
          <button
            className="text-button"
            aria-haspopup="menu"
            aria-expanded={askMenu}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAskMenu((v) => !v)}
          >
            <Sparkles size={14} aria-hidden="true" /> Ask AI
          </button>
          {askMenu && (
            <ul className="doc-ai-menu" role="menu">
              {DOC_AI_ACTIONS.filter((a) => a !== "custom").map((action) => (
                <li key={action}>
                  <button
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void assist(picked, action)}
                  >
                    {DOC_AI_LABELS[action].name}
                  </button>
                </li>
              ))}
              <li>
                <button
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void assist(picked, "custom")}
                >
                  {DOC_AI_LABELS.custom.name}…
                </button>
              </li>
            </ul>
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
          <div className="doc-page" ref={pageRef}>
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

            <div className="doc-body" ref={bodyRef}>
              {blocks.map((block, index) =>
                focused === index && (!reading || suggesting) ? (
                  <textarea
                    key={`${index}-${block.type}`}
                    id={`doc-block-${index}`}
                    ref={areaRef}
                    className="doc-input"
                    rows={1}
                    defaultValue={serializeBlock(block)}
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
                        isTask={!!block.id && linked.has(block.id)}
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
                  structural={structural}
                  onClose={() => setMenu(null)}
                />
              )}
              {slash && (
                <SlashMenu
                  anchor={slash.at}
                  query={slash.query}
                  onPick={pickSlash}
                  onClose={() => setSlash(null)}
                />
              )}
            </div>

            <p className="doc-hint">
              Click any line to edit it. Start a line with <code>#</code> for a
              heading, <code>-</code> for a bullet, <code>- [ ]</code> for a
              checkbox, <code>&gt;</code> to quote, <code>```</code> for code or{" "}
              <code>$$</code> for a formula. Inline maths goes between single{" "}
              <code>$</code> signs.
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
            onClose={() => setShowHistory(false)}
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
              setNote("Restored an earlier version.");
              onChanged(restored);
            }}
          />
        )}
      </div>

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

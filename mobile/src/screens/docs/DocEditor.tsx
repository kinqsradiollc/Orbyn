import { DocLatexPreviewProvider } from "./DocLatexPreview";
import { DocEditorModes, type DocumentEditorMode } from "./DocEditorModes";
import { Icon } from "../../components/Icon";
import { docContainerBlocks, maintainedPageDraftSaved } from "@orbyn/core";
import { PageMaintenanceSheet } from "./PageMaintenanceSheet";
import { DocNavigationContext } from "./doc-navigation";
import { DocSourceAsk } from "./DocSourceAsk";
import { DocSourcePreview } from "./DocSourcePreview";
import { StructuredDocEditor } from "./StructuredDocEditor";
import { commentDraftScope, CommentDraftContext } from "./doc-comment-drafts";
import { openAppUrl } from "../../hooks/useAppLinks";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useWindowDimensions,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import {
  blocksToClipboard,
  docFragmentIndex,
  docFoldsForTarget,
  parseAppLink,
  EMBED_LANG,
  embedText,
  emptyTable,
  foldableHeadings,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  highlightCards,
  movedRange,
  nextFootnoteLabel,
  pageFileType,
  PAGE_FILE_TYPES,
  toolbarTint,
  withClozeLines,
  type HighlightTint,
  type RelatedPage,
  addedInlineTags,
  adoptTaskTicks,
  BLOCK_KINDS,
  LIVE_LIST_LANG,
  liveListText,
  blockDepth,
  blockText,
  blockToType,
  canRedo,
  canStyleLine,
  canUndo,
  carryBlockIds,
  carryNewIds,
  docStats,
  docOutline,
  type OutlineEntry,
  emptyUndo,
  EXPORT_LABELS,
  indentBlocks,
  keepStart,
  listLayout,
  pageStatus,
  isOfflineError,
  pastedLines,
  recordUndo,
  redoStep,
  stylesAt,
  textToBlocks,
  toolbarLink,
  insertLink,
  linkMarkdown,
  linkQueryAt,
  slashMatches,
  slashQueryAt,
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
  editDocSource,
  ticksTakenFrom,
  proposeEdit,
  mentionMarkdown,
  mentionQuery,
  type Doc,
  type DocBlock,
  type Favourite,
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
import { readsFirst } from "../../lib/reading";
import { forgetPage, rememberPage } from "../../lib/pageCache";
import { savePageOffline } from "../../lib/outbox";
import { PublishSheet } from "./PublishSheet";
import { downloadDoc, formatsHere } from "../../lib/download";
import { copyLink, shareLink, sharePageFile } from "../../lib/share";
import { currentDoc, setOpenDoc } from "../../lib/live";
import { BottomSheet } from "../../components/BottomSheet";
import { SmallAction } from "../../components/SmallAction";
import { ActionSheet, type MoreAction } from "../../components/MoreMenu";
import { HeaderButton } from "../../components/Sheet";
import { SlotFill, type SlotHandle } from "../../components/Slot";
import type { DocNews } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session as authSession } from "../../lib/session";

import { showToast } from "../../components/Toast";
import { tap } from "../../lib/haptics";
import { SaveTemplatePanel } from "./PageTemplates";
import {
  INSERTS,
  LineToolbar,
  kindKey,
  type LineInsert,
  type LineKind,
} from "./LineToolbar";
import { MentionStrip, type MentionPerson } from "./MentionStrip";
import { PageInfo } from "./PageInfo";
import { ContentsSheet } from "./ContentsSheet";
import {
  LinkedHere,
  LinkPickerPanel,
  LinkPillProvider,
  openObject,
  useLinkPills,
} from "./links";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  FootnoteContext,
  RecordingContext,
  TableEditor,
  fileLink,
} from "./RichBlocks";
import { PresentSheet } from "./PresentSheet";
import { announceStars, rememberLastPage } from "../../lib/accountPrefs";
import { RecordSheet, RecordingSummarySheet } from "./RecordSheet";
import { LinkCardSheet } from "./LinkCardSheet";
import { EmbedSheet, MergeSheet, TemplateSheet } from "./PageActions";
import { LookEditor } from "../../components/LookEditor";
import { CoverImage, LookIconView } from "../../components/Look";
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

function LegacyDocEditor({
  doc,
  beforeLeave,
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
  onShowInLibrary,
  onMoveTo,
  report,
}: {
  doc: Doc;
  beforeLeave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** Close the page and show where it is in the library (ORG-03). */
  onShowInLibrary?: () => void;
  /** "Move to…": a folder, or inside another page (W5). */
  onMoveTo?: () => void;
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
    // Kept on the phone, to open with no signal (SHR-03).
    void rememberPage(doc);
    // "Open to: the last page" (NAV-12) opens this one next time.
    rememberLastPage(doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);
  /**
   * A page opens the way it was last worked on, and always read-only for
   * someone who cannot change it: landing in an editor that will refuse the
   * first save is worse than not being offered one.
   */
  const [mode, setMode] = useState<DocMode>(() =>
    canWrite
      ? // The agenda is read more than written, so it opens for reading;
        // so does every page on a phone set to read first (EDT-10).
        (readLocal(MODE_KEY + doc.id) ??
          (doc.kind === "agenda" || readsFirst() ? "read" : "edit")) === "read"
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
  const suggestionOwner = useRef({ id: doc.id, userId });
  suggestionOwner.current = { id: doc.id, userId };
  const suggestionMounted = useRef(true);
  const renderAccount = authSession.token;
  const currentPage = () =>
    suggestionMounted.current &&
    suggestionOwner.current.id === doc.id &&
    authSession.token === renderAccount;
  const writeAllowed = useRef(canWrite);
  writeAllowed.current = canWrite;
  const creatingLink = useRef(false);
  const uploadingFiles = useRef(false);
  const deleting = useRef(false);
  const archiving = useRef(false);
  const [archivingPage, setArchivingPage] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const creatingTasks = useRef(false);
  const [tasksBusy, setTasksBusy] = useState(false);
  const suggestionRead = useRef(0);
  const suggestionMutation = useRef<object | null>(null);
  useEffect(() => {
    suggestionMounted.current = true;
    return () => {
      suggestionMounted.current = false;
      suggestionRead.current++;
    };
  }, []);

  const [title, setTitle] = useState(doc.title);
  const bodyOffset = useRef<number | null>(null);
  const targetLine = useRef<number | null>(null);
  /** Where each line sits in the body, and where "Linked here" is. */
  const lineYs = useRef(new Map<number, number>());
  const linkedY = useRef<number | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [footnote, setFootnote] = useState<{
    label: string;
    words: string;
  } | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const { width: documentWidth, fontScale: documentScale } =
    useWindowDimensions();
  const sourceBesideNote = documentWidth / Math.max(1, documentScale) >= 900;
  const [sourcePreviewMode, setSourcePreviewMode] = useState<
    "markdown" | "latex"
  >("markdown");
  const sourceLeaveCheck = useRef<(() => boolean) | null>(null);
  const sourcePreviewOwner = useRef(sourcePreview);
  sourcePreviewOwner.current = sourcePreview;
  const [sourceAsk, setSourceAsk] = useState<{
    blockId: string;
    start: number;
    end: number;
    quote: string;
  } | null>(null);
  useEffect(() => {
    bodyOffset.current = null;
    targetLine.current = null;
    lineYs.current.clear();
  }, [doc.id]);
  const sendTarget = () => {
    const index = targetLine.current;
    if (index === null || bodyOffset.current === null) return;
    const y = lineYs.current.get(index);
    if (y === undefined) return;
    targetLine.current = null;
    onTargetOffset?.(bodyOffset.current + y);
    setFlash(blocks[index]?.id ?? null);
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
  const [saveFailure, setSaveFailure] = useState(false);
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
  const commentDrafts = useContext(CommentDraftContext);
  const threadNavigation = useRef(false);
  const threadState = useRef({ open: openThread, pending: pending?.blockId });
  threadState.current = { open: openThread, pending: pending?.blockId };
  const requestThread = async (next: string | null, update?: () => void) => {
    if (threadNavigation.current || !currentPage()) return;
    threadNavigation.current = true;
    const previous = threadState.current;
    try {
      if (next !== previous.open || update) {
        for (const scope of new Set([previous.open, previous.pending]))
          if (
            scope &&
            commentDrafts &&
            !(await commentDrafts.prepare(commentDraftScope(scope)))
          )
            return;
      }
      if (
        !currentPage() ||
        threadState.current.open !== previous.open ||
        threadState.current.pending !== previous.pending
      )
        return;
      setPending((current) => (current?.blockId === next ? current : null));
      setOpenThread(next);
      update?.();
    } finally {
      threadNavigation.current = false;
    }
  };
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
  /** Whether "Publish to web" is open (SHR-05). */
  const [publishing, setPublishing] = useState(false);
  const [maintaining, setMaintaining] = useState(false);
  /** Headings folded on this page (EDT-14), yours on every device. */
  const [folds, setFolds] = useState<Set<string>>(() => new Set());
  const [foldsLoaded, setFoldsLoaded] = useState(false);
  const foldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let live = true;
    setFolds(new Set());
    setFoldsLoaded(false);
    client.docFolds(doc.id).then(
      (r) => {
        if (live && currentPage()) {
          setFolds(new Set(r.block_ids));
          setFoldsLoaded(true);
        }
      },
      () => {
        if (live && currentPage()) setFoldsLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, [doc.id]);
  /** A line just jumped to, lit for a moment (LNK-04). */
  const [flash, setFlash] = useState<string | null>(null);
  /** A link pill held down: its card (LNK-07). */
  const [card, setCard] = useState<ObjectRef | null>(null);
  /** The table whose cells are open, the template, embed and merge sheets. */
  const [tableEdit, setTableEdit] = useState<{
    index: number;
    block: Extract<DocBlock, { type: "table" }>;
  } | null>(null);
  const setTableAt = (index: number | null) => {
    const block = index === null ? null : live.current.blocks[index];
    setTableEdit(
      index !== null && block?.type === "table" ? { index, block } : null,
    );
  };
  const [templateAt, setTemplateAt] = useState<number | null>(null);
  const [embedAt, setEmbedAt] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);
  /** Presenting as slides (CNV-03); recording into the page (CAP-10). */
  const [presenting, setPresenting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [summarising, setSummarising] = useState<{
    fileId: string;
    name: string;
  } | null>(null);
  const recordingActions = useMemo(
    () => ({
      summarise: (fileId: string, name: string) =>
        setSummarising({ fileId, name }),
    }),
    [],
  );
  /** This page's star and its starred headings (NAV-07). */
  const [stars, setStars] = useState<Favourite[]>([]);
  useEffect(() => {
    let live = true;
    client.listFavourites().then(
      (all) =>
        live &&
        currentPage() &&
        setStars(
          all.filter(
            (f) =>
              (f.kind === "doc" || f.kind === "heading") &&
              f.target_id === doc.id,
          ),
        ),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [doc.id]);
  const pageStarred = stars.some((f) => f.kind === "doc");
  const starredHeadings = useMemo(
    () =>
      new Set(
        stars.filter((f) => f.kind === "heading").map((f) => f.block_id ?? ""),
      ),
    [stars],
  );
  /** Archived (SRCH-03): out of the library and search until brought back. */
  const [archived, setArchived] = useState(!!doc.archived);
  /** The page's Info, its ⋯ menu, and the two menus ⋯ leads to. */
  const appearanceDocId = useRef(doc.id);
  appearanceDocId.current = doc.id;
  const [appearance, setAppearance] = useState({
    icon: doc.icon ?? null,
    cover_file_id: doc.cover_file_id ?? null,
  });
  useEffect(
    () =>
      setAppearance({
        icon: doc.icon ?? null,
        cover_file_id: doc.cover_file_id ?? null,
      }),
    [doc.id, doc.icon, doc.cover_file_id],
  );
  const [lookOpen, setLookOpen] = useState(false);
  useEffect(() => setLookOpen(false), [doc.id]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menu, setMenu] = useState<"page" | "share" | "export" | null>(null);
  /** People who can open the page, for "@" (loaded the first time). */
  const [people, setPeople] = useState<MentionPerson[] | null>(null);
  const [peopleFailed, setPeopleFailed] = useState(false);
  const [peopleAttempt, setPeopleAttempt] = useState(0);
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
  /** The title as last saved: what an offline edit's title is measured from. */
  const baseTitle = useRef(doc.title);
  /** An edit is kept on this phone, waiting for a connection (SHR-03). */
  const [keptOffline, setKeptOffline] = useState(false);
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
    return () => {
      if (currentDoc() === doc.id) setOpenDoc(null);
    };
  }, [doc.id]);

  /** Add to the page the #tags typed into it since they were last looked at. */
  const settleTags = useRef<() => void>(() => {});
  /** Set once the page goes to Trash: there is nothing left to tag. */
  const gone = useRef(false);
  settleTags.current = () => {
    if (gone.current || authSession.token !== renderAccount) return;
    const now = live.current.blocks;
    const added = addedInlineTags(tagBase.current, now);
    tagBase.current = now;
    if (!added.length || !canWrite) return;
    client.addDocTags(doc.id, added).then(
      ({ tags: next }) => {
        if (currentPage()) setTags(next);
      },
      (e) => {
        if (currentPage()) report(e);
      },
    );
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
        if (
          gone.current ||
          authSession.token !== renderAccount ||
          !writeAllowed.current
        )
          return;
        if (currentPage()) setSaving(true);
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
          if (authSession.token !== renderAccount) return;
          version.current = saved.version;
          base.current = saved.content;
          baseTitle.current = saved.title;
          dirty.current =
            live.current.title !== nextTitle ||
            live.current.blocks !== nextBlocks;
          setSavedAt(saved.updated_at);
          setNow(new Date());
          setKeptOffline(false);
          if (currentPage()) setSaveFailure(false);
          void rememberPage(saved);
          settle(nextBlocks, saved);
          if (currentPage()) onChanged(saved);
        } catch (e) {
          if (authSession.token !== renderAccount) return;
          // No signal: the edit is kept on the phone and sent when it's back,
          // merged into whatever the page became meanwhile (SHR-03).
          if (isOfflineError(e)) {
            try {
              await savePageOffline({
                id: doc.id,
                title: nextTitle,
                content: nextBlocks,
                base: {
                  version: version.current,
                  title: baseTitle.current,
                  content: base.current,
                },
              });
              if (authSession.token !== renderAccount) return;
              void rememberPage({
                ...doc,
                title: nextTitle,
                content: nextBlocks,
              });
              if (currentPage()) {
                setKeptOffline(true);
                setSaveFailure(false);
              }
            } catch (storageError) {
              if (currentPage()) {
                setSaveFailure(true);
                report(storageError);
              }
            }
            return;
          }

          // Someone saved first: take their copy, fold this edit into it and
          // save again rather than making the writer sort it out by hand.
          if ((e as { statusCode?: number }).statusCode === 409) {
            try {
              const remote = await client.getDocForEditor(doc.id);
              if (authSession.token !== renderAccount || !writeAllowed.current)
                return;
              if (remote.document?.format === 2)
                throw new Error(
                  "This page changed format. Keep your draft and reopen it before saving.",
                );
              const merged = reconcile(remote);
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
              if (authSession.token !== renderAccount) return;
              version.current = saved.version;
              base.current = saved.content;
              dirty.current =
                live.current.title !== mergedTitle ||
                live.current.blocks !== merged;
              setSavedAt(saved.updated_at);
              baseTitle.current = saved.title;
              if (currentPage()) setSaveFailure(false);
              settle(merged, saved);
              if (currentPage()) onChanged(saved);
            } catch (again) {
              if (currentPage()) {
                setSaveFailure(true);
                report(again);
              }
            }
          } else if (currentPage()) {
            setSaveFailure(true);
            report(e);
          }
        } finally {
          if (currentPage()) setSaving(false);
        }
      };
      saveQueue.current = saveQueue.current.then(write, write);
      return saveQueue.current;
    },
    [doc.id, onChanged, reconcile, report, settle],
  );
  persistRef.current = persist;
  useEffect(() => {
    if (!beforeLeave) return;
    const guard = async () => {
      if (
        sourceAsk ||
        (sourcePreviewOwner.current && !sourceLeaveCheck.current?.()) ||
        asking ||
        suggestionMutation.current ||
        uploadingFiles.current ||
        deleting.current ||
        archiving.current
      )
        return false;
      if (!currentPage()) return false;
      const at = focusedRef.current;
      if (
        suggesting &&
        at !== null &&
        sourceOf(live.current.blocks, at) !== draftRef.current
      )
        return false;
      const shown = canWrite && !suggesting ? onScreen() : live.current.blocks;
      if (
        canWrite &&
        !suggesting &&
        (dirty.current ||
          live.current.title !== baseTitle.current ||
          JSON.stringify(shown) !== JSON.stringify(base.current))
      ) {
        live.current = { ...live.current, blocks: shown };
        setBlocks(shown);
        dirty.current = true;
        await persistRef.current(live.current.title, shown);
      }
      await saveQueue.current;
      return currentPage() && !dirty.current;
    };
    beforeLeave.current = guard;
    return () => {
      if (beforeLeave.current === guard) beforeLeave.current = null;
    };
  }, [
    beforeLeave,
    sourceAsk,
    sourcePreview,
    asking,
    canWrite,
    suggesting,
    onScreen,
  ]);

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
  /** Bumped when someone else sets a field, so Info reads the values afresh. */
  const [fieldsStamp, setFieldsStamp] = useState(0);
  /** How many of the page's fields are filled in, for the status line. */
  const [propertyCount, setPropertyCount] = useState(0);
  useEffect(() => {
    let live = true;
    client.targetFields("page", doc.id).then(
      (f) =>
        live &&
        currentPage() &&
        setPropertyCount(
          f.fields.filter((field) => {
            const v = f.values[field.id];
            return (
              v !== null &&
              v !== undefined &&
              v !== "" &&
              !(Array.isArray(v) && !v.length)
            );
          }).length,
        ),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [doc.id, fieldsStamp]);
  const onEvent = useRef<(version: number, news: DocNews) => void>(() => {});
  onEvent.current = (
    remote: number,
    { trashed, forgotten, tags: retagged, fields: refielded, by }: DocNews,
  ) => {
    if (!currentPage()) return;
    // Moved to Trash somewhere else: let the page go, rather than keep
    // typing into something every save will now refuse.
    if (trashed || forgotten) {
      if (timer.current) clearTimeout(timer.current);
      dirty.current = false;
      flushOnClose.current = () => {};
      gone.current = true;
      onDeleted?.();
      showToast({
        text: forgotten
          ? `“${live.current.title || "Untitled"}” was permanently forgotten.`
          : `“${live.current.title || "Untitled"}” was moved to Trash. It can be restored from there.`,
      });
      return;
    }
    // Someone set a field: Info reads the values afresh, the words stay.
    if (refielded) {
      setFieldsStamp((n) => n + 1);
      return;
    }
    // Someone changed the page's tags: the row follows, the words stay.
    if (retagged) {
      void client.getDoc(doc.id).then(
        (theirs) => {
          if (currentPage()) setTags(theirs.tags ?? []);
        },
        (e) => {
          if (currentPage()) report(e);
        },
      );
      return;
    }
    if (remote && remote <= version.current) return;
    void client.getDocForEditor(doc.id).then((theirs) => {
      if (!currentPage()) return;
      if (theirs.version <= version.current) return;
      if (theirs.document?.format === 2) {
        if (dirty.current || focusedRef.current !== null) {
          setNote(
            "This page changed format. Keep your draft and reopen it before saving.",
          );
          return;
        }
        onChanged(theirs);
        return;
      }
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
        setSavedAt(theirs.updated_at);
        setNow(new Date());
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
    if (!currentPage() || !writeAllowed.current) return;
    setBlocks(next);
    queueSave(live.current.title, next);
  };

  /**
   * Keep the page as it stands, before a change, for Undo. Typing (`kind`
   * "type") joins the step before it until a pause.
   */
  const remember = (kind?: string) => {
    history.current = recordUndo(
      history.current,
      {
        title: live.current.title,
        blocks: live.current.blocks,
        focused: focusedRef.current,
        draft: draftRef.current,
      },
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

  /** Bold, Italic, Strikethrough or Highlight on the chosen words, or off them. */
  const styleLine = (style: "bold" | "italic" | "highlight" | "strike") => {
    const next = toolbarStyle(draft, sel.current.start, sel.current.end, style);
    if (!next) {
      showToast({ text: "Those words already have another style." });
      return refocus();
    }
    applyEdit(next);
  };

  /** The chosen words highlighted green or pink (EDT-05). */
  const tintLine = (tint: HighlightTint) => {
    const next = toolbarTint(draft, sel.current.start, sel.current.end, tint);
    if (!next) {
      showToast({ text: "Choose the words to highlight first." });
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
   * "/" typed at the start of the line or after a space (MOB-13): the kinds
   * of line, and what can be put in, listed under the line.
   */
  const slash =
    focused !== null &&
    !bracket &&
    !reading &&
    !suggesting &&
    openKind !== "code" &&
    openKind !== "math"
      ? slashQueryAt(draft, selection.start)
      : null;
  /** The suggestions under the line were closed where they started. */
  const [shutAt, setShutAt] = useState<string | null>(null);
  const suggestKey = (kind: string, start: number) =>
    `${focused}:${kind}:${start}`;
  /** An insert chosen from "/", run once the "/words" are gone. */
  const [slashInsert, setSlashInsert] = useState<LineInsert | "live" | null>(
    null,
  );
  useEffect(() => {
    if (!slashInsert) return;
    setSlashInsert(null);
    if (slashInsert === "live") liveListLine();
    else insertLine(slashInsert);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashInsert]);
  /** The line without the "/words" typed, and the caret where they were. */
  const withoutSlash = () => {
    if (!slash) return { text: draft, caret: selection.start };
    return {
      text: draft.slice(0, slash.start) + draft.slice(selection.start),
      caret: slash.start,
    };
  };

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
    if (!currentPage() || !writeAllowed.current || creatingLink.current) return;
    creatingLink.current = true;
    const originalLine = focusedRef.current;
    const originalDraft = draftRef.current;
    const originalBlock =
      originalLine === null ? null : live.current.blocks[originalLine];
    const originalSelection = { ...sel.current };
    try {
      const made =
        kind === "doc"
          ? await client.createDoc({
              title: name,
              team_id: doc.team_id,
              project_id: doc.project_id,
            })
          : await client.createItem({
              title: name,
              ...(doc.team_id ? { team_id: doc.team_id } : {}),
              ...(doc.project_id ? { project_id: doc.project_id } : {}),
            });
      if (!currentPage()) return;
      if (kind === "task") onItemsChanged?.();
      if (
        !writeAllowed.current ||
        (originalLine !== null &&
          live.current.blocks[originalLine] !== originalBlock) ||
        focusedRef.current !== originalLine ||
        draftRef.current !== originalDraft ||
        sel.current.start !== originalSelection.start ||
        sel.current.end !== originalSelection.end
      ) {
        showToast({
          text: `Created “${made.title}”. Your text changed, so no link was inserted.`,
          action: {
            label: "Open",
            run: () => {
              if (authSession.token === renderAccount)
                openObject({ kind, id: made.id });
            },
          },
        });
        return;
      }
      insertPicked({ kind, id: made.id }, made.title);
    } catch (e) {
      if (currentPage()) report(e);
    } finally {
      creatingLink.current = false;
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
      onCard: (ref: ObjectRef) => {
        Keyboard.dismiss();
        setCard(ref);
      },
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
  const turnInto = (kind: (typeof BLOCK_KINDS)[number], from = draft) => {
    if (focused === null) return;
    remember();
    const current = parseDoc(from)[0] ?? EMPTY;
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
    live.current = { ...live.current, blocks: next };
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    void persist(live.current.title, next);
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
    live.current = { ...live.current, blocks: placed };
    dirty.current = true;
    // Saved at once rather than on the usual delay: the remark about to be
    // written points at this name, and a name that is not saved is a remark
    // with nothing to hang on.
    if (timer.current) clearTimeout(timer.current);
    void persist(live.current.title, placed);
    return { blockId, source: blockText(parsed) };
  };

  const commentOnLine = () => {
    const line = settleLine();
    if (!line) return;
    void requestThread(line.blockId, () =>
      setPending({ blockId: line.blockId, quote: line.source.slice(0, 400) }),
    );
  };

  /** Comment on some of a line's words rather than all of it. */
  const commentOnWords = () => {
    const line = settleLine();
    if (!line) return;
    void requestThread(line.blockId, () => setPicking(line));
  };

  /**
   * The open line as a live list (SRCH-02): the page's project's open tasks,
   * or what's due this week. It shows its rows as soon as the line closes;
   * what it lists can be changed on the web or desktop.
   */
  const liveListLine = () => {
    if (focused === null || !structural) return;
    remember();
    const next = blocks.slice();
    next[focused] = {
      type: "code",
      lang: LIVE_LIST_LANG,
      id: blocks[focused].id,
      text: liveListText(
        doc.project_id
          ? {
              title: "Open tasks",
              definition: {
                source: "tasks",
                filters: { project: doc.project_id },
              },
            }
          : {
              title: "Due this week",
              definition: { source: "tasks", filters: { due_within_days: 7 } },
            },
      ),
    };
    setFocused(null);
    update(keepStart(next, focused));
    Keyboard.dismiss();
  };

  const deleteLine = async () => {
    if (
      focused === null ||
      !structural ||
      threadNavigation.current ||
      !currentPage() ||
      !writeAllowed.current
    )
      return;
    const index = focused;
    const target = live.current.blocks;
    const text = draftRef.current;
    threadNavigation.current = true;
    try {
      const blockId = target[index]?.id;
      if (
        blockId &&
        commentDrafts &&
        !(await commentDrafts.prepare(commentDraftScope(blockId)))
      )
        return;
      if (
        !currentPage() ||
        !writeAllowed.current ||
        live.current.blocks !== target ||
        focusedRef.current !== index ||
        draftRef.current !== text
      )
        return;
      remember();
      const next = target.slice();
      if (next.length > 1) next.splice(index, 1);
      else next.splice(index, 1, EMPTY);
      setFocused(null);
      if (blockId) {
        setOpenThread((open) => (open === blockId ? null : open));
        setPending((value) => (value?.blockId === blockId ? null : value));
      }
      update(next);
    } finally {
      threadNavigation.current = false;
    }
  };

  // ---- folding, line links, moving lines (EDT-14, LNK-04, ORG-05) ----
  const saveFolds = (next: Set<string>) => {
    setFolds(next);
    if (foldTimer.current) clearTimeout(foldTimer.current);
    foldTimer.current = setTimeout(() => {
      void client.setDocFolds(doc.id, [...next].slice(0, 200)).catch(() => {});
    }, 400);
  };
  const toggleFold = (blockId: string) => {
    const next = new Set(folds);
    if (next.has(blockId)) next.delete(blockId);
    else next.add(blockId);
    saveFolds(next);
  };

  const goToLine = (index: number) => {
    const next = docFoldsForTarget(blocks, folds, index);
    targetLine.current = index;
    if (next.size !== folds.size) {
      lineYs.current.clear();
      saveFolds(next);
    } else sendTarget();
  };
  const goToFragment = (fragment: string) => {
    const index = docFragmentIndex(blocks, fragment);
    if (index === null)
      return report(
        new Error("This heading or line is no longer in the page."),
      );
    goToLine(index);
  };
  useEffect(() => {
    if (initialBlockId && foldsLoaded) goToFragment(initialBlockId);
  }, [doc.id, initialBlockId, foldsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Everything waiting is saved, so the server has what is on screen. */
  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    const next = canWrite && !suggesting ? pageWithDraft() : null;
    if (next && unsaved(next)) await persist(live.current.title, next);
    await saveQueue.current;
  };

  /** "Copy link to this line": a link that opens the page there. */
  const copyLineLink = () => {
    const line = settleLine();
    if (!line) return;
    Keyboard.dismiss();
    void (async () => {
      await saveQueue.current;
      await copyLink(
        { kind: "doc", id: doc.id, block: line.blockId },
        title || "Untitled",
      );
    })().catch(report);
  };

  /**
   * "Move to new page" (ORG-05): the open line — a heading with its whole
   * section — becomes a page of its own, and a link takes its place.
   */
  const moveToNewPage = () => {
    if (focused === null || !structural) return;
    const at = focused;
    const settled = settleLine();
    if (!settled) return;
    Keyboard.dismiss();
    void (async () => {
      try {
        // Every line going needs a name the server knows.
        const now = live.current.blocks;
        const { start, end } = movedRange(now, at);
        const named = now.map((b, i) =>
          i >= start && i < end && !b.id ? { ...b, id: newBlockId() } : b,
        );
        if (named.some((b, i) => b !== now[i])) {
          setBlocks(named);
          live.current = { ...live.current, blocks: named };
          dirty.current = true;
        }
        await flush();
        const ids = named.slice(start, end).map((b) => b.id!);
        const { doc: made, source } = await client.extractToPage(doc.id, {
          block_ids: ids,
          version: version.current,
        });
        version.current = source.version;
        ticksFrom.current = source.version;
        base.current = source.content;
        dirty.current = false;
        setBlocks(source.content);
        live.current = { ...live.current, blocks: source.content };
        onChanged(source);
        showToast({
          text: `Moved to “${made.title}”. A link to it is left here.`,
          action: {
            label: "Open",
            run: () => openObject({ kind: "doc", id: made.id }),
          },
        });
      } catch (e) {
        report(e);
      }
    })();
  };

  // ---- pictures, files and other lines from the kinds panel (EDT-01) ----
  /** Put lines where the open line is: in its place when it's empty. */
  const placeLines = (
    made: DocBlock[],
    at: number | null = focusedRef.current,
  ) => {
    if (!made.length || !currentPage() || !writeAllowed.current) return null;
    const shown = live.current.blocks;
    const focusedAt = focusedRef.current;
    const current = shown.slice();
    if (at !== null && at === focusedAt && shown[at]) {
      const parsed = parseDoc(draftRef.current);
      current.splice(
        at,
        1,
        ...carryBlockIds(shown[at], parsed.length ? parsed : [EMPTY]),
      );
    }
    const next = current.slice();
    let placedAt: number;
    if (at === null || !next[at]) {
      placedAt = next.length;
      next.push(...made);
    } else {
      const here = next[at];
      const empty = here.type === "paragraph" && !blockText(here).trim();
      placedAt = empty ? at : at + 1;
      next.splice(placedAt, empty ? 1 : 0, ...made);
    }
    remember();
    setFocused(null);
    update(next);
    return placedAt;
  };

  type Picked = {
    name: string;
    uri: string;
    mime?: string | null;
    size?: number | null;
    width?: number;
    height?: number;
    file?: File;
  };

  /** Send pictures and files to Orbyn's file store, then into the page. */
  const addFiles = async (
    files: Picked[],
    at: number | null,
    anchor = at === null ? null : live.current.blocks[at],
  ) => {
    if (!files.length || !currentPage() || !writeAllowed.current) return;
    if (uploadingFiles.current)
      throw new Error("Wait for the current upload to finish.");
    uploadingFiles.current = true;
    try {
      showToast({
        text:
          files.length === 1
            ? `Adding “${files[0].name}”…`
            : `Adding ${files.length} files…`,
      });
      const made: DocBlock[] = [];
      for (const f of files) {
        if (!currentPage() || !writeAllowed.current) return;
        try {
          const mime = pageFileType(f.name, f.mime ?? undefined);
          if (!mime)
            throw new Error(
              `“${f.name}” can't go in a page: pictures, PDF, Word, Excel, PowerPoint, text and CSV files can.`,
            );
          const body: Blob =
            Platform.OS === "web" && f.file
              ? f.file
              : await (await fetch(f.uri)).blob();
          if (!currentPage() || !writeAllowed.current) return;
          const { file, upload_path } = await client.createPageFile(doc.id, {
            name: f.name.slice(0, 300) || "File",
            bytes: f.size ?? body.size,
            mime,
            ...(f.width && f.height
              ? { width: f.width, height: f.height }
              : {}),
          });
          if (!currentPage() || !writeAllowed.current) return;
          await client.uploadPageFile(upload_path, body, mime);
          if (!currentPage()) return;
          made.push(
            file.kind === "image"
              ? { type: "image", file: file.id, text: "", id: newBlockId() }
              : {
                  type: "file",
                  file: file.id,
                  text: file.name,
                  id: newBlockId(),
                },
          );
        } catch (e) {
          if (currentPage()) report(e);
        }
      }
      if (made.length && currentPage() && writeAllowed.current) {
        const position = anchor
          ? live.current.blocks.findIndex((block) =>
              anchor.id ? block.id === anchor.id : block === anchor,
            )
          : -1;
        placeLines(made, position < 0 ? null : position);
        showToast({
          text:
            anchor && position < 0
              ? "Added at the end. The original line was removed."
              : "Added to the page",
        });
      }
    } finally {
      uploadingFiles.current = false;
    }
  };

  const pickPictures = async (camera: boolean, at: number | null) => {
    if (!currentPage() || !writeAllowed.current) return;
    const anchor = at === null ? null : live.current.blocks[at];
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        showToast({
          text: "Orbyn needs the camera to take a photo. Allow it in Settings.",
        });
        return;
      }
    }
    if (!currentPage() || !writeAllowed.current) return;
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.85,
          exif: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.85,
          exif: false,
          allowsMultipleSelection: true,
        });
    if (result.canceled) return;
    await addFiles(
      result.assets.map((a, i) => ({
        name:
          a.fileName ??
          `Photo ${new Date().toISOString().slice(0, 10)}${i ? ` ${i + 1}` : ""}.jpg`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        size: a.fileSize ?? null,
        width: a.width,
        height: a.height,
        file: (a as { file?: File }).file,
      })),
      at,
      anchor,
    );
  };

  const pickFiles = async (at: number | null) => {
    if (!currentPage() || !writeAllowed.current) return;
    const anchor = at === null ? null : live.current.blocks[at];
    const picked = await DocumentPicker.getDocumentAsync({
      type: Object.keys(PAGE_FILE_TYPES),
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    await addFiles(
      picked.assets.map((a) => ({
        name: a.name,
        uri: a.uri,
        mime: a.mimeType ?? null,
        size: a.size ?? null,
        file: a.file,
      })),
      at,
      anchor,
    );
  };

  /** What the kinds panel puts in the line's place. */
  const insertLine = (what: LineInsert) => {
    if (focused === null || !structural) return;
    const at = focused;
    Keyboard.dismiss();
    switch (what) {
      case "table": {
        const placed = placeLines([
          { type: "table", text: emptyTable(), id: newBlockId() },
        ]);
        if (placed !== null) setTableAt(placed);
        return;
      }
      case "diagram":
        placeLines([
          {
            type: "code",
            lang: "mermaid",
            text: "flowchart TD\n  A[Start] --> B[Next step]",
            id: newBlockId(),
          },
        ]);
        return;
      case "tasks":
        placeLines([
          {
            type: "code",
            lang: EMBED_LANG,
            text: embedText({ kind: "tasks" }),
            id: newBlockId(),
          },
        ]);
        return;
      case "photo":
        void pickPictures(true, at).catch(report);
        return;
      case "picture":
        void pickPictures(false, at).catch(report);
        return;
      case "file":
        void pickFiles(at).catch(report);
        return;
      case "template":
        setTemplateAt(at);
        return;
      case "embed":
        setEmbedAt(at);
        return;
      case "footnote": {
        // A marker at the caret, and the note's line at the page's end,
        // opened to write in.
        const label = nextFootnoteLabel(withDraft());
        const marker = `[^${label}]`;
        const c = sel.current.end;
        const text = draft.slice(0, c) + marker + draft.slice(c);
        const parsed = parseDoc(text);
        const next = blocks.slice();
        next.splice(
          at,
          1,
          ...carryBlockIds(blocks[at], parsed.length ? parsed : [EMPTY]),
        );
        next.push({ type: "footnote", label, text: "", id: newBlockId() });
        remember();
        update(next);
        openWith(sourceOf(next, next.length - 1), next.length - 1);
        return;
      }
    }
  };

  /** "Make cards from highlights" (EDT-05): cloze cards under "Cards". */
  const cardsFromHighlights = () => {
    const lines = highlightCards(blocks);
    if (!lines.length) {
      showToast({
        text: "Highlight the words to learn, then make cards from them.",
      });
      return;
    }
    remember();
    update(withClozeLines(blocks, lines));
    showToast({
      text: `Added ${lines.length} card${lines.length === 1 ? "" : "s"} under Cards.`,
    });
  };

  /** Copy the page for another app: HTML where it's taken, Markdown too (EDT-15). */
  const richCopy = async () => {
    if (!currentPage()) return;
    const copied = onScreen();
    const urls = new Map<string, string>();
    await Promise.all(
      copied.flatMap((b) =>
        b.type === "image" || b.type === "file"
          ? [
              fileLink(b.file).then(
                (l) => urls.set(b.file, l.url),
                () => {},
              ),
            ]
          : [],
      ),
    );
    if (!currentPage()) return;
    const { html, text } = blocksToClipboard(copied, {
      fileUrl: (id) => urls.get(id) ?? null,
    });
    try {
      if (Platform.OS === "web") {
        const nav = globalThis.navigator as Navigator | undefined;
        const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem })
          .ClipboardItem;
        if (Item && nav?.clipboard?.write)
          await nav.clipboard.write([
            new Item({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
        else if (nav?.clipboard?.writeText) await nav.clipboard.writeText(text);
        else throw new Error("Clipboard unavailable");
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Clipboard = require("expo-clipboard") as {
          setStringAsync: (
            text: string,
            options?: { inputFormat?: string },
          ) => Promise<boolean>;
          StringFormat?: { HTML: string };
        };
        const written = await Clipboard.setStringAsync(html, {
          inputFormat: Clipboard.StringFormat?.HTML ?? "html",
        });
        if (!written) throw new Error("Clipboard unavailable");
      }
      if (currentPage()) showToast({ text: "Page copied" });
    } catch {
      if (currentPage()) showToast({ text: "Couldn't copy the page" });
    }
  };

  /** Link a related page at the end of this one (LNK-06). */
  const linkRelated = (page: RelatedPage) => {
    remember();
    update([
      ...live.current.blocks,
      {
        type: "paragraph",
        id: newBlockId(),
        text: `See also ${linkMarkdown({ kind: "doc", id: page.doc_id }, page.title)}`,
      },
    ]);
    showToast({ text: `Linked “${page.title}” at the end of the page` });
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
    if (focused === null || !currentPage() || suggestionMutation.current)
      return;
    const at = focused;
    const sentDraft = draft;
    const block = blocks[at];
    if (!block?.id) return;
    const change = proposeEdit(block.id, sourceOf(blocks, at), sentDraft);
    if (!change) {
      setFocused(null);
      return;
    }
    const ticket = {};
    suggestionMutation.current = ticket;
    setDeciding(true);
    try {
      const made = await client.proposeDocChanges(doc.id, [change]);
      if (!currentPage()) return;
      suggestionRead.current++;
      setSuggestions((list) => [...list, ...made]);
      if (focusedRef.current === at && draftRef.current === sentDraft)
        setFocused(null);
      showToast({ text: "Suggested. Review it before accepting." });
    } catch (e) {
      if (currentPage()) report(e);
    } finally {
      if (suggestionMutation.current === ticket) {
        suggestionMutation.current = null;
        if (currentPage()) setDeciding(false);
      }
    }
  };

  /**
   * Ask the assistant for words in place of the chosen ones. What comes back
   * is a proposal like any other, so the page does not change until someone
   * takes it.
   */
  const assist = async (
    action: DocAiAction,
    instruction: string,
    retained?: typeof sourceAsk,
  ) => {
    const words = retained ?? asking;
    if (!words) return;
    if (suggestionMutation.current) {
      if (retained) throw new Error("Wait for the current request to finish.");
      return;
    }
    const ticket = {};
    const owner = { id: doc.id, userId, account: authSession.token };
    const current = () =>
      suggestionMounted.current &&
      suggestionMutation.current === ticket &&
      suggestionOwner.current.id === owner.id &&
      suggestionOwner.current.userId === owner.userId &&
      authSession.token === owner.account;
    const block = live.current.blocks.find((one) => one.id === words.blockId);
    if (!block || !("text" in block)) {
      if (retained)
        throw new Error(
          "The selected text changed. Select it again before asking.",
        );
      return;
    }
    const quote = retained?.quote ?? block.text.slice(words.start, words.end);
    suggestionMutation.current = ticket;
    setDeciding(true);
    try {
      if (!current()) throw new Error("The account or page changed.");
      if (dirty.current)
        throw new Error("Save your edits before asking for a change.");
      await saveQueue.current;
      if (!current()) throw new Error("The account or page changed.");
      if (dirty.current)
        throw new Error("Save your edits before asking for a change.");
      const latest = live.current.blocks.find(
        (one) => one.id === words.blockId,
      );
      if (
        !latest ||
        !("text" in latest) ||
        latest.text.slice(words.start, words.end) !== quote
      )
        throw new Error(
          "The selected text changed. Select it again before asking.",
        );
      const made = await client.assistDoc(owner.id, {
        block_id: words.blockId,
        range_start: words.start,
        range_end: words.end,
        action,
        instruction,
        quote,
        version: version.current,
      });
      if (!current()) throw new Error("The account or page changed.");
      if (!retained) setAsking(null);
      suggestionRead.current++;
      setSuggestions((list) => [...list, made]);
      showToast({ text: "Suggested. Review it before accepting." });
    } catch (error) {
      if (retained) throw error;
      if (current()) report(error);
    } finally {
      if (current()) {
        suggestionMutation.current = null;
        setDeciding(false);
      }
    }
  };

  const loadSuggestions = useCallback(() => {
    const request = ++suggestionRead.current;
    const owner = { id: doc.id, userId, account: authSession.token };
    const current = () =>
      suggestionMounted.current &&
      request === suggestionRead.current &&
      suggestionOwner.current.id === owner.id &&
      suggestionOwner.current.userId === owner.userId &&
      authSession.token === owner.account;
    client.listDocSuggestions(doc.id).then(
      (list) => {
        if (current()) setSuggestions(list);
      },
      (error) => {
        if (current()) report(error);
      },
    );
  }, [doc.id, userId]);
  useEffect(() => {
    setSuggestions([]);
    suggestionMutation.current = null;
    setSourceAsk(null);
    setDeciding(false);
    loadSuggestions();
  }, [loadSuggestions]);

  /** Serialize review decisions; a newer local draft never gets replaced by a receipt. */
  const reviewSuggestions = async (
    actions: { suggestion: DocSuggestion; take?: boolean }[],
  ) => {
    if (suggestionMutation.current) return;
    if (dirty.current) {
      report(new Error("Save your edits before reviewing changes."));
      return;
    }
    const ticket = {};
    suggestionMutation.current = ticket;
    setDeciding(true);
    const owner = { id: doc.id, userId, account: authSession.token };
    const current = () =>
      suggestionMounted.current &&
      suggestionMutation.current === ticket &&
      suggestionOwner.current.id === owner.id &&
      suggestionOwner.current.userId === owner.userId &&
      authSession.token === owner.account;
    try {
      await saveQueue.current;
      for (const { suggestion, take } of actions) {
        if (!current()) return;
        if (dirty.current)
          throw new Error("Save your new edits before continuing this review.");
        if (take === undefined) {
          await client.withdrawDocSuggestion(owner.id, suggestion.id);
          if (current())
            setSuggestions((list) =>
              list.filter((one) => one.id !== suggestion.id),
            );
        } else {
          const { doc: saved } = await client.decideDocSuggestion(
            owner.id,
            suggestion.id,
            take,
          );
          if (!current()) return;
          if (saved) {
            if (dirty.current) reconcile(saved);
            else {
              version.current = saved.version;
              ticksFrom.current = saved.version;
              base.current = saved.content;
              setBlocks(saved.content);
            }
            onChanged(saved);
          }
        }
      }
    } catch (error) {
      if (current()) report(error);
    } finally {
      if (current()) {
        suggestionMutation.current = null;
        setDeciding(false);
        loadSuggestions();
      }
    }
  };
  const decide = (suggestion: DocSuggestion, take: boolean) => {
    void reviewSuggestions([{ suggestion, take }]);
  };
  const withdraw = (suggestion: DocSuggestion) => {
    void reviewSuggestions([{ suggestion }]);
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
    if (!structural || reading || !canWrite) return;
    remember();
    const next = [...blocks, EMPTY];
    setBlocks(next);
    openWith("", next.length - 1);
  };

  const toggle = (index: number) => {
    if (!currentPage() || !canWrite || !structural) return;
    const line = blocks[index];
    if (line?.type === "todo" && !line.done) tap();
    const next = blocks.map((b, i) =>
      i === index && b.type === "todo" ? { ...b, done: !b.done } : b,
    );
    setBlocks(next);
    live.current = { ...live.current, blocks: next };
    dirty.current = true;
    // A tick is worth saving at once: it may finish a task.
    if (timer.current) clearTimeout(timer.current);
    void persist(live.current.title, next).then(() => {
      if (currentPage() && !dirty.current) onItemsChanged?.();
    });
  };

  /**
   * Turn the unticked checklist lines into real tasks. The server ties each
   * line to its task and hands the page back, so the lines follow them.
   */
  const makeTasks = (only?: string[]) => {
    if (!currentPage() || !canWrite || creatingTasks.current) return;
    creatingTasks.current = true;
    setTasksBusy(true);
    if (timer.current) clearTimeout(timer.current);
    void (async () => {
      try {
        if (dirty.current) await persist(title, live.current.blocks);
        // A line just put away is still saving: the server needs its name.
        await saveQueue.current;
        // What the server works from; anything typed after this is newer.
        if (!currentPage()) return;
        if (dirty.current)
          throw new Error("Save your page edits before creating tasks.");
        const sent = live.current.blocks;
        const { created, doc: updated } = await client.docToTasks(doc.id, only);
        if (!currentPage()) return;
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
        if (currentPage()) report(e);
      } finally {
        creatingTasks.current = false;
        if (currentPage()) setTasksBusy(false);
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
    if (
      !currentPage() ||
      suggestionMutation.current ||
      (m === "edit" && !canWrite)
    )
      return;
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
  const deletePage = async () => {
    if (
      !currentPage() ||
      !writeAllowed.current ||
      deleting.current ||
      archiving.current
    )
      return;
    deleting.current = true;
    setDeletingPage(true);
    setDeleteError("");
    try {
      if (commentDrafts && !(await commentDrafts.prepare())) return;
      if (!currentPage() || !writeAllowed.current) return;
      if (timer.current) clearTimeout(timer.current);
      if (doc.kind === "memory") {
        await client.forgetMemory(doc.id);
      } else {
        await flush();
        if (!currentPage() || !writeAllowed.current) return;
        if (dirty.current)
          throw new Error("Save your edits before moving this page to Trash.");
        await client.deleteDoc(doc.id);
      }
      if (!currentPage()) return;
      void forgetPage(doc.id);
      dirty.current = false;
      flushOnClose.current = () => {};
      gone.current = true;
      setForgetting(false);
      onDeleted?.();
      showToast({
        text:
          doc.kind === "memory"
            ? "Memory topic forgotten"
            : `Moved “${live.current.title || "Untitled"}” to Trash`,
        action:
          doc.kind === "memory"
            ? undefined
            : {
                label: "Undo",
                run: () => {
                  if (authSession.token !== renderAccount) return;
                  void client.restoreDoc(doc.id).then(
                    (back) => {
                      if (authSession.token !== renderAccount) return;
                      if (onUndoDelete) onUndoDelete(back);
                      else
                        showToast({
                          text: `“${back.title || "Untitled"}” is back`,
                        });
                    },
                    (e) => {
                      if (authSession.token === renderAccount) report(e);
                    },
                  );
                },
              },
      });
    } catch (e) {
      if (!currentPage()) return;
      if (doc.kind === "memory")
        setDeleteError("Couldn't forget this topic. Try again.");
      else report(e);
    } finally {
      deleting.current = false;
      if (currentPage()) setDeletingPage(false);
    }
  };
  const removePage = () => {
    if (
      !currentPage() ||
      !writeAllowed.current ||
      deleting.current ||
      archiving.current
    )
      return;
    if (doc.kind === "memory") {
      setDeleteError("");
      setForgetting(true);
    } else void deletePage();
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

  /** "@" and a few letters in the open line: the people picker. */
  const typedKind = focused !== null ? parseDoc(draft)[0]?.type : undefined;
  const mention =
    focused !== null &&
    (!reading || suggesting) &&
    typedKind !== "code" &&
    typedKind !== "math"
      ? mentionQuery(draft, selection.start)
      : null;
  const wantsPeople = !!mention;
  useEffect(() => {
    setPeople(null);
    setPeopleFailed(false);
  }, [doc.id, userId]);
  useEffect(() => {
    if (!wantsPeople || people !== null || peopleFailed) return;
    let active = true;
    client.docPeople(doc.id).then(
      (list) => {
        if (active && currentPage())
          setPeople(list.filter((p) => p.id !== userId));
      },
      () => {
        if (active && currentPage()) setPeopleFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [wantsPeople, people, peopleFailed, peopleAttempt, doc.id, userId]);
  const pickPerson = (person: MentionPerson) => {
    if (
      !currentPage() ||
      !mention ||
      !people?.some((one) => one.id === person.id)
    )
      return;
    const written = `${mentionMarkdown(person)} `;
    const text =
      draft.slice(0, mention.from) + written + draft.slice(selection.start);
    const at = mention.from + written.length;
    applyEdit({ text, start: at, end: at });
  };

  /** The line being typed, as the keyboard toolbar shows it. */
  const current = focused !== null ? (parseDoc(draft)[0] ?? EMPTY) : null;
  const saved = focused !== null ? blocks[focused] : undefined;
  // Under the line being edited (MOB-13): what "[[" or "/" offers.
  const bracketOpen = !!bracket && shutAt !== suggestKey("link", bracket.start);
  const slashOpen = !!slash && shutAt !== suggestKey("slash", slash.start);
  const slashChoices: {
    key: string;
    label: string;
    hint: string;
    keywords?: string;
    run: () => void;
  }[] = slashOpen
    ? [
        ...BLOCK_KINDS.map((kind) => ({
          key: kindKey(kind),
          label: kind.label,
          hint: kind.hint,
          keywords: `${kindKey(kind)} ${kind.shorthand}`,
          run: () => turnInto(kind, withoutSlash().text),
        })),
        ...(structural
          ? [
              {
                key: "live",
                label: "Live list",
                hint: "Tasks or pages that match, kept up to date",
                keywords: "query filter",
                run: () => {
                  const { text, caret } = withoutSlash();
                  applyEdit({ text, start: caret, end: caret });
                  setSlashInsert("live");
                },
              },
              ...INSERTS.map((item) => ({
                key: item.key,
                label: item.label,
                hint: item.hint,
                run: () => {
                  const { text, caret } = withoutSlash();
                  applyEdit({ text, start: caret, end: caret });
                  setSlashInsert(item.key);
                },
              })),
            ]
          : []),
      ].filter((c) => slashMatches(slash!.query, c))
    : [];
  const underLine =
    bracketOpen && bracket ? (
      <LinkPickerPanel
        query={bracket.query}
        projectName={doc.project_name}
        onPick={insertPicked}
        onCreate={(kind, name) => void createAndLink(kind, name)}
        onClose={() => setShutAt(suggestKey("link", bracket.start))}
        report={report}
      />
    ) : slashChoices.length && slash ? (
      <ScrollView
        style={styles.slash}
        nestedScrollEnabled
        keyboardShouldPersistTaps="always"
        accessibilityLabel="Kinds of line"
      >
        {slashChoices.map((c, n) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={c.label}
            accessibilityHint={c.hint}
            onPress={c.run}
            style={({ pressed }) => [
              styles.slashRow,
              n > 0 && styles.slashDivider,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={styles.slashLabel}>{c.label}</Text>
            <Text style={styles.slashHint}>{c.hint}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => setShutAt(suggestKey("slash", slash.start))}
          style={[styles.slashRow, styles.slashDivider]}
        >
          <Text style={styles.slashHint}>Keep “/” as it is</Text>
        </Pressable>
      </ScrollView>
    ) : null;

  const toolbar =
    focused !== null && current && (!reading || suggesting) ? (
      <>
        {mention && (
          <MentionStrip
            query={mention.query}
            people={people}
            failed={peopleFailed}
            onRetry={() => {
              setPeopleFailed(false);
              setPeopleAttempt((attempt) => attempt + 1);
            }}
            onPick={pickPerson}
          />
        )}
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
          // Link suggestions show under the line itself (MOB-13).
          linkQuery={null}
          projectName={doc.project_name}
          onPickLink={insertPicked}
          onCreateLink={(kind, name) => void createAndLink(kind, name)}
          report={report}
          onTodo={todoLine}
          onLiveList={structural && !suggesting ? liveListLine : undefined}
          onInsert={structural && !suggesting ? insertLine : undefined}
          onTint={structural && !suggesting ? tintLine : undefined}
          onCopyLink={copyLineLink}
          onMoveToPage={structural && !suggesting ? moveToNewPage : undefined}
          onIndent={indentLine}
          onComment={commentOnLine}
          onAsk={askLine}
          onMove={moveLine}
          onCommentWords={commentOnWords}
          onDelete={deleteLine}
          onHide={hideKeyboard}
        />
      </>
    ) : null;

  /** Star or unstar the page itself (NAV-07). */
  const toggleStar = () => {
    const on = !pageStarred;
    setStars((all) =>
      on
        ? [...all, { kind: "doc", target_id: doc.id, created_at: "" }]
        : all.filter((f) => f.kind !== "doc"),
    );
    client.setFavourite("doc", doc.id, on).then(() => {
      announceStars();
      showToast({ text: on ? "Starred" : "Unstarred" });
    }, report);
  };
  /** Star or unstar one heading (named first, if it has no name). */
  const starHeading = (entry: OutlineEntry) => {
    const block = blocks[entry.index];
    const named = block?.id ?? null;
    const blockId = named ?? nameBlockAt(entry.index);
    const on = !starredHeadings.has(blockId);
    void (async () => {
      try {
        // A heading named just now is saved first, so the star can find it.
        if (!named) await flush();
        await client.setFavourite("heading", doc.id, on, blockId);
        announceStars();
        setStars((all) =>
          on
            ? [
                ...all,
                {
                  kind: "heading",
                  target_id: doc.id,
                  block_id: blockId,
                  created_at: "",
                },
              ]
            : all.filter(
                (f) => !(f.kind === "heading" && f.block_id === blockId),
              ),
        );
        showToast({ text: on ? `Starred “${entry.text}”` : "Unstarred" });
      } catch (e) {
        report(e);
      }
    })();
  };
  /** Archive only after the current draft is saved. */
  const setArchive = async (next: boolean, offerUndo = true) => {
    if (
      !currentPage() ||
      !writeAllowed.current ||
      deleting.current ||
      archiving.current
    )
      return;
    archiving.current = true;
    setArchivingPage(true);
    try {
      if (commentDrafts && !(await commentDrafts.prepare())) return;
      await flush();
      if (!currentPage() || !writeAllowed.current) return;
      if (dirty.current)
        throw new Error("Save this draft before archiving the page.");
      const saved = await client.archiveDoc(doc.id, next);
      if (!currentPage()) return;
      setArchived(!!saved.archived);
      onChanged(saved);
      showToast({
        text: next ? "Archived" : "Back in the library",
        action:
          next && offerUndo
            ? {
                label: "Undo",
                run: () => void setArchive(false, false),
              }
            : undefined,
      });
    } catch (error) {
      if (currentPage()) report(error);
    } finally {
      archiving.current = false;
      if (currentPage()) setArchivingPage(false);
    }
  };
  const toggleArchive = () => setArchive(!archived);
  /** A recording's summary goes under the recording (CAP-10). */
  const addSummary = (fileId: string, lines: DocBlock[]) => {
    const at = blocks.findIndex((b) => b.type === "file" && b.file === fileId);
    placeLines(
      lines.map((b) => ({ ...b, id: newBlockId() })),
      at === -1 ? null : at,
    );
    showToast({ text: "Added the summary under the recording" });
  };

  /** The page's ⋯: Ask, Copy link, Share, Export, History, template and Trash. */
  const pageActions: MoreAction[] = [
    ...(canWrite && doc.kind === "doc" && !suggesting
      ? [
          {
            label: "Page updates…",
            onPress: () => {
              void (async () => {
                await flush();
                if (
                  !maintainedPageDraftSaved(
                    live.current.title,
                    onScreen(),
                    baseTitle.current,
                    base.current,
                  )
                )
                  throw new Error(
                    "Save your page edits before scheduling updates.",
                  );
                Keyboard.dismiss();
                setMaintaining(true);
              })().catch(report);
            },
          },
        ]
      : []),
    // Reading and editing (EDT-10): the same switch as Info's, a tap away.
    ...(canWrite && !suggesting
      ? [
          {
            label: "Cover and icon",
            onPress: () => setLookOpen(true),
          },
          {
            label: reading ? "Edit this page" : "Read",
            onPress: () => chooseMode(reading ? "edit" : "read"),
          },
        ]
      : []),
    { label: "Ask about this page", onPress: () => setTalking(true) },
    { label: "Present", onPress: () => setPresenting(true) },
    {
      label: pageStarred ? "Unstar" : "Star",
      onPress: () => toggleStar(),
    },
    ...(onShowInLibrary
      ? [{ label: "Show in library", onPress: () => onShowInLibrary() }]
      : []),
    ...(onMoveTo ? [{ label: "Move to…", onPress: () => onMoveTo() }] : []),
    // A page with headings has its contents a tap away (NAV-03).
    ...(docOutline(blocks).length
      ? [{ label: "Contents", onPress: () => setContentsOpen(true) }]
      : []),
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
    ...(doc.kind !== "memory"
      ? [{ label: "Save as template", onPress: () => setSavingTemplate(true) }]
      : []),
    ...(doc.kind !== "agenda" && doc.kind !== "memory"
      ? [{ label: "Publish to web…", onPress: () => setPublishing(true) }]
      : []),
    ...(foldableHeadings(blocks).length
      ? [
          {
            label: foldableHeadings(blocks).some((id) => !folds.has(id))
              ? "Collapse all headings"
              : "Expand all headings",
            onPress: () => {
              const all = foldableHeadings(blocks);
              saveFolds(
                all.some((id) => !folds.has(id)) ? new Set(all) : new Set(),
              );
            },
          },
        ]
      : []),
    { label: "Copy for another app", onPress: () => void richCopy() },
    ...(canWrite && structural && !reading
      ? [
          { label: "Make cards from highlights", onPress: cardsFromHighlights },
          {
            label: "Add a photo or file…",
            onPress: () => void pickFiles(null).catch(report),
          },
          { label: "Record audio…", onPress: () => setRecording(true) },
          { label: "Merge into…", onPress: () => setMerging(true) },
        ]
      : []),
    ...(canWrite && doc.kind !== "agenda" && doc.kind !== "memory"
      ? [
          {
            label: archived ? "Bring back from archive" : "Archive",
            onPress: () => void toggleArchive(),
          },
        ]
      : []),
    ...(canWrite
      ? [
          {
            label:
              doc.kind === "memory" ? "Forget Memory topic" : "Move to Trash",
            destructive: true,
            onPress: removePage,
          },
        ]
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
  // ---- contents (NAV-03) ----
  const outline = useMemo(() => docOutline(blocks), [blocks]);
  /** Bring a heading to the top of the sheet. */
  const jumpTo = (entry: OutlineEntry) => {
    setContentsOpen(false);
    setInfoOpen(false);
    const y = lineYs.current.get(entry.index);
    if (bodyOffset.current === null || y === undefined) return;
    onTargetOffset?.(bodyOffset.current + y);
  };
  // The status line (W5): words, reading time, links here, fields filled
  // in, and whether it's saved (or kept on this phone until back online).
  const statusParts = pageStatus({
    ...docStats(blocks),
    savedAt,
    saving,
    failed: saveFailure || dirty.current,
    offline: keptOffline,
    now,
    linked: linkedCount,
    properties: propertyCount,
  });
  // The words were last written by a connected agent (an agenda it wrote,
  // say); gone once a person edits the page.
  const writtenVia = doc.via_agent ? ` · written via ${doc.via_agent}` : "";
  const facts = statusParts.map((p) => p.text).join(" · ") + writtenVia;

  /** Footnote numbers and words; a marker's words show when tapped. */
  const footnotes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
      onShow: (n: string, words: string) => setFootnote({ label: n, words }),
    }),
    [blocks],
  );
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <DocLatexPreviewProvider
      canCompile={canWrite}
      blocks={blocks}
      docId={doc.id}
      ready={canWrite && !dirty.current && !saving && !saveFailure}
      compile={(source, signal) =>
        client.compileDocLatex(
          doc.id,
          { source, version: version.current },
          signal,
        )
      }
    >
      <RecordingContext.Provider value={recordingActions}>
        <View
          style={[
            styles.page,
            sourcePreview && sourceBesideNote ? { flexDirection: "row" } : null,
          ]}
        >
          <BottomSheet
            visible={forgetting}
            title="Forget Memory topic?"
            closeDisabled={deletingPage}
            onClose={() => setForgetting(false)}
            footer={
              <SmallAction
                label={deletingPage ? "Forgetting…" : "Forget"}
                destructive
                disabled={deletingPage || !canWrite}
                onPress={() => void deletePage()}
              />
            }
          >
            <Text style={styles.footnoteText}>
              Permanently remove “{title || "Untitled"}” and its source links?
              This cannot be undone.
            </Text>
            {deleteError && (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {deleteError}
              </Text>
            )}
          </BottomSheet>
          <BottomSheet
            visible={footnote !== null}
            title={`Footnote ${footnote?.label ?? ""}`}
            onClose={() => setFootnote(null)}
          >
            <Text style={styles.footnoteText}>{footnote?.words}</Text>
          </BottomSheet>
          {sourceAsk && (
            <DocSourceAsk
              text={sourceAsk.quote}
              onClose={() => setSourceAsk(null)}
              onAsk={(instruction) => assist("custom", instruction, sourceAsk)}
            />
          )}
          {sourcePreview === doc.id && (
            <DocSourcePreview
              leaveCheck={sourceLeaveCheck}
              compileReady={!dirty.current && !saving && !saveFailure}
              inline
              sourceOnly
              showModes={!sourceBesideNote}
              key={sourcePreviewMode}
              onModeChange={setSourcePreviewMode}
              initialMode={sourcePreviewMode}
              beforeNavigate={async () => {
                if (!currentPage()) return false;
                await flush();
                if (!currentPage()) return false;
                if (dirty.current)
                  throw new Error(
                    "Save your document changes before opening this link.",
                  );
                return commentDrafts ? commentDrafts.prepare() : true;
              }}
              blocks={blocks}
              docId={doc.id}
              onCompileLatex={(source, signal) =>
                client.compileDocLatex(
                  doc.id,
                  { source, version: version.current },
                  signal,
                )
              }
              onAssist={
                canWrite && !reading && !suggesting && !dirty.current
                  ? (block) => {
                      if (block.id && "text" in block) {
                        setSourcePreview(null);
                        setSourceAsk({
                          blockId: block.id,
                          quote: block.text,
                          start: 0,
                          end: block.text.length,
                        });
                      }
                    }
                  : undefined
              }
              onSourceChange={
                canWrite && !reading && !suggesting
                  ? (text, expected) => {
                      if (!currentPage())
                        throw new Error("The account or page changed.");
                      const next = editDocSource(
                        live.current.blocks,
                        text,
                        expected,
                      );
                      if (next !== live.current.blocks) {
                        remember("type");
                        update(next);
                      }
                      return next;
                    }
                  : undefined
              }
              saveStatus={
                saving ? "Saving…" : dirty.current ? "Unsaved changes" : "Saved"
              }
              onAppLink={openAppUrl}
              report={report}
              onClose={() => {
                sourcePreviewOwner.current = null;
                setSourcePreview(null);
              }}
            />
          )}
          <View
            style={
              sourcePreview && !sourceBesideNote
                ? { display: "none" }
                : { flex: 1, gap: 12, minWidth: 0 }
            }
          >
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
            {/* Its cover and icon (W6), shared across devices. */}
            <CoverImage
              fileId={appearance.cover_file_id}
              height={140}
              style={{ borderRadius: radii.input, marginBottom: 12 }}
            />
            {!!appearance.icon && (
              <View style={{ marginBottom: 6 }}>
                <LookIconView icon={appearance.icon} size={36} />
              </View>
            )}
            {reading || suggesting ? (
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
                    queueSave(text, live.current.blocks);
                  }}
                />
              </View>
            )}

            <DocEditorModes
              value={sourcePreview ? sourcePreviewMode : "note"}
              disabled={
                deciding || deletingPage || archivingPage || !!sourceAsk
              }
              onChange={(format: DocumentEditorMode) => {
                if (sourcePreview && !sourceLeaveCheck.current?.()) return;
                if (format === "note") {
                  setSourcePreview(null);
                  return;
                }
                syncDraft();
                setFocused(null);
                if (canWrite && mode === "read") chooseMode("edit");
                setSourcePreviewMode(format);
                setSourcePreview(doc.id);
              }}
            />

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
                    <View
                      style={[styles.tagDot, { backgroundColor: t.color }]}
                    />
                    <Text style={styles.tagText}>{t.name}</Text>
                  </View>
                ))}
              </Pressable>
            )}

            {!!note && (
              <View style={styles.note}>
                <Text style={styles.noteText} accessibilityLiveRegion="polite">
                  {note}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss notice"
                  onPress={() => setNote("")}
                  style={styles.noteDismiss}
                >
                  <Icon name="x" size={16} color={colors.textSoft} />
                </Pressable>
              </View>
            )}

            <DocSuggestions
              suggestions={suggestions}
              sourceBlockIds={
                new Set(
                  blocks
                    .filter(
                      (block) => block.type === "code" || block.type === "math",
                    )
                    .flatMap((block) => (block.id ? [block.id] : [])),
                )
              }
              canDecide={canWrite}
              userId={userId}
              busy={deciding || dirty.current || saving}
              onDecide={decide}
              onWithdraw={withdraw}
            />

            {savingTemplate && (
              <SaveTemplatePanel
                doc={doc}
                canShare={canWrite}
                onClose={() => setSavingTemplate(false)}
                onSaved={(t) => {
                  if (currentPage())
                    showToast({ text: `Template saved: ${t.name}` });
                }}
              />
            )}

            <View
              onLayout={(event) => {
                bodyOffset.current = event.nativeEvent.layout.y;
                sendTarget();
              }}
            >
              <LinkPillProvider value={pillActions}>
                <DocNavigationContext.Provider
                  value={{
                    onFragment: goToFragment,
                    onAppLink: (url) => {
                      const link = parseAppLink(url);
                      if (
                        link?.kind === "doc" &&
                        link.id === doc.id &&
                        link.block
                      )
                        goToFragment(link.block);
                      else {
                        if (threadNavigation.current || !currentPage()) return;
                        threadNavigation.current = true;
                        void (async () => {
                          try {
                            if (
                              commentDrafts &&
                              !(await commentDrafts.prepare())
                            )
                              return;
                            if (!currentPage()) return;
                            await flush();
                            if (!currentPage() || dirty.current) return;
                            openAppUrl(url);
                          } catch (e) {
                            if (currentPage()) report(e);
                          } finally {
                            threadNavigation.current = false;
                          }
                        })();
                      }
                    },
                    report,
                  }}
                >
                  <FootnoteContext.Provider value={footnotes}>
                    <DocBody
                      content={blocks}
                      folds={folds}
                      onToggleFold={toggleFold}
                      flash={flash}
                      onReplace={
                        structural && !reading
                          ? (index, block) => {
                              remember();
                              const next = blocks.slice();
                              next[index] = block;
                              update(next);
                            }
                          : undefined
                      }
                      onEditTable={
                        structural && !reading
                          ? (index) => setTableAt(index)
                          : undefined
                      }
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
                      onOpenComments={(blockId) => {
                        void requestThread(
                          openThread === blockId ? null : blockId,
                        );
                      }}
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
                                void requestThread(blockId, () => {
                                  setPicking(null);
                                  setPending({
                                    blockId,
                                    quote: range.quote.slice(0, 400),
                                    range_start: range.start,
                                    range_end: range.end,
                                  });
                                });
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
                      onLineLayout={(index, y) => {
                        lineYs.current.set(index, y);
                        if (targetLine.current === index) sendTarget();
                      }}
                      onEditBlock={
                        reading && !suggesting ? undefined : openLine
                      }
                      // Reading, and allowed to edit: a double tap edits that line.
                      onDoubleTapBlock={
                        reading && canWrite && !suggesting
                          ? (index) => {
                              setMode("edit");
                              saveLocal(MODE_KEY + doc.id, "edit");
                              openLine(index);
                            }
                          : undefined
                      }
                      onToggleTodo={reading || !structural ? undefined : toggle}
                      underEditing={underLine}
                    />
                  </FootnoteContext.Provider>
                </DocNavigationContext.Provider>
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
            {focused === null && structural && !reading && canWrite && (
              <Pressable
                onPress={addLine}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.add,
                  pressed && styles.addPressed,
                ]}
              >
                <Text style={styles.addText}>+ Add a block</Text>
              </Pressable>
            )}

            {/* Four lines of instructions sat under every page, every time it was
          opened. It says the one thing that is not obvious, and only while
          there is a toolbar for it to be about. */}
            {focused !== null && structural && (
              <Text style={styles.hint}>
                Return adds a line. An empty item ends the list.
              </Text>
            )}

            {saveFailure && (
              <View style={styles.pageActions}>
                <Text style={styles.error} accessibilityLiveRegion="polite">
                  Couldn't save. Your edits are still here.
                </Text>
                <SmallAction
                  label="Retry save"
                  disabled={saving || !canWrite || suggesting}
                  onPress={() => {
                    if (!currentPage()) return;
                    const shown = onScreen();
                    live.current = { ...live.current, blocks: shown };
                    setBlocks(shown);
                    dirty.current = true;
                    void persistRef.current(live.current.title, shown);
                  }}
                />
              </View>
            )}
            {/* Page facts keep full values and real touch targets. */}
            <View style={styles.footer}>
              {statusParts.map((part) => (
                <Pressable
                  key={part.key}
                  accessibilityRole="button"
                  style={styles.footerAction}
                  onPress={() => {
                    if (part.key === "linked" && linkedY.current !== null)
                      onTargetOffset?.(linkedY.current);
                    else setInfoOpen(true);
                  }}
                >
                  <Text style={styles.footerText}>{part.text}</Text>
                </Pressable>
              ))}
              {!!doc.via_agent && (
                <Text style={styles.footerText}>
                  Written via {doc.via_agent}
                </Text>
              )}
            </View>
            <View
              onLayout={(event) => {
                linkedY.current = event.nativeEvent.layout.y;
              }}
            />
            <LinkedHere
              kind="doc"
              id={doc.id}
              onCount={setLinkedCount}
              report={report}
              onLinkRelated={
                canWrite && structural && !reading ? linkRelated : undefined
              }
            />
            {maintaining && (
              <PageMaintenanceSheet
                id={doc.id}
                onChanged={(updated) => {
                  if (!currentPage() || updated.version < version.current)
                    return;
                  setSavedAt(updated.updated_at);
                  setNow(new Date());
                  onChanged(updated);
                }}
                onClose={() => setMaintaining(false)}
              />
            )}
            <PublishSheet
              visible={publishing}
              kind="doc"
              id={doc.id}
              name={title || "Untitled"}
              onClose={() => setPublishing(false)}
            />
            <LinkCardSheet
              target={card}
              onClose={() => setCard(null)}
              onChanged={() => {
                reloadPills();
                onItemsChanged?.();
              }}
              report={report}
            />
            {tableEdit?.block.type === "table" && (
              <TableEditor
                visible
                text={tableEdit.block.text}
                onSave={(text) => {
                  if (!currentPage() || !writeAllowed.current)
                    throw new Error("This page is no longer editable.");
                  const shown = live.current.blocks;
                  const at = tableEdit.block.id
                    ? shown.findIndex(
                        (block) => block.id === tableEdit.block.id,
                      )
                    : shown.indexOf(tableEdit.block);
                  const block = shown[at];
                  if (
                    at < 0 ||
                    block?.type !== "table" ||
                    block.text !== tableEdit.block.text
                  )
                    throw new Error(
                      "This table changed. Keep your draft and reopen the table before saving.",
                    );
                  remember();
                  const next = shown.slice();
                  next[at] = { ...block, text };
                  update(next);
                }}
                onClose={() => setTableAt(null)}
              />
            )}
            <TemplateSheet
              visible={templateAt !== null}
              doc={{ title, project_name: doc.project_name }}
              onPick={(lines) => placeLines(lines, templateAt)}
              onClose={() => setTemplateAt(null)}
              report={report}
            />
            <EmbedSheet
              visible={embedAt !== null}
              onPick={(ref) => {
                if (ref.kind !== "doc" || ref.id === doc.id) {
                  showToast({
                    text:
                      ref.id === doc.id
                        ? "That's this page."
                        : "Only a page can be embedded.",
                  });
                  return;
                }
                placeLines(
                  [
                    {
                      type: "code",
                      lang: EMBED_LANG,
                      text: embedText({
                        kind: "section",
                        doc: ref.id,
                        block: ref.block ?? null,
                      }),
                      id: newBlockId(),
                    },
                  ],
                  embedAt,
                );
              }}
              onClose={() => setEmbedAt(null)}
              report={report}
            />
            <MergeSheet
              visible={merging}
              doc={{ id: doc.id, title }}
              version={async () => {
                await flush();
                return version.current;
              }}
              onClose={() => setMerging(false)}
              onMerged={(into, relinked) => {
                setMerging(false);
                dirty.current = false;
                flushOnClose.current = () => {};
                gone.current = true;
                onDeleted?.();
                openObject({ kind: "doc", id: into.id });
                showToast({
                  text:
                    relinked > 0
                      ? `Merged into “${into.title}”. ${relinked} page${relinked === 1 ? "" : "s"} now link there.`
                      : `Merged into “${into.title}”.`,
                });
              }}
            />

            {openTodos > 0 && (
              <View style={styles.pageActions}>
                <SmallAction
                  label={
                    tasksBusy ? "Adding tasks…" : `Add ${openTodos} to my tasks`
                  }
                  disabled={tasksBusy || !canWrite}
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
              onGoToBlock={(blockId) => {
                void requestThread(blockId);
              }}
              onNameBlock={nameBlockAt}
              onSuggested={(made) => {
                if (!currentPage()) return;
                suggestionRead.current++;
                setSuggestions((list) => [...list, made]);
              }}
            />
            <PageInfo
              visible={infoOpen}
              doc={doc}
              fieldsStamp={fieldsStamp}
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
              outline={outline}
              onJump={jumpTo}
              starredHeadings={starredHeadings}
              onStarHeading={starHeading}
              onShowLinked={() => {
                setInfoOpen(false);
                if (linkedY.current !== null) onTargetOffset?.(linkedY.current);
              }}
            />
            <ContentsSheet
              visible={contentsOpen}
              outline={outline}
              current={-1}
              onJump={jumpTo}
              onClose={() => setContentsOpen(false)}
              starred={starredHeadings}
              onStar={starHeading}
            />
            <PresentSheet
              visible={presenting}
              title={title}
              blocks={blocks}
              onClose={() => setPresenting(false)}
            />
            <RecordSheet
              visible={recording}
              onClose={() => setRecording(false)}
              onDone={(r) => {
                setRecording(false);
                void addFiles(
                  [{ name: r.name, uri: r.uri, mime: r.mime }],
                  null,
                );
              }}
            />
            <RecordingSummarySheet
              target={summarising}
              onAddToPage={
                canWrite && !reading && summarising
                  ? (lines) => addSummary(summarising.fileId, lines)
                  : undefined
              }
              onClose={() => setSummarising(null)}
            />
            <ActionSheet
              visible={menu === "page"}
              label="Page options"
              title={title || "Untitled"}
              actions={pageActions.map((action) => ({
                ...action,
                disabled: deletingPage || archivingPage || action.disabled,
                onPress: () => {
                  if (currentPage() && !deleting.current && !archiving.current)
                    action.onPress();
                },
              }))}
              onClose={() => setMenu((m) => (m === "page" ? null : m))}
            />
            <ActionSheet
              visible={menu === "share"}
              label="Share this page"
              title="Share as"
              actions={shareActions}
              onClose={() => setMenu((m) => (m === "share" ? null : m))}
            />
            {lookOpen && (
              <LookEditor
                key={doc.id}
                title={title || "Untitled"}
                look={appearance}
                uploadTo={doc.id}
                onClose={() => {
                  if (appearanceDocId.current === doc.id) setLookOpen(false);
                }}
                onSave={async (look) => {
                  if (!currentPage())
                    throw new Error("The account or page changed.");
                  const saved = await client.setDocLook(doc.id, look);
                  if (currentPage() && appearanceDocId.current === doc.id)
                    setAppearance(saved);
                }}
              />
            )}
            <ActionSheet
              visible={menu === "export"}
              label="Export this page"
              title="Export as"
              actions={exportActions}
              onClose={() => setMenu((m) => (m === "export" ? null : m))}
            />
          </View>
        </View>
      </RecordingContext.Provider>
    </DocLatexPreviewProvider>
  );
}

export function DocEditor(props: Parameters<typeof LegacyDocEditor>[0]) {
  return (
    <DocEditorBody key={`${authSession.token}:${props.doc.id}`} {...props} />
  );
}

function DocEditorBody(props: Parameters<typeof LegacyDocEditor>[0]) {
  const account = authSession.token;
  const [openingFailed, setOpeningFailed] = useState(false);
  const [openingAttempt, setOpeningAttempt] = useState(0);
  const [complete, setComplete] = useState<Doc | null>(
    props.doc.document ? props.doc : null,
  );
  useEffect(() => {
    setOpeningFailed(false);
    if (props.doc.document) {
      setComplete(props.doc);
      return;
    }
    let active = true;
    client.getDocForEditor(props.doc.id).then(
      (doc) => {
        if (active && account === authSession.token) setComplete(doc);
      },
      () => {
        if (active && account === authSession.token) setOpeningFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [props.doc.id, props.doc.document, openingAttempt, account]);
  useEffect(() => {
    if (complete?.id !== props.doc.id || complete.document?.format !== 2)
      return;
    props.onBlocksChange?.(
      docContainerBlocks(complete.document.nodes, { projected: true }),
    );
  }, [complete, props.doc.id, props.onBlocksChange]);
  if (!complete || complete.id !== props.doc.id)
    return (
      <View style={{ gap: 8 }}>
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {openingFailed ? "Couldn't open page." : "Opening page…"}
        </Text>
        {openingFailed && (
          <SmallAction
            label="Retry"
            disabled={false}
            onPress={() => {
              setOpeningFailed(false);
              setOpeningAttempt((attempt) => attempt + 1);
            }}
          />
        )}
      </View>
    );
  return complete.document?.format === 2 ? (
    <StructuredDocEditor
      doc={complete}
      comments={props.comments}
      userId={props.userId}
      beforeLeave={props.beforeLeave}
      initialBlockId={props.initialBlockId}
      onTargetOffset={props.onTargetOffset}
      canWrite={props.canWrite ?? true}
      onChanged={props.onChanged}
      onShowHistory={props.onShowHistory}
      onShowInLibrary={props.onShowInLibrary}
      onMoveTo={props.onMoveTo}
      report={props.report}
    />
  ) : (
    <LegacyDocEditor {...props} doc={complete} />
  );
}

const styles = themed(() =>
  StyleSheet.create({
    slash: {
      maxHeight: 240,
      marginTop: 4,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    slashRow: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      gap: 2,
    },
    slashDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    slashLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    slashHint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    page: { gap: 12, minWidth: 0 },
    titleEditor: { minHeight: 44 },
    title: {
      color: colors.text,
      fontSize: 24,
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
      maxWidth: "100%",
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    tagDot: { width: 7, height: 7, borderRadius: radii.pill },
    tagText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    note: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.surfaceMuted,
      paddingLeft: 12,
      borderRadius: radii.input,
    },
    noteText: {
      flex: 1,
      fontFamily: fonts.regular,
      color: colors.textSoft,
      fontSize: 13,
      lineHeight: 20,
    },
    noteDismiss: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.input,
    },
    footnoteText: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 23,
    },
    error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
    hint: { color: colors.faint, fontSize: 13, lineHeight: 18 },
    footer: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    footerAction: {
      minHeight: 44,
      maxWidth: "100%",
      justifyContent: "center",
      paddingHorizontal: 4,
      borderRadius: radii.input,
    },
    footerText: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
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
      borderRadius: radii.input,
    },
    addPressed: { backgroundColor: colors.surfaceMuted },
    addText: { color: colors.muted, fontSize: 15, fontFamily: fonts.semibold },
  }),
);

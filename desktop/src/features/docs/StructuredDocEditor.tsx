import { DocLatexPreviewProvider } from "./DocLatexPreview";
import { DocEditorModes } from "./DocEditorModes";
import { DocWritingBlock } from "./DocWritingBlock";
import { ArrowLeft, MoreHorizontal, Plus } from "lucide-react";
import { ownsEditorKey } from "./editor-input";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  docContainerBlocks,
  newBlockId,
  docLatexOperation,
  docFragmentIndex,
  docEditorSessionDirty,
  parseAppLink,
  EXPORT_FORMATS,
  EXPORT_LABELS,
  versionedDocSourceAt,
  versionedDocSourceMap,
  versionedDocSource,
  type Doc,
  type DocBlock,
  type DocSuggestion,
  type DocContentOperation,
  type DocVersion,
  type ExportFormat,
  type VersionedDocContent,
} from "@orbyn/core";
import { DocSourceAsk } from "./DocSourceAsk";
import { DocSuggestions } from "./DocSuggestions";
import { DocSourcePreview } from "./DocSourcePreview";
import { DocEditorStore, prepareDocAssistTarget } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session as authSession } from "../../lib/session";
import { useConfirm } from "../../components/Confirm";
import { BlockView } from "./DocBlocks";
import { DocContainerView } from "./DocContainerView";
import { DocComments } from "./DocComments";
import { PageMaintenanceDialog } from "./PageMaintenanceDialog";
import { PagePublicationDialog } from "../publish/PagePublicationDialog";
import { DocNavigationContext } from "./doc-navigation";
import { OPEN_LINK_EVENT } from "./DocLinks";
import {
  PageCommandScope,
  PaneInputOwner,
  preparePaneDrafts,
  usePageCommands,
} from "../../app/page-commands";
import "./structured-doc-editor.css";

function sourceOf(document: VersionedDocContent): string | null {
  try {
    return versionedDocSource(document, { projected: true });
  } catch {
    return null;
  }
}

/** Complete ownership stays in one draft across visual edits, source and saves. */
export function StructuredDocEditor(
  props: Parameters<typeof StructuredDocEditorBody>[0],
) {
  return <StructuredDocEditorBody key={props.doc.id} {...props} />;
}

function StructuredDocEditorBody({
  doc,
  canWrite,
  onChanged,
  onBack,
  initialBlockId,
  userId,
  report,
}: {
  doc: Doc;
  canWrite: boolean;
  onChanged: (doc: Doc) => void;
  onBack?: () => void;
  initialBlockId?: string | null;
  userId?: string;
  report: (error: unknown) => void;
}) {
  const [latexOpen, setLatexOpen] = useState(false);
  const sourceLeaveCheck = useRef<(() => boolean) | null>(null);
  const latexOwner = useRef(latexOpen);
  latexOwner.current = latexOpen;
  const [sourceAsk, setSourceAsk] = useState<DocBlock | null>(null);
  const [sourceSuggestions, setSourceSuggestions] = useState<DocSuggestion[]>(
    [],
  );
  const [sourcePending, setSourcePending] = useState(false);
  const sourceAlive = useRef(true);
  const sourceRead = useRef(0);
  const sourceMutation = useRef<object | null>(null);
  const sourceOwner = useRef({ id: doc.id, userId });
  sourceOwner.current = { id: doc.id, userId };

  const store = useMemo(() => new DocEditorStore(client), [doc.id]);
  const { ask } = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pageAction, setPageAction] = useState<"updates" | "publish" | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activePane, setActivePane] = useState<"preview" | "source" | "split">(
    "preview",
  );
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const historyRequest = useRef(0);
  const historyMutation = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const pageScope = useContext(PageCommandScope);
  const ownsPaneInput = useContext(PaneInputOwner);
  const beforeCommentAnchor = useRef<(() => Promise<boolean>) | null>(null);
  const anchorChanging = useRef(false);
  const historyPermission = useRef(canWrite);
  historyPermission.current = canWrite;
  const [pendingComment, setPendingComment] = useState<{
    blockId: string;
    quote: string;
  } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [commentTops, setCommentTops] = useState<Record<string, number>>({});
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const ignoredSourceScroll = useRef<number | null>(null);
  const ignoredPreviewScroll = useRef<number | null>(null);
  const initialTargetDone = useRef<string | null>(null);
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
  useEffect(() => {
    void store.open(doc.id);
    return () => store.close();
  }, [store, doc.id]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = (version: number) => {
      const current = store.state.session;
      if (!current || version <= current.saved.version) return;
      if (store.state.busy) timer = setTimeout(() => sync(version), 350);
      else void store.refresh();
    };
    const stop = client.watchDoc(doc.id, sync);
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [doc.id, store]);
  useEffect(() => {
    const current = store.state.session;
    if (!doc.document || !current || doc.version <= current.saved.version)
      return;
    if (docEditorSessionDirty(current) || store.state.source !== null)
      void store.refresh();
    else store.adopt(doc);
  }, [store, doc]);
  const session = state.session;
  useLayoutEffect(() => {
    const input = titleRef.current;
    if (!input) return;
    const size = () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    size();
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        size();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [session?.title, canWrite]);
  const document = session?.document;
  const source = document ? sourceOf(document) : null;
  useEffect(() => {
    sourceAlive.current = true;
    return () => {
      sourceAlive.current = false;
      sourceRead.current++;
    };
  }, []);
  const refreshSourceSuggestions = () => {
    const read = ++sourceRead.current;
    const account = authSession.get();
    client.listDocSuggestions(doc.id).then(
      (list) => {
        if (
          sourceAlive.current &&
          read === sourceRead.current &&
          authSession.get() === account &&
          sourceOwner.current.id === doc.id &&
          sourceOwner.current.userId === userId
        )
          setSourceSuggestions(list);
      },
      (error) => {
        if (
          sourceAlive.current &&
          read === sourceRead.current &&
          authSession.get() === account
        )
          report(error);
      },
    );
  };
  useEffect(() => {
    setSourceAsk(null);
    setSourceSuggestions([]);
    sourceMutation.current = null;
    setSourcePending(false);
    refreshSourceSuggestions();
  }, [doc.id, userId]);
  const savedSource = (target?: DocBlock) => {
    const current = store.state.session;
    if (
      !current ||
      store.state.busy ||
      store.state.error ||
      store.state.conflict ||
      store.state.source !== null ||
      docEditorSessionDirty(current)
    )
      throw new Error(
        "Save or resolve your draft before asking or reviewing changes.",
      );
    if (target) {
      const blocks =
        current.document.format === 2
          ? docContainerBlocks(current.document.nodes, { projected: true })
          : current.document.blocks;
      const block = blocks.find((one) => one.id === target.id);
      if (
        !block ||
        !("text" in block) ||
        !("text" in target) ||
        block.text !== target.text
      )
        throw new Error(
          "The selected source changed. Select it again before asking.",
        );
    }
    return current;
  };
  const askForBlock = async (block: DocBlock) => {
    if (sourceMutation.current || historyMutation.current || !canWrite) return;
    const account = authSession.get();
    const ticket = {};
    const owns = () =>
      sourceAlive.current &&
      sourceMutation.current === ticket &&
      authSession.get() === account &&
      sourceOwner.current.id === doc.id &&
      sourceOwner.current.userId === userId;
    sourceMutation.current = ticket;
    setSourcePending(true);
    try {
      const target = await prepareDocAssistTarget(
        store,
        client,
        doc.id,
        block,
        owns,
      );
      if (owns()) setSourceAsk(target);
    } catch (error) {
      if (owns()) report(error);
    } finally {
      if (sourceMutation.current === ticket) {
        sourceMutation.current = null;
        if (sourceAlive.current) setSourcePending(false);
      }
    }
  };
  const requestSourceSuggestion = async (instruction: string) => {
    const target = sourceAsk;
    if (!target?.id || !("text" in target))
      throw new Error("Select source before asking.");
    if (sourceMutation.current)
      throw new Error("Wait for the current request to finish.");
    const current = savedSource(target);
    const account = authSession.get();
    const ticket = {};
    sourceMutation.current = ticket;
    setSourcePending(true);
    try {
      const made = await client.assistDoc(doc.id, {
        block_id: target.id,
        range_start: 0,
        range_end: target.text.length,
        action: "custom",
        instruction,
        quote: target.text,
        version: current.saved.version,
      });
      if (
        !sourceAlive.current ||
        authSession.get() !== account ||
        sourceOwner.current.id !== doc.id ||
        sourceOwner.current.userId !== userId
      )
        throw new Error("The account or page changed. Reopen this request.");
      sourceRead.current++;
      setSourceSuggestions((list) => [...list, made]);
      return made;
    } finally {
      if (sourceMutation.current === ticket) {
        sourceMutation.current = null;
        if (sourceAlive.current) setSourcePending(false);
      }
    }
  };
  const reviewSourceSuggestions = async (
    actions: { suggestion: DocSuggestion; take?: boolean }[],
  ) => {
    if (sourceMutation.current) return;
    const account = authSession.get();
    const ticket = {};
    const current = () =>
      sourceAlive.current &&
      sourceMutation.current === ticket &&
      authSession.get() === account &&
      sourceOwner.current.id === doc.id &&
      sourceOwner.current.userId === userId;
    sourceMutation.current = ticket;
    setSourcePending(true);
    try {
      for (const { suggestion, take } of actions) {
        if (!current()) return;
        savedSource();
        if (take === undefined)
          await client.withdrawDocSuggestion(doc.id, suggestion.id);
        else await client.decideDocSuggestion(doc.id, suggestion.id, take);
        if (!current()) return;
        if (take) {
          await store.refresh();
          if (current() && store.state.doc) onChanged(store.state.doc);
        }
        if (store.state.error) throw store.state.error;
      }
    } catch (error) {
      if (current()) report(error);
    } finally {
      if (current()) {
        sourceMutation.current = null;
        setSourcePending(false);
        refreshSourceSuggestions();
      }
    }
  };

  const sourceMap = useMemo(() => {
    if (!document || source === null) return null;
    try {
      return versionedDocSourceMap(document, state.source ?? source, {
        projected: true,
      });
    } catch {
      return null;
    }
  }, [document, source, state.source]);
  const sourceBlocks = useMemo(
    () =>
      sourceMap?.ranges
        .filter((range) => range.kind === "block")
        .sort((a, b) => a.start - b.start) ?? [],
    [sourceMap],
  );
  const previewAtCaret = () => {
    const at = sourceRef.current?.selectionStart;
    if (at === undefined || !sourceMap) return;
    const range = versionedDocSourceAt(sourceMap, at);
    if (!range) return;
    const target = [
      ...(previewRef.current?.querySelectorAll<HTMLElement>(
        "[data-container-path]",
      ) ?? []),
    ].find((element) => element.dataset.containerPath === range.path.join("/"));
    const previewPane = previewRef.current;
    if (!target || !previewPane) return;
    const targetRect = target.getBoundingClientRect();
    const paneRect = previewPane.getBoundingClientRect();
    if (targetRect.top < paneRect.top)
      previewPane.scrollTop += targetRect.top - paneRect.top;
    else if (targetRect.bottom > paneRect.bottom)
      previewPane.scrollTop += targetRect.bottom - paneRect.bottom;
  };
  const sourceAtBlock = (path: number[]) => {
    if (activePane === "preview") return;
    const range = sourceMap?.ranges.find(
      (entry) => entry.path.join("/") === path.join("/"),
    );
    if (!range || !sourceRef.current) return;
    setActivePane("source");
    window.requestAnimationFrame(() => {
      const input = sourceRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(range.start, range.end);
      const lineHeight =
        Number.parseFloat(getComputedStyle(input).lineHeight) || 20;
      input.scrollTop = Math.max(0, (range.startLine - 2) * lineHeight);
    });
  };
  const syncPreviewFromSource = () => {
    const sourcePane = sourceRef.current;
    const previewPane = previewRef.current;
    if (!sourcePane || !previewPane || !sourceMap) return;
    if (
      ignoredSourceScroll.current !== null &&
      Math.abs(sourcePane.scrollTop - ignoredSourceScroll.current) < 2
    ) {
      ignoredSourceScroll.current = null;
      return;
    }
    ignoredSourceScroll.current = null;
    if (!sourceBlocks.length) return;
    // The source textarea does not wrap, so its visual position maps to a
    // source line even when adjacent blocks have very different line lengths.
    const lineHeight =
      Number.parseFloat(getComputedStyle(sourcePane).lineHeight) || 20;
    const line = sourcePane.scrollTop / lineHeight + 1;
    const range =
      sourceBlocks.findLast((entry) => entry.startLine <= line) ??
      sourceBlocks[0];
    const element = [
      ...previewPane.querySelectorAll<HTMLElement>(
        ".structured-doc-leaf[data-container-path]",
      ),
    ].find(
      (candidate) => candidate.dataset.containerPath === range.path.join("/"),
    );
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(
        1,
        (line - range.startLine) / Math.max(1, range.endLine - range.startLine),
      ),
    );
    const target = Math.max(
      0,
      Math.min(
        previewPane.scrollHeight - previewPane.clientHeight,
        previewPane.scrollTop +
          rect.top -
          previewPane.getBoundingClientRect().top +
          progress * rect.height,
      ),
    );
    if (Math.abs(previewPane.scrollTop - target) >= 1) {
      previewPane.scrollTop = target;
      ignoredPreviewScroll.current = previewPane.scrollTop;
    }
  };
  const syncSourceFromPreview = () => {
    const sourcePane = sourceRef.current;
    const previewPane = previewRef.current;
    if (!sourcePane || !previewPane || !sourceMap) return;
    if (
      ignoredPreviewScroll.current !== null &&
      Math.abs(previewPane.scrollTop - ignoredPreviewScroll.current) < 2
    ) {
      ignoredPreviewScroll.current = null;
      return;
    }
    ignoredPreviewScroll.current = null;
    const leaves = [
      ...previewPane.querySelectorAll<HTMLElement>(
        ".structured-doc-leaf[data-container-path]",
      ),
    ];
    const top = previewPane.getBoundingClientRect().top + 8;
    const visible =
      leaves.find((element) => element.getBoundingClientRect().bottom > top) ??
      leaves.at(-1);
    if (!visible) return;
    const range = sourceBlocks.find(
      (entry) => entry.path.join("/") === visible.dataset.containerPath,
    );
    if (!range) return;
    const rect = visible.getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(1, (top - rect.top) / Math.max(1, rect.height)),
    );
    const line =
      range.startLine + progress * Math.max(0, range.endLine - range.startLine);
    const lineHeight =
      Number.parseFloat(getComputedStyle(sourcePane).lineHeight) || 20;
    const target = Math.max(
      0,
      Math.min(
        sourcePane.scrollHeight - sourcePane.clientHeight,
        (line - 1) * lineHeight,
      ),
    );
    if (Math.abs(sourcePane.scrollTop - target) >= 1) {
      sourcePane.scrollTop = target;
      ignoredSourceScroll.current = sourcePane.scrollTop;
    }
  };
  const leaves = useMemo(
    () =>
      document?.format === 2
        ? docContainerBlocks(document.nodes, { projected: true })
        : [],
    [document],
  );
  const goToFragment = useCallback(
    (fragment: string) => {
      const index = docFragmentIndex(leaves, fragment);
      if (index === null) {
        setNavigationError("This heading or line is no longer in the page.");
        return;
      }
      setNavigationError(null);
      previewRef.current
        ?.querySelector<HTMLElement>(`[data-leaf-index="${index}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveComment(leaves[index]?.id ?? null);
    },
    [leaves],
  );
  useEffect(() => {
    if (!initialBlockId || !leaves.length) return;
    const target = `${doc.id}:${initialBlockId}`;
    if (initialTargetDone.current === target) return;
    initialTargetDone.current = target;
    requestAnimationFrame(() => goToFragment(initialBlockId));
  }, [doc.id, initialBlockId, goToFragment, leaves.length]);
  useLayoutEffect(() => {
    if (!commentsOpen || !previewRef.current) return;
    const preview = previewRef.current;
    const measure = () => {
      const origin = preview.getBoundingClientRect().top;
      const next: Record<string, number> = {};
      preview
        .querySelectorAll<HTMLElement>("[data-block-id]")
        .forEach((element) => {
          if (element.dataset.blockId)
            next[element.dataset.blockId] =
              element.getBoundingClientRect().top - origin;
        });
      setCommentTops(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [commentsOpen, document]);
  const commentOn = async (block: DocBlock, index: number) => {
    if (!("text" in block) || anchorChanging.current || historyMutation.current)
      return;
    const account = authSession.get();
    const owns = () =>
      sourceAlive.current &&
      authSession.get() === account &&
      sourceOwner.current.id === doc.id;
    anchorChanging.current = true;
    try {
      if (beforeCommentAnchor.current && !(await beforeCommentAnchor.current()))
        return;
      if (!owns()) return;
      if (store.state.session && docEditorSessionDirty(store.state.session))
        await save();
      if (
        !owns() ||
        !store.state.session ||
        docEditorSessionDirty(store.state.session)
      )
        return;
      const blockId =
        block.id ??
        (await client.anchorLine(doc.id, index, block.text)).block_id;
      if (!block.id) await store.refresh();
      if (
        !owns() ||
        historyMutation.current ||
        (store.state.session && docEditorSessionDirty(store.state.session))
      )
        return;
      historyRequest.current++;
      setHistoryOpen(false);
      setPendingComment({ blockId, quote: block.text });
      setActiveComment(blockId);
      setCommentsOpen(true);
    } catch (error) {
      if (owns()) report(error);
    } finally {
      anchorChanging.current = false;
    }
  };
  const change = (
    operation: DocContentOperation,
    expected: VersionedDocContent,
  ) => store.changeOperation(expected, operation);
  const save = useCallback(
    async (retry = false) => {
      const before = store.state.doc?.version;
      if (retry) await store.retrySave();
      else await store.save();
      const next = store.state.doc;
      if (next && next.version !== before) onChanged(next);
      if (store.state.error) report(store.state.error);
      else if (
        store.state.session &&
        !docEditorSessionDirty(store.state.session)
      )
        setNavigationError(null);
    },
    [store, onChanged, report],
  );
  const prepareLinkedPage = useCallback(async () => {
    const account = authSession.get();
    const currentPage = () =>
      sourceAlive.current &&
      authSession.get() === account &&
      sourceOwner.current.id === doc.id;
    if (!(await preparePaneDrafts(pageScope)) || !currentPage()) return false;
    const before = store.state;
    if (before.session && docEditorSessionDirty(before.session)) await save();
    if (!currentPage()) return false;
    const current = store.state;
    if (
      current.busy ||
      current.error ||
      current.conflict ||
      current.sourceInvalid ||
      (current.session && docEditorSessionDirty(current.session))
    ) {
      setNavigationError("Save this draft before opening another page.");
      return false;
    }
    setNavigationError(null);
    return true;
  }, [save, store, doc.id, pageScope]);
  const openLinkedPage = async (url: string) => {
    try {
      if (await prepareLinkedPage())
        window.dispatchEvent(new CustomEvent(OPEN_LINK_EVENT, { detail: url }));
    } catch (error) {
      report(error);
    }
  };
  useEffect(
    () => () => {
      historyRequest.current++;
    },
    [],
  );
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        ownsEditorKey(menuRef.current, event, ownsPaneInput, true)
      ) {
        event.preventDefault();
        setMenuOpen(false);
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    globalThis.document.addEventListener("pointerdown", outside);
    globalThis.document.addEventListener("keydown", escape);
    return () => {
      globalThis.document.removeEventListener("pointerdown", outside);
      globalThis.document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const showHistory = async () => {
    if (historyMutation.current || sourceMutation.current || sourceAsk) return;
    const epoch = ++historyRequest.current;
    setMenuOpen(false);
    setCommentsOpen(false);
    setHistoryOpen(true);
    setVersions(null);
    setSelected(null);
    setHistoryError("");
    try {
      const next = await client.listDocVersions(doc.id);
      if (epoch === historyRequest.current) setVersions(next);
    } catch (reason) {
      if (epoch === historyRequest.current) {
        setHistoryError("Couldn't load history. Try again.");
        report(reason);
      }
    }
  };
  const selectVersion = async (version: number) => {
    if (historyMutation.current || sourceMutation.current || sourceAsk) return;
    historyMutation.current = true;
    const epoch = ++historyRequest.current;
    setHistoryBusy(true);
    setSelected(null);
    setHistoryError("");
    try {
      const next = await client.getDocVersion(doc.id, version);
      if (epoch === historyRequest.current) setSelected(next);
    } catch (reason) {
      if (epoch === historyRequest.current) {
        setHistoryError("Couldn't open this version. Try again.");
        report(reason);
      }
    } finally {
      historyMutation.current = false;
      if (epoch === historyRequest.current) setHistoryBusy(false);
    }
  };
  const restore = async () => {
    if (
      !canWrite ||
      sourceMutation.current ||
      sourceAsk ||
      historyMutation.current ||
      !selected ||
      !session ||
      docEditorSessionDirty(session) ||
      state.source !== null
    )
      return;
    const account = authSession.get();
    const owns = () =>
      sourceAlive.current &&
      authSession.get() === account &&
      sourceOwner.current.id === doc.id;
    historyMutation.current = true;
    setHistoryBusy(true);
    if (
      !(await ask({
        title: "Restore this version?",
        body: "The current page stays in history.",
        confirmLabel: "Restore",
      }))
    ) {
      historyMutation.current = false;
      if (owns()) setHistoryBusy(false);
      return;
    }
    try {
      if (
        !(await preparePaneDrafts(pageScope)) ||
        !owns() ||
        !historyPermission.current
      )
        return;
      const live = store.state;
      if (
        !live.session ||
        docEditorSessionDirty(live.session) ||
        live.source !== null ||
        live.busy
      )
        return;
      const restored = await client.restoreDocVersion(doc.id, selected.version);
      if (!owns()) return;
      store.adopt(restored);
      onChanged(restored);
      setHistoryOpen(false);
      setSelected(null);
    } catch (error) {
      if (owns()) {
        setHistoryError("Couldn't restore this version. Try again.");
        report(error);
      }
    } finally {
      historyMutation.current = false;
      if (owns()) setHistoryBusy(false);
    }
  };
  const download = async (format: ExportFormat) => {
    setMenuOpen(false);
    if (!session || docEditorSessionDirty(session) || state.source !== null)
      return;
    try {
      const { blob, name } = await client.exportDoc(doc.id, format, {
        version: session.saved.version,
      });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      report(error);
    }
  };
  useEffect(() => {
    if (
      !canWrite ||
      !session ||
      !docEditorSessionDirty(session) ||
      state.busy ||
      state.error ||
      state.conflict
    )
      return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [canWrite, session, state.busy, state.error, state.conflict, save]);
  usePageCommands({
    docId: doc.id,
    title: state.doc?.title || doc.title || "Untitled",
    run: {
      "page.history": () => {
        if (!historyBusy && !state.busy) void showHistory();
      },
      "page.download-md": () => {
        if (!state.busy) void download("md");
      },
      "page.download-pdf": () => {
        if (!state.busy) void download("pdf");
      },
    },
    beforeLeave: async () => {
      const current = store.state;
      if (
        current.busy ||
        historyMutation.current ||
        sourceMutation.current ||
        sourceAsk ||
        (latexOwner.current && !sourceLeaveCheck.current?.())
      )
        return false;
      if (current.session && docEditorSessionDirty(current.session))
        await save();
      const next = store.state;
      const ready =
        !next.busy &&
        !next.error &&
        !next.conflict &&
        !next.sourceInvalid &&
        next.source === null &&
        (!next.session || !docEditorSessionDirty(next.session));
      if (!ready)
        setNavigationError("Save this draft before leaving the page.");
      return ready;
    },
  });
  const chooseFormat = async (format: "note" | "markdown" | "latex") => {
    if (latexOwner.current && !sourceLeaveCheck.current?.()) return;
    const current = store.state;
    if (
      current.busy ||
      current.sourceInvalid ||
      current.error ||
      current.conflict ||
      sourceMutation.current ||
      sourceAsk
    )
      return;
    const account = authSession.get();
    if (current.session && docEditorSessionDirty(current.session)) await save();
    const next = store.state;
    if (
      !sourceAlive.current ||
      account !== authSession.get() ||
      !next.session ||
      next.session.saved.id !== doc.id ||
      next.busy ||
      next.error ||
      next.conflict ||
      next.sourceInvalid ||
      docEditorSessionDirty(next.session)
    )
      return;
    setLatexOpen(format === "latex");
    setActivePane(format === "note" ? "preview" : "split");
  };

  return (
    <DocLatexPreviewProvider
      canCompile={canWrite}
      blocks={leaves}
      docId={doc.id}
      ready={
        canWrite &&
        !!session &&
        !state.busy &&
        !state.error &&
        !state.conflict &&
        state.source === null &&
        !docEditorSessionDirty(session)
      }
      compile={(source, signal) =>
        client.compileDocLatex(
          doc.id,
          {
            source,
            version: store.state.session?.saved.version ?? doc.version,
          },
          signal,
        )
      }
    >
      <div
        className="structured-doc-editor"
        data-source-open={activePane !== "preview" || undefined}
        inert={historyBusy}
        aria-busy={historyBusy || undefined}
      >
        {sourceAsk && "text" in sourceAsk && (
          <DocSourceAsk
            key={sourceAsk.id}
            text={sourceAsk.text}
            onAsk={requestSourceSuggestion}
            onClose={() => setSourceAsk(null)}
          />
        )}

        <DocSuggestions
          suggestions={sourceSuggestions}
          userId={userId}
          canDecide={canWrite}
          busy={
            sourcePending ||
            state.busy ||
            !session ||
            docEditorSessionDirty(session) ||
            state.source !== null
          }
          sourceBlockIds={
            new Set(
              leaves
                .filter(
                  (block) => block.type === "code" || block.type === "math",
                )
                .flatMap((block) => (block.id ? [block.id] : [])),
            )
          }
          onDecide={(suggestion, take) =>
            void reviewSourceSuggestions([{ suggestion, take }])
          }
          onWithdraw={(suggestion) =>
            void reviewSourceSuggestions([{ suggestion }])
          }
          onDecideAll={(list, take) =>
            void reviewSourceSuggestions(
              list.map((suggestion) => ({ suggestion, take })),
            )
          }
        />
        <header className="structured-doc-toolbar">
          <DocEditorModes
            value={
              latexOpen
                ? "latex"
                : activePane === "preview"
                  ? "note"
                  : "markdown"
            }
            disabled={
              !session ||
              state.sourceInvalid ||
              state.busy ||
              !!state.conflict ||
              sourcePending ||
              !!sourceAsk
            }
            onChange={(format) => void chooseFormat(format)}
          />
          {onBack && (
            <button
              className="icon-button structured-doc-back"
              aria-label="All documents"
              title="All documents"
              disabled={sourcePending || !!sourceAsk || latexOpen}
              onClick={() => {
                if (
                  state.source !== null &&
                  (state.error || !session || !docEditorSessionDirty(session))
                ) {
                  void ask({
                    title: "Discard the unsaved source draft?",
                    confirmLabel: "Discard",
                    destructive: true,
                  }).then((confirmed) => {
                    if (confirmed) onBack();
                  });
                } else if (session && docEditorSessionDirty(session)) {
                  void save().then(() => {
                    if (
                      store.state.session &&
                      !docEditorSessionDirty(store.state.session)
                    )
                      onBack();
                  });
                } else onBack();
              }}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <span className="structured-doc-status">
            {!session
              ? state.busy
                ? "Opening…"
                : "Unavailable"
              : state.busy
                ? "Saving…"
                : state.conflict
                  ? "Review changes"
                  : session && docEditorSessionDirty(session)
                    ? "Unsaved"
                    : "Saved"}
          </span>
          {canWrite && session && docEditorSessionDirty(session) && (
            <button
              className="secondary"
              onClick={() => void save(!!state.error)}
              disabled={
                state.busy ||
                state.conflict ||
                state.sourceInvalid ||
                !session ||
                !docEditorSessionDirty(session)
              }
            >
              {state.error && !state.conflict && !state.sourceInvalid
                ? "Retry save"
                : "Save"}
            </button>
          )}
          <div className="structured-doc-menu" ref={menuRef}>
            <button
              className="icon-button"
              type="button"
              aria-label="Page actions"
              title="Page actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="structured-doc-menu-items">
                <button
                  className="secondary"
                  type="button"
                  disabled={state.busy}
                  onClick={() => {
                    setMenuOpen(false);
                    void store.refresh();
                  }}
                >
                  Refresh
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={historyBusy}
                  onClick={() => void showHistory()}
                >
                  History
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (
                      historyMutation.current ||
                      sourceMutation.current ||
                      sourceAsk
                    )
                      return;
                    historyRequest.current++;
                    setHistoryOpen(false);
                    setCommentsOpen((value) => !value);
                  }}
                >
                  Comments
                </button>
                {EXPORT_FORMATS.map((format) => (
                  <button
                    className="secondary"
                    type="button"
                    key={format}
                    disabled={
                      !session ||
                      docEditorSessionDirty(session) ||
                      state.source !== null
                    }
                    onClick={() => void download(format)}
                  >
                    Export {EXPORT_LABELS[format].name}
                  </button>
                ))}
                {canWrite &&
                  (["updates", "publish"] as const).map((action) => (
                    <button
                      className="secondary"
                      key={action}
                      type="button"
                      disabled={
                        state.busy ||
                        !!state.error ||
                        state.conflict ||
                        !session ||
                        docEditorSessionDirty(session) ||
                        state.source !== null
                      }
                      onClick={() => {
                        setMenuOpen(false);
                        setPageAction(action);
                      }}
                    >
                      {action === "updates" ? "Page updates" : "Publish to web"}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </header>
        {pageAction === "updates" && (
          <PageMaintenanceDialog
            id={doc.id}
            onChanged={(next) => {
              store.adopt(next);
              onChanged(next);
            }}
            onClose={() => setPageAction(null)}
          />
        )}
        {pageAction === "publish" && (
          <PagePublicationDialog
            id={doc.id}
            onChanged={(next) => {
              store.adopt(next);
              onChanged(next);
            }}
            onClose={() => setPageAction(null)}
          />
        )}
        {state.error !== null && (
          <p className="structured-doc-error" role="alert">
            {state.sourceInvalid && state.error instanceof Error
              ? state.error.message
              : session
                ? "Couldn’t save this page. Your draft is still here."
                : "Couldn’t open this page. Try again."}
          </p>
        )}
        {navigationError && (
          <p className="structured-doc-error" role="status">
            {navigationError}
          </p>
        )}
        {state.conflict && (
          <p className="structured-doc-error" role="alert">
            This page changed elsewhere. Your draft is still here for review.
          </p>
        )}
        {(state.conflict || state.error !== null) && session && (
          <button
            className="secondary"
            type="button"
            onClick={() =>
              void ask({
                title: "Discard this draft?",
                confirmLabel: "Discard",
                destructive: true,
              }).then((confirmed) => {
                if (confirmed) void store.discardLocal();
              })
            }
          >
            Discard draft
          </button>
        )}
        {!session || !document ? (
          <div>
            <p role="status">
              {state.busy ? "Opening page…" : "Page unavailable."}
            </p>
            {!state.busy && (
              <button
                className="secondary"
                onClick={() => void store.open(doc.id)}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            {canWrite ? (
              <textarea
                ref={titleRef}
                rows={1}
                className="structured-doc-title"
                aria-label="Page title"
                value={session.title}
                onChange={(event) =>
                  store.changeTitle(session.title, event.currentTarget.value)
                }
                maxLength={200}
              />
            ) : (
              <h1>{session.title}</h1>
            )}
            {activePane !== "preview" && !latexOpen && (
              <button
                type="button"
                className="secondary"
                onClick={() => void chooseFormat("note")}
              >
                Hide source
              </button>
            )}
            <div
              className="structured-doc-columns"
              data-active-pane={activePane}
            >
              <section
                ref={previewRef}
                aria-label="Page preview"
                className="structured-doc-preview"
                onScroll={(event) => {
                  if (event.currentTarget === event.target)
                    syncSourceFromPreview();
                }}
              >
                {document.format === 2 && (
                  <DocNavigationContext.Provider
                    value={{
                      docId: doc.id,
                      onFragment: goToFragment,
                      onAppLink: (url) => {
                        const link = parseAppLink(url);
                        if (
                          link?.kind === "doc" &&
                          link.id === doc.id &&
                          link.block
                        )
                          goToFragment(link.block);
                        else void openLinkedPage(url);
                      },
                    }}
                  >
                    <DocContainerView
                      nodes={document.nodes}
                      onOperation={
                        canWrite
                          ? (operation, expectedNodes) =>
                              change(operation, {
                                format: 2,
                                nodes: [...expectedNodes],
                              })
                          : undefined
                      }
                      renderLeaf={(block, index, path) => (
                        <DocWritingBlock
                          index={index}
                          path={path}
                          blockId={block.id}
                          text={"text" in block ? block.text : null}
                          canWrite={canWrite}
                          keepRendered={block.type === "code"}
                          editing={editing === path.join("/")}
                          sourceOpen={activePane !== "preview"}
                          onSourceFocus={() => sourceAtBlock(path)}
                          onEdit={() => setEditing(path.join("/"))}
                          onDone={() => setEditing(null)}
                          onChange={(text) =>
                            change(
                              {
                                kind: "replace-leaf",
                                path,
                                block: { ...block, text } as DocBlock,
                              },
                              document,
                            )
                          }
                          onComment={() => void commentOn(block, index)}
                          onAssist={() => askForBlock(block)}
                          assistDisabled={
                            sourcePending ||
                            state.busy ||
                            docEditorSessionDirty(session) ||
                            state.source !== null
                          }
                        >
                          <BlockView block={block} pageBlocks={leaves} />
                        </DocWritingBlock>
                      )}
                    />
                    {canWrite && activePane === "preview" && (
                      <button
                        type="button"
                        className="text-button doc-add-text"
                        disabled={
                          state.sourceInvalid ||
                          !!state.conflict ||
                          sourcePending ||
                          !!sourceAsk
                        }
                        onClick={() => {
                          const index = document.nodes.length;
                          change(
                            {
                              kind: "insert",
                              owner: [],
                              index,
                              node: {
                                kind: "block",
                                block: {
                                  type: "paragraph",
                                  text: "",
                                  id: newBlockId(),
                                },
                              },
                            },
                            document,
                          );
                          if (!store.state.error) setEditing(String(index));
                        }}
                      >
                        <Plus size={15} /> Add text
                      </button>
                    )}
                  </DocNavigationContext.Provider>
                )}
              </section>
              <section
                aria-label="Markdown source"
                className="structured-doc-source"
              >
                {latexOpen && document && session && (
                  <DocSourcePreview
                    leaveCheck={sourceLeaveCheck}
                    compileReady={
                      !state.busy &&
                      !state.error &&
                      !state.conflict &&
                      !!session &&
                      !docEditorSessionDirty(session) &&
                      state.source === null
                    }
                    inline
                    sourceOnly
                    showModes={false}
                    beforeNavigate={prepareLinkedPage}
                    latexOnly
                    blocks={leaves}
                    docId={doc.id}
                    onClose={() => {
                      latexOwner.current = false;
                      setLatexOpen(false);
                      setActivePane("preview");
                    }}
                    onAssist={
                      canWrite &&
                      !state.busy &&
                      !state.error &&
                      !state.conflict &&
                      state.source === null &&
                      !docEditorSessionDirty(session)
                        ? (block) => {
                            setLatexOpen(false);
                            askForBlock(block);
                          }
                        : undefined
                    }

                    onAppLink={(url) => void openLinkedPage(url)}
                    onCompileLatex={(source, signal) =>
                      client.compileDocLatex(
                        doc.id,
                        {
                          source,
                          version:
                            store.state.session?.saved.version ??
                            session.saved.version,
                        },
                        signal,
                      )
                    }
                    onLatexChange={
                      canWrite
                        ? (text, expected) => {
                            const current = store.state.session;
                            if (
                              !current ||
                              current.document !== document ||
                              JSON.stringify(expected) !==
                                JSON.stringify(leaves) ||
                              store.state.sourceInvalid ||
                              store.state.conflict ||
                              store.state.error
                            )
                              throw new Error(
                                "The document changed. Restore the current document before editing.",
                              );
                            store.changeOperation(
                              document,
                              docLatexOperation(document, text),
                            );
                            if (store.state.error) throw store.state.error;
                            const next = store.state.session?.document;
                            if (!next)
                              throw new Error("The document is unavailable.");
                            return next.format === 2
                              ? docContainerBlocks(next.nodes, {
                                  projected: true,
                                })
                              : next.blocks;
                          }
                        : undefined
                    }
                  />
                )}

                <div hidden={latexOpen}>
                  <div className="structured-doc-source-head">
                    <h2>Markdown</h2>
                    {canWrite && (
                      <button
                        className="secondary"
                        type="button"
                        disabled={
                          sourcePending ||
                          state.busy ||
                          !session ||
                          docEditorSessionDirty(session) ||
                          state.source !== null
                        }
                        onClick={() => {
                          const range =
                            sourceMap &&
                            versionedDocSourceAt(
                              sourceMap,
                              sourceRef.current?.selectionStart ?? 0,
                            );
                          const block =
                            range?.blockIndex !== undefined
                              ? leaves[range.blockIndex]
                              : undefined;
                          if (block) askForBlock(block);
                          else
                            setNavigationError(
                              "Place the cursor in text before asking the assistant.",
                            );
                        }}
                      >
                        Ask assistant
                      </button>
                    )}
                  </div>
                  {source === null ? (
                    <p>Source view is unavailable for this structure.</p>
                  ) : canWrite ? (
                    <textarea
                      ref={sourceRef}
                      aria-label="Markdown source"
                      value={state.source ?? source}
                      onSelect={previewAtCaret}
                      onScroll={syncPreviewFromSource}
                      onChange={(event) =>
                        store.changeSource(document, event.currentTarget.value)
                      }
                      spellCheck={false}
                      wrap="off"
                    />
                  ) : (
                    <pre>{source}</pre>
                  )}
                </div>
              </section>
            </div>
            <aside
              hidden={!commentsOpen}
              style={!commentsOpen ? { display: "none" } : undefined}
              className="structured-doc-comments"
              aria-label="Page comments"
            >
              <div className="structured-doc-history-head">
                <h2>Comments</h2>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setCommentsOpen(false)}
                >
                  Close
                </button>
              </div>
              <DocComments
                docId={doc.id}
                hidden={!commentsOpen}
                beforeAnchorChange={beforeCommentAnchor}
                blocks={leaves}
                tops={commentTops}
                userId={userId}
                pending={pendingComment}
                onPendingChange={setPendingComment}
                active={activeComment}
                onActiveChange={setActiveComment}
                onAnchors={() => {}}
                report={report}
              />
            </aside>
            {historyOpen && (
              <aside
                className="structured-doc-history"
                aria-label="Page history"
              >
                <div className="structured-doc-history-head">
                  <h2>History</h2>
                  <button
                    className="secondary"
                    type="button"
                    disabled={historyBusy}
                    onClick={() => {
                      historyRequest.current++;
                      setHistoryOpen(false);
                    }}
                  >
                    Close
                  </button>
                </div>
                {historyError && (
                  <p role="alert">
                    {historyError}{" "}
                    <button
                      className="text-button"
                      disabled={historyBusy}
                      onClick={() => void showHistory()}
                    >
                      Retry history
                    </button>
                  </p>
                )}
                {versions === null ? (
                  !historyError && <p role="status">Loading…</p>
                ) : versions.length === 0 ? (
                  <p>No earlier version.</p>
                ) : (
                  <ol>
                    {versions.map((version) => (
                      <li key={version.version}>
                        <button
                          className="secondary"
                          type="button"
                          disabled={historyBusy}
                          onClick={() => void selectVersion(version.version)}
                        >
                          {new Date(version.created_at).toLocaleString()} ·{" "}
                          {version.author ?? "Someone"}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {selected && (
                  <div>
                    <h3>{selected.title || "Untitled"}</h3>
                    {selected.document?.format === 2 ? (
                      <DocContainerView nodes={selected.document.nodes} />
                    ) : (
                      <div>
                        {selected.content?.map((block, index) => (
                          <BlockView
                            key={block.id ?? index}
                            block={block}
                            pageBlocks={selected.content ?? []}
                          />
                        ))}
                      </div>
                    )}
                    <button
                      className="secondary"
                      type="button"
                      disabled={
                        !canWrite ||
                        historyBusy ||
                        docEditorSessionDirty(session) ||
                        state.source !== null
                      }
                      onClick={() => void restore()}
                    >
                      Restore this version
                    </button>
                  </div>
                )}
              </aside>
            )}
          </>
        )}
      </div>
    </DocLatexPreviewProvider>
  );
}

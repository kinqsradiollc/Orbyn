import { DocAsk } from "./DocAsk";
import { useDocExcerpt } from "./useDocExcerpt";
import { routeDocumentDownload } from "./document-download";
import { useDocumentLibrary } from "./DocumentWorkspace";
import { DocumentDivider } from "../../components/DocumentDivider";
import {
  DocLatexPreviewProvider,
  DocLatexDocumentPreview,
} from "./DocLatexPreview";
import { DocEditorModes } from "./DocEditorModes";
import { DocWritingBody } from "./DocWritingBody";
import React, {
  useEffect,
  useMemo,
  useSyncExternalStore,
  useContext,
} from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import {
  docContainerBlocks,
  newBlockId,
  type ExportFormat,
  docLatexOperation,
  docWholeLatexOperation,
  docFragmentIndex,
  docEditorSessionDirty,
  isOfflineError,
  parseAppLink,
  versionedDocSource,
  versionedDocSourceMap,
  versionedDocSourceAt,
  type Doc,
  type DocBlock,
  type DocSuggestion,
  type VersionedDocContent,
} from "@orbyn/core";
import { DocSourceAsk } from "./DocSourceAsk";
import { DocSuggestions } from "./DocSuggestions";
import { DocSourcePreview } from "./DocSourcePreview";
import { DocEditorStore, prepareDocAssistTarget } from "@orbyn/api-client";
import { Pressable } from "../../motion";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { BottomSheet } from "../../components/BottomSheet";
import { Icon } from "../../components/Icon";
import { colors, fonts, inputFontSize, radii, themed } from "../../theme";
import { client } from "../../lib/api";
import { session as authSession } from "../../lib/session";
import { rememberPageDurable } from "../../lib/pageCache";
import { canLeaveStructuredDocDraft } from "../../lib/structuredDocDraftGuard";
import { savePageOffline } from "../../lib/outbox";
import { saveFile, downloadLabel, formatsHere } from "../../lib/download";
import { DocContainerBody } from "./DocContainerBody";
import { DocBody } from "./DocBody";
import { PageMaintenanceSheet } from "./PageMaintenanceSheet";
import { PagePublicationSheet } from "./PagePublicationSheet";
import { DocThread } from "./DocThread";
import { commentDraftScope, CommentDraftContext } from "./doc-comment-drafts";
import type { DocCommentsState } from "./useDocComments";
import { DocNavigationContext } from "./doc-navigation";
import { openAppUrl } from "../../hooks/useAppLinks";

function sourceOf(document: VersionedDocContent): string | null {
  try {
    return versionedDocSource(document, { projected: true });
  } catch {
    return null;
  }
}

/** A compact native source/preview toggle sharing the full page revision. */
export function StructuredDocEditor(
  props: React.ComponentProps<typeof StructuredDocEditorBody>,
) {
  return (
    <StructuredDocEditorBody
      key={`${authSession.token}:${props.doc.id}`}
      {...props}
    />
  );
}

function StructuredDocEditorBody({
  doc,
  comments,
  userId,
  beforeLeave,
  initialBlockId,
  onTargetOffset,
  canWrite,
  onChanged,
  onShowHistory,
  onShowComments,
  onShowInLibrary,
  onMoveTo,
  report,
}: {
  doc: Doc;
  comments: DocCommentsState;
  userId?: string;
  beforeLeave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  initialBlockId?: string | null;
  onTargetOffset?: (y: number) => void;
  canWrite: boolean;
  onChanged: (doc: Doc) => void;
  onShowHistory?: () => void;
  onShowComments?: () => void;
  onShowInLibrary?: () => void;
  onMoveTo?: () => void;
  report: (error: unknown) => void;
}) {
  const commentDrafts = useContext(CommentDraftContext);
  const threadNavigation = React.useRef(false);
  const toggleThread = async (id: string) => {
    if (threadNavigation.current || !currentPage()) return;
    threadNavigation.current = true;
    try {
      if (
        openThread &&
        commentDrafts &&
        !(await commentDrafts.prepare(commentDraftScope(openThread)))
      )
        return;
      if (currentPage())
        setOpenThread((current) => (current === id ? null : id));
    } finally {
      threadNavigation.current = false;
    }
  };
  const [latexSourceNumber, setLatexSourceNumber] = React.useState(0);
  const [latexOpen, setLatexOpen] = React.useState(false);
  const sourceLeaveCheck = React.useRef<(() => boolean) | null>(null);
  const sourcePdfExport = React.useRef<(() => Promise<void>) | null>(null);
  const downloadPending = React.useRef(false);
  const latexOwner = React.useRef(latexOpen);
  latexOwner.current = latexOpen;
  const [selectedExcerpt, setSelectedExcerpt] = React.useState<
    Parameters<typeof excerpt.open>[0] | null
  >(null);
  const [excerptOpen, setExcerptOpen] = React.useState(false);
  const sourceSelectionHandle = React.useRef<
    (() => Parameters<typeof excerpt.open>[0] | null) | null
  >(null);
  const excerpt = useDocExcerpt(
    () => ({
      id: doc.id,
      userId,
      account: authSession.token,
      revision: store.state.session?.saved.version ?? doc.version,
      blocked:
        store.state.busy ||
        !!store.state.conflict ||
        (!!store.state.error && !store.state.sourceInvalid),
      format: sourceFormat,
      epoch: JSON.stringify({
        document: store.state.session?.document,
        source: store.state.source,
        conflict: store.state.conflict,
      }),
    }),
    report,
  );
  const openExcerpt = (selection: Parameters<typeof excerpt.open>[0]) => {
    if (excerpt.open(selection)) setExcerptOpen(true);
  };
  const openPageAssistant = () => {
    const selected =
      (latexOpen ? sourceSelectionHandle.current?.() : null) ??
      (selectedExcerpt?.format === sourceFormat ? selectedExcerpt : null);
    if (selected) {
      openExcerpt(selected);
      return;
    }
    excerpt.clear();
    setExcerptOpen(true);
  };
  const [sourceAsk, setSourceAsk] = React.useState<DocBlock | null>(null);
  const [sourceSuggestions, setSourceSuggestions] = React.useState<
    DocSuggestion[]
  >([]);
  const [sourcePending, setSourcePending] = React.useState(false);
  const sourceAlive = React.useRef(true);
  const sourceRead = React.useRef(0);
  const pageOwner = React.useRef({
    account: authSession.token,
    id: doc.id,
    userId,
  }).current;
  const currentPage = () =>
    sourceAlive.current &&
    authSession.token === pageOwner.account &&
    sourceOwner.current.id === pageOwner.id;
  const sourceMutation = React.useRef<object | null>(null);
  const sourceOwner = React.useRef({ id: doc.id, userId });
  sourceOwner.current = { id: doc.id, userId };

  const store = useMemo(() => new DocEditorStore(client), [doc.id]);
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
  const refreshPage = () => {
    if (store.state.busy) return;
    if (store.state.session) void store.refresh();
    else void store.open(doc.id, doc);
  };
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const [paneWidth, setPaneWidth] = React.useState(0);
  const [splitRequested, setSplitRequested] = React.useState(false);
  const [sourceFormat, setSourceFormat] = React.useState<
    "note" | "markdown" | "latex"
  >("note");
  const [paneRatio, setPaneRatio] = React.useState(50);
  useDocumentLibrary(sourceFormat !== "note");
  const split = splitRequested && paneWidth / Math.max(1, fontScale) >= 760;
  const paneHeight = Math.max(180, windowHeight - 200);
  const sourceSelection = React.useRef(0);
  const [sourceVisible, setSourceVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [openThread, setOpenThread] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const afterMenu = React.useRef<(() => void) | null>(null);
  const closeMenuThen = (action: () => void) => {
    afterMenu.current = action;
    setMenuOpen(false);
  };
  const [pageAction, setPageAction] = React.useState<
    "updates" | "publish" | null
  >(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [keptOffline, setKeptOffline] = React.useState(false);
  const [navigationError, setNavigationError] = React.useState<string | null>(
    null,
  );
  const offlineQueued = React.useRef(false);
  const editGeneration = React.useRef(0);
  const queueInFlight = React.useRef(false);
  const pageRef = React.useRef<View>(null);
  const previewScroll = React.useRef<ScrollView>(null);
  const previewAnchor = React.useRef<View>(null);
  const previewContent = React.useRef<View>(null);
  const pageOffset = React.useRef(0);
  const leafRefs = React.useRef(new Map<number, View>());
  const pendingInitial = React.useRef<string | null>(initialBlockId ?? null);
  useEffect(() => {
    setMenuOpen(false);
    afterMenu.current = null;
    setPageAction(null);
    setDiscardOpen(false);
    setEditing(null);
    setOpenThread(null);
    void store.open(doc.id, doc);
    return () => {
      afterMenu.current = null;
      store.close();
    };
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
    const account = authSession.token;
    client.listDocSuggestions(doc.id).then(
      (list) => {
        if (
          sourceAlive.current &&
          read === sourceRead.current &&
          authSession.token === account &&
          sourceOwner.current.id === doc.id &&
          sourceOwner.current.userId === userId
        )
          setSourceSuggestions(list);
      },
      (error) => {
        if (
          sourceAlive.current &&
          read === sourceRead.current &&
          authSession.token === account
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
    if (sourceMutation.current || !canWrite || !currentPage()) return;
    const account = authSession.token;
    const ticket = {};
    const owns = () =>
      sourceAlive.current &&
      sourceMutation.current === ticket &&
      authSession.token === account &&
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
    const account = authSession.token;
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
        authSession.token !== account ||
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
    const account = authSession.token;
    const ticket = {};
    const current = () =>
      sourceAlive.current &&
      sourceMutation.current === ticket &&
      authSession.token === account &&
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

  const leaves = useMemo(
    () =>
      document?.format === 2
        ? docContainerBlocks(document.nodes, { projected: true })
        : [],
    [document],
  );
  const goToFragment = React.useCallback(
    (fragment: string) => {
      const current = store.state.session?.document;
      const blocks =
        current?.format === 2
          ? docContainerBlocks(current.nodes, { projected: true })
          : [];
      const index = docFragmentIndex(blocks, fragment);
      if (index === null) {
        setNavigationError("This heading or line is no longer in the page.");
        return;
      }
      setNavigationError(null);
      setSourceVisible(false);
      requestAnimationFrame(() => {
        if (!currentPage()) return;
        const leaf = leafRefs.current.get(index);
        if (
          !leaf ||
          !previewContent.current ||
          !pageRef.current ||
          !previewAnchor.current
        )
          return;
        previewAnchor.current.measureLayout(
          pageRef.current,
          (_x, y) => {
            if (currentPage()) onTargetOffset?.(pageOffset.current + y);
          },
          () => undefined,
        );
        leaf.measureLayout(
          previewContent.current,
          (_x, y) =>
            currentPage() &&
            previewScroll.current?.scrollTo({
              y: Math.max(0, y - 12),
              animated: false,
            }),
          () => {
            if (currentPage()) report(new Error("Could not locate this line."));
          },
        );
      });
    },
    [store, onTargetOffset, report],
  );
  useEffect(() => {
    pendingInitial.current = initialBlockId ?? null;
  }, [doc.id, initialBlockId]);
  useEffect(() => {
    if (!initialBlockId || document?.format !== 2) return;
    if (docFragmentIndex(leaves, initialBlockId) !== null) return;
    pendingInitial.current = null;
    setNavigationError("This heading or line is no longer in the page.");
  }, [doc.id, initialBlockId, document, leaves]);
  const save = React.useCallback(
    async (retry = false) => {
      if (queueInFlight.current || !currentPage()) return;
      const account = pageOwner.account;
      const before = store.state.doc?.version;
      if (retry) await store.retrySave();
      else await store.save();
      if (!currentPage()) return;
      const next = store.state.doc;
      if (next && next.version !== before) onChanged(next);
      if (!store.state.sourceInvalid && isOfflineError(store.state.error)) {
        const draft = store.state.session;
        if (!draft) return;
        const generation = editGeneration.current;
        queueInFlight.current = true;
        const leavesOf = (value: VersionedDocContent) =>
          value.format === 1
            ? value.blocks
            : docContainerBlocks(value.nodes, { projected: true });
        try {
          await savePageOffline(
            {
              id: doc.id,
              title: draft.title,
              document: draft.document,
              content: leavesOf(draft.document),
              base: {
                version: draft.saved.version,
                title: draft.saved.title,
                document: draft.saved.document,
                content: leavesOf(draft.saved.document),
              },
            },
            account,
          );
          if (!currentPage()) return;
          const kept = {
            ...(store.state.doc ?? doc),
            title: draft.title,
            document: draft.document,
            content: leavesOf(draft.document),
          };
          if (
            !(await rememberPageDurable(kept, account)) ||
            !currentPage() ||
            store.state.sourceInvalid
          )
            return;
          if (generation === editGeneration.current) {
            store.acknowledgeOfflineSave();
            onChanged(kept);
            offlineQueued.current = true;
            setKeptOffline(true);
          } else {
            offlineQueued.current = false;
            setKeptOffline(false);
          }
        } catch (error) {
          if (currentPage()) report(error);
        } finally {
          queueInFlight.current = false;
        }
      } else if (store.state.error) report(store.state.error);
      else {
        setNavigationError(null);
        offlineQueued.current = false;
        setKeptOffline(false);
      }
    },
    [store, doc, onChanged, report],
  );
  const prepareLinkedPage = React.useCallback(async () => {
    if (commentDrafts && !(await commentDrafts.prepare())) return false;
    if (!currentPage()) return false;
    const before = store.state;
    if (before.session && docEditorSessionDirty(before.session)) await save();
    if (!currentPage()) return false;
    const current = store.state;
    if (
      current.busy ||
      current.error ||
      current.conflict ||
      current.sourceInvalid ||
      queueInFlight.current ||
      (current.session &&
        docEditorSessionDirty(current.session) &&
        !offlineQueued.current)
    ) {
      setNavigationError("Save this draft before opening another page.");
      return false;
    }
    setNavigationError(null);
    return true;
  }, [save, store, commentDrafts]);
  const openLinkedPage = async (url: string) => {
    try {
      if (await prepareLinkedPage()) openAppUrl(url);
    } catch (error) {
      report(error);
    }
  };
  useEffect(() => {
    if (!beforeLeave) return;
    const guard = async () => {
      const current = store.state;
      if (
        !currentPage() ||
        sourceMutation.current ||
        sourceAsk ||
        (latexOwner.current && !sourceLeaveCheck.current?.()) ||
        pageAction
      )
        return false;
      if (!current.session) return true;
      if (current.sourceInvalid || (current.source !== null && current.error))
        return false;
      if (current.conflict) return false;
      if (docEditorSessionDirty(current.session) && !offlineQueued.current)
        await save();
      const settled = store.state;
      return canLeaveStructuredDocDraft(settled, offlineQueued.current);
    };
    beforeLeave.current = guard;
    return () => {
      if (beforeLeave.current === guard) beforeLeave.current = null;
    };
  }, [beforeLeave, store, save, sourceAsk, latexOpen, pageAction]);
  const discard = () => {
    offlineQueued.current = false;
    setKeptOffline(false);
    void store.discardLocal();
  };
  useEffect(() => {
    if (
      !canWrite ||
      !session ||
      !docEditorSessionDirty(session) ||
      state.busy ||
      state.error ||
      state.conflict ||
      keptOffline
    )
      return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [
    canWrite,
    session,
    state.busy,
    state.error,
    state.conflict,
    keptOffline,
    save,
  ]);
  const chooseFormat = async (
    format: "note" | "markdown" | "latex",
    sourceNumber = -1,
  ) => {
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
    const account = authSession.token;
    if (current.session && docEditorSessionDirty(current.session)) await save();
    const next = store.state;
    if (
      !sourceAlive.current ||
      account !== authSession.token ||
      !next.session ||
      next.session.saved.id !== doc.id ||
      next.busy ||
      next.error ||
      next.conflict ||
      next.sourceInvalid ||
      docEditorSessionDirty(next.session)
    )
      return;
    setEditing(null);
    setSourceFormat(format);
    setLatexSourceNumber(sourceNumber);
    setLatexOpen(format === "latex");
    setSplitRequested(format !== "note");
    setSourceVisible(format !== "note");
  };

  const openBlockEditor = (block: DocBlock, index: number, path: number[]) => {
    if (!canWrite || sourceFormat !== "note") return;
    if (block.type === "code") {
      const ordinal = Math.max(
        0,
        leaves
          .slice(0, index + 1)
          .filter(
            (candidate) =>
              candidate.type === "code" && candidate.lang === "latex-document",
          ).length - 1,
      );
      void chooseFormat(
        block.lang === "latex-document" ? "latex" : "markdown",
        ordinal,
      );
    } else setEditing(path.join("/"));
  };

  const download = async (format: ExportFormat) => {
    if (downloadPending.current || !currentPage()) return;
    downloadPending.current = true;
    try {
      await routeDocumentDownload(
        format,
        latexOpen && latexSourceNumber >= 0,
        sourcePdfExport,
        () => {
          const current = store.state;
          return (
            currentPage() &&
            !!current.session &&
            !current.busy &&
            !current.error &&
            !current.conflict &&
            !current.sourceInvalid &&
            current.source === null &&
            !docEditorSessionDirty(current.session) &&
            (!latexOpen || sourceLeaveCheck.current?.() === true)
          );
        },
        async () => {
          const { blob, name } = await client.exportDoc(doc.id, format, {
            version: store.state.session!.saved.version,
          });
          if (currentPage())
            await saveFile(name, blob, blob.type || "application/octet-stream");
        },
      );
    } catch (error) {
      if (currentPage()) report(error);
    } finally {
      downloadPending.current = false;
    }
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
      <View
        ref={pageRef}
        style={[styles.page, { height: Math.max(320, windowHeight - 112) }]}
        onLayout={(event) => {
          pageOffset.current = event.nativeEvent.layout.y;
          setPaneWidth(event.nativeEvent.layout.width);
        }}
      >
        <DocAsk
          visible={excerptOpen}
          docId={doc.id}
          blocks={leaves}
          canWrite={false}
          excerpt={excerpt.context}
          isSelectionCurrent={excerpt.current}
          onClose={() => setExcerptOpen(false)}
          onGoToBlock={() => {}}
          onNameBlock={() => ""}
          onSuggested={() => {}}
        />
        {sourceAsk && "text" in sourceAsk && (
          <DocSourceAsk
            key={sourceAsk.id}
            text={sourceAsk.text}
            onAsk={requestSourceSuggestion}
            onClose={() => setSourceAsk(null)}
          />
        )}
        <View style={{ flex: 1, minHeight: 0, gap: 10 }}>
          <ActionSheet
            visible={discardOpen}
            label="Discard page draft"
            title="Discard draft?"
            message="This removes your unsaved edits."
            cancelLabel="Keep editing"
            actions={[
              { label: "Discard", destructive: true, onPress: discard },
            ]}
            onClose={() => setDiscardOpen(false)}
          />
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
          />
          <View style={styles.toolbar}>
            <DocEditorModes
              value={sourceFormat}
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
            {sourceFormat !== "note" && !split && (
              <View style={styles.paneSwitch}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: sourceVisible }}
                  onPress={() => setSourceVisible(true)}
                  style={styles.actionTarget}
                >
                  <Text style={styles.action}>Source</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: !sourceVisible }}
                  onPress={() => setSourceVisible(false)}
                  style={styles.actionTarget}
                >
                  <Text style={styles.action}>Preview</Text>
                </Pressable>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Talk about this page"
              style={styles.actionTarget}
              onPress={openPageAssistant}
            >
              <Icon name="sparkles" size={18} color={colors.text} />
            </Pressable>
            <Text style={styles.status}>
              {!session
                ? state.busy
                  ? "Opening page…"
                  : "Page unavailable"
                : state.busy
                  ? "Saving…"
                  : state.conflict
                    ? "Review changes"
                    : session && docEditorSessionDirty(session)
                      ? keptOffline
                        ? "Saved on this phone"
                        : "Unsaved"
                      : "Saved"}
            </Text>
            {canWrite && session && docEditorSessionDirty(session) && (
              <Pressable
                accessibilityRole="button"
                style={styles.actionTarget}
                accessibilityState={{
                  disabled:
                    state.busy ||
                    state.conflict ||
                    state.sourceInvalid ||
                    !session ||
                    !docEditorSessionDirty(session),
                }}
                disabled={
                  state.busy ||
                  state.conflict ||
                  state.sourceInvalid ||
                  !session ||
                  !docEditorSessionDirty(session)
                }
                onPress={() => void save(!!state.error)}
              >
                <Text style={styles.action}>
                  {state.error && !state.conflict && !state.sourceInvalid
                    ? "Retry save"
                    : "Save"}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Page actions"
              style={styles.actionTarget}
              accessibilityState={{ expanded: menuOpen }}
              onPress={() => setMenuOpen((value) => !value)}
            >
              <Icon name="more" size={18} color={colors.textSoft} />
            </Pressable>
          </View>
          <BottomSheet
            visible={menuOpen}
            title="Page actions"
            onClose={() => setMenuOpen(false)}
            afterClose={() => {
              const action = afterMenu.current;
              afterMenu.current = null;
              action?.();
            }}
          >
            <View style={styles.menu}>
              <Pressable
                accessibilityRole="button"
                disabled={state.busy}
                onPress={() => {
                  closeMenuThen(refreshPage);
                }}
              >
                <Text style={styles.action}>Refresh</Text>
              </Pressable>
              {onShowComments && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => closeMenuThen(onShowComments)}
                >
                  <Text style={styles.action}>Comments</Text>
                </Pressable>
              )}
              {onShowHistory && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    closeMenuThen(onShowHistory);
                  }}
                >
                  <Text style={styles.action}>History</Text>
                </Pressable>
              )}
              {onShowInLibrary && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    closeMenuThen(onShowInLibrary);
                  }}
                >
                  <Text style={styles.action}>Show in library</Text>
                </Pressable>
              )}
              {onMoveTo && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    closeMenuThen(onMoveTo);
                  }}
                >
                  <Text style={styles.action}>Move to…</Text>
                </Pressable>
              )}
              {formatsHere().map((format) => (
                <Pressable
                  key={format}
                  accessibilityRole="button"
                  disabled={
                    !session ||
                    docEditorSessionDirty(session) ||
                    state.source !== null
                  }
                  onPress={() => {
                    closeMenuThen(() => void download(format));
                  }}
                >
                  <Text style={styles.action}>{downloadLabel(format)}</Text>
                </Pressable>
              ))}
              {canWrite &&
                (["updates", "publish"] as const).map((action) => (
                  <Pressable
                    key={action}
                    accessibilityRole="button"
                    disabled={
                      state.busy ||
                      !!state.error ||
                      state.conflict ||
                      !session ||
                      docEditorSessionDirty(session) ||
                      state.source !== null ||
                      keptOffline
                    }
                    onPress={() => {
                      closeMenuThen(() => setPageAction(action));
                    }}
                  >
                    <Text style={styles.action}>
                      {action === "updates" ? "Page updates" : "Publish to web"}
                    </Text>
                  </Pressable>
                ))}
            </View>
          </BottomSheet>
          {pageAction === "updates" && (
            <PageMaintenanceSheet
              id={doc.id}
              onChanged={(next) => {
                store.adopt(next);
                onChanged(next);
              }}
              onClose={() => setPageAction(null)}
            />
          )}
          {pageAction === "publish" && (
            <PagePublicationSheet
              id={doc.id}
              onChanged={(next) => {
                store.adopt(next);
                onChanged(next);
              }}
              onClose={() => setPageAction(null)}
            />
          )}

          {state.error !== null && (
            <View>
              <Text accessibilityRole="alert" style={styles.error}>
                {state.sourceInvalid && state.error instanceof Error
                  ? state.error.message
                  : session
                    ? "Couldn’t save this page. Your draft is still here."
                    : "Couldn’t open this page. Try again."}
              </Text>
              {!state.sourceInvalid &&
                !state.conflict &&
                (!session || !docEditorSessionDirty(session)) && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={state.busy}
                    onPress={refreshPage}
                  >
                    <Text style={styles.action}>Retry</Text>
                  </Pressable>
                )}
            </View>
          )}
          {navigationError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {navigationError}
            </Text>
          )}
          {state.conflict && (
            <Text accessibilityRole="alert" style={styles.error}>
              This page changed elsewhere. Your draft is still here.
            </Text>
          )}
          {(state.conflict || state.error !== null) && session && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDiscardOpen(true)}
            >
              <Text style={styles.action}>Discard draft</Text>
            </Pressable>
          )}
          {session && document && (
            <>
              {sourceFormat === "note" &&
                (canWrite ? (
                  <View style={styles.titleEditor}>
                    <Text
                      style={[styles.title, { opacity: 0 }]}
                      accessible={false}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {(session.title || "Untitled") + "\u200b"}
                    </Text>
                    <TextInput
                      accessibilityLabel="Page title"
                      style={[styles.title, StyleSheet.absoluteFill]}
                      multiline
                      scrollEnabled={false}
                      textAlignVertical="top"
                      value={session.title}
                      onChangeText={(title) => {
                        editGeneration.current++;
                        offlineQueued.current = false;
                        setKeptOffline(false);
                        store.changeTitle(session.title, title);
                      }}
                      maxLength={200}
                      placeholder="Untitled"
                    />
                  </View>
                ) : (
                  <Text style={styles.title}>{session.title}</Text>
                ))}
              <View style={[styles.columns, split && styles.splitColumns]}>
                <View
                  style={[
                    styles.sourcePane,
                    { flex: split ? paneRatio : 1 },
                    !sourceVisible && !split && styles.hiddenPane,
                  ]}
                >
                  <Text
                    style={[styles.paneTitle, !split && { display: "none" }]}
                  >
                    {latexOpen ? "LaTeX source" : "Markdown source"}
                  </Text>
                  {latexOpen && document && session && (
                    <DocSourcePreview
                      exportPdfHandle={sourcePdfExport}
                      leaveCheck={sourceLeaveCheck}
                      compileReady={() => {
                        const current = store.state;
                        return (
                          !current.busy &&
                          !current.error &&
                          !current.conflict &&
                          !current.sourceInvalid &&
                          !!current.session &&
                          !docEditorSessionDirty(current.session) &&
                          current.source === null
                        );
                      }}
                      inline
                      sourceOnly
                      editorHeight={paneHeight}
                      showModes={false}
                      beforeNavigate={prepareLinkedPage}
                      latexOnly
                      key={latexSourceNumber}
                      initialSourceNumber={latexSourceNumber}
                      blocks={leaves}
                      docId={doc.id}
                      onClose={() => {
                        latexOwner.current = false;
                        setLatexOpen(false);
                        setSourceFormat("note");
                        setSourceVisible(false);
                        setSplitRequested(false);
                      }}
                      selectionHandle={sourceSelectionHandle}
                      onSelectionAssist={openExcerpt}
                      onAssist={
                        canWrite &&
                        !state.busy &&
                        !state.error &&
                        !state.conflict &&
                        state.source === null &&
                        !docEditorSessionDirty(session)
                          ? (block) => {
                              askForBlock(block);
                            }
                          : undefined
                      }

                      onAppLink={(url) => {
                        void openLinkedPage(url);
                      }}
                      report={report}
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
                          ? (text, expected, sourceNumber) => {
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
                                sourceNumber === undefined || sourceNumber < 0
                                  ? docWholeLatexOperation(document, text)
                                  : docLatexOperation(
                                      document,
                                      text,
                                      sourceNumber,
                                    ),
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
                  <View
                    style={{ display: latexOpen ? "none" : "flex", flex: 1 }}
                  >
                    {source === null ? (
                      <Text>
                        Source view is unavailable for this structure.
                      </Text>
                    ) : (
                      <TextInput
                        accessibilityLabel="Markdown source"
                        onSelectionChange={(event) => {
                          const { start, end } = event.nativeEvent.selection;
                          sourceSelection.current = start;
                          const raw = state.source ?? source;
                          setSelectedExcerpt(
                            end > start
                              ? {
                                  format: "markdown",
                                  source: raw,
                                  start,
                                  end,
                                  quote: raw.slice(start, end),
                                }
                              : null,
                          );
                        }}
                        style={[styles.source, { height: paneHeight }]}
                        multiline
                        editable={canWrite}
                        value={state.source ?? source}
                        onChangeText={(text) => {
                          editGeneration.current++;
                          offlineQueued.current = false;
                          setKeptOffline(false);
                          store.changeSource(document, text);
                        }}
                        textAlignVertical="top"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    )}
                  </View>
                </View>
                {split && (
                  <DocumentDivider
                    value={paneRatio}
                    width={paneWidth}
                    onChange={setPaneRatio}
                  />
                )}
                <View
                  ref={previewAnchor}
                  style={[
                    styles.preview,
                    { flex: split ? 100 - paneRatio : 1 },
                    sourceVisible && !split && styles.hiddenPane,
                  ]}
                >
                  {sourceFormat !== "note" && (
                    <Text style={styles.paneTitle}>Preview</Text>
                  )}
                  <View
                    style={[
                      { flex: 1, minHeight: 0 },
                      (!latexOpen || latexSourceNumber < 0) &&
                        styles.hiddenPane,
                    ]}
                  >
                    <DocLatexDocumentPreview />
                  </View>
                  <ScrollView
                    ref={previewScroll}
                    nestedScrollEnabled
                    style={
                      latexOpen && latexSourceNumber >= 0
                        ? styles.hiddenPane
                        : { flex: 1 }
                    }
                    contentContainerStyle={styles.noteCanvas}
                  >
                    <View ref={previewContent} style={styles.previewContent}>
                      {document.format === 2 && (
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
                              else void openLinkedPage(url);
                            },
                            report,
                          }}
                        >
                          <DocContainerBody
                            nodes={document.nodes}
                            onOperation={
                              canWrite
                                ? (operation, expectedNodes) => {
                                    editGeneration.current++;
                                    offlineQueued.current = false;
                                    setKeptOffline(false);
                                    store.changeOperation(
                                      { format: 2, nodes: [...expectedNodes] },
                                      operation,
                                    );
                                  }
                                : undefined
                            }
                            renderLeaf={(block, index, path) => (
                              <View
                                ref={(node) => {
                                  if (node) leafRefs.current.set(index, node);
                                  else leafRefs.current.delete(index);
                                }}
                                style={styles.leaf}
                                onLayout={() => {
                                  const target = pendingInitial.current;
                                  if (
                                    !target ||
                                    docFragmentIndex(leaves, target) !== index
                                  )
                                    return;
                                  pendingInitial.current = null;
                                  requestAnimationFrame(() =>
                                    goToFragment(target),
                                  );
                                }}
                              >
                                <View style={styles.leafBody}>
                                  <DocWritingBody
                                    index={index}
                                    text={"text" in block ? block.text : null}
                                    editing={
                                      canWrite && editing === path.join("/")
                                    }
                                    onSelection={({ start, end }) => {
                                      if ("text" in block)
                                        setSelectedExcerpt(
                                          end > start
                                            ? {
                                                format: "note",
                                                source: block.text,
                                                start,
                                                end,
                                                quote: block.text.slice(
                                                  start,
                                                  end,
                                                ),
                                              }
                                            : null,
                                        );
                                    }}
                                    onChange={(text) => {
                                      editGeneration.current++;
                                      offlineQueued.current = false;
                                      setKeptOffline(false);
                                      store.changeOperation(document, {
                                        kind: "replace-leaf",
                                        path,
                                        block: { ...block, text } as DocBlock,
                                      });
                                    }}
                                  >
                                    <DocBody
                                      content={[block]}
                                      pageContent={leaves}
                                      pageIndex={index}
                                      onEditBlock={
                                        canWrite &&
                                        sourceFormat === "note" &&
                                        "text" in block
                                          ? () =>
                                              openBlockEditor(
                                                block,
                                                index,
                                                path,
                                              )
                                          : undefined
                                      }
                                    />
                                  </DocWritingBody>
                                  {!!block.id && openThread === block.id && (
                                    <DocThread
                                      comments={
                                        comments.anchored.get(block.id) ?? []
                                      }
                                      state={comments}
                                      userId={userId}
                                      quote={
                                        comments.anchored.get(block.id)?.[0]
                                          ?.quote
                                      }
                                      placeholder="Comment on this line…"
                                      anchor={{
                                        block_id: block.id,
                                        quote: String(
                                          "text" in block ? block.text : "",
                                        ),
                                      }}
                                    />
                                  )}
                                </View>
                                <MoreMenu
                                  label={`Block ${index + 1} actions`}
                                  actions={[
                                    ...(canWrite &&
                                    sourceFormat === "note" &&
                                    "text" in block
                                      ? [
                                          {
                                            label:
                                              editing === path.join("/")
                                                ? "Done"
                                                : "Edit text",
                                            onPress: () =>
                                              editing === path.join("/")
                                                ? setEditing(null)
                                                : openBlockEditor(
                                                    block,
                                                    index,
                                                    path,
                                                  ),
                                          },
                                        ]
                                      : []),
                                    ...(block.id
                                      ? [
                                          {
                                            label:
                                              (comments.counts[block.id] ?? 0) >
                                              0
                                                ? `Comments (${comments.counts[block.id]})`
                                                : "Comment",
                                            onPress: () => {
                                              void toggleThread(block.id!);
                                            },
                                          },
                                        ]
                                      : []),
                                    ...(canWrite &&
                                    sourceFormat === "note" &&
                                    "text" in block
                                      ? [
                                          {
                                            label: "Ask assistant",
                                            disabled:
                                              sourcePending ||
                                              state.busy ||
                                              docEditorSessionDirty(session) ||
                                              state.source !== null,
                                            onPress: () => askForBlock(block),
                                          },
                                        ]
                                      : []),
                                  ]}
                                />
                              </View>
                            )}
                          />
                          {canWrite && sourceFormat === "note" && (
                            <Pressable
                              accessibilityRole="button"
                              style={styles.addText}
                              disabled={
                                state.sourceInvalid ||
                                !!state.conflict ||
                                sourcePending ||
                                !!sourceAsk
                              }
                              onPress={() => {
                                const index = document.nodes.length;
                                editGeneration.current++;
                                offlineQueued.current = false;
                                setKeptOffline(false);
                                store.changeOperation(document, {
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
                                });
                                if (!store.state.error)
                                  setEditing(String(index));
                              }}
                            >
                              <Icon
                                name="plus"
                                size={16}
                                color={colors.muted}
                              />
                              <Text style={styles.status}>Add text</Text>
                            </Pressable>
                          )}
                        </DocNavigationContext.Provider>
                      )}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    </DocLatexPreviewProvider>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    page: { flex: 1, minWidth: 0, minHeight: 0, gap: 0 },
    toolbarTitle: {
      width: "100%",
      color: colors.text,
      fontSize: 13,
      fontFamily: fonts.medium,
    },
    paneSwitch: { flexDirection: "row", gap: 2 },
    paneTitle: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.muted,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    noteCanvas: {
      width: "100%",
      maxWidth: 808,
      alignSelf: "center",
      paddingHorizontal: 16,
      paddingBottom: 40,
    },
    writingPage: { width: "100%", maxWidth: 760, alignSelf: "center" },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    menu: { gap: 4 },
    actionTarget: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    action: {
      color: colors.accent,
      fontSize: 13,
      fontFamily: fonts.medium,
      minHeight: 44,
      paddingVertical: 12,
    },
    status: { color: colors.muted, fontSize: 13, marginLeft: "auto" },
    error: { color: colors.danger, fontSize: 13 },
    titleEditor: {
      minHeight: 44,
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      paddingHorizontal: 16,
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontFamily: fonts.semibold,
      paddingVertical: 16,
    },
    source: {
      flex: 1,
      minHeight: 0,
      borderWidth: 0,
      backgroundColor: colors.surfaceMuted,
      fontFamily: fonts.mono,
      lineHeight: 24,
      borderColor: colors.border,
      color: colors.text,
      padding: 12,
      fontSize: inputFontSize,
    },
    columns: { flex: 1, minHeight: 0, minWidth: 0, gap: 0 },
    splitColumns: { flexDirection: "row", alignItems: "stretch" },
    sourcePane: { flex: 1, minWidth: 0, minHeight: 0 },
    hiddenPane: { display: "none" },
    preview: { flex: 1, minWidth: 0, minHeight: 0 },
    previewContent: { paddingBottom: 24 },
    leaf: {
      minWidth: 0,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 4,
      paddingVertical: 4,
    },
    leafBody: { flex: 1, minWidth: 0 },
    addText: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      alignSelf: "flex-start",
      paddingHorizontal: 8,
    },
  }),
);

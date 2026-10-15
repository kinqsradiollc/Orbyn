import { DocLatexPreviewProvider } from "./DocLatexPreview";
import { DocEditorModes } from "./DocEditorModes";
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
  docLatexOperation,
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
import { DocEditorStore } from "@orbyn/api-client";
import { Pressable } from "../../motion";
import { ActionSheet } from "../../components/MoreMenu";
import { BottomSheet } from "../../components/BottomSheet";
import { Icon } from "../../components/Icon";
import { colors, fonts, inputFontSize, radii, themed } from "../../theme";
import { client } from "../../lib/api";
import { session as authSession } from "../../lib/session";
import { rememberPageDurable } from "../../lib/pageCache";
import { canLeaveStructuredDocDraft } from "../../lib/structuredDocDraftGuard";
import { savePageOffline } from "../../lib/outbox";
import { downloadDoc, downloadLabel, formatsHere } from "../../lib/download";
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
  const [latexOpen, setLatexOpen] = React.useState(false);
  const sourceLeaveCheck = React.useRef<(() => boolean) | null>(null);
  const latexOwner = React.useRef(latexOpen);
  latexOwner.current = latexOpen;
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
  const split = splitRequested && paneWidth / Math.max(1, fontScale) >= 900;
  const paneHeight = Math.max(180, Math.min(640, windowHeight * 0.6));
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
  const askForBlock = (block: DocBlock) => {
    try {
      if (!block.id || !("text" in block) || !block.text.trim())
        throw new Error("Save this text before asking the assistant.");
      savedSource(block);
      setSourceAsk({ ...block });
    } catch (error) {
      report(error);
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
  const save = React.useCallback(async () => {
    if (queueInFlight.current || !currentPage()) return;
    const account = pageOwner.account;
    const before = store.state.doc?.version;
    await store.save();
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
      offlineQueued.current = false;
      setKeptOffline(false);
    }
  }, [store, doc, onChanged, report]);
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
        style={styles.page}
        onLayout={(event) => {
          pageOffset.current = event.nativeEvent.layout.y;
          setPaneWidth(event.nativeEvent.layout.width);
        }}
      >
        {sourceAsk && "text" in sourceAsk && (
          <DocSourceAsk
            key={sourceAsk.id}
            text={sourceAsk.text}
            onAsk={requestSourceSuggestion}
            onClose={() => setSourceAsk(null)}
          />
        )}
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
            beforeNavigate={prepareLinkedPage}
            latexOnly
            blocks={leaves}
            docId={doc.id}
            onClose={() => {
              latexOwner.current = false;
              setLatexOpen(false);
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
                    store.state.session?.saved.version ?? session.saved.version,
                },
                signal,
              )
            }
            saveStatus={
              state.busy
                ? "Saving…"
                : docEditorSessionDirty(session)
                  ? "Unsaved changes"
                  : "Saved"
            }
            onLatexChange={
              canWrite
                ? (text, expected) => {
                    const current = store.state.session;
                    if (
                      !current ||
                      current.document !== document ||
                      JSON.stringify(expected) !== JSON.stringify(leaves) ||
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
                    if (!next) throw new Error("The document is unavailable.");
                    return next.format === 2
                      ? docContainerBlocks(next.nodes, { projected: true })
                      : next.blocks;
                  }
                : undefined
            }
          />
        )}
        <View
          style={
            latexOpen ? { display: "none" } : { flex: 1, minHeight: 0, gap: 10 }
          }
        >
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
              value={
                latexOpen
                  ? "latex"
                  : sourceVisible || split
                    ? "markdown"
                    : "note"
              }
              disabled={
                !session ||
                state.source !== null ||
                state.busy ||
                !!state.conflict ||
                sourcePending ||
                !!sourceAsk
              }
              onChange={(format) => {
                if (format === "latex") setLatexOpen(true);
                else {
                  setSplitRequested(false);
                  setSourceVisible(format === "markdown");
                }
              }}
            />
            <Pressable
              accessibilityRole="button"
              style={styles.actionTarget}
              onPress={() => {
                setSplitRequested(false);
                setSourceVisible((value) => !value);
              }}
            >
              <Text style={styles.action}>
                {sourceVisible ? "Preview" : "Source"}
              </Text>
            </Pressable>
            {paneWidth / Math.max(1, fontScale) >= 900 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: split }}
                style={styles.actionTarget}
                onPress={() => setSplitRequested((value) => !value)}
              >
                <Text style={styles.action}>
                  {split ? "Hide split" : "Split"}
                </Text>
              </Pressable>
            )}
            {canWrite && (sourceVisible || split) && (
              <Pressable
                accessibilityRole="button"
                style={styles.actionTarget}
                disabled={
                  sourcePending ||
                  state.busy ||
                  !session ||
                  docEditorSessionDirty(session) ||
                  state.source !== null
                }
                onPress={() => {
                  try {
                    if (!document) return;
                    const map = versionedDocSourceMap(
                      document,
                      source ?? undefined,
                      { projected: true },
                    );
                    const range = versionedDocSourceAt(
                      map,
                      sourceSelection.current,
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
                  } catch (error) {
                    report(error);
                  }
                }}
              >
                <Text style={styles.action}>Ask assistant</Text>
              </Pressable>
            )}
            {canWrite && (
              <Pressable
                accessibilityRole="button"
                style={styles.actionTarget}
                accessibilityState={{ disabled: state.busy || state.conflict }}
                disabled={
                  state.busy ||
                  state.conflict ||
                  !!state.error ||
                  !session ||
                  !docEditorSessionDirty(session)
                }
                onPress={() => void save()}
              >
                <Text style={styles.action}>Save</Text>
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
                    closeMenuThen(
                      () =>
                        void downloadDoc(
                          doc.id,
                          format,
                          session?.saved.version,
                        ).catch(report),
                    );
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
          {state.error !== null && (
            <View>
              <Text accessibilityRole="alert" style={styles.error}>
                {state.error instanceof Error
                  ? state.error.message
                  : "Could not update this page."}
              </Text>
              {!state.sourceInvalid && !state.conflict && (
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
              {canWrite ? (
                <TextInput
                  accessibilityLabel="Page title"
                  style={styles.title}
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
              ) : (
                <Text style={styles.title}>{session.title}</Text>
              )}
              <View style={[styles.columns, split && styles.splitColumns]}>
                <View
                  style={[
                    styles.sourcePane,
                    { height: paneHeight },
                    !sourceVisible && !split && styles.hiddenPane,
                  ]}
                >
                  {source === null ? (
                    <Text>Source view is unavailable for this structure.</Text>
                  ) : (
                    <TextInput
                      accessibilityLabel="Markdown source"
                      onSelectionChange={(event) => {
                        sourceSelection.current =
                          event.nativeEvent.selection.start;
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
                <View
                  ref={previewAnchor}
                  style={[
                    styles.preview,
                    { height: paneHeight },
                    sourceVisible && !split && styles.hiddenPane,
                  ]}
                >
                  <ScrollView ref={previewScroll} nestedScrollEnabled>
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
                                <DocBody
                                  content={[block]}
                                  pageContent={leaves}
                                  pageIndex={index}
                                />
                                {!!block.id && (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Comments on block ${index + 1}`}
                                    onPress={() => {
                                      void toggleThread(block.id!);
                                    }}
                                  >
                                    <Text style={styles.editAction}>
                                      {(comments.counts[block.id] ?? 0) > 0
                                        ? `${comments.counts[block.id]} ${comments.counts[block.id] === 1 ? "comment" : "comments"}`
                                        : "Comment"}
                                    </Text>
                                  </Pressable>
                                )}
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
                                {canWrite && "text" in block && (
                                  <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                      setEditing(
                                        editing === path.join("/")
                                          ? null
                                          : path.join("/"),
                                      )
                                    }
                                  >
                                    <Text style={styles.editAction}>
                                      {editing === path.join("/")
                                        ? "Done"
                                        : "Edit"}
                                    </Text>
                                  </Pressable>
                                )}
                                {canWrite &&
                                  editing === path.join("/") &&
                                  "text" in block && (
                                    <Pressable
                                      accessibilityRole="button"
                                      style={styles.actionTarget}
                                      disabled={
                                        sourcePending ||
                                        !block.id ||
                                        state.busy ||
                                        docEditorSessionDirty(session) ||
                                        state.source !== null
                                      }
                                      onPress={() => askForBlock(block)}
                                    >
                                      <Text style={styles.editAction}>
                                        Ask assistant
                                      </Text>
                                    </Pressable>
                                  )}
                                {canWrite &&
                                  editing === path.join("/") &&
                                  "text" in block && (
                                    <TextInput
                                      accessibilityLabel={`Edit block ${index + 1}`}
                                      style={styles.leafInput}
                                      multiline
                                      value={block.text}
                                      onChangeText={(text) => {
                                        editGeneration.current++;
                                        offlineQueued.current = false;
                                        setKeptOffline(false);
                                        store.changeOperation(document, {
                                          kind: "replace-leaf",
                                          path,
                                          block: { ...block, text } as DocBlock,
                                        });
                                      }}
                                    />
                                  )}
                              </View>
                            )}
                          />
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
    page: { flex: 1, minWidth: 0, gap: 10 },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
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
    status: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger, fontSize: 13 },
    title: { color: colors.text, fontSize: 24, fontFamily: fonts.semibold },
    source: {
      flex: 1,
      minHeight: 0,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      padding: 12,
      fontSize: inputFontSize,
    },
    columns: { minWidth: 0, gap: 16 },
    splitColumns: { flexDirection: "row", alignItems: "flex-start" },
    sourcePane: { flex: 1, minWidth: 0 },
    hiddenPane: { display: "none" },
    preview: { flex: 1, minWidth: 0 },
    previewContent: { paddingBottom: 24 },
    leaf: { minWidth: 0 },
    editAction: {
      color: colors.accent,
      fontSize: 13,
      minHeight: 44,
      paddingVertical: 12,
    },
    leafInput: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      padding: 8,
      fontSize: inputFontSize,
    },
  }),
);

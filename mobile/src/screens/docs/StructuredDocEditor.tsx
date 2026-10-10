import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  docContainerBlocks,
  docFragmentIndex,
  docEditorSessionDirty,
  isOfflineError,
  parseAppLink,
  versionedDocSource,
  type Doc,
  type DocBlock,
  type VersionedDocContent,
} from "@orbyn/core";
import { DocEditorStore } from "@orbyn/api-client";
import { Pressable } from "../../motion";
import { ActionSheet } from "../../components/MoreMenu";
import { colors, fonts } from "../../theme";
import { client } from "../../lib/api";
import { rememberPageDurable } from "../../lib/pageCache";
import { canLeaveStructuredDocDraft } from "../../lib/structuredDocDraftGuard";
import { savePageOffline } from "../../lib/outbox";
import { downloadDoc, downloadLabel, formatsHere } from "../../lib/download";
import { DocContainerBody } from "./DocContainerBody";
import { DocBody } from "./DocBody";
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
export function StructuredDocEditor({
  doc,
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
  const store = useMemo(() => new DocEditorStore(client), [doc.id]);
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
  const [sourceVisible, setSourceVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [keptOffline, setKeptOffline] = React.useState(false);
  const [navigationError, setNavigationError] = React.useState<string | null>(
    null,
  );
  const offlineQueued = React.useRef(false);
  const editGeneration = React.useRef(0);
  const queueInFlight = React.useRef(false);
  const pageRef = React.useRef<View>(null);
  const pageOffset = React.useRef(0);
  const leafRefs = React.useRef(new Map<number, View>());
  const pendingInitial = React.useRef<string | null>(initialBlockId ?? null);
  useEffect(() => {
    void store.open(doc.id, doc);
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
  const document = session?.document;
  const source = document ? sourceOf(document) : null;
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
      const leaf = leafRefs.current.get(index);
      if (!leaf || !pageRef.current) return;
      leaf.measureLayout(
        pageRef.current,
        (_x, y) => onTargetOffset?.(pageOffset.current + y),
        () => report(new Error("Could not locate this line.")),
      );
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
    if (queueInFlight.current) return;
    const before = store.state.doc?.version;
    await store.save();
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
        await savePageOffline({
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
        });
        const kept = {
          ...(store.state.doc ?? doc),
          title: draft.title,
          document: draft.document,
          content: leavesOf(draft.document),
        };
        await rememberPageDurable(kept);
        if (store.state.sourceInvalid) return;
        store.acknowledgeOfflineSave();
        if (generation === editGeneration.current) {
          onChanged(kept);
          offlineQueued.current = true;
          setKeptOffline(true);
        } else {
          offlineQueued.current = false;
          setKeptOffline(false);
        }
      } catch (error) {
        report(error);
      } finally {
        queueInFlight.current = false;
      }
    } else if (store.state.error) report(store.state.error);
    else {
      offlineQueued.current = false;
      setKeptOffline(false);
    }
  }, [store, doc, onChanged, report]);
  const openLinkedPage = React.useCallback(
    async (url: string) => {
      const before = store.state;
      if (before.session && docEditorSessionDirty(before.session)) await save();
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
        return;
      }
      setNavigationError(null);
      openAppUrl(url);
    },
    [save, store],
  );
  useEffect(() => {
    if (!beforeLeave) return;
    const guard = async () => {
      const current = store.state;
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
  }, [beforeLeave, store, save]);
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
    <View
      ref={pageRef}
      style={styles.page}
      onLayout={(event) => {
        pageOffset.current = event.nativeEvent.layout.y;
      }}
    >
      <ActionSheet
        visible={discardOpen}
        label="Discard page draft"
        title="Discard draft?"
        message="This removes your unsaved edits."
        cancelLabel="Keep editing"
        actions={[{ label: "Discard", destructive: true, onPress: discard }]}
        onClose={() => setDiscardOpen(false)}
      />
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSourceVisible((value) => !value)}
        >
          <Text style={styles.action}>
            {sourceVisible ? "Preview" : "Source"}
          </Text>
        </Pressable>
        {canWrite && (
          <Pressable
            accessibilityRole="button"
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
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen((value) => !value)}
        >
          <Text style={styles.action}>More</Text>
        </Pressable>
      </View>
      {menuOpen && (
        <View style={styles.menu}>
          <Pressable
            accessibilityRole="button"
            disabled={state.busy}
            onPress={() => {
              setMenuOpen(false);
              void store.refresh();
            }}
          >
            <Text style={styles.action}>Refresh</Text>
          </Pressable>
          {onShowHistory && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                onShowHistory();
              }}
            >
              <Text style={styles.action}>History</Text>
            </Pressable>
          )}
          {onShowInLibrary && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                onShowInLibrary();
              }}
            >
              <Text style={styles.action}>Show in library</Text>
            </Pressable>
          )}
          {onMoveTo && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                onMoveTo();
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
                setMenuOpen(false);
                void downloadDoc(doc.id, format, session?.saved.version).catch(
                  report,
                );
              }}
            >
              <Text style={styles.action}>{downloadLabel(format)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.status}>
        {state.busy
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
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error instanceof Error
            ? state.error.message
            : "Could not update this page."}
        </Text>
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
      {!session || !document ? (
        <Text>{state.busy ? "Opening page…" : "Page unavailable."}</Text>
      ) : (
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
          {sourceVisible ? (
            source === null ? (
              <Text>Source view is unavailable for this structure.</Text>
            ) : (
              <TextInput
                accessibilityLabel="Markdown source"
                style={styles.source}
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
            )
          ) : (
            <View style={styles.preview}>
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
                          requestAnimationFrame(() => goToFragment(target));
                        }}
                      >
                        <DocBody
                          content={[block]}
                          pageContent={leaves}
                          pageIndex={index}
                        />
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
                              {editing === path.join("/") ? "Done" : "Edit"}
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
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minWidth: 0, padding: 16, gap: 10 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  menu: { gap: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  action: { color: colors.accent, fontSize: 15, fontFamily: fonts.medium },
  status: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14 },
  title: { color: colors.text, fontSize: 25, fontFamily: fonts.semibold },
  source: {
    flex: 1,
    minHeight: 250,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: 12,
    fontSize: 14,
  },
  preview: { paddingBottom: 24 },
  leaf: { minWidth: 0 },
  editAction: { color: colors.accent, fontSize: 13, paddingVertical: 6 },
  leafInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: 8,
    fontSize: 14,
  },
});

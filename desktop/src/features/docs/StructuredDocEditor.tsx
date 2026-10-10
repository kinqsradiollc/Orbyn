import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  docContainerBlocks,
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
  type DocContentOperation,
  type DocVersion,
  type ExportFormat,
  type VersionedDocContent,
} from "@orbyn/core";
import { DocEditorStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";
import { BlockView } from "./DocBlocks";
import { DocContainerView } from "./DocContainerView";
import { DocComments } from "./DocComments";
import { DocNavigationContext } from "./doc-navigation";
import { OPEN_LINK_EVENT } from "./DocLinks";
import "./structured-doc-editor.css";

function sourceOf(document: VersionedDocContent): string | null {
  try {
    return versionedDocSource(document, { projected: true });
  } catch {
    return null;
  }
}

/** Complete ownership stays in one draft across visual edits, source and saves. */
export function StructuredDocEditor({
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
  const store = useMemo(() => new DocEditorStore(client), [doc.id]);
  const { ask } = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pendingComment, setPendingComment] = useState<{
    blockId: string;
    quote: string;
  } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [commentTops, setCommentTops] = useState<Record<string, number>>({});
  const sourceRef = useRef<HTMLTextAreaElement>(null);
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
  const document = session?.document;
  const source = document ? sourceOf(document) : null;
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
    target?.scrollIntoView({ block: "nearest" });
  };
  const sourceAtBlock = (path: number[]) => {
    const range = sourceMap?.ranges.find(
      (entry) => entry.path.join("/") === path.join("/"),
    );
    if (!range || !sourceRef.current) return;
    sourceRef.current.focus();
    sourceRef.current.setSelectionRange(range.start, range.end);
    const lines = sourceMap!.source.split("\n").length;
    sourceRef.current.scrollTop = Math.max(
      0,
      ((range.startLine - 2) / Math.max(1, lines)) *
        sourceRef.current.scrollHeight,
    );
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
      ...previewPane.querySelectorAll<HTMLElement>("[data-container-path]"),
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
      ...previewPane.querySelectorAll<HTMLElement>("[data-container-path]"),
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
    if (!("text" in block)) return;
    try {
      if (store.state.session && docEditorSessionDirty(store.state.session))
        await save();
      if (!store.state.session || docEditorSessionDirty(store.state.session))
        return;
      const blockId =
        block.id ??
        (await client.anchorLine(doc.id, index, block.text)).block_id;
      if (!block.id) await store.refresh();
      setPendingComment({ blockId, quote: block.text });
      setActiveComment(blockId);
      setCommentsOpen(true);
    } catch (error) {
      report(error);
    }
  };
  const change = (
    operation: DocContentOperation,
    expected: VersionedDocContent,
  ) => store.changeOperation(expected, operation);
  const save = useCallback(async () => {
    const before = store.state.doc?.version;
    await store.save();
    const next = store.state.doc;
    if (next && next.version !== before) onChanged(next);
    if (store.state.error) report(store.state.error);
  }, [store, onChanged, report]);
  const openLinkedPage = useCallback(
    async (url: string) => {
      const before = store.state;
      if (before.session && docEditorSessionDirty(before.session)) await save();
      const current = store.state;
      if (
        current.busy ||
        current.error ||
        current.conflict ||
        current.sourceInvalid ||
        (current.session && docEditorSessionDirty(current.session))
      ) {
        setNavigationError("Save this draft before opening another page.");
        return;
      }
      setNavigationError(null);
      window.dispatchEvent(new CustomEvent(OPEN_LINK_EVENT, { detail: url }));
    },
    [save, store],
  );
  const showHistory = async () => {
    setMenuOpen(false);
    setHistoryOpen(true);
    setVersions(null);
    try {
      setVersions(await client.listDocVersions(doc.id));
    } catch (error) {
      setVersions([]);
      report(error);
    }
  };
  const selectVersion = async (version: number) => {
    setHistoryBusy(true);
    try {
      setSelected(await client.getDocVersion(doc.id, version));
    } catch (error) {
      report(error);
    } finally {
      setHistoryBusy(false);
    }
  };
  const restore = async () => {
    if (
      !selected ||
      !session ||
      docEditorSessionDirty(session) ||
      state.source !== null
    )
      return;
    if (
      !(await ask({
        title: "Restore this version?",
        body: "The current page stays in history.",
        confirmLabel: "Restore",
      }))
    )
      return;
    setHistoryBusy(true);
    try {
      const restored = await client.restoreDocVersion(doc.id, selected.version);
      store.adopt(restored);
      onChanged(restored);
      setHistoryOpen(false);
      setSelected(null);
    } catch (error) {
      report(error);
    } finally {
      setHistoryBusy(false);
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
  return (
    <div className="structured-doc-editor">
      <header className="structured-doc-toolbar">
        {onBack && (
          <button
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
            Back
          </button>
        )}
        <span className="structured-doc-status">
          {state.busy
            ? "Saving…"
            : state.conflict
              ? "Review changes"
              : session && docEditorSessionDirty(session)
                ? "Unsaved"
                : "Saved"}
        </span>
        {canWrite && (
          <button
            onClick={() => void save()}
            disabled={
              state.busy ||
              state.conflict ||
              !!state.error ||
              !session ||
              !docEditorSessionDirty(session)
            }
          >
            Save
          </button>
        )}
        <div className="structured-doc-menu">
          <button
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            More
          </button>
          {menuOpen && (
            <div className="structured-doc-menu-items">
              <button
                type="button"
                disabled={state.busy}
                onClick={() => {
                  setMenuOpen(false);
                  void store.refresh();
                }}
              >
                Refresh
              </button>
              <button type="button" onClick={() => void showHistory()}>
                History
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setCommentsOpen((value) => !value);
                }}
              >
                Comments
              </button>
              {EXPORT_FORMATS.map((format) => (
                <button
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
            </div>
          )}
        </div>
      </header>
      {state.error !== null && (
        <p className="structured-doc-error" role="alert">
          {state.error instanceof Error
            ? state.error.message
            : "Could not update this page."}
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
        <p>{state.busy ? "Opening page…" : "Page unavailable."}</p>
      ) : (
        <>
          {canWrite ? (
            <input
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
          <div className="structured-doc-columns">
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
                      <div
                        className="structured-doc-leaf"
                        data-block-id={block.id}
                        data-leaf-index={index}
                        data-container-path={path.join("/")}
                        onClick={(event) => {
                          if (
                            !(event.target as HTMLElement).closest(
                              "a, button, input, textarea",
                            )
                          )
                            sourceAtBlock(path);
                        }}
                      >
                        <BlockView block={block} pageBlocks={leaves} />
                        {canWrite && "text" in block && (
                          <>
                            <button
                              type="button"
                              className="structured-doc-edit"
                              onClick={() =>
                                setEditing(
                                  editing === path.join("/")
                                    ? null
                                    : path.join("/"),
                                )
                              }
                            >
                              {editing === path.join("/") ? "Done" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className="structured-doc-edit"
                              onClick={() => void commentOn(block, index)}
                            >
                              Comment
                            </button>
                            {editing === path.join("/") && (
                              <textarea
                                aria-label={`Edit block ${index + 1}`}
                                value={block.text}
                                onChange={(event) =>
                                  change(
                                    {
                                      kind: "replace-leaf",
                                      path,
                                      block: {
                                        ...block,
                                        text: event.currentTarget.value,
                                      } as DocBlock,
                                    },
                                    document,
                                  )
                                }
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  />
                </DocNavigationContext.Provider>
              )}
            </section>
            <section
              aria-label="Markdown source"
              className="structured-doc-source"
            >
              <h2>Source</h2>
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
            </section>
          </div>
          {commentsOpen && (
            <aside
              className="structured-doc-comments"
              aria-label="Page comments"
            >
              <div className="structured-doc-history-head">
                <h2>Comments</h2>
                <button type="button" onClick={() => setCommentsOpen(false)}>
                  Close
                </button>
              </div>
              <DocComments
                docId={doc.id}
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
          )}
          {historyOpen && (
            <aside className="structured-doc-history" aria-label="Page history">
              <div className="structured-doc-history-head">
                <h2>History</h2>
                <button type="button" onClick={() => setHistoryOpen(false)}>
                  Close
                </button>
              </div>
              {versions === null ? (
                <p>Loading…</p>
              ) : versions.length === 0 ? (
                <p>No earlier version.</p>
              ) : (
                <ol>
                  {versions.map((version) => (
                    <li key={version.version}>
                      <button
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
  );
}

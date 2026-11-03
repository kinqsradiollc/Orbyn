import {
  docLatexBlock,
  docLatexOperation,
  docWholeLatex,
  docWholeLatexCanExport,
  docWholeLatexOperation,
  DOC_LATEX_SOURCE_MAX,
  EMPTY_LATEX_DOCUMENT,
  versionedDocSource,
  versionedDocSourceAt,
  versionedDocSourceMap,
  type DocSelection,
} from "@orbyn/core";
import { Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { messageOf } from "../../../lib/resource";
import { client, getToken, getSessionVersion } from "../../../lib/session";
import { Button, Segmented, useToast, useConfirm } from "../../../ui/kit";
import { LatexPreview } from "./Latex";
import type { Page } from "./usePage";
import { leavesOf } from "./tree";
import {
  latexSourceSelector,
  sameSourceBase,
  sourceOrdinal,
  type LatexSourceDraft,
} from "./source-draft";

const SPLIT_KEY = "orbyn-doc-split";
const readSplit = () => {
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    return saved >= 20 && saved <= 80 ? saved : 50;
  } catch {
    return 50;
  }
};

/** Source beside its result, each scrolling alone; phones switch between them. */
export function SourceWorkspace({
  page,
  format,
  canWrite,
  preview,
  previewRoot,
  onStuck,
  onAsk,
}: {
  page: Page;
  format: "markdown" | "latex";
  canWrite: boolean;
  preview: ReactNode;
  previewRoot: RefObject<HTMLDivElement | null>;
  onStuck: (stuck: boolean) => void;
  onAsk: (selection: DocSelection) => void;
}) {
  const [split, setSplit] = useState(readSplit);
  const [latexSource, setLatexSource] = useState(
    () => docLatexBlock(page.leaves, 0)?.text ?? docWholeLatex(page.leaves),
  );
  const [view, setView] = useState<"source" | "preview">("source");
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const toast = useToast();
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 720),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => onStuck(page.sourceDrafts.pending),
    [onStuck, page.sourceDrafts.pending],
  );
  const store = (next: number) => {
    const value = Math.max(20, Math.min(80, next));
    setSplit(value);
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(value)));
    } catch {
      // The position lasts this visit without storage.
    }
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) =>
      store(((next.clientX - box.left) / box.width) * 100);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const key = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowLeft" ? -2 : event.key === "ArrowRight" ? 2 : 0;
    if (step) {
      event.preventDefault();
      store(split + step);
    }
    if (event.key === "Home") store(20);
    if (event.key === "End") store(80);
  };
  const sourcePane =
    format === "markdown" ? (
      <MarkdownSource
        page={page}
        canWrite={canWrite}
        previewRoot={previewRoot}
        onAsk={onAsk}
      />
    ) : (
      <LatexSource
        page={page}
        canWrite={canWrite}
        onStuck={onStuck}
        onPreview={setLatexSource}
        report={(text) => toast({ text, error: true })}
      />
    );
  const latexResult = format === "latex" && (
    <LatexPreview source={latexSource} fill />
  );
  return (
    <div className="doc-split-frame" ref={root}>
      {narrow && (
        <div className="doc-split-switch">
          <Segmented
            label="Source or preview"
            value={view}
            options={[
              { value: "source", label: "Source" },
              { value: "preview", label: "Preview" },
            ]}
            onChange={setView}
          />
        </div>
      )}
      <div
        className="doc-split"
        data-narrow={narrow || undefined}
        style={
          narrow
            ? undefined
            : {
                gridTemplateColumns: `minmax(0, ${split}fr) 9px minmax(0, ${100 - split}fr)`,
              }
        }
      >
        <section
          className="doc-pane"
          aria-label={
            format === "latex" ? "LaTeX source pane" : "Markdown source pane"
          }
          hidden={narrow && view !== "source"}
        >
          {sourcePane}
        </section>
        {!narrow && (
          <div
            className="doc-divider-bar"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize source and preview"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={Math.round(split)}
            onPointerDown={drag}
            onKeyDown={key}
          />
        )}
        <section
          className="doc-pane"
          aria-label="Page preview"
          hidden={narrow && view !== "preview"}
        >
          {format === "latex" ? latexResult : preview}
        </section>
      </div>
    </div>
  );
}

function MarkdownSource({
  page,
  canWrite,
  previewRoot,
  onAsk,
}: {
  page: Page;
  canWrite: boolean;
  previewRoot: RefObject<HTMLDivElement | null>;
  onAsk: (selection: DocSelection) => void;
}) {
  const document = page.document!;
  const generated = useMemo(() => {
    try {
      return versionedDocSource(document, { projected: true });
    } catch {
      return null;
    }
  }, [document]);
  const text = page.state.source ?? generated;
  const area = useRef<HTMLTextAreaElement>(null);
  const map = useMemo(() => {
    if (text === null) return null;
    try {
      return versionedDocSourceMap(document, text, { projected: true });
    } catch {
      return null;
    }
  }, [document, text]);
  const ignoreSource = useRef<number | null>(null);
  const ignorePreview = useRef<number | null>(null);
  const blocks = useMemo(
    () =>
      map?.ranges
        .filter((range) => range.kind === "block")
        .sort((a, b) => a.start - b.start) ?? [],
    [map],
  );
  const lineHeight = () =>
    area.current
      ? Number.parseFloat(getComputedStyle(area.current).lineHeight) || 20
      : 20;
  const leafAt = (path: number[]) =>
    previewRoot.current?.querySelector<HTMLElement>(
      `.doc-line[data-container-path="${path.join("/")}"]`,
    );
  const syncPreview = () => {
    const source = area.current;
    const pane = previewRoot.current;
    if (!source || !pane || !blocks.length) return;
    if (
      ignoreSource.current !== null &&
      Math.abs(source.scrollTop - ignoreSource.current) < 2
    ) {
      ignoreSource.current = null;
      return;
    }
    ignoreSource.current = null;
    const line = source.scrollTop / lineHeight() + 1;
    let range = blocks[0];
    for (let index = blocks.length - 1; index >= 0; index--) {
      const entry = blocks[index];
      if (entry.startLine <= line) {
        range = entry;
        break;
      }
    }
    const element = leafAt(range.path);
    if (!element) return;
    const box = element.getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(
        1,
        (line - range.startLine) / Math.max(1, range.endLine - range.startLine),
      ),
    );
    const target =
      pane.scrollTop +
      box.top -
      pane.getBoundingClientRect().top +
      progress * box.height;
    pane.scrollTop = target;
    ignorePreview.current = pane.scrollTop;
  };
  useEffect(() => {
    const pane = previewRoot.current;
    if (!pane) return;
    const sync = () => {
      const source = area.current;
      if (!source) return;
      if (
        ignorePreview.current !== null &&
        Math.abs(pane.scrollTop - ignorePreview.current) < 2
      ) {
        ignorePreview.current = null;
        return;
      }
      ignorePreview.current = null;
      const top = pane.getBoundingClientRect().top + 8;
      const lines = [
        ...pane.querySelectorAll<HTMLElement>(".doc-line[data-container-path]"),
      ];
      const visible =
        lines.find((line) => line.getBoundingClientRect().bottom > top) ??
        lines.at(-1);
      if (!visible) return;
      const range = blocks.find(
        (entry) => entry.path.join("/") === visible.dataset.containerPath,
      );
      if (!range) return;
      source.scrollTop = (range.startLine - 1) * lineHeight();
      ignoreSource.current = source.scrollTop;
    };
    pane.addEventListener("scroll", sync);
    return () => pane.removeEventListener("scroll", sync);
  }, [blocks, previewRoot]);
  const caretToPreview = () => {
    const at = area.current?.selectionStart;
    if (at === undefined || !map) return;
    const range = versionedDocSourceAt(map, at);
    if (range) leafAt(range.path)?.scrollIntoView({ block: "nearest" });
  };
  const askSelection = () => {
    const input = area.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end, value } = input;
    if (end > start)
      onAsk({
        format: "markdown",
        source: value,
        start,
        end,
        quote: value.slice(start, end),
      });
  };
  if (text === null)
    return (
      <p className="small muted doc-pane-note">
        Source view is unavailable for this structure.
      </p>
    );
  return (
    <>
      <div className="doc-pane-head small">
        <span className="muted">Markdown source</span>
        <Button variant="ghost" onClick={askSelection}>
          <Sparkles /> Ask about selection
        </Button>
      </div>
      {canWrite ? (
        <textarea
          ref={area}
          className="doc-source"
          aria-label="Markdown source"
          value={text}
          spellCheck={false}
          wrap="off"
          readOnly={page.state.conflict}
          onSelect={caretToPreview}
          onScroll={syncPreview}
          onChange={(event) => {
            const current = page.store.state;
            if (!current.session) return;
            if (current.error && !current.sourceInvalid)
              void page.store.retrySave();
            page.store.changeSource(
              current.session.document,
              event.currentTarget.value,
            );
          }}
        />
      ) : (
        <pre className="doc-source" tabIndex={0}>
          {text}
        </pre>
      )}
    </>
  );
}

function LatexSource({
  page,
  canWrite,
  report,
  onStuck,
  onPreview,
}: {
  page: Page;
  canWrite: boolean;
  report: (text: string) => void;
  onStuck: (stuck: boolean) => void;
  onPreview: (source: string) => void;
}) {
  const document = page.document!;
  const leaves = page.leaves;
  const count = leaves.filter(
    (block) => block.type === "code" && block.lang === "latex-document",
  ).length;
  const [selected, setSelected] = useState(() =>
    latexSourceSelector(document, count ? 0 : -1),
  );
  const which = sourceOrdinal(selected, document) ?? -2;
  const block = which >= 0 ? docLatexBlock(leaves, which) : undefined;
  const whole = useMemo(() => docWholeLatex(leaves), [leaves]);
  const base =
    which >= 0
      ? (block?.text ?? EMPTY_LATEX_DOCUMENT)
      : which === -1
        ? whole
        : "";
  const latestBase = useRef(base);
  latestBase.current = base;
  const confirm = useConfirm();
  const [text, setText] = useState(base);
  useEffect(() => onPreview(text), [text, onPreview]);
  const [problem, setProblem] = useState("");
  const loadedDraft = useRef<string | null>(null);
  const manualRecovery = useRef(false);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const owner = useRef({
    token: getToken(),
    version: getSessionVersion(),
  }).current;
  const alive = useRef(true);
  const currentOwner = useCallback(
    () =>
      alive.current &&
      getToken() === owner.token &&
      getSessionVersion() === owner.version,
    [owner],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onStuck(false);
    };
  }, [onStuck]);
  useEffect(() => {
    onStuck(!!problem || page.sourceDrafts.pending);
    if (!problem && !page.sourceDrafts.pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [problem, onStuck, page.sourceDrafts.pending]);
  const typed = useRef(false);
  const lastApplied = useRef(base);
  const lastStoreSource = useRef(base);
  useEffect(() => {
    // The shared store already merged or rejected the remote revision. Adopt
    // its current source when this input has no separate unapplied draft.
    if (typed.current && base === lastStoreSource.current) return;
    if (
      !problem &&
      !page.state.conflict &&
      (!typed.current || text === lastApplied.current || text === base)
    ) {
      lastApplied.current = base;
      lastStoreSource.current = base;
      typed.current = false;
      setText(base);
    }
  }, [base, text, problem, page.state.conflict]);
  useEffect(() => {
    const draft = page.sourceDrafts.active;
    if (
      !currentOwner() ||
      !page.sourceDrafts.pending ||
      !draft ||
      loadedDraft.current === draft.id
    )
      return;
    // Returning to this pane only restores the local input, never the page.
    loadedDraft.current = draft.id;
    manualRecovery.current = true;
    typed.current = true;
    setSelected(draft.selector);
    setText(draft.raw);
    setProblem("Recovered source is unapplied. Review it, then apply.");
  }, [page.sourceDrafts.active, page.sourceDrafts.pending, currentOwner]);
  useEffect(() => {
    const draft = page.sourceDrafts.active;
    if (currentOwner() && page.sourceDrafts.pending && page.recovery) {
      setProblem(
        "Restore or discard the page draft before applying this source.",
      );
      return;
    }
    if (
      currentOwner() &&
      page.sourceDrafts.pending &&
      draft &&
      (!sameSourceBase(draft, document) ||
        sourceOrdinal(draft.selector, document) === null)
    )
      setProblem(
        "The page changed since this source was kept. Save a source copy and compare it with the current page before discarding this draft.",
      );
    else if (currentOwner() && page.sourceDrafts.pending && draft)
      setProblem((previous) =>
        previous ===
        "Restore or discard the page draft before applying this source."
          ? "Recovered source is unapplied. Review it, then apply."
          : previous,
      );
  }, [
    page.sourceDrafts.active,
    page.sourceDrafts.pending,
    document,
    currentOwner,
    page.recovery,
  ]);

  const apply = useCallback(
    (next: string, explicit = false) => {
      if (!currentOwner() || !canWrite || page.state.conflict) return;
      setText(next);
      typed.current = true;
      const current = page.store.state.session?.document ?? document;
      let draft = page.sourceDrafts.pending ? page.sourceDrafts.active : null;
      const retain = () => {
        draft = page.sourceDrafts.remember(next, draft?.selector ?? selected);
        if (draft) loadedDraft.current = draft.id;
      };
      if (page.recovery) {
        retain();
        manualRecovery.current = true;
        setProblem(
          "Restore or discard the page draft before applying this source.",
        );
        return;
      }
      if (draft) {
        retain();
        if (
          draft &&
          (!sameSourceBase(draft, current) ||
            sourceOrdinal(draft.selector, current) === null)
        ) {
          setProblem(
            "The page changed since this source was kept. Save a source copy and compare it with the current page before discarding this draft.",
          );
          return;
        }
        if (manualRecovery.current && !explicit) {
          setProblem("Recovered source is unapplied. Review it, then apply.");
          return;
        }
      }
      if (next.length > DOC_LATEX_SOURCE_MAX) {
        retain();
        setProblem(
          `This source is over the ${DOC_LATEX_SOURCE_MAX.toLocaleString()} character limit. Your draft stays here.`,
        );
        return;
      }
      try {
        const ordinal = sourceOrdinal(draft?.selector ?? selected, current);
        if (ordinal === null)
          throw new Error(
            "This LaTeX note is no longer available. Save a source copy before choosing another note.",
          );
        const operation =
          ordinal >= 0
            ? docLatexOperation(current, next, ordinal)
            : docWholeLatexOperation(current, next);
        if (!page.edit(operation))
          throw new Error(
            "This edit couldn't be applied. Your source is still here; resolve the page draft or save a source copy.",
          );
        const savedInput = page.store.state.session?.document;
        if (savedInput) {
          const nextLeaves = leavesOf(savedInput);
          lastStoreSource.current =
            ordinal >= 0
              ? (docLatexBlock(nextLeaves, ordinal)?.text ??
                EMPTY_LATEX_DOCUMENT)
              : docWholeLatex(nextLeaves);
        }
        lastApplied.current = next;
        manualRecovery.current = false;
        page.sourceDrafts.accepted();
        setProblem("");
      } catch (failure) {
        retain();
        setProblem(
          messageOf(
            failure,
            "This LaTeX can't be saved to the note yet. Your draft stays here.",
          ),
        );
      }
    },
    [page, document, selected, canWrite, currentOwner],
  );
  useEffect(() => {
    typed.current = false;
  }, [selected]);
  const saveCopy = (raw: string) => {
    if (!currentOwner()) return;
    try {
      const url = URL.createObjectURL(
        new Blob([raw], { type: "text/plain;charset=utf-8" }),
      );
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.download = `${page.session?.title || "document"}-draft.tex`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      report(messageOf(failure, "Couldn't save a source copy."));
    }
  };
  const recover = (draft: LatexSourceDraft) => {
    if (!currentOwner()) return;
    const restored = page.sourceDrafts.recover(draft.id);
    if (!restored) return;
    loadedDraft.current = restored.id;
    manualRecovery.current = true;
    typed.current = true;
    setSelected(restored.selector);
    setText(restored.raw);
    setProblem("Recovered source is unapplied. Review it, then apply.");
  };
  const discard = async (draftId?: string) => {
    if (!currentOwner()) return;
    const activeId = page.sourceDrafts.active?.id;
    const accepted = await confirm({
      title: "Discard source draft?",
      body: "Unapplied source changes are removed. Save a source copy first if you want to keep them.",
      action: "Discard",
      danger: true,
    });
    if (!accepted || !currentOwner()) return;
    const wasActive = draftId === undefined || draftId === activeId;
    if (wasActive && page.sourceDrafts.active?.id !== activeId) return;
    const error = page.sourceDrafts.discard(draftId ?? activeId);
    if (error) {
      report(error);
      return;
    }
    if (wasActive) {
      loadedDraft.current = null;
      manualRecovery.current = false;
      typed.current = false;
      setText(latestBase.current);
      setProblem("");
    }
  };
  const exportPdf = async () => {
    if (
      !currentOwner() ||
      exportLock.current ||
      problem ||
      page.sourceDrafts.pending ||
      which === -2
    )
      return;
    exportLock.current = true;
    setExporting(true);
    try {
      if (!(await page.flush()) || !currentOwner()) return;
      const blob = await client.compileDocLatex(page.id, {
        source: text,
        version: page.store.state.session?.saved.version ?? 0,
      });
      if (!currentOwner()) return;
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.download = `${page.session?.title || "document"}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (currentOwner())
        report(messageOf(failure, "Couldn't update the PDF. Try again."));
    } finally {
      exportLock.current = false;
      if (currentOwner()) setExporting(false);
    }
  };
  return (
    <>
      <div className="doc-pane-head small">
        <select
          className="input lib-select"
          aria-label="LaTeX source"
          disabled={exporting}
          value={which}
          onChange={(event) => {
            if (exporting || !currentOwner()) return;
            if (problem || page.sourceDrafts.pending) {
              setProblem(
                "Resolve or save a source copy before choosing another note.",
              );
              return;
            }
            setSelected(
              latexSourceSelector(
                page.store.state.session?.document ?? document,
                Number(event.currentTarget.value),
              ),
            );
          }}
        >
          {which === -2 && (
            <option value={-2}>Selected note is unavailable</option>
          )}
          <option value={-1}>Whole page</option>
          {Array.from({ length: count }, (_, index) => (
            <option key={index} value={index}>
              LaTeX note {index + 1}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          busy={exporting}
          disabled={
            !!problem ||
            page.sourceDrafts.pending ||
            which === -2 ||
            (which < 0 && !docWholeLatexCanExport(leaves))
          }
          onClick={() => void exportPdf()}
        >
          Export PDF
        </Button>
      </div>
      {page.sourceDrafts.items.length > 0 && (
        <div
          className="doc-pane-note small"
          aria-label="Source recovery copies"
        >
          {page.sourceDrafts.items.map((draft) => (
            <div key={draft.id}>
              <span>
                Unapplied{" "}
                {draft.selector.kind === "whole"
                  ? "whole-page source"
                  : "LaTeX note"}{" "}
                from {new Date(draft.at).toLocaleString()}.
              </span>{" "}
              <Button
                variant="ghost"
                disabled={!!problem || page.sourceDrafts.pending}
                onClick={() => recover(draft)}
              >
                Recover source
              </Button>
              <Button variant="ghost" onClick={() => saveCopy(draft.raw)}>
                Save source copy
              </Button>
              <Button variant="ghost" onClick={() => void discard(draft.id)}>
                Discard
              </Button>
            </div>
          ))}
        </div>
      )}
      {(problem || page.sourceDrafts.error) && (
        <div className="small doc-latex-error doc-pane-note" role="alert">
          {problem && <p>{problem}</p>}
          {page.sourceDrafts.error && (
            <>
              <p>{page.sourceDrafts.error}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  if (currentOwner()) page.sourceDrafts.retry();
                }}
              >
                Try again
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => saveCopy(text)}>
            Save source copy
          </Button>
          {problem && (
            <>
              <Button
                variant="ghost"
                disabled={
                  !canWrite ||
                  !!page.recovery ||
                  page.state.conflict ||
                  text.length > DOC_LATEX_SOURCE_MAX ||
                  (!!page.sourceDrafts.active &&
                    !sameSourceBase(page.sourceDrafts.active, document)) ||
                  which === -2
                }
                onClick={() => apply(text, true)}
              >
                Apply source
              </Button>
              <Button variant="ghost" onClick={() => void discard()}>
                Discard source draft
              </Button>
            </>
          )}
        </div>
      )}
      <textarea
        className="doc-source"
        aria-label="LaTeX source"
        value={text}
        spellCheck={false}
        wrap="off"
        readOnly={!canWrite || page.state.conflict}
        onChange={(event) => apply(event.currentTarget.value)}
      />
    </>
  );
}

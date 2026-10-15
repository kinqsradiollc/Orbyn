import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  docLatexBlock,
  withDocLatexSource,
  EMPTY_LATEX_DOCUMENT,
  docFragmentIndex,
  parseAppLink,
  docSourceMap,
  docSourceBlockAt,
  docSourcePosition,
  docSourceLineAt,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  listLayout,
  type DocBlock,
} from "@orbyn/core";
import { useModalFocus } from "../../hooks/useModalFocus";
import { BlockView } from "./DocBlocks";
import { FootnoteContext } from "./RichBlocks";
import { DocNavigationContext } from "./doc-navigation";
import { session } from "../../lib/session";
import "./doc-source.css";

/** Source editing delegates to the owning editor; this view never saves a revision. */
export function DocSourcePreview({
  blocks,
  docId,
  onAppLink,
  beforeNavigate,
  onClose,
  onSourceChange,
  saveStatus,
  onCompileLatex,
  onAssist,
  onLatexChange,
  latexOnly = false,
}: {
  blocks: DocBlock[];
  docId: string;
  onAppLink: (url: string) => void;
  beforeNavigate?: () => Promise<boolean>;
  onClose: () => void;
  onSourceChange?: (source: string, expected: DocBlock[]) => DocBlock[];
  saveStatus?: string;
  onCompileLatex: (source: string, signal: AbortSignal) => Promise<Blob>;
  onAssist?: (block: DocBlock) => void;
  onLatexChange?: (text: string, expected: DocBlock[]) => DocBlock[];
  latexOnly?: boolean;
}) {
  const [navigating, setNavigating] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const navigationPending = useRef(false);
  const navigationOwner = useRef(session.get()).current;
  const navigationAlive = useRef(true);
  useEffect(() => {
    navigationAlive.current = true;
    return () => {
      navigationAlive.current = false;
    };
  }, []);
  const [mode, setMode] = useState<"markdown" | "latex">(
    latexOnly ? "latex" : "markdown",
  );
  const latex = docLatexBlock(blocks);
  const [latexText, setLatexText] = useState(
    latex?.text ?? EMPTY_LATEX_DOCUMENT,
  );
  const [pdf, setPdf] = useState<{ url: string; source: string } | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");
  const compile = useRef<AbortController | null>(null);
  useEffect(() => {
    if (latex) setLatexText(latex.text);
  }, [latex?.text]);
  useEffect(
    () => () => {
      compile.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf.url);
    },
    [pdf],
  );
  const compilePdf = async () => {
    if (compile.current || sourceError || !(onSourceChange || onLatexChange))
      return;
    const controller = new AbortController();
    compile.current = controller;
    setCompiling(true);
    setCompileError("");
    const snapshot = latexText;
    const account = session.get();
    try {
      const blob = await onCompileLatex(snapshot, controller.signal);
      if (!controller.signal.aborted && account === session.get())
        setPdf({ url: URL.createObjectURL(blob), source: snapshot });
    } catch (error) {
      if (!controller.signal.aborted && account === session.get())
        setCompileError(
          error instanceof Error ? error.message : "Couldn’t compile LaTeX.",
        );
    } finally {
      if (compile.current === controller) {
        compile.current = null;
        setCompiling(false);
      }
    }
  };
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"split" | "source" | "preview">("split");
  const [compact, setCompact] = useState(false);
  const shownView = compact && view === "split" ? "source" : view;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const measure = () => {
      const unit = parseFloat(getComputedStyle(node).fontSize) || 15;
      setCompact(
        node.clientWidth < Math.max(700, unit * 46) || window.innerHeight < 580,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const focusAfterReveal = useRef(false);
  useEffect(() => {
    if (focusAfterReveal.current && shownView !== "preview") {
      focusAfterReveal.current = false;
      source.current?.focus();
    }
  }, [shownView]);
  const expectedScroll = useRef<{ source?: number; preview?: number }>({});
  const canonical = useMemo(() => docSourceMap(blocks), [blocks]);
  // This buffer retains typed whitespace while the owning editor holds the
  // parsed blocks and the only save/revision path. External reconciliations
  // replace it; echoes of our own parsed source do not move the caret.
  const [sourceText, setSourceText] = useState(canonical.source);
  const [sourceError, setSourceError] = useState("");
  const liveSourceError = useRef(sourceError);
  liveSourceError.current = sourceError;
  const acceptedSource = useRef(canonical.source);
  const ownerBlocks = useRef(blocks);
  // React can commit an older edit after a newer native text event arrived.
  // Recognize every own block echo without retaining old document snapshots.
  const acceptedBlocks = useRef(new WeakSet<DocBlock[]>([blocks]));
  const mustRestore = useRef(false);
  // Retained browser/native input handlers must not rebase an older buffer
  // onto ownership adopted from another editor.
  const sourceEpoch = useRef(0);
  const renderedEpoch = sourceEpoch.current;
  useEffect(() => {
    if (
      acceptedBlocks.current.has(blocks) ||
      canonical.source === acceptedSource.current
    )
      return;
    sourceEpoch.current++;
    if (sourceError) {
      mustRestore.current = true;
      setSourceError(
        "The document changed while this source edit was invalid. Restore the current document before continuing.",
      );
      return;
    }
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    setSourceError("");
  }, [blocks, canonical.source]);
  const map = useMemo(
    () =>
      onSourceChange && !sourceError
        ? docSourceMap(blocks, sourceText)
        : canonical,
    [blocks, canonical, sourceText, sourceError, onSourceChange],
  );
  const changeSource = (text: string) => {
    if (!onSourceChange || mustRestore.current || navigationPending.current)
      return;
    setSourceText(text);
    try {
      if (renderedEpoch !== sourceEpoch.current) {
        mustRestore.current = true;
        throw new Error(
          "The document changed before this source edit could be applied. Restore the current document before continuing.",
        );
      }
      const next = onSourceChange(text, ownerBlocks.current);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = docSourceMap(next).source;
      setSourceError("");
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "Couldn't apply the source edit.",
      );
    }
  };
  const changeLatex = (text: string) => {
    if (navigationPending.current) return;
    compile.current?.abort();
    setLatexText(text);
    if (!onLatexChange) {
      try {
        changeSource(
          docSourceMap(withDocLatexSource(ownerBlocks.current, text)).source,
        );
      } catch (error) {
        setSourceError(
          error instanceof Error
            ? error.message
            : "Couldn’t apply LaTeX source.",
        );
      }
      return;
    }
    if (mustRestore.current) return;
    try {
      if (renderedEpoch !== sourceEpoch.current)
        throw new Error(
          "The document changed. Restore the current document before editing.",
        );
      const next = onLatexChange(text, ownerBlocks.current);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = docSourceMap(next).source;
      setSourceText(acceptedSource.current);
      setSourceError("");
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Couldn’t apply LaTeX source.",
      );
    }
  };
  const closeSource = () => {
    if (!sourceError && !navigationPending.current) onClose();
  };
  // The shared focus owner respects nested dialogs and preserves invalid drafts.
  // Dialog lifetime follows mounting, not parser errors.
  const focus = useModalFocus(closeSource, !!sourceError || navigating);
  const revertSource = () => {
    mustRestore.current = false;
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    setLatexText(docLatexBlock(blocks)?.text ?? EMPTY_LATEX_DOCUMENT);
    setSourceError("");
  };
  const layout = useMemo(() => listLayout(blocks), [blocks]);
  const notes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
    }),
    [blocks],
  );
  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => {
      modal?.close();
    };
  }, []);
  const select = (index: number, fromSource = false) => {
    const range = map.ranges[index];
    if (!range) return;
    setSelected(index);
    if (fromSource && shownView !== "source")
      preview.current
        ?.querySelector<HTMLElement>(`[data-source-index="${index}"]`)
        ?.scrollIntoView({ block: "nearest" });
    else if (!fromSource) {
      if (shownView === "preview") {
        focusAfterReveal.current = true;
        setView("split");
      }
      source.current?.focus();
      source.current?.setSelectionRange(range.start, range.end);
      if (source.current)
        source.current.scrollTop =
          (range.startLine - 1) *
          parseFloat(getComputedStyle(source.current).lineHeight);
    }
  };
  const goToFragment = (fragment: string) => {
    const index = docFragmentIndex(blocks, fragment);
    if (index === null) return;
    select(index, true);
  };
  const navigation = {
    docId,
    onFragment: goToFragment,
    onAppLink: (url: string) => {
      const link = parseAppLink(url);
      if (link?.kind === "doc" && link.id === docId && link.block)
        goToFragment(link.block);
      else {
        if (sourceError || navigationPending.current) return;
        navigationPending.current = true;
        const navigationEpoch = sourceEpoch.current;
        setNavigating(true);
        setNavigationError("");
        void (async () => {
          try {
            if (beforeNavigate && !(await beforeNavigate())) return;
            if (
              sourceEpoch.current !== navigationEpoch ||
              liveSourceError.current
            )
              throw new Error(
                "The document changed. Review the source before opening this link.",
              );
            if (!navigationAlive.current || navigationOwner !== session.get())
              return;
            onClose();
            onAppLink(url);
          } catch (error) {
            if (navigationAlive.current && navigationOwner === session.get())
              setNavigationError(
                error instanceof Error
                  ? error.message
                  : "Couldn't open this link. Try again.",
              );
          } finally {
            navigationPending.current = false;
            if (navigationAlive.current) setNavigating(false);
          }
        })();
      }
    },
  };
  const consumeScroll = (pane: "source" | "preview", position: number) => {
    const expected = expectedScroll.current[pane];
    delete expectedScroll.current[pane];
    return expected !== undefined && Math.abs(expected - position) < 1;
  };
  const lineHeight = () =>
    source.current
      ? parseFloat(getComputedStyle(source.current).lineHeight) || 20
      : 20;
  const scrollSource = () => {
    if (shownView !== "split") return;
    const input = source.current,
      pane = preview.current;
    if (!input || !pane || consumeScroll("source", input.scrollTop)) return;
    const position = docSourcePosition(map, input.scrollTop / lineHeight() + 1);
    if (!position) return;
    const node = pane.querySelector<HTMLElement>(
      `[data-source-index="${position.range.blockIndex}"]`,
    );
    if (!node) return;
    const offset =
      node.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop;
    const next =
      offset + position.progress * node.getBoundingClientRect().height;
    if (Math.abs(pane.scrollTop - next) >= 1) {
      pane.scrollTop = next;
      expectedScroll.current.preview = pane.scrollTop;
    }
    setSelected(position.range.blockIndex);
  };
  const scrollPreview = () => {
    if (shownView !== "split") return;
    const input = source.current,
      pane = preview.current;
    if (!input || !pane || consumeScroll("preview", pane.scrollTop)) return;
    const top = pane.getBoundingClientRect().top;
    const nodes = [
      ...pane.querySelectorAll<HTMLElement>("[data-source-index]"),
    ];
    const node =
      nodes.find((element) => element.getBoundingClientRect().bottom > top) ??
      nodes.at(-1);
    if (!node) return;
    const index = Number(node.dataset.sourceIndex),
      range = map.ranges[index];
    if (!range) return;
    const rectangle = node.getBoundingClientRect();
    const next =
      (docSourceLineAt(
        range,
        (top - rectangle.top) / Math.max(1, rectangle.height),
      ) -
        1) *
      lineHeight();
    if (Math.abs(input.scrollTop - next) >= 1) {
      input.scrollTop = next;
      expectedScroll.current.source = input.scrollTop;
    }
    setSelected(index);
  };
  return (
    <dialog
      ref={(node) => {
        dialog.current = node;
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      tabIndex={-1}
      className="doc-source-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        closeSource();
      }}
    >
      <div className="section-heading">
        <h2 id={id}>Source and preview</h2>
        <button
          className="icon-button"
          aria-label="Close source preview"
          onClick={closeSource}
          disabled={navigating || !!sourceError}
        >
          <X size={20} />
        </button>
      </div>
      <div className="doc-source-tools">
        {navigationError && <p role="alert">{navigationError}</p>}
        {navigating && (
          <p className="muted small" role="status">
            Saving before opening…
          </p>
        )}
        <div
          className="segmented doc-source-view"
          role="group"
          aria-label="Document editing mode"
        >
          <button
            type="button"
            onClick={closeSource}
            disabled={navigating || !!sourceError}
          >
            Note
          </button>
          <button
            type="button"
            hidden={latexOnly}
            disabled={navigating || (!!sourceError && mode !== "markdown")}
            aria-pressed={mode === "markdown"}
            onClick={() => setMode("markdown")}
          >
            Markdown
          </button>
          <button
            type="button"
            aria-pressed={mode === "latex"}
            disabled={navigating || (!!sourceError && mode !== "latex")}
            onClick={() => setMode("latex")}
          >
            LaTeX
          </button>
        </div>
        <p className="muted">
          {mode === "latex"
            ? "LaTeX is saved with this note."
            : onSourceChange
              ? "Edit Markdown. Keep block anchors to preserve comments and task links."
              : "Source is read-only."}
        </p>
        {saveStatus && (
          <p role="status" className="doc-source-save">
            {saveStatus}
          </p>
        )}
        {!!sourceError && (
          <div className="doc-source-error" role="alert">
            <p>
              {sourceError} Fix this source or restore the document to change
              editing modes.
            </p>
            <button type="button" onClick={revertSource} disabled={navigating}>
              Restore current document
            </button>
          </div>
        )}
        <div
          className="segmented doc-source-view"
          role="group"
          aria-label="Source preview layout"
        >
          <button
            type="button"
            aria-pressed={shownView === "source"}
            onClick={() => setView("source")}
          >
            Source
          </button>
          <button
            type="button"
            hidden={compact}
            aria-pressed={shownView === "split"}
            onClick={() => setView("split")}
          >
            Split
          </button>
          <button
            type="button"
            aria-pressed={shownView === "preview"}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
        </div>
        {mode === "latex" && (
          <div className="doc-source-view">
            <button
              type="button"
              disabled={
                navigating ||
                compiling ||
                !!sourceError ||
                !(onSourceChange || onLatexChange)
              }
              onClick={() => void compilePdf()}
            >
              {compiling ? "Compiling…" : "Compile PDF"}
            </button>
            {onAssist && latex?.id && (
              <button
                type="button"
                disabled={navigating || !!sourceError || !latex.text.trim()}
                onClick={() => onAssist(latex)}
              >
                Ask assistant
              </button>
            )}
            {compileError && <p role="alert">{compileError}</p>}
            {pdf && pdf.source !== latexText && (
              <p role="status">
                PDF shows an earlier draft. Compile to update it.
              </p>
            )}
          </div>
        )}
      </div>
      <div
        className="doc-source-columns"
        data-view={shownView}
        hidden={mode !== "latex"}
      >
        <textarea
          aria-label="LaTeX source"
          hidden={shownView === "preview"}
          readOnly={navigating || !(onSourceChange || onLatexChange)}
          value={latexText}
          spellCheck={false}
          wrap="off"
          onChange={(event) => changeLatex(event.currentTarget.value)}
        />
        <div className="doc-source-rendered" hidden={shownView === "source"}>
          {pdf ? (
            <iframe
              className="doc-source-pdf"
              title="Compiled LaTeX PDF"
              src={pdf.url}
            />
          ) : (
            <p className="muted">
              {onSourceChange || onLatexChange
                ? "Compile to preview the PDF."
                : "Editing access is needed to compile."}
            </p>
          )}
          {pdf && (
            <a href={pdf.url} download="document.pdf">
              Download PDF
            </a>
          )}
        </div>
      </div>
      <div
        className="doc-source-columns"
        data-view={shownView}
        hidden={mode !== "markdown"}
      >
        <textarea
          ref={source}
          hidden={shownView === "preview"}
          aria-label="Markdown source"
          readOnly={navigating || !onSourceChange}
          value={onSourceChange ? sourceText : map.source}
          onChange={
            onSourceChange
              ? (event) => changeSource(event.currentTarget.value)
              : undefined
          }
          spellCheck={false}
          wrap="off"
          onScroll={scrollSource}
          onSelect={(event) => {
            const range = docSourceBlockAt(
              map,
              event.currentTarget.selectionStart,
            );
            if (range) select(range.blockIndex, true);
          }}
        />
        <div
          ref={preview}
          hidden={shownView === "source"}
          className="doc-source-rendered"
          aria-label="Rendered preview"
          role="region"
          tabIndex={0}
          onScroll={scrollPreview}
        >
          <DocNavigationContext.Provider value={navigation}>
            <FootnoteContext.Provider value={notes}>
              {blocks.map((block, index) => (
                <div
                  key={block.id ?? index}
                  data-source-index={index}
                  className={selected === index ? "is-selected" : ""}
                >
                  <button
                    className="text-button doc-source-jump"
                    onClick={() => select(index)}
                  >
                    Source lines {map.ranges[index].startLine}–
                    {map.ranges[index].endLine}
                  </button>
                  {onAssist &&
                    block.id &&
                    "text" in block &&
                    block.text.trim() && (
                      <button
                        className="text-button doc-source-jump"
                        disabled={navigating || !!sourceError}
                        onClick={() => onAssist(block)}
                      >
                        Ask assistant
                      </button>
                    )}
                  <BlockView
                    block={block}
                    pageBlocks={blocks}
                    number={layout[index].number}
                    depth={layout[index].depth}
                  />
                </div>
              ))}
            </FootnoteContext.Provider>
          </DocNavigationContext.Provider>
        </div>
      </div>
    </dialog>
  );
}

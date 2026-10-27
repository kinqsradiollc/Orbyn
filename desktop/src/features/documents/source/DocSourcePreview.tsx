import { Select } from "../../../components/Select";
import { LatexHtmlPreview } from "../../../components/LatexHtmlPreview";
import { useDocLatexPreview } from "./DocLatexPreview";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  docLatexBlock,
  docSourceDiagnostic,
  type DocSourceDiagnostic,
  docWholeLatex,
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
  type DocSelection,
  type DocBlock,
} from "@orbyn/core";
import { useModalFocus } from "../../../hooks/useModalFocus";
import { BlockView } from "../editor/DocBlocks";
import { FootnoteContext } from "../editor/RichBlocks";
import { DocNavigationContext } from "../library/doc-navigation";
import { session } from "../../../lib/session";
import "./doc-source.css";

/** Full source is local context for parent validation, never an API payload. */
export type DocSourceSelection = {
  format: "markdown" | "latex";
  source: string;
  start: number;
  end: number;
  quote: string;
  explain?: boolean;
  /** Local-only guard; never serialize this or the full source. */
  isCurrent?: () => boolean;
};

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
  selectionHandle,
  onLatexChange,
  latexOnly = false,
  initialMode = "markdown",
  inline = false,
  sourceOnly = false,
  showModes = true,
  compileReady = true,
  leaveCheck,
  initialSourceNumber = -1,
  exportPdfHandle,
}: {
  initialSourceNumber?: number;
  exportPdfHandle?: { current: (() => Promise<void>) | null };
  blocks: DocBlock[];
  docId: string;
  onAppLink: (url: string) => void;
  beforeNavigate?: () => Promise<boolean>;
  onClose: () => void;
  onSourceChange?: (source: string, expected: DocBlock[]) => DocBlock[];
  saveStatus?: string;
  onCompileLatex: (source: string, signal: AbortSignal) => Promise<Blob>;
  onAssist?: (block: DocBlock) => void;
  onSelectionAssist?: (selection: DocSourceSelection) => void;
  selectionHandle?: { current: (() => DocSelection | null) | null };
  onLatexChange?: (
    text: string,
    expected: DocBlock[],
    sourceNumber?: number,
  ) => DocBlock[];
  latexOnly?: boolean;
  initialMode?: "markdown" | "latex";
  inline?: boolean;
  sourceOnly?: boolean;
  showModes?: boolean;
  compileReady?: boolean | (() => boolean);
  leaveCheck?: { current: (() => boolean) | null };
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
    latexOnly ? "latex" : initialMode,
  );
  const [sourceNumber, setSourceNumber] = useState(initialSourceNumber);
  const sources = blocks.filter(
    (block) => block.type === "code" && block.lang === "latex-document",
  );
  const latex = docLatexBlock(blocks, sourceNumber);
  const wholeLatexTooLong =
    sourceNumber < 0 && docWholeLatex(blocks).length > 20_000;
  const [latexText, setLatexText] = useState(
    sourceNumber < 0
      ? docWholeLatex(blocks)
      : (latex?.text ?? EMPTY_LATEX_DOCUMENT),
  );
  const sharedPreview = useDocLatexPreview();
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");
  const compile = useRef<AbortController | null>(null);
  useEffect(() => {
    if (sourceNumber >= 0 && latex && !liveSourceError.current)
      setLatexText(latex.text);
  }, [latex?.text]);
  useEffect(
    () => () => {
      compile.current?.abort();
    },
    [],
  );
  const exportPdf = async () => {
    if (
      compile.current ||
      !(typeof compileReady === "function" ? compileReady() : compileReady) ||
      mode !== "latex" ||
      sourceNumber < 0 ||
      !latex ||
      !navigationAlive.current ||
      navigationPending.current ||
      session.get() !== navigationOwner ||
      liveSourceError.current ||
      !(onSourceChange || onLatexChange)
    )
      return;
    const controller = new AbortController();
    compile.current = controller;
    setCompiling(true);
    setCompileError("");
    const snapshot = latexText;
    const compileEpoch = sourceEpoch.current;
    setCompileProblem(null);
    const account = session.get();
    try {
      const blob = await onCompileLatex(snapshot, controller.signal);
      if (
        !controller.signal.aborted &&
        account === session.get() &&
        compileEpoch === sourceEpoch.current &&
        liveLatexText.current === snapshot
      ) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "document.pdf";
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch (error) {
      const detail = docSourceDiagnostic(error, snapshot);
      if (
        !controller.signal.aborted &&
        session.get() === account &&
        compileEpoch === sourceEpoch.current &&
        liveLatexText.current === snapshot
      )
        setCompileProblem(
          detail
            ? {
                detail,
                text: snapshot,
                epoch: compileEpoch,
                mode: "latex",
              }
            : null,
        );
      if (
        !controller.signal.aborted &&
        account === session.get() &&
        compileEpoch === sourceEpoch.current &&
        liveLatexText.current === snapshot
      )
        setCompileError(
          error instanceof Error
            ? error.message
            : "Couldn’t export this PDF. Check the source and try again.",
        );
    } finally {
      if (compile.current === controller) {
        compile.current = null;
        setCompiling(false);
      }
    }
  };
  useEffect(() => {
    if (!exportPdfHandle) return;
    exportPdfHandle.current =
      mode === "latex" && sourceNumber >= 0 ? exportPdf : null;
    return () => {
      if (exportPdfHandle.current === exportPdf) exportPdfHandle.current = null;
    };
  }, [exportPdfHandle, exportPdf]);
  useEffect(() => {
    compile.current?.abort();
  }, [sourceNumber]);
  const id = useId();
  const dialog = useRef<HTMLElement>(null);
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
  type LocatedProblem = {
    detail: DocSourceDiagnostic;
    text: string;
    epoch: number;
    mode: "latex" | "markdown";
  };
  const [sourceProblem, setSourceProblem] = useState<LocatedProblem | null>(
    null,
  );
  const [compileProblem, setCompileProblem] = useState<LocatedProblem | null>(
    null,
  );
  const [jumpRequest, setJumpRequest] = useState<LocatedProblem | null>(null);
  const latexInput = useRef<HTMLTextAreaElement>(null);
  const liveLatexText = useRef(latexText);
  liveLatexText.current = latexText;
  const liveMarkdownText = useRef(sourceText);
  liveMarkdownText.current = sourceText;
  const [errorLineMark, setErrorLineMark] = useState<{
    top: number;
    height: number;
  } | null>(null);

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
  type UserSourceSelection = DocSourceSelection & {
    epoch: number;
    sourceNumber: number;
    account: typeof navigationOwner;
    docId: string;
  };
  const [userSourceSelection, setUserSourceSelection] =
    useState<UserSourceSelection | null>(null);
  const pendingUserRange = useRef<UserSourceSelection | null>(null);
  const sourceGestureActive = useRef(false);
  const sourceInputBlurred = useRef(false);
  const sourceSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sourceSelectionGeneration = useRef(0);
  const liveSourceIdentity = useRef({ mode, sourceNumber, docId });
  liveSourceIdentity.current = { mode, sourceNumber, docId };
  const programmaticSourceRange = useRef<{
    format: "markdown" | "latex";
    start: number;
    end: number;
  } | null>(null);
  const clearSourceSelection = () => {
    pendingUserRange.current = null;
    if (sourceSelectionTimer.current !== null)
      clearTimeout(sourceSelectionTimer.current);
    sourceSelectionTimer.current = null;
    sourceSelectionGeneration.current++;
    setUserSourceSelection(null);
  };
  const isCurrentSourceSelection = (
    selected: UserSourceSelection | null,
  ): selected is UserSourceSelection =>
    !!selected &&
    navigationAlive.current &&
    !navigationPending.current &&
    session.get() === navigationOwner &&
    selected.account === navigationOwner &&
    selected.docId === liveSourceIdentity.current.docId &&
    selected.epoch === sourceEpoch.current &&
    selected.sourceNumber === liveSourceIdentity.current.sourceNumber &&
    selected.format === liveSourceIdentity.current.mode &&
    selected.source ===
      (selected.format === "latex"
        ? liveLatexText.current
        : liveMarkdownText.current) &&
    Number.isInteger(selected.start) &&
    Number.isInteger(selected.end) &&
    selected.start >= 0 &&
    selected.end > selected.start &&
    selected.end <= selected.source.length &&
    selected.quote === selected.source.slice(selected.start, selected.end) &&
    !!selected.quote.trim();
  const settleSourceSelection = () => {
    if (sourceSelectionTimer.current !== null)
      clearTimeout(sourceSelectionTimer.current);
    sourceSelectionTimer.current = null;
    const generation = ++sourceSelectionGeneration.current;
    if (sourceGestureActive.current || !pendingUserRange.current) return;
    sourceSelectionTimer.current = setTimeout(() => {
      sourceSelectionTimer.current = null;
      if (
        generation !== sourceSelectionGeneration.current ||
        sourceGestureActive.current
      )
        return;
      const selected = pendingUserRange.current;
      if (isCurrentSourceSelection(selected)) {
        setUserSourceSelection(selected);
      }
    }, 160);
  };
  const finishUserSourceSelection = () => {
    sourceGestureActive.current = false;
    settleSourceSelection();
  };
  const cancelUserSourceSelection = () => {
    sourceGestureActive.current = false;
    clearSourceSelection();
  };
  const captureSourceSelection = (
    format: "markdown" | "latex",
    text: string,
    start: number,
    end: number,
  ) => {
    if (sourceInputBlurred.current) return;
    if (
      !selectionHandle ||
      format !== mode ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > text.length
    ) {
      clearSourceSelection();
      return;
    }
    const suppressed = programmaticSourceRange.current;
    if (
      suppressed &&
      suppressed.format === format &&
      suppressed.start === start &&
      suppressed.end === end
    ) {
      clearSourceSelection();
      return;
    }
    const next = {
      format,
      source: text,
      start,
      end,
      quote: text.slice(start, end),
      epoch: sourceEpoch.current,
      sourceNumber,
      account: navigationOwner,
      docId,
    };
    if (!isCurrentSourceSelection(next)) {
      clearSourceSelection();
      return;
    }
    pendingUserRange.current = next;
    if (
      !userSourceSelection ||
      userSourceSelection.source !== next.source ||
      userSourceSelection.start !== next.start ||
      userSourceSelection.end !== next.end
    )
      setUserSourceSelection(null);
    settleSourceSelection();
  };
  const beginUserSourceSelection = () => {
    sourceInputBlurred.current = false;
    clearSourceSelection();
    sourceGestureActive.current = true;
    programmaticSourceRange.current = null;
  };
  if (selectionHandle)
    selectionHandle.current = () => {
      const selected = userSourceSelection;
      if (sourceGestureActive.current || !isCurrentSourceSelection(selected))
        return null;
      return {
        format: selected.format,
        source: selected.source,
        start: selected.start,
        end: selected.end,
        quote: selected.quote,
        isCurrent: () => isCurrentSourceSelection(selected),
      };
    };
  const dismissSourceActions = cancelUserSourceSelection;
  useEffect(() => {
    cancelUserSourceSelection();
    programmaticSourceRange.current = null;
  }, [mode, sourceNumber, docId]);
  useEffect(
    () => () => {
      if (sourceSelectionTimer.current !== null)
        clearTimeout(sourceSelectionTimer.current);
      sourceSelectionGeneration.current++;
      pendingUserRange.current = null;
      sourceGestureActive.current = false;
    },
    [],
  );
  const captureTextareaSelection = (
    format: "markdown" | "latex",
    input: HTMLTextAreaElement,
  ) => {
    const { selectionStart: start, selectionEnd: end, value: text } = input;
    if (
      !selectionHandle ||
      typeof text !== "string" ||
      !Number.isInteger(end)
    ) {
      clearSourceSelection();
      return;
    }
    captureSourceSelection(format, text, start, end);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const finish = () => {
      if (sourceGestureActive.current) finishUserSourceSelection();
    };
    const cancel = () => {
      if (sourceGestureActive.current) cancelUserSourceSelection();
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keyup", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keyup", finish);
    };
  }, []);
  const activeProblem = (problem: LocatedProblem | null) =>
    problem &&
    problem.mode === mode &&
    problem.epoch === sourceEpoch.current &&
    problem.text === (mode === "latex" ? latexText : sourceText) &&
    session.get() === navigationOwner
      ? problem
      : null;
  const locatedSource = activeProblem(sourceProblem);
  const locatedCompile = activeProblem(compileProblem);
  const located = locatedSource ?? locatedCompile;
  const locationLabel = (detail: DocSourceDiagnostic) =>
    `Line ${detail.line}${detail.column === null ? "" : `, column ${detail.column}`}: ${detail.message}`;
  const jumpToProblem = (problem: LocatedProblem) => {
    if (!activeProblem(problem)) return;
    setView("source");
    clearSourceSelection();
    programmaticSourceRange.current = {
      format: problem.mode,
      start: problem.detail.start,
      end: problem.detail.end,
    };
    setJumpRequest(problem);
  };
  const updateErrorMark = (detail = located?.detail) => {
    const input = latexInput.current;
    if (!input || !detail || mode !== "latex") {
      setErrorLineMark(null);
      return;
    }
    const style = getComputedStyle(input),
      height = parseFloat(style.lineHeight) || 20;
    const top =
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.borderTopWidth) || 0) +
      (detail.line - 1) * height -
      input.scrollTop;
    setErrorLineMark(
      top + height > 0 && top < input.clientHeight ? { top, height } : null,
    );
  };
  useEffect(() => {
    updateErrorMark();
    const input = latexInput.current;
    if (!input || !located) return;
    const observer = new ResizeObserver(() => updateErrorMark());
    observer.observe(input);
    return () => observer.disconnect();
  }, [located?.detail, latexText, shownView]);
  useEffect(() => {
    const problem = jumpRequest;
    if (!problem) return;

    if (
      !navigationAlive.current ||
      session.get() !== navigationOwner ||
      sourceEpoch.current !== problem.epoch ||
      (problem.mode === "latex"
        ? liveLatexText.current
        : liveMarkdownText.current) !== problem.text
    )
      return;
    setJumpRequest(null);
    const input =
      problem.mode === "latex" ? latexInput.current : source.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(problem.detail.start, problem.detail.end);
    const style = getComputedStyle(input),
      height = parseFloat(style.lineHeight) || 20;
    input.scrollTop = Math.max(
      0,
      (problem.detail.line - 1) * height - input.clientHeight / 3,
    );
    updateErrorMark(problem.detail);
  }, [jumpRequest, shownView]);
  const currentAccount = session.get();
  useEffect(() => {
    if (currentAccount === navigationOwner) return;
    clearSourceSelection();
    setSourceProblem(null);
    setCompileProblem(null);
    setCompileError("");
    setSourceError("Document changed. Reopen the source.");
  }, [docId, currentAccount]);

  useEffect(() => {
    if (
      acceptedBlocks.current.has(blocks) ||
      canonical.source === acceptedSource.current
    )
      return;
    sourceEpoch.current++;
    clearSourceSelection();
    setSourceProblem(null);
    setCompileProblem(null);
    setCompileError("");
    if (sourceError) {
      mustRestore.current = true;
      setSourceError("Document changed. Restore to continue.");
      return;
    }
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    if (sourceNumber < 0) setLatexText(docWholeLatex(blocks));
    setSourceProblem(null);
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
    clearSourceSelection();
    setCompileProblem(null);
    setCompileError("");
    setSourceProblem(null);
    if (!navigationAlive.current || session.get() !== navigationOwner) return;
    if (!onSourceChange || mustRestore.current || navigationPending.current)
      return;
    setJumpRequest(null);
    liveMarkdownText.current = text;
    setSourceText(text);
    try {
      if (renderedEpoch !== sourceEpoch.current) {
        mustRestore.current = true;
        throw new Error("Document changed. Restore to continue.");
      }
      const next = onSourceChange(text, ownerBlocks.current);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = docSourceMap(next).source;
      if (sourceNumber < 0) setLatexText(docWholeLatex(next));
      setSourceProblem(null);
      setSourceError("");
    } catch (error) {
      const detail = docSourceDiagnostic(error, text);
      setSourceProblem(
        detail
          ? { detail, text, epoch: sourceEpoch.current, mode: mode }
          : null,
      );
      setSourceError(
        error instanceof Error
          ? error.message
          : "Couldn't apply the source edit.",
      );
    }
  };
  const changeLatex = (text: string) => {
    clearSourceSelection();
    if (
      navigationPending.current ||
      !navigationAlive.current ||
      session.get() !== navigationOwner
    )
      return;
    compile.current?.abort();
    setJumpRequest(null);
    liveLatexText.current = text;
    setSourceProblem(null);
    setCompileProblem(null);
    setCompileError("");
    setLatexText(text);
    if (!onLatexChange) {
      if (sourceNumber < 0) {
        setSourceError(
          "This editor cannot apply whole-document LaTeX changes. Your draft is retained; restore the document to continue in Note or Markdown.",
        );
        return;
      }
      try {
        changeSource(
          docSourceMap(
            withDocLatexSource(ownerBlocks.current, text, sourceNumber),
          ).source,
        );
      } catch (error) {
        const detail = docSourceDiagnostic(error, text);
        setSourceProblem(
          detail
            ? { detail, text, epoch: sourceEpoch.current, mode: mode }
            : null,
        );
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
        throw new Error("Document changed. Restore to continue.");
      const next = onLatexChange(text, ownerBlocks.current, sourceNumber);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = docSourceMap(next).source;
      setSourceText(acceptedSource.current);
      setSourceProblem(null);
      setSourceError("");
    } catch (error) {
      const detail = docSourceDiagnostic(error, text);
      setSourceProblem(
        detail
          ? { detail, text, epoch: sourceEpoch.current, mode: mode }
          : null,
      );
      setSourceError(
        error instanceof Error ? error.message : "Couldn’t apply LaTeX source.",
      );
    }
  };
  useEffect(() => {
    if (mode === "latex")
      sharedPreview?.setDraftSource(latexText, sourceNumber);
    return () => sharedPreview?.setDraftSource(null);
  }, [mode, latexText, sourceNumber, sharedPreview?.setDraftSource]);
  useEffect(() => {
    if (!leaveCheck) return;
    const ready = () =>
      !liveSourceError.current &&
      !mustRestore.current &&
      !navigationPending.current;
    leaveCheck.current = ready;
    return () => {
      if (leaveCheck.current === ready) leaveCheck.current = null;
    };
  }, [leaveCheck]);
  const closeSource = () => {
    if (!sourceError && !navigationPending.current) onClose();
  };
  // The shared focus owner respects nested dialogs and preserves invalid drafts.
  // Dialog lifetime follows mounting, not parser errors.
  const focus = useModalFocus(closeSource, !!sourceError || navigating);
  const revertSource = () => {
    clearSourceSelection();
    setCompileProblem(null);
    setCompileError("");
    mustRestore.current = false;
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    const restored = docLatexBlock(blocks, sourceNumber);
    if (!restored && sourceNumber > 0) setSourceNumber(0);
    setLatexText(
      sourceNumber < 0
        ? docWholeLatex(blocks)
        : ((restored ?? docLatexBlock(blocks))?.text ?? EMPTY_LATEX_DOCUMENT),
    );
    setSourceProblem(null);
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
    if (inline) return;
    const modal = dialog.current as HTMLDialogElement | null;
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
      clearSourceSelection();
      programmaticSourceRange.current = {
        format: "markdown",
        start: range.start,
        end: range.end,
      };
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
  const SourceSurface = inline ? "section" : "dialog";
  return (
    <SourceSurface
      ref={(node) => {
        dialog.current = node;
        if (!inline) focus.ref.current = node;
      }}
      data-modal-focus={inline ? undefined : focus.id}
      tabIndex={-1}
      className={inline ? "doc-source-workspace" : "doc-source-dialog"}
      data-source-only={sourceOnly || undefined}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        closeSource();
      }}
    >
      <div className="section-heading" hidden={inline}>
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
        {mode === "latex" && wholeLatexTooLong && (
          <p role="alert" className="doc-source-error">
            Source exceeds the 20,000-character editing limit. Continue in Note
            or Markdown.
          </p>
        )}
        {mode === "latex" && sourceNumber >= 0 && sources.length > 0 && (
          <Select
            aria-label="LaTeX document source"
            value={String(sourceNumber)}
            disabled={!!sourceError || navigating}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSourceNumber(next);
              setLatexText(
                docLatexBlock(ownerBlocks.current, next)?.text ??
                  EMPTY_LATEX_DOCUMENT,
              );
            }}
          >
            {sources.map((block, index) => (
              <option key={block.id ?? index} value={String(index)}>
                {index === 0
                  ? "Embedded document 1"
                  : `Embedded document ${index + 1}`}
              </option>
            ))}
          </Select>
        )}

        {navigationError && (
          <p role="alert" className="doc-source-error">
            {navigationError}
          </p>
        )}
        {navigating && (
          <p className="muted small" role="status">
            Saving before opening…
          </p>
        )}
        <div
          className="segmented doc-source-view"
          role="group"
          aria-label="Document editing mode"
          hidden={!showModes}
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
        <p className="muted" hidden={inline}>
          {mode === "latex"
            ? "LaTeX is saved with this note."
            : onSourceChange
              ? "Edit Markdown. Keep block anchors to preserve comments and task links."
              : "Source is read-only."}
        </p>
        {saveStatus && (!inline || /couldn|failed|error/i.test(saveStatus)) && (
          <p role="status" className="doc-source-save">
            {saveStatus}
          </p>
        )}
        {!!sourceError && (
          <div
            className="doc-source-error"
            role="alert"
            id={`${id}-source-error`}
          >
            {locatedSource ? (
              <button
                type="button"
                className="doc-source-diagnostic"
                aria-label={`${locatedSource.detail.origin === "conversion" ? "Conversion" : "Compiler"} error. ${locationLabel(locatedSource.detail)}`}
                onClick={() => jumpToProblem(locatedSource)}
              >
                ! {locationLabel(locatedSource.detail)}
              </button>
            ) : (
              <span>! {sourceError}</span>
            )}
            <button
              type="button"
              className="text-button"
              aria-label="Restore current document"
              onClick={revertSource}
              disabled={navigating}
            >
              Restore
            </button>
          </div>
        )}
        {(!inline || !sourceOnly) && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              sourceOnly
                ? closeSource()
                : setView(shownView === "preview" ? "split" : "preview")
            }
          >
            {sourceOnly
              ? "Hide source"
              : shownView === "preview"
                ? "Show source"
                : "Hide source"}
          </button>
        )}
        {mode === "latex" && compiling && <p role="status">Exporting PDF…</p>}
        {mode === "latex" && compileError && (
          <div className="doc-source-error" role="alert">
            {locatedCompile ? (
              <button
                type="button"
                className="doc-source-diagnostic"
                aria-label={`Compiler error. ${locationLabel(locatedCompile.detail)}`}
                onClick={() => jumpToProblem(locatedCompile)}
              >
                ! {locationLabel(locatedCompile.detail)}
              </button>
            ) : (
              <span>! {compileError}</span>
            )}
          </div>
        )}
      </div>
      <div
        className="doc-source-columns"
        data-view={shownView}
        hidden={mode !== "latex"}
      >
        <div
          className="doc-source-input"
          hidden={!sourceOnly && shownView === "preview"}
        >
          <textarea
            ref={latexInput}
            aria-label="LaTeX source"
            onPointerDown={beginUserSourceSelection}
            onPointerUp={finishUserSourceSelection}
            onPointerCancel={cancelUserSourceSelection}
            onKeyUp={finishUserSourceSelection}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dismissSourceActions();
              } else if (
                event.shiftKey ||
                ((event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === "a")
              )
                beginUserSourceSelection();
            }}
            onFocus={() => {
              sourceInputBlurred.current = false;
            }}
            onBlur={() => {
              sourceInputBlurred.current = true;
            }}
            onSelect={(event) =>
              captureTextareaSelection("latex", event.currentTarget)
            }
            aria-invalid={!!sourceError || !!compileError}
            aria-describedby={sourceError ? `${id}-source-error` : undefined}
            readOnly={navigating || !(onSourceChange || onLatexChange)}
            value={latexText}
            spellCheck={false}
            wrap="off"
            onChange={(event) => changeLatex(event.currentTarget.value)}
            onScroll={() => {
              clearSourceSelection();
              updateErrorMark();
            }}
          />
          {located && errorLineMark && (
            <span
              aria-hidden="true"
              className="doc-source-line-marker"
              data-error-line={located.detail.line}
              style={{ top: errorLineMark.top, height: errorLineMark.height }}
            />
          )}
        </div>
        {!sourceOnly && (
          <div
            className="doc-source-rendered"
            hidden={sourceOnly || shownView === "source"}
          >
            <LatexHtmlPreview source={latexText} fill />
          </div>
        )}
      </div>
      <div
        className="doc-source-columns"
        data-view={shownView}
        hidden={mode !== "markdown"}
      >
        <div
          className="doc-source-input"
          hidden={!sourceOnly && shownView === "preview"}
        >
          <textarea
            ref={source}
            hidden={!sourceOnly && shownView === "preview"}
            aria-label="Markdown source"
            onPointerDown={beginUserSourceSelection}
            onPointerUp={finishUserSourceSelection}
            onPointerCancel={cancelUserSourceSelection}
            onKeyUp={finishUserSourceSelection}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dismissSourceActions();
              } else if (
                event.shiftKey ||
                ((event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === "a")
              )
                beginUserSourceSelection();
            }}
            readOnly={navigating || !onSourceChange}
            value={onSourceChange ? sourceText : map.source}
            onChange={
              onSourceChange
                ? (event) => changeSource(event.currentTarget.value)
                : undefined
            }
            spellCheck={false}
            wrap="off"
            onScroll={() => {
              clearSourceSelection();
              scrollSource();
            }}
            onFocus={() => {
              sourceInputBlurred.current = false;
            }}
            onBlur={() => {
              sourceInputBlurred.current = true;
            }}
            onSelect={(event) => {
              captureTextareaSelection("markdown", event.currentTarget);
              const range = docSourceBlockAt(
                map,
                event.currentTarget.selectionStart,
              );
              if (range) select(range.blockIndex, true);
            }}
          />
        </div>
        {!sourceOnly && (
          <div
            ref={preview}
            hidden={sourceOnly || shownView === "source"}
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
        )}
      </div>
    </SourceSurface>
  );
}

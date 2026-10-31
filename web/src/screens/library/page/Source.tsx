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
import { client } from "../../../lib/session";
import { Button, Segmented, useToast } from "../../../ui/kit";
import { LatexPreview } from "./Latex";
import type { Page } from "./usePage";

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
  useEffect(() => onStuck(false), [onStuck]);
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
        report={(text) => toast({ text, error: true })}
      />
    );
  const latexResult = format === "latex" && <LatexResult page={page} />;
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
    const range =
      blocks.findLast((entry) => entry.startLine <= line) ?? blocks[0];
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
}: {
  page: Page;
  canWrite: boolean;
  report: (text: string) => void;
}) {
  const document = page.document!;
  const leaves = page.leaves;
  const count = leaves.filter(
    (block) => block.type === "code" && block.lang === "latex-document",
  ).length;
  const [which, setWhich] = useState(count ? 0 : -1);
  const block = which >= 0 ? docLatexBlock(leaves, which) : undefined;
  const whole = useMemo(() => docWholeLatex(leaves), [leaves]);
  const base = which >= 0 ? (block?.text ?? EMPTY_LATEX_DOCUMENT) : whole;
  const [text, setText] = useState(base);
  const [problem, setProblem] = useState("");
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(base);
  }, [base]);
  const apply = useCallback(
    (next: string) => {
      setText(next);
      typed.current = true;
      if (next.length > DOC_LATEX_SOURCE_MAX) {
        setProblem(
          `This source is over the ${DOC_LATEX_SOURCE_MAX.toLocaleString()} character limit. Your draft stays here.`,
        );
        return;
      }
      try {
        const current = page.store.state.session?.document ?? document;
        const operation =
          which >= 0
            ? docLatexOperation(current, next, which)
            : docWholeLatexOperation(current, next);
        page.edit(operation);
        setProblem("");
      } catch (failure) {
        setProblem(
          messageOf(
            failure,
            "This LaTeX can't be saved to the note yet. Your draft stays here.",
          ),
        );
      }
    },
    [page, document, which],
  );
  useEffect(() => {
    typed.current = false;
  }, [which]);
  const exportPdf = async () => {
    if (!(await page.flush())) return;
    try {
      const blob = await client.compileDocLatex(page.id, {
        source: text,
        version: page.store.state.session?.saved.version ?? 0,
      });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.download = `${page.session?.title || "document"}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      report(messageOf(failure, "Couldn't update the PDF. Try again."));
    }
  };
  return (
    <>
      <div className="doc-pane-head small">
        <select
          className="input lib-select"
          aria-label="LaTeX source"
          value={which}
          onChange={(event) => setWhich(Number(event.currentTarget.value))}
        >
          <option value={-1}>Whole page</option>
          {Array.from({ length: count }, (_, index) => (
            <option key={index} value={index}>
              LaTeX note {index + 1}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          disabled={which < 0 && !docWholeLatexCanExport(leaves)}
          onClick={() => void exportPdf()}
        >
          Export PDF
        </Button>
      </div>
      {problem && (
        <p className="small doc-latex-error doc-pane-note" role="alert">
          {problem}
        </p>
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

function LatexResult({ page }: { page: Page }) {
  const leaves = page.leaves;
  const source = useMemo(() => docWholeLatex(leaves), [leaves]);
  return <LatexPreview source={source} fill />;
}

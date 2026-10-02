import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  Minus,
  Plus,
  Sparkles,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  CALLOUT_LABELS,
  colourCode,
  colourable,
  diagramKind,
  mermaidThemeVariables,
  mermaidDiagramCss,
  visibleDiagramTicks,
  diagramLabelTranslation,
  diagramDisplayScale,
  docObjectLinks,
  fileSize,
  isAudio,
  isPageImage,
  PAGE_FILE_TYPES,
  parseEmbed,
  parseFlowchart,
  parseTable,
  tableMarkdown,
  type CalloutKind,
  type DocBlock,
  type PageFile,
  type TableAlign,
  type TableCells,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { BlockView, Inline } from "./DocBlocks";
import { openObject, pillKey, shortDue, usePageActions } from "./DocLinks";

/**
 * The richer lines of a page on the web (D4b): callouts, tables, pictures
 * and files from Orbyn's own file store, footnotes, coloured code, Mermaid
 * diagrams and live embeds of another page's section or of the tasks the
 * page links to.
 */

// ------------------------------------------------------------- footnotes ---

/** The page's footnotes: each marker's number and each note's words. */
export const FootnoteContext = createContext<{
  numbers: Map<string, number>;
  texts: Map<string, string>;
}>({ numbers: new Map(), texts: new Map() });

/** A footnote marker in a line: its number, and its words on hover. */
export function FootnoteRef({
  label,
  start,
}: {
  label: string;
  start: number;
}) {
  const { numbers, texts } = useContext(FootnoteContext);
  const n = numbers.get(label) ?? label;
  const note = texts.get(label);
  return (
    <sup
      className="doc-fn-ref"
      data-src={start}
      data-note={note ?? "No footnote with this number yet"}
      aria-label={`Footnote ${n}${note ? `: ${note}` : ""}`}
    >
      {n}
    </sup>
  );
}

/** A footnote's words, as the page lists them. */
export function FootnoteLine({
  block,
}: {
  block: Extract<DocBlock, { type: "footnote" }>;
}) {
  const { numbers } = useContext(FootnoteContext);
  return (
    <div className="doc-footnote">
      <sup>{numbers.get(block.label) ?? block.label}</sup>
      <span>
        <Inline text={block.text} />
      </span>
    </div>
  );
}

// -------------------------------------------------------------- callouts ---

const CALLOUT_ICONS: Record<CalloutKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  question: CircleHelp,
  summary: ClipboardList,
};

/** A callout: a set-apart box with its kind's icon, tint and name. */
export function CalloutView({
  block,
}: {
  block: Extract<DocBlock, { type: "callout" }>;
}) {
  const [open, setOpen] = useState(!block.folded);
  const Icon = CALLOUT_ICONS[block.kind];
  return (
    <div className={`doc-callout is-${block.kind}${open ? "" : " is-folded"}`}>
      <Icon size={16} aria-hidden="true" className="doc-callout-icon" />
      <div className="doc-callout-body">
        <strong className="doc-callout-label">
          {CALLOUT_LABELS[block.kind]}
        </strong>{" "}
        <Inline text={block.text} />
      </div>
      {block.folded && (
        <button
          type="button"
          className="doc-callout-fold"
          aria-label={open ? "Fold" : "Unfold"}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tables ---

const ALIGNS: { value: TableAlign; icon: LucideIcon; label: string }[] = [
  { value: "left", icon: AlignLeft, label: "Align left" },
  { value: "center", icon: AlignCenter, label: "Centre" },
  { value: "right", icon: AlignRight, label: "Align right" },
];

/**
 * A table (EDT-02). Read, it is a plain table; editable, every cell is a
 * field: Tab and Shift+Tab move between cells (Tab past the last makes a
 * row), Enter goes down, and a bar over the table adds, moves and removes
 * rows and columns and sets a column's alignment.
 */
export function TableBlock({
  text,
  onChange,
}: {
  text: string;
  /** Left out when the table can't be changed here. */
  onChange?: (text: string) => void;
}) {
  const table = useMemo(() => parseTable(text), [text]);
  const [at, setAt] = useState<{ r: number; c: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const write = (next: TableCells, focus?: { r: number; c: number }) => {
    onChange?.(tableMarkdown(next));
    if (focus)
      requestAnimationFrame(() =>
        wrap.current
          ?.querySelector<HTMLInputElement>(
            `input[data-cell="${focus.r}:${focus.c}"]`,
          )
          ?.focus(),
      );
  };
  const rows = table.rows;
  const width = rows[0]?.length ?? 1;
  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row) => row.slice());
    next[r][c] = value;
    write({ rows: next, align: table.align });
  };
  const addRow = (after: number) => {
    const next = rows.map((row) => row.slice());
    next.splice(after + 1, 0, Array(width).fill(""));
    write({ rows: next, align: table.align }, { r: after + 1, c: 0 });
  };
  const addColumn = (after: number) => {
    const next = rows.map((row) => {
      const copy = row.slice();
      copy.splice(after + 1, 0, "");
      return copy;
    });
    const align = table.align.slice();
    align.splice(after + 1, 0, null);
    write({ rows: next, align }, { r: at?.r ?? 0, c: after + 1 });
  };
  const moveRow = (r: number, by: -1 | 1) => {
    const to = r + by;
    // The header stays the header.
    if (r === 0 || to < 1 || to >= rows.length) return;
    const next = rows.map((row) => row.slice());
    [next[r], next[to]] = [next[to], next[r]];
    write({ rows: next, align: table.align }, { r: to, c: at?.c ?? 0 });
  };
  const moveColumn = (c: number, by: -1 | 1) => {
    const to = c + by;
    if (to < 0 || to >= width) return;
    const swap = <T,>(list: T[]) => {
      const copy = list.slice();
      [copy[c], copy[to]] = [copy[to], copy[c]];
      return copy;
    };
    write(
      { rows: rows.map(swap), align: swap(table.align) },
      { r: at?.r ?? 0, c: to },
    );
  };
  const removeRow = (r: number) => {
    if (rows.length <= 1) return;
    const next = rows.filter((_, i) => i !== r);
    write(
      { rows: next, align: table.align },
      { r: Math.max(0, r - 1), c: at?.c ?? 0 },
    );
  };
  const removeColumn = (c: number) => {
    if (width <= 1) return;
    write(
      {
        rows: rows.map((row) => row.filter((_, i) => i !== c)),
        align: table.align.filter((_, i) => i !== c),
      },
      { r: at?.r ?? 0, c: Math.max(0, c - 1) },
    );
  };
  const setAlign = (c: number, a: TableAlign) => {
    const align = table.align.slice();
    align[c] = align[c] === a ? null : a;
    write({ rows, align });
  };
  const onKey = (
    e: ReactKeyboardEvent<HTMLInputElement>,
    r: number,
    c: number,
  ) => {
    const go = (nr: number, nc: number) =>
      wrap.current
        ?.querySelector<HTMLInputElement>(`input[data-cell="${nr}:${nc}"]`)
        ?.focus();
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const flat = r * width + c + (e.shiftKey ? -1 : 1);
      if (flat < 0) return;
      if (flat >= rows.length * width) return addRow(rows.length - 1);
      go(Math.floor(flat / width), flat % width);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (r + 1 < rows.length) go(r + 1, c);
      else addRow(r);
    } else if (e.key === "ArrowUp" && r > 0) {
      e.preventDefault();
      go(r - 1, c);
    } else if (e.key === "ArrowDown" && r + 1 < rows.length) {
      e.preventDefault();
      go(r + 1, c);
    }
  };
  const alignStyle = (c: number) =>
    table.align[c] ? { textAlign: table.align[c]! } : undefined;

  if (!onChange)
    return (
      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead>
            <tr>
              {rows[0].map((cell, c) => (
                <th key={c} style={alignStyle(c)}>
                  <Inline text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={alignStyle(c)}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div
      className="doc-table-edit"
      ref={wrap}
      // A click in a cell is a click in the table, not a request to open the
      // line's Markdown.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setAt(null);
      }}
    >
      {at && (
        <div className="doc-table-bar" role="toolbar" aria-label="Table">
          <span className="doc-table-bar-label">Row</span>
          <button
            type="button"
            className="icon-button"
            title="Move row up"
            aria-label="Move row up"
            disabled={at.r <= 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveRow(at.r, -1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move row down"
            aria-label="Move row down"
            disabled={at.r === 0 || at.r >= rows.length - 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveRow(at.r, 1)}
          >
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Add a row below"
            aria-label="Add a row below"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => addRow(at.r)}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Remove row"
            aria-label="Remove row"
            disabled={rows.length <= 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => removeRow(at.r)}
          >
            <Minus size={13} />
          </button>
          <span className="doc-selection-rule" aria-hidden="true" />
          <span className="doc-table-bar-label">Column</span>
          <button
            type="button"
            className="icon-button"
            title="Move column left"
            aria-label="Move column left"
            disabled={at.c === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveColumn(at.c, -1)}
          >
            <ArrowLeft size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move column right"
            aria-label="Move column right"
            disabled={at.c >= width - 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveColumn(at.c, 1)}
          >
            <ArrowRight size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Add a column to the right"
            aria-label="Add a column to the right"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => addColumn(at.c)}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Remove column"
            aria-label="Remove column"
            disabled={width <= 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => removeColumn(at.c)}
          >
            <Minus size={13} />
          </button>
          <span className="doc-selection-rule" aria-hidden="true" />
          {ALIGNS.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              className={
                "icon-button" + (table.align[at.c] === value ? " is-on" : "")
              }
              title={label}
              aria-label={label}
              aria-pressed={table.align[at.c] === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAlign(at.c, value)}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      )}
      <div className="doc-table-wrap is-editable">
        <table className="doc-table">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={r === 0 ? "is-head" : undefined}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={
                      at && (at.r === r || at.c === c) ? "is-near" : undefined
                    }
                  >
                    <input
                      data-cell={`${r}:${c}`}
                      value={cell}
                      style={alignStyle(c)}
                      aria-label={
                        r === 0
                          ? `Column ${c + 1} heading`
                          : `Row ${r}, column ${c + 1}`
                      }
                      placeholder={r === 0 ? "Heading" : ""}
                      onFocus={() => setAt({ r, c })}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onKeyDown={(e) => onKey(e, r, c)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-table-add">
        <button
          type="button"
          className="text-button"
          onClick={() => addRow(rows.length - 1)}
        >
          <Plus size={13} aria-hidden="true" /> Row
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => addColumn(width - 1)}
        >
          <Plus size={13} aria-hidden="true" /> Column
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------- pictures and files ---

type Link = { url: string; file: PageFile; until: number };
/** Links to show files, by id, kept until a little before they expire. */
const links = new Map<string, Link>();
const waiting = new Map<string, Promise<Link>>();

/** A short-lived link to show or download a file, fetched once and kept. */
export function fileLink(id: string): Promise<Link> {
  const kept = links.get(id);
  if (kept && kept.until > Date.now()) return Promise.resolve(kept);
  const running = waiting.get(id);
  if (running) return running;
  const made = client
    .pageFile(id)
    .then((l) => {
      const link = {
        url: client.urlFor(l.url_path),
        file: l.file,
        // Five minutes' grace before the link runs out.
        until: Date.parse(l.expires_at) - 5 * 60_000,
      };
      links.set(id, link);
      return link;
    })
    .finally(() => waiting.delete(id));
  waiting.set(id, made);
  return made;
}

/** A file's link when one is already at hand (for a copy, which can't wait). */
export const cachedFileUrl = (id: string): string | null => {
  const kept = links.get(id);
  return kept && kept.until > Date.now() ? kept.url : null;
};

/** A kept file's link, as a hook: null while it loads, "gone" when it can't. */
function useFileLink(id: string): Link | null | "gone" {
  const [link, setLink] = useState<Link | null | "gone">(
    () => links.get(id) ?? null,
  );
  useEffect(() => {
    let live = true;
    fileLink(id).then(
      (l) => live && setLink(l),
      () => live && setLink("gone"),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return link;
}

/** Download a kept file under its own name. */
export async function downloadFile(id: string) {
  const link = await fileLink(id);
  const a = document.createElement("a");
  a.href = `${link.url}?download=1`;
  a.download = link.file.name;
  a.rel = "noopener";
  a.click();
}

/**
 * A picture (EDT-01). Its width is a share of the page, changed by dragging
 * the handle on its right edge; clicking it opens the full-screen viewer.
 */
export function ImageBlock({
  block,
  onChange,
}: {
  block: Extract<DocBlock, { type: "image" }>;
  onChange?: (block: DocBlock) => void;
}) {
  const link = useFileLink(block.file);
  const [viewing, setViewing] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const figure = useRef<HTMLElement>(null);
  const [caption, setCaption] = useState(block.text);
  useEffect(() => setCaption(block.text), [block.text]);
  const width = dragWidth ?? block.width ?? 100;

  const startResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const page = figure.current?.parentElement?.getBoundingClientRect();
    const left = figure.current?.getBoundingClientRect().left ?? 0;
    if (!page) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let last = width;
    const move = (ev: PointerEvent) => {
      const w = ((ev.clientX - left) / page.width) * 100;
      last = Math.round(Math.max(10, Math.min(100, w)));
      setDragWidth(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setDragWidth(null);
      const { width: _old, ...rest } = block;
      onChange(last >= 100 ? rest : { ...rest, width: last });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  const resizeBy = (by: number) => {
    if (!onChange) return;
    const next = Math.max(10, Math.min(100, width + by));
    const { width: _old, ...rest } = block;
    onChange(next >= 100 ? rest : { ...rest, width: next });
  };

  return (
    <figure
      ref={figure}
      className={"doc-image" + (onChange ? " is-editable" : "")}
      style={{ width: `${width}%` }}
      onClick={(e) => e.stopPropagation()}
    >
      {link === "gone" ? (
        <div className="doc-image-missing">
          This picture isn't there any more.
        </div>
      ) : link ? (
        <button
          type="button"
          className="doc-image-open"
          aria-label={`View ${block.text || "picture"} full screen`}
          onClick={() => setViewing(true)}
          onKeyDown={(e) => {
            if (!onChange) return;
            // + and − resize a picture from the keyboard.
            if (e.key === "+" || e.key === "=") resizeBy(10);
            else if (e.key === "-") resizeBy(-10);
          }}
        >
          <img src={link.url} alt={block.text || "Picture"} loading="lazy" />
        </button>
      ) : (
        <div className="doc-image-loading" aria-label="Loading the picture" />
      )}
      {onChange && link && link !== "gone" && (
        <span
          className="doc-image-handle"
          role="separator"
          aria-label="Drag to resize"
          aria-valuenow={width}
          aria-valuemin={10}
          aria-valuemax={100}
          onPointerDown={startResize}
        />
      )}
      {onChange ? (
        <input
          className="doc-image-caption"
          value={caption}
          placeholder="Add a caption"
          aria-label="Caption"
          maxLength={300}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if (caption !== block.text) onChange({ ...block, text: caption });
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      ) : block.text ? (
        <figcaption className="doc-image-caption">{block.text}</figcaption>
      ) : null}
      {viewing && link && link !== "gone" && (
        <ImageViewer
          url={link.url}
          name={block.text || link.file.name}
          fileId={block.file}
          onClose={() => setViewing(false)}
        />
      )}
    </figure>
  );
}

/**
 * The full-screen viewer: the picture on a dark ground, zoomed with the
 * wheel, a pinch or + and −, dragged about when zoomed, closed with Escape
 * or a click outside it.
 */
function ImageViewer({
  url,
  name,
  fileId,
  onClose,
}: {
  url: string;
  name: string;
  fileId: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const closeRef = useRef<HTMLButtonElement>(null);
  const clamp = (z: number) => Math.max(1, Math.min(6, z));
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z * 1.25));
      else if (e.key === "-") setZoom((z) => clamp(z / 1.25));
      else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      was?.focus?.();
    };
  }, [onClose]);
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }, [zoom]);
  const drag = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (zoom === 1) return;
    e.preventDefault();
    const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return createPortal(
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={(e) => {
        e.preventDefault();
        setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      }}
    >
      <div className="image-viewer-bar">
        <span className="image-viewer-name">{name}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out (−)"
          onClick={() => setZoom((z) => clamp(z / 1.25))}
        >
          <ZoomOut size={16} />
        </button>
        <span className="image-viewer-zoom">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => setZoom((z) => clamp(z * 1.25))}
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Download"
          title="Download"
          onClick={() => void downloadFile(fileId)}
        >
          <Download size={16} />
        </button>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <img
        src={url}
        alt={name}
        className={zoom > 1 ? "is-zoomed" : undefined}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
        draggable={false}
        onPointerDown={drag}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
      />
    </div>,
    document.body,
  );
}

/**
 * What a page offers for its recordings (CAP-10): a summary from the
 * assistant. The editor provides it; a page shown elsewhere has none.
 */
export const RecordingContext = createContext<{
  summarise?: (fileId: string, name: string) => void;
}>({});

/** A file on a page: its name, kind and size, and a Download button. */
export function FileCard({
  block,
}: {
  block: Extract<DocBlock, { type: "file" }>;
}) {
  const link = useFileLink(block.file);
  const file = link && link !== "gone" ? link.file : null;
  const recording = useContext(RecordingContext);
  // A recording plays in the page, with Summarise beside it.
  if (link && link !== "gone" && file && isAudio(file.mime))
    return (
      <div className="doc-file doc-audio" onClick={(e) => e.stopPropagation()}>
        <span className="doc-file-text">
          <strong>{block.text || file.name}</strong>
          <small>{["Recording", fileSize(file.bytes)].join(" · ")}</small>
        </span>
        <audio controls preload="none" src={link.url}>
          <track kind="captions" />
        </audio>
        <span className="doc-audio-actions">
          {recording.summarise && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                recording.summarise?.(block.file, block.text || file.name)
              }
            >
              <Sparkles size={14} aria-hidden="true" /> Summarise
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => void downloadFile(block.file)}
          >
            <Download size={14} aria-hidden="true" /> Download
          </button>
        </span>
      </div>
    );
  return (
    <div className="doc-file" onClick={(e) => e.stopPropagation()}>
      <FileText size={18} aria-hidden="true" />
      <span className="doc-file-text">
        <strong>{block.text || file?.name || "File"}</strong>
        <small>
          {link === "gone"
            ? "This file isn't there any more"
            : file
              ? [
                  PAGE_FILE_TYPES[file.mime] ?? "File",
                  fileSize(file.bytes),
                  file.source === "import" ? "Original" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "…"}
        </small>
      </span>
      {link !== "gone" && (
        <button
          type="button"
          className="text-button"
          onClick={() => void downloadFile(block.file)}
        >
          <Download size={14} aria-hidden="true" /> Download
        </button>
      )}
    </div>
  );
}

/** Whether a file picked or dropped is drawn as a picture. */
export const isPicture = (f: File) =>
  isPageImage(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name);

/**
 * A photo scaled so its longest side is at most `max` pixels, as a JPEG, so
 * a phone's 12-megapixel picture doesn't fill someone's space. Pictures
 * already small enough, and GIFs, go as they are.
 */
export async function scaledPicture(
  file: File,
  max: number,
): Promise<{ blob: Blob; width: number; height: number; type: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That picture couldn't be read."));
      i.src = url;
    });
    const { naturalWidth: w, naturalHeight: h } = img;
    if (Math.max(w, h) <= max || file.type === "image/gif")
      return { blob: file, width: w, height: h, type: file.type };
    const scale = max / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't scale it."))),
        type,
        0.86,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height, type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ------------------------------------------------------------------ code ---

/** A code block, coloured for the languages students and teams write most. */
export function CodeView({ text, lang }: { text: string; lang: string }) {
  const tokens = useMemo(
    () => (colourable(lang) ? colourCode(text, lang) : null),
    [text, lang],
  );
  return (
    <pre className="doc-code" data-lang={lang || undefined}>
      <code>
        {tokens
          ? tokens.map((t, i) =>
              t.kind === "plain" ? (
                t.text
              ) : (
                <span key={i} className={`code-${t.kind}`}>
                  {t.text}
                </span>
              ),
            )
          : text}
      </code>
    </pre>
  );
}

// -------------------------------------------------------------- diagrams ---

type Mermaid = typeof import("mermaid").default;
let mermaidReady: Promise<Mermaid> | null = null;
let mermaidTheme = "";

/** The palette's own colours, for Mermaid to draw with. */
function paletteVars() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
  return mermaidThemeVariables({
    background: v("surface"),
    primaryColor: v("surface"),
    primaryBorderColor: v("accent"),
    primaryTextColor: v("text"),
    secondaryColor: v("soft"),
    tertiaryColor: v("surfaceMuted"),
    lineColor: v("muted"),
    textColor: v("text"),
    noteBkgColor: v("highBg"),
    noteTextColor: v("text"),
    highText: v("highText"),
    mediumText: v("mediumText"),
    lowText: v("lowText"),
  });
}

/** Mermaid, loaded the first time a page has a diagram. */
async function loadMermaid(): Promise<Mermaid> {
  mermaidReady ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidReady;
  // Set up again whenever the colours it reads change (the theme, or the
  // tokens themselves), not only when the theme's name does.
  const vars = paletteVars();
  const theme = JSON.stringify(vars);
  if (theme !== mermaidTheme) {
    mermaidTheme = theme;
    mermaid.initialize({
      startOnLoad: false,
      // No scripts or raw HTML from a diagram's text.
      securityLevel: "strict",
      theme: "base",
      themeVariables: vars,
      themeCSS: mermaidDiagramCss(vars),
      journey: {
        textPlacement: "tspan",
        sectionFills: [vars.secondaryColor],
        sectionColours: [vars.textColor],
      },
    });
  }
  return mermaid;
}

/**
 * A `mermaid` code block drawn as a diagram (EDT-11), lazily. Flowchart
 * nodes with `click A "orbyn://doc/…"` open what they link to. A diagram
 * that can't be drawn shows its source with a note.
 */
export function Diagram({ text }: { text: string }) {
  const id = useId().replace(/[^\w-]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [actualSize, setActualSize] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [viewport, setViewport] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const chart = useMemo(() => parseFlowchart(text), [text]);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setReady(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(`diagram-${id}`, text))
      .then(({ svg }) => {
        if (!live || !box.current) return;
        box.current.innerHTML = svg;
        const drawing = box.current.querySelector("svg");
        if (drawing) {
          const bounds = drawing.viewBox.baseVal;
          const scale = diagramDisplayScale(
            bounds.width,
            viewport || box.current.clientWidth,
            zoom,
            actualSize,
          );
          drawing.style.maxWidth = "none";
          drawing.style.width = `${bounds.width * scale}px`;
          drawing.style.height = `${bounds.height * scale}px`;
        }
        setReady(true);
        for (const node of box.current.querySelectorAll("svg .mindmap-node")) {
          const circle = [...node.children].find(
            (child) => child.tagName.toLowerCase() === "circle",
          );
          const label = node.querySelector<SVGGElement>("g.label");
          if (!circle || !label) continue;
          const transform = diagramLabelTranslation(label.getBBox(), {
            x: Number(circle.getAttribute("cx") || 0),
            y: Number(circle.getAttribute("cy") || 0),
          });
          if (transform) label.setAttribute("transform", transform);
        }
        for (const axis of box.current.querySelectorAll("svg g")) {
          const labels = [...axis.children]
            .filter((node) => node.classList.contains("tick"))
            .map((tick) => tick.querySelector("text"))
            .filter((label): label is SVGTextElement => !!label);
          if (labels.length < 2) continue;
          const visible = new Set(
            visibleDiagramTicks(
              labels.map((label) => label.getBoundingClientRect()),
            ),
          );
          labels.forEach((label, index) => {
            if (!visible.has(index)) label.setAttribute("visibility", "hidden");
          });
        }
        for (const node of chart?.nodes ?? []) {
          if (!node.link) continue;
          const link = node.link;
          box.current
            .querySelectorAll<SVGElement>(`[id*="flowchart-${node.id}-"]`)
            .forEach((el) => {
              el.style.cursor = "pointer";
              el.addEventListener("click", (e) => {
                e.stopPropagation();
                openObject(link, link.block);
              });
            });
        }
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        // Mermaid leaves its error drawing in the page; take it away.
        document.getElementById(`ddiagram-${id}`)?.remove();
      });
    return () => {
      live = false;
    };
  }, [text, id, chart, viewport, zoom, actualSize]);
  if (failed)
    return (
      <div className="doc-diagram is-failed">
        <p className="doc-diagram-note">
          This {diagramKind(text) === "unknown" ? "diagram" : diagramKind(text)}{" "}
          couldn't be drawn. Check its words:
        </p>
        <CodeView text={text} lang="" />
      </div>
    );
  return (
    <div className="doc-diagram" onClick={(event) => event.stopPropagation()}>
      <div className="doc-diagram-toolbar">
        <span>{diagramKind(text)} diagram</span>
        <button
          type="button"
          className="text-button"
          aria-expanded={sourceOpen}
          onClick={() => setSourceOpen(!sourceOpen)}
        >
          Source
        </button>
        <button
          type="button"
          className="text-button"
          aria-label="Zoom out diagram"
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
        >
          −
        </button>
        <button
          type="button"
          className="text-button"
          aria-label="Zoom in diagram"
          onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
        >
          +
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setActualSize(false);
            setZoom(1);
          }}
        >
          Fit
        </button>
        <button
          type="button"
          className="text-button"
          aria-pressed={actualSize}
          onClick={() => {
            setActualSize(true);
            setZoom(1);
          }}
        >
          Actual size
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!ready}
          onClick={() => {
            const drawing = box.current?.querySelector("svg");
            if (!drawing) return;
            const url = URL.createObjectURL(
              new Blob([new XMLSerializer().serializeToString(drawing)], {
                type: "image/svg+xml",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "diagram.svg";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export SVG
        </button>
      </div>
      <div
        className="doc-diagram-canvas"
        ref={box}
        role="img"
        aria-label={`Diagram: ${diagramKind(text)}`}
      />
      {!ready && <p className="doc-diagram-note">Drawing diagram…</p>}
      {sourceOpen && <CodeView text={text} lang="" />}
    </div>
  );
}

// ---------------------------------------------------------------- embeds ---

type Section = Awaited<ReturnType<typeof client.docSection>>;

/**
 * A live embed (LNK-08): another page's section, read-only and kept up to
 * date as that page changes, with Open to change it at its source; or the
 * tasks this page links to, with working ticks.
 */
export function EmbedBlock({
  text,
  pageBlocks,
}: {
  text: string;
  /** The page it sits on, for "the tasks this page links to". */
  pageBlocks: DocBlock[];
}) {
  const spec = useMemo(() => parseEmbed(text), [text]);
  if (!spec)
    return (
      <div className="doc-embed is-broken">
        This embed doesn't say what to show.
      </div>
    );
  if (spec.kind === "tasks") return <LinkedTasks blocks={pageBlocks} />;
  return <SectionEmbed doc={spec.doc} block={spec.block} />;
}

function SectionEmbed({ doc, block }: { doc: string; block: string | null }) {
  const [section, setSection] = useState<Section | null | "gone">(null);
  const load = useCallback(
    () =>
      client.docSection(doc, block).then(setSection, () => setSection("gone")),
    [doc, block],
  );
  useEffect(() => {
    void load();
    // Kept up to date as the page it comes from changes.
    return client.watchDoc(doc, () => void load());
  }, [load, doc]);
  if (section === "gone")
    return (
      <div className="doc-embed is-broken">
        The page this showed isn't there, or isn't yours to open.
      </div>
    );
  if (!section) return <div className="doc-embed is-loading" />;
  const numbers = new Map<string, number>();
  const texts = new Map<string, string>();
  return (
    <div className="doc-embed" onClick={(e) => e.stopPropagation()}>
      <div className="doc-embed-head">
        <FileText size={14} aria-hidden="true" />
        <span>
          {section.title}
          {section.block_id && section.blocks[0]?.type === "heading"
            ? ` › ${section.blocks[0].text}`
            : ""}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            openObject({ kind: "doc", id: section.doc_id }, section.block_id)
          }
        >
          <ExternalLink size={13} aria-hidden="true" /> Open
        </button>
      </div>
      {section.missing ? (
        <p className="doc-embed-note">
          The part of the page this showed has gone.
        </p>
      ) : (
        <FootnoteContext.Provider value={{ numbers, texts }}>
          <div className="doc-embed-body">
            {section.blocks.map((b, i) => (
              <BlockView key={b.id ?? i} block={b} />
            ))}
          </div>
        </FootnoteContext.Provider>
      )}
      {section.more && (
        <p className="doc-embed-note">Open the page to read the rest.</p>
      )}
    </div>
  );
}

/** The tasks a page links to, with their ticks and deadlines. */
function LinkedTasks({ blocks }: { blocks: DocBlock[] }) {
  const { pills, onToggle } = usePageActions();
  const refs = useMemo(() => {
    const seen = new Set<string>();
    return docObjectLinks(blocks)
      .map((l) => l.ref)
      .filter((r) => {
        if (r.kind !== "task" || seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
  }, [blocks]);
  return (
    <div className="doc-embed" onClick={(e) => e.stopPropagation()}>
      <div className="doc-embed-head">
        <ClipboardList size={14} aria-hidden="true" />
        <span>Tasks linked from this page</span>
      </div>
      {!refs.length ? (
        <p className="doc-embed-note">
          Link tasks in this page with [[ and they're listed here.
        </p>
      ) : (
        <ul className="doc-embed-tasks">
          {refs.map((r) => {
            const pill = pills.get(pillKey(r));
            if (pill && pill.state !== "ok") return null;
            const done = !!pill?.done;
            return (
              <li key={r.id}>
                <input
                  type="checkbox"
                  className="doc-check"
                  checked={done}
                  disabled={!onToggle || !pill}
                  aria-label={pill?.title ?? "Task"}
                  onChange={() => onToggle?.(r.id, !done)}
                />
                <button
                  type="button"
                  className={"doc-embed-task" + (done ? " is-done" : "")}
                  onClick={() => openObject(r)}
                >
                  {pill?.title ?? "…"}
                </button>
                {pill?.due_at && !done && (
                  <small className="link-pill-due">
                    {shortDue(pill.due_at)}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

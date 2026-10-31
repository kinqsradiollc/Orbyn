import {
  CALLOUT_LABELS,
  colourable,
  colourCode,
  docCodeLabel,
  docObjectLinks,
  docReferenceMap,
  DOC_LATEX_LANGUAGE,
  EMBED_LANG,
  fileSize,
  FRONTMATTER_LANG,
  LIVE_LIST_LANG,
  mermaidDiagramCss,
  mermaidThemeVariables,
  MERMAID_MAX_SOURCE,
  parseEmbed,
  parseFlowchart,
  parseTable,
  prepareMermaidSource,
  renderBoundedMermaid,
  tableMarkdown,
  type DocBlock,
  type PageFile,
  type TableAlign,
  type TableCells,
} from "@orbyn/core";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { watchPage } from "../streams";
import { Button, Dialog, IconButton, useToast } from "../../../ui/kit";
import { FootnoteContext, PageContext, pillKey } from "./context";
import { Inline, Math as Formula } from "./Inline";
import { LatexNote } from "./Latex";
import { LiveList } from "./LiveList";
import type { Mark } from "./marks";

const BULLETS = ["•", "◦", "▪", "•"];

export type BlockProps = {
  block: DocBlock;
  marks?: Mark[];
  number?: number | null;
  depth?: number;
  isTask?: boolean;
  onToggleTodo?: () => void;
  onReplace?: (block: DocBlock) => void;
  pageBlocks?: DocBlock[];
};

export function BlockView({
  block,
  marks = [],
  number,
  depth = 0,
  isTask,
  onToggleTodo,
  onReplace,
  pageBlocks = [],
}: BlockProps) {
  const nest = depth ? ({ "--depth": depth } as CSSProperties) : undefined;
  switch (block.type) {
    case "heading": {
      const Tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[
        block.level - 1
      ];
      return (
        <Tag className={`doc-heading doc-h${block.level}`} dir="auto">
          <Inline text={block.text} marks={marks} />
        </Tag>
      );
    }
    case "bullet":
    case "numbered":
      return (
        <div className="doc-li" style={nest}>
          <span
            className={`doc-marker${block.type === "numbered" ? " is-number" : ""}`}
            aria-hidden="true"
          >
            {block.type === "numbered"
              ? `${number ?? block.start ?? 1}.`
              : BULLETS[depth % BULLETS.length]}
          </span>
          <span dir="auto" className="doc-li-body">
            <Inline text={block.text} marks={marks} />
          </span>
        </div>
      );
    case "todo":
      return (
        <div className="doc-li" style={nest}>
          <input
            type="checkbox"
            className="doc-check"
            checked={block.done}
            disabled={!onToggleTodo}
            onChange={onToggleTodo}
            onClick={(event) => event.stopPropagation()}
            aria-label={block.text || "Checklist item"}
          />
          <span
            dir="auto"
            className={`doc-li-body${block.done ? " doc-done" : ""}`}
          >
            <Inline text={block.text} marks={marks} />
            {isTask && (
              <span
                className="doc-linked"
                title="This is a task in your planner"
              >
                task
              </span>
            )}
          </span>
        </div>
      );
    case "quote":
      return (
        <blockquote className="doc-quote" dir="auto">
          <Inline text={block.text} marks={marks} />
        </blockquote>
      );
    case "code":
      if (block.lang === DOC_LATEX_LANGUAGE) return <LatexNote block={block} />;
      if (block.lang === LIVE_LIST_LANG)
        return (
          <LiveList
            text={block.text}
            onChange={
              onReplace ? (text) => onReplace({ ...block, text }) : undefined
            }
          />
        );
      if (block.lang === EMBED_LANG)
        return <Embed text={block.text} pageBlocks={pageBlocks} />;
      if (block.lang === "mermaid") return <Diagram text={block.text} />;
      return <CodeView text={block.text} lang={block.lang} />;
    case "callout":
      return (
        <div className={`doc-callout is-${block.kind}`} dir="auto">
          <strong className="small">{CALLOUT_LABELS[block.kind]}</strong>
          <div>
            <Inline text={block.text} />
          </div>
        </div>
      );
    case "table":
      return (
        <TableView
          text={block.text}
          onChange={
            onReplace ? (text) => onReplace({ ...block, text }) : undefined
          }
        />
      );
    case "image":
      return <ImageView block={block} onChange={onReplace} />;
    case "file":
      return <FileCard block={block} />;
    case "footnote":
      return <Footnote block={block} />;
    case "math":
      return (
        <div className="doc-math">
          <Formula latex={block.text} display />
          {block.check && (
            <span
              className="doc-math-check small"
              title="Read from an imported file, where this equation's layout was a guess. Edit it to confirm."
            >
              Check
            </span>
          )}
        </div>
      );
    case "divider":
      return <hr className="doc-divider" />;
    default:
      return (
        <p className="doc-p" dir="auto">
          {block.text ? <Inline text={block.text} marks={marks} /> : <br />}
        </p>
      );
  }
}

function Footnote({
  block,
}: {
  block: Extract<DocBlock, { type: "footnote" }>;
}) {
  const { numbers } = useContext(FootnoteContext);
  return (
    <div className="doc-footnote small" id={`fn-${block.label}`} dir="auto">
      <span className="muted">{numbers.get(block.label) ?? block.label}.</span>{" "}
      <Inline text={block.text} />
    </div>
  );
}

export function CodeView({ text, lang }: { text: string; lang: string }) {
  const metadata = lang === FRONTMATTER_LANG;
  const [open, setOpen] = useState(!metadata);
  const [plain, setPlain] = useState(false);
  const [message, setMessage] = useState("");
  const coloured = colourable(lang);
  const tokens = useMemo(
    () => (coloured && !plain ? colourCode(text, lang) : null),
    [text, lang, coloured, plain],
  );
  return (
    <div className="doc-codeblock" onClick={(event) => event.stopPropagation()}>
      <div className="doc-code-bar small">
        <span className="muted">{docCodeLabel(lang)}</span>
        <span className="doc-code-actions">
          {message && (
            <span role="status" className="muted">
              {message}
            </span>
          )}
          {metadata ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide source" : "View source"}
            </button>
          ) : coloured ? (
            <button
              type="button"
              aria-pressed={plain}
              onClick={() => setPlain(!plain)}
            >
              {plain ? "Highlight" : "Source"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => setMessage("Copied"),
                () =>
                  setMessage("Couldn't copy. Select the source to copy it."),
              )
            }
          >
            Copy
          </button>
        </span>
      </div>
      {open && (
        <pre
          tabIndex={0}
          aria-label={metadata ? "YAML metadata source" : "Code source"}
        >
          <code>
            {tokens
              ? tokens.map((token, index) =>
                  token.kind === "plain" ? (
                    token.text
                  ) : (
                    <span key={index} className={`code-${token.kind}`}>
                      {token.text}
                    </span>
                  ),
                )
              : text}
          </code>
        </pre>
      )}
    </div>
  );
}

type Mermaid = typeof import("mermaid").default;
let mermaidLoad: Promise<Mermaid> | null = null;
let mermaidTheme = "";

function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return mermaidThemeVariables({
    background: read("surface"),
    primaryColor: read("surface"),
    primaryBorderColor: read("accent"),
    primaryTextColor: read("text"),
    secondaryColor: read("accent-soft"),
    tertiaryColor: read("sunken"),
    lineColor: read("text-muted"),
    textColor: read("text"),
    noteBkgColor: read("warn-soft"),
    noteTextColor: read("text"),
    highText: read("danger"),
    mediumText: read("warn"),
    lowText: read("ok"),
  });
}

async function loadMermaid() {
  mermaidLoad ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidLoad;
  const theme = JSON.stringify(palette());
  if (theme !== mermaidTheme) {
    mermaidTheme = theme;
    const vars = palette();
    const config = {
      startOnLoad: false,
      securityLevel: "strict" as const,
      theme: "base" as const,
      themeVariables: vars,
      themeCSS: mermaidDiagramCss(vars),
      suppressErrorRendering: true,
      fontFamily: "system-ui, sans-serif",
      maxTextSize: MERMAID_MAX_SOURCE,
      maxEdges: 512,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      secure: [] as string[],
    };
    config.secure = Object.keys(config);
    mermaid.initialize(config);
  }
  return mermaid;
}

export function Diagram({ text }: { text: string }) {
  const page = useContext(PageContext);
  const id = useId().replace(/[^\w-]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setReady(false);
    loadMermaid()
      .then((mermaid) => renderBoundedMermaid(mermaid, `diagram-${id}`, text))
      .then((svg) => {
        if (!live || !box.current) return;
        box.current.innerHTML = svg;
        setReady(true);
        let chart = null;
        try {
          chart = parseFlowchart(prepareMermaidSource(text));
        } catch {
          // Only flowcharts carry links; anything else draws without them.
        }
        for (const node of chart?.nodes ?? []) {
          if (!node.link) continue;
          const link = node.link;
          box.current
            .querySelectorAll<SVGElement>(`[id*="flowchart-${node.id}-"]`)
            .forEach((element) => {
              element.style.cursor = "pointer";
              element.addEventListener("click", (event) => {
                event.stopPropagation();
                page?.onOpen(
                  `orbyn://${link.kind === "event" ? "task" : link.kind}/${link.id}${link.block ? `#${link.block}` : ""}`,
                );
              });
            });
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [text, id, page]);
  if (failed)
    return (
      <div className="doc-diagram-failed">
        <p className="small muted">
          This diagram couldn't be drawn. Its source is below.
        </p>
        <CodeView text={text} lang="mermaid" />
      </div>
    );
  return (
    <figure
      className="doc-diagram"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={box}
        className="doc-diagram-art"
        style={{ "--zoom": zoom } as CSSProperties}
        aria-label="Diagram"
        role="img"
      />
      {ready && (
        <div className="doc-diagram-tools small">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </figure>
  );
}

function TableView({
  text,
  onChange,
}: {
  text: string;
  onChange?: (text: string) => void;
}) {
  const table = useMemo(() => parseTable(text), [text]);
  const wrap = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ r: number; c: number } | null>(null);
  const rows = table.rows;
  const width = rows[0]?.length ?? 1;
  const focus = (r: number, c: number) =>
    requestAnimationFrame(() =>
      wrap.current
        ?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`)
        ?.focus(),
    );
  const write = (next: TableCells, then?: { r: number; c: number }) => {
    onChange?.(tableMarkdown(next));
    if (then) focus(then.r, then.c);
  };
  const copy = () => rows.map((row) => row.slice());
  const align = (c: number, value: TableAlign) => {
    const next = table.align.slice();
    next[c] = next[c] === value ? null : value;
    write({ rows, align: next });
  };
  const addRow = (after: number) => {
    const next = copy();
    next.splice(after + 1, 0, Array(width).fill(""));
    write({ rows: next, align: table.align }, { r: after + 1, c: 0 });
  };
  const addColumn = (after: number) => {
    const next = copy().map((row) => {
      row.splice(after + 1, 0, "");
      return row;
    });
    const aligned = table.align.slice();
    aligned.splice(after + 1, 0, null);
    write({ rows: next, align: aligned }, { r: at?.r ?? 0, c: after + 1 });
  };
  const moveRow = (r: number, by: -1 | 1) => {
    const to = r + by;
    if (r === 0 || to < 1 || to >= rows.length) return;
    const next = copy();
    [next[r], next[to]] = [next[to], next[r]];
    write({ rows: next, align: table.align }, { r: to, c: at?.c ?? 0 });
  };
  const moveColumn = (c: number, by: -1 | 1) => {
    const to = c + by;
    if (to < 0 || to >= width) return;
    const swap = <T,>(list: T[]) => {
      const out = list.slice();
      [out[c], out[to]] = [out[to], out[c]];
      return out;
    };
    write(
      { rows: rows.map(swap), align: swap(table.align) },
      { r: at?.r ?? 0, c: to },
    );
  };
  const removeRow = (r: number) => {
    if (rows.length <= 1) return;
    write(
      { rows: rows.filter((_, i) => i !== r), align: table.align },
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
  return (
    <div
      ref={wrap}
      className="doc-table-wrap"
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setAt(null);
      }}
    >
      {onChange && at && (
        <div
          className="doc-table-tools"
          role="toolbar"
          aria-label="Table tools"
          onMouseDown={(event) => event.preventDefault()}
        >
          <IconButton
            label="Align left"
            aria-pressed={table.align[at.c] === "left"}
            onClick={() => align(at.c, "left")}
          >
            <AlignLeft />
          </IconButton>
          <IconButton
            label="Align center"
            aria-pressed={table.align[at.c] === "center"}
            onClick={() => align(at.c, "center")}
          >
            <AlignCenter />
          </IconButton>
          <IconButton
            label="Align right"
            aria-pressed={table.align[at.c] === "right"}
            onClick={() => align(at.c, "right")}
          >
            <AlignRight />
          </IconButton>
          <IconButton
            label="Column left"
            disabled={at.c === 0}
            onClick={() => moveColumn(at.c, -1)}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            label="Column right"
            disabled={at.c >= width - 1}
            onClick={() => moveColumn(at.c, 1)}
          >
            <ChevronRight />
          </IconButton>
          <IconButton
            label="Row up"
            disabled={at.r < 2}
            onClick={() => moveRow(at.r, -1)}
          >
            <ChevronUp />
          </IconButton>
          <IconButton
            label="Row down"
            disabled={at.r < 1 || at.r >= rows.length - 1}
            onClick={() => moveRow(at.r, 1)}
          >
            <ChevronDown />
          </IconButton>
          <Button variant="ghost" onClick={() => addRow(at.r)}>
            <Plus /> Row
          </Button>
          <Button variant="ghost" onClick={() => addColumn(at.c)}>
            <Plus /> Column
          </Button>
          <IconButton
            label="Delete row"
            disabled={rows.length <= 1}
            onClick={() => removeRow(at.r)}
          >
            <Trash2 />
          </IconButton>
          <Button
            variant="ghost"
            disabled={width <= 1}
            onClick={() => removeColumn(at.c)}
          >
            Delete column
          </Button>
        </div>
      )}
      <div
        className="doc-table-scroll"
        tabIndex={0}
        role="group"
        aria-label="Table"
      >
        <table className="doc-table">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} data-head={r === 0 || undefined}>
                {row.map((cell, c) => {
                  const Cell = r === 0 ? "th" : "td";
                  const style = { textAlign: table.align[c] ?? undefined };
                  return (
                    <Cell key={c} style={style}>
                      {onChange ? (
                        <input
                          data-cell={`${r}:${c}`}
                          aria-label={`Row ${r + 1}, column ${c + 1}`}
                          value={cell}
                          dir="auto"
                          onFocus={() => setAt({ r, c })}
                          onChange={(event) => {
                            const next = copy();
                            next[r][c] = event.currentTarget.value;
                            write({ rows: next, align: table.align });
                          }}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Tab") {
                              const flat =
                                r * width + c + (event.shiftKey ? -1 : 1);
                              if (flat < 0) return;
                              event.preventDefault();
                              if (flat >= rows.length * width) addRow(r);
                              else
                                focus(Math.floor(flat / width), flat % width);
                            } else if (event.key === "Enter") {
                              event.preventDefault();
                              if (r === rows.length - 1) addRow(r);
                              else focus(r + 1, c);
                            } else if (
                              event.key === "ArrowDown" &&
                              r < rows.length - 1
                            )
                              focus(r + 1, c);
                            else if (event.key === "ArrowUp" && r > 0)
                              focus(r - 1, c);
                          }}
                        />
                      ) : (
                        <span dir="auto">
                          <Inline text={cell} />
                        </span>
                      )}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type FileLink = { url: string; file: PageFile; until: number };
const links = new Map<string, FileLink>();
const waiting = new Map<string, Promise<FileLink>>();

export function fileLink(id: string) {
  const kept = links.get(id);
  if (kept && kept.until > Date.now()) return Promise.resolve(kept);
  const running = waiting.get(id);
  if (running) return running;
  const made = client
    .pageFile(id)
    .then((link) => {
      const next = {
        url: client.urlFor(link.url_path),
        file: link.file,
        until: Date.parse(link.expires_at) - 5 * 60_000,
      };
      links.set(id, next);
      return next;
    })
    .finally(() => waiting.delete(id));
  waiting.set(id, made);
  return made;
}

function useFileLink(id: string, attempt: number) {
  const [link, setLink] = useState<FileLink | "gone" | null>(null);
  useEffect(() => {
    let live = true;
    setLink(null);
    fileLink(id).then(
      (next) => live && setLink(next),
      () => live && setLink("gone"),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);
  return link;
}

function ImageView({
  block,
  onChange,
}: {
  block: Extract<DocBlock, { type: "image" }>;
  onChange?: (block: DocBlock) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const link = useFileLink(block.file, attempt);
  const [viewing, setViewing] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const figure = useRef<HTMLElement>(null);
  const [caption, setCaption] = useState(block.text);
  useEffect(() => setCaption(block.text), [block.text]);
  const width = drag ?? block.width ?? 100;
  const setWidth = (next: number) => {
    const { width: _old, ...rest } = block;
    onChange?.(next >= 100 ? rest : { ...rest, width: next });
  };
  return (
    <figure
      ref={figure}
      className="doc-image"
      style={{ width: `${width}%` }}
      onClick={(event) => event.stopPropagation()}
    >
      {link === null ? (
        <div
          className="doc-image-hold"
          role="status"
          aria-label="Loading picture"
        />
      ) : link === "gone" ? (
        <div className="doc-image-hold">
          <span className="small muted">This picture couldn't be loaded.</span>
          <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="doc-image-open"
          aria-label={
            block.text ? `View picture: ${block.text}` : "View picture"
          }
          onClick={() => setViewing(true)}
        >
          <img src={link.url} alt={block.text} draggable={false} />
        </button>
      )}
      {onChange && (
        <span
          className="doc-image-handle"
          role="slider"
          tabIndex={0}
          aria-label="Picture width"
          aria-valuemin={10}
          aria-valuemax={100}
          aria-valuenow={width}
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight"
                ? 5
                : event.key === "ArrowLeft"
                  ? -5
                  : 0;
            if (!step) return;
            event.preventDefault();
            setWidth(Math.max(10, Math.min(100, width + step)));
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            const page = figure.current?.parentElement?.getBoundingClientRect();
            const left = figure.current?.getBoundingClientRect().left ?? 0;
            if (!page) return;
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);
            let last = width;
            const move = (next: PointerEvent) => {
              last = Math.round(
                Math.max(
                  10,
                  Math.min(100, ((next.clientX - left) / page.width) * 100),
                ),
              );
              setDrag(last);
            };
            const up = () => {
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", up);
              setDrag(null);
              setWidth(last);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", up);
          }}
        />
      )}
      {onChange ? (
        <input
          className="doc-caption small"
          value={caption}
          dir="auto"
          placeholder="Add a caption"
          aria-label="Picture caption"
          onChange={(event) => setCaption(event.currentTarget.value)}
          onBlur={() => {
            if (caption !== block.text) onChange({ ...block, text: caption });
          }}
        />
      ) : (
        block.text && (
          <figcaption className="small muted" dir="auto">
            {block.text}
          </figcaption>
        )
      )}
      {viewing && link && link !== "gone" && (
        <Dialog
          title={block.text || "Picture"}
          wide
          onClose={() => setViewing(false)}
        >
          <img className="doc-image-full" src={link.url} alt={block.text} />
        </Dialog>
      )}
    </figure>
  );
}

function FileCard({ block }: { block: Extract<DocBlock, { type: "file" }> }) {
  const page = useContext(PageContext);
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const link = useFileLink(block.file, attempt);
  const file = link && link !== "gone" ? link.file : null;
  return (
    <div className="doc-file" onClick={(event) => event.stopPropagation()}>
      <FileText aria-hidden="true" />
      <div className="row-main">
        <div className="row-title" dir="auto">
          {block.text}
        </div>
        <div className="small muted">
          {link === "gone"
            ? "This file can't be opened."
            : file
              ? fileSize(file.bytes)
              : "…"}
        </div>
      </div>
      {link === "gone" ? (
        <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      ) : (
        <>
          {page?.onSummarise && file?.mime.startsWith("audio/") && (
            <Button
              variant="ghost"
              onClick={() => page.onSummarise?.(block.file, block.text)}
            >
              Summarise
            </Button>
          )}
          <IconButton
            label={`Download ${block.text}`}
            disabled={!file}
            onClick={() =>
              void fileLink(block.file).then(
                (next) => {
                  const a = document.createElement("a");
                  a.href = next.url;
                  a.download = block.text;
                  a.click();
                },
                (failure) =>
                  toast({
                    text: messageOf(failure, "Couldn't download this file."),
                    error: true,
                  }),
              )
            }
          >
            <Download />
          </IconButton>
        </>
      )}
    </div>
  );
}

function Embed({ text, pageBlocks }: { text: string; pageBlocks: DocBlock[] }) {
  const spec = useMemo(() => parseEmbed(text), [text]);
  if (!spec)
    return (
      <div className="doc-embed muted">
        This embed doesn't say what to show.
      </div>
    );
  if (spec.kind === "tasks") return <LinkedTasks blocks={pageBlocks} />;
  return <SectionEmbed doc={spec.doc} block={spec.block} />;
}

type Section = Awaited<ReturnType<typeof client.docSection>>;

function SectionEmbed({ doc, block }: { doc: string; block: string | null }) {
  const page = useContext(PageContext);
  const request = useRef(0);
  const [failed, setFailed] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const load = useCallback(async () => {
    const id = ++request.current;
    setFailed(false);
    try {
      const next = await client.docSection(doc, block);
      if (id === request.current) setSection(next);
    } catch {
      if (id === request.current) setFailed(true);
    }
  }, [doc, block]);
  useEffect(() => {
    setSection(null);
    void load();
    const stop = watchPage(doc, () => void load());
    return () => {
      request.current++;
      stop();
    };
  }, [load, doc]);
  const retry: ReactNode = failed && (
    <span className="small">
      Couldn't load this section.{" "}
      <button
        type="button"
        className="doc-textlink"
        onClick={() => void load()}
      >
        Try again
      </button>
    </span>
  );
  if (!section)
    return (
      <div className="doc-embed" role={failed ? "alert" : "status"}>
        {retry || <span className="small muted">Loading section…</span>}
      </div>
    );
  return (
    <div className="doc-embed" onClick={(event) => event.stopPropagation()}>
      {retry}
      <div className="doc-embed-head small">
        <FileText aria-hidden="true" />
        <span className="row-main" dir="auto">
          {section.title}
          {section.block_id && section.blocks[0]?.type === "heading"
            ? ` › ${section.blocks[0].text}`
            : ""}
        </span>
        <button
          type="button"
          className="doc-textlink"
          onClick={() =>
            page?.onOpen(
              `orbyn://doc/${section.doc_id}${section.block_id ? `#${section.block_id}` : ""}`,
            )
          }
        >
          <ExternalLink aria-hidden="true" /> Open
        </button>
      </div>
      {section.missing ? (
        <p className="small muted">
          The part of the page this showed has gone.
        </p>
      ) : (
        <FootnoteContext.Provider
          value={{
            numbers: new Map(),
            texts: new Map(),
            references: section.references
              ? docReferenceMap(section.references)
              : undefined,
          }}
        >
          {section.blocks.map((one, index) => (
            <BlockView key={one.id ?? index} block={one} />
          ))}
        </FootnoteContext.Provider>
      )}
      {section.more && (
        <p className="small muted">Open the page to read the rest.</p>
      )}
    </div>
  );
}

function LinkedTasks({ blocks }: { blocks: DocBlock[] }) {
  const page = useContext(PageContext);
  const refs = useMemo(() => {
    const seen = new Set<string>();
    return docObjectLinks(blocks)
      .map((link) => link.ref)
      .filter((ref) => {
        if (ref.kind !== "task" || seen.has(ref.id)) return false;
        seen.add(ref.id);
        return true;
      });
  }, [blocks]);
  return (
    <div className="doc-embed" onClick={(event) => event.stopPropagation()}>
      <div className="doc-embed-head small">
        <span>Tasks linked from this page</span>
      </div>
      {!refs.length ? (
        <p className="small muted">
          Link tasks in this page with [[ and they're listed here.
        </p>
      ) : (
        <ul className="doc-embed-tasks">
          {refs.map((ref) => {
            const pill = page?.pills.get(pillKey(ref));
            if (pill && pill.state !== "ok") return null;
            const done = !!pill?.done;
            return (
              <li key={ref.id}>
                <input
                  type="checkbox"
                  className="doc-check"
                  checked={done}
                  disabled={!page?.onToggleTask || !pill}
                  aria-label={pill?.title ?? "Task"}
                  onChange={() => page?.onToggleTask?.(ref.id, !done)}
                />
                <button
                  type="button"
                  className={`doc-textlink${done ? " doc-done" : ""}`}
                  onClick={() => page?.onOpen(`orbyn://task/${ref.id}`)}
                >
                  {pill?.title ?? "…"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { useContext, type CSSProperties, type ReactNode } from "react";
import {
  mentionedPerson,
  docLinkDestination,
  EMBED_LANG,
  isDiagram,
  LIVE_LIST_LANG,
  parseDocInline,
  parseObjectHref,
  tagRuns,
  type DocBlock,
  type DocInline,
  type TaggedRun,
} from "@orbyn/core";
import { Math } from "./Math";
import { LinkPillView } from "./DocLinks";
import { LiveList } from "../views/LiveList";
import { cut, touches, type Mark } from "./marks";
import { DocNavigationContext } from "./doc-navigation";
import { webOrigin } from "../../lib/links";
import { OPEN_LINK_EVENT } from "./DocLinks";
import {
  CalloutView,
  CodeView,
  Diagram,
  EmbedBlock,
  FileCard,
  FootnoteLine,
  FootnoteRef,
  ImageBlock,
  TableBlock,
} from "./RichBlocks";

/**
 * The pieces of one run, each in its own span.
 *
 * Every span says where its text starts in the Markdown source, which is what
 * lets a selection made on the page be read back as a character range without
 * measuring anything.
 */
function Pieces({ run, marks }: { run: DocInline; marks: Mark[] }) {
  return (
    <>
      {cut(run, marks).map((piece, i) => (
        <span
          key={i}
          data-src={piece.start}
          className={
            piece.depth
              ? "doc-mark" +
                (piece.depth > 1 ? " is-deep" : "") +
                (piece.active ? " is-active" : "") +
                (piece.proposed ? " is-proposed" : "")
              : undefined
          }
        >
          {piece.text}
        </span>
      ))}
    </>
  );
}

/**
 * One line of text with its inline styling, links and maths applied.
 *
 * `marks` are the stretches carrying remarks, as character ranges into the
 * line's source. Plain text is cut where they begin and end so the shading
 * covers exactly the words; maths and code are shaded whole, because there is
 * no meaningful half of either.
 */
export function Inline({ text, marks = [] }: { text: string; marks?: Mark[] }) {
  const navigation = useContext(DocNavigationContext);
  // A #tag stands apart from the words around it, drawn as a quiet chip.
  const runs: TaggedRun[] = parseDocInline(text).flatMap((run) =>
    tagRuns(run, text),
  );
  return (
    <>
      {runs.map((run, i) => {
        const lit = touches(run, marks);
        const shade = (inner: ReactNode) =>
          lit ? (
            <span
              className={
                "doc-mark" +
                (marks.some((m) => m.active && m.end > run.start)
                  ? " is-active"
                  : "")
              }
            >
              {inner}
            </span>
          ) : (
            inner
          );
        if (run.math)
          return (
            <span key={i} data-src={run.start}>
              {shade(<Math latex={run.text} />)}
            </span>
          );
        if (run.code)
          return (
            <code key={i} data-src={run.start}>
              {shade(run.text)}
            </code>
          );
        if (run.footnote)
          return <FootnoteRef key={i} label={run.footnote} start={run.start} />;
        // Where the line came from (`[src: …]`): a small quiet chip.
        if (run.source)
          return (
            <span
              key={i}
              data-src={run.start}
              className="doc-inline-source"
              title={`Source: ${run.text}`}
            >
              {shade(run.text)}
            </span>
          );
        // A mention of someone who can open the page: a quiet pill, not a
        // link to follow.
        if (run.link && mentionedPerson(run.link))
          return (
            <span
              key={i}
              data-src={run.start}
              className="doc-mention"
              title={`Mentioned: ${run.text.replace(/^@/, "")}`}
            >
              {shade(run.text)}
            </span>
          );
        // A link made with the picker reads as a pill with the thing's
        // live title, and opens it in the app rather than the browser.
        if (run.link && parseObjectHref(run.link))
          return (
            <LinkPillView
              key={i}
              href={run.link}
              label={run.text}
              start={run.start}
            />
          );
        if (run.link) {
          const destination = docLinkDestination(run.link, webOrigin());
          if (!destination) return <span key={i}>{shade(run.text)}</span>;
          return (
            <a
              key={i}
              href={
                destination.kind === "fragment" ? run.link : destination.url
              }
              data-src={run.start}
              target={destination.kind === "external" ? "_blank" : undefined}
              rel="noreferrer"
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                if (destination.kind === "fragment" && navigation) {
                  event.preventDefault();
                  event.stopPropagation();
                  navigation.onFragment(destination.fragment);
                } else if (destination.kind === "app") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (navigation) navigation.onAppLink(destination.url);
                  else
                    window.dispatchEvent(
                      new CustomEvent(OPEN_LINK_EVENT, {
                        detail: destination.url,
                      }),
                    );
                }
              }}
            >
              {shade(run.text)}
            </a>
          );
        }
        if (run.bold)
          return (
            <strong key={i}>
              <Pieces run={run} marks={marks} />
            </strong>
          );
        if (run.italic)
          return (
            <em key={i}>
              <Pieces run={run} marks={marks} />
            </em>
          );
        if (run.strike)
          return (
            <s key={i} className="doc-strike">
              <Pieces run={run} marks={marks} />
            </s>
          );
        if (run.highlight)
          return (
            <mark
              key={i}
              className={"doc-highlight" + (run.tint ? ` is-${run.tint}` : "")}
            >
              <Pieces run={run} marks={marks} />
            </mark>
          );
        if (run.tag)
          return (
            <span key={i} className="doc-inline-tag" title={`Tag: ${run.tag}`}>
              <Pieces run={run} marks={marks} />
            </span>
          );
        return <Pieces key={i} run={run} marks={marks} />;
      })}
    </>
  );
}

/** Bullets change shape as a list nests, as they do on paper. */
const BULLETS = ["•", "◦", "▪", "•"];

/**
 * A block as it reads. The editor swaps this for an input on the focused
 * block, so what you read and what you edit stay in the same place.
 */
export function BlockView({
  block,
  marks = [],
  onToggleTodo,
  number,
  depth = 0,
  isTask = false,
  projectId = null,
  onReplace,
  pageBlocks = [],
}: {
  block: DocBlock;
  /** Stretches of this line that carry remarks. */
  marks?: Mark[];
  onToggleTodo?: () => void;
  /** What a numbered line shows, counted from where its list starts. */
  number?: number | null;
  /** How far a list line is tucked in (see `listLayout`). */
  depth?: number;
  /** A checklist line tied to a task in the planner. */
  isTask?: boolean;
  /** The page's project, for a live list's ready-made choices. */
  projectId?: string | null;
  /** Put another block in this one's place (a live list's new choice). */
  onReplace?: (block: DocBlock) => void;
  /** The page's lines, for an embed of the tasks the page links to. */
  pageBlocks?: DocBlock[];
}) {
  // A nested list line steps in from the left by its depth.
  const nest = depth ? ({ "--depth": depth } as CSSProperties) : undefined;
  switch (block.type) {
    case "heading": {
      const H = (["h2", "h3", "h4"] as const)[block.level - 1];
      return (
        <H className="doc-heading" dir="auto">
          {<Inline text={block.text} marks={marks} />}
        </H>
      );
    }
    case "bullet":
      return (
        <div className="doc-li" data-depth={depth || undefined} style={nest}>
          <span className="doc-marker" aria-hidden="true">
            {BULLETS[depth % BULLETS.length]}
          </span>
          <span dir="auto">
            <Inline text={block.text} marks={marks} />
          </span>
        </div>
      );
    case "numbered":
      return (
        <div className="doc-li" data-depth={depth || undefined} style={nest}>
          <span className="doc-marker is-number" aria-hidden="true">
            {number ?? block.start ?? 1}.
          </span>
          <span dir="auto">
            <Inline text={block.text} marks={marks} />
          </span>
        </div>
      );
    case "todo":
      return (
        <div className="doc-li" data-depth={depth || undefined} style={nest}>
          <input
            type="checkbox"
            className="doc-check"
            checked={block.done}
            onChange={onToggleTodo}
            // Ticking a box is not a request to edit the line's source.
            onClick={(e) => e.stopPropagation()}
            aria-label={block.text || "Checklist item"}
          />
          <span className={block.done ? "doc-done" : undefined} dir="auto">
            <Inline text={block.text} marks={marks} />
            {/* A line tied to a task says so, so ticking it here is clearly
                the same as ticking it in the planner. */}
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
      if (block.lang === LIVE_LIST_LANG)
        return (
          <LiveList
            text={block.text}
            projectId={projectId}
            onChange={
              onReplace ? (text) => onReplace({ ...block, text }) : undefined
            }
          />
        );
      if (block.lang === EMBED_LANG)
        return <EmbedBlock text={block.text} pageBlocks={pageBlocks} />;
      if (isDiagram(block)) return <Diagram text={block.text} />;
      return <CodeView text={block.text} lang={block.lang} />;
    case "callout":
      return <CalloutView block={block} />;
    case "table":
      return (
        <TableBlock
          text={block.text}
          onChange={
            onReplace ? (text) => onReplace({ ...block, text }) : undefined
          }
        />
      );
    case "image":
      return <ImageBlock block={block} onChange={onReplace} />;
    case "file":
      return <FileCard block={block} />;
    case "footnote":
      return <FootnoteLine block={block} />;
    case "math":
      return (
        <div className="doc-math">
          <Math latex={block.text} display />
          {block.check && (
            <span
              className="doc-math-check"
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
          <Inline text={block.text} marks={marks} />
        </p>
      );
  }
}

import type { ReactNode } from "react";
import { parseDocInline, type DocBlock, type DocInline } from "@orbyn/core";
import { Math } from "./Math";
import { cut, touches, type Mark } from "./marks";

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
                (piece.active ? " is-active" : "")
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
  const runs = parseDocInline(text);
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
        if (run.link)
          return (
            <a
              key={i}
              href={run.link}
              data-src={run.start}
              target="_blank"
              rel="noreferrer"
            >
              {shade(run.text)}
            </a>
          );
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
        return <Pieces key={i} run={run} marks={marks} />;
      })}
    </>
  );
}

/**
 * A block as it reads. The editor swaps this for an input on the focused
 * block, so what you read and what you edit stay in the same place.
 */
export function BlockView({
  block,
  marks = [],
  onToggleTodo,
}: {
  block: DocBlock;
  /** Stretches of this line that carry remarks. */
  marks?: Mark[];
  onToggleTodo?: () => void;
}) {
  switch (block.type) {
    case "heading": {
      const H = (["h2", "h3", "h4"] as const)[block.level - 1];
      return (
        <H className="doc-heading">
          {<Inline text={block.text} marks={marks} />}
        </H>
      );
    }
    case "bullet":
      return (
        <div className="doc-li">
          <span className="doc-marker" aria-hidden="true">
            •
          </span>
          <span>
            <Inline text={block.text} marks={marks} />
          </span>
        </div>
      );
    case "numbered":
      return (
        <div className="doc-li">
          <span className="doc-marker" aria-hidden="true">
            1.
          </span>
          <span>
            <Inline text={block.text} marks={marks} />
          </span>
        </div>
      );
    case "todo":
      return (
        <div className="doc-li">
          <input
            type="checkbox"
            className="doc-check"
            checked={block.done}
            onChange={onToggleTodo}
            // Ticking a box is not a request to edit the line's source.
            onClick={(e) => e.stopPropagation()}
            aria-label={block.text || "Checklist item"}
          />
          <span className={block.done ? "doc-done" : undefined}>
            <Inline text={block.text} marks={marks} />
            {/* A line tied to a task says so, so ticking it here is clearly
                the same as ticking it in the planner. */}
            {block.id && (
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
        <blockquote className="doc-quote">
          <Inline text={block.text} marks={marks} />
        </blockquote>
      );
    case "code":
      return (
        <pre className="doc-code">
          <code>{block.text}</code>
        </pre>
      );
    case "math":
      return (
        <div className="doc-math">
          <Math latex={block.text} display />
        </div>
      );
    case "divider":
      return <hr className="doc-divider" />;
    default:
      return (
        <p className="doc-p">
          <Inline text={block.text} marks={marks} />
        </p>
      );
  }
}

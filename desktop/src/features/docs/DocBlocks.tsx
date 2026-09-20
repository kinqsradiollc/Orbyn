import { parseDocInline, type DocBlock } from "@orbyn/core";
import { Math } from "./Math";

/** One line of text with its inline styling, links and maths applied. */
export function Inline({ text }: { text: string }) {
  const runs = parseDocInline(text);
  return (
    <>
      {runs.map((run, i) => {
        if (run.math) return <Math key={i} latex={run.text} />;
        if (run.code) return <code key={i}>{run.text}</code>;
        if (run.link)
          return (
            <a key={i} href={run.link} target="_blank" rel="noreferrer">
              {run.text}
            </a>
          );
        if (run.bold) return <strong key={i}>{run.text}</strong>;
        if (run.italic) return <em key={i}>{run.text}</em>;
        return <span key={i}>{run.text}</span>;
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
  onToggleTodo,
}: {
  block: DocBlock;
  onToggleTodo?: () => void;
}) {
  switch (block.type) {
    case "heading": {
      const H = (["h2", "h3", "h4"] as const)[block.level - 1];
      return <H className="doc-heading">{<Inline text={block.text} />}</H>;
    }
    case "bullet":
      return (
        <div className="doc-li">
          <span className="doc-marker" aria-hidden="true">
            •
          </span>
          <span>
            <Inline text={block.text} />
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
            <Inline text={block.text} />
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
            <Inline text={block.text} />
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
          <Inline text={block.text} />
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
          <Inline text={block.text} />
        </p>
      );
  }
}

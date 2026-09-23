import type { ReactNode } from "react";

/** `**bold**` inside a line; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

/**
 * Renders a legal document's Markdown: `#`/`##`/`###` headings, `-` lists and
 * paragraphs separated by blank lines. That's all the documents use, so this
 * stays small rather than pulling in a Markdown library.
 */
export function LegalText({ body }: { body: string }) {
  const blocks = body.trim().split(/\n{2,}/);
  return (
    <div className="legal-text">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith("- ")))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        const heading = block.match(/^(#{1,3}) (.*)$/);
        if (heading && lines.length === 1) {
          const level = heading[1].length;
          const text = inline(heading[2]);
          return level === 1 ? (
            <h1 key={i}>{text}</h1>
          ) : level === 2 ? (
            <h2 key={i}>{text}</h2>
          ) : (
            <h3 key={i}>{text}</h3>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

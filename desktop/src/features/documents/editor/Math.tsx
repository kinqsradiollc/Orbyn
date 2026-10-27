import { useMemo } from "react";
import katex from "katex";

/**
 * Rendered LaTeX. The source is kept as typed; when it doesn't parse we show
 * the source with a quiet error style rather than throwing away the line, so
 * a half-finished formula never blanks the document.
 */
export function Math({
  latex,
  display = false,
}: {
  latex: string;
  display?: boolean;
}) {
  const result = useMemo(() => {
    try {
      return {
        html: katex.renderToString(latex, {
          displayMode: display,
          throwOnError: false,
          strict: false,
        }),
        ok: true,
      };
    } catch {
      return { html: "", ok: false };
    }
  }, [latex, display]);

  if (!result.ok)
    return (
      <code className="math-error" title="This formula isn't valid yet">
        {latex}
      </code>
    );
  return (
    <span
      className={display ? "math-display" : "math-inline"}
      // KaTeX returns its own sanitised markup.
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
}

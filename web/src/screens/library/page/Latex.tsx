import { EMPTY_LATEX_DOCUMENT, type DocBlock } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";

const CSS = `
html,body{margin:0;padding:0;background:transparent;color:CanvasText;font:15px/1.6 Georgia,serif}
body{padding:16px;overflow-wrap:anywhere}
h1,h2,h3{font-family:inherit;line-height:1.25}
.page{max-width:100%}
.katex-html{white-space:normal}
`;

type Rendered = { html: string; error: string };

/** Render on the page's side; the iframe gets inert markup and no scripts. */
async function render(source: string): Promise<Rendered> {
  try {
    // @ts-expect-error latex.js ships no types.
    const { parse, HtmlGenerator } = await import("latex.js");
    const generator = parse(source, {
      generator: new HtmlGenerator({ hyphenate: false }),
    });
    const host = document.createElement("div");
    host.appendChild(generator.domFragment());
    return { html: host.innerHTML, error: "" };
  } catch (failure) {
    return {
      html: "",
      error:
        failure instanceof Error
          ? failure.message
          : "This LaTeX can't be drawn yet.",
    };
  }
}

export function LatexPreview({
  source,
  fill = false,
}: {
  source: string;
  fill?: boolean;
}) {
  const [out, setOut] = useState<Rendered>({ html: "", error: "" });
  const [height, setHeight] = useState(160);
  const frame = useRef<HTMLIFrameElement>(null);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      void render(source).then((next) => {
        // A half-typed source keeps the last good drawing beside its message.
        if (id === request.current)
          setOut((was) => (next.error ? { ...was, error: next.error } : next));
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [source]);
  const dark = document.documentElement.dataset.theme === "dark";
  return (
    <div className="doc-latex" data-fill={fill || undefined}>
      {out.error && (
        <p className="small doc-latex-error" role="status">
          {out.error}
        </p>
      )}
      <iframe
        ref={frame}
        title="LaTeX document preview"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        style={fill ? undefined : { height }}
        srcDoc={`<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><style>${CSS}</style><body>${out.html}</body>`}
        onLoad={() => {
          const inner = frame.current?.contentDocument?.documentElement;
          if (inner)
            setHeight(Math.max(80, Math.min(2400, inner.scrollHeight)));
        }}
      />
    </div>
  );
}

export function LatexNote({
  block,
}: {
  block: Extract<DocBlock, { type: "code" }>;
}) {
  if (block.text.trim() === EMPTY_LATEX_DOCUMENT.trim()) return null;
  return <LatexPreview source={block.text} />;
}

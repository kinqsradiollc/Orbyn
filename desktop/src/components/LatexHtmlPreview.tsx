import { useEffect, useRef, useState } from "react";
/** Stable isolated HTML renderer. Draft updates use messages, never iframe reloads. */
export function LatexHtmlPreview({
  source,
  fill = false,
}: {
  source: string;
  fill?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const latest = useRef(source);
  latest.current = source;
  const send = () => {
    const style = getComputedStyle(document.documentElement);
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({
        type: "orbyn-latex-source",
        source: latest.current,
        palette: Object.fromEntries(
          [
            ["surface", "--color-surface"],
            ["text", "--color-text"],
            ["muted", "--color-muted"],
            ["border", "--color-border"],
          ].map(([key, token]) => [key, style.getPropertyValue(token).trim()]),
        ),
      }),
      "*",
    );
  };
  useEffect(() => {
    let alive = true;
    import("../../assets/latex-html-runtime.json").then(
      (runtime) => {
        if (alive) setHtml(runtime.default.html);
      },
      () => {
        if (alive)
          setError(
            "Couldn’t load the LaTeX preview. Reopen this page to retry.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(send, [source, html]);
  useEffect(() => {
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "orbyn-latex-status" && data.state === "loaded")
          send();
        if (data.type === "orbyn-latex-status" && Number.isFinite(data.height))
          setHeight(Math.max(80, Math.min(2400, data.height)));
      } catch {}
    };
    window.addEventListener("message", receive);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", receive);
    };
  }, []);
  return error ? (
    <p role="alert">{error}</p>
  ) : (
    <iframe
      ref={frame}
      className="latex-html-preview"
      style={{
        width: "100%",
        height: fill ? "100%" : height,
        minHeight: fill ? 240 : 80,
        border: 0,
      }}
      title="LaTeX document preview"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={html || undefined}
      onLoad={send}
    />
  );
}

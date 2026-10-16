import { colors } from "../theme";
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
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({
        type: "orbyn-latex-source",
        source: latest.current,
        palette: {
          surface: colors.surface,
          text: colors.text,
          muted: colors.muted,
          border: colors.border,
        },
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
  useEffect(send, [
    source,
    html,
    colors.surface,
    colors.text,
    colors.muted,
    colors.border,
  ]);
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
      style={{
        width: "100%",
        height: fill ? "100%" : height,
        minHeight: fill ? 240 : 80,
        border: 0,
        background: colors.surface,
      }}
      title="LaTeX document preview"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={html || undefined}
      onLoad={send}
    />
  );
}

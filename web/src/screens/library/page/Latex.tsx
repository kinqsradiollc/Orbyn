import {
  DOC_LATEX_SOURCE_MAX,
  EMPTY_LATEX_DOCUMENT,
  type DocBlock,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionVersion, onToken } from "../../../lib/session";

type Receipt = {
  type: "orbyn-web-latex-status";
  state: "loaded" | "ready" | "error" | "size";
  nonce?: string;
  ticket?: number;
  height?: number;
};

function receipt(value: unknown): Receipt | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== "orbyn-web-latex-status" ||
    !["loaded", "ready", "error", "size"].includes(String(data.state)) ||
    (data.nonce !== undefined && typeof data.nonce !== "string") ||
    (data.ticket !== undefined &&
      (typeof data.ticket !== "number" ||
        !Number.isSafeInteger(data.ticket))) ||
    (data.height !== undefined &&
      (typeof data.height !== "number" || !Number.isFinite(data.height)))
  )
    return null;
  // State and each optional member were checked at the message boundary.
  return data as Receipt;
}

/** The opaque frame owns parsing, sanitization, diagnostics and last-good output.
 * The host owns account/source tickets and accepts only its current frame's receipts.
 */
export function LatexPreview({
  source,
  fill = false,
}: {
  source: string;
  fill?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const owner = useRef(getSessionVersion()).current;
  const nonce = useRef(crypto.randomUUID()).current;
  const currentSource = useRef(source);
  currentSource.current = source;
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [live, setLive] = useState(true);
  const [html, setHtml] = useState<string | null>(null);
  const [height, setHeight] = useState(180);
  const [problem, setProblem] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [paletteVersion, setPaletteVersion] = useState(0);
  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const send = useCallback(() => {
    if (owner !== getSessionVersion() || !frame.current?.contentWindow) return;
    clearTimer();
    const ticket = ++sequence.current;
    if (currentSource.current.length > DOC_LATEX_SOURCE_MAX) {
      setProblem(
        "Source is too long for the web preview. Your last preview stays visible.",
      );
      return;
    }
    const root = getComputedStyle(document.documentElement);
    const palette = {
      surface: root.getPropertyValue("--surface").trim(),
      text: root.getPropertyValue("--text").trim(),
      muted: root.getPropertyValue("--text-muted").trim(),
      border: root.getPropertyValue("--line").trim(),
    };
    const fontScale = Math.max(
      0.85,
      Math.min(3, (parseFloat(root.fontSize) || 16) / 16),
    );
    frame.current?.contentWindow?.postMessage(
      {
        type: "orbyn-web-latex-source",
        nonce,
        ticket,
        source: currentSource.current,
        palette,
        fontScale,
      },
      "*", // A sandbox without same-origin has an opaque origin.
    );
    setProblem("");
    timer.current = setTimeout(() => {
      if (owner === getSessionVersion() && ticket === sequence.current)
        setProblem(
          "The preview is taking too long. Your source is unchanged; PDF export uses the full compiler.",
        );
    }, 12_000);
  }, [owner, nonce, clearTimer]);
  useEffect(() => {
    let alive = true;
    void import("virtual:orbyn-latex-frame").then(
      (module) => {
        if (alive && owner === getSessionVersion()) setHtml(module.default);
      },
      () => {
        if (alive && owner === getSessionVersion())
          setProblem(
            "The preview could not load. Your source is unchanged; PDF export uses the full compiler.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, [owner]);
  useEffect(() => {
    let alive = true;
    const receive = (event: MessageEvent<unknown>) => {
      if (
        !alive ||
        owner !== getSessionVersion() ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const data = receipt(event.data);
      if (!data) return;
      if (data.state === "loaded") {
        send();
        return;
      }
      if (data.nonce !== nonce || data.ticket !== sequence.current) return;
      if (data.state === "size" && data.height !== undefined)
        setHeight(Math.max(80, Math.min(2400, data.height)));
      if (data.state === "ready" || data.state === "error") {
        clearTimer();
        // Detailed parser errors and a truthful last-good notice stay in the frame.
        setProblem("");
      }
    };
    window.addEventListener("message", receive);
    const stop = onToken(() => {
      if (owner === getSessionVersion()) return;
      sequence.current++;
      clearTimer();
      // Remove old-account output immediately, before a parent remount completes.
      if (frame.current) frame.current.srcdoc = "";
      setLive(false);
    });
    const observer = new MutationObserver(() =>
      setPaletteVersion((value) => value + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });
    return () => {
      alive = false;
      sequence.current++;
      clearTimer();
      stop();
      observer.disconnect();
      window.removeEventListener("message", receive);
    };
  }, [owner, nonce, send, clearTimer]);
  useEffect(() => {
    if (live) send();
  }, [source, loaded, paletteVersion, live, send]);
  if (!live || owner !== getSessionVersion()) return null;
  return (
    <div className="doc-latex" data-fill={fill || undefined}>
      {problem && (
        <p
          className={`small doc-latex-error${fill ? " doc-pane-note" : ""}`}
          role="status"
        >
          {problem}
        </p>
      )}
      {html === null ? (
        <p className="small muted" role="status">
          Loading LaTeX preview…
        </p>
      ) : (
        <iframe
          ref={frame}
          title="LaTeX document preview"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={fill ? undefined : { height }}
          srcDoc={html}
          onLoad={() => setLoaded((value) => value + 1)}
        />
      )}
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

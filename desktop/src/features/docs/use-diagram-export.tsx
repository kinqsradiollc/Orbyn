import { useCallback, useEffect, useRef, useState } from "react";
import { createDiagramExportBridge } from "@orbyn/core";

/** Export through an opaque local frame; closing the editor cancels active and queued work. */
export function useDiagramExport(scope: string) {
  const [request, setRequest] = useState<string>();
  const [html, setHtml] = useState<string>();
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof createDiagramExportBridge> | null>(
    null,
  );
  const latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    setRequest(undefined);
    // Keep the isolated engine mounted between diagrams in a batch.
    const current = createDiagramExportBridge((next) => {
      if (next) setRequest(next);
    });
    bridge.current = current;
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        typeof event.data === "string"
      )
        current.receive(event.data);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      current.dispose();
      if (bridge.current === current) bridge.current = null;
    };
  }, [scope]);
  useEffect(() => {
    if (request) frame.current?.contentWindow?.postMessage(request, "*");
  }, [request]);
  useEffect(() => {
    if (!request || html) return;
    let live = true;
    void import("../../assets/mermaid-runtime.json").then(
      (runtime) => {
        if (live) setHtml(runtime.default.html);
      },
      () => {
        if (live)
          bridge.current?.receive(
            JSON.stringify({
              type: "orbyn-diagram-result",
              id: JSON.parse(request).id,
              error: "Local renderer unavailable.",
            }),
          );
      },
    );
    return () => {
      live = false;
    };
  }, [request, html]);
  const render = useCallback((source: string) => {
    if (!bridge.current)
      return Promise.reject(
        Object.assign(new Error("Export renderer is unavailable."), {
          name: "AbortError",
        }),
      );
    return bridge.current.render(source);
  }, []);
  const signal = () => {
    if (!bridge.current)
      throw Object.assign(new Error("Export renderer is unavailable."), {
        name: "AbortError",
      });
    return bridge.current.signal;
  };
  return {
    render,
    signal,
    surface:
      request && html ? (
        <iframe
          ref={frame}
          title="Local document export renderer"
          aria-hidden="true"
          tabIndex={-1}
          sandbox="allow-scripts"
          srcDoc={html}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
          onLoad={() => {
            if (latest.current)
              frame.current?.contentWindow?.postMessage(latest.current, "*");
          }}
        />
      ) : null,
  };
}

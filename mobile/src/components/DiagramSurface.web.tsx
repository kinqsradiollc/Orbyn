import { useEffect, useRef } from "react";
import runtime from "../../assets/mermaid-runtime.json";
import type { DiagramSurfaceProps } from "./DiagramSurface";

/** The opaque iframe can execute its bundled renderer but cannot access its host. */
export function DiagramSurface({
  request,
  panRequest,
  height,
  onResult,
}: DiagramSurfaceProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        typeof event.data === "string"
      )
        onResult(event.data);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onResult]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(request, "*");
  }, [request]);
  useEffect(() => {
    if (panRequest) frame.current?.contentWindow?.postMessage(panRequest, "*");
  }, [panRequest]);
  return (
    <iframe
      ref={frame}
      title="Diagram preview"
      sandbox="allow-scripts"
      srcDoc={runtime.html}
      style={{ width: "100%", height, border: 0, display: "block" }}
      onLoad={() =>
        frame.current?.contentWindow?.postMessage(latest.current, "*")
      }
    />
  );
}

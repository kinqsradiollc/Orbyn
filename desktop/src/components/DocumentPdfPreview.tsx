import { useEffect, useRef, useState } from "react";

/** App-owned PDF pages; the isolated local renderer needs no browser PDF plugin. */
export function DocumentPdfPreview({
  pdf,
  url,
}: {
  pdf: Blob;
  url: string | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    latest = useRef<string | null>(null),
    sequence = useRef(0);
  const [html, setHtml] = useState("");
  const [loadError, setLoadError] = useState("");
  const [readError, setReadError] = useState("");
  useEffect(() => {
    let alive = true;
    import("../../assets/pdf-preview-runtime.json").then(
      (runtime) => {
        if (alive) setHtml(runtime.default.html);
      },
      () => {
        if (alive)
          setLoadError(
            "Couldn’t load the PDF viewer. Download the PDF to open it.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const id = ++sequence.current;
    setReadError("");
    pdf.arrayBuffer().then(
      (buffer) => {
        if (!alive) return;
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let start = 0; start < bytes.length; start += 8192)
          binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        latest.current = JSON.stringify({
          type: "orbyn-pdf",
          id,
          data: btoa(binary),
        });
        send();
      },
      () => {
        if (alive) setReadError("Couldn’t open this PDF. Try downloading it.");
      },
    );
    return () => {
      alive = false;
    };
  }, [pdf]);
  const send = () => {
    if (!latest.current) return;
    const request = JSON.parse(latest.current),
      style = getComputedStyle(document.documentElement);
    request.palette = Object.fromEntries(
      ["surface", "text", "muted", "border"].map((key) => [
        key,
        style.getPropertyValue(`--color-${key}`).trim(),
      ]),
    );
    frame.current?.contentWindow?.postMessage(JSON.stringify(request), "*");
  };
  useEffect(() => {
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="document-pdf-preview">
      {(loadError || readError) && <p role="alert">{loadError || readError}</p>}
      <iframe
        ref={frame}
        title="LaTeX note"
        sandbox="allow-scripts"
        srcDoc={html || undefined}
        onLoad={send}
      />
      {url && (
        <a href={url} download="document.pdf">
          Download PDF
        </a>
      )}
    </div>
  );
}

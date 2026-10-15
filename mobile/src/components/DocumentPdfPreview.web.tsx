import { useEffect, useState } from "react";
import type { DocumentPdfPreviewProps } from "./DocumentPdfPreview";

export function DocumentPdfPreview({ pdf }: DocumentPdfPreviewProps) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(pdf);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [pdf]);
  if (!url) return null;
  return (
    <div style={{ height: "100%", minHeight: 220 }}>
      <iframe
        title="Compiled LaTeX PDF"
        src={url}
        style={{ width: "100%", height: "calc(100% - 44px)", border: 0 }}
      />
      <a href={url} download="document.pdf">
        Download PDF
      </a>
    </div>
  );
}

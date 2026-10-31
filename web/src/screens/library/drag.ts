import type { DragEvent } from "react";
import type { DocSummary } from "@orbyn/core";

/** A page being dragged: to a folder, or into an open page as a link. */
export const DOC_MIME = "application/x-orbyn-doc";

export function dragDoc(
  event: DragEvent,
  doc: Pick<DocSummary, "id" | "title">,
) {
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(DOC_MIME, doc.id);
  event.dataTransfer.setData("text/plain", doc.title || "Untitled");
}

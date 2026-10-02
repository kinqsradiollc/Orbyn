import { useState } from "react";
import { FileDown, FileText, Link2, Share2 } from "lucide-react";
import {
  appUrl,
  assertDocExportActive,
  EXPORT_LABELS,
  type ExportFormat,
  type LinkTarget,
} from "@orbyn/core";
import { client } from "../lib/api";
import { Popover } from "./Popover";

/**
 * Sharing out of Orbyn on a phone's browser (SHR-07): the system share
 * sheet, where the browser has one (phones, tablets, Safari). Elsewhere
 * these controls don't show; the page's own Download and Copy stay.
 */
export const canShareHere = () =>
  typeof navigator !== "undefined" && typeof navigator.share === "function";

/** Closing the share sheet without sharing is not a failure. */
const closed = (e: unknown) => (e as Error)?.name === "AbortError";

/** Hand a page, task or project's link to the share sheet. */
export async function shareLink(target: LinkTarget, title: string) {
  try {
    await navigator.share({ title, url: appUrl(location.origin, target) });
  } catch (e) {
    if (!closed(e)) throw e;
  }
}

/** Hand a page to the share sheet as a file, or download it without one. */
export async function sharePageFile(
  docId: string,
  format: ExportFormat,
  title: string,
  options: { version?: number; signal?: AbortSignal } = {},
) {
  assertDocExportActive(options.signal);
  const { blob, name } = await client.exportDoc(docId, format, {
    version: options.version,
  });
  assertDocExportActive(options.signal);
  const file = new File([blob], name, {
    type: blob.type || EXPORT_LABELS[format].type,
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (closed(e)) return;
      // Some browsers refuse a share that waited on the file (the tap is
      // too long ago): the file is downloaded instead.
      if ((e as Error)?.name !== "NotAllowedError") throw e;
    }
  }
  assertDocExportActive(options.signal);
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A Share button for a task or a project: its link, straight away. */
export function ShareLinkButton({
  target,
  title,
  onError,
  className = "",
}: {
  target: LinkTarget;
  title: string;
  onError: (e: unknown) => void;
  className?: string;
}) {
  if (!canShareHere()) return null;
  return (
    <button
      className={`icon-button ${className}`.trim()}
      aria-label="Share link"
      title="Share link"
      onClick={() => void shareLink(target, title).catch(onError)}
    >
      <Share2 size={15} />
    </button>
  );
}

/** A page's Share: its link, or the page as a Markdown or PDF file. */
export function SharePageButton({
  docId,
  title,
  onError,
  onShareFile,
}: {
  docId: string;
  title: string;
  onError: (e: unknown) => void;
  onShareFile?: (format: "md" | "pdf") => Promise<void>;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  if (!canShareHere()) return null;
  const run = (go: () => Promise<void>) => {
    setMenu(null);
    void go().catch((error) => {
      if (!closed(error)) onError(error);
    });
  };
  return (
    <>
      <button
        className={"icon-button" + (menu ? " is-on" : "")}
        aria-label="Share this page"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        title="Share this page"
        onClick={(e) =>
          setMenu(menu ? null : e.currentTarget.getBoundingClientRect())
        }
      >
        <Share2 size={15} />
      </button>
      {menu && (
        <Popover
          anchor={menu}
          label="Share this page"
          onClose={() => setMenu(null)}
          width={220}
        >
          <div className="doc-menu" role="menu">
            <button
              className="doc-menu-item"
              role="menuitem"
              onClick={() =>
                run(() => shareLink({ kind: "doc", id: docId }, title))
              }
            >
              <Link2 size={15} aria-hidden="true" /> Link
            </button>
            <button
              className="doc-menu-item"
              role="menuitem"
              onClick={() =>
                run(() =>
                  onShareFile
                    ? onShareFile("md")
                    : sharePageFile(docId, "md", title),
                )
              }
            >
              <FileText size={15} aria-hidden="true" /> Markdown file
            </button>
            <button
              className="doc-menu-item"
              role="menuitem"
              onClick={() =>
                run(() =>
                  onShareFile
                    ? onShareFile("pdf")
                    : sharePageFile(docId, "pdf", title),
                )
              }
            >
              <FileDown size={15} aria-hidden="true" /> PDF file
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

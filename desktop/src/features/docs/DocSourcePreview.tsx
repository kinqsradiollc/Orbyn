import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  docSourceMap,
  docSourceBlockAt,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  listLayout,
  type DocBlock,
} from "@orbyn/core";
import { BlockView } from "./DocBlocks";
import { FootnoteContext } from "./RichBlocks";
import "./doc-source.css";

/** Inspect the current editor's blocks; this view owns no draft or save request. */
export function DocSourcePreview({
  blocks,
  onClose,
}: {
  blocks: DocBlock[];
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const map = useMemo(() => docSourceMap(blocks), [blocks]);
  const layout = useMemo(() => listLayout(blocks), [blocks]);
  const notes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
    }),
    [blocks],
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      dialog.current?.close();
      opener?.focus?.();
    };
  }, []);
  const select = (index: number, fromSource = false) => {
    const range = map.ranges[index];
    if (!range) return;
    setSelected(index);
    if (fromSource)
      preview.current
        ?.querySelector<HTMLElement>(`[data-source-index="${index}"]`)
        ?.scrollIntoView({ block: "nearest" });
    else {
      source.current?.focus();
      source.current?.setSelectionRange(range.start, range.end);
      if (source.current)
        source.current.scrollTop =
          (range.startLine - 1) *
          parseFloat(getComputedStyle(source.current).lineHeight);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="doc-source-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={id}>Source and preview</h2>
        <button
          className="icon-button"
          aria-label="Close source preview"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        This is the current document, including unsaved edits. Close this view
        to continue editing.
      </p>
      <div className="doc-source-columns">
        <textarea
          ref={source}
          aria-label="Markdown source"
          readOnly
          value={map.source}
          spellCheck={false}
          wrap="off"
          onSelect={(event) => {
            const range = docSourceBlockAt(
              map,
              event.currentTarget.selectionStart,
            );
            if (range) select(range.blockIndex, true);
          }}
        />
        <div
          ref={preview}
          className="doc-source-rendered"
          aria-label="Rendered preview"
        >
          <FootnoteContext.Provider value={notes}>
            {blocks.map((block, index) => (
              <div
                key={block.id ?? index}
                data-source-index={index}
                className={selected === index ? "is-selected" : ""}
              >
                <button
                  className="text-button doc-source-jump"
                  onClick={() => select(index)}
                >
                  Source lines {map.ranges[index].startLine}–
                  {map.ranges[index].endLine}
                </button>
                <BlockView
                  block={block}
                  pageBlocks={blocks}
                  number={layout[index].number}
                  depth={layout[index].depth}
                />
              </div>
            ))}
          </FootnoteContext.Provider>
        </div>
      </div>
    </dialog>
  );
}

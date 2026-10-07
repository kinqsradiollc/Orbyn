import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  docFragmentIndex,
  parseAppLink,
  docSourceMap,
  versionedDocLeafSourceMap,
  docContainerBlocks,
  type VersionedDocContent,
  docSourceBlockAt,
  docSourcePosition,
  docSourceLineAt,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  listLayout,
  type DocBlock,
} from "@orbyn/core";
import { BlockView } from "./DocBlocks";
import { FootnoteContext } from "./RichBlocks";
import { DocNavigationContext } from "./doc-navigation";
import "./doc-source.css";
import { DocContainerView } from "./DocContainerView";

/** Source editing delegates to the owning editor; this view never saves a revision. */
export function DocSourcePreview({
  blocks: flatBlocks,
  document: ownedDocument,
  onDocumentSourceChange,
  docId,
  onAppLink,
  onClose,
  onSourceChange,
  saveStatus,
}: {
  blocks: DocBlock[];
  /** Complete ownership is authoritative when supplied by the normal editor. */
  document?: VersionedDocContent;
  onDocumentSourceChange?: (
    source: string,
    expected: VersionedDocContent,
  ) => VersionedDocContent;
  docId: string;
  onAppLink: (url: string) => void;
  onClose: () => void;
  onSourceChange?: (source: string, expected: DocBlock[]) => DocBlock[];
  saveStatus?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const expectedScroll = useRef<{ source?: number; preview?: number }>({});
  const owner = ownedDocument ?? flatBlocks;
  const editable = ownedDocument ? !!onDocumentSourceChange : !!onSourceChange;
  const sourceMap = (value: VersionedDocContent | DocBlock[], raw?: string) =>
    Array.isArray(value)
      ? docSourceMap(value, raw)
      : versionedDocLeafSourceMap(value, raw, { projected: true });
  const canonical = useMemo(() => sourceMap(owner), [owner]);
  // This buffer retains typed whitespace while the owning editor holds the
  // parsed blocks and the only save/revision path. External reconciliations
  // replace it; echoes of our own parsed source do not move the caret.
  const [sourceText, setSourceText] = useState(canonical.source);
  const [sourceError, setSourceError] = useState("");
  const acceptedSource = useRef(canonical.source);
  const ownerBlocks = useRef<VersionedDocContent | DocBlock[]>(owner);
  // React can commit an older edit after a newer native text event arrived.
  // Recognize every own block echo without retaining old document snapshots.
  const acceptedBlocks = useRef(new WeakSet<object>([owner]));
  const mustRestore = useRef(false);
  // Retained browser/native input handlers must not rebase an older buffer
  // onto ownership adopted from another editor.
  const sourceEpoch = useRef(0);
  const renderedEpoch = sourceEpoch.current;
  useEffect(() => {
    if (acceptedBlocks.current.has(owner)) return;
    const previousOwner = ownerBlocks.current;
    const sameFormat = Array.isArray(owner)
      ? Array.isArray(previousOwner)
      : !Array.isArray(previousOwner) && owner.format === previousOwner.format;
    if (sameFormat && canonical.source === acceptedSource.current) {
      ownerBlocks.current = owner;
      acceptedBlocks.current.add(owner);
      return;
    }
    sourceEpoch.current++;
    if (sourceError) {
      mustRestore.current = true;
      setSourceError(
        "The document changed while this source edit was invalid. Restore the current document before continuing.",
      );
      return;
    }
    acceptedSource.current = canonical.source;
    ownerBlocks.current = owner;
    acceptedBlocks.current.add(owner);
    setSourceText(canonical.source);
    setSourceError("");
  }, [owner, canonical.source]);
  // A delayed own echo renders the newest accepted owner, not an older tree
  // beside a newer input buffer. External ownership renders its own canonical
  // map until the reconciliation effect restores the corresponding buffer.
  const previewOwner = acceptedBlocks.current.has(owner)
    ? ownerBlocks.current
    : owner;
  const blocks = useMemo(
    () =>
      Array.isArray(previewOwner)
        ? previewOwner
        : previewOwner.format === 1
          ? previewOwner.blocks
          : docContainerBlocks(previewOwner.nodes, { projected: true }),
    [previewOwner],
  );
  const previewCanonical = useMemo(
    () => sourceMap(previewOwner),
    [previewOwner],
  );
  const map = useMemo(() => {
    if (!editable || sourceError) return previewCanonical;
    try {
      return sourceMap(previewOwner, sourceText);
    } catch {
      return previewCanonical;
    }
  }, [previewOwner, previewCanonical, sourceText, sourceError, editable]);
  const changeSource = (text: string) => {
    if (!editable || mustRestore.current) return;
    setSourceText(text);
    try {
      if (renderedEpoch !== sourceEpoch.current) {
        mustRestore.current = true;
        throw new Error(
          "The document changed before this source edit could be applied. Restore the current document before continuing.",
        );
      }
      const expected = ownerBlocks.current;
      const next = Array.isArray(expected)
        ? onSourceChange!(text, expected)
        : onDocumentSourceChange!(text, expected);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = sourceMap(next).source;
      setSourceError("");
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "Couldn't apply the source edit.",
      );
    }
  };
  const closeSource = () => {
    if (!sourceError) onClose();
  };
  // Dialog lifetime follows mounting, not parser errors. Escape still reads
  // the latest error/close callback without closing and reopening the modal.
  const closeSourceRef = useRef(closeSource);
  closeSourceRef.current = closeSource;
  const revertSource = () => {
    mustRestore.current = false;
    acceptedSource.current = canonical.source;
    ownerBlocks.current = owner;
    acceptedBlocks.current.add(owner);
    setSourceText(canonical.source);
    setSourceError("");
  };
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
    const modal = dialog.current;
    modal?.showModal();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSourceRef.current();
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      modal?.close();
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
  const goToFragment = (fragment: string) => {
    const index = docFragmentIndex(blocks, fragment);
    if (index === null) return;
    select(index, true);
  };
  const navigation = {
    docId,
    onFragment: goToFragment,
    onAppLink: (url: string) => {
      const link = parseAppLink(url);
      if (link?.kind === "doc" && link.id === docId && link.block)
        goToFragment(link.block);
      else {
        if (sourceError) return;
        closeSource();
        onAppLink(url);
      }
    },
  };
  const consumeScroll = (pane: "source" | "preview", position: number) => {
    const expected = expectedScroll.current[pane];
    delete expectedScroll.current[pane];
    return expected !== undefined && Math.abs(expected - position) < 1;
  };
  const lineHeight = () =>
    source.current
      ? parseFloat(getComputedStyle(source.current).lineHeight) || 20
      : 20;
  const scrollSource = () => {
    const input = source.current,
      pane = preview.current;
    if (!input || !pane || consumeScroll("source", input.scrollTop)) return;
    const position = docSourcePosition(map, input.scrollTop / lineHeight() + 1);
    if (!position) return;
    const node = pane.querySelector<HTMLElement>(
      `[data-source-index="${position.range.blockIndex}"]`,
    );
    if (!node) return;
    const offset =
      node.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop;
    const next =
      offset + position.progress * node.getBoundingClientRect().height;
    if (Math.abs(pane.scrollTop - next) >= 1) {
      pane.scrollTop = next;
      expectedScroll.current.preview = pane.scrollTop;
    }
    setSelected(position.range.blockIndex);
  };
  const scrollPreview = () => {
    const input = source.current,
      pane = preview.current;
    if (!input || !pane || consumeScroll("preview", pane.scrollTop)) return;
    const top = pane.getBoundingClientRect().top;
    const nodes = [
      ...pane.querySelectorAll<HTMLElement>("[data-source-index]"),
    ];
    const node =
      nodes.find((element) => element.getBoundingClientRect().bottom > top) ??
      nodes.at(-1);
    if (!node) return;
    const index = Number(node.dataset.sourceIndex),
      range = map.ranges[index];
    if (!range) return;
    const rectangle = node.getBoundingClientRect();
    const next =
      (docSourceLineAt(
        range,
        (top - rectangle.top) / Math.max(1, rectangle.height),
      ) -
        1) *
      lineHeight();
    if (Math.abs(input.scrollTop - next) >= 1) {
      input.scrollTop = next;
      expectedScroll.current.source = input.scrollTop;
    }
    setSelected(index);
  };
  const renderLeaf = (block: DocBlock, index: number) => (
    <div
      key={block.id ?? index}
      data-source-index={index}
      className={selected === index ? "is-selected" : ""}
    >
      <button
        className="text-button doc-source-jump"
        onClick={() => select(index)}
      >
        Source lines {map.ranges[index].startLine}–{map.ranges[index].endLine}
      </button>
      <BlockView
        block={block}
        pageBlocks={blocks}
        number={layout[index].number}
        depth={layout[index].depth}
      />
    </div>
  );
  return (
    <dialog
      ref={dialog}
      className="doc-source-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        closeSource();
      }}
    >
      <div className="section-heading">
        <h2 id={id}>Source and preview</h2>
        <button
          className="icon-button"
          aria-label="Close source preview"
          onClick={closeSource}
          disabled={!!sourceError}
        >
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        {editable
          ? "Edit Markdown here. Source and preview use the same document and save status. Keep block anchors to preserve comments and task links."
          : "This is the current document, including unsaved edits. Source editing is available in Editing mode."}
      </p>
      {saveStatus && (
        <p role="status" className="doc-source-save">
          {saveStatus}
        </p>
      )}
      {!!sourceError && (
        <div className="doc-source-error" role="alert">
          <p>{sourceError} This edit has not been saved.</p>
          <button type="button" onClick={revertSource}>
            Restore current document
          </button>
        </div>
      )}
      <div className="doc-source-columns">
        <textarea
          ref={source}
          aria-label="Markdown source"
          readOnly={!editable}
          value={editable ? sourceText : map.source}
          onChange={
            editable
              ? (event) => changeSource(event.currentTarget.value)
              : undefined
          }
          spellCheck={false}
          wrap="off"
          onScroll={scrollSource}
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
          onScroll={scrollPreview}
        >
          <DocNavigationContext.Provider value={navigation}>
            <FootnoteContext.Provider value={notes}>
              {!Array.isArray(previewOwner) && previewOwner.format === 2 ? (
                <DocContainerView
                  nodes={previewOwner.nodes}
                  renderLeaf={renderLeaf}
                />
              ) : (
                blocks.map(renderLeaf)
              )}
            </FootnoteContext.Provider>
          </DocNavigationContext.Provider>
        </div>
      </div>
    </dialog>
  );
}

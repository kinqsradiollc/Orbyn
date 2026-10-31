import type { BLOCK_KINDS } from "@orbyn/core";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isTextLeaf, type Leaf } from "./tree";

type Kind = (typeof BLOCK_KINDS)[number];

/** A line's tools, anchored to its handle; arrow keys walk the list. */
export function BlockMenu({
  anchor,
  leaf,
  kinds,
  onClose,
  onTurn,
  onDuplicate,
  onMove,
  onRemove,
  onComment,
  onTask,
  onMoveToPage,
  onCopyLink,
  onFold,
}: {
  anchor: DOMRect;
  leaf: Leaf;
  kinds: readonly Kind[];
  onClose: () => void;
  onTurn: (kind: Kind) => void;
  onDuplicate: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onComment: () => void;
  onTask: () => void;
  onMoveToPage: () => void;
  onCopyLink: () => void;
  onFold?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = box.current;
    if (!menu) return;
    const size = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - size.width - 8))}px`;
    const below = anchor.bottom + 4 + size.height <= innerHeight - 8;
    menu.style.top = `${below ? anchor.bottom + 4 : Math.max(8, anchor.top - size.height - 4)}px`;
    menu.querySelector("button")?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(box.current?.querySelectorAll("button") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      items[
        (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length
      ]?.focus();
      event.preventDefault();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const act = (run: () => void) => () => {
    onClose();
    run();
  };
  const text = isTextLeaf(leaf.block);
  return createPortal(
    <div
      ref={box}
      className="menu doc-block-menu"
      role="menu"
      aria-label="Block options"
    >
      {text && (
        <button type="button" role="menuitem" onClick={act(onComment)}>
          Comment
        </button>
      )}
      {text && (
        <button type="button" role="menuitem" onClick={act(onTask)}>
          Make task
        </button>
      )}
      <button type="button" role="menuitem" onClick={act(onCopyLink)}>
        Copy link to line
      </button>
      {onFold && (
        <button type="button" role="menuitem" onClick={act(onFold)}>
          Fold or unfold section
        </button>
      )}
      <button type="button" role="menuitem" onClick={act(() => onMove(-1))}>
        Move up
      </button>
      <button type="button" role="menuitem" onClick={act(() => onMove(1))}>
        Move down
      </button>
      <button type="button" role="menuitem" onClick={act(onDuplicate)}>
        Duplicate
      </button>
      <button type="button" role="menuitem" onClick={act(onMoveToPage)}>
        Move to new page
      </button>
      {text && (
        <>
          <p className="doc-menu-label small muted">Turn into</p>
          {kinds
            .filter((kind) => kind.type !== "divider")
            .map((kind) => (
              <button
                key={`${kind.type}${kind.level ?? ""}`}
                type="button"
                role="menuitem"
                onClick={act(() => onTurn(kind))}
              >
                {kind.label}
              </button>
            ))}
        </>
      )}
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onClick={act(onRemove)}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}

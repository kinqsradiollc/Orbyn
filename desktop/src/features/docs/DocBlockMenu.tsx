import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  MessageSquarePlus,
  Trash2,
  type LucideIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  Code,
  Type,
} from "lucide-react";
import { BLOCK_KINDS, type DocBlock } from "@orbyn/core";
import { Popover } from "../../components/Popover";

/** One icon per kind, so the menu reads at a glance. */
const ICONS: Record<string, LucideIcon> = {
  paragraph: Type,
  "heading-1": Heading1,
  "heading-2": Heading2,
  "heading-3": Heading3,
  bullet: List,
  numbered: ListOrdered,
  todo: ListTodo,
  quote: Quote,
  code: Code,
  math: Sigma,
  divider: Minus,
};

export const kindKey = (kind: (typeof BLOCK_KINDS)[number]) =>
  kind.type === "heading" ? `heading-${kind.level}` : kind.type;

const blockKey = (block: DocBlock) =>
  block.type === "heading" ? `heading-${block.level}` : block.type;

/**
 * The menu behind a block's handle: what else this block could be, and
 * where else it could go. Everything here is also reachable by typing —
 * the shorthand shown beside each kind is what you would write at the
 * start of the line — so the menu teaches the keyboard as it goes.
 */
export function DocBlockMenu({
  anchor,
  block,
  isFirst,
  isLast,
  onTurnInto,
  onMove,
  onDuplicate,
  onComment,
  onDelete,
  onClose,
}: {
  anchor: DOMRect;
  block: DocBlock;
  isFirst: boolean;
  isLast: boolean;
  onTurnInto: (kind: (typeof BLOCK_KINDS)[number]) => void;
  onMove: (by: -1 | 1) => void;
  onDuplicate: () => void;
  onComment: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const current = blockKey(block);
  return (
    <Popover
      anchor={anchor}
      label="Block options"
      onClose={onClose}
      width={440}
    >
      <div className="doc-menu">
        <span className="doc-menu-label">Turn into</span>
        <div className="doc-menu-kinds" role="group" aria-label="Turn into">
          {BLOCK_KINDS.map((kind) => {
            const key = kindKey(kind);
            const Icon = ICONS[key];
            const active = key === current;
            return (
              <button
                key={key}
                className={"doc-menu-item" + (active ? " is-active" : "")}
                onClick={() => {
                  onTurnInto(kind);
                  onClose();
                }}
                aria-pressed={active}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="doc-menu-text">
                  <strong>{kind.label}</strong>
                  <small>{kind.hint}</small>
                </span>
                {kind.shorthand ? (
                  <kbd>{kind.shorthand.trim()}</kbd>
                ) : active ? (
                  <Check size={14} aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="doc-menu-row">
          <button
            className="doc-menu-item"
            disabled={isFirst}
            onClick={() => {
              onMove(-1);
              onClose();
            }}
          >
            <ArrowUp size={15} aria-hidden="true" /> Move up
          </button>
          <button
            className="doc-menu-item"
            disabled={isLast}
            onClick={() => {
              onMove(1);
              onClose();
            }}
          >
            <ArrowDown size={15} aria-hidden="true" /> Move down
          </button>
          <button
            className="doc-menu-item"
            onClick={() => {
              onDuplicate();
              onClose();
            }}
          >
            <Copy size={15} aria-hidden="true" /> Duplicate
          </button>
          <button
            className="doc-menu-item"
            onClick={() => {
              onComment();
              onClose();
            }}
          >
            <MessageSquarePlus size={15} aria-hidden="true" /> Comment
          </button>
          <button
            className="doc-menu-item is-danger"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            <Trash2 size={15} aria-hidden="true" /> Delete
          </button>
        </div>
      </div>
    </Popover>
  );
}

/**
 * The menu that opens when a line starts with "/": pick a kind of block by
 * name. Typing narrows it; Enter takes the highlighted one; Escape leaves
 * the slash as ordinary text.
 */
export function SlashMenu({
  anchor,
  query,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  query: string;
  onPick: (kind: (typeof BLOCK_KINDS)[number]) => void;
  onClose: () => void;
}) {
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return BLOCK_KINDS.filter(
      (k) =>
        !q ||
        k.label.toLowerCase().includes(q) ||
        k.type.includes(q) ||
        k.hint.toLowerCase().includes(q),
    );
  }, [query]);
  const [highlight, setHighlight] = useState(0);
  useEffect(() => setHighlight(0), [query]);

  // The keyboard stays in the textarea; this listens over the top of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, matches.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter" && matches[highlight]) {
        e.preventDefault();
        e.stopPropagation();
        onPick(matches[highlight]);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [matches, highlight, onPick]);

  if (!matches.length) return null;
  return (
    <Popover
      anchor={anchor}
      label="Insert a block"
      onClose={onClose}
      takeFocus={false}
      width={440}
    >
      <div className="doc-menu">
        <span className="doc-menu-label">
          {query ? `Blocks matching “${query}”` : "Add a block"}
        </span>
        <div className="doc-menu-kinds" role="listbox" aria-label="Block kinds">
          {matches.map((kind, i) => {
            const key = kindKey(kind);
            const Icon = ICONS[key];
            return (
              <button
                key={key}
                role="option"
                aria-selected={i === highlight}
                className={
                  "doc-menu-item" + (i === highlight ? " is-highlight" : "")
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(kind)}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="doc-menu-text">
                  <strong>{kind.label}</strong>
                  <small>{kind.hint}</small>
                </span>
                {kind.shorthand && <kbd>{kind.shorthand.trim()}</kbd>}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

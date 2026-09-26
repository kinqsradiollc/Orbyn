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
  CalendarDays,
  Link2,
  ListChecks,
  ListFilter,
  ListIndentDecrease,
  ListIndentIncrease,
} from "lucide-react";
import { BLOCK_KINDS, isListBlock, type DocBlock } from "@orbyn/core";
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
  onIndent,
  canIndent = false,
  canOutdent = false,
  structural = true,
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
  /** Tuck a list line in under the one above, or bring it back out. */
  onIndent?: (by: 1 | -1) => void;
  canIndent?: boolean;
  canOutdent?: boolean;
  /**
   * Whether the page itself may change. While suggesting it may not: a
   * proposal is a stretch of one line, so a line moved, copied or taken
   * away cannot be proposed — only its words can.
   */
  structural?: boolean;
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
        {!structural && (
          <p className="doc-menu-note">
            While you are suggesting, a line's words are yours to change.
            Moving, copying and removing lines are the page's to keep.
          </p>
        )}
        <div className="doc-menu-row">
          <button
            className="doc-menu-item"
            onClick={() => {
              onComment();
              onClose();
            }}
          >
            <MessageSquarePlus size={15} aria-hidden="true" /> Comment
          </button>
        </div>
        {structural && onIndent && isListBlock(block) && (
          <div className="doc-menu-row">
            <button
              className="doc-menu-item"
              disabled={!canIndent}
              onClick={() => {
                onIndent(1);
                onClose();
              }}
            >
              <ListIndentIncrease size={15} aria-hidden="true" /> Indent
              <kbd>Tab</kbd>
            </button>
            <button
              className="doc-menu-item"
              disabled={!canOutdent}
              onClick={() => {
                onIndent(-1);
                onClose();
              }}
            >
              <ListIndentDecrease size={15} aria-hidden="true" /> Outdent
              <kbd>⇧Tab</kbd>
            </button>
          </div>
        )}
        <div className="doc-menu-row" hidden={!structural}>
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
 * What the "/" menu can do: turn the line into a kind of block, or put
 * something in it — today's date, a new task, a link or a live list. Only
 * what works today is offered; tables, images, callouts and templates come
 * later.
 */
export type SlashItem =
  | { kind: "block"; block: (typeof BLOCK_KINDS)[number] }
  | { kind: "task" }
  | { kind: "date" }
  | { kind: "link" }
  | { kind: "live-list" };

type SlashEntry = {
  item: SlashItem;
  key: string;
  label: string;
  hint: string;
  shorthand?: string;
  icon: LucideIcon;
  /** Extra words it answers to when typed after the "/". */
  words: string;
};

/** Today, as it's written in a page: "Thursday 24 September 2026". */
export const todayText = (now = new Date()) =>
  now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const slashEntries = (): SlashEntry[] => {
  const blocks: SlashEntry[] = BLOCK_KINDS.map((block) => ({
    item: { kind: "block", block },
    key: kindKey(block),
    label: block.label,
    hint: block.hint,
    shorthand: block.shorthand.trim() || undefined,
    icon: ICONS[kindKey(block)],
    words: block.type,
  }));
  const task: SlashEntry = {
    item: { kind: "task" },
    key: "task",
    label: "New task",
    hint: "A checklist line that goes straight into your tasks",
    icon: ListChecks,
    words: "task todo make",
  };
  const date: SlashEntry = {
    item: { kind: "date" },
    key: "date",
    label: "Date",
    hint: todayText(),
    icon: CalendarDays,
    words: "date today day",
  };
  const link: SlashEntry = {
    item: { kind: "link" },
    key: "link",
    label: "Link",
    hint: "A page, task, project, person or date",
    shorthand: "[[",
    icon: Link2,
    words: "link page connect mention",
  };
  const liveList: SlashEntry = {
    item: { kind: "live-list" },
    key: "live-list",
    label: "Live list",
    hint: "Tasks or pages that match, kept up to date",
    icon: ListFilter,
    words: "live list query view filter tasks due open action items",
  };
  // "New task" sits with the checklist it is a kind of; links, live lists
  // and the date come last.
  const at = blocks.findIndex((e) => e.key === "todo") + 1;
  return [
    ...blocks.slice(0, at),
    task,
    ...blocks.slice(at),
    link,
    liveList,
    date,
  ];
};

/**
 * The menu that opens when a line starts with "/": pick a kind of block by
 * name, or something to put in the line. Typing narrows it; Enter takes the
 * highlighted one; Escape leaves the slash as ordinary text. Partway through
 * a line only what goes into a line is offered (a link, the date).
 */
export function SlashMenu({
  anchor,
  query,
  onPick,
  onClose,
  insertsOnly = false,
}: {
  anchor: DOMRect;
  query: string;
  onPick: (item: SlashItem) => void;
  onClose: () => void;
  /** Partway through a line: only what can go into the line. */
  insertsOnly?: boolean;
}) {
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return slashEntries().filter(
      (e) =>
        (!insertsOnly || e.item.kind === "date" || e.item.kind === "link") &&
        (!q ||
          e.label.toLowerCase().includes(q) ||
          e.words.includes(q) ||
          e.hint.toLowerCase().includes(q)),
    );
  }, [query, insertsOnly]);
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
        onPick(matches[highlight].item);
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
          {query ? `Matching “${query}”` : "Add a block"}
        </span>
        <div className="doc-menu-kinds" role="listbox" aria-label="Block kinds">
          {matches.map((entry, i) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.key}
                role="option"
                aria-selected={i === highlight}
                className={
                  "doc-menu-item" + (i === highlight ? " is-highlight" : "")
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(entry.item)}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="doc-menu-text">
                  <strong>{entry.label}</strong>
                  <small>{entry.hint}</small>
                </span>
                {entry.shorthand && <kbd>{entry.shorthand}</kbd>}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

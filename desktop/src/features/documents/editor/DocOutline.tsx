import { useEffect, useState } from "react";
import { MoreHorizontal, Star } from "lucide-react";
import type { OutlineEntry } from "@orbyn/core";
import { Popover } from "../../../components/Popover";

/**
 * A page's headings as its contents (NAV-03): click one to jump there. On
 * a page you're editing, a heading dragged onto another moves its whole
 * section there. The current section is marked as you read.
 */
export function DocOutline({
  outline,
  current,
  onJump,
  onMoveSection,
  label = "Contents",
  className = "doc-outline",
  starred,
  onStar,
}: {
  /** Starred headings, by block id (NAV-07). */
  starred?: Set<string>;
  /** Star or unstar a heading; left out, no stars are shown. */
  onStar?: (entry: OutlineEntry) => void;
  outline: OutlineEntry[];
  /** The entry being read, or -1 above the first heading. */
  current: number;
  onJump: (entry: OutlineEntry) => void;
  /** Move a section to start where another heading is (editing only). */
  onMoveSection?: (from: OutlineEntry, before: OutlineEntry) => void;
  label?: string;
  className?: string;
}) {
  const [moving, setMoving] = useState<{
    entry: OutlineEntry;
    anchor: DOMRect;
  } | null>(null);
  useEffect(() => setMoving(null), [outline]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  if (!outline.length) return null;
  return (
    <nav className={className} aria-label={label}>
      <p className="doc-outline-label">{label}</p>
      <ol>
        {outline.map((entry, n) => (
          <li
            key={`${entry.index}-${entry.text}`}
            className={
              `is-level-${entry.level}` +
              (n === current ? " is-current" : "") +
              (over === n && dragging !== n ? " is-drop" : "")
            }
            draggable={!!onMoveSection}
            onDragStart={(e) => {
              if (!onMoveSection) return;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", entry.text);
              setDragging(n);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (dragging === null || !onMoveSection) return;
              e.preventDefault();
              if (over !== n) setOver(n);
            }}
            onDrop={(e) => {
              if (dragging === null || !onMoveSection) return;
              e.preventDefault();
              const from = outline[dragging];
              setDragging(null);
              setOver(null);
              if (from && from !== entry) onMoveSection(from, entry);
            }}
          >
            <button
              type="button"
              aria-current={n === current ? "location" : undefined}
              onClick={() => onJump(entry)}
              title={entry.text}
              dir="auto"
            >
              {entry.text}
            </button>
            {onMoveSection && outline.length > 1 && (
              <button
                type="button"
                className="doc-outline-move"
                aria-label={`Move section ${entry.text}`}
                aria-haspopup="dialog"
                onClick={(event) =>
                  setMoving({
                    entry,
                    anchor: event.currentTarget.getBoundingClientRect(),
                  })
                }
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
            )}
            {onStar && (
              <button
                type="button"
                className={
                  "doc-outline-star" +
                  (entry.id && starred?.has(entry.id) ? " is-on" : "")
                }
                aria-pressed={!!(entry.id && starred?.has(entry.id))}
                aria-label={
                  entry.id && starred?.has(entry.id)
                    ? `Unstar ${entry.text}`
                    : `Star ${entry.text}`
                }
                title="Star this heading"
                onClick={() => onStar(entry)}
              >
                <Star
                  size={12}
                  fill={
                    entry.id && starred?.has(entry.id) ? "currentColor" : "none"
                  }
                />
              </button>
            )}
          </li>
        ))}
      </ol>
      {moving && onMoveSection && (
        <Popover
          label="Move section"
          anchor={moving.anchor}
          onClose={() => setMoving(null)}
          width={300}
        >
          <div className="doc-menu">
            <p className="doc-menu-label">Move before</p>
            {outline
              .filter((entry) => entry !== moving.entry)
              .map((entry) => (
                <button
                  type="button"
                  className="doc-menu-item"
                  key={entry.index}
                  onClick={() => {
                    onMoveSection(moving.entry, entry);
                    setMoving(null);
                  }}
                >
                  {entry.text}
                </button>
              ))}
          </div>
        </Popover>
      )}
    </nav>
  );
}

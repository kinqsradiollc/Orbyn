import { useRef, useState, useEffect } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { Popover } from "../../components/Popover";

/** Block tools stay in the margin; the document remains the writing surface. */
export function DocBlockActions({
  index,
  editing,
  onEdit,
  onDone,
  onComment,
  onAssist,
  assistDisabled,
}: {
  index: number;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onComment: () => void;
  onAssist: () => void;
  assistDisabled: boolean;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const run = (action: () => void) => {
    setAnchor(null);
    // Let the popover restore its opener before focusing an inline editor.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      action();
    });
  };
  return (
    <div className="doc-block-tools">
      {editing && (
        <button
          type="button"
          className="icon-button"
          aria-label={`Finish editing block ${index + 1}`}
          onClick={onDone}
        >
          <Check size={15} />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={`Block ${index + 1} actions`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) =>
          setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())
        }
      >
        <MoreHorizontal size={15} />
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          label={`Block ${index + 1} actions`}
          width={200}
          onClose={() => setAnchor(null)}
        >
          <div className="doc-block-menu">
            <button
              type="button"
              className="text-button"
              onClick={() => run(editing ? onDone : onEdit)}
            >
              {editing ? "Done" : "Edit text"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => run(onComment)}
            >
              Comment
            </button>
            <button
              type="button"
              className="text-button"
              disabled={assistDisabled}
              onClick={() => run(onAssist)}
            >
              Ask assistant
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}

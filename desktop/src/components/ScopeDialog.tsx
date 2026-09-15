import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { EditScope, Kind } from "@orbyn/core";
import "./event-fields.css";

/** Which occurrences of a repeating item an edit or delete covers. */
export type EditOptions = { scope?: EditScope; occurrence?: string };

/** One occurrence of a repeating item: its original start and its own times. */
export type OccurrenceRef = {
  occurrence: string;
  start_at: string;
  end_at: string | null;
};

type Props = {
  kind: Kind;
  action: "save" | "move" | "delete";
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
};

const TITLES = {
  save: "Change a repeating",
  move: "Move a repeating",
  delete: "Delete a repeating",
};

/** "This event / This and following / All events" for a repeating item. */
export function ScopeDialog({ kind, action, onChoose, onCancel }: Props) {
  const noun = kind === "event" ? "event" : "task";
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only this dialog closes, not the editor under it.
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <section
        className="modal scope-dialog scale-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="scope-title"
        aria-describedby="scope-body"
      >
        <div className="section-heading">
          <h2 id="scope-title">
            {TITLES[action]} {noun}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <X size={20} />
          </button>
        </div>
        <p id="scope-body" className="scope-body">
          Which {noun}s should this {action === "delete" ? "remove" : "change"}?
        </p>
        <div className="scope-options">
          <button
            ref={first}
            type="button"
            className="secondary"
            onClick={() => onChoose("this")}
          >
            <strong>This {noun}</strong>
            <small>Only this one</small>
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onChoose("following")}
          >
            <strong>This and following {noun}s</strong>
            <small>This one and every one after it</small>
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onChoose("all")}
          >
            <strong>All {noun}s</strong>
            <small>The whole series</small>
          </button>
        </div>
        <div className="button-row">
          <button type="button" className="text-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

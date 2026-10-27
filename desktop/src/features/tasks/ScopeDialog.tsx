import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { X } from "lucide-react";
import type { EditScope, Kind } from "@orbyn/core";
import "../calendar/event-fields.css";

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
  const focus = useModalFocus(onCancel);
  const chosen = useRef(false);
  const choose = (scope: EditScope) => {
    if (!chosen.current) {
      chosen.current = true;
      onChoose(scope);
    }
  };
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement | null;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return createPortal(
    <dialog
      ref={focus.ref as React.RefObject<HTMLDialogElement>}
      data-modal-focus={focus.id}
      className="modal scope-dialog"
      role="alertdialog"
      aria-labelledby="scope-title"
      aria-describedby="scope-body"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
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
          type="button"
          className="secondary"
          onClick={() => choose("this")}
        >
          <strong>This {noun}</strong>
          <small>Only this one</small>
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => choose("following")}
        >
          <strong>This and following {noun}s</strong>
          <small>This one and every one after it</small>
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => choose("all")}
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
    </dialog>,
    document.body,
  );
}

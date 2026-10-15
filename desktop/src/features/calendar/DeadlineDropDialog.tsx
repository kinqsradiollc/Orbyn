import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus";

type Props = {
  title: string;
  start: Date;
  onClose: () => void;
  onPlan: () => void;
  onMove: () => void;
};

/** A deadline drag can schedule work without changing the deadline. */
export function DeadlineDropDialog({
  title,
  start,
  onClose,
  onPlan,
  onMove,
}: Props) {
  const titleId = useId();
  const modal = useModalFocus(onClose);
  useEffect(() => {
    const node = modal.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        modal.ref.current = node;
      }}
      className="modal modal-small"
      data-modal-focus={modal.id}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={titleId}>Schedule or move deadline?</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <p className="modal-lead">{title}</p>
      <p className="muted">
        {start.toLocaleString([], {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
      <div className="scope-options">
        <button className="primary" onClick={onPlan}>
          Plan a session
        </button>
        <button className="secondary" onClick={onMove}>
          Move deadline
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

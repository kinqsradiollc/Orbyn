import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus";

/** Focused Settings edits own keyboard focus and pending dismissal. */
export function SettingsEditor({
  title,
  pending = false,
  closeDisabled = false,
  onClose,
  children,
}: {
  title: string;
  pending?: boolean;
  closeDisabled?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const locked = pending || closeDisabled;
  const focus = useModalFocus(onClose, locked);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement | null;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal settings-editor"
      data-modal-focus={focus.id}
      aria-labelledby={`${focus.id}-title`}
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={`${focus.id}-title`}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          disabled={locked}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="settings-editor-body">{children}</div>
    </dialog>,
    document.body,
  );
}

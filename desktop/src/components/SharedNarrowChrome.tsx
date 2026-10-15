import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Shared controls stay outside either retained pane's hidden/inert subtree. */
export function SharedNarrowChrome({
  host,
  header,
  navigation,
  open,
  onClose,
}: {
  host: HTMLElement;
  header: ReactNode;
  navigation: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  return createPortal(
    <div
      className="app workspace workspace-shared-chrome"
      data-shared-chrome=""
    >
      {header}
      <dialog
        ref={dialog}
        className="workspace-navigation-dialog"
        aria-label="Workspace navigation"
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {navigation}
        <button
          type="button"
          className="icon-button workspace-navigation-close"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </dialog>
    </div>,
    host,
  );
}

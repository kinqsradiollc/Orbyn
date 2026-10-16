import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Shared controls stay outside either retained pane's hidden/inert subtree. */
export function SharedNarrowChrome({
  host,
  header,
  navigation,
  open,
  onClose,
  phone = true,
  railed = false,
  navigationWidth = 224,
}: {
  host: HTMLElement;
  phone?: boolean;
  railed?: boolean;
  navigationWidth?: number;
  header: ReactNode;
  navigation: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (phone && open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open, phone]);
  useEffect(() => {
    const duo = host.parentElement;
    if (!duo) return;
    duo.style.setProperty(
      "--shared-navigation-width",
      `${phone ? 0 : navigationWidth}px`,
    );
    return () => {
      duo.style.removeProperty("--shared-navigation-width");
    };
  }, [host, phone, navigationWidth]);
  return createPortal(
    <div
      className={`app workspace workspace-shared-chrome${!phone && railed ? " is-railed" : ""}`}
      style={
        { "--workspace-sidebar-width": `${navigationWidth}px` } as CSSProperties
      }
      data-shared-chrome=""
    >
      {header}
      {!phone && navigation}
      {phone && (
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
      )}
    </div>,
    host,
  );
}

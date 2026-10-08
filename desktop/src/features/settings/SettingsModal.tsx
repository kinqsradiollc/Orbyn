import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./settings-modal.css";

/** One-time recovery material must be acknowledged before leaving Settings. */
export function settingsExitAllowed(): boolean {
  const marker = document.querySelector<HTMLElement>(
    ".settings-dialog [data-settings-close-guard]",
  );
  if (!marker) return true;
  marker.dispatchEvent(
    new CustomEvent("orbyn-settings-exit-blocked", { bubbles: true }),
  );
  return false;
}

const viewport = () => {
  const visual = window.visualViewport;
  return {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
    top: visual?.offsetTop ?? 0,
    left: visual?.offsetLeft ?? 0,
  };
};

/** Existing nested confirmations and portal menus keep keyboard ownership. */
export function settingsHasOverlay(root: HTMLElement): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.popover, [role="listbox"], [role="dialog"], [aria-modal="true"], .command-backdrop',
    ),
  ).some((element) => {
    if (
      element === root ||
      element.contains(root) ||
      element.closest("[inert]") ||
      !element.getClientRects().length ||
      getComputedStyle(element).visibility === "hidden"
    )
      return false;
    const surface =
      element.closest<HTMLElement>(
        ".modal-backdrop, .popover, .command-backdrop",
      ) ?? element;
    const layer = Number(getComputedStyle(surface).zIndex) || 0;
    return (
      layer > 4 ||
      (layer === 4 &&
        !!(
          root.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ))
    );
  });
}

/** Return to the opener, or visible workspace navigation after a layout change. */
export function restoreSettingsFocus(opener: HTMLElement | null): void {
  const focus = (element: HTMLElement | null) => {
    if (
      !element?.isConnected ||
      element === document.body ||
      !element.getClientRects().length ||
      element.closest("[inert], [hidden], :disabled") ||
      getComputedStyle(element).visibility !== "visible"
    )
      return false;
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  };
  if (focus(opener)) return;
  for (const control of document.querySelectorAll<HTMLElement>(
    "[data-settings-focus-return]",
  ))
    if (focus(control)) return;
}

/** Settings floats over the workspace; the open document and chat remain mounted. */
export function SettingsModal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [bounds, setBounds] = useState(viewport);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const update = () => setBounds(viewport());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    const root = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    const app = document.querySelector<HTMLElement>(".app");
    const inert = app?.inert ?? false;
    const hidden = app?.getAttribute("aria-hidden");
    const position = app?.style.position ?? "";
    const layer = app?.style.zIndex ?? "";
    const oldPopups = Array.from(
      document.querySelectorAll<HTMLElement>('.popover, [role="listbox"]'),
    )
      .filter((element) => !root.contains(element))
      .map((element) => ({
        element,
        visibility: element.style.visibility,
        inert: element.inert,
      }));
    const overflow = document.body.style.overflow;
    if (app) {
      app.inert = true;
      app.setAttribute("aria-hidden", "true");
      app.style.position = "relative";
      app.style.zIndex = "0";
    }
    for (const popup of oldPopups) {
      popup.element.style.visibility = "hidden";
      popup.element.inert = true;
    }
    document.body.style.overflow = "hidden";
    const controls = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
    const first = () =>
      root.querySelector<HTMLElement>('input[type="search"]') ??
      controls()[0] ??
      root;
    first().focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || settingsHasOverlay(root)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (settingsExitAllowed()) close.current();
      } else if (
        event.key === "Tab" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const all = controls();
        const first = all[0] ?? root;
        const last = all.at(-1) ?? root;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !root.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !root.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (!root.contains(event.target as Node) && !settingsHasOverlay(root))
        first().focus({ preventScroll: true });
    };
    const blocked = (event: Event) => {
      const marker = event.target as HTMLElement;
      setNotice(
        marker.dataset.settingsCloseGuard ??
          "Finish this setup before leaving Settings.",
      );
      marker
        .closest(".settings-section")
        ?.querySelector<HTMLElement>(
          '.settings-section-head[aria-expanded="false"]',
        )
        ?.click();
      requestAnimationFrame(() => {
        marker.scrollIntoView({ block: "center" });
        marker.querySelector<HTMLElement>("button")?.focus();
      });
    };
    const observer = new MutationObserver(() => {
      if (!root.querySelector("[data-settings-close-guard]")) setNotice("");
    });
    observer.observe(root, { childList: true, subtree: true });
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    root.addEventListener("orbyn-settings-exit-blocked", blocked);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
      root.removeEventListener("orbyn-settings-exit-blocked", blocked);
      observer.disconnect();
      document.body.style.overflow = overflow;
      if (app) {
        app.inert = inert;
        app.style.position = position;
        app.style.zIndex = layer;
        if (hidden == null) app.removeAttribute("aria-hidden");
        else app.setAttribute("aria-hidden", hidden);
      }
      for (const popup of oldPopups) {
        popup.element.style.visibility = popup.visibility;
        popup.element.inert = popup.inert;
      }
      restoreSettingsFocus(opener);
    };
  }, []);
  const dismiss = () => {
    if (settingsExitAllowed()) close.current();
  };
  return createPortal(
    <div
      className="modal-backdrop settings-backdrop"
      style={{
        width: bounds.width,
        height: bounds.height,
        top: bounds.top,
        left: bounds.left,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        ref={dialog}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <header className="settings-dialog-header">
          <h2 id={id}>Settings</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={dismiss}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {notice && (
          <p className="settings-dialog-notice" role="alert">
            {notice}
          </p>
        )}
        <div className="settings-dialog-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

import { useEffect, useId, useRef } from "react";
import { hasHigherDialog } from "../lib/dialogLayers";

const controls =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], select:not(:disabled), summary, [tabindex="0"]';

/** Keyboard ownership for an editor, including explicitly owned floating pickers. */
export function useModalFocus(onClose: () => void, busy = false) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>(controls)).filter(
        (node) =>
          !node.closest("[hidden], [inert]") &&
          node.getClientRects().length > 0,
      );
    const focusFirst = () =>
      (items()[0] ?? root).focus({ preventScroll: true });
    const ownedPicker = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target.closest("[data-modal-owner]")?.getAttribute("data-modal-owner") ===
        id;
    if (!root.contains(document.activeElement)) focusFirst();
    const onFocus = (event: FocusEvent) => {
      if (
        !hasHigherDialog(root) &&
        !root.contains(event.target as Node) &&
        !ownedPicker(event.target)
      )
        focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        hasHigherDialog(root) ||
        ownedPicker(event.target)
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.onClose();
      } else if (event.key === "Tab") {
        const choices = items();
        const first = choices[0],
          last = choices.at(-1);
        if (!first) {
          event.preventDefault();
          root.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !root.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
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
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      const previous = opener.current;
      if (previous?.isConnected && !previous.closest("[inert], [hidden]"))
        previous.focus({ preventScroll: true });
    };
  }, [id]);
  return { id, ref };
}

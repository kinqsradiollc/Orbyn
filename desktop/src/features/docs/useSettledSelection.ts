import { useEffect, useRef, type RefObject } from "react";
import { createDocSelectionSettler } from "@orbyn/core";

export function useSettledSelection<T>(
  root: RefObject<HTMLElement | null>,
  read: () => T | null,
  publish: (value: T | null) => void,
  enabled = true,
) {
  const latest = useRef({ read, publish });
  latest.current = { read, publish };
  useEffect(() => {
    if (!enabled) {
      latest.current.publish(null);
      return;
    }
    const controller = createDocSelectionSettler(
      () => latest.current.read(),
      (value) => latest.current.publish(value),
      (callback, delay) => {
        const timer = window.setTimeout(callback, delay);
        return () => window.clearTimeout(timer);
      },
    );
    const owns = (event: Event) =>
      event.target instanceof Node &&
      !!root.current?.contains(event.target) &&
      !(
        event.target instanceof Element &&
        event.target.closest(".doc-selection-bar, .doc-excerpt-actions")
      );
    const start = (event: Event) => {
      if (owns(event)) controller.start();
    };
    const end = () => controller.finish();
    const cancel = () => controller.cancel();
    const change = () => controller.change();
    const keydown = (event: KeyboardEvent) => {
      if (
        owns(event) &&
        (event.shiftKey ||
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(event.key))
      )
        controller.start();
    };
    document.addEventListener("pointerdown", start, true);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("selectionchange", change);
    document.addEventListener("select", change, true);
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", end);
    document.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      controller.dispose();
      document.removeEventListener("pointerdown", start, true);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("selectionchange", change);
      document.removeEventListener("select", change, true);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", end);
      document.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [root, enabled]);
}

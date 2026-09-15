import { useEffect, useRef } from "react";

/**
 * Adds `is-visible` once to each `.reveal` element inside the returned ref's
 * element when it scrolls into view. One observer for the whole container.
 * Without IntersectionObserver, or under reduced motion, everything is shown
 * straight away.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const targets = ref.current?.querySelectorAll<HTMLElement>(".reveal");
    if (!targets?.length) return;
    const show = (el: Element) => el.classList.add("is-visible");
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      targets.forEach(show);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return ref;
}

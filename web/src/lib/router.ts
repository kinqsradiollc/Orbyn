import { useEffect, useSyncExternalStore } from "react";

const NAVIGATE = "orbyn:navigate";

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE, listener);
  };
};

export const usePath = () =>
  useSyncExternalStore(subscribe, () => location.pathname);
export const useSearch = () =>
  useSyncExternalStore(subscribe, () => location.search);

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new Event(NAVIGATE));
  window.scrollTo(0, 0);
}

/** Matches "/app/doc/:id" against a path, returning its parameters. */
export function match(pattern: string, path: string) {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) params[want[i].slice(1)] = have[i];
    else if (want[i] !== have[i]) return null;
  }
  return params;
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Orbyn` : "Orbyn";
  }, [title]);
}

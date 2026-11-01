import { useSyncExternalStore } from "react";
const KEY = "orbyn-tabs-enabled",
  EVENT = "orbyn:tabs-setting";
function read() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
let enabled = read();
const listeners = new Set<() => void>();
const refresh = () => {
  const next = read();
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((listener) => listener());
};
window.addEventListener(EVENT, refresh);
window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) refresh();
});
/** The existing device choice controls chrome, never controller or draft lifetime. */
export const tabsPreferenceEnabled = () => enabled;
export function useTabsPreference() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    refresh();
    return () => {
      listeners.delete(listener);
    };
  }, tabsPreferenceEnabled);
}

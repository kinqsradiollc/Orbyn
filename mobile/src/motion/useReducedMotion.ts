import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The system "Reduce Motion" setting, read once at startup and kept current.
 * Module-level so every animation can read it synchronously on first render
 * (no flash of motion before the async lookup resolves on later mounts).
 */
let reduced = false;
const listeners = new Set<(value: boolean) => void>();

const set = (value: boolean) => {
  reduced = value;
  listeners.forEach((listener) => listener(value));
};

AccessibilityInfo.isReduceMotionEnabled()
  .then(set)
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", set);

/** Current value without subscribing; for helpers outside components. */
export const isReducedMotion = () => reduced;

/** True when the user asked the OS to reduce motion. Skip animations then. */
export function useReducedMotion() {
  const [value, setValue] = useState(reduced);
  useEffect(() => {
    listeners.add(setValue);
    setValue(reduced);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

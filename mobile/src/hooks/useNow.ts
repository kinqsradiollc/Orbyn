import { useEffect, useState } from "react";

/**
 * The current time, updated every `intervalMs` while `enabled`. One timer per
 * caller, cleared on unmount; nothing is fetched.
 */
export function useNow(intervalMs = 30_000, enabled = true) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

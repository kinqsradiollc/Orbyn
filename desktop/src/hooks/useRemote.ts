import { useEffect, useRef, useState, type DependencyList } from "react";

/**
 * Fetch `load()` whenever `deps` change and keep the latest result. Stale
 * responses are dropped; failures go to `onError` (usually `planner.report`).
 */
export function useRemote<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  onError: (e: unknown) => void,
) {
  const [data, setData] = useState<T | null>(null);
  const latest = useRef({ load, onError });
  latest.current = { load, onError };

  useEffect(() => {
    let alive = true;
    latest.current.load().then(
      (d) => {
        if (alive) setData(d);
      },
      (e) => {
        if (alive) latest.current.onError(e);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return data;
}

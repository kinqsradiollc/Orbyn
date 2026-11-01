import { useCallback, useLayoutEffect, useRef } from "react";
import { getSessionVersion } from "../../lib/session";

/** Async work may only update the mounted session that started it. */
export function useStudyOwner() {
  const owner = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && getSessionVersion() === owner,
    [owner],
  );
}

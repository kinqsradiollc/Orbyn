import { useCallback, useLayoutEffect, useRef } from "react";
import { getSessionVersion } from "../../lib/session";

/** Async work belongs to the account and mounted screen that opened it.
 * Check before dispatch and after awaits. Global toast actions that intentionally
 * survive route departure capture the session generation separately.
 */
export function useLibraryOwner(): () => boolean {
  const generation = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && generation === getSessionVersion(),
    [generation],
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../lib/errors";

/**
 * Busy and error state for a sheet or card that talks to the server on its
 * own, so its errors show where the user is looking. `run` resolves with the
 * result, or undefined when the call failed (the message is in `error`).
 */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError("");
      try {
        return await fn();
      } catch (e) {
        if (alive.current) setError(errorText(e));
        return undefined;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, setError, run };
}

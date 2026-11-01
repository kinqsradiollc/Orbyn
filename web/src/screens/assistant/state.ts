import { HttpError } from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { useOwned } from "../agents-shared/hooks";

/** A view-owned read. Failed permission checks remove the old authorized payload. */
export function useRead<T>(
  read: () => Promise<T>,
  deps: readonly unknown[] = [],
) {
  const owned = useOwned();
  const loader = useRef(read);
  loader.current = read;
  const sequence = useRef(0);
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!owned()) return;
    const mine = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const value = await loader.current();
      if (!owned() || mine !== sequence.current) return;
      setData(value);
      return value;
    } catch (failure) {
      if (owned() && mine === sequence.current) {
        setData(undefined);
        setError(messageOf(failure, "Couldn't load this. Try again."));
      }
    } finally {
      if (owned() && mine === sequence.current) setLoading(false);
    }
  }, [owned]);
  useEffect(() => {
    setData(undefined);
    void reload();
    return () => {
      sequence.current++;
    };
    // Resources have explicit invocation identities, independent of render callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
export const unclear = (failure: unknown) =>
  !(failure instanceof HttpError) ||
  failure.statusCode >= 500 ||
  [408, 429].includes(failure.statusCode);
export const timezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

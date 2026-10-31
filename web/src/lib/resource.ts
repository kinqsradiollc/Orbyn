import { useCallback, useEffect, useRef, useState } from "react";

export type Resource<T> = {
  data: T | undefined;
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
  /** Change the loaded value locally, for optimistic updates. */
  set: (update: (current: T | undefined) => T | undefined) => void;
};

export const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * One server read. Only the newest request may write its result, so a slow
 * old answer can't replace a newer one or fill in a screen that has moved on.
 * A failed refresh keeps what is showing.
 */
export function useResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await loader.current();
      if (id !== request.current) return;
      setData(next);
      setError("");
    } catch (failure) {
      if (id === request.current)
        setError(messageOf(failure, "Couldn't load this."));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, set: setData };
}

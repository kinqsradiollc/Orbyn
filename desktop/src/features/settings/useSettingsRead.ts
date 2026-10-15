import { useCallback, useEffect, useRef, useState } from "react";
import { session } from "../../lib/session";

/** Local read recovery with mounted-account and latest-request ownership. */
export function useSettingsRead<T>(
  load: () => Promise<T>,
  report: (error: unknown) => void,
) {
  const account = session.get();
  const mounted = useRef(true);
  const request = useRef(0);
  const latest = useRef({ load, report });
  latest.current = { load, report };
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = useCallback(
    () => mounted.current && session.get() === account,
    [account],
  );
  const reload = useCallback(async () => {
    if (!current()) return;
    const ticket = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const value = await latest.current.load();
      if (current() && ticket === request.current) setData(value);
    } catch (error) {
      if (current() && ticket === request.current) {
        setFailed(true);
        if ((error as { status?: number } | null)?.status === 401)
          latest.current.report(error);
      }
    } finally {
      if (current() && ticket === request.current) setLoading(false);
    }
  }, [current]);
  useEffect(() => {
    mounted.current = true;
    setData(null);
    void reload();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [reload]);
  const commit = useCallback(
    (value: T | ((previous: T | null) => T | null)) => {
      if (!current()) return;
      request.current++;
      setLoading(false);
      setFailed(false);
      setData(value);
    },
    [current],
  );
  return { data, commit, loading, failed, reload, current };
}

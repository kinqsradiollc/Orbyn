import { HttpError } from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { onForeground, onLive, useOwned } from "../agents-shared/hooks";

type Snapshot<T> = {
  data: T | null;
  loading: boolean;
  fresh: boolean;
  error: string;
};

/** A selected Review resource owns its reads; event bursts get one trailing read. */
export function useReviewRead<T>(
  load: () => Promise<T>,
  paused?: () => boolean,
) {
  const owned = useOwned();
  const loader = useRef(load);
  loader.current = load;
  const pause = useRef(paused);
  pause.current = paused;
  const epoch = useRef(0);
  const flight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const [state, setState] = useState<Snapshot<T>>({
    data: null,
    loading: true,
    fresh: false,
    error: "",
  });
  const invalidate = useCallback(() => {
    epoch.current++;
    again.current = false;
    if (owned()) setState((old) => ({ ...old, fresh: false }));
  }, [owned]);
  const reload = useCallback((): Promise<void> => {
    if (!owned()) return Promise.resolve();
    if (pause.current?.()) {
      again.current = true;
      return Promise.resolve();
    }
    if (flight.current) {
      again.current = true;
      return flight.current;
    }
    const mine = ++epoch.current;
    setState((old) => ({ ...old, loading: true, fresh: false, error: "" }));
    const task = Promise.resolve()
      .then(() => {
        if (!owned() || mine !== epoch.current) return null;
        return loader.current();
      })
      .then(
        (data) => {
          if (data !== null && owned() && mine === epoch.current)
            setState({ data, loading: false, fresh: true, error: "" });
        },
        (failure) => {
          if (!owned() || mine !== epoch.current) return;
          const unavailable =
            failure instanceof HttpError &&
            [401, 403, 404, 410].includes(failure.statusCode);
          setState((old) => ({
            data: unavailable ? null : old.data,
            loading: false,
            fresh: false,
            error: messageOf(failure, "Couldn't load Review. Try again."),
          }));
        },
      )
      .finally(() => {
        if (flight.current !== task) return;
        flight.current = null;
        if (again.current && owned() && !pause.current?.()) {
          again.current = false;
          void reload();
        }
      });
    flight.current = task;
    return task;
  }, [owned]);
  useEffect(() => {
    void reload();
    const stopLive = onLive((news) => {
      // A proposal can touch any workspace domain. Target edits and permission
      // changes must refresh its stale/access checks, not only inbox changes.
      if (news.kind === "changed" && !document.hidden) void reload();
    });
    const stopForeground = onForeground(() => void reload());
    return () => {
      epoch.current++;
      again.current = false;
      stopLive();
      stopForeground();
    };
  }, [reload]);
  return {
    ...state,
    reload,
    invalidate,
    pending: () => flight.current !== null,
  };
}

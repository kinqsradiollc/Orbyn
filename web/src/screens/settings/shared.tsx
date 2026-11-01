import { HttpError, sectionKey } from "@orbyn/core";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { messageOf } from "../../lib/resource";
import { getSessionVersion, getToken } from "../../lib/session";

export type SettingsExit = {
  dirty?: boolean;
  pending?: boolean;
  /** Material or uncertain outcomes the person must resolve before leaving. */
  sensitive?: boolean;
  message?: string;
};
export const SettingsExitContext = createContext<
  (read: () => SettingsExit) => () => void
>(() => () => {});

/** The registry reads current render state, rather than effect-delayed copies. */
export function useSettingsExit(state: SettingsExit) {
  const register = useContext(SettingsExitContext);
  const current = useRef(state);
  current.current = state;
  useLayoutEffect(() => register(() => current.current), [register]);
}

export function useSettingsOwner() {
  const owner = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && !!getToken() && getSessionVersion() === owner,
    [owner],
  );
}

/** A confirmed mutation fences older reads before installing its receipt. */
export function useSettingsRead<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
) {
  const owned = useSettingsOwner();
  const loader = useRef(load);
  loader.current = load;
  const revision = useRef(0);
  const [state, setState] = useState<{
    data: T | undefined;
    loading: boolean;
    error: string;
    fresh: boolean;
  }>({ data: undefined, loading: true, error: "", fresh: false });
  const reload = useCallback(async () => {
    if (!owned()) return;
    const mine = ++revision.current;
    setState((old) => ({ ...old, loading: true, fresh: false, error: "" }));
    try {
      const data = await loader.current();
      if (owned() && mine === revision.current)
        setState({ data, loading: false, error: "", fresh: true });
    } catch (failure) {
      if (!owned() || mine !== revision.current) return;
      const revoked =
        failure instanceof HttpError &&
        [401, 403, 404, 410].includes(failure.statusCode);
      setState((old) => ({
        data: revoked ? undefined : old.data,
        loading: false,
        error: messageOf(failure, "Couldn't load these settings. Try again."),
        fresh: false,
      }));
    }
  }, [owned]);
  const commit = useCallback(
    (data: T) => {
      revision.current++;
      if (owned()) setState({ data, loading: false, error: "", fresh: true });
    },
    [owned],
  );
  const invalidate = useCallback(() => {
    revision.current++;
    if (owned()) setState((old) => ({ ...old, loading: false, fresh: false }));
  }, [owned]);
  useLayoutEffect(() => {
    revision.current++;
    setState({ data: undefined, loading: true, error: "", fresh: false });
    void reload();
    return () => {
      revision.current++;
    };
    // Each caller supplies the identity of the represented resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);
  return { ...state, reload, commit, invalidate };
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const key = sectionKey(title);
  const id = `settings-${key.replaceAll(" ", "-")}`;
  return (
    <section
      className="settings-section"
      id={id}
      data-settings-section={key}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
    >
      <header>
        <h3 id={`${id}-title`}>{title}</h3>
        {description && <p className="muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}

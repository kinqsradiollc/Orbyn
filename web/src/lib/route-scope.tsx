import {
  useCallback,
  useLayoutEffect,
  useRef,
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type RouteSnapshot = {
  pathname: string;
  search: string;
  hash: string;
  activation: number;
  /** Authored/native intent in this presentation; metadata and timer ticks do not advance it. */
  inputEpoch?: number;
  visible: boolean;
  focused: boolean;
};
export type RouteResult =
  | { kind: "committed"; activation: number }
  | { kind: "refused"; reason: string }
  | { kind: "superseded" };
export type LeaveGuard = (destination: string) => boolean | Promise<boolean>;
export type RouteScope = {
  originScope?: RouteScope;
  commandScope?: RouteScope;
  closeOverlay?(): Promise<RouteResult>;
  noteInput?(): void;
  registerPortal?(): () => void;
  hasPortal?(): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): RouteSnapshot;
  navigate(to: string, replace?: boolean): Promise<RouteResult>;
  addGuard(guard: LeaveGuard): () => void;
  activateNavigate?(to: string, replace?: boolean): Promise<RouteResult>;
  setTitle(title: string): () => void;
};
const Context = createContext<RouteScope | null>(null);
export const useRouteScope = () => useContext(Context);

/** Platform-neutral injection: router never imports app/workspace. */
export function RouteScopeProvider({
  value,
  children,
}: {
  value: RouteScope | null;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const unscopedActivity = { visible: true, focused: true };
const noopSubscribe = () => () => {};
/** Portal and global-key consumers use the originating scope, never whichever pane is focused later. */
export function useRouteActivity() {
  const scope = useRouteScope();
  return useSyncExternalStore(scope?.subscribe ?? noopSubscribe, () =>
    scope ? scope.getSnapshot() : unscopedActivity,
  );
}

/** Input authority is read synchronously at the event, rather than from a stale render. */
export function useRouteInput() {
  const scope = useRouteScope();
  return useCallback(
    () =>
      !scope || (scope.getSnapshot().visible && scope.getSnapshot().focused),
    [scope],
  );
}

/** Caller owns whether its portal is an active input presentation and when an explicit clean close retires it. */
export function useRoutePortal(active: boolean) {
  const scope = useRouteScope(),
    release = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (!active) return;
    const lease = scope?.registerPortal?.();
    release.current = lease;
    return () => {
      lease?.();
      if (release.current === lease) release.current = undefined;
    };
  }, [scope, active]);
  return useCallback(() => {
    release.current?.();
    release.current = undefined;
  }, []);
}

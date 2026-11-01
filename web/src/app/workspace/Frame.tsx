import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { RouteScopeProvider, type RouteSnapshot } from "../../lib/route-scope";
import {
  type FrameLease,
  type FrameOwner,
  type FrameRecord,
  WorkspaceController,
} from "./controller";

const Context = createContext<{
  controller: WorkspaceController;
  lease: FrameLease;
} | null>(null);
export function useWorkspaceFrame() {
  const frame = useContext(Context);
  if (!frame) throw new Error("This action needs a workspace frame.");
  return frame;
}
type FrameActivity = RouteSnapshot & { documentVisible: boolean };
const Activity = createContext<FrameActivity | null>(null);
const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
export function useFrameActivity() {
  return useContext(Activity);
}

/** Frame is keyed by lease.mount, not pathname alone. Parents render visited frames, including hidden ones. */
export function WorkspaceFrame({
  controller,
  frame,
  owner,
  children,
}: {
  controller: WorkspaceController;
  frame: FrameRecord;
  owner: FrameOwner;
  children: ReactNode;
}) {
  const scope = useMemo(
    () => controller.routeScope(frame.lease),
    [controller, frame.lease],
  );
  const route = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const documentVisible = useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
  );
  const activity = useMemo(
    () => ({ ...route, documentVisible }),
    [route, documentVisible],
  );
  const latestOwner = useRef(owner);
  latestOwner.current = owner;
  useLayoutEffect(
    () =>
      controller.register(frame.lease, {
        prepare: (reason, destination) =>
          latestOwner.current.prepare(reason, destination),
        blocksParking: () => latestOwner.current.blocksParking(),
        focus: () => latestOwner.current.focus?.(),
      }),
    [controller, frame.lease],
  );
  useLayoutEffect(() => {
    if (route.visible && route.focused && controller.owns(frame.lease))
      latestOwner.current.focus?.();
  }, [controller, frame.lease, route.visible, route.focused, route.activation]);
  const value = useMemo(
    () => ({ controller, lease: frame.lease }),
    [controller, frame.lease],
  );
  return (
    <Context.Provider value={value}>
      <RouteScopeProvider value={scope}>
        <Activity.Provider value={activity}>
          <section
            hidden={!route.visible}
            inert={!route.visible}
            data-workspace-frame={frame.lease.tabKey}
            onInputCapture={() => scope.noteInput?.()}
            onClickCapture={() => scope.noteInput?.()}
          >
            {children}
          </section>
        </Activity.Provider>
      </RouteScopeProvider>
    </Context.Provider>
  );
}

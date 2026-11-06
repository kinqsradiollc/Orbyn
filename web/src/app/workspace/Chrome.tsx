import { LibraryLaunchCommands } from "../controls/LibraryLaunchCommands";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  RouteScopeProvider,
  type RouteScope,
  type RouteSnapshot,
} from "../../lib/route-scope";
import { Shell } from "../Shell";
import { WorkspaceController } from "./controller";
import { WorkspaceProjectChat } from "./ProjectChat";
const inactive = {
  pathname: "/app",
  search: "",
  hash: "",
  activation: 0,
  visible: false,
  focused: false,
};
/** Chrome actions bind to a working lease; a dock keeps its captured working origin. */
export function WorkspaceChrome({
  controller,
  children,
}: {
  controller: WorkspaceController;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const focused = snapshot.frames.find(
    (frame) =>
      frame.lease.pane === snapshot.focused &&
      frame.lease.tabKey ===
        (snapshot.focused === "dock"
          ? snapshot.dockActive
          : snapshot[snapshot.focused]?.active),
  );
  const working =
    focused?.lease.pane === "dock"
      ? snapshot.frames.find(
          (frame) =>
            focused.origin &&
            frame.lease.pane === focused.origin.pane &&
            frame.lease.tabKey === focused.origin.tabKey &&
            frame.lease.mount === focused.origin.mount,
        )
      : focused;
  const scope = useMemo<RouteScope>(() => {
    if (!working)
      return {
        subscribe: controller.subscribe,
        getSnapshot: () => inactive,
        navigate: async () => ({
          kind: "refused",
          reason:
            "The originating working tab has closed. Choose a working pane first.",
        }),
        addGuard: () => () => {},
        setTitle: () => () => {},
      };
    const base = controller.routeScope(working.lease);
    let previous: RouteSnapshot | null = null,
      projected: RouteSnapshot = inactive;
    return {
      ...base,
      originScope: base,
      commandScope: focused ? controller.routeScope(focused.lease) : base,
      getSnapshot: () => {
        const next = base.getSnapshot();
        if (next !== previous) {
          previous = next;
          const owned = controller.owns(working.lease);
          projected = { ...next, visible: owned, focused: owned };
        }
        return projected;
      },
      navigate: (href, replace) =>
        (base.activateNavigate ?? base.navigate)(href, replace),
    };
  }, [controller, working?.lease, focused?.lease]);
  const prepareSignOut = async () => {
    const permission = await controller.prepareAll("sign-out");
    return permission;
  };
  const shell = (
    <Shell
      prepareSignOut={prepareSignOut}
      controller={controller}
      origin={working?.lease}
    >
      <WorkspaceProjectChat controller={controller}>
        {children}
      </WorkspaceProjectChat>
    </Shell>
  );
  // A closed/missing dock origin must never silently reroute an action to primary.
  return (
    <RouteScopeProvider value={scope}>
      <RouteScopeProvider value={scope.commandScope ?? scope}>
        <LibraryLaunchCommands
          controller={controller}
          origin={working?.lease}
        />
      </RouteScopeProvider>
      {shell}
    </RouteScopeProvider>
  );
}

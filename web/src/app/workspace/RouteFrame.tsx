import {
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { APP_ROUTES, type Route } from "../routes";
import { match } from "../../lib/router";
import { Empty, Loading } from "../../ui/kit";
import { WorkspaceFrame } from "./Frame";
import {
  WorkspaceController,
  type FrameOwner,
  type FrameRecord,
} from "./controller";
import type { RouteResult } from "../../lib/route-scope";
/** Feature drafts/mutations register their actual scoped leave guards; this host owns only the DOM lifetime. */
export function WorkspaceRouteFrame({
  controller,
  frame,
  report,
}: {
  controller: WorkspaceController;
  frame: FrameRecord;
  report(result: RouteResult): void;
}) {
  const body = useRef<HTMLDivElement>(null),
    lastFocus = useRef<HTMLElement | null>(null),
    ready = useRef(false);
  const scope = useMemo(
    () => controller.routeScope(frame.lease),
    [controller, frame.lease],
  );
  const owner = useRef<FrameOwner>({
    prepare: async () => ready.current && !(scope.hasPortal?.() ?? false),
    blocksParking: () => scope.hasPortal?.() ?? false,
    focus: () => {
      const prior = lastFocus.current;
      if (
        prior?.isConnected &&
        body.current?.contains(prior) &&
        !prior.closest("[inert]")
      )
        prior.focus({ preventScroll: true });
      else body.current?.focus({ preventScroll: true });
    },
  }).current;
  const hit = APP_ROUTES.map((route) => ({
    route,
    params: match(route.path, frame.destination.pathname),
  })).find((one) => one.params !== null);
  const onReady = useRef((value: boolean) => {
    ready.current = value;
  }).current;
  return (
    <WorkspaceFrame controller={controller} frame={frame} owner={owner}>
      <div
        ref={body}
        tabIndex={-1}
        className="workspace-frame-content"
        onPointerDownCapture={() =>
          void controller.focus(frame.lease).then(report)
        }
        onFocusCapture={(event) => {
          lastFocus.current = event.target as HTMLElement;
          void controller.focus(frame.lease).then(report);
        }}
      >
        <Suspense
          fallback={
            <Loading
              label={`Opening ${frame.title || frame.destination.view}`}
            />
          }
        >
          {hit && hit.params ? (
            <ReadyRoute
              route={hit.route}
              params={hit.params}
              onReady={onReady}
            />
          ) : (
            <ReadyEmpty onReady={onReady}>
              <Empty title="This page doesn't exist" />
            </ReadyEmpty>
          )}
        </Suspense>
      </div>
    </WorkspaceFrame>
  );
}
function ReadyRoute({
  route,
  params,
  onReady,
}: {
  route: Route;
  params: Record<string, string>;
  onReady(value: boolean): void;
}) {
  useLayoutEffect(() => {
    onReady(true);
    return () => onReady(false);
  }, [onReady]);
  return <route.screen params={params} />;
}
function ReadyEmpty({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady(value: boolean): void;
}) {
  useLayoutEffect(() => {
    onReady(true);
    return () => onReady(false);
  }, [onReady]);
  return children;
}

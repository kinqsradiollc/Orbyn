import { useMemo, useRef, useState, type ReactNode } from "react";
import { RouteScopeProvider } from "../../lib/route-scope";
import { PageScreen } from "../../screens/library/page/PageScreen";
import { UploadsProvider } from "../../screens/library/Uploads";
import { useLibraryFeed } from "../../screens/library/store";
import { Library } from "../../screens/library/Library";
import { WorkspaceFrame } from "./Frame";
import {
  type FrameRecord,
  type FrameOwner,
  WorkspaceController,
} from "./controller";
import type { RouteResult } from "../../lib/route-scope";
import "../../screens/library/library.css";

/** Library routes use their real editor settlement owner; other routes use the generic frame. */
export function libraryDestination(path: string) {
  return /^\/app\/(?:docs|doc\/[A-Za-z0-9_-]{1,160}|memory|agent-notes)$/.test(
    path,
  );
}
export function LibraryWorkspaceFrame({
  controller,
  frame,
  report,
}: {
  controller: WorkspaceController;
  frame: FrameRecord;
  report(result: RouteResult): void;
}) {
  const settle = useRef<null | (() => Promise<boolean>)>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const reportSettle = useRef((next: (() => Promise<boolean>) | null) => {
    settle.current = next;
  }).current;
  const modalOpen = () => base.hasPortal?.() ?? false;
  const owner = useRef<FrameOwner>({
    prepare: async () => {
      // A current editor must provide its actual settlement; unrelated overlay portals
      // belong to their own scope and cannot block or settle this frame.
      const captured = settle.current;
      if (modalOpen()) return false;
      if (!captured) return frame.destination.id === null;
      const result = await captured();
      return result && captured === settle.current && !modalOpen();
    },
    blocksParking: modalOpen,
    focus: () => {
      const target = lastFocus.current;
      if (target?.isConnected && body.current?.contains(target))
        target.focus({ preventScroll: true });
      else body.current?.focus({ preventScroll: true });
    },
  }).current;
  const base = useMemo(
    () => controller.routeScope(frame.lease),
    [controller, frame.lease],
  );
  const scope = useMemo(
    () => ({
      ...base,
      originScope: base,
      navigate: async (href: string, replace = false): Promise<RouteResult> => {
        const result = await base.navigate(href, replace);
        if (controller.owns(frame.lease)) report(result);
        return result;
      },
    }),
    [base, controller, frame.lease, report],
  );
  const fixedKind =
    frame.destination.pathname === "/app/memory"
      ? "memory"
      : frame.destination.pathname === "/app/agent-notes"
        ? "agent"
        : undefined;
  const dock = frame.lease.pane === "dock";
  const railToggle: ReactNode = null;
  return (
    <WorkspaceFrame controller={controller} frame={frame} owner={owner}>
      <RouteScopeProvider value={scope}>
        <div
          className="workspace-frame-content"
          ref={body}
          tabIndex={-1}
          onPointerDownCapture={() =>
            void controller.focus(frame.lease).then(report)
          }
          onFocusCapture={(event) => {
            lastFocus.current = event.target as HTMLElement;
            void controller.focus(frame.lease).then(report);
          }}
        >
          {dock && frame.destination.id ? (
            <DockPage
              id={frame.destination.id}
              railToggle={railToggle}
              reportSettle={reportSettle}
            />
          ) : (
            <Library
              fixedKind={fixedKind}
              pageId={frame.destination.id ?? undefined}
              onSettle={reportSettle}
            />
          )}
        </div>
      </RouteScopeProvider>
    </WorkspaceFrame>
  );
}

function DockPage({
  id,
  railToggle,
  reportSettle,
}: {
  id: string;
  railToggle: ReactNode;
  reportSettle(settle: (() => Promise<boolean>) | null): void;
}) {
  useLibraryFeed();
  const [wide, setWide] = useState(false);
  return (
    <UploadsProvider>
      <div className="workspace-dock-page" data-wide={wide || undefined}>
        <PageScreen
          id={id}
          railToggle={railToggle}
          onWorkspaceWide={setWide}
          onSettle={reportSettle}
        />
      </div>
    </UploadsProvider>
  );
}

import { LibraryViewProvider } from "../../screens/library/view";
import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  useState,
  useRef,
} from "react";
import { ErrorNotice } from "../../ui/kit";
import type { RouteResult } from "../../lib/route-scope";
import { WorkspaceRouteFrame } from "./RouteFrame";
import { LibraryWorkspaceFrame, libraryDestination } from "./LibraryFrame";
import { WorkspaceController, type FrameRecord } from "./controller";
import { WorkspaceTools, WorkspaceTabs, WorkspaceDockTabs } from "./Controls";
import "./workspace.css";
const key = (frame: FrameRecord) =>
  `${frame.lease.pane}:${frame.lease.tabKey}:${frame.lease.mount}`;
/** Retained DOM surface only. Root Shell/TaskHost/overlays remain outside, exactly once. */
export function WorkspaceSurface({
  controller,
}: {
  controller: WorkspaceController;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [notice, setNotice] = useState("");
  const working = useRef<HTMLDivElement>(null);
  const report = useCallback((result: RouteResult) => {
    if (result.kind === "refused") setNotice(result.reason);
    else if (result.kind === "committed") setNotice("");
  }, []);
  const currentFrame = (pane: "primary" | "secondary") =>
    snapshot.frames.find(
      (frame) =>
        frame.lease.pane === pane &&
        frame.lease.tabKey === snapshot[pane]?.active,
    );
  const primary = currentFrame("primary");
  useEffect(() => {
    if (!primary || !controller.owns(primary.lease)) return;
    const title =
      primary.title || primary.destination.title || primary.destination.view;
    document.title = title ? `${title} · Orbyn` : "Orbyn";
  }, [controller, primary]);
  useEffect(() => {
    const node = working.current;
    if (!node) return;
    const apply = () => {
      const current = controller.getSnapshot();
      const frame = current.frames.find(
        (one) =>
          one.lease.pane === "primary" &&
          one.lease.tabKey === current.primary.active,
      );
      if (!frame || !current.secondary) return;
      const narrow = node.getBoundingClientRect().width < 960;
      const next = narrow
        ? current.focused === "secondary"
          ? "secondary"
          : current.focused === "dock" && current.presentation === "secondary"
            ? "secondary"
            : "primary"
        : "both";
      if (current.presentation !== next)
        void controller.present(frame.lease, next).then(report);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [controller, report, snapshot.focused, !!snapshot.secondary]);
  const render = (frame: FrameRecord) => (
    <LibraryViewProvider
      key={`${frame.lease.pane}:${frame.lease.tabKey}`}
      search={
        libraryDestination(frame.destination.pathname)
          ? frame.destination.search
          : ""
      }
    >
      {libraryDestination(frame.destination.pathname) ? (
        <LibraryWorkspaceFrame
          key={key(frame)}
          controller={controller}
          frame={frame}
          report={report}
        />
      ) : (
        <WorkspaceRouteFrame
          key={key(frame)}
          controller={controller}
          frame={frame}
          report={report}
        />
      )}
    </LibraryViewProvider>
  );

  return (
    <div
      className="workspace-surface"
      data-presentation={snapshot.presentation}
    >
      {notice && <ErrorNotice message={notice} />}
      <WorkspaceTools controller={controller} onResult={report} />
      <div className="workspace-layout">
        <div className="workspace-working" ref={working}>
          <section
            className="workspace-pane"
            data-pane="primary"
            aria-label="Primary working pane"
          >
            <WorkspaceTabs
              controller={controller}
              pane="primary"
              onResult={report}
            />
            {snapshot.frames
              .filter((frame) => frame.lease.pane === "primary")
              .map(render)}
          </section>
          {snapshot.secondary && (
            <section
              className="workspace-pane"
              data-pane="secondary"
              aria-label="Secondary working pane"
            >
              <WorkspaceTabs
                controller={controller}
                pane="secondary"
                onResult={report}
              />
              {snapshot.frames
                .filter((frame) => frame.lease.pane === "secondary")
                .map(render)}
            </section>
          )}
        </div>
        <aside
          className="workspace-dock"
          aria-label="Workspace dock"
          hidden={!snapshot.dockOpen}
          inert={!snapshot.dockOpen}
        >
          <WorkspaceDockTabs controller={controller} onResult={report} />
          {snapshot.frames
            .filter((frame) => frame.lease.pane === "dock")
            .map(render)}
        </aside>
      </div>
    </div>
  );
}

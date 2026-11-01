import { useEffect, useState, type ReactNode } from "react";
import {
  browserCommitBoundary,
  installBrowserNavigationOwner,
} from "../../lib/router";
import { getSessionVersion, onToken } from "../../lib/session";
import { WorkspaceChrome } from "./Chrome";
import { prepareTaskWorkspaceExit } from "../../screens/shared-task/host-store";
import { WorkspaceController } from "./controller";
import { SettingsOwner } from "./SettingsOwner";
import { SettingsOverlay } from "./SettingsOverlay";
import { destination } from "./destination";
import { WorkspaceSurface } from "./Surface";
/** Route, editor, overlay and account owners are integrated; final client parity remains separately tracked. */
export const RETENTION_ADMISSION_READY = true;
function create(userId: string, generation: number) {
  let project: ReturnType<typeof browserCommitBoundary> = () => false;
  const browserHref = location.pathname + location.search + location.hash;
  const from: unknown =
    history.state?.orbynSettingsReturn ?? history.state?.orbynFrom;
  const proposed = typeof from === "string" ? destination(from) : null;
  const initialHref =
    destination(browserHref)?.view === "Settings"
      ? proposed && proposed.view !== "Settings"
        ? proposed.href
        : "/app"
      : browserHref;
  let settings: SettingsOwner | null = null;
  const controller = new WorkspaceController({
    userId,
    generation,
    currentGeneration: getSessionVersion,
    initialHref,
    routeInput: (...args) => settings?.routeInput(...args) ?? null,
    storage: localStorage,
    prepareGlobal: prepareTaskWorkspaceExit,
    projectBrowser: (href, replace, metadata) =>
      settings?.getSnapshot() ? false : project(href, replace, metadata),
  });
  settings = new SettingsOwner(controller, {
    current: () => generation === getSessionVersion(),
    project: (href, replace) => project(href, replace),
    initialHref: browserHref,
  });
  const overlay = settings;
  const release = installBrowserNavigationOwner(overlay);
  project = browserCommitBoundary(overlay);
  const off = onToken(() => {
    overlay.destroy();
    controller.destroy();
    release();
  });
  return {
    controller,
    settings: overlay,
    userId,
    generation,
    stop() {
      off();
      release();
      overlay.destroy();
      controller.destroy();
    },
  };
}
function EnabledWorkspace({
  userId,
  generation,
}: {
  userId: string;
  generation: number;
}) {
  const [owner, setOwner] = useState<ReturnType<typeof create> | null>(null);
  useEffect(() => {
    const next = create(userId, generation);
    setOwner(next);
    return () => next.stop();
  }, [userId, generation]);
  if (
    !owner ||
    owner.userId !== userId ||
    owner.generation !== generation ||
    generation !== getSessionVersion()
  )
    return null;
  return (
    <WorkspaceChrome controller={owner.controller}>
      <WorkspaceSurface controller={owner.controller} />
      <SettingsOverlay owner={owner.settings} />
    </WorkspaceChrome>
  );
}
/** Called only inside unchanged App account/email/Terms gates. Public/auth/OAuth never enter here. */
export function AuthenticatedWorkspace({
  userId,
  generation,
  fallback,
}: {
  userId: string;
  generation: number;
  fallback: ReactNode;
}) {
  return RETENTION_ADMISSION_READY ? (
    <EnabledWorkspace userId={userId} generation={generation} />
  ) : (
    <>{fallback}</>
  );
}

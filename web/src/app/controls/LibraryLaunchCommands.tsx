import { useEffect, useMemo, useState } from "react";
import { getSessionVersion } from "../../lib/session";
import { useRouteScope } from "../../lib/route-scope";
import { useToast } from "../../ui/kit";
import { useRouteCommands } from "./page-commands";
import {
  LibraryLaunchCoordinator,
  type LibraryAdmission,
} from "./library-launch";
import type { FrameLease, WorkspaceController } from "../workspace/controller";

/** Global fallback commands admit a real Library owner; local available callbacks take precedence. */
export function LibraryLaunchCommands({
  controller,
  origin,
}: {
  controller: WorkspaceController;
  origin?: FrameLease;
}) {
  const scope = useRouteScope(),
    toast = useToast();
  const [generation] = useState(getSessionVersion);
  const [coordinator] = useState(
    () =>
      new LibraryLaunchCoordinator(generation, (text) => {
        if (generation === getSessionVersion()) toast({ text, error: true });
      }),
  );
  useEffect(() => {
    coordinator.activate();
    return () => coordinator.destroy();
  }, [coordinator]);
  const actions = useMemo(() => {
    const admit = async (): Promise<LibraryAdmission> => {
      if (
        !origin ||
        generation !== getSessionVersion() ||
        !controller.owns(origin)
      )
        return { kind: "superseded" };
      const opening = scope?.getSnapshot();
      if (opening && (!opening.visible || !opening.focused))
        return { kind: "superseded" };
      const result = await controller.open({ origin, href: "/app/docs" });
      if (result.kind !== "committed") return result;
      if (generation !== getSessionVersion()) return { kind: "superseded" };
      const state = controller.getSnapshot();
      const tabs =
        origin.pane === "primary"
          ? state.primary
          : origin.pane === "secondary"
            ? state.secondary
            : null;
      if (
        !tabs ||
        state.focused !== origin.pane ||
        tabs.active !== origin.tabKey
      )
        return { kind: "superseded" };
      const frame = state.frames.find(
        (candidate) =>
          candidate.lease.pane === origin.pane &&
          candidate.lease.tabKey === origin.tabKey,
      );
      if (
        !frame ||
        !controller.owns(frame.lease) ||
        frame.activation !== result.activation ||
        frame.destination.href !== "/app/docs"
      )
        return { kind: "superseded" };
      const target = controller.routeScope(frame.lease);
      const fresh = target.getSnapshot();
      if (
        !fresh.visible ||
        !fresh.focused ||
        fresh.activation !== result.activation ||
        typeof fresh.inputEpoch !== "number" ||
        !Number.isSafeInteger(fresh.inputEpoch) ||
        fresh.inputEpoch < 0
      )
        return { kind: "superseded" };
      return {
        kind: "ready",
        target: {
          scope: target,
          activation: fresh.activation,
          inputEpoch: fresh.inputEpoch,
        },
      };
    };
    const available =
      !!origin && controller.owns(origin) && generation === getSessionVersion();
    return {
      "new.page": {
        available,
        run: () => coordinator.request("new.page", admit),
      },
      "new.from-template": {
        available,
        run: () => coordinator.request("new.from-template", admit),
      },
      "new.import": {
        available,
        run: () => coordinator.request("new.import", admit),
      },
    };
  }, [coordinator, controller, origin, generation, scope]);
  useRouteCommands(actions, { fallback: true });
  return null;
}

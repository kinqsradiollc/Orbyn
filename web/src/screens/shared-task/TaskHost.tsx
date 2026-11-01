import { watchAccount } from "../../lib/account-events";
import { useMemo, useRef, useState } from "react";
import { RouteScopeProvider, type RouteScope } from "../../lib/route-scope";
import { detachTaskLayer, type LayerOrigin } from "./host-store";
import { ErrorNotice, Button } from "../../ui/kit";
import { getSessionVersion } from "../../lib/session";
import type { Item } from "@orbyn/core";
import { useEffect, useId, useSyncExternalStore } from "react";
import { FocusBanner, FocusMode } from "../calendar/Focus";
import { usePath } from "../../lib/router";
import {
  tasks,
  useTasks,
  useTaskLayer,
  registerFocusPreparation,
} from "./host-store";
import { canWriteIn, refreshPlanner, useItems, usePlanning } from "./store";
import { NewItem } from "./NewItem";
import { Peek } from "./Peek";
import { TaskPanel } from "./TaskPanel";
import "./shared-task.css";

const hosts: string[] = [];
const watchers = new Set<() => void>();
const announce = () => watchers.forEach((watch) => watch());
const watch = (listener: () => void) => {
  watchers.add(listener);
  return () => void watchers.delete(listener);
};

/**
 * Draws the task panel, the new-item dialog and focus mode. Mount it once
 * near the top of a screen, or once in the shell; extra copies draw nothing.
 */
export function TaskHost() {
  const id = useId();
  useEffect(() => {
    hosts.push(id);
    announce();
    return () => {
      hosts.splice(hosts.indexOf(id), 1);
      announce();
    };
  }, [id]);
  const active = useSyncExternalStore(watch, () => hosts[0] === id);
  const {
    open,
    create,
    focus,
    focusOrigin,
    focusVersion,
    focusVisible,
    peek,
    error,
  } = useTaskLayer();
  if (!active) return null;
  return (
    <>
      <TaskLayerScope
        origin={open?.options.origin ?? create?.origin ?? peek?.origin}
      >
        {error && <ErrorNotice message={error} />}
        {peek && !open && (
          <Peek
            key={peek.target.id}
            target={peek.target}
            pinned={peek.pinned}
            onClose={() => tasks.closePeek(peek)}
          />
        )}
        {open && (
          <TaskPanel
            key={open.presentation}
            id={open.id}
            listed={open.item}
            occurrence={open.options.occurrence}
            onClose={() => tasks.close(open.id, open)}
          />
        )}
        {create && (
          <NewItem
            key={create.presentation}
            text={create.text}
            prefill={create.prefill}
            onClose={() => tasks.closeCreate(create)}
          />
        )}
      </TaskLayerScope>
      {focus ? (
        <TaskLayerScope
          origin={focusOrigin}
          onRetired={() => tasks.hideFocus(focus, focusOrigin, focusVersion)}
        >
          <HostFocus
            item={focus}
            origin={focusOrigin}
            version={focusVersion}
            visible={focusVisible}
          />
        </TaskLayerScope>
      ) : null}
      {!focusVisible && (
        <ReturnToFocus item={focus ?? undefined} version={focusVersion} />
      )}
    </>
  );
}

/** Focus mode, from anywhere in the app. */
function HostFocus({
  item,
  origin,
  version,
  visible,
}: {
  item: Item;
  origin?: LayerOrigin;
  version: number;
  visible: boolean;
}) {
  const boundTasks = useTasks();
  const all = useItems();
  const planning = usePlanning();
  return (
    <FocusMode
      key={item.id}
      visible={visible}
      onPrepare={registerFocusPreparation}
      item={item}
      items={all}
      canWrite={canWriteIn(planning.teams, item.team_id)}
      breakLevel={planning.prefs?.break_level}
      onClose={(keepRunning) =>
        keepRunning
          ? tasks.hideFocus(item, origin, version)
          : tasks.closeFocus(item, origin, version)
      }
      onSwitch={(next) => boundTasks.focus(next)}
      onChanged={() => refreshPlanner()}
    />
  );
}

/** A way back to a running session. Calendar shows its own. */
function ReturnToFocus({ item, version }: { item?: Item; version: number }) {
  const boundTasks = useTasks();
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      watchAccount((news) => {
        if (news.kind === "focus") setRevision((value) => value + 1);
      }),
    [],
  );
  const all = useItems();
  const path = usePath();
  if (item)
    return (
      <div className="focus-return">
        <Button onClick={() => boundTasks.focus(item)}>
          Back to focus · {item.title}
        </Button>
      </div>
    );
  return (
    <div className="focus-return">
      <FocusBanner
        items={all}
        hidden={false}
        version={`${path}:${version}:${revision}`}
        onOpen={(item) => boundTasks.focus(item)}
      />
    </div>
  );
}

/** The single portal renderer keeps its captured origin even when another pane receives focus. */
function TaskLayerScope({
  origin,
  children,
  onRetired,
}: {
  origin?: LayerOrigin;
  onRetired?: () => void;
  children: import("react").ReactNode;
}) {
  const opening = useRef<{ scope: RouteScope | null; href: string } | null>(
    null,
  );
  if (opening.current?.scope !== origin?.scope) {
    const route = origin?.scope?.getSnapshot();
    opening.current = {
      scope: origin?.scope ?? null,
      href: route ? route.pathname + route.search + route.hash : "",
    };
  }
  useEffect(() => {
    if (!origin?.scope) return;
    const scope = origin.scope,
      href = opening.current?.href;
    return scope.subscribe(() => {
      const route = scope.getSnapshot();
      if (
        origin.generation !== getSessionVersion() ||
        !route.pathname ||
        route.pathname + route.search + route.hash !== href
      )
        (onRetired ?? detachTaskLayer)();
    });
  }, [origin?.scope, origin?.generation, onRetired]);
  const scope = useMemo<RouteScope | null>(
    () =>
      origin?.scope
        ? {
            ...origin.scope,
            originScope: origin.scope.originScope ?? origin.scope,
            getSnapshot: () => {
              const current = origin.scope!.getSnapshot();
              if (previous.current && current === previous.current.base)
                return previous.current.snapshot;
              const snapshot = {
                ...current,
                visible: !!current.pathname,
                focused: !!current.pathname,
              };
              previous.current = { base: current, snapshot };
              return snapshot;
            },
            navigate: (to, replace) =>
              origin.scope!.activateNavigate
                ? origin.scope!.activateNavigate(to, replace)
                : origin.scope!.navigate(to, replace),
          }
        : null,
    [origin?.scope],
  );
  const previous = useRef<{
    base: ReturnType<RouteScope["getSnapshot"]>;
    snapshot: ReturnType<RouteScope["getSnapshot"]>;
  } | null>(null);
  return scope ? (
    <RouteScopeProvider value={scope}>{children}</RouteScopeProvider>
  ) : (
    <>{children}</>
  );
}

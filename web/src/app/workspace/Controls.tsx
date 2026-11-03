import { useTabsPreference } from "../controls/tabs-preference";
import {
  activeTab,
  canGoBack,
  canGoForward,
  placeOf,
  type TabsState,
  type WorkspaceTab,
} from "@orbyn/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUpLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  CopyPlus,
  History,
  ListX,
  MoreHorizontal,
  PanelRightClose,
  Pin,
  PinOff,
  PanelRightOpen,
  Plus,
  X,
} from "lucide-react";
import { Button, IconButton, Input, Menu } from "../../ui/kit";
import type { RouteResult } from "../../lib/route-scope";
import { placeDestination } from "./destination";
import type {
  FrameLease,
  FrameRecord,
  Pane,
  WorkspaceController,
  WorkspaceSnapshot,
} from "./controller";
import "./Controls.css";

type Props = {
  controller: WorkspaceController;
  onResult?: (result: RouteResult) => void;
};
const workingFrame = (state: WorkspaceSnapshot, pane: Pane) => {
  const tabs = pane === "primary" ? state.primary : state.secondary;
  return tabs
    ? state.frames.find(
        (frame) =>
          frame.lease.pane === pane && frame.lease.tabKey === tabs.active,
      )
    : undefined;
};
function focusedFrame(state: WorkspaceSnapshot): FrameRecord | undefined {
  if (state.focused !== "dock") return workingFrame(state, state.focused);
  const dock = state.dock.find(
    (frame) => frame.lease.tabKey === state.dockActive,
  );
  return dock?.origin
    ? state.frames.find(
        (frame) =>
          frame.lease.pane === dock.origin!.pane &&
          frame.lease.tabKey === dock.origin!.tabKey &&
          frame.lease.mount === dock.origin!.mount,
      )
    : undefined;
}
const titleOf = (tab: WorkspaceTab) => {
  const place = placeOf(tab);
  return place.title || place.view;
};

/** Serialize native gestures; the controller remains the authority for guards and topology. */
function useControl(props: Props) {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
  );
  const locked = useRef(false),
    mounted = useRef(true);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (
    origin: FrameLease | undefined,
    action: () => Promise<RouteResult>,
  ) => {
    if (!origin || locked.current || !props.controller.owns(origin)) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      const result = await action();
      if (!mounted.current || !props.controller.owns(origin)) return;
      if (result.kind === "refused") setError(result.reason);
      props.onResult?.(result);
    } catch {
      if (mounted.current && props.controller.owns(origin))
        setError("Couldn't change the workspace. Try again.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return {
    snapshot,
    pending,
    run,
    notice: error ? (
      <p className="workspace-control-error" role="alert">
        {error}
      </p>
    ) : null,
  };
}

export function WorkspaceTools(props: Props) {
  const { snapshot, pending, run, notice } = useControl(props);
  const tabsEnabled = useTabsPreference();
  const frame = focusedFrame(snapshot),
    origin = frame?.lease;
  const tabs =
    origin?.pane === "secondary" ? snapshot.secondary : snapshot.primary;
  const tab = tabs ? activeTab(tabs) : null;
  const act = (action: () => Promise<RouteResult>) => void run(origin, action);
  return (
    <>
      <div className="workspace-tools-container">
        <div
          className="workspace-controls workspace-tools-row"
          role="toolbar"
          aria-label="Workspace"
        >
          {tabsEnabled && (
            <>
              <IconButton
                label="Back"
                disabled={pending || !origin || !tab || !canGoBack(tab)}
                onClick={() =>
                  act(() => props.controller.command(origin!, { type: "back" }))
                }
              >
                <ArrowLeft size={16} aria-hidden="true" />
              </IconButton>
              <IconButton
                label="Forward"
                disabled={pending || !origin || !tab || !canGoForward(tab)}
                onClick={() =>
                  act(() =>
                    props.controller.command(origin!, { type: "forward" }),
                  )
                }
              >
                <ArrowRight size={16} aria-hidden="true" />
              </IconButton>
              <Button
                aria-label="New tab"
                title="New tab"
                disabled={pending || !origin}
                onClick={() =>
                  act(() =>
                    props.controller.open({
                      origin: origin!,
                      href: "/app",
                      target: "new-tab",
                    }),
                  )
                }
              >
                <Plus size={16} aria-hidden="true" />
                <span className="workspace-tools-new-label">New tab</span>
              </Button>
            </>
          )}
          <Menu
            label="Workspace actions"
            align="end"
            trigger={(open, expanded) => (
              <Button
                className="workspace-tools-more"
                aria-label="Workspace actions"
                title="Workspace actions"
                aria-haspopup="menu"
                aria-expanded={expanded}
                disabled={pending || !origin}
                onClick={open}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
                <span className="workspace-tools-more-label">Workspace</span>
              </Button>
            )}
          >
            {(done) => {
              const choose = (action: () => Promise<RouteResult>) => () => {
                done();
                act(action);
              };
              const present = (
                presentation: "primary" | "secondary" | "both",
                label: string,
              ) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={snapshot.presentation === presentation}
                  disabled={pending || !origin}
                  onClick={choose(() =>
                    props.controller.present(origin!, presentation),
                  )}
                >
                  {snapshot.presentation === presentation ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <span className="menu-icon-space" aria-hidden="true" />
                  )}
                  {label}
                </button>
              );
              return (
                <>
                  <div className="menu-label" aria-hidden="true">
                    Layout
                  </div>
                  {!snapshot.secondary ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || !origin}
                      onClick={choose(() =>
                        props.controller.pair(origin!, frame!.destination.href),
                      )}
                    >
                      <Columns2 aria-hidden="true" /> Open beside
                    </button>
                  ) : (
                    <>
                      {present("primary", "Main pane")}
                      {present("secondary", "Second pane")}
                      {present("both", "Both panes")}
                      <button
                        type="button"
                        role="menuitem"
                        disabled={pending || !origin}
                        onClick={choose(() => props.controller.unpair(origin!))}
                      >
                        <X aria-hidden="true" /> Close second pane
                      </button>
                    </>
                  )}
                  <div role="separator" />
                  <div className="menu-label" aria-hidden="true">
                    Dock
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending || !origin}
                    onClick={choose(() =>
                      props.controller.peek(
                        origin!,
                        frame!.destination.href,
                        frame!.title,
                      ),
                    )}
                  >
                    <PanelRightOpen aria-hidden="true" /> Inspect in dock
                  </button>
                  {snapshot.dock.length > 0 && !snapshot.dockOpen && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || !origin}
                      onClick={choose(() => {
                        const dock =
                          snapshot.dock.find(
                            (f) => f.lease.tabKey === snapshot.dockActive,
                          ) ?? snapshot.dock[0];
                        return props.controller.peek(
                          origin!,
                          dock.destination.href,
                          dock.title,
                        );
                      })}
                    >
                      <PanelRightOpen aria-hidden="true" /> Show dock
                    </button>
                  )}
                  {tabsEnabled && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || !origin || !tabs?.closed.length}
                      onClick={choose(() =>
                        props.controller.command(origin!, { type: "reopen" }),
                      )}
                    >
                      <History aria-hidden="true" /> Reopen closed tab
                    </button>
                  )}
                </>
              );
            }}
          </Menu>
        </div>
      </div>
      {snapshot.storageError && (
        <p className="workspace-control-error" role="alert">
          {snapshot.storageError}{" "}
          <Button onClick={() => props.controller.retryPersistence()}>
            Try saving tabs again
          </Button>
        </p>
      )}
      {notice}
    </>
  );
}

/** Filtering never changes selection or disposes a hidden tab's editor. */
export function WorkspaceTabs(
  props: Props & { pane: "primary" | "secondary" },
) {
  const { snapshot, pending, run, notice } = useControl(props);
  const tabsEnabled = useTabsPreference();
  const [filter, setFilter] = useState("");
  const state: TabsState | null =
    props.pane === "primary" ? snapshot.primary : snapshot.secondary;
  const frame = workingFrame(snapshot, props.pane),
    origin = frame?.lease;
  if (!state || !tabsEnabled) return null;
  const command = (action: Parameters<WorkspaceController["command"]>[1]) => {
    void run(origin, () => props.controller.command(origin!, action));
  };
  const visible = state.tabs.filter((tab) =>
    titleOf(tab).toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <div className="workspace-tab-controls">
      {(state.tabs.length > 3 || !!filter) && (
        <Input
          type="search"
          aria-label={`Filter ${props.pane} tabs`}
          placeholder="Filter tabs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div
        className="workspace-control-tabs"
        role="tablist"
        aria-label={`${props.pane} tabs`}
        onKeyDown={(e) => {
          if (
            (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
            e.target instanceof HTMLElement &&
            e.target.getAttribute("role") === "tab"
          ) {
            e.preventDefault();
            const targetId = e.target.id;
            const index = visible.findIndex(
              (tab) => `workspace-${props.pane}-${tab.key}` === targetId,
            );
            const next =
              visible[
                (index + (e.key === "ArrowRight" ? 1 : -1) + visible.length) %
                  visible.length
              ];
            if (next) {
              command({ type: "select", key: next.key });
              document
                .getElementById(`workspace-${props.pane}-${next.key}`)
                ?.focus();
            }
          }
        }}
      >
        {visible.map((tab) => (
          <div
            key={tab.key}
            className="workspace-control-tab"
            draggable={!pending}
            onDragStart={(e) => {
              e.dataTransfer.setData(
                `application/x-orbyn-tab-${props.pane}`,
                tab.key,
              );
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (
                e.dataTransfer.types.includes(
                  `application/x-orbyn-tab-${props.pane}`,
                )
              )
                e.preventDefault();
            }}
            onDrop={(e) => {
              const key = e.dataTransfer.getData(
                `application/x-orbyn-tab-${props.pane}`,
              );
              if (state.tabs.some((t) => t.key === key)) {
                e.preventDefault();
                command({ type: "move", key, before: tab.key });
              }
            }}
          >
            <button
              id={`workspace-${props.pane}-${tab.key}`}
              role="tab"
              tabIndex={
                state.active === tab.key ||
                (!visible.some((t) => t.key === state.active) &&
                  visible[0]?.key === tab.key)
                  ? 0
                  : -1
              }
              aria-selected={state.active === tab.key}
              title={titleOf(tab)}
              disabled={pending}
              onClick={() => command({ type: "select", key: tab.key })}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  command({ type: "close", key: tab.key });
                }
              }}
            >
              {tab.pinned && <span aria-label="Pinned">◆ </span>}
              {titleOf(tab)}
            </button>
            <Menu
              label={`${titleOf(tab)} actions`}
              trigger={(open, expanded) => (
                <IconButton
                  label={`Options for ${titleOf(tab)}`}
                  aria-haspopup="menu"
                  aria-expanded={expanded}
                  disabled={pending}
                  onClick={open}
                >
                  <MoreHorizontal aria-hidden="true" />
                </IconButton>
              )}
            >
              {(done) => {
                const at = state.tabs.findIndex((t) => t.key === tab.key);
                const first = at === 0,
                  last = at === state.tabs.length - 1;
                const choose =
                  (action: Parameters<typeof command>[0]) => () => {
                    done();
                    command(action);
                  };
                return (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending}
                      onClick={choose({
                        type: "pin",
                        key: tab.key,
                        pinned: !tab.pinned,
                      })}
                    >
                      {tab.pinned ? (
                        <PinOff aria-hidden="true" />
                      ) : (
                        <Pin aria-hidden="true" />
                      )}
                      {tab.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending}
                      onClick={() => {
                        const href = placeDestination(placeOf(tab))?.href;
                        done();
                        if (href && origin)
                          void run(origin, () =>
                            props.controller.open({
                              origin,
                              href,
                              target: "new-tab",
                              background: true,
                            }),
                          );
                      }}
                    >
                      <CopyPlus aria-hidden="true" /> Duplicate in background
                    </button>
                    <div role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || first}
                      onClick={choose({
                        type: "move",
                        key: tab.key,
                        before: state.tabs[at - 1]?.key ?? null,
                      })}
                    >
                      <ChevronLeft aria-hidden="true" /> Move left
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || last}
                      onClick={choose({
                        type: "move",
                        key: tab.key,
                        before: state.tabs[at + 2]?.key ?? null,
                      })}
                    >
                      <ChevronRight aria-hidden="true" /> Move right
                    </button>
                    <div role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending}
                      onClick={choose({ type: "close", key: tab.key })}
                    >
                      <X aria-hidden="true" /> Close tab
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || state.tabs.length < 2}
                      onClick={choose({ type: "closeOthers", key: tab.key })}
                    >
                      <ListX aria-hidden="true" /> Close other tabs
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pending || last}
                      onClick={choose({ type: "closeRight", key: tab.key })}
                    >
                      <ArrowRightToLine aria-hidden="true" /> Close tabs to
                      right
                    </button>
                  </>
                );
              }}
            </Menu>
          </div>
        ))}
      </div>
      {!!filter && (
        <Button onClick={() => setFilter("")}>Clear tab filter</Button>
      )}
      {!visible.length && (
        <p className="muted">
          No matching tabs.{" "}
          <Button onClick={() => setFilter("")}>Clear filter</Button>
        </p>
      )}
      {notice}
    </div>
  );
}

export function WorkspaceDockTabs(props: Props) {
  const { snapshot, pending, run, notice } = useControl(props);
  const active = snapshot.dock.find(
    (frame) => frame.lease.tabKey === snapshot.dockActive,
  );
  const origin = active?.lease;
  return (
    <>
      <div
        className="workspace-controls workspace-dock-header"
        role="toolbar"
        aria-label="Dock"
      >
        <div className="workspace-dock-tabs">
          {snapshot.dock.map((frame) => (
            <div className="workspace-control-tab" key={frame.lease.tabKey}>
              <Button
                aria-pressed={frame === active}
                disabled={pending}
                onClick={() =>
                  void run(origin, () =>
                    props.controller.peek(
                      origin!,
                      frame.destination.href,
                      frame.title,
                    ),
                  )
                }
              >
                {frame.title ||
                  frame.destination.title ||
                  frame.destination.view}
              </Button>
              <IconButton
                label={`Close ${frame.title || frame.destination.view} in dock`}
                disabled={pending}
                onClick={() =>
                  void run(origin, () =>
                    props.controller.closeDock(origin!, frame.lease.tabKey),
                  )
                }
              >
                <X aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
        <IconButton
          label="Open in originating pane"
          disabled={pending || !origin}
          onClick={() =>
            void run(origin, () => props.controller.openDockObject(origin!))
          }
        >
          <ArrowUpLeft aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Hide dock"
          disabled={pending || !origin}
          onClick={() =>
            void run(origin, () => props.controller.closeDock(origin!))
          }
        >
          <PanelRightClose aria-hidden="true" />
        </IconButton>
      </div>
      {notice}
    </>
  );
}

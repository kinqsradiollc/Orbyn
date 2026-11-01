import {
  TAB_LIMIT,
  activeTab,
  initialTabs,
  placeOf,
  tabsReducer,
  type TabAction,
  type TabsState,
} from "@orbyn/core";
import type {
  BrowserDecision,
  BrowserIntent,
  BrowserNavigationOwner,
} from "../../lib/router";
import type {
  LeaveGuard,
  RouteResult,
  RouteScope,
  RouteSnapshot,
} from "../../lib/route-scope";
import { destination, placeDestination, type Destination } from "./destination";
import {
  loadWorkspace,
  saveWorkspace,
  type WorkspaceStorage,
} from "./persistence";

export type Pane = "primary" | "secondary" | "dock";
export type FrameLease = Readonly<{
  generation: number;
  pane: Pane;
  tabKey: string;
  mount: number;
}>;
export type FrameRecord = Readonly<{
  lease: FrameLease;
  destination: Destination;
  activation: number;
  title: string;
  /** Captured full-open target for dock objects; never inferred from current focus. */
  origin: FrameLease | null;
}>;
export type WorkspaceSnapshot = Readonly<{
  primary: TabsState;
  secondary: TabsState | null;
  dock: readonly FrameRecord[];
  dockActive: string | null;
  dockOpen: boolean;
  focused: Pane;
  /** Measured layout policy; no device geometry is persisted here. */
  presentation: "both" | "primary" | "secondary";
  frames: readonly FrameRecord[];
  revision: number;
  storageError: string;
}>;
export type PrepareReason =
  "replace" | "close" | "unpair" | "reload" | "sign-out" | "leave-workspace";
export type FrameOwner = {
  prepare(reason: PrepareReason, destination: string): Promise<boolean>;
  /** A modal must block parking its owner even when its form is clean. */
  blocksParking(): boolean;
  focus?(): void;
};
type Registration = {
  token: object;
  owner: FrameOwner;
  guards: Map<object, LeaveGuard>;
};
type Candidate = {
  next: WorkspaceSnapshot;
  removed: FrameRecord[];
  parked: FrameRecord[];
  changed: FrameRecord[];
  reason: PrepareReason;
  href: string;
  replace: boolean;
  project: boolean;
};
export type TabCommand = Exclude<
  TabAction,
  { type: "go" | "replace" | "open" }
>;
export type OpenInput = {
  origin: FrameLease;
  href: string;
  target?: "same-pane" | "new-tab";
  background?: boolean;
  replace?: boolean;
  title?: string;
};
export type ControllerOptions = {
  userId: string;
  generation: number;
  currentGeneration(): number;
  initialHref: string;
  storage?: WorkspaceStorage;
  routeInput?(
    origin: FrameLease,
    href: string,
    replace: boolean,
    captured: boolean,
  ): Promise<RouteResult> | null;
  /** Account-lived overlays/timers may outlive the frame that opened them. */
  prepareGlobal?(): Promise<{ allowed: boolean; current(): boolean }>;
  /** Synchronous owner-bound router boundary; never navigate(), which dispatches back here. */
  projectBrowser(
    href: string,
    replace: boolean,
    metadata: Record<string, unknown>,
  ): boolean;
};
const sameLease = (a: FrameLease, b: FrameLease) =>
  a.generation === b.generation &&
  a.pane === b.pane &&
  a.tabKey === b.tabKey &&
  a.mount === b.mount;
const leaseKey = (lease: FrameLease) =>
  `${lease.generation}:${lease.pane}:${lease.tabKey}:${lease.mount}`;
const refused = (reason: string): RouteResult => ({ kind: "refused", reason });
const superseded = (): RouteResult => ({ kind: "superseded" });

/** One instance per authenticated lifetime. Domain drafts stay in registered feature owners. */
export class WorkspaceController implements BrowserNavigationOwner {
  private state: WorkspaceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly registry = new Map<string, Registration>();
  private readonly scopeCache = new Map<string, RouteScope>();
  private readonly inputEpochs = new Map<string, number>();
  private inputPublication: ReturnType<typeof setTimeout> | undefined;
  private readonly portals = new Map<string, Set<object>>();
  private readonly guardOnly = new Map<string, Map<object, LeaveGuard>>();
  private readonly titleTokens = new Map<string, object>();
  private nextMount = 0;
  private dockSeq = 0;
  private intent = 0;
  private alive = true;
  private readonly inactive: WorkspaceSnapshot = {
    primary: initialTabs(),
    secondary: null,
    dock: [],
    dockActive: null,
    dockOpen: false,
    focused: "primary",
    presentation: "both",
    frames: [],
    revision: -1,
    storageError: "",
  };

  constructor(private readonly options: ControllerOptions) {
    if (
      !/^[A-Za-z0-9_-]{1,160}$/.test(options.userId) ||
      !Number.isSafeInteger(options.generation) ||
      options.generation < 0
    )
      throw new Error("Workspace needs a verified account lifetime.");
    const first = destination(options.initialHref);
    if (!first || first.view === "Settings")
      throw new Error(
        "Workspace needs a working-pane destination; Settings belongs to the overlay adapter.",
      );
    const loaded = options.storage
      ? loadWorkspace(options.storage, options.userId)
      : { value: null, error: "" };
    let primary = loaded.value ?? initialTabs(first);
    // The explicitly opened browser URL wins; restoration never discards it.
    const selected = primary.tabs.find(
      (tab) => placeDestination(placeOf(tab))?.href === first.href,
    );
    primary = selected
      ? tabsReducer(primary, { type: "select", key: selected.key })
      : tabsReducer(primary, { type: "replace", place: first });
    this.state = {
      primary,
      secondary: null,
      dock: [],
      dockActive: null,
      dockOpen: false,
      focused: "primary",
      presentation: "both",
      frames: [],
      revision: 0,
      storageError: loaded.error,
    };
    this.state = this.visit(this.state);
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly getSnapshot = () => (this.current() ? this.state : this.inactive);
  private current() {
    return (
      this.alive && this.options.currentGeneration() === this.options.generation
    );
  }
  owns(lease: FrameLease) {
    return (
      this.current() &&
      this.state.frames.some((frame) => sameLease(frame.lease, lease))
    );
  }
  private frame(lease: FrameLease) {
    return this.state.frames.find((frame) => sameLease(frame.lease, lease));
  }
  private tabs(state: WorkspaceSnapshot, pane: Pane) {
    return pane === "primary"
      ? state.primary
      : pane === "secondary"
        ? state.secondary
        : null;
  }
  private visible(state: WorkspaceSnapshot, frame: FrameRecord) {
    const pane = frame.lease.pane;
    return pane === "dock"
      ? state.dockOpen && state.dockActive === frame.lease.tabKey
      : (state.presentation === "both" ||
          state.presentation === pane ||
          (!state.secondary && pane === "primary")) &&
          this.tabs(state, pane)?.active === frame.lease.tabKey;
  }
  private record(
    pane: Pane,
    tabKey: string,
    target: Destination,
    origin: FrameLease | null = null,
  ): FrameRecord {
    return {
      lease: {
        generation: this.options.generation,
        pane,
        tabKey,
        mount: ++this.nextMount,
      },
      destination: target,
      activation: 1,
      title: target.title,
      origin,
    };
  }
  private visit(next: WorkspaceSnapshot): WorkspaceSnapshot {
    const frames = next.frames.flatMap((frame): FrameRecord[] => {
      if (frame.lease.pane === "dock")
        return next.dock.some((item) => sameLease(item.lease, frame.lease))
          ? [frame]
          : [];
      const tab = this.tabs(next, frame.lease.pane)?.tabs.find(
        (tab) => tab.key === frame.lease.tabKey,
      );
      const target = tab ? placeDestination(placeOf(tab)) : null;
      // Search/hash transitions of the SAME feature/object keep its buffers and scrollers.
      if (
        !target ||
        target.view !== frame.destination.view ||
        target.id !== frame.destination.id
      )
        return [];
      return [
        target.href === frame.destination.href
          ? frame
          : { ...frame, destination: target, activation: frame.activation + 1 },
      ];
    });
    for (const pane of ["primary", "secondary"] as const) {
      const tabs = this.tabs(next, pane);
      if (!tabs) continue;
      const active = activeTab(tabs);
      if (
        !frames.some(
          (frame) =>
            frame.lease.pane === pane && frame.lease.tabKey === active.key,
        )
      ) {
        const target = placeDestination(placeOf(active));
        if (!target) throw new Error("Workspace destination is invalid.");
        frames.push(this.record(pane, active.key, target));
      }
    }
    for (const item of next.dock)
      if (!frames.some((frame) => sameLease(frame.lease, item.lease)))
        frames.push(item);
    return { ...next, frames };
  }
  private candidate(
    next: WorkspaceSnapshot,
    reason: PrepareReason,
    replace = false,
    project = true,
  ): Candidate {
    const visited = this.visit(next);
    const removed = this.state.frames.filter(
      (frame) =>
        !visited.frames.some((other) => sameLease(frame.lease, other.lease)),
    );
    const changed = this.state.frames.filter((frame) =>
      visited.frames.some(
        (other) =>
          sameLease(frame.lease, other.lease) &&
          other.destination.href !== frame.destination.href,
      ),
    );
    const parked = this.state.frames.filter(
      (frame) =>
        this.visible(this.state, frame) &&
        !removed.includes(frame) &&
        (!this.visible(visited, frame) ||
          changed.includes(frame) ||
          (this.state.focused === frame.lease.pane &&
            visited.focused !== frame.lease.pane)),
    );
    const href = placeDestination(placeOf(activeTab(visited.primary)))!.href;
    return {
      next: visited,
      removed,
      parked,
      changed,
      reason,
      href,
      replace,
      project,
    };
  }

  private destinationFor(candidate: Candidate, frame: FrameRecord): string {
    const retained = candidate.next.frames.find((next) =>
      sameLease(frame.lease, next.lease),
    );
    if (retained) return retained.destination.href;
    const tabs = this.tabs(candidate.next, frame.lease.pane);
    if (tabs) return placeDestination(placeOf(activeTab(tabs)))!.href;
    const dock = candidate.next.dock.find(
      (item) => item.lease.tabKey === candidate.next.dockActive,
    );
    return frame.lease.pane === "dock" && dock
      ? dock.destination.href
      : candidate.href;
  }

  register(lease: FrameLease, owner: FrameOwner) {
    if (!this.owns(lease)) return () => {};
    const key = leaseKey(lease);
    if (this.registry.has(key))
      throw new Error("This workspace frame already has a draft owner.");
    const token = {};
    this.intent++;
    this.registry.set(key, {
      token,
      owner,
      guards: this.guardOnly.get(key) ?? new Map(),
    });
    return () => {
      if (this.registry.get(key)?.token === token) {
        this.registry.delete(key);
        this.intent++;
      }
    };
  }

  private async prepareCandidate(
    candidate: Candidate,
    origin?: FrameLease,
  ): Promise<
    { commit(boundary?: () => boolean | void): boolean } | RouteResult
  > {
    const opening = this.state;
    const ticket = ++this.intent;
    const valid = () =>
      this.current() &&
      this.state.revision === opening.revision &&
      this.intent === ticket &&
      (!origin || this.owns(origin));
    if (!valid()) return superseded();
    const registrations = new Map<string, object>();
    for (const frame of candidate.parked) {
      const registration = this.registry.get(leaseKey(frame.lease));
      if (!registration) return refused("This view is still opening.");
      registrations.set(leaseKey(frame.lease), registration.token);
      try {
        if (registration.owner.blocksParking())
          return refused("Close this view's dialog before switching tabs.");
      } catch {
        return refused(
          "Couldn't check this view's dialog. Keep it open and try again.",
        );
      }
    }
    for (const frame of candidate.removed) {
      const key = leaseKey(frame.lease);
      const registration = this.registry.get(key);
      if (!registration) return refused("This view is still opening.");
      registrations.set(key, registration.token);
      try {
        if (
          !(await registration.owner.prepare(
            candidate.reason,
            this.destinationFor(candidate, frame),
          ))
        )
          return refused("Save or resolve this view before closing it.");
        if (!valid() || this.registry.get(key)?.token !== registration.token)
          return superseded();
        for (const [token, guard] of [...registration.guards]) {
          if (!registration.guards.has(token)) continue;
          if (!(await guard(this.destinationFor(candidate, frame))))
            return refused("Resolve the current form before leaving.");
          if (!valid() || this.registry.get(key)?.token !== registration.token)
            return superseded();
        }
      } catch {
        return refused("Couldn't prepare this view. Its draft is still open.");
      }
    }
    // Same-owner query/hash changes retain the frame, but its nested form guards still apply.
    for (const frame of candidate.changed) {
      const key = leaseKey(frame.lease);
      const registration = this.registry.get(key);
      if (!registration) return refused("This view is still opening.");
      registrations.set(key, registration.token);
      try {
        for (const [token, guard] of [...registration.guards]) {
          if (!registration.guards.has(token)) continue;
          if (!(await guard(this.destinationFor(candidate, frame))))
            return refused(
              "Resolve the current form before changing this view.",
            );
          if (!valid() || this.registry.get(key)?.token !== registration.token)
            return superseded();
        }
      } catch {
        return refused("Couldn't check this view. Its draft remains open.");
      }
    }
    return {
      commit: (boundary) => {
        if (!valid()) return false;
        for (const [key, token] of registrations)
          if (this.registry.get(key)?.token !== token) return false;
        // Modal state can change while another owner is settling.
        try {
          for (const frame of [
            ...candidate.parked,
            ...candidate.removed,
            ...candidate.changed,
          ])
            if (this.registry.get(leaseKey(frame.lease))?.owner.blocksParking())
              return false;
        } catch {
          return false;
        }
        const previousHref = placeDestination(
          placeOf(activeTab(opening.primary)),
        )!.href;
        if (boundary) {
          if (boundary() === false) return false;
        } else if (
          candidate.project &&
          (candidate.href !== previousHref ||
            candidate.next.primary.active !== opening.primary.active)
        ) {
          if (
            !this.options.projectBrowser(candidate.href, candidate.replace, {
              orbynWorkspaceTab: candidate.next.primary.active,
            })
          )
            return false;
        }
        this.state = {
          ...this.mergeMetadata(candidate.next, opening),
          revision: opening.revision + 1,
        };
        this.cleanRemoved(candidate.removed);
        this.persist();
        this.publish();
        return true;
      },
    };
  }
  /** Titles/storage feedback do not change topology or invalidate a successful save guard. */
  private mergeMetadata(
    candidate: WorkspaceSnapshot,
    opening: WorkspaceSnapshot,
  ): WorkspaceSnapshot {
    const latest = this.state;
    const changed = latest.frames.filter((frame) => {
      const previous = opening.frames.find((old) =>
        sameLease(old.lease, frame.lease),
      );
      return previous && previous.title !== frame.title;
    });
    const titles = new Map(
      changed.map((frame) => [leaseKey(frame.lease), frame]),
    );
    const mergeTabs = (tabs: TabsState, pane: Pane): TabsState => {
      const merge = (tab: TabsState["tabs"][number]) => {
        const frame = changed.find(
          (frame) =>
            frame.lease.pane === pane && frame.lease.tabKey === tab.key,
        );
        if (!frame) return tab;
        return {
          ...tab,
          history: tab.history.map((place) =>
            placeDestination(place)?.href === frame.destination.href
              ? { ...place, title: frame.title }
              : place,
          ),
        };
      };
      return {
        ...tabs,
        tabs: tabs.tabs.map(merge),
        closed: tabs.closed.map(merge),
      };
    };
    const frames = candidate.frames.map((frame) => {
      const current = titles.get(leaseKey(frame.lease));
      return current
        ? {
            ...frame,
            title: current.title,
            destination: { ...frame.destination, title: current.title },
          }
        : frame;
    });
    return {
      ...candidate,
      primary: mergeTabs(candidate.primary, "primary"),
      secondary: candidate.secondary
        ? mergeTabs(candidate.secondary, "secondary")
        : null,
      frames,
      dock: candidate.dock.map(
        (frame) =>
          frames.find((item) => sameLease(frame.lease, item.lease)) ?? frame,
      ),
      storageError: latest.storageError,
    };
  }

  private cleanRemoved(frames: FrameRecord[]) {
    for (const frame of frames) {
      const key = leaseKey(frame.lease);
      this.registry.delete(key);
      this.scopeCache.delete(key);
      this.inputEpochs.delete(key);
      this.guardOnly.delete(key);
      this.titleTokens.delete(key);
      this.portals.delete(key);
    }
  }
  private persist() {
    if (!this.current() || !this.options.storage) return;
    const saved = saveWorkspace(
      this.options.storage,
      this.options.userId,
      this.state.primary,
    );
    this.state = { ...this.state, storageError: saved.error };
  }
  retryPersistence(): boolean {
    if (!this.current()) return false;
    this.persist();
    this.publish();
    return !this.state.storageError;
  }

  private publish() {
    // Publish no old-account data after a synchronous session transition.
    if (this.current()) this.listeners.forEach((listener) => listener());
  }
  private publishInput() {
    if (this.inputPublication !== undefined) return;
    // Input is recorded during capture. Rendering subscribers there can restore
    // controlled fields before React's change handler reads the native value.
    // Keep authority synchronous; notify after the complete event, not between
    // its capture and bubble listeners (where a microtask can also run).
    this.inputPublication = setTimeout(() => {
      this.inputPublication = undefined;
      this.publish();
    }, 0);
  }
  private async run(
    candidate: Candidate,
    origin?: FrameLease,
  ): Promise<RouteResult> {
    const prepared = await this.prepareCandidate(candidate, origin);
    if ("kind" in prepared) return prepared;
    try {
      if (!prepared.commit()) return superseded();
    } catch {
      return refused(
        "Couldn't complete navigation. The current views remain open.",
      );
    }
    const active = this.state.frames.find(
      (frame) =>
        frame.lease.pane === this.state.focused &&
        this.visible(this.state, frame),
    );
    return { kind: "committed", activation: active?.activation ?? 0 };
  }

  private openingCandidate(input: OpenInput): Candidate | RouteResult {
    const target = destination(input.href, input.title);
    if (!target || target.view === "Settings")
      return refused(
        "Open this destination through its dedicated overlay or public route owner.",
      );
    if (!this.owns(input.origin)) return superseded();
    const pane = input.origin.pane;
    if (pane === "dock")
      return refused(
        "Choose the originating working pane for full navigation.",
      );
    const state = this.state;
    const tabs = this.tabs(state, pane)!;
    // A callback belongs to its captured tab even after focus changes.
    const base = tabsReducer(tabs, {
      type: "select",
      key: input.origin.tabKey,
    });
    if (
      input.target === "new-tab" &&
      base.tabs.length >= TAB_LIMIT &&
      !base.tabs.some((tab) => !tab.pinned && tab.key !== base.active)
    )
      return refused(
        "All available tabs are pinned. Close or unpin a tab first.",
      );
    let nextTabs = tabsReducer(
      base,
      input.target === "new-tab"
        ? { type: "open", place: target, background: input.background }
        : { type: input.replace ? "replace" : "go", place: target },
    );
    if (input.background) nextTabs = { ...nextTabs, active: tabs.active };
    let next: WorkspaceSnapshot = {
      ...state,
      [pane]: nextTabs,
      focused: input.background ? state.focused : pane,
      presentation:
        input.background || state.presentation === "both"
          ? state.presentation
          : pane,
    };
    next = this.visit(next);
    if (
      input.target !== "new-tab" &&
      target.href === this.frame(input.origin)?.destination.href
    )
      next = {
        ...next,
        frames: next.frames.map((frame) =>
          sameLease(frame.lease, input.origin)
            ? { ...frame, activation: frame.activation + 1 }
            : frame,
        ),
      };
    return this.candidate(next, "replace", !!input.replace);
  }

  async open(input: OpenInput): Promise<RouteResult> {
    const next = this.openingCandidate(input);
    return "kind" in next ? next : this.run(next, input.origin);
  }
  /** Overlay handoff uses this same candidate/guard path and its atomic browser commit boundary. */
  async prepareOpen(
    input: OpenInput,
  ): Promise<
    | { kind: "ready"; commit(browserCommit?: () => boolean | void): boolean }
    | RouteResult
  > {
    const next = this.openingCandidate(input);
    if ("kind" in next) return next;
    const prepared = await this.prepareCandidate(next, input.origin);
    return "kind" in prepared
      ? prepared
      : { kind: "ready", commit: prepared.commit };
  }

  async command(origin: FrameLease, action: TabCommand): Promise<RouteResult> {
    if (!this.owns(origin) || origin.pane === "dock") return superseded();
    const pane = origin.pane;
    const tabs = this.tabs(this.state, pane)!;
    if (
      (action.type === "back" ||
        action.type === "forward" ||
        action.type === "reopen") &&
      tabs.active !== origin.tabKey
    )
      return refused("Activate this tab first.");
    if (
      action.type === "reopen" &&
      tabs.tabs.length >= TAB_LIMIT &&
      !tabs.tabs.some((tab) => !tab.pinned && tab.key !== tabs.active)
    )
      return refused("There is no room to reopen a tab.");
    const nextTabs = tabsReducer(tabs, action);
    if (nextTabs === tabs) return refused("That tab action isn't available.");
    return this.run(
      this.candidate(
        {
          ...this.state,
          [pane]: nextTabs,
          focused: pane,
          presentation: this.state.presentation === "both" ? "both" : pane,
        },
        action.type === "back" || action.type === "forward"
          ? "replace"
          : "close",
        true,
      ),
      origin,
    );
  }

  async present(
    origin: FrameLease,
    presentation: "both" | "primary" | "secondary",
  ): Promise<RouteResult> {
    if (!this.owns(origin)) return superseded();
    if (presentation === "secondary" && !this.state.secondary)
      return refused("There is no second pane to show.");
    const focused =
      this.state.focused === "dock"
        ? "dock"
        : presentation === "both"
          ? this.state.focused
          : presentation;
    return this.run(
      this.candidate(
        { ...this.state, presentation, focused },
        "replace",
        true,
        false,
      ),
      origin,
    );
  }

  /** Overlay teardown may restore its captured connected input without changing navigation. */
  restoreInputFocus(origin: FrameLease): boolean {
    if (!this.owns(origin)) return false;
    const frame = this.frame(origin)!;
    if (!this.visible(this.state, frame) || this.state.focused !== origin.pane)
      return false;
    const registered = this.registry.get(leaseKey(origin));
    if (!registered) return false;
    try {
      registered.owner.focus?.();
      return true;
    } catch {
      return false;
    }
  }
  async focus(origin: FrameLease): Promise<RouteResult> {
    if (!this.owns(origin)) return superseded();
    const frame = this.frame(origin)!;
    if (!this.visible(this.state, frame))
      return refused("Select this tab before focusing its pane.");
    if (this.state.focused === origin.pane)
      return { kind: "committed", activation: frame.activation };
    return this.run(
      this.candidate(
        { ...this.state, focused: origin.pane },
        "replace",
        true,
        false,
      ),
      origin,
    );
  }

  async pair(origin: FrameLease, href: string): Promise<RouteResult> {
    if (!this.owns(origin) || origin.pane === "dock") return superseded();
    const target = destination(href);
    if (!target || target.view === "Settings")
      return refused("This destination can't open beside this pane.");
    if (this.state.secondary)
      return refused(
        "A second pane is already open. Navigate within it or close it first.",
      );
    return this.run(
      this.candidate(
        {
          ...this.state,
          secondary: initialTabs(target),
          focused: "secondary",
          presentation:
            this.state.presentation === "both" ? "both" : "secondary",
        },
        "replace",
        true,
      ),
      origin,
    );
  }
  async unpair(origin: FrameLease): Promise<RouteResult> {
    if (!this.owns(origin)) return superseded();
    if (!this.state.secondary)
      return refused("There is no second pane to close.");
    return this.run(
      this.candidate(
        { ...this.state, secondary: null, focused: "primary" },
        "unpair",
        true,
      ),
      origin,
    );
  }
  async peek(
    origin: FrameLease,
    href: string,
    title = "",
  ): Promise<RouteResult> {
    if (!this.owns(origin)) return superseded();
    const target = destination(href, title);
    if (!target || target.view === "Settings")
      return refused("This object can't open in the dock.");
    const existing = this.state.dock.find(
      (frame) => frame.destination.href === target.href,
    );
    if (!existing && this.state.dock.length >= 8)
      return refused(
        "The dock has eight tabs. Close one before opening another.",
      );
    const workingOrigin =
      origin.pane === "dock" ? (this.frame(origin)?.origin ?? null) : origin;
    const frame =
      existing ??
      this.record("dock", `d${++this.dockSeq}`, target, workingOrigin);
    const dock = existing ? this.state.dock : [...this.state.dock, frame];
    return this.run(
      this.candidate(
        {
          ...this.state,
          dock,
          dockActive: frame.lease.tabKey,
          dockOpen: true,
          focused: "dock",
        },
        "replace",
        true,
        false,
      ),
      origin,
    );
  }
  async openDockObject(origin: FrameLease): Promise<RouteResult> {
    if (!this.owns(origin) || origin.pane !== "dock") return superseded();
    const frame = this.frame(origin)!;
    if (!frame.origin || !this.owns(frame.origin))
      return refused(
        "The originating tab has closed. Choose a working pane explicitly.",
      );
    return this.open({
      origin: frame.origin,
      href: frame.destination.href,
      title: frame.title,
    });
  }

  async closeDock(origin: FrameLease, tabKey?: string): Promise<RouteResult> {
    if (!this.owns(origin)) return superseded();
    if (!tabKey)
      return this.run(
        this.candidate(
          { ...this.state, dockOpen: false, focused: "primary" },
          "close",
          true,
          false,
        ),
        origin,
      );
    const dock = this.state.dock.filter(
      (frame) => frame.lease.tabKey !== tabKey,
    );
    if (dock.length === this.state.dock.length)
      return refused("This dock tab is already closed.");
    return this.run(
      this.candidate(
        {
          ...this.state,
          dock,
          dockActive: dock.some(
            (frame) => frame.lease.tabKey === this.state.dockActive,
          )
            ? this.state.dockActive
            : (dock.at(-1)?.lease.tabKey ?? null),
          dockOpen: dock.length > 0,
          focused: dock.length ? "dock" : "primary",
        },
        "close",
        true,
        false,
      ),
      origin,
    );
  }

  /** Explicit global Reload/signout admission. Caller must execute before another intent. */
  async prepareAll(
    reason: "reload" | "sign-out" | "leave-workspace",
  ): Promise<{ allowed: boolean; current(): boolean }> {
    const opening = this.state;
    const ticket = ++this.intent;
    const registrations = new Map<string, object>();
    let global = { allowed: true, current: () => true };
    const current = () =>
      this.current() &&
      global.current() &&
      this.intent === ticket &&
      this.state.revision === opening.revision &&
      [...registrations].every(
        ([key, token]) => this.registry.get(key)?.token === token,
      );
    try {
      global = (await this.options.prepareGlobal?.()) ?? global;
    } catch {
      return { allowed: false, current };
    }
    if (!global.allowed || !current()) return { allowed: false, current };
    for (const frame of opening.frames) {
      const registration = this.registry.get(leaseKey(frame.lease));
      if (!registration) return { allowed: false, current };
      registrations.set(leaseKey(frame.lease), registration.token);
      try {
        if (!(await registration.owner.prepare(reason, "")) || !current())
          return { allowed: false, current };
        for (const [token, guard] of [...registration.guards])
          if (
            registration.guards.has(token) &&
            (!(await guard("")) || !current())
          )
            return { allowed: false, current };
      } catch {
        return { allowed: false, current };
      }
    }
    return { allowed: current(), current };
  }

  /** Browser owner: prepare without changing history; router supplies the atomic commit boundary. */
  async prepare(intent: BrowserIntent): Promise<BrowserDecision> {
    const target = destination(intent.href);
    if (!this.current() || target?.view === "Settings")
      return { kind: "refused" };
    if (!target) {
      // Public/auth routes are explicitly non-retained and never enter tabs.
      if (intent.href === "/app" || intent.href.startsWith("/app/"))
        return { kind: "refused" };
      const prepared = await this.prepareAll("leave-workspace");
      return prepared.allowed
        ? {
            kind: "ready",
            commit: (commit) => {
              if (!prepared.current()) return false;
              commit();
              return true;
            },
          }
        : { kind: "refused" };
    }
    const primary = this.state.primary;
    const hint =
      intent.state &&
      typeof intent.state === "object" &&
      "orbynWorkspaceTab" in intent.state
        ? intent.state.orbynWorkspaceTab
        : null;
    const hinted =
      typeof hint === "string"
        ? primary.tabs.find((tab) => tab.key === hint)
        : undefined;
    const base = hinted
      ? tabsReducer(primary, { type: "select", key: hinted.key })
      : primary;
    const nextTabs = tabsReducer(base, {
      type: intent.kind === "pop" || intent.replace ? "replace" : "go",
      place: target,
    });
    const next = this.visit({
      ...this.state,
      primary: nextTabs,
      focused: "primary",
      presentation:
        this.state.presentation === "secondary"
          ? "primary"
          : this.state.presentation,
    });
    const same =
      placeDestination(placeOf(activeTab(primary)))!.href === target.href;
    const activated = same
      ? {
          ...next,
          frames: next.frames.map((frame) =>
            frame.lease.pane === "primary" &&
            frame.lease.tabKey === nextTabs.active
              ? { ...frame, activation: frame.activation + 1 }
              : frame,
          ),
        }
      : next;
    const prepared = await this.prepareCandidate(
      this.candidate(activated, "replace", intent.replace, false),
    );
    return "kind" in prepared
      ? { kind: "refused" }
      : { kind: "ready", commit: prepared.commit };
  }

  private navigateDock(
    lease: FrameLease,
    href: string,
    replace = false,
  ): Promise<RouteResult> {
    const target = destination(href);
    if (
      target &&
      (target.pathname.startsWith("/app/doc/") ||
        target.pathname.startsWith("/app/project/"))
    )
      return this.peek(lease, href);
    const origin = this.frame(lease)?.origin;
    if (!origin || !this.owns(origin))
      return Promise.resolve(
        refused(
          "The originating tab has closed. Choose a working pane explicitly.",
        ),
      );
    return this.open({ origin, href, replace });
  }
  invalidatePendingInput() {
    this.intent++;
  }

  /** Stable contextual API bound to a lease; hidden callbacks cannot navigate the focused tab. */
  routeScope(lease: FrameLease): RouteScope {
    const key = leaseKey(lease);
    const cached = this.scopeCache.get(key);
    if (cached) return cached;
    let lastFrame: FrameRecord | undefined;
    let lastVisible = false,
      lastFocused = false,
      lastInputEpoch = 0;
    let snapshot: RouteSnapshot = {
      pathname: "",
      search: "",
      hash: "",
      activation: 0,
      visible: false,
      focused: false,
    };
    const scope: RouteScope = {
      subscribe: this.subscribe,
      getSnapshot: () => {
        const frame = this.owns(lease) ? this.frame(lease) : undefined;
        const visible = !!frame && this.visible(this.state, frame);
        const focused = visible && this.state.focused === lease.pane;
        const inputEpoch = frame ? (this.inputEpochs.get(key) ?? 0) : 0;
        if (
          frame !== lastFrame ||
          visible !== lastVisible ||
          focused !== lastFocused ||
          inputEpoch !== lastInputEpoch
        ) {
          lastFrame = frame;
          lastVisible = visible;
          lastFocused = focused;
          lastInputEpoch = inputEpoch;
          snapshot = frame
            ? {
                pathname: frame.destination.pathname,
                search: frame.destination.search,
                hash: frame.destination.hash,
                activation: frame.activation,
                inputEpoch,
                visible,
                focused,
              }
            : {
                pathname: "",
                search: "",
                hash: "",
                activation: 0,
                visible: false,
                focused: false,
              };
        }
        return snapshot;
      },
      navigate: (href, replace) => {
        const frame = this.frame(lease);
        if (!frame || !this.owns(lease)) return Promise.resolve(superseded());
        if (
          !this.visible(this.state, frame) ||
          this.state.focused !== lease.pane
        )
          return Promise.resolve(
            refused("This view is no longer the active input owner."),
          );
        const intercepted = this.options.routeInput?.(
          lease,
          href,
          !!replace,
          false,
        );
        if (intercepted) return intercepted;
        return lease.pane === "dock"
          ? this.navigateDock(lease, href, replace)
          : this.open({ origin: lease, href, replace });
      },
      activateNavigate: (href, replace) => {
        if (!this.owns(lease)) return Promise.resolve(superseded());
        const intercepted = this.options.routeInput?.(
          lease,
          href,
          !!replace,
          true,
        );
        if (intercepted) return intercepted;
        return lease.pane === "dock"
          ? this.navigateDock(lease, href, replace)
          : this.open({ origin: lease, href, replace });
      },
      noteInput: () => {
        if (!this.owns(lease)) return;
        this.inputEpochs.set(key, (this.inputEpochs.get(key) ?? 0) + 1);
        this.intent++;
        this.publishInput();
      },
      registerPortal: () => {
        if (!this.owns(lease)) return () => {};
        const token = {};
        let portals = this.portals.get(key);
        if (!portals) {
          portals = new Set();
          this.portals.set(key, portals);
        }
        portals.add(token);
        const opening = portals;
        return () => {
          if (this.portals.get(key) === opening) {
            opening.delete(token);
            if (!opening.size) this.portals.delete(key);
          }
        };
      },
      hasPortal: () => this.owns(lease) && !!this.portals.get(key)?.size,
      addGuard: (guard) => {
        if (!this.owns(lease)) return () => {};
        const token = {};
        let guards = this.guardOnly.get(key);
        if (!guards) {
          guards = new Map();
          this.guardOnly.set(key, guards);
        }
        guards.set(token, guard);
        this.intent++;
        const registration = this.registry.get(key);
        if (registration) registration.guards = guards;
        return () => {
          if (this.guardOnly.get(key) === guards && guards!.delete(token))
            this.intent++;
        };
      },
      setTitle: (title) => {
        if (!this.owns(lease)) return () => {};
        const token = {};
        this.titleTokens.set(key, token);
        const label = title.slice(0, 300);
        const href = this.frame(lease)!.destination.href;
        const retitle = (tabs: TabsState, pane: Pane): TabsState =>
          lease.pane !== pane
            ? tabs
            : {
                ...tabs,
                tabs: tabs.tabs.map((tab) =>
                  tab.key !== lease.tabKey
                    ? tab
                    : {
                        ...tab,
                        history: tab.history.map((place) =>
                          placeDestination(place)?.href === href
                            ? { ...place, title: label }
                            : place,
                        ),
                      },
                ),
              };
        const frames = this.state.frames.map((frame) =>
          sameLease(frame.lease, lease)
            ? {
                ...frame,
                title: label,
                destination: { ...frame.destination, title: label },
              }
            : frame,
        );
        this.state = {
          ...this.state,
          primary: retitle(this.state.primary, "primary"),
          secondary: this.state.secondary
            ? retitle(this.state.secondary, "secondary")
            : null,
          frames,
          dock: this.state.dock.map(
            (frame) =>
              frames.find((current) => sameLease(current.lease, frame.lease)) ??
              frame,
          ),
        };
        this.persist();
        this.publish();
        return () => {
          if (this.titleTokens.get(key) === token) this.titleTokens.delete(key);
        };
      },
    };
    this.scopeCache.set(key, scope);
    return scope;
  }

  /** Session transition/unmount only. User signout must call prepareAll beforehand. */
  destroy() {
    this.alive = false;
    this.intent++;
    if (this.inputPublication !== undefined) {
      clearTimeout(this.inputPublication);
      this.inputPublication = undefined;
    }
    this.registry.clear();
    this.guardOnly.clear();
    this.scopeCache.clear();
    this.inputEpochs.clear();
    this.titleTokens.clear();
    this.portals.clear();
    this.state = this.inactive;
    this.listeners.forEach((listener) => listener());
    this.listeners.clear();
  }
}

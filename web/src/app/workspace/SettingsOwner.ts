import type {
  BrowserDecision,
  BrowserIntent,
  BrowserNavigationOwner,
} from "../../lib/router";
import { navigateAsync } from "../../lib/router";
import type {
  LeaveGuard,
  RouteResult,
  RouteScope,
  RouteSnapshot,
} from "../../lib/route-scope";
import { destination } from "./destination";
import { WorkspaceController, type FrameLease } from "./controller";

type Overlay = {
  href: string;
  origin: FrameLease;
  returnHref: string;
  activation: number;
};
const absent: RouteSnapshot = {
  pathname: "",
  search: "",
  hash: "",
  visible: false,
  focused: false,
  activation: 0,
};
const refused = (reason: string): RouteResult => ({ kind: "refused", reason });
const isSettings = (href: string) => destination(href)?.view === "Settings";
/** Singleton overlay coordinator only: composition, tabs and domain drafts remain in their existing owners. */
export class SettingsOwner implements BrowserNavigationOwner {
  private overlay: Overlay | null = null;
  private route: RouteSnapshot = absent;
  private readonly listeners = new Set<() => void>();
  private readonly guards = new Map<object, LeaveGuard>();
  private epoch = 0;
  private intent = 0;
  private alive = true;
  private pendingFocus: FrameLease | null = null;
  constructor(
    private controller: WorkspaceController,
    private options: {
      current(): boolean;
      project(href: string, replace: boolean): boolean;
      initialHref: string;
    },
  ) {
    if (isSettings(options.initialHref)) {
      const origin = this.primary();
      if (origin)
        this.publish({
          href: options.initialHref,
          origin,
          returnHref: this.primaryHref(),
          activation: 1,
        });
    }
  }
  readonly subscribe = (run: () => void) => {
    this.listeners.add(run);
    return () => void this.listeners.delete(run);
  };
  readonly getSnapshot = () => (this.current() ? this.overlay : null);
  private current = () => this.alive && this.options.current();
  private primary() {
    const all = this.controller.getSnapshot();
    return (
      all.frames.find(
        (frame) =>
          frame.lease.pane === "primary" &&
          frame.lease.tabKey === all.primary.active,
      )?.lease ?? null
    );
  }
  private primaryHref() {
    const all = this.controller.getSnapshot();
    return (
      all.frames.find(
        (frame) =>
          frame.lease.pane === "primary" &&
          frame.lease.tabKey === all.primary.active,
      )?.destination.href ?? "/app"
    );
  }
  private publish(next: Overlay | null) {
    this.overlay = next;
    const url = next ? new URL(next.href, "https://workspace.invalid") : null;
    this.route = url
      ? {
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
          visible: true,
          focused: true,
          activation: next!.activation,
        }
      : absent;
    this.epoch++;
    for (const run of this.listeners) run();
  }
  destroy() {
    this.alive = false;
    this.intent++;
    this.guards.clear();
    this.publish(null);
    this.listeners.clear();
  }
  private async permission(to: string) {
    const opening = this.overlay,
      epoch = this.epoch,
      ticket = ++this.intent;
    const tokens = [...this.guards.keys()];
    const current = () =>
      this.current() &&
      this.overlay === opening &&
      this.epoch === epoch &&
      this.intent === ticket &&
      tokens.length === this.guards.size &&
      tokens.every((token) => this.guards.has(token));
    for (const token of tokens) {
      const guard = this.guards.get(token);
      if (!guard || !current()) return { allowed: false, current };
      try {
        if (!(await guard(to)) || !current())
          return { allowed: false, current };
      } catch {
        return { allowed: false, current };
      }
    }
    return { allowed: current(), current };
  }
  private candidate(href: string, origin: FrameLease): Overlay | null {
    if (origin.pane === "dock") {
      const captured = this.controller
        .getSnapshot()
        .frames.find(
          (frame) =>
            frame.lease.pane === origin.pane &&
            frame.lease.tabKey === origin.tabKey &&
            frame.lease.mount === origin.mount,
        )?.origin;
      if (!captured || !this.controller.owns(captured)) return null;
      origin = captured;
    }
    const next = destination(href);
    if (!next || next.view !== "Settings" || !this.controller.owns(origin))
      return null;
    return {
      href: next.href,
      origin,
      returnHref: this.overlay?.returnHref ?? this.primaryHref(),
      activation: (this.overlay?.activation ?? 0) + 1,
    };
  }
  /** Ordinary retained callbacks cannot navigate underneath a live native Settings editor. */
  routeInput = (
    origin: FrameLease,
    href: string,
    replace: boolean,
    captured: boolean,
  ): Promise<RouteResult> | null => {
    if (isSettings(href)) return this.open(origin, href, replace);
    if (!destination(href) && !/^\/app(?:\/|$)/.test(href))
      return navigateAsync(href, replace);
    if (!this.overlay) return null;
    return captured
      ? this.navigateFromOverlay(origin, href, replace)
      : Promise.resolve(refused("Close Settings before navigating this view."));
  };
  async open(
    origin: FrameLease,
    href: string,
    replace = false,
  ): Promise<RouteResult> {
    const next = this.candidate(href, origin);
    if (!next || !this.current()) return { kind: "superseded" };
    if (!this.overlay && document.querySelector("dialog[open]"))
      return refused("Close the current dialog before opening Settings.");
    const permit = await this.permission(href);
    if (!permit.allowed || !this.controller.owns(next.origin))
      return refused("Resolve the current settings before continuing.");
    if (
      !permit.current() ||
      !this.controller.owns(next.origin) ||
      !this.options.project(next.href, replace)
    )
      return { kind: "superseded" };
    this.controller.invalidatePendingInput();
    this.publish(next);
    return { kind: "committed", activation: next.activation };
  }
  async close(): Promise<RouteResult> {
    const opening = this.overlay;
    if (!opening) return { kind: "superseded" };
    const permit = await this.permission(opening.returnHref);
    if (!permit.allowed)
      return refused("Resolve the current settings before closing them.");
    if (!permit.current() || !this.options.project(this.primaryHref(), true))
      return { kind: "superseded" };
    this.pendingFocus = opening.origin;
    this.publish(null);
    return { kind: "committed", activation: opening.activation };
  }
  private async navigateFromOverlay(
    origin: FrameLease,
    href: string,
    replace = false,
  ): Promise<RouteResult> {
    if (isSettings(href)) return this.open(origin, href, replace);
    if (!destination(href)) return navigateAsync(href, replace);
    const opening = this.overlay;
    if (!opening) return { kind: "superseded" };
    const permit = await this.permission(href);
    if (!permit.allowed || !permit.current())
      return refused(
        "Resolve the current settings before following this link.",
      );
    const prepared = await this.controller.prepareOpen({
      origin,
      href,
      replace,
    });
    if (prepared.kind !== "ready") return prepared;
    if (!permit.current()) return { kind: "superseded" };
    try {
      const committed = prepared.commit(() => {
        if (!permit.current())
          throw new Error("Settings changed before the link could open.");
        const primaryHref =
          origin.pane === "primary" ? href : this.primaryHref();
        if (!this.options.project(primaryHref, true))
          throw new Error("The browser return could not commit.");
      });
      if (!committed) return { kind: "superseded" };
      const latest = this.controller.getSnapshot();
      if (origin.pane !== "dock") {
        const pane = origin.pane;
        this.pendingFocus =
          latest.frames.find(
            (frame) =>
              frame.lease.pane === pane &&
              frame.lease.tabKey === latest[pane]?.active,
          )?.lease ?? null;
      }
      this.publish(null);
      return { kind: "committed", activation: opening.activation };
    } catch {
      return refused(
        "Couldn't open that link. Settings and its draft remain open.",
      );
    }
  }
  restoreClosedFocus() {
    if (!this.current() || this.overlay || !this.pendingFocus) return;
    const origin = this.pendingFocus;
    this.pendingFocus = null;
    if (!document.querySelector("dialog[open],.menu"))
      this.controller.restoreInputFocus(origin);
  }
  readonly scope: RouteScope = {
    subscribe: this.subscribe,
    getSnapshot: () => (this.current() ? this.route : absent),
    navigate: (href, replace) => {
      const current = this.overlay;
      return current
        ? this.navigateFromOverlay(current.origin, href, replace)
        : Promise.resolve({ kind: "superseded" });
    },
    closeOverlay: () => this.close(),
    noteInput: () => {
      this.epoch++;
    },
    addGuard: (guard) => {
      const token = {};
      this.guards.set(token, guard);
      this.epoch++;
      return () => {
        if (this.guards.delete(token)) this.epoch++;
      };
    },
    setTitle: () => () => {},
  };
  async prepare(intent: BrowserIntent): Promise<BrowserDecision> {
    if (!this.current()) return { kind: "refused" };
    if (isSettings(intent.href)) {
      const origin = this.overlay?.origin ?? this.primary();
      if (!origin) return { kind: "refused" };
      if (!this.overlay && document.querySelector("dialog[open]"))
        return { kind: "refused" };
      const next = this.candidate(intent.href, origin),
        permit = await this.permission(intent.href);
      if (!next || !permit.allowed) return { kind: "refused" };
      return {
        kind: "ready",
        commit: (commit) => {
          if (!permit.current() || !this.controller.owns(next.origin))
            return false;
          commit();
          this.controller.invalidatePendingInput();
          this.publish(next);
          return true;
        },
      };
    }
    if (!this.overlay) return this.controller.prepare(intent);
    const permit = await this.permission(intent.href);
    if (!permit.allowed) return { kind: "refused" };
    const prepared = await this.controller.prepare(intent);
    if (prepared.kind !== "ready" || !permit.current())
      return { kind: "refused" };
    return {
      kind: "ready",
      commit: (commit) => {
        if (!permit.current()) return false;
        const accepted = prepared.commit(() => {
          if (!permit.current())
            throw new Error("Settings changed before navigation.");
          commit();
        });
        if (accepted) {
          this.pendingFocus = this.primary();
          this.publish(null);
        }
        return accepted;
      },
    };
  }
}

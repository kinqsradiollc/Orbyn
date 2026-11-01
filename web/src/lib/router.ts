import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import {
  useRouteScope,
  type LeaveGuard,
  type RouteResult,
} from "./route-scope";
export type { LeaveGuard } from "./route-scope";

export type BrowserIntent = {
  href: string;
  replace: boolean;
  kind: "navigate" | "pop";
  state: unknown;
};
export type BrowserDecision =
  | { kind: "refused" }
  | { kind: "ready"; commit(browserCommit: () => void): boolean };
export type BrowserNavigationOwner = {
  prepare(intent: BrowserIntent): Promise<BrowserDecision>;
};
let browserOwner: BrowserNavigationOwner | null = null;
export function installBrowserNavigationOwner(owner: BrowserNavigationOwner) {
  if (browserOwner) throw new Error("Browser navigation already has an owner.");
  browserOwner = owner;
  return () => {
    if (browserOwner === owner) {
      browserOwner = null;
      navigation++;
    }
  };
}

const NAVIGATE = "orbyn:navigate";
const leaveGuards = new Set<LeaveGuard>();
let legacyInputRevision = 0;
const INDEX = "orbynNavigationIndex";
let currentIndex: number = Number.isSafeInteger(history.state?.[INDEX])
  ? history.state[INDEX]
  : 0;
history.replaceState({ ...history.state, [INDEX]: currentIndex }, "");
let navigation = 0;
let popTransition: {
  from: number;
  to: number;
  destination: string;
  ticket: number;
  phase: "restoring" | "checking" | "replaying" | "aborting";
  decision?: BrowserDecision;
  state: unknown;
} | null = null;
const settingsRoute = (value: string) =>
  /^\/app\/(?:settings(?:\/.*)?|agents|chatgpt)$/.test(value.split(/[?#]/)[0]);

export function onBeforeNavigate(guard: LeaveGuard) {
  leaveGuards.add(guard);
  legacyInputRevision++;
  return () => {
    if (leaveGuards.delete(guard)) legacyInputRevision++;
  };
}

/** Shell captures authored input; global confirmation decisions live outside that subtree. */
export function noteLegacyInput() {
  legacyInputRevision++;
}

/** Reload/sign-out dispose the legacy route even when its URL would stay the same. */
export async function prepareLegacyExit(options: {
  current(): boolean;
  prepareGlobal(): Promise<{ allowed: boolean; current(): boolean }>;
}): Promise<{ allowed: boolean; current(): boolean }> {
  const ticket = ++navigation;
  const revision = legacyInputRevision;
  const href = location.href;
  const guards = [...leaveGuards];
  let global = { allowed: false, current: () => false };
  const current = () =>
    !browserOwner &&
    options.current() &&
    global.current() &&
    ticket === navigation &&
    revision === legacyInputRevision &&
    href === location.href;
  try {
    global = await options.prepareGlobal();
    if (!global.allowed || !current()) return { allowed: false, current };
    for (const guard of guards) {
      // Empty destination is the same forced-disposal signal as prepareAll.
      if (!(await guard("")) || !current()) return { allowed: false, current };
    }
    return { allowed: current(), current };
  } catch {
    return { allowed: false, current };
  }
}

async function canLeave(to: string) {
  for (const guard of [...leaveGuards]) {
    // An unmounted owner has no remaining draft or authority to block.
    if (!leaveGuards.has(guard)) continue;
    try {
      if (!(await guard(to))) return false;
    } catch {
      // A failed exit check must preserve the current view.
      return false;
    }
  }
  return true;
}

// Restore the original entry before asking, so a refused Back never unmounts
// the editor or loses its draft. Only this module assigns these history indices.
window.addEventListener("popstate", (event) => {
  const index: unknown = event.state?.[INDEX];
  if (!Number.isSafeInteger(index)) return;
  const next = index as number;
  if (popTransition?.phase === "replaying" && next === popTransition.to) {
    const transition = popTransition;
    if (
      transition.ticket !== navigation ||
      transition.decision?.kind !== "ready" ||
      !commitDecision(transition.decision, () => {})
    ) {
      event.stopImmediatePropagation();
      transition.phase = "aborting";
      history.go(transition.from - next);
      return;
    }
    currentIndex = next;
    activation++;
    popTransition = null;
    return;
  }
  if (popTransition) {
    event.stopImmediatePropagation();
    const transition = popTransition;
    if (next !== transition.from) {
      history.go(transition.from - next);
      return;
    }
    if (transition.phase === "aborting") {
      popTransition = null;
      return;
    }
    if (transition.phase !== "restoring") return;
    transition.phase = "checking";
    void prepareBrowser({
      href: transition.destination,
      replace: true,
      kind: "pop",
      state: transition.state,
    }).then((decision) => {
      if (popTransition !== transition) return;
      if (decision.kind !== "ready" || transition.ticket !== navigation) {
        popTransition = null;
        return;
      }
      transition.decision = decision;
      transition.phase = "replaying";
      history.go(transition.to - transition.from);
    });
    return;
  }
  if ((!leaveGuards.size && !browserOwner) || next === currentIndex) {
    currentIndex = next;
    activation++;
    return;
  }
  event.stopImmediatePropagation();
  popTransition = {
    from: currentIndex,
    to: next,
    destination: location.pathname + location.search + location.hash,
    ticket: ++navigation,
    phase: "restoring",
    state: event.state,
  };
  history.go(currentIndex - next);
});

// A Back involving a hash also emits hashchange. Suppress it while the old
// entry is being restored/checked, just like the matching popstate event.
window.addEventListener("hashchange", (event) => {
  if (popTransition) event.stopImmediatePropagation();
});

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE, listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE, listener);
    window.removeEventListener("hashchange", listener);
  };
};

let activation = 0;
export function usePath() {
  const scope = useRouteScope();
  return useSyncExternalStore(scope?.subscribe ?? subscribe, () =>
    scope ? scope.getSnapshot().pathname : location.pathname,
  );
}
export function useSearch() {
  const scope = useRouteScope();
  return useSyncExternalStore(scope?.subscribe ?? subscribe, () =>
    scope ? scope.getSnapshot().search : location.search,
  );
}
export function useHash() {
  const scope = useRouteScope();
  return useSyncExternalStore(scope?.subscribe ?? subscribe, () =>
    scope ? scope.getSnapshot().hash : location.hash,
  );
}
export function useRouteActivation() {
  const scope = useRouteScope();
  return useSyncExternalStore(scope?.subscribe ?? subscribe, () =>
    scope ? scope.getSnapshot().activation : activation,
  );
}
export function useNavigate() {
  const scope = useRouteScope();
  return useCallback(
    (to: string, replace = false): Promise<RouteResult> =>
      scope ? scope.navigate(to, replace) : navigateAsync(to, replace),
    [scope],
  );
}
/** Explicit user action (for example a global toast Open) may reveal its captured owner. */
export function useCapturedNavigate() {
  const scope = useRouteScope();
  return useCallback(
    (to: string, replace = false): Promise<RouteResult> =>
      scope?.activateNavigate
        ? scope.activateNavigate(to, replace)
        : scope
          ? scope.navigate(to, replace)
          : navigateAsync(to, replace),
    [scope],
  );
}
/** Plain onBeforeNavigate stays WINDOW-scoped. Retained consumers migrate to this hook. */
export function useBeforeNavigate(guard: LeaveGuard) {
  const scope = useRouteScope();
  useLayoutEffect(
    () => (scope ? scope.addGuard(guard) : onBeforeNavigate(guard)),
    [scope, guard],
  );
}

function relative(to: string): string | null {
  try {
    const url = new URL(to, location.href);
    return url.origin === location.origin && !url.username && !url.password
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}
async function prepareBrowser(intent: BrowserIntent): Promise<BrowserDecision> {
  const owner = browserOwner;
  if (!(await canLeave(intent.href))) return { kind: "refused" };
  if (owner !== browserOwner) return { kind: "refused" };
  try {
    return owner
      ? await owner.prepare(intent)
      : {
          kind: "ready",
          commit: (commit) => {
            if (browserOwner) return false;
            commit();
            return true;
          },
        };
  } catch {
    return { kind: "refused" };
  }
}

function commitDecision(
  decision: BrowserDecision,
  commit: () => void,
): boolean {
  try {
    return decision.kind === "ready" && decision.commit(commit);
  } catch {
    return false;
  }
}

function writeBrowser(
  to: string,
  replace: boolean,
  metadata: Record<string, unknown>,
) {
  const from = location.pathname + location.search + location.hash;
  const previousReturn: unknown =
    history.state?.orbynSettingsReturn ?? history.state?.orbynFrom;
  const settingsReturn = settingsRoute(to)
    ? settingsRoute(from)
      ? typeof previousReturn === "string" && !settingsRoute(previousReturn)
        ? previousReturn
        : "/app"
      : from
    : undefined;
  const same = to === from;
  const nextIndex = currentIndex + (!replace && !same ? 1 : 0);
  history[replace || same ? "replaceState" : "pushState"](
    {
      [INDEX]: nextIndex,
      orbynFrom: from,
      ...(settingsReturn ? { orbynSettingsReturn: settingsReturn } : {}),
      ...metadata,
    },
    "",
    to,
  );
  currentIndex = nextIndex;
}

/** Install-once owner receives this handle. It bypasses dispatch, never browser ownership. */
export function browserCommitBoundary(owner: BrowserNavigationOwner) {
  return (
    to: string,
    replace: boolean,
    metadata: Record<string, unknown> = {},
  ): boolean => {
    const href = relative(to);
    if (!href || browserOwner !== owner || popTransition) return false;
    // Invalidates an older global navigate awaiting a guard.
    navigation++;
    try {
      writeBrowser(href, replace, metadata);
      activation++;
      window.dispatchEvent(new Event(NAVIGATE));
      return true;
    } catch {
      return false;
    }
  };
}

export async function navigateAsync(
  to: string,
  replace = false,
): Promise<RouteResult> {
  const href = relative(to);
  if (!href)
    return { kind: "refused", reason: "That destination isn't on this app." };
  if (popTransition)
    return { kind: "refused", reason: "Finish the current navigation first." };
  const ticket = ++navigation;
  if (!browserOwner && !leaveGuards.size) {
    writeBrowser(href, replace, {});
    activation++;
    window.dispatchEvent(new Event(NAVIGATE));
    window.scrollTo(0, 0);
    return { kind: "committed", activation };
  }
  const decision = await prepareBrowser({
    href,
    replace,
    kind: "navigate",
    state: null,
  });
  if (ticket !== navigation) return { kind: "superseded" };
  if (decision.kind !== "ready")
    return {
      kind: "refused",
      reason: "Resolve the current view before leaving.",
    };
  const committed = commitDecision(decision, () => {
    writeBrowser(href, replace, {});
    activation++;
    window.dispatchEvent(new Event(NAVIGATE));
    // Only legacy global routing owns the window scroller.
    if (!browserOwner) window.scrollTo(0, 0);
  });
  return committed ? { kind: "committed", activation } : { kind: "superseded" };
}

/** Backward compatible fire-and-forget global primary/browser entry. */
export function navigate(to: string, replace = false) {
  void navigateAsync(to, replace);
}

/** Matches "/app/doc/:id" against a path, returning its parameters. */
export function match(pattern: string, path: string) {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) params[want[i].slice(1)] = have[i];
    else if (want[i] !== have[i]) return null;
  }
  return params;
}

export function useTitle(title: string) {
  const scope = useRouteScope();
  useEffect(() => {
    if (scope) return scope.setTitle(title);
    document.title = title ? `${title} · Orbyn` : "Orbyn";
  }, [title, scope]);
}

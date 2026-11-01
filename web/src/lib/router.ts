import { useEffect, useSyncExternalStore } from "react";

const NAVIGATE = "orbyn:navigate";
type LeaveGuard = (destination: string) => boolean | Promise<boolean>;
const leaveGuards = new Set<LeaveGuard>();
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
  phase: "restoring" | "checking" | "replaying";
} | null = null;
const settingsRoute = (value: string) =>
  /^\/app\/(?:settings(?:\/.*)?|agents|chatgpt)$/.test(value.split(/[?#]/)[0]);

export function onBeforeNavigate(guard: LeaveGuard) {
  leaveGuards.add(guard);
  return () => void leaveGuards.delete(guard);
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
    currentIndex = next;
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
    if (transition.phase !== "restoring") return;
    transition.phase = "checking";
    void canLeave(transition.destination).then((allowed) => {
      if (popTransition !== transition) return;
      if (!allowed || transition.ticket !== navigation) {
        popTransition = null;
        return;
      }
      transition.phase = "replaying";
      history.go(transition.to - transition.from);
    });
    return;
  }
  if (!leaveGuards.size || next === currentIndex) {
    currentIndex = next;
    return;
  }
  event.stopImmediatePropagation();
  popTransition = {
    from: currentIndex,
    to: next,
    destination: location.pathname + location.search + location.hash,
    ticket: ++navigation,
    phase: "restoring",
  };
  history.go(currentIndex - next);
});

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE, listener);
  };
};

export const usePath = () =>
  useSyncExternalStore(subscribe, () => location.pathname);
export const useSearch = () =>
  useSyncExternalStore(subscribe, () => location.search);

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search + location.hash) return;
  if (popTransition) return;
  const ticket = ++navigation;
  const commit = () => {
    if (ticket !== navigation) return;
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
    if (!replace) currentIndex++;
    history[replace ? "replaceState" : "pushState"](
      {
        [INDEX]: currentIndex,
        orbynFrom: from,
        ...(settingsReturn ? { orbynSettingsReturn: settingsReturn } : {}),
      },
      "",
      to,
    );
    window.dispatchEvent(new Event(NAVIGATE));
    window.scrollTo(0, 0);
  };
  if (!leaveGuards.size) commit();
  else void canLeave(to).then((allowed) => allowed && commit());
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
  useEffect(() => {
    document.title = title ? `${title} · Orbyn` : "Orbyn";
  }, [title]);
}

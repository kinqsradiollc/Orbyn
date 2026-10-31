import {
  AssistantControlsStore,
  AssistantProfileStore,
  type LiveNews,
} from "@orbyn/api-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { client, getToken, onToken } from "../../lib/session";

export type Lane = "background" | "overnight";
export const LANE_NAME: Record<Lane, string> = {
  background: "Background",
  overnight: "Overnight",
};

/** The signed-in account. A change remounts whatever is keyed on it. */
export const useOwner = () => useSyncExternalStore(onToken, getToken);

/** True while this mount still belongs to the account that started it. */
export function useOwned() {
  const owner = useRef(getToken()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current && getToken() === owner, [owner]);
}

type Listener = (news: LiveNews) => void;
const listeners = new Set<Listener>();
let stopStream: (() => void) | undefined;
const startStream = () => {
  stopStream ??= client.watchEvents((news) => {
    // Fence reads that began before the change, then tell the screens.
    if (news.kind === "changed") client.noteExternalMutation();
    listeners.forEach((one) => one(news));
  });
};
const stopStreamNow = () => {
  stopStream?.();
  stopStream = undefined;
};
onToken(() => {
  stopStreamNow();
  if (listeners.size && getToken()) startStream();
});

/** One server stream for every agent screen on the page. */
export function onLive(listener: Listener) {
  listeners.add(listener);
  startStream();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stopStreamNow();
  };
}

/** A foreground return: focus, or the tab showing again. */
export function onForeground(run: () => void) {
  const again = () => {
    if (!document.hidden) run();
  };
  window.addEventListener("focus", again);
  document.addEventListener("visibilitychange", again);
  return () => {
    window.removeEventListener("focus", again);
    document.removeEventListener("visibilitychange", again);
  };
}

/** Background and Overnight as the server reports them now, kept fresh. */
export function useProfiles() {
  const owner = useOwner();
  const store = useMemo(
    () => new AssistantProfileStore(client, getToken),
    [owner],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    const refresh = () => {
      if (!document.hidden) void store.refresh();
    };
    const timer = setInterval(refresh, 15_000);
    const stopLive = onLive((news) => {
      if (news.kind === "changed" && (!news.area || news.area === "assistant"))
        refresh();
    });
    const stopForeground = onForeground(refresh);
    return () => {
      clearInterval(timer);
      stopLive();
      stopForeground();
      store.reset();
    };
  }, [store]);
  return { ...snapshot, refresh: store.refresh };
}

/** Pause and mute switches. An unclear save asks for a fresh read before another. */
export function useControls(delivery: boolean) {
  const owner = useOwner();
  const store = useMemo(
    () => new AssistantControlsStore(client, getToken, delivery),
    [owner, delivery],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    return () => store.reset();
  }, [store]);
  return { state, set: store.set, refresh: store.refresh };
}

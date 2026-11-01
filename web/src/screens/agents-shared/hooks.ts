import "./agents-shared.css";
import {
  AssistantControlsStore,
  AssistantProfileStore,
  type LiveNews,
} from "@orbyn/api-client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  client,
  getSessionVersion,
  getToken,
  onToken,
} from "../../lib/session";

export type Lane = "background" | "overnight";
export const LANE_NAME: Record<Lane, string> = {
  background: "Background",
  overnight: "Overnight",
};

/** A→signed out→A is a new owner even when its final token is identical. */
export const useOwner = () => useSyncExternalStore(onToken, getSessionVersion);

/** Old callbacks lose authority synchronously at a session change. */
export function useOwned() {
  const owner = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && !!getToken() && getSessionVersion() === owner,
    [owner],
  );
}

type Listener = { owner: number; run: (news: LiveNews) => void };
const listeners = new Set<Listener>();
let stopStream: (() => void) | undefined;
const startStream = () => {
  if (stopStream || !listeners.size || !getToken()) return;
  const owner = getSessionVersion();
  const deliver = (news: LiveNews) => {
    if (owner !== getSessionVersion() || !getToken()) return;
    if (news.kind === "changed") client.noteExternalMutation();
    for (const one of listeners) if (one.owner === owner) one.run(news);
  };
  stopStream = client.watchEvents(deliver, () => deliver({ kind: "changed" }));
};
const stopStreamNow = () => {
  stopStream?.();
  stopStream = undefined;
};
onToken(() => {
  stopStreamNow();
  // New mounts subscribe for the new generation; never transfer old callbacks.
  listeners.clear();
});

/** One server stream, with every subscriber bound to its account generation. */
export function onLive(run: (news: LiveNews) => void) {
  const listener = { owner: getSessionVersion(), run };
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

/** The existing profile store coalesces concurrent poll/live/foreground reads. */
export function useProfiles() {
  const owner = useOwner();
  const owned = useOwned();
  const store = useMemo(
    () => new AssistantProfileStore(client, getSessionVersion),
    [owner],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const refresh = useCallback(
    () => (owned() ? store.refresh() : Promise.resolve()),
    [owned, store],
  );
  useEffect(() => {
    let active = true;
    let pending: Promise<void> | null = null;
    let again = false;
    const read = (invalidate = true) => {
      if (!active || !owned() || document.hidden) return;
      if (pending) {
        // A live/foreground invalidation during a read needs one fresh read
        // afterward. Poll ticks merely join it; bursts never form a queue.
        again ||= invalidate;
        return;
      }
      pending = refresh().finally(() => {
        pending = null;
        if (again && active && owned()) {
          again = false;
          read(false);
        }
      });
    };
    read(false);
    const timer = setInterval(() => read(false), 15_000);
    const stopLive = onLive((news) => {
      if (news.kind === "changed" && (!news.area || news.area === "assistant"))
        read();
    });
    const stopForeground = onForeground(() => read());
    const stopAccount = onToken(store.reset);
    return () => {
      active = false;
      again = false;
      clearInterval(timer);
      stopLive();
      stopForeground();
      stopAccount();
      store.reset();
    };
  }, [store, refresh, owned]);
  return { ...snapshot, refresh };
}

/** Unclear saves require a fresh read before another change. */
export function useControls(delivery: boolean) {
  const owner = useOwner();
  const owned = useOwned();
  const [deliveryState, setDeliveryState] = useState<{
    enabled: boolean | null;
    error: string;
  }>({ enabled: null, error: "" });
  const capabilityRequest = useRef(0);
  const capabilityFlight = useRef<Promise<void> | null>(null);
  const refreshDelivery = useCallback((): Promise<void> => {
    if (!delivery || !owned()) return Promise.resolve();
    if (capabilityFlight.current) return capabilityFlight.current;
    const mine = ++capabilityRequest.current;
    const task = client
      .assistantConversation()
      .then(
        (home) => {
          if (owned() && mine === capabilityRequest.current)
            setDeliveryState({ enabled: home.enabled, error: "" });
        },
        () => {
          if (owned() && mine === capabilityRequest.current)
            setDeliveryState({
              enabled: null,
              error: "Couldn't check conversation notifications.",
            });
        },
      )
      .finally(() => {
        if (capabilityFlight.current === task) capabilityFlight.current = null;
      });
    capabilityFlight.current = task;
    return task;
  }, [delivery, owned]);
  useEffect(() => {
    if (!delivery) return;
    void refreshDelivery();
    const stop = onForeground(() => void refreshDelivery());
    return () => {
      capabilityRequest.current++;
      stop();
    };
  }, [delivery, refreshDelivery]);
  const deliveryAvailable = delivery ? deliveryState.enabled : false;
  const store = useMemo(
    () =>
      new AssistantControlsStore(
        client,
        getSessionVersion,
        deliveryAvailable === true,
      ),
    [owner, deliveryAvailable],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const refresh = useCallback(
    () => (owned() ? store.refresh() : Promise.resolve()),
    [owned, store],
  );
  const set = useCallback(
    (...args: Parameters<AssistantControlsStore["set"]>) =>
      owned() && (args[0] !== "muted" || deliveryAvailable === true)
        ? store.set(...args)
        : Promise.resolve(),
    [owned, store, deliveryAvailable],
  );
  useEffect(() => {
    let active = true;
    let dirty = false;
    let queued = false;
    const reconcile = () => {
      if (!active || !owned() || document.hidden) return;
      dirty = true;
      if (queued || store.getSnapshot().busy) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!active || !owned() || document.hidden || store.getSnapshot().busy)
          return;
        dirty = false;
        void refresh();
      });
    };
    const stopSettled = store.subscribe(() => {
      // An event received during a save/read is reconciled after it settles.
      // Never interrupt a command or allow a second command while it is busy.
      if (dirty && !store.getSnapshot().busy) reconcile();
    });
    reconcile();
    const stopAccount = onToken(store.reset);
    const stopLive = onLive((news) => {
      if (news.kind === "changed" && (!news.area || news.area === "assistant"))
        reconcile();
    });
    const stopForeground = onForeground(reconcile);
    return () => {
      active = false;
      dirty = false;
      stopAccount();
      stopLive();
      stopForeground();
      stopSettled();
      store.reset();
    };
  }, [store, refresh, owned]);
  return {
    state,
    set,
    refresh,
    deliveryAvailable,
    deliveryError: deliveryState.error,
    refreshDelivery,
  };
}

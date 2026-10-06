/** App-owned scheduler: suspended apps never keep claiming private work. */
export function createChatgptForegroundRuntime(options: {
  available: (userId: string) => Promise<boolean>;
  create: (userId: string) => Promise<{
    start: (
      signal?: AbortSignal,
    ) => Promise<{ selection: { connection_id: string; executor_id: string } }>;
    heartbeat: (signal?: AbortSignal) => Promise<unknown>;
    executeNext: (signal?: AbortSignal) => Promise<unknown>;
    close: () => void;
  }>;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  type Owner = { userId: string; token: string; foreground: boolean };
  let owner: Owner = { userId: "", token: "", foreground: false };
  let generation = 0;
  let active: Awaited<ReturnType<typeof options.create>> | null = null;
  let controller: AbortController | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let state: {
    userId: string;
    status: "idle" | "starting" | "ready" | "paused" | "error";
    selection: { connection_id: string; executor_id: string } | null;
  } = { userId: "", status: "idle", selection: null };
  const listeners = new Set<() => void>();
  const emit = (
    status: typeof state.status,
    selection: typeof state.selection = null,
  ) => {
    state = { userId: owner.userId, status, selection };
    for (const listener of listeners) listener();
  };
  const stop = () => {
    generation++;
    controller?.abort();
    controller = null;
    for (const timer of timers) (options.cancel ?? clearTimeout)(timer);
    timers.clear();
    active?.close();
    active = null;
  };
  const begin = async () => {
    stop();
    if (!owner.userId || !owner.token) {
      emit("idle");
      return;
    }
    if (!owner.foreground) {
      emit("paused");
      return;
    }
    const captured = { ...owner },
      epoch = generation;
    const live = () =>
      generation === epoch &&
      owner.userId === captured.userId &&
      owner.token === captured.token &&
      owner.foreground;
    const signal = (controller = new AbortController()).signal;
    emit("starting");
    let runtime: Awaited<ReturnType<typeof options.create>> | null = null;
    try {
      if (!(await options.available(captured.userId))) {
        if (live()) emit("idle");
        return;
      }
      if (!live()) return;
      runtime = await options.create(captured.userId);
      if (!live()) {
        runtime.close();
        return;
      }
      active = runtime;
      const started = await runtime.start(signal);
      if (!live()) {
        runtime.close();
        return;
      }
      emit("ready", started.selection);
      const queue = (work: () => Promise<unknown>, delay: number) => {
        if (!live()) return;
        const timer = (options.schedule ?? setTimeout)(async () => {
          timers.delete(timer);
          if (!live()) return;
          try {
            await work();
            if (live()) queue(work, delay);
          } catch {
            if (live()) {
              stop();
              emit("error");
            }
          }
        }, delay);
        timers.add(timer);
      };
      // Claim and heartbeat timers are separate; model work cannot starve lease renewal.
      queue(() => runtime!.heartbeat(signal), 25000);
      queue(() => runtime!.executeNext(signal), 10000);
    } catch {
      runtime?.close();
      if (live()) {
        stop();
        emit("error");
      }
    }
  };
  return {
    update(next: Owner) {
      if (JSON.stringify(next) === JSON.stringify(owner)) return;
      owner = { ...next };
      void begin();
    },
    restart() {
      void begin();
    },
    suspend() {
      stop();
      emit("paused");
    },
    snapshot() {
      return {
        ...state,
        selection: state.selection ? { ...state.selection } : null,
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      stop();
      owner = { userId: "", token: "", foreground: false };
      emit("idle");
    },
  };
}

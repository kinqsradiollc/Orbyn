/** Local decisions and authorized remote events share one invalidation signal. */
const listeners = new WeakMap<object, Map<string, Set<() => void>>>();
export function invalidateDocViews(api: object, id: string) {
  listeners
    .get(api)
    ?.get(id)
    ?.forEach((notify) => notify());
}

/** Coalesces refreshes without dropping an event received during a fetch. */
export function watchDocRefresh<T>(options: {
  api: object & { watchDoc(id: string, changed: () => void): () => void };
  id: string;
  session: () => unknown;
  load: () => Promise<T>;
  received: (value: T) => void;
  failed: (error: unknown) => void;
}) {
  const identity = options.session();
  let stopped = false;
  let pending = false;
  let running: Promise<void> | undefined;
  const current = () => !stopped && identity === options.session();
  const refresh = (): Promise<void> => {
    if (!current()) return Promise.resolve();
    pending = true;
    if (running) return running;
    running = Promise.resolve()
      .then(async () => {
        while (pending && current()) {
          pending = false;
          try {
            const value = await options.load();
            if (current()) options.received(value);
          } catch (error) {
            if (current()) options.failed(error);
          }
        }
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };
  let pages = listeners.get(options.api);
  if (!pages) listeners.set(options.api, (pages = new Map()));
  let subscribers = pages.get(options.id);
  if (!subscribers) pages.set(options.id, (subscribers = new Set()));
  const notify = () => {
    void refresh();
  };
  subscribers.add(notify);
  const stopRemote = options.api.watchDoc(options.id, notify);
  void refresh();
  return {
    refresh,
    dispose() {
      stopped = true;
      pending = false;
      stopRemote();
      subscribers.delete(notify);
      if (!subscribers.size) pages.delete(options.id);
    },
  };
}

import {
  chatgptCatalogRead,
  chatgptExecutorList,
  chatgptCatalogSelection,
  chatgptModelPreference,
  type ChatgptCatalogRead,
  type ChatgptCatalogSelection,
  type ChatgptCatalogDefaultUpdate,
  type ChatgptExecutorSummary,
} from "@orbyn/core";

export type ChatgptRemoteApi = {
  chatgptExecutors(signal?: AbortSignal): Promise<unknown>;
  chatgptModels(
    selection: ChatgptCatalogSelection,
    signal?: AbortSignal,
  ): Promise<unknown>;
  selectChatgptDefault(
    update: ChatgptCatalogDefaultUpdate,
    signal?: AbortSignal,
  ): Promise<unknown>;
};
export type ChatgptRemoteState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  devices: ChatgptExecutorSummary[];
  selection: ChatgptCatalogSelection | null;
  catalog: ChatgptCatalogRead | null;
  saving: boolean;
  error: string | null;
};
const empty = (): ChatgptRemoteState => ({
  status: "idle",
  devices: [],
  selection: null,
  catalog: null,
  saving: false,
  error: null,
});

/** Bound UI lifetime even if an underlying transport ignores its abort signal. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("Request cancelled."));
    if (signal.aborted) {
      pending.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** First-party model management shared by web and mobile; never handles provider tokens. */
export class ChatgptRemoteStore {
  private state = empty();
  private generation = 0;
  private token = "";
  private closed = false;
  private active: AbortController | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private readonly options: {
      api: ChatgptRemoteApi;
      userId: string;
      getToken(): string;
    },
  ) {}

  private syncToken() {
    const token = this.options.getToken();
    if (token === this.token) return;
    this.token = token;
    ++this.generation;
    this.active?.abort();
    if (this.expiry) clearTimeout(this.expiry);
    this.state = empty();
  }
  /** Never returns another session's cached catalog, even before effects run. */
  snapshot(): ChatgptRemoteState {
    this.syncToken();
    return structuredClone(this.state);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(state: ChatgptRemoteState) {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    if (state.catalog?.status === "ready") {
      const catalog = state.catalog;
      const status =
        !catalog.expires_at || !catalog.published_at
          ? "unavailable"
          : Date.parse(catalog.expires_at) <= Date.now()
            ? "offline"
            : Date.parse(catalog.published_at) + 300_000 <= Date.now()
              ? "stale"
              : "ready";
      if (status !== "ready")
        state = { ...state, catalog: { ...catalog, status } };
    }
    this.state = state;
    const catalog = state.catalog;
    if (
      catalog?.status === "ready" &&
      catalog.expires_at &&
      catalog.published_at
    ) {
      const expiry = Date.parse(catalog.expires_at);
      const stale = Date.parse(catalog.published_at) + 300_000;
      const generation = this.generation;
      this.expiry = setTimeout(
        () => {
          if (
            this.closed ||
            generation !== this.generation ||
            this.options.getToken() !== this.token
          )
            return;
          this.publish({
            ...this.state,
            catalog: {
              ...catalog,
              status: Date.now() >= expiry ? "offline" : "stale",
            },
          });
        },
        Math.max(0, Math.min(expiry, stale) - Date.now()),
      );
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* A view cannot interrupt ownership fencing. */
      }
    }
  }
  private begin() {
    this.syncToken();
    if (this.closed || !this.token || !this.options.userId) return null;
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    const generation = ++this.generation;
    const token = this.token;
    const timer = setTimeout(() => controller.abort(), 30_000);
    return {
      signal: controller.signal,
      current: () =>
        !this.closed &&
        generation === this.generation &&
        token === this.options.getToken(),
      finish: () => clearTimeout(timer),
    };
  }
  private validateCatalog(value: unknown, selection: ChatgptCatalogSelection) {
    const catalog = chatgptCatalogRead.parse(value);
    if (
      catalog.binding.user_id !== this.options.userId ||
      catalog.binding.connection_id !== selection.connection_id ||
      catalog.executor_id !== selection.executor_id
    )
      throw new Error("Catalog ownership changed.");
    return catalog;
  }
  /** Refresh device discovery and the explicitly selected catalog, without inventing a default. */
  async refresh(): Promise<void> {
    const op = this.begin();
    if (!op) return;
    const previous = this.state.selection;
    this.publish({ ...empty(), status: "loading" });
    try {
      const devices = chatgptExecutorList.parse(
        await abortable(
          this.options.api.chatgptExecutors(op.signal),
          op.signal,
        ),
      );
      op.signal.throwIfAborted();
      if (!op.current()) return;
      const selection =
        previous &&
        devices.some(
          (d) =>
            d.executor_id === previous.executor_id &&
            d.connection_id === previous.connection_id,
        )
          ? previous
          : null;
      const catalog = selection
        ? this.validateCatalog(
            await abortable(
              this.options.api.chatgptModels(selection, op.signal),
              op.signal,
            ),
            selection,
          )
        : null;
      op.signal.throwIfAborted();
      if (!op.current()) return;
      this.publish({
        ...empty(),
        status: "ready",
        devices,
        selection,
        catalog,
      });
    } catch {
      if (op.current())
        this.publish({
          ...empty(),
          status: "unavailable",
          error: "ChatGPT devices could not be loaded. Try again.",
        });
    } finally {
      op.finish();
    }
  }
  /** The person chooses a device; no arbitrary first account or model is selected. */
  async select(value: ChatgptCatalogSelection): Promise<void> {
    const selection = chatgptCatalogSelection.parse(value);
    this.syncToken();
    if (
      !this.state.devices.some(
        (d) =>
          d.executor_id === selection.executor_id &&
          d.connection_id === selection.connection_id,
      )
    )
      return;
    const op = this.begin();
    if (!op) return;
    this.publish({
      ...this.state,
      status: "loading",
      selection,
      catalog: null,
      saving: false,
      error: null,
    });
    try {
      const catalog = this.validateCatalog(
        await abortable(
          this.options.api.chatgptModels(selection, op.signal),
          op.signal,
        ),
        selection,
      );
      op.signal.throwIfAborted();
      if (op.current())
        this.publish({ ...this.state, status: "ready", catalog });
    } catch {
      if (op.current())
        this.publish({
          ...this.state,
          status: "unavailable",
          error: "This device's models are unavailable. Refresh and try again.",
        });
    } finally {
      op.finish();
    }
  }
  /** Writes the exact account-bound version; stale/offline catalogs cannot authorize a model. */
  async save(model: string | null): Promise<void> {
    this.syncToken();
    const { selection, catalog } = this.state;
    if (
      this.state.saving ||
      this.state.status !== "ready" ||
      !selection ||
      catalog?.status !== "ready"
    )
      return;
    if (
      !catalog.expires_at ||
      !catalog.published_at ||
      Date.parse(catalog.expires_at) <= Date.now() ||
      Date.parse(catalog.published_at) + 300_000 <= Date.now()
    ) {
      this.publish({ ...this.state, catalog: { ...catalog, status: "stale" } });
      return;
    }
    if (model !== null && !catalog.models.some((m) => m.slug === model)) return;
    const op = this.begin();
    if (!op) return;
    this.publish({ ...this.state, saving: true, error: null });
    try {
      const preference = chatgptModelPreference.parse(
        await abortable(
          this.options.api.selectChatgptDefault(
            { selection, preference: { ...catalog.preference, model } },
            op.signal,
          ),
          op.signal,
        ),
      );
      op.signal.throwIfAborted();
      if (
        JSON.stringify(preference.binding) !==
          JSON.stringify(catalog.binding) ||
        preference.model !== model ||
        preference.version !== catalog.preference.version + 1
      )
        throw new Error("Default ownership changed.");
      if (op.current())
        this.publish({
          ...this.state,
          saving: false,
          catalog: { ...catalog, preference },
        });
    } catch {
      // Discard the failed revision so it cannot be immediately reused.
      if (op.current())
        this.publish({
          ...this.state,
          status: "unavailable",
          saving: false,
          catalog: null,
          error:
            "The default could not be saved. Refresh this device's models and try again.",
        });
    } finally {
      op.finish();
    }
  }
  /** Dispose on account changes/unmount; pending operations cannot publish after this. */
  close() {
    this.closed = true;
    ++this.generation;
    this.active?.abort();
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.state = empty();
    this.listeners.clear();
  }
}

import {
  chatgptDefaultStatus,
  chatgptModel,
  chatgptModelBinding,
  chatgptModelPreference,
  type ChatgptModel,
  type ChatgptModelBinding,
  type ChatgptModelPreference,
} from "@orbyn/core";

export type ChatgptModelPickerState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  models: ChatgptModel[];
  preference: ChatgptModelPreference | null;
  saving: boolean;
  error: string | null;
};
export type ChatgptModelPreferenceStore = {
  read(binding: ChatgptModelBinding, signal?: AbortSignal): Promise<unknown>;
  /** Atomically compare version and persist the choice; a conflict must reject. */
  write(preference: ChatgptModelPreference): Promise<unknown>;
};

/** One verified connection owns this state; settings and composer subscribe to it. */
export class ChatgptModelPicker {
  private readonly binding: ChatgptModelBinding;
  private state: ChatgptModelPickerState = {
    status: "idle",
    models: [],
    preference: null,
    saving: false,
    error: null,
  };
  private generation = 0;
  private closed = false;
  private abort: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private readonly options: {
      binding: ChatgptModelBinding;
      models(signal: AbortSignal): Promise<ChatgptModel[]>;
      store: ChatgptModelPreferenceStore;
    },
  ) {
    this.binding = Object.freeze(chatgptModelBinding.parse(options.binding));
  }

  /** Independent copies prevent one view modifying another view's catalog. */
  snapshot(): ChatgptModelPickerState {
    return {
      ...this.state,
      models: this.state.models.map((model) => ({ ...model })),
      preference: this.state.preference
        ? {
            ...this.state.preference,
            binding: { ...this.state.preference.binding },
          }
        : null,
    };
  }

  /** Observe changes; the returned function detaches that view. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(state: ChatgptModelPickerState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private preference(value: unknown) {
    const preference = chatgptModelPreference.parse(value);
    for (const key of Object.keys(
      this.binding,
    ) as (keyof ChatgptModelBinding)[])
      if (preference.binding[key] !== this.binding[key])
        throw new Error("The model preference belongs to another connection.");
    return preference;
  }

  /** Refresh catalog and default together; stale or failed loads never enable inference. */
  async load(): Promise<void> {
    if (this.closed) throw new Error("This ChatGPT connection is closed.");
    if (this.state.saving)
      throw new Error("Wait for the default model to finish saving.");
    const generation = ++this.generation;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ ...this.state, status: "loading", models: [], error: null });
    try {
      const [catalog, saved] = await Promise.all([
        this.options.models(abort.signal),
        this.options.store.read({ ...this.binding }, abort.signal),
      ]);
      const models = catalog.map((model) => chatgptModel.parse(model));
      if (
        models.length > 1000 ||
        new Set(models.map((model) => model.slug)).size !== models.length
      )
        throw new Error("Invalid model catalog.");
      const preference = this.preference(saved);
      if (this.closed || generation !== this.generation) return;
      this.publish({
        status: "ready",
        models,
        preference,
        saving: false,
        error: null,
      });
    } catch {
      if (this.closed || generation !== this.generation) return;
      this.publish({
        ...this.state,
        status: "unavailable",
        models: [],
        saving: false,
        error: "ChatGPT models could not be loaded. Reconnect or retry.",
      });
    }
  }

  /** Read a default changed on another client before capturing a new inference turn. */
  async refreshPreference(signal?: AbortSignal): Promise<void> {
    if (
      this.closed ||
      this.state.status !== "ready" ||
      this.state.saving ||
      !this.state.preference
    )
      throw new Error(
        "Load an available ChatGPT default model before continuing.",
      );
    const generation = this.generation;
    const previous = this.state.preference;
    try {
      signal?.throwIfAborted();
      const preference = this.preference(
        await this.options.store.read({ ...this.binding }, signal),
      );
      signal?.throwIfAborted();
      if (
        this.closed ||
        generation !== this.generation ||
        this.state.saving ||
        this.state.status !== "ready" ||
        !this.state.preference
      )
        throw new Error("The ChatGPT default changed while it was being read.");
      if (
        preference.version < this.state.preference.version ||
        (preference.version === this.state.preference.version &&
          preference.model !== this.state.preference.model)
      )
        throw new Error("The ChatGPT default response is stale.");
      this.publish({ ...this.state, preference, error: null });
    } catch {
      if (
        !this.closed &&
        generation === this.generation &&
        !this.state.saving &&
        this.state.preference?.version === previous.version
      )
        this.publish({
          ...this.state,
          status: "unavailable",
          models: [],
          error:
            "The default model could not be refreshed. Reload before continuing.",
        });
      throw new Error(
        "The default model could not be refreshed. Reload before continuing.",
      );
    }
  }

  /** Persist an entitled choice using the last observed preference version. */
  async setDefault(slug: string | null): Promise<void> {
    if (this.closed || this.state.status !== "ready" || !this.state.preference)
      throw new Error(
        "Load this connection's model catalog before choosing a default.",
      );
    if (this.state.saving)
      throw new Error("A default model save is already in progress.");
    if (
      slug !== null &&
      !this.state.models.some((model) => model.slug === slug)
    )
      throw new Error("That model is not available to this ChatGPT account.");
    const generation = this.generation;
    const previous = this.state.preference;
    this.publish({ ...this.state, saving: true, error: null });
    try {
      const saved = this.preference(
        await this.options.store.write({
          ...previous,
          binding: { ...this.binding },
          model: slug,
        }),
      );
      if (saved.version <= previous.version || saved.model !== slug)
        throw new Error("Invalid model preference receipt.");
      if (this.closed || generation !== this.generation) return;
      this.publish({
        ...this.state,
        preference: saved,
        saving: false,
        error: null,
      });
    } catch {
      if (this.closed || generation !== this.generation) return;
      this.publish({
        ...this.state,
        status: "unavailable",
        models: [],
        saving: false,
        error: "The default model was not saved. Reload before trying again.",
      });
      throw new Error(
        "The default model was not saved. Reload before trying again.",
      );
    }
  }

  /** Removed defaults remain visible; only a current entitled default can run. */
  defaultStatus() {
    return chatgptDefaultStatus(
      this.state.status === "ready" ? this.state.models : [],
      this.state.preference?.model ?? null,
    );
  }

  /** Close before switching accounts; late loads and writes cannot repaint the new view. */
  close(): void {
    this.closed = true;
    this.generation++;
    this.abort?.abort();
    this.publish({
      status: "idle",
      models: [],
      preference: null,
      saving: false,
      error: null,
    });
    this.listeners.clear();
  }
}

import {
  chatgptDesktopCommand,
  chatgptDesktopState,
  chatgptDesktopDisconnect,
  type ChatgptDesktopCommand,
  type ChatgptDesktopState,
} from "@orbyn/core";

export type ChatgptDesktopBridge = {
  syncSession(token: string | null): Promise<unknown>;
  command(command: ChatgptDesktopCommand): Promise<unknown>;
  onChange(listener: () => void): () => void;
};
export type ChatgptDesktopStoreState = {
  status: "unsupported" | "loading" | "ready" | "unavailable";
  connection: ChatgptDesktopState | null;
  error: string | null;
  notice: string | null;
};

/** Shared renderer metadata store. Provider credentials are not part of this interface. */
export class ChatgptDesktopStore {
  private state: ChatgptDesktopStoreState;
  private generation = 0;
  private reads = 0;
  private commands = 0;
  private initializing = false;
  private closed = false;
  private token: string | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly bridge?: ChatgptDesktopBridge) {
    this.state = {
      status: bridge ? "loading" : "unsupported",
      connection: null,
      error: null,
      notice: null,
    };
    if (bridge)
      this.unsubscribe = bridge.onChange(() => {
        if (this.closed || this.initializing || !this.token) return;
        void this.reload();
      });
  }
  /** Independent copies keep settings and composer from modifying shared state. */
  snapshot(): ChatgptDesktopStoreState {
    return structuredClone(this.state);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(state: ChatgptDesktopStoreState) {
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* A subscriber cannot interrupt session fencing. */
      }
    }
  }
  private requireBridge() {
    if (this.closed || !this.bridge)
      throw new Error("ChatGPT connections require the Orbyn desktop runtime.");
    return this.bridge;
  }
  /** Initialize from the first-party Orbyn session; no ChatGPT token can be supplied here. */
  async syncSession(token: string | null): Promise<void> {
    if (!this.bridge || this.closed) return;
    const generation = ++this.generation;
    const read = ++this.reads;
    this.token = token;
    this.initializing = true;
    this.publish({
      status: "loading",
      connection: null,
      error: null,
      notice: null,
    });
    try {
      const connection = chatgptDesktopState.parse(
        await this.bridge.syncSession(token),
      );
      if (this.closed || generation !== this.generation || read !== this.reads)
        return;
      this.publish({ status: "ready", connection, error: null, notice: null });
    } catch {
      if (this.closed || generation !== this.generation) return;
      this.publish({
        status: "unavailable",
        connection: null,
        error:
          "The desktop ChatGPT connection is unavailable. Retry in a moment.",
        notice: null,
      });
    } finally {
      if (generation === this.generation) this.initializing = false;
    }
  }
  /** Retry session verification after startup fails, using only the current Orbyn session. */
  async retrySession(): Promise<void> {
    await this.syncSession(this.token);
  }

  /** Runtime change events fetch only the latest metadata and cannot restore a switched account. */
  async reload(): Promise<void> {
    if (!this.bridge || this.closed || this.initializing) return;
    const generation = this.generation,
      read = ++this.reads;
    try {
      const connection = chatgptDesktopState.parse(
        await this.bridge.command({ action: "state" }),
      );
      if (this.closed || generation !== this.generation || read !== this.reads)
        return;
      this.publish({ ...this.state, status: "ready", connection, error: null });
    } catch {
      if (this.closed || generation !== this.generation || read !== this.reads)
        return;
      this.publish({
        ...this.state,
        status: "unavailable",
        connection: null,
        error:
          "The desktop ChatGPT connection is unavailable. Retry in a moment.",
      });
    }
  }
  async command(value: ChatgptDesktopCommand): Promise<void> {
    const bridge = this.requireBridge();
    const command = chatgptDesktopCommand.parse(value);
    if (this.initializing)
      throw new Error("Wait for the Orbyn account to finish loading.");
    const generation = this.generation,
      request = ++this.commands;
    ++this.reads;
    this.publish({ ...this.state, error: null, notice: null });
    try {
      const raw = await bridge.command(command);
      const disconnect =
        command.action === "disconnect"
          ? chatgptDesktopDisconnect.parse(raw)
          : null;
      const connection = disconnect?.state ?? chatgptDesktopState.parse(raw);
      if (
        this.closed ||
        generation !== this.generation ||
        request !== this.commands
      )
        return;
      ++this.reads;
      this.publish({
        status: "ready",
        connection,
        error: null,
        notice:
          disconnect && !disconnect.remote_revocation_confirmed
            ? "Disconnected on this device. Remote revocation was not confirmed; you can remove Orbyn in ChatGPT Settings."
            : null,
      });
    } catch {
      if (
        this.closed ||
        generation !== this.generation ||
        request !== this.commands
      )
        return;
      // Recover final busy metadata after the manager's last change notification.
      await this.reload();
      if (
        this.closed ||
        generation !== this.generation ||
        request !== this.commands
      )
        return;
      this.publish({
        ...this.state,
        error:
          "ChatGPT could not complete this action. Retry or reconnect this account.",
      });
      throw new Error(
        "ChatGPT could not complete this action. Retry or reconnect this account.",
      );
    }
  }
  close() {
    this.closed = true;
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }
}

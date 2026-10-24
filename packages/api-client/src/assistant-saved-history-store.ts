import type { AssistantSavedHistory } from "@orbyn/core";
import type { OrbynClient } from "./client.js";
type State = {
  turns: AssistantSavedHistory["turns"];
  before: number | null;
  busy: boolean;
  error: boolean;
};

/** Explicit legacy reads never enter the conversation store, context or read cursor. */
export class AssistantSavedHistoryStore {
  private state: State = { turns: [], before: null, busy: false, error: false };
  private generation = 0;
  private version: string | undefined;
  private binding: unknown;
  private listeners = new Set<() => void>();
  constructor(
    private client: Pick<OrbynClient, "assistantSavedHistory">,
    private destinationId: string,
    private chatId: string,
    private account: () => unknown,
  ) {
    this.binding = account();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: State) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  reset = () => {
    this.generation++;
    this.binding = this.account();
    this.version = undefined;
    this.publish({ turns: [], before: null, busy: false, error: false });
  };
  private async load(earlier: boolean) {
    if (this.binding !== this.account()) this.reset();
    if (this.state.busy || (earlier && this.state.before === null)) return;
    const generation = earlier ? this.generation : ++this.generation,
      binding = this.binding;
    if (!earlier) this.version = undefined;
    const previous = earlier ? this.state.turns : [];
    this.publish({ ...this.state, turns: previous, busy: true, error: false });
    const current = () => {
      if (generation !== this.generation) return false;
      if (binding !== this.account()) {
        this.reset();
        return false;
      }
      return true;
    };
    try {
      const page = await this.client.assistantSavedHistory(
        this.destinationId,
        this.chatId,
        earlier ? this.state.before! : undefined,
        earlier ? this.version : undefined,
      );
      if (!current()) return;
      this.version = page.version;
      this.publish({
        turns: [...page.turns, ...previous],
        before: page.before,
        busy: false,
        error: false,
      });
    } catch {
      if (current()) {
        this.version = undefined;
        this.publish({ turns: [], before: null, busy: false, error: true });
      }
    }
  }
  refresh = () => this.load(false);
  loadEarlier = () => this.load(true);
  validate = async () => {
    if (this.binding !== this.account()) {
      this.reset();
      return;
    }
    if (!this.version || this.state.busy) return;
    const generation = this.generation,
      version = this.version,
      binding = this.binding;
    try {
      await this.client.assistantSavedHistory(
        this.destinationId,
        this.chatId,
        undefined,
        version,
        1,
      );
      if (generation === this.generation && binding !== this.account())
        this.reset();
    } catch {
      if (generation !== this.generation || version !== this.version) return;
      if (binding !== this.account()) {
        this.reset();
        return;
      }
      this.generation++;
      this.version = undefined;
      this.publish({ turns: [], before: null, busy: false, error: true });
    }
  };
}

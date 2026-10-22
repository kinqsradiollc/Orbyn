import type { AssistantWorkControls } from "@orbyn/core";
import type { OrbynClient } from "./client.js";
type Controls = AssistantWorkControls & { muted: boolean };
type Snapshot = { data: Controls | null; busy: boolean; error: boolean };

/** Shared UI state; ambiguous saves require a fresh read before another toggle. */
export class AssistantControlsStore {
  private state: Snapshot = { data: null, busy: false, error: false };
  private listeners = new Set<() => void>();
  private generation = 0;
  private binding: unknown;
  constructor(
    private client: Pick<
      OrbynClient,
      | "assistantWorkControls"
      | "updateAssistantWorkControls"
      | "assistantConversationDeliveryPreferences"
      | "setAssistantConversationMuted"
    >,
    private account: () => unknown,
    private deliveryEnabled = true,
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
  private publish(state: Snapshot) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  reset = () => {
    this.generation++;
    this.binding = this.account();
    this.publish({ data: null, busy: false, error: false });
  };
  private current(generation: number, binding: unknown) {
    if (generation !== this.generation) return false;
    if (binding !== this.account()) {
      this.reset();
      return false;
    }
    return true;
  }
  private async read() {
    const [work, delivery] = await Promise.all([
      this.client.assistantWorkControls(),
      this.deliveryEnabled
        ? this.client.assistantConversationDeliveryPreferences()
        : Promise.resolve({ muted: false }),
    ]);
    return { ...work, muted: delivery.muted };
  }
  refresh = async () => {
    if (this.binding !== this.account()) this.reset();
    if (this.state.busy) return;
    const generation = this.generation,
      binding = this.binding;
    this.publish({ ...this.state, busy: true, error: false });
    try {
      const data = await this.read();
      if (this.current(generation, binding))
        this.publish({ data, busy: false, error: false });
    } catch {
      if (this.current(generation, binding))
        this.publish({ data: null, busy: false, error: true });
    }
  };
  set = async (key: keyof Controls, value: boolean) => {
    if (key === "muted" && !this.deliveryEnabled) return;
    if (this.binding !== this.account()) {
      this.reset();
      return;
    }
    if (this.state.busy || !this.state.data) return;
    const generation = this.generation,
      binding = this.binding;
    this.publish({ ...this.state, busy: true, error: false });
    try {
      if (key === "muted")
        await this.client.setAssistantConversationMuted(value);
      else await this.client.updateAssistantWorkControls({ [key]: value });
      if (!this.current(generation, binding)) return;
      const data = await this.read();
      if (this.current(generation, binding))
        this.publish({ data, busy: false, error: false });
    } catch {
      if (this.current(generation, binding))
        this.publish({ data: null, busy: false, error: true });
    }
  };
}

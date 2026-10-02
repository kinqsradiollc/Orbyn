import type { AssistantProfiles } from "@orbyn/core";
import type { OrbynClient } from "./client.js";
export type AssistantProfileSnapshot = {
  data: AssistantProfiles | null;
  loading: boolean;
  error: boolean;
};
/** Coalesced reads and cancellation shared by native/web; stale generations never restore work. */
export class AssistantProfileStore {
  private state: AssistantProfileSnapshot = {
    data: null,
    loading: false,
    error: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending: Promise<void> | null = null;
  private abort: AbortController | null = null;
  constructor(
    private client: Pick<OrbynClient, "assistantProfiles">,
    private sessionBinding: () => unknown = () => null,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: AssistantProfileSnapshot) {
    this.state = value;
    this.listeners.forEach((listener) => listener());
  }
  refresh = (): Promise<void> => {
    if (this.pending) return this.pending;
    const generation = this.generation;
    const binding = this.sessionBinding();
    const abort = (this.abort = new AbortController());
    this.publish({ ...this.state, loading: true });
    this.pending = this.client
      .assistantProfiles(abort.signal)
      .then(
        (data) => {
          if (generation !== this.generation) return;
          if (binding !== this.sessionBinding()) {
            this.reset();
            return;
          }
          if (generation === this.generation)
            this.publish({ data, loading: false, error: false });
        },
        () => {
          if (generation !== this.generation) return;
          if (binding !== this.sessionBinding()) {
            this.reset();
            return;
          }
          if (generation === this.generation)
            this.publish({ data: null, loading: false, error: true });
        },
      )
      .finally(() => {
        if (generation === this.generation) {
          this.pending = null;
          this.abort = null;
        }
      });
    return this.pending;
  };
  /** Closing, sign-out or account change clears evidence and cancels outstanding reads. */
  reset = () => {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.pending = null;
    this.publish({ data: null, loading: false, error: false });
  };
}

import type { ViewDefinition, ViewSource } from "@orbyn/core";

export type ViewCreationDraft = {
  source: ViewSource;
  name: string;
  preset: number | null;
  team_id: string | null;
};

/** Private workspace memory: survives screen navigation, never an account change. */
export class ViewDraftStore {
  creation: ViewCreationDraft | null = null;
  keepCreation(draft: ViewCreationDraft | null) {
    if (this.stopped || !this.current()) return;
    this.creation = draft;
    this.publish();
  }
  readonly drafts = new Map<string, ViewDefinition>();
  readonly saved = new Map<
    string,
    { definition: ViewDefinition; version: number }
  >();
  readonly states: Record<string, "saving" | "failed" | "saved"> = {};
  private jobs = new Map<
    string,
    {
      running: boolean;
      next: ViewDefinition | null;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<() => void>();
  private revision = 0;
  private stopped = false;
  private generation = 0;
  start() {
    this.stopped = false;
  }
  constructor(
    private write: (
      id: string,
      definition: ViewDefinition,
    ) => Promise<ViewDefinition>,
    private current: () => boolean,
    private report: (error: unknown) => void,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.revision;
  private publish() {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }
  change(
    id: string,
    definition: ViewDefinition,
    editable: boolean,
    immediate = false,
  ) {
    if (this.stopped || !this.current()) return;
    this.drafts.set(id, definition);
    if (!editable) {
      this.publish();
      return;
    }
    const job = this.jobs.get(id) ?? { running: false, next: null };
    this.jobs.set(id, job);
    job.next = definition;
    clearTimeout(job.timer);
    this.states[id] = "saving";
    this.publish();
    if (job.running) return;
    if (immediate) void this.flush(id, job);
    else job.timer = setTimeout(() => void this.flush(id, job), 700);
  }
  private async flush(
    id: string,
    job: { running: boolean; next: ViewDefinition | null },
  ) {
    if (job.running || this.stopped || !this.current()) return;
    job.running = true;
    const generation = this.generation;
    try {
      while (
        job.next &&
        !this.stopped &&
        this.current() &&
        generation === this.generation &&
        this.jobs.get(id) === job
      ) {
        const next = job.next;
        job.next = null;
        const definition = await this.write(id, next);
        if (
          this.stopped ||
          !this.current() ||
          generation !== this.generation ||
          this.jobs.get(id) !== job
        )
          return;
        this.saved.set(id, { definition, version: this.revision + 1 });
        if (this.drafts.get(id) === next) this.drafts.delete(id);
        this.states[id] = job.next ? "saving" : "saved";
        this.publish();
      }
    } catch (error) {
      job.next = null;
      if (
        !this.stopped &&
        this.current() &&
        generation === this.generation &&
        this.jobs.get(id) === job
      ) {
        this.states[id] = "failed";
        this.publish();
        this.report(error);
      }
    } finally {
      job.running = false;
    }
  }
  forget(id: string) {
    const job = this.jobs.get(id);
    if (job) {
      clearTimeout(job.timer);
      job.next = null;
    }
    this.jobs.delete(id);
    this.drafts.delete(id);
    this.saved.delete(id);
    delete this.states[id];
    this.publish();
  }
  stop() {
    this.stopped = true;
    this.generation += 1;
    this.jobs.forEach((job) => {
      clearTimeout(job.timer);
      job.next = null;
    });
    this.jobs.clear();
    this.drafts.clear();
    this.creation = null;
    this.saved.clear();
    this.listeners.clear();
  }
}

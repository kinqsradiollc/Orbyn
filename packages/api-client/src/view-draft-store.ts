import type { SavedView, ViewDefinition, ViewSource } from "@orbyn/core";

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
    { definition: ViewDefinition; version: number; serverVersion?: number }
  >();
  readonly states: Record<string, "saving" | "failed" | "saved" | "uncertain"> =
    {};
  private serverVersions = new Map<string, number>();
  private retryRequired = new Set<string>();
  private attempts = new Map<
    string,
    { definition: ViewDefinition; base: number | undefined; unknown: boolean }
  >();
  private checking = new Map<string, object>();
  canRetry(id: string) {
    return !this.attempts.has(id) && !this.jobs.get(id)?.running;
  }
  definitionFor(view: SavedView) {
    const draft = this.drafts.get(view.id),
      saved = this.saved.get(view.id);
    if (draft) return draft;
    if (
      saved &&
      (view.version === undefined ||
        (saved.serverVersion !== undefined &&
          saved.serverVersion >= view.version))
    )
      return saved.definition;
    return view.definition;
  }
  observe(view: SavedView) {
    if (
      this.stopped ||
      !this.current() ||
      this.drafts.has(view.id) ||
      this.attempts.has(view.id)
    )
      return;
    if (
      view.version !== undefined &&
      view.version >= (this.serverVersions.get(view.id) ?? 0)
    )
      this.serverVersions.set(view.id, view.version);
  }
  /** Read-only reconciliation. An equal base cannot prove a pending CAS finished. */
  async check(id: string) {
    if (!this.read || this.stopped || !this.current() || this.checking.has(id))
      return;
    const generation = this.generation,
      attempt = this.attempts.get(id);
    const readLease = {};
    this.checking.set(id, readLease);
    try {
      const view = await this.read(id);
      if (
        this.stopped ||
        !this.current() ||
        generation !== this.generation ||
        this.attempts.get(id) !== attempt
      )
        return;
      if (
        view.id !== id ||
        view.version === undefined ||
        !Number.isSafeInteger(view.version) ||
        view.version < 0 ||
        (attempt?.base !== undefined && view.version < attempt.base)
      )
        throw new Error("This server did not return a view revision.");
      if (
        attempt?.unknown &&
        (attempt.base === undefined || view.version <= attempt.base)
      )
        throw new Error(
          "The saved view still has the original revision. The pending save has not been resolved; check again.",
        );
      this.serverVersions.set(id, view.version);
      const matches =
        attempt &&
        JSON.stringify(view.definition) === JSON.stringify(attempt.definition);
      if (matches && this.drafts.get(id) === attempt.definition)
        this.drafts.delete(id);
      this.saved.set(id, {
        definition: view.definition,
        version: this.revision + 1,
        serverVersion: view.version,
      });
      this.attempts.delete(id);
      if (!matches && this.drafts.has(id)) this.retryRequired.add(id);
      this.states[id] = this.drafts.has(id) ? "failed" : "saved";
      this.publish();
    } catch (error) {
      if (!this.stopped && this.current() && generation === this.generation)
        this.report(error);
    } finally {
      if (this.checking.get(id) === readLease) this.checking.delete(id);
    }
  }
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
      expectedVersion?: number,
    ) => Promise<
      ViewDefinition | { definition: ViewDefinition; version: number }
    >,
    private current: () => boolean,
    private report: (error: unknown) => void,
    private read?: (id: string) => Promise<SavedView>,
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
    if (
      !editable ||
      (this.retryRequired.has(id) && !immediate) ||
      (this.attempts.has(id) && !this.jobs.get(id)?.running)
    ) {
      this.publish();
      return;
    }
    if (immediate) this.retryRequired.delete(id);
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
        const attempt = {
          definition: next,
          base: this.serverVersions.get(id),
          unknown: false,
        };
        this.attempts.set(id, attempt);
        const receipt = await this.write(id, next, attempt.base);
        const definition =
          "definition" in receipt ? receipt.definition : receipt;
        if ("definition" in receipt) {
          if (
            !Number.isSafeInteger(receipt.version) ||
            (attempt.base !== undefined && receipt.version <= attempt.base) ||
            JSON.stringify(definition) !== JSON.stringify(next)
          )
            throw new Error(
              "The save receipt did not match the submitted view. Check the saved view before trying again.",
            );
        }
        if (
          this.stopped ||
          !this.current() ||
          generation !== this.generation ||
          this.jobs.get(id) !== job
        )
          return;
        if ("definition" in receipt)
          this.serverVersions.set(id, receipt.version);
        this.attempts.delete(id);
        this.saved.set(id, {
          definition,
          version: this.revision + 1,
          ...("definition" in receipt
            ? { serverVersion: receipt.version }
            : {}),
        });
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
        const status = (error as { status?: number })?.status;
        const definitive = [400, 401, 403, 404, 409, 422].includes(status ?? 0);
        const attempt = this.attempts.get(id);
        if (attempt) attempt.unknown = !definitive;
        if (!this.read) this.attempts.delete(id); // Legacy adapter has no CAS/readback contract.
        // Even a definitive CAS conflict needs a fresh revision before retry.
        this.states[id] = definitive || !this.read ? "failed" : "uncertain";
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
    this.serverVersions.delete(id);
    this.retryRequired.delete(id);
    this.attempts.delete(id);
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
    this.serverVersions.clear();
    this.retryRequired.clear();
    this.attempts.clear();
    this.checking.clear();
    this.listeners.clear();
  }
}

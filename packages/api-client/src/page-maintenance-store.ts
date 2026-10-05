import {
  newBlockId,
  type Doc,
  type MaintainedPageBinding,
  type MaintainedPageBindingInput,
  type MaintainedPageRunSummary,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
type Api = Pick<
  OrbynClient,
  | "getDoc"
  | "updateDoc"
  | "listPageMaintenance"
  | "listPageMaintenanceRuns"
  | "createPageMaintenance"
  | "updatePageMaintenance"
  | "deletePageMaintenance"
  | "decidePageMaintenanceRun"
>;
export type PageMaintenanceState = {
  doc: Doc | null;
  bindings: MaintainedPageBinding[];
  runs: MaintainedPageRunSummary[];
  busy: boolean;
  error: string;
};
/** Shared web/native state; exact revisions and cards always travel to the server. */
export class PageMaintenanceStore {
  private state: PageMaintenanceState = {
    doc: null,
    bindings: [],
    runs: [],
    busy: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private binding: unknown;
  constructor(
    private api: Api,
    private id: string,
    private session: () => unknown,
    private changed: (doc: Doc) => void,
  ) {
    this.binding = this.session();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Partial<PageMaintenanceState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  dispose = () => {
    this.generation++;
    this.state = { doc: null, bindings: [], runs: [], busy: false, error: "" };
    this.listeners.clear();
  };
  private async take() {
    const [doc, bindings, runs] = await Promise.all([
      this.api.getDoc(this.id, { fresh: true }),
      this.api.listPageMaintenance(this.id),
      this.api.listPageMaintenanceRuns(this.id),
    ]);
    return { doc, bindings, runs };
  }
  private async run(
    action: (current: () => void) => Promise<void>,
    notify = false,
  ) {
    if (this.session() !== this.binding) {
      this.publish({
        doc: null,
        bindings: [],
        runs: [],
        busy: false,
        error: "Reopen page updates after switching accounts.",
      });
      return;
    }
    if (this.state.busy) return;
    const generation = this.generation;
    const session = this.session();
    this.publish({ busy: true, error: "" });
    try {
      const current = () => {
        if (generation !== this.generation || session !== this.session())
          throw new Error("This page session changed.");
      };
      current();
      await action(current);
      current();
      const data = await this.take();
      if (generation !== this.generation || session !== this.session()) return;
      this.publish(data);
      if (notify) this.changed(data.doc);
    } catch (error) {
      if (generation === this.generation && session === this.session())
        this.publish({
          error:
            error instanceof Error
              ? error.message
              : "Could not load page updates.",
        });
    } finally {
      if (generation === this.generation) {
        if (session !== this.session())
          this.publish({
            doc: null,
            bindings: [],
            runs: [],
            busy: false,
            error: "Reopen page updates after switching accounts.",
          });
        else this.publish({ busy: false });
      }
    }
  }
  refresh = () => this.run(async () => {}, true);
  /** Called after the editor flush; assign missing stable IDs with normal versioned persistence. */
  prepare = () =>
    this.run(async (current) => {
      const doc = await this.api.getDoc(this.id, { fresh: true });
      current();
      if (doc.content.some((block) => !block.id))
        await this.api.updateDoc(this.id, {
          title: doc.title,
          version: doc.version,
          content: doc.content.map((block) =>
            block.id ? block : { ...block, id: newBlockId() },
          ),
        });
    }, true);
  save = (input: MaintainedPageBindingInput, binding?: MaintainedPageBinding) =>
    this.run(async () => {
      if (binding)
        await this.api.updatePageMaintenance(this.id, binding.id, {
          ...input,
          expected_revision: binding.revision,
        });
      else await this.api.createPageMaintenance(this.id, input);
    }, true);
  pause = (binding: MaintainedPageBinding) =>
    this.save(
      {
        instruction: binding.instruction,
        rrule: binding.rrule,
        timezone: binding.timezone,
        next_run_at: binding.next_run_at,
        block_ids: binding.snapshot.blocks.map((block) => block.block_id),
        expected_doc_version: binding.snapshot.doc_version,
        paused: !binding.paused,
        token_budget: binding.token_budget,
      },
      binding,
    );
  remove = (binding: MaintainedPageBinding) =>
    this.run(async () => {
      await this.api.deletePageMaintenance(
        this.id,
        binding.id,
        binding.revision,
      );
    }, true);
  decide = (run: MaintainedPageRunSummary, approved: boolean) =>
    this.run(async () => {
      if (!run.can_review || !run.waiting_id)
        throw new Error("Reload this decision card.");
      await this.api.decidePageMaintenanceRun(
        this.id,
        run.id,
        run.waiting_id,
        approved,
      );
    }, true);
}

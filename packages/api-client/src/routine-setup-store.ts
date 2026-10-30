import {
  HttpError,
  agentRoutineInput,
  routineSetupInput,
  routineRunLimits,
  type RoutineRunLimits,
  type AgentRoutine,
  type AgentRoutineInput,
  type AssistantChangeKind,
  type RoutineSetupContext,
  type RoutineSetupInput,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
export type RoutineSetupState = {
  context: RoutineSetupContext | null;
  selected: AssistantChangeKind[];
  runLimits: RoutineRunLimits;
  loading: boolean;
  saving: boolean;
  uncertain: boolean;
  error: string;
  result: AgentRoutine | null;
};
/** One immutable reviewed draft and one replayable command across both clients.
 * A lost save response freezes the exact request; it never starts a replacement. */
export class RoutineSetupStore {
  readonly routine: ReturnType<typeof agentRoutineInput.parse>;
  private state: RoutineSetupState = {
    context: null,
    selected: [],
    runLimits: routineRunLimits.parse({}),
    loading: false,
    saving: false,
    uncertain: false,
    error: "",
    result: null,
  };
  private listeners = new Set<() => void>();
  private read: Promise<void> | null = null;
  private write: Promise<AgentRoutine | null> | null = null;
  private command: RoutineSetupInput | null = null;
  private generation = 0;
  private readonly owner: unknown;
  constructor(
    private client: Pick<
      OrbynClient,
      "routineSetupContext" | "setupAgentRoutine"
    >,
    routine: AgentRoutineInput,
    private uuid: () => string,
    private binding: () => unknown = () => null,
  ) {
    this.routine = agentRoutineInput.parse(routine);
    this.owner = binding();
  }
  private owns = (generation = this.generation) =>
    generation === this.generation && this.owner === this.binding();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<RoutineSetupState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  load = (): Promise<void> => {
    if (!this.owns() || this.write || this.state.uncertain || this.state.result)
      return Promise.resolve();
    if (this.read) return this.read;
    const generation = this.generation;
    this.publish({ loading: true, context: null, error: "", selected: [] });
    this.read = this.client
      .routineSetupContext()
      .then(
        (context) => {
          if (this.owns(generation)) this.publish({ context, loading: false });
        },
        () => {
          if (this.owns(generation))
            this.publish({
              loading: false,
              context: null,
              error: "Couldn’t load current permissions. Retry before saving.",
            });
        },
      )
      .finally(() => {
        if (this.owns(generation)) this.read = null;
      });
    return this.read;
  };
  select = (kind: AssistantChangeKind, enabled: boolean) => {
    if (
      !this.owns() ||
      !this.state.context?.can_preauthorize ||
      this.read ||
      this.write ||
      this.state.uncertain ||
      this.state.result
    )
      return;
    this.publish({
      selected: enabled
        ? [...new Set([...this.state.selected, kind])]
        : this.state.selected.filter((k) => k !== kind),
    });
  };
  setRunLimits = (limits: RoutineRunLimits) => {
    if (
      !this.owns() ||
      this.read ||
      this.write ||
      this.state.uncertain ||
      this.state.result
    )
      return;
    this.command = null;
    this.publish({ runLimits: { ...limits }, error: "" });
  };
  save = (): Promise<AgentRoutine | null> => {
    if (!this.owns()) return Promise.resolve(null);
    if (this.write) return this.write;
    if (this.state.result) return Promise.resolve(this.state.result);
    if (!this.state.context || this.read) return Promise.resolve(null);
    const checked = routineRunLimits.safeParse(this.state.runLimits);
    if (
      !checked.success ||
      this.state.runLimits.token_limit > this.state.context.max_run_tokens ||
      this.state.runLimits.active_work_minutes >
        this.state.context.max_active_work_minutes
    ) {
      this.publish({
        error:
          "Choose a positive token allowance within the current ceiling and 1–10 minutes of active AI work.",
      });
      return Promise.resolve(null);
    }
    this.command ??= routineSetupInput.parse({
      request_id: this.uuid(),
      routine: this.routine,
      run_limits: checked.data,
      allow_changes: this.state.selected,
      expected_snapshot: this.state.context.snapshot,
    });
    const command = this.command,
      generation = this.generation;
    this.publish({ saving: true, error: "" });
    this.write = this.client
      .setupAgentRoutine(command)
      .then(
        (result) => {
          if (!this.owns(generation)) return null;
          this.publish({ saving: false, uncertain: false, result });
          return result;
        },
        (error) => {
          if (!this.owns(generation)) return null;
          const status = error instanceof HttpError ? error.statusCode : 0;
          if (
            !this.state.uncertain &&
            status >= 400 &&
            status < 500 &&
            status !== 408 &&
            status !== 429
          ) {
            this.command = null;
            this.publish({
              saving: false,
              uncertain: false,
              context: null,
              error:
                status === 409
                  ? "Permissions changed. Reload them and review your choices before saving."
                  : status === 410
                    ? "This saved routine was deleted. Return to Upcoming to check your work."
                    : "The routine wasn’t saved by this request. Check your schedule and current access before trying again.",
            });
          } else {
            this.publish({
              saving: false,
              uncertain: true,
              error:
                "Save status is unknown. Retry this same save to check it without creating a second routine.",
            });
          }
          return null;
        },
      )
      .finally(() => {
        if (this.owns(generation)) this.write = null;
      });
    return this.write;
  };
  /** Closing discards only client state; it cannot undo a transmitted command. */
  dispose = () => {
    this.generation++;
    this.listeners.clear();
    this.read = null;
    this.write = null;
    this.command = null;
    this.state = {
      context: null,
      selected: [],
      runLimits: routineRunLimits.parse({}),
      loading: false,
      saving: false,
      uncertain: false,
      error: "",
      result: null,
    };
  };
}

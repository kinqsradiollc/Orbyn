import {
  routineSetupContext,
  routineSetupInput,
  type AgentRoutine,
  type RoutineSetupInput,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

export async function callRoutineSetupContext(this: OrbynClient) {
  return routineSetupContext.parse(
    await this.request<unknown>("/me/agent-routines/setup-context", {
      fresh: true,
    }),
  );
}
export function callSetupAgentRoutine(
  this: OrbynClient,
  input: RoutineSetupInput,
) {
  return this.request<AgentRoutine>("/me/agent-routines/setup", {
    method: "POST",
    body: routineSetupInput.parse(input),
    fresh: true,
  });
}

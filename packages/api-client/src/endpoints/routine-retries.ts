import { z } from "zod";
import {
  routineRetryPolicyPage,
  routineRetryPolicyUpdate,
  routineRecovery,
  routineRecoveryStop,
  type RoutineRetryPolicyUpdateInput,
  type RoutineRecoveryStopInput,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";
const id = (value: string) => encodeURIComponent(z.uuid().parse(value));
const routinePath = (routine: string) => `/me/agent-routines/${id(routine)}`;
const runPath = (routine: string, run: string) =>
  `${routinePath(routine)}/runs/${id(run)}`;
export async function callRoutineRetryPolicy(
  this: OrbynClient,
  routine: string,
) {
  const value = routineRetryPolicyPage.parse(
    await this.request<unknown>(`${routinePath(routine)}/retry-policy`, {
      fresh: true,
    }),
  );
  if (value.routine_id !== routine)
    throw new Error("Retry policy belongs to another routine.");
  return value;
}
export async function callUpdateRoutineRetryPolicy(
  this: OrbynClient,
  routine: string,
  input: RoutineRetryPolicyUpdateInput,
) {
  const value = routineRetryPolicyPage.parse(
    await this.request<unknown>(`${routinePath(routine)}/retry-policy`, {
      method: "PUT",
      body: routineRetryPolicyUpdate.parse(input),
      fresh: true,
    }),
  );
  if (value.routine_id !== routine)
    throw new Error("Retry policy belongs to another routine.");
  return value;
}
export async function callRoutineRecovery(
  this: OrbynClient,
  routine: string,
  run: string,
) {
  const value = routineRecovery.parse(
    await this.request<unknown>(`${runPath(routine, run)}/recovery`, {
      fresh: true,
    }),
  );
  if (value.routine_id !== routine || value.occurrence_id !== run)
    throw new Error("Recovery belongs to another occurrence.");
  return value;
}
export async function callStopRoutineRecovery(
  this: OrbynClient,
  routine: string,
  run: string,
  input: RoutineRecoveryStopInput,
) {
  const value = routineRecovery.parse(
    await this.request<unknown>(`${runPath(routine, run)}/stop`, {
      method: "POST",
      body: routineRecoveryStop.parse(input),
      fresh: true,
    }),
  );
  if (value.routine_id !== routine || value.occurrence_id !== run)
    throw new Error("Recovery belongs to another occurrence.");
  return value;
}

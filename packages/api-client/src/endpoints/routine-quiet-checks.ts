import { z } from "zod";
import {
  routineQuietPolicyPage,
  updateRoutineQuietPolicyInput,
  routineQuietChecksPage,
  type UpdateRoutineQuietPolicyInput,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";
const id = (value: string) => encodeURIComponent(z.uuid().parse(value));
const path = (routine: string) => `/me/agent-routines/${id(routine)}`;
export async function callRoutineQuietPolicy(
  this: OrbynClient,
  routine: string,
) {
  const page = routineQuietPolicyPage.parse(
    await this.request<unknown>(`${path(routine)}/quiet-check-policy`, {
      fresh: true,
    }),
  );
  if (page.routine_id !== routine)
    throw new Error("Quiet-check settings belong to another routine.");
  return page;
}
export async function callUpdateRoutineQuietPolicy(
  this: OrbynClient,
  routine: string,
  input: UpdateRoutineQuietPolicyInput,
) {
  const page = routineQuietPolicyPage.parse(
    await this.request<unknown>(`${path(routine)}/quiet-check-policy`, {
      method: "PUT",
      body: updateRoutineQuietPolicyInput.parse(input),
      fresh: true,
    }),
  );
  if (page.routine_id !== routine)
    throw new Error("Quiet-check settings belong to another routine.");
  return page;
}
export async function callRoutineQuietChecks(
  this: OrbynClient,
  routine: string,
  occurrence: string,
) {
  const page = routineQuietChecksPage.parse(
    await this.request<unknown>(
      `${path(routine)}/runs/${id(occurrence)}/quiet-checks`,
      { fresh: true },
    ),
  );
  if (page.routine_id !== routine || page.occurrence_id !== occurrence)
    throw new Error("Quiet-check evidence belongs to another occurrence.");
  return page;
}

import { z } from "zod";
import {
  goalExecutionAccept,
  goalExecutionAttemptPage,
  goalExecutionControl,
  goalExecutionDetails,
  goalExecutionHistoryQuery,
  goalExecutionPage,
  goalExecutionResume,
  goalExecutionStart,
  type GoalExecutionAcceptInput,
  type GoalExecutionControlInput,
  type GoalExecutionHistoryQuery,
  type GoalExecutionResumeInput,
  type GoalExecutionStartInput,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";
const id = (value: string) => encodeURIComponent(z.uuid().parse(value));
const executionPath = (value: string) => `/me/goal-executions/${id(value)}`;
const queryString = (raw: GoalExecutionHistoryQuery) => {
  const checked = goalExecutionHistoryQuery.parse(raw);
  return new URLSearchParams({
    limit: String(checked.limit),
    ...(checked.cursor ? { cursor: checked.cursor } : {}),
  }).toString();
};
export async function callStartGoalExecution(
  this: OrbynClient,
  goalId: string,
  input: GoalExecutionStartInput,
) {
  const result = goalExecutionDetails.parse(
    await this.request<unknown>(`/me/goals/${id(goalId)}/executions`, {
      method: "POST",
      body: goalExecutionStart.parse(input),
      fresh: true,
    }),
  );
  if (result.goal_id !== goalId)
    throw new Error("Execution belongs to another goal.");
  return result;
}
export async function callGoalExecutions(
  this: OrbynClient,
  goalId: string,
  query: GoalExecutionHistoryQuery = {},
) {
  const result = goalExecutionPage.parse(
    await this.request<unknown>(
      `/me/goals/${id(goalId)}/executions?${queryString(query)}`,
      { fresh: true },
    ),
  );
  if (result.goal_id !== goalId)
    throw new Error("Execution history belongs to another goal.");
  return result;
}
export async function callGoalExecution(
  this: OrbynClient,
  executionId: string,
) {
  const result = goalExecutionDetails.parse(
    await this.request<unknown>(executionPath(executionId), { fresh: true }),
  );
  if (result.id !== executionId) throw new Error("Execution identity changed.");
  return result;
}
export async function callGoalExecutionAttempts(
  this: OrbynClient,
  executionId: string,
  query: GoalExecutionHistoryQuery = {},
) {
  const result = goalExecutionAttemptPage.parse(
    await this.request<unknown>(
      `${executionPath(executionId)}/attempts?${queryString(query)}`,
      { fresh: true },
    ),
  );
  if (result.execution_id !== executionId)
    throw new Error("Attempts belong to another execution.");
  return result;
}
async function command(
  client: OrbynClient,
  executionId: string,
  action: string,
  body: unknown,
) {
  const result = goalExecutionDetails.parse(
    await client.request<unknown>(`${executionPath(executionId)}/${action}`, {
      method: "POST",
      body,
      fresh: true,
    }),
  );
  if (result.id !== executionId) throw new Error("Execution identity changed.");
  return result;
}
export function callPauseGoalExecution(
  this: OrbynClient,
  executionId: string,
  input: GoalExecutionControlInput,
) {
  return command(this, executionId, "pause", goalExecutionControl.parse(input));
}
export function callResumeGoalExecution(
  this: OrbynClient,
  executionId: string,
  input: GoalExecutionResumeInput,
) {
  return command(this, executionId, "resume", goalExecutionResume.parse(input));
}
export function callStopGoalExecution(
  this: OrbynClient,
  executionId: string,
  input: GoalExecutionControlInput,
) {
  return command(this, executionId, "stop", goalExecutionControl.parse(input));
}
export function callAcceptGoalExecution(
  this: OrbynClient,
  executionId: string,
  input: GoalExecutionAcceptInput,
) {
  return command(this, executionId, "accept", goalExecutionAccept.parse(input));
}

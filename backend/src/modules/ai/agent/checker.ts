import { registry } from "../../../capabilities/index.js";
import { checkPlan, type PlanStep } from "../../../capabilities/plan-run.js";
import { policy, type Principal } from "../../../capabilities/policy.js";
import type { Queryable } from "../../../db/pool.js";
import { keptOutFor } from "../../../lib/assistant-off.js";
import { AGENT_BULK_LIMIT } from "@orbyn/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_VALUE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MAX_CHANGES = 50;

export type PlanCheck = {
  steps: PlanStep[];
  approvals: string[];
};

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((entry) => strings(entry, out));
  return out;
}

function explicitTeam(step: PlanStep): string | null | undefined {
  for (const value of [step.args.team, step.args.team_id, step.args.space]) {
    if (typeof value !== "string") continue;
    if (value.toLowerCase() === "personal") return null;
    if (UUID.test(value)) return value.toLowerCase();
  }
  return undefined;
}

function targetKey(kind: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.startsWith("$"))
    return null;
  return `${kind}:${value.match(UUID_VALUE)?.[0]?.toLowerCase() ?? value.trim().toLowerCase()}`;
}

function conflictKeys(step: PlanStep): string[] {
  if (step.tool === "edit_doc" || step.tool === "append_doc") {
    return [
      targetKey("doc", step.args.doc ?? step.args.doc_id ?? step.args.id),
    ].filter((key): key is string => key !== null);
  }
  if (step.tool === "update_tasks" || step.tool === "complete_tasks") {
    const field = step.tool === "update_tasks" ? "changes" : "tasks";
    const changes = step.args[field];
    if (!Array.isArray(changes)) return [];
    return changes.flatMap((change) =>
      change && typeof change === "object"
        ? [targetKey("item", (change as Record<string, unknown>).id)].filter(
            (key): key is string => key !== null,
          )
        : [],
    );
  }
  if (step.tool === "edit_checklist")
    return [targetKey("item", step.args.task)].filter(
      (key): key is string => key !== null,
    );
  if (step.tool === "update_project")
    return [targetKey("project", step.args.project ?? step.args.id)].filter(
      (key): key is string => key !== null,
    );
  return [];
}

/** Code-only validation of the combined specialist plan before it is applied. */
export async function checkMergedPlan(
  db: Queryable,
  principal: Principal,
  steps: PlanStep[],
): Promise<PlanCheck> {
  if (steps.length > MAX_CHANGES)
    throw new Error(`The combined plan has more than ${MAX_CHANGES} changes.`);
  checkPlan(principal, steps);

  const keptOut = await keptOutFor(db, principal.user.id);
  for (const step of steps) {
    const cap = registry.get(step.tool);
    if (!cap || cap.mode === "read")
      throw new Error(`${step.tool} is not a staged change tool.`);
    const hidden = strings(step.args).find((value) => {
      const id = value.match(UUID)?.[0]?.toLowerCase();
      return !!id && (keptOut.ids.has(id) || keptOut.projects.has(id));
    });
    if (hidden)
      throw new Error(
        "The combined plan refers to a project or item kept out of the assistant.",
      );
  }

  const targets = new Map<string, PlanStep>();
  for (const step of steps) {
    for (const key of conflictKeys(step)) {
      const previous = targets.get(key);
      if (previous)
        throw new Error(
          `The plan has conflicting ${previous.tool} and ${step.tool} changes to the same item.`,
        );
      targets.set(key, step);
    }
  }

  const approvals = new Set<string>();
  for (const step of steps) {
    const cap = registry.get(step.tool)!;
    const teamId = explicitTeam(step);
    const level = policy.levelIn(principal, teamId ?? null);
    if (level === null)
      throw new Error(
        `The assistant grant cannot reach the destination for ${step.tool}.`,
      );
    const trust = policy.trustIn(principal, teamId ?? null);
    const location = teamId ? "the selected team" : "Personal";
    if (trust === "ask")
      approvals.add(
        `The assistant is set to ask before changes in ${location}.`,
      );
    if (trust === "suggest")
      approvals.add(`The assistant is set to suggest changes in ${location}.`);
    if (cap.name === "manage_memory")
      approvals.add("Changes to private Memory need your approval.");
  }
  return { steps, approvals: [...approvals] };
}

/** Changes that require a morning Review regardless of the night trust level. */
export function nightPlanNeedsReview(steps: PlanStep[]): boolean {
  // Plain titled additions have a known count before execution. Quick-add lines
  // may resolve to habits or skips, so their final count remains a runtime check.
  const knownAdditions = steps.reduce((count, step) => {
    if (step.tool !== "create_tasks" || !Array.isArray(step.args.tasks))
      return count;
    return (
      count +
      step.args.tasks.filter(
        (task) =>
          task &&
          typeof task === "object" &&
          typeof task.title === "string" &&
          task.title.trim() &&
          !task.line,
      ).length
    );
  }, 0);
  if (knownAdditions > AGENT_BULK_LIMIT) return true;
  return steps.some((step) => {
    const cap = registry.get(step.tool);
    if (
      cap?.effects?.some((effect) =>
        ["email_outside", "notify_member", "publish"].includes(effect),
      )
    )
      return true;
    // EDITS marks all editing tools as destructive for MCP clients. These
    // mutations do not delete an object; dynamic contact effects are guarded
    // again by destination() when the arguments have been resolved.
    if (
      ["update_tasks", "complete_tasks", "edit_checklist"].includes(step.tool)
    )
      return false;
    if (step.tool === "reschedule_sessions") {
      const changes = step.args.changes;
      return (
        !Array.isArray(changes) ||
        changes.some(
          (change) =>
            !change ||
            typeof change !== "object" ||
            (change as { action?: string }).action === "remove",
        )
      );
    }
    return !!cap?.annotations.destructiveHint;
  });
}

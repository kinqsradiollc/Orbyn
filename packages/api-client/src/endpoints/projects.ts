import {
  type Goal,
  type GoalCheckin,
  type GoalInput,
  type GoalUpdate,
  type Item,
  type MilestoneInput,
  type MilestoneUpdate,
  type Plan,
  type Project,
  type ProjectActivity,
  type ProjectCheckpoint,
  type ProjectLink,
  type ProjectMilestone,
  type ProjectPlanning,
  type ProjectSession,
  type ProjectSnapshot,
  type ProjectStatus,
  type ProjectTemplate,
  type Proposal,
  type ReentryBrief,
  type TemplateInput,
  type TemplateUpdate,
  type WorkRecord,
  type WorkRecordInput,
  type WorkRecordUpdate,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// Projects

export function callListProjects(this: OrbynClient) {
  return this.request<Project[]>("/projects");
}

export function callGetProject(this: OrbynClient, id: string) {
  return this.request<Project>(`/projects/${id}`);
}

export function callListProjectLinks(this: OrbynClient, id: string) {
  return this.request<ProjectLink[]>(`/projects/${id}/links`);
}

export function callAddProjectLink(
  this: OrbynClient,
  id: string,
  input: { url: string; title?: string },
) {
  return this.request<ProjectLink>(`/projects/${id}/links`, {
    method: "POST",
    body: input,
  });
}

export function callRemoveProjectLink(
  this: OrbynClient,
  id: string,
  linkId: string,
) {
  return this.request<void>(`/projects/${id}/links/${linkId}`, {
    method: "DELETE",
  });
}

/** Mark a project visit and return the prior visit for cross-device catch-up. */

export function callVisitProject(this: OrbynClient, id: string) {
  return this.request<{ since_at: string | null; visited_at: string }>(
    `/projects/${id}/visit`,
    { method: "POST" },
  );
}

export function callProjectPlanning(this: OrbynClient, id: string) {
  return this.request<ProjectPlanning>(`/projects/${id}/planning`);
}

export function callProjectSessions(this: OrbynClient, id: string) {
  return this.request<ProjectSession[]>(`/projects/${id}/sessions`);
}

/** Preview a project plan using only tasks assigned to the signed-in person. */
/**
 * Preview a plan for your tasks in a project. `claimItemIds` are unassigned
 * team tasks you take on with it: they become yours and are planned too.
 */

export function callPlanProject(
  this: OrbynClient,
  id: string,
  timezone?: string,
  claimItemIds: string[] = [],
) {
  return this.request<Plan>(`/projects/${id}/plan`, {
    method: "POST",
    body: {
      timezone,
      ...(claimItemIds.length ? { claim_item_ids: claimItemIds } : {}),
    },
  });
}

/** Recent changes to a project, with private task and note content omitted. */

export function callProjectActivity(
  this: OrbynClient,
  id: string,
  limit = 100,
) {
  return this.request<ProjectActivity[]>(
    `/projects/${id}/activity?limit=${Math.max(1, Math.min(200, limit))}`,
  );
}

/** A project's milestones, soonest first, rolled up for you. */

export function callProjectMilestones(this: OrbynClient, id: string) {
  return this.request<ProjectMilestone[]>(`/projects/${id}/milestones`);
}

export function callCreateMilestone(
  this: OrbynClient,
  projectId: string,
  input: MilestoneInput,
) {
  return this.request<ProjectMilestone>(`/projects/${projectId}/milestones`, {
    method: "POST",
    body: input,
  });
}

export function callUpdateMilestone(
  this: OrbynClient,
  projectId: string,
  id: string,
  input: MilestoneUpdate,
) {
  return this.request<ProjectMilestone>(
    `/projects/${projectId}/milestones/${id}`,
    { method: "PUT", body: input },
  );
}

export function callDeleteMilestone(
  this: OrbynClient,
  projectId: string,
  id: string,
) {
  return this.request<void>(`/projects/${projectId}/milestones/${id}`, {
    method: "DELETE",
  });
}

/** Put a task in a milestone of its project, or take it out (null). */

export function callSetItemMilestone(
  this: OrbynClient,
  itemId: string,
  milestoneId: string | null,
) {
  return this.request<Item>(`/items/${itemId}/milestone`, {
    method: "PUT",
    body: { milestone_id: milestoneId },
  });
}

export function callListGoals(this: OrbynClient) {
  return this.request<Goal[]>("/me/goals");
}

export function callCreateGoal(this: OrbynClient, input: GoalInput) {
  return this.request<Goal>("/me/goals", { method: "POST", body: input });
}

export function callUpdateGoal(
  this: OrbynClient,
  id: string,
  input: GoalUpdate,
) {
  return this.request<Goal>(`/me/goals/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteGoal(this: OrbynClient, id: string) {
  return this.request<{ deleted: boolean }>(`/me/goals/${id}`, {
    method: "DELETE",
  });
}

/** Current unfinished owned tasks linked to this goal, with unbooked effort. */

export function callGoalWork(this: OrbynClient, id: string) {
  return this.request<{ id: string; remaining_minutes: number }[]>(
    `/me/goals/${id}/work`,
  );
}

export function callGoalCheckins(this: OrbynClient, id: string) {
  return this.request<GoalCheckin[]>(`/me/goals/${id}/checkins`);
}

/** Checkpoints for the read-only project time machine, newest first. */

export function callProjectCheckpoints(
  this: OrbynClient,
  id: string,
  before?: string,
) {
  const cursor = before ? `?before=${before}` : "";
  return this.request<ProjectCheckpoint[]>(
    `/projects/${id}/time-machine/checkpoints${cursor}`,
  );
}

export function callProjectSnapshot(
  this: OrbynClient,
  id: string,
  eventOrder: string,
) {
  return this.request<ProjectSnapshot>(
    `/projects/${id}/time-machine/${eventOrder}`,
  );
}

export function callCreateProject(
  this: OrbynClient,
  input: {
    name: string;
    summary?: string;
    team_id?: string | null;
    deadline?: string | null;
    stages?: string[];
  },
) {
  return this.request<Project>("/projects", { method: "POST", body: input });
}

export function callUpdateProject(
  this: OrbynClient,
  id: string,
  input: {
    name?: string;
    summary?: string;
    status?: ProjectStatus;
    deadline?: string | null;
    doc_id?: string | null;
    stages?: { id?: string; name: string }[];
    /** Other names, such as a course code (LNK-03). */
    aliases?: string[];
    /** A cover picture (W6); null takes it off. */
    cover_file_id?: string | null;
    /** An emoji or "icon:<name>" (W6); null takes it off. */
    icon?: string | null;
  },
) {
  return this.request<Project>(`/projects/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteProject(this: OrbynClient, id: string) {
  return this.request<void>(`/projects/${id}`, { method: "DELETE" });
}

/**
 * Move a task into a project and stage, or pass null to unfile it. The
 * answer carries the task as it now stands.
 */

export function callSetItemProject(
  this: OrbynClient,
  itemId: string,
  input: {
    version: number;
    project_id: string | null;
    stage_id?: string | null;
  },
) {
  return this.request<{ ok: true; item: Item }>(`/items/${itemId}/project`, {
    method: "PUT",
    body: input,
  });
}

/** Promises, decisions, experiments and meeting outcomes visible to this user. */

export function callListWorkRecords(
  this: OrbynClient,
  params: {
    kind?: WorkRecord["kind"];
    project_id?: string;
    owner_id?: string;
    source_item_id?: string;
    limit?: number;
  } = {},
) {
  const q = new URLSearchParams();
  if (params.source_item_id) q.set("source_item_id", params.source_item_id);
  if (params.kind) q.set("kind", params.kind);
  if (params.project_id) q.set("project_id", params.project_id);
  if (params.owner_id) q.set("owner_id", params.owner_id);
  if (params.limit) q.set("limit", String(params.limit));
  return this.request<WorkRecord[]>(`/work-records?${q}`);
}

export function callGetWorkRecord(this: OrbynClient, id: string) {
  return this.request<WorkRecord>(`/work-records/${id}`);
}

export function callCreateWorkRecord(
  this: OrbynClient,
  input: WorkRecordInput,
) {
  return this.request<WorkRecord>("/work-records", {
    method: "POST",
    body: input,
  });
}

export function callUpdateWorkRecord(
  this: OrbynClient,
  id: string,
  input: WorkRecordUpdate,
) {
  return this.request<WorkRecord>(`/work-records/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callRespondWorkRecord(
  this: OrbynClient,
  id: string,
  decision: "accept" | "decline",
) {
  return this.request<WorkRecord>(`/work-records/${id}/respond`, {
    method: "POST",
    body: { decision },
  });
}

// ---- project templates ---------------------------------------------------

/** Your templates, your teams', and the starters everyone has. */

export function callListTemplates(this: OrbynClient) {
  return this.request<ProjectTemplate[]>("/templates");
}

export function callCreateTemplate(this: OrbynClient, input: TemplateInput) {
  return this.request<ProjectTemplate>("/templates", {
    method: "POST",
    body: input,
  });
}

export function callUpdateTemplate(
  this: OrbynClient,
  id: string,
  input: TemplateUpdate,
) {
  return this.request<ProjectTemplate>(`/templates/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteTemplate(this: OrbynClient, id: string) {
  return this.request<void>(`/templates/${id}`, { method: "DELETE" });
}

/** Save a project as a template: its tasks, their order, and its brief. */

export function callTemplateFromProject(this: OrbynClient, projectId: string) {
  return this.request<ProjectTemplate>(`/templates/from-project/${projectId}`, {
    method: "POST",
  });
}

/**
 * Start a project from a template. Answers with a proposal to review —
 * approve it with `applyProposal` — never a project yet.
 */

export function callUseTemplate(
  this: OrbynClient,
  id: string,
  input: { title?: string; team_id?: string | null } = {},
) {
  return this.request<Proposal>(`/templates/${encodeURIComponent(id)}/use`, {
    method: "POST",
    body: input,
  });
}

/** After time away: what happened meanwhile, or null. */

export function callReentry(this: OrbynClient) {
  return this.request<ReentryBrief | null>("/me/reentry");
}

export function callDismissReentry(this: OrbynClient) {
  return this.request<{ ok: true }>("/me/reentry/dismiss", {
    method: "POST",
  });
}

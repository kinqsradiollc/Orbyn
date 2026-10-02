import {
  reflectionEvidence,
  reflectionSources,
  type ReflectionSource,
} from "./reflection.js";
import { randomUUID } from "node:crypto";
import { notifyAssistantAway } from "./notices.js";
import { recordNightRun } from "./night-status.js";
import {
  AssistantLeaseLost,
  assistantLeaseOwner,
  assertAssistantLease,
} from "./lease.js";
import {
  nightShiftInput,
  AGENT_TOOLSETS,
  fail,
  type ChatScope,
  type ChatTurn,
  type SystemRole,
} from "@orbyn/core";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { execute } from "../../../capabilities/execute.js";
import { registry } from "../../../capabilities/index.js";
import { checkPlan, type PlanStep } from "../../../capabilities/plan-run.js";
import type { CapabilityResult } from "../../../capabilities/registry.js";
import { policy, type Principal } from "../../../capabilities/policy.js";
import { pool, transaction } from "../../../db/pool.js";
import type { Queryable } from "../../../db/pool.js";
import { keptOutFor } from "../../../lib/assistant-off.js";
import { recordAssistantSources } from "../../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../../lib/assistant-visibility.js";
import {
  visibleItems,
  visibleProjects,
  visibleDocs,
} from "../../../lib/visibility.js";
import { announceTo } from "../../presence/live.js";
import { recallMemory } from "../../memory/service.js";
import type { UserRow } from "../../../lib/auth.js";
import type { Proposal } from "@orbyn/core";
import { resolveAi } from "../providers/resolve.js";
import { mayChange } from "../guards.js";
import { overview, type AgentContext } from "./tools.js";
import type { AgentTrace, AgentTraceEvent } from "./loop.js";
import {
  runLead,
  LEAD_TOKEN_BUDGET,
  type LeadState,
  type LeadWaiting,
} from "./lead.js";
import { checkMergedPlan, nightPlanNeedsReview } from "./checker.js";
import { appendChatTrace, beginChatTurn, finishChatTurn } from "../chats.js";
import {
  AssistantPausedError,
  assistantApprovalScopes,
  assistantPrincipal,
} from "../../agents/assistant.js";
import type { AssistantChangeKind } from "./change-kind.js";

/** Limits of one run: the longest it may take and how often it beats. */
export const assistantRunLimits = { maxRunMs: 600_000, heartbeatMs: 10_000 };
/** A running job whose heartbeat is older than this is reported as failed. */
export const ASSISTANT_STALE_MS = 60_000;
/** A question or approval card nobody answered expires after a week. */
const WAITING_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const STOPPED_TEXT = "Stopped. Nothing was changed.";
const pendingInput = z
  .object({ answer: z.string().trim().min(1).max(4000), waiting_id: z.uuid() })
  .strict();
const approvalInput = z
  .object({
    approved: z.boolean(),
    waiting_id: z.uuid(),
    scope: z.enum(["once", "goal", "routine", "always"]).default("once"),
  })
  .strict();

export type AssistantAutomation = {
  /** A task handed to the agent (W3) carries its item's id. */
  kind: "idea" | "goal" | "routine" | "task" | "night";
  night_id?: string;
  night_kind?: string;
  reflection_sources?: ReflectionSource[];
  source_kind?: "task" | "goal" | "routine";
  wait_for_ok?: boolean;
  token_budget?: number;
  end_at?: string;
  id?: string;
  local_day?: string;
  slot?: number;
  week_of?: string;
};

export type PersistedChatRequest = {
  message: string;
  history: ChatTurn[];
  timezone: string;
  chat_id: string;
  turn_id: string;
  scope: ChatScope | null;
  automation?: AssistantAutomation;
};

/** Night jobs retain the completion rules of the task, goal or routine they run. */
function automationKind(request: PersistedChatRequest) {
  return request.automation?.source_kind ?? request.automation?.kind;
}

function isAutomation(
  request: PersistedChatRequest,
  kind: AssistantAutomation["kind"],
): request is PersistedChatRequest & { automation: AssistantAutomation } {
  return !!request.automation && automationKind(request) === kind;
}

type RunEnvelope = {
  version: 1;
  checkpoint_step?: number;
  started_at?: number;
  elapsed_ms?: number;
  reviewed?: boolean;
  approved_rules_revision?: number;
  declined?: boolean;
  request: PersistedChatRequest;
  state: LeadState;
};

/** The initial checkpoint is committed with the queued job, before any AI call. */
export function initialAssistantRun(
  request: PersistedChatRequest,
): RunEnvelope {
  return {
    version: 1,
    checkpoint_step: 0,
    request,
    state: newState(request.message),
  };
}

/** Stop handles of the runs on this copy, by job. */
const activeRuns = new Map<string, () => void>();
const shutdownControls = new Map<
  string,
  { request: () => void; force: () => void }
>();
class AssistantSuspended extends Error {}
class WaitingProjectionFailure extends Error {
  constructor(readonly failure: unknown) {
    super("The saved waiting card could not be projected.");
  }
}

/** Stop at the next persisted step boundary during service shutdown. */
export function requestAssistantJobShutdown(jobId: string, force = false) {
  const control = shutdownControls.get(jobId);
  if (force) control?.force();
  else control?.request();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidValues(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(/[0-9a-f-]{36}/gi))
      if (UUID.test(match[0])) found.add(match[0].toLowerCase());
  } else if (Array.isArray(value))
    value.forEach((entry) => uuidValues(entry, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((entry) => uuidValues(entry, found));
  return [...found];
}

async function teamsForStep(step: PlanStep): Promise<(string | null)[] | null> {
  for (const key of ["team", "team_id", "space"]) {
    const value = step.args[key];
    if (typeof value !== "string") continue;
    if (value.toLowerCase() === "personal") return [null];
    if (!UUID.test(value)) return null;
    return [value.toLowerCase()];
  }
  const ids = uuidValues(step.args);
  if (!ids.length) return [null];
  const rows = (
    await pool.query<{ id: string; team_id: string | null }>(
      `SELECT id::text, team_id FROM items WHERE id = ANY($1::uuid[])
       UNION SELECT id::text, team_id FROM docs WHERE id = ANY($1::uuid[])
       UNION SELECT id::text, team_id FROM projects WHERE id = ANY($1::uuid[])
       UNION SELECT b.id::text, i.team_id FROM time_blocks b
               JOIN items i ON i.id = b.item_id WHERE b.id = ANY($1::uuid[])
       UNION SELECT s.id::text, p.team_id FROM project_stages s
               JOIN projects p ON p.id = s.project_id WHERE s.id = ANY($1::uuid[])`,
      [ids],
    )
  ).rows;
  // Something the step names that isn't found has no known space: never
  // assume Personal for it.
  const found = new Set(rows.map((row) => row.id.toLowerCase()));
  if (ids.some((id) => !found.has(id))) return null;
  return [...new Set(rows.map((row) => row.team_id))];
}

async function stepsBelongToGoal(
  userId: string,
  goalId: string,
  steps: PlanStep[],
) {
  const goal = (
    await pool.query<{ project_id: string | null; plan_doc_id: string | null }>(
      "SELECT project_id, plan_doc_id FROM goals WHERE id = $1 AND user_id = $2",
      [goalId, userId],
    )
  ).rows[0];
  if (!goal || (!goal.project_id && !goal.plan_doc_id)) return false;
  for (const step of steps) {
    const ids = uuidValues(step.args);
    if (!ids.length) return false;
    const linked = (
      await pool.query<{ linked: boolean }>(
        `SELECT (
          ($2::uuid IS NOT NULL AND (
            EXISTS (SELECT 1 FROM projects WHERE id = ANY($1::uuid[]) AND id = $2)
            OR EXISTS (SELECT 1 FROM docs WHERE id = ANY($1::uuid[]) AND project_id = $2)
            OR EXISTS (SELECT 1 FROM items WHERE id = ANY($1::uuid[]) AND project_id = $2)
          )) OR
          ($3::uuid IS NOT NULL AND (
            EXISTS (SELECT 1 FROM docs WHERE id = ANY($1::uuid[]) AND id = $3)
            OR EXISTS (
              SELECT 1 FROM doc_task_links l
                JOIN docs d ON d.id = l.doc_id
               WHERE l.item_id = ANY($1::uuid[]) AND d.id = $3
            )
          ))
        ) AS linked`,
        [ids, goal.project_id, goal.plan_doc_id],
      )
    ).rows[0]?.linked;
    if (!linked) return false;
  }
  return true;
}

function changeKind(step: PlanStep): AssistantChangeKind {
  if (
    [
      "create_tasks",
      "update_tasks",
      "complete_tasks",
      "edit_checklist",
      "tasks_from_doc",
    ].includes(step.tool)
  )
    return "tasks";
  if (
    ["plan_schedule", "schedule_sessions", "reschedule_sessions"].includes(
      step.tool,
    )
  )
    return "sessions";
  if (
    [
      "create_doc",
      "edit_doc",
      "append_doc",
      "comment_on_doc",
      "save_source",
    ].includes(step.tool)
  )
    return "pages";
  if (["create_project", "update_project"].includes(step.tool))
    return "projects";
  if (step.tool === "manage_memory") return "memory";
  if (step.tool === "update_study") return "study";
  return "other";
}

async function approvalScopeCovers(
  userId: string,
  principal: Principal,
  request: PersistedChatRequest,
  steps: PlanStep[],
) {
  if (!steps.length) return false;
  const saved = await assistantApprovalScopes(userId);
  for (const step of steps) {
    const rule = saved[changeKind(step)];
    const covered =
      rule === "always" ||
      (!!rule &&
        typeof rule === "object" &&
        isAutomation(request, rule.scope) &&
        request.automation.id === rule.id);
    if (!covered) return false;
    const teams = await teamsForStep(step);
    if (
      !teams ||
      teams.some(
        (team) =>
          policy.levelIn(principal, team) !== "write" ||
          policy.trustIn(principal, team) !== "full",
      )
    )
      return false;
    if (
      rule !== "always" &&
      rule.scope === "goal" &&
      isAutomation(request, "goal") &&
      !(await stepsBelongToGoal(userId, request.automation.id!, steps))
    )
      return false;
  }
  return true;
}

/**
 * The assistant's principal for this request. An idea run only ever
 * suggests; the override holds for every path of the job (the run, a stop,
 * the deadline and a later approval), never a fresh full-trust grant.
 */
/** Revocation applies to queued work and again at the write transaction boundary. */
async function currentNightConsent(
  db: Queryable,
  userId: string,
  request: PersistedChatRequest,
  lock = false,
) {
  if (!request.automation?.night_id) return null;
  const row = (
    await db.query<{ night_shift: unknown }>(
      `SELECT night_shift FROM agent_settings WHERE user_id=$1${lock ? " FOR SHARE" : ""}`,
      [userId],
    )
  ).rows[0];
  const parsed = nightShiftInput.safeParse(row?.night_shift);
  const key =
    request.automation.source_kind === "goal" ||
    request.automation.source_kind === "routine"
      ? "follow_through"
      : request.automation.night_kind;
  if (
    !parsed.success ||
    !parsed.data.enabled ||
    !key ||
    !parsed.data.kinds[key as keyof typeof parsed.data.kinds]
  )
    fail(409, "Night shift permission changed. This work was held.");
  return parsed.data;
}

async function currentWriteAuthority(
  db: Queryable,
  user: UserRow,
  principal: Principal,
  request: PersistedChatRequest,
) {
  await currentNightConsent(db, user.id, request, true);
  if (request.automation?.night_kind === "reflection")
    fail(409, "Reflection suggestions require a separate reviewed request.");
  const grant = (
    await db.query<{
      trust: string;
      space_trust: unknown;
      acts_alone: string[];
      toolsets: string[] | null;
      suspended_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT trust,space_trust,acts_alone,toolsets,suspended_at,revoked_at FROM agent_grants WHERE id=$1 AND user_id=$2 FOR SHARE`,
      [principal.grant_id, user.id],
    )
  ).rows[0];
  if (!grant || grant.suspended_at || grant.revoked_at)
    fail(409, "Assistant permission changed. This work was held.");
  const fullTrust = isAutomation(request, "idea")
    ? { level: "suggest", spaces: {}, acts_alone: [] }
    : {
        level: grant.trust,
        spaces: grant.space_trust ?? {},
        acts_alone: grant.acts_alone ?? [],
      };
  const equal = (
    await db.query("SELECT $1::jsonb=$2::jsonb AS equal", [
      JSON.stringify(fullTrust),
      JSON.stringify(principal.trust),
    ])
  ).rows[0].equal;
  const toolsets = AGENT_TOOLSETS.filter((toolset) =>
    (
      grant.toolsets ?? AGENT_TOOLSETS.filter((name) => name !== "booking")
    ).includes(toolset),
  );
  if (!equal || JSON.stringify(toolsets) !== JSON.stringify(principal.toolsets))
    fail(409, "Assistant trust changed. This work was held.");
  const job = (
    await db.query(
      `SELECT 1 FROM ai_chats c WHERE c.id=$1 AND ${assistantChatVisible("c", "$2")}`,
      [request.chat_id, user.id],
    )
  ).rowCount;
  if (!job) fail(404, "The sources for this chat are no longer available.");
}

async function principalFor(
  user: UserRow,
  request: PersistedChatRequest,
  jobId: string,
) {
  await currentNightConsent(pool, user.id, request);
  const principal = await assistantPrincipal(user, { refusePaused: true });
  principal.assistant_job_id = jobId;
  principal.assistant_lane =
    request.automation?.kind === "night" || request.automation?.night_id
      ? "overnight"
      : request.automation
        ? "background"
        : "interactive";
  if (isAutomation(request, "task") && request.automation.id) {
    const visible = await pool.query(
      `SELECT 1 FROM items i WHERE i.id=$1 AND ${visibleItems("i", { user: "$2", ai: true })}`,
      [request.automation.id, user.id],
    );
    if (!visible.rowCount)
      throw new Error("This task is no longer available to the assistant.");
  }
  if (isAutomation(request, "goal") && request.automation.id) {
    const visible = await pool.query(
      `SELECT 1 FROM goals g WHERE g.id=$1 AND g.user_id=$2
       AND (g.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=g.project_id AND ${visibleProjects("p", { user: "$2", ai: true })}))
       AND (g.plan_doc_id IS NULL OR EXISTS(SELECT 1 FROM docs d WHERE d.id=g.plan_doc_id AND ${visibleDocs("d", { user: "$2", ai: true })}))`,
      [request.automation.id, user.id],
    );
    if (!visible.rowCount)
      throw new Error("This goal is no longer available to the assistant.");
  }
  if (isAutomation(request, "idea"))
    principal.trust = { level: "suggest", spaces: {}, acts_alone: [] };
  return principal;
}

function newState(request: string): LeadState {
  return {
    original_request: request,
    memory: "",
    context: {},
    reports: [],
    plan: [],
    selected_steps: [],
    answer: null,
    waiting: null,
    specialist_runs: 0,
    lead_steps: 0,
    delegate_rounds: 0,
    stagnant_rounds: 0,
    token_estimate: 0,
    token_budget: LEAD_TOKEN_BUDGET,
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function envelopeOf(value: unknown): RunEnvelope | null {
  const row = jsonObject(value);
  const request = jsonObject(row.request);
  const state = jsonObject(row.state);
  if (
    row.version !== 1 ||
    typeof request.message !== "string" ||
    typeof request.chat_id !== "string" ||
    typeof request.turn_id !== "string" ||
    typeof request.timezone !== "string" ||
    !Array.isArray(request.history)
  )
    return null;
  try {
    const parsedPlan = z
      .array(z.unknown())
      .parse(state.plan)
      .map((step) => checkPlanStep(step));
    const parsedSelected = z
      .array(z.unknown())
      .parse(state.selected_steps)
      .map((step) => {
        const ref = jsonObject(step);
        if (typeof ref.id === "string" && !ref.tool) {
          const found = parsedPlan.find((candidate) => candidate.id === ref.id);
          if (!found) throw new Error("A selected checkpoint step is missing.");
          return found;
        }
        return checkPlanStep(step);
      });
    const reports = Array.isArray(state.reports)
      ? (state.reports as LeadState["reports"]).map((report) => ({
          ...report,
          steps: report.steps.map((step) => {
            const ref = jsonObject(step);
            if (!ref.tool) {
              const found = parsedPlan.find(
                (candidate) => candidate.id === ref.id,
              );
              if (!found)
                throw new Error("A reported checkpoint step is missing.");
              return found;
            }
            return checkPlanStep(step);
          }),
        }))
      : [];
    return {
      version: 1,
      checkpoint_step:
        typeof row.checkpoint_step === "number" ? row.checkpoint_step : 0,
      ...(typeof row.started_at === "number"
        ? { started_at: row.started_at }
        : {}),
      elapsed_ms: typeof row.elapsed_ms === "number" ? row.elapsed_ms : 0,
      reviewed: row.reviewed === true,
      declined: row.declined === true,
      request: request as unknown as PersistedChatRequest,
      state: {
        ...newState(request.message),
        ...(state as unknown as Partial<LeadState>),
        plan: parsedPlan,
        selected_steps: parsedSelected,
        token_budget:
          typeof state.token_budget === "number" && state.token_budget > 0
            ? Math.min(state.token_budget, LEAD_TOKEN_BUDGET)
            : LEAD_TOKEN_BUDGET,
        reports,
      },
    };
  } catch {
    return null;
  }
}

function checkPlanStep(value: unknown): PlanStep {
  return z
    .object({
      id: z.string(),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
    })
    .parse(value) as PlanStep;
}

async function contextFor(
  user: UserRow,
  request: PersistedChatRequest,
  recordSources: (value: unknown, targets?: string[]) => Promise<void>,
) {
  const identity = (
    await pool.query<{ name: string; persona: string }>(
      "SELECT name, persona FROM agent_settings WHERE user_id = $1",
      [user.id],
    )
  ).rows[0] ?? { name: "Orbyn", persona: "" };
  const keptOut = await keptOutFor(pool, user.id);
  const context: AgentContext = {
    user: { id: user.id, role: user.role },
    identity,
    timezone: request.timezone,
    intentText: request.message,
    scope: request.scope,
    actions: [],
    clarification: null,
    cited: new Map(),
    keptOut,
  };
  const [memory, snapshot] = await Promise.all([
    recallMemory(
      pool,
      user.id,
      request.message,
      4000,
      [...keptOut.projects],
      (ids) =>
        recordSources(
          null,
          ids.map((id) => `doc:${id}`),
        ),
    ),
    overview(context),
  ]);
  return { identity, context, memory, snapshot };
}

const saveChains = new Map<string, Promise<void>>();

/**
 * Save a run's state and progress. Saves of one job run one after another
 * in the order they were asked for, each with the state as it was then.
 */
function saveProgress(
  jobId: string,
  envelope: RunEnvelope,
  progress: unknown,
): Promise<void> {
  envelope.checkpoint_step = (envelope.checkpoint_step ?? 0) + 1;
  const owner = assistantLeaseOwner(jobId);
  const values = [
    jobId,
    JSON.stringify({
      ...envelope,
      state: {
        ...envelope.state,
        context: {},
        memory: "",
        selected_steps: envelope.state.selected_steps.map(({ id }) => ({ id })),
        reports: envelope.state.reports.map((report) => ({
          ...report,
          steps: report.steps.map(({ id }) => ({ id })),
        })),
      },
    }),
    JSON.stringify(progress),
    owner,
  ];
  const previous = saveChains.get(jobId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const saved = await pool.query(
        `UPDATE ai_jobs SET run_state = $2::jsonb, progress = $3::jsonb,
           heartbeat_at = now(), lease_until = now() + interval '60 seconds'
           WHERE id = $1 AND state = 'running'
             AND ($4::text IS NULL OR (claimed_by = $4 AND lease_until > now()))`,
        values,
      );
      if (owner && !saved.rowCount) throw new AssistantLeaseLost();
    });
  saveChains.set(jobId, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (saveChains.get(jobId) === next) saveChains.delete(jobId);
    });
  return next;
}

/** Wait for this job's queued saves, so none lands after its next state. */
async function settleSaves(jobId: string) {
  await saveChains.get(jobId)?.catch(() => undefined);
}

/**
 * Keep a running job's heartbeat fresh while it works (a provider call can
 * take minutes), so pollers don't take it for a crashed run. Returns stop.
 */
function keepAlive(jobId: string): () => void {
  const owner = assistantLeaseOwner(jobId);
  const beat = () =>
    void pool
      .query(
        "UPDATE ai_jobs SET heartbeat_at = now(), lease_until = now() + interval '60 seconds' WHERE id = $1 AND state = 'running' AND ($2::text IS NULL OR (claimed_by = $2 AND lease_until > now()))",
        [jobId, owner],
      )
      .catch(() => undefined);
  const timer = setInterval(beat, assistantRunLimits.heartbeatMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function traceWriter(
  userId: string,
  request: PersistedChatRequest,
  logger: FastifyBaseLogger,
) {
  let pending = Promise.resolve();
  const record: AgentTrace = (event: AgentTraceEvent) => {
    const entry = {
      ...event,
      turn_id: request.turn_id,
      at: new Date().toISOString(),
    };
    pending = pending
      .then(() => appendChatTrace(userId, request.chat_id, entry))
      .catch((error) =>
        logger.warn({ err: error }, "Assistant trace could not be saved"),
      );
  };
  return { record, flush: () => pending };
}

function leadSummary(state: LeadState, fallback: string) {
  return (
    (state.answer ?? fallback).trim().slice(0, 12_000) ||
    "I could not complete that request."
  );
}

async function finishJob(
  jobId: string,
  user: UserRow,
  request: PersistedChatRequest,
  state: LeadState,
  summary: string,
  outcome: "info" | "applied" | "pending" | "discarded" = "info",
  extra: Record<string, unknown> = {},
) {
  await settleSaves(jobId);
  await transaction(async (db) => {
    await assertAssistantLease(jobId, db, true);
    await finishChatTurn(
      user.id,
      request.chat_id,
      request.turn_id,
      {
        summary,
        outcome,
        ...(outcome === "applied" && typeof extra.plan_job === "string"
          ? { changesJob: extra.plan_job }
          : {}),
        trace: [],
      },
      db,
    );
    const result = {
      answer: summary,
      chat_id: request.chat_id,
      turn_id: request.turn_id,
      trace:
        (
          await db.query<{ trace: unknown }>(
            "SELECT trace FROM ai_chats WHERE id = $1 AND user_id = $2",
            [request.chat_id, user.id],
          )
        ).rows[0]?.trace ?? [],
      assistant_run: {
        token_estimate: state.token_estimate,
        reports: state.reports.map(({ steps, ...report }) => ({
          ...report,
          step_ids: steps.map((step) => step.id),
        })),
        selected_step_ids: state.selected_steps.map((step) => step.id),
        outcome,
        ...extra,
      },
    };
    await db.query(
      `UPDATE ai_jobs SET state = 'done', result = $2::jsonb, run_state = NULL,
       progress = $3::jsonb, heartbeat_at = now(), lease_until = NULL, claimed_by = NULL WHERE id = $1`,
      [
        jobId,
        JSON.stringify(result),
        JSON.stringify({ label: "Answer ready", outcome }),
      ],
    );
    await notifyAssistantAway(db, jobId, "done");
    await recordNightRun(
      db,
      jobId,
      summary,
      outcome === "discarded"
        ? "undone"
        : outcome === "pending"
          ? "pending"
          : "kept",
    );
    if (
      isAutomation(request, "goal") &&
      request.automation.id &&
      request.automation.week_of
    ) {
      await db.query(
        `INSERT INTO goals_checkins (goal_id, user_id, week_of, summary, progress, status, job_id, claimed_at)
       SELECT g.id, g.user_id, $3::date, $4, $5::jsonb, 'done', $6, now()
         FROM goals g WHERE g.id = $1 AND g.user_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM projects hidden
              WHERE hidden.assistant_off AND (
                hidden.id = g.project_id OR EXISTS (
                  SELECT 1 FROM docs plan
                   WHERE plan.id = g.plan_doc_id AND plan.project_id = hidden.id
                )
              )
           )
       ON CONFLICT (goal_id, week_of) DO UPDATE
         SET summary = EXCLUDED.summary, progress = EXCLUDED.progress,
             status = 'done', job_id = EXCLUDED.job_id, claimed_at = now()`,
        [
          request.automation.id,
          user.id,
          request.automation.week_of,
          summary.slice(0, 2000),
          JSON.stringify({ outcome, plan_job: extra.plan_job ?? null }),
          jobId,
        ],
      );
      await db.query(
        `UPDATE goals g SET progress = $3::jsonb, updated_at = now()
        WHERE g.id = $1 AND g.user_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM projects hidden
             WHERE hidden.assistant_off AND (
               hidden.id = g.project_id OR EXISTS (
                 SELECT 1 FROM docs plan
                  WHERE plan.id = g.plan_doc_id AND plan.project_id = hidden.id
               )
             )
          )`,
        [
          request.automation.id,
          user.id,
          JSON.stringify({
            summary: summary.slice(0, 1000),
            outcome,
            week_of: request.automation.week_of,
          }),
        ],
      );
    } else if (isAutomation(request, "routine") && request.automation.id) {
      await db.query(
        `UPDATE agent_routines SET last_result = $3::jsonb,
         current_job_id = NULL, claimed_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND current_job_id = $4`,
        [
          request.automation.id,
          user.id,
          JSON.stringify({
            summary: summary.slice(0, 2000),
            outcome,
            chat_id: request.chat_id,
            finished_at: new Date().toISOString(),
          }),
          jobId,
        ],
      );
    } else if (isAutomation(request, "task") && request.automation.id) {
      await finishTask(
        jobId,
        user,
        request.automation.id,
        summary,
        outcome === "applied" ||
          (outcome === "info" && !extra.stopped && !extra.timed_out)
          ? "done"
          : "needs_you",
        db,
      );
    } else if (isAutomation(request, "idea") && request.automation.local_day) {
      const proposalId =
        typeof extra.proposal_id === "string"
          ? extra.proposal_id.replace(/^proposal:/, "")
          : null;
      if (proposalId) {
        await db.query(
          `INSERT INTO assistant_ideas (user_id, local_day, slot, title, summary, proposal_id)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
          [
            user.id,
            request.automation.local_day,
            request.automation.slot ?? 1,
            ...ideaText(summary),
            proposalId,
          ],
        );
        await db.query(
          `UPDATE proposals SET kind = 'idea' WHERE id = $1 AND user_id = $2 AND source = 'agent'`,
          [proposalId, user.id],
        );
      }
      await db.query(
        `INSERT INTO assistant_idea_days (user_id, local_day, slot, finished_at)
       VALUES ($1, $2::date, $3, now())
       ON CONFLICT (user_id, local_day, slot) DO UPDATE SET finished_at = now()`,
        [user.id, request.automation.local_day, request.automation.slot ?? 1],
      );
    }
  });
}

/**
 * A handed task's run ended (W3): the task goes back to the person with
 * what the agent did in one line and a short note in its timeline, "via"
 * the agent. Nothing happens when the task was taken back meanwhile.
 */
async function finishTask(
  jobId: string,
  user: UserRow,
  itemId: string,
  summary: string,
  state: "done" | "needs_you",
  db: Queryable = pool,
) {
  const text = summary
    .replace(
      /\n+(I’ve put these changes in Review for you|Done — you can undo this change)\.?\s*$/,
      "",
    )
    .trim();
  const [line] = ideaText(text);
  const back = (
    await db.query<{
      user_id: string;
      team_id: string | null;
      grant_id: string;
    }>(
      `UPDATE items i SET agent_state = $3, agent_result = $4,
         agent_grant_id = NULL, agent_claimed_at = NULL, updated_at = now()
        FROM items old
       WHERE i.id = $1 AND old.id = i.id AND i.agent_job_id = $2
         AND i.agent_grant_id IS NOT NULL
       RETURNING i.user_id, i.team_id, old.agent_grant_id AS grant_id`,
      [itemId, jobId, state, line.slice(0, 300)],
    )
  ).rows[0];
  if (!back) return;
  const note =
    state === "needs_you" && summary.includes("in Review")
      ? `${text}\n\nSome changes wait for you in Review.`
      : text;
  await db.query(
    `INSERT INTO item_updates (item_id, user_id, body, via_grant_id)
     VALUES ($1, $2, $3, $4)`,
    [itemId, user.id, note.slice(0, 1000), back.grant_id],
  );
  await db.query(
    `UPDATE items SET updates_count = updates_count + 1, last_update_at = now()
      WHERE id = $1`,
    [itemId],
  );
  await announceTo(
    db,
    { user_id: back.user_id, team_id: back.team_id },
    "changed",
    { entity_type: "task", entity_id: itemId },
  ).catch(() => undefined);
}

/** Record where a handed task's run stands, when it runs or waits on the person. */
async function markTask(
  jobId: string,
  request: PersistedChatRequest,
  state: "working" | "needs_you",
  result: string | null = null,
  db: Queryable = pool,
) {
  if (!isAutomation(request, "task") || !request.automation.id) return;
  await db.query(
    `UPDATE items SET agent_state = $3, agent_result = $4, updated_at = now()
        WHERE id = $1 AND agent_job_id = $2 AND agent_grant_id IS NOT NULL
          AND agent_state IS DISTINCT FROM $3`,
    [request.automation.id, jobId, state, result?.slice(0, 300) ?? null],
  );
}

/** Persist and start a background lead run for a worker-owned task. */
export async function startAssistantAutomation(input: {
  userId: string;
  message: string;
  timezone: string;
  automation: AssistantAutomation;
  logger?: FastifyBaseLogger;
  onQueued?: (db: Queryable, jobId: string) => Promise<void>;
  /** The chat's title in the person's list (goal and routine runs). */
  title?: string;
  /** A scheduler can commit its claim, chat and queued run together. */
  db?: Queryable;
}): Promise<string | null> {
  const row = (
    await (input.db ?? pool).query<{
      id: string;
      name: string;
      role: SystemRole;
    }>(`SELECT id, name, role FROM users WHERE id = $1 AND NOT disabled`, [
      input.userId,
    ])
  ).rows[0];
  if (!row) return null;
  const user = row as UserRow;
  const chatId = randomUUID();
  const turnId = randomUUID();
  const history = await beginChatTurn(
    user,
    {
      chatId,
      turnId,
      message: input.message,
      scope: null,
      legacyHistory: [],
      origin: input.automation.kind,
      title: input.title,
    },
    input.db,
  );
  const request: PersistedChatRequest = {
    message: input.message,
    history,
    timezone: input.timezone,
    chat_id: chatId,
    turn_id: turnId,
    scope: null,
    automation: input.automation,
  };
  const enqueue = async (db: Queryable) => {
    const row = (
      await db.query<{ id: string }>(
        `INSERT INTO ai_jobs (user_id, progress, run_state, chat_id, turn_id, state, run_origin)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, 'queued', $6) RETURNING id`,
        [
          user.id,
          JSON.stringify({ label: "Starting a scheduled run" }),
          JSON.stringify({
            version: 1,
            request,
            state: {
              ...newState(input.message),
              ...(input.automation.token_budget
                ? {
                    token_budget: Math.min(
                      input.automation.token_budget,
                      LEAD_TOKEN_BUDGET,
                    ),
                  }
                : {}),
            },
          }),
          chatId,
          turnId,
          input.automation.kind,
        ],
      )
    ).rows[0];
    if (row && input.onQueued) await input.onQueued(db, row.id);
    return row?.id ?? null;
  };
  const jobId = input.db ? await enqueue(input.db) : await transaction(enqueue);
  if (!jobId) return null;
  return jobId;
}

/**
 * Park the job on its question or approval card. False when a stop already
 * arrived: the job then stays running for the stop to finish it.
 */
async function waitFor(
  jobId: string,
  envelope: RunEnvelope,
  request: PersistedChatRequest,
  user: UserRow,
  logger: FastifyBaseLogger,
): Promise<boolean> {
  envelope.elapsed_ms =
    (envelope.elapsed_ms ?? 0) +
    (Date.now() - (envelope.started_at ?? Date.now()));
  delete envelope.started_at;
  const progress = {
    label:
      envelope.state.waiting?.kind === "person"
        ? "Waiting for your answer"
        : "Review these changes",
    waiting: envelope.state.waiting,
  };
  await settleSaves(jobId);
  const waitingCommitted = await transaction(async (db) => {
    const parked = await db.query(
      `UPDATE ai_jobs SET state = 'waiting', run_state = $2::jsonb,
       progress = $3::jsonb, heartbeat_at = now(), lease_until = NULL, claimed_by = NULL
     WHERE id = $1 AND state = 'running' AND NOT cancel_requested
       AND ($4::text IS NULL OR (claimed_by = $4 AND lease_until > now()))`,
      [
        jobId,
        JSON.stringify(envelope),
        JSON.stringify(progress),
        assistantLeaseOwner(jobId),
      ],
    );
    if (!parked.rowCount) return false;
    await markTask(
      jobId,
      request,
      "needs_you",
      envelope.state.waiting?.question ?? null,
      db,
    );

    const row = (
      await db.query<{ turns: unknown }>(
        "SELECT turns FROM ai_chats WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [request.chat_id, user.id],
      )
    ).rows[0];
    const waiting = envelope.state.waiting;
    if (!row || !waiting)
      throw new Error("The waiting conversation is unavailable.");
    const turns = Array.isArray(row.turns) ? row.turns : [];
    const text =
      waiting.kind === "person"
        ? waiting.question
        : [
            waiting.question,
            waiting.summary,
            waiting.detail,
            ...waiting.steps.map((step) => `• ${step.tool}`),
          ]
            .filter(Boolean)
            .join("\n\n");
    if (!turns.some((turn) => jsonObject(turn).turn_id === waiting.id)) {
      turns.push({
        role: "assistant",
        text: text.slice(0, 12_000),
        turn_id: waiting.id,
      });
      await db.query(
        "UPDATE ai_chats SET turns = $3::jsonb, last_used_at = now() WHERE id = $1 AND user_id = $2",
        [request.chat_id, user.id, JSON.stringify(turns.slice(-200))],
      );
    }
    await notifyAssistantAway(db, jobId, "waiting", waiting.id);
    await recordNightRun(db, jobId, text, "pending");
    return true;
  }).catch((error) => {
    throw new WaitingProjectionFailure(error);
  });
  if (!waitingCommitted) return false;
  const event: AgentTraceEvent = {
    step: envelope.state.lead_steps,
    kind: "result",
    label:
      envelope.state.waiting?.kind === "person"
        ? "A question needs your answer"
        : "Changes need your approval",
  };
  const writer = traceWriter(user.id, request, logger);
  writer.record(event);
  await writer.flush();
  return true;
}

async function approvePlan(
  user: UserRow,
  jobId: string,
  principal: Principal,
  state: LeadState,
  reviewed: boolean,
  request: PersistedChatRequest,
  approvedRulesRevision?: number,
) {
  if (request.automation?.night_kind === "reflection")
    fail(409, "Reflection suggestions require a separate reviewed request.");
  const receipt = (
    await pool.query<{ apply_result: unknown }>(
      "SELECT apply_result FROM ai_jobs WHERE id = $1 AND user_id = $2",
      [jobId, user.id],
    )
  ).rows[0]?.apply_result;
  if (receipt) {
    await assertAssistantLease(jobId);
    return z
      .object({
        applied: z.boolean(),
        structured: z.unknown(),
        why: z.array(z.string()),
      })
      .parse(receipt);
  }
  principal = await principalFor(user, request, jobId);
  if (
    reviewed &&
    (approvedRulesRevision ?? 1) !== principal.assistant_rules_revision
  )
    fail(409, "Assistant rules changed. Review this plan again.");
  const nightPrefs = await currentNightConsent(pool, user.id, request);
  const scopeSnapshot = await assistantApprovalScopes(user.id);
  const checked = await checkMergedPlan(pool, principal, state.selected_steps);
  if (!checked.steps.length)
    return { applied: false, structured: null, why: [] as string[] };
  const nightReview =
    !!request.automation?.night_id &&
    (request.automation.wait_for_ok !== false ||
      nightPrefs?.wait_for_ok !== false ||
      principal.trust.level !== "full" ||
      Object.values(principal.trust.spaces).some((level) => level !== "full") ||
      nightPlanNeedsReview(checked.steps));
  const nightPrincipal = {
    ...principal,
    unattended: !!request.automation?.night_id,
  };
  const applyingPrincipal = nightReview
    ? {
        ...nightPrincipal,
        trust: { level: "suggest" as const, spaces: {}, acts_alone: [] },
      }
    : nightPrincipal;
  const result = await execute(
    registry,
    applyingPrincipal,
    "apply_plan",
    {
      steps: checked.steps,
      summary: state.answer?.slice(0, 300) || "Assistant plan",
      client_ref: `assistant-${jobId}`,
    },
    {
      primary: true,
      requestId: jobId,
      asking: reviewed && !nightReview ? "approved" : "collect",
      reviewed:
        !nightReview &&
        (reviewed ||
          (await approvalScopeCovers(
            user.id,
            principal,
            request,
            checked.steps,
          ))),
      write: (run) =>
        transaction(async (db) => {
          await assertAssistantLease(jobId, db, true);
          const prefs = await currentNightConsent(db, user.id, request, true);
          if (prefs?.wait_for_ok && !nightReview)
            fail(409, "Night review permission changed. This work was held.");
          await currentWriteAuthority(db, user, principal, request);
          const scopes = (
            await db.query(
              "SELECT approval_scopes=$2::jsonb AS equal FROM agent_grants WHERE id=$1",
              [principal.grant_id, JSON.stringify(scopeSnapshot)],
            )
          ).rows[0];
          if (!scopes?.equal)
            fail(409, "Saved approval permission changed. This work was held.");
          const answer = (await run(db)) as CapabilityResult<unknown>;
          const structured = answer.structured;
          const pending =
            structured &&
            typeof structured === "object" &&
            "status" in structured &&
            structured.status === "pending_review";
          await db.query(
            "UPDATE ai_jobs SET apply_result = $2::jsonb WHERE id = $1",
            [
              jobId,
              JSON.stringify({
                applied: !pending && (answer.write?.outcome ?? "ok") === "ok",
                structured,
                why: checked.approvals,
              }),
            ],
          );
          return answer;
        }),
    },
  );
  if (result.ask)
    return {
      applied: false,
      rules_revision: principal.assistant_rules_revision,
      structured: null,
      why: result.ask.why,
      what: result.ask.what,
    };
  if (result.result.isError) {
    const message = result.result.content
      .map((block) =>
        block.type === "text" ? block.text : (block.title ?? block.name),
      )
      .join("\n");
    throw new Error(message || "The plan did not pass the apply checks.");
  }
  return {
    applied: result.outcome === "ok",
    structured: result.result.structuredContent ?? null,
    why: checked.approvals,
  };
}

/** The approval card for the selected steps of a run. */
function approvalWaiting(
  state: LeadState,
  request: PersistedChatRequest,
  question: string,
  detail: string,
  rulesRevision?: number,
): LeadWaiting {
  return {
    kind: "approval",
    assistant_rules_revision: rulesRevision,
    id: randomUUID(),
    question,
    detail,
    steps: state.selected_steps,
    summary: state.answer ?? "",
    change_kinds: [...new Set(state.selected_steps.map(changeKind))],
    ...(isAutomation(request, "goal") || isAutomation(request, "routine")
      ? {
          automation_kind: automationKind(request) as "goal" | "routine",
          automation_id: request.automation.id,
        }
      : {}),
  };
}

/**
 * After the checker refused the selected plan: the reports its steps came
 * from are blocked and lose those steps, so a retry cannot pick them again.
 */
function blockRejectedPlan(state: LeadState, reason: string, lead: string) {
  const rejected = new Set(state.selected_steps.map((step) => step.id));
  const finding = reason.slice(0, 2000);
  for (const report of state.reports) {
    if (!report.steps.some((step) => rejected.has(step.id))) continue;
    report.status = "blocked";
    report.summary =
      `Staged changes were held because the checked plan failed: ${reason}`.slice(
        0,
        2000,
      );
    report.findings.push(finding);
    report.steps = [];
  }
  state.reports.push({
    specialist: "planner",
    task_id: `checker-${randomUUID().slice(0, 8)}`,
    status: "blocked",
    summary: "The code checker blocked this combined plan.",
    findings: [finding],
    steps: [],
    open_questions: [],
  });
  state.plan = state.plan.filter((step) => !rejected.has(step.id));
  state.selected_steps = [];
  state.answer = null;
  state.answer_to_person = `${lead}: ${reason}`;
}

/** Record a run that could not complete, and free its automation. */
async function failJob(
  jobId: string,
  user: UserRow,
  request: PersistedChatRequest,
  message: string,
) {
  await settleSaves(jobId);
  await transaction(async (db) => {
    await assertAssistantLease(jobId, db, true);
    await finishChatTurn(
      user.id,
      request.chat_id,
      request.turn_id,
      {
        summary: message,
        trace: [],
        failed: true,
      },
      db,
    );
    await db.query(
      `UPDATE ai_jobs SET state = 'failed', error_status = 502,
       error_message = $2, run_state = NULL, progress = $3::jsonb,
       result = jsonb_build_object('assistant_run', jsonb_build_object('token_estimate', coalesce((run_state->'state'->>'token_estimate')::int, 0))),
       heartbeat_at = now(), lease_until = NULL, claimed_by = NULL WHERE id = $1`,
      [
        jobId,
        message,
        JSON.stringify({ label: "This run could not be completed" }),
      ],
    );
    await notifyAssistantAway(db, jobId, "failed");
    await recordNightRun(db, jobId, message, "pending");
  });
  if (
    isAutomation(request, "goal") &&
    request.automation.id &&
    request.automation.week_of
  )
    await pool
      .query(
        `UPDATE goals_checkins SET status = 'failed', summary = $4, claimed_at = now()
        WHERE goal_id = $1 AND user_id = $2 AND week_of = $3::date AND job_id = $5`,
        [
          request.automation.id,
          user.id,
          request.automation.week_of,
          "The weekly check-in could not be completed.",
          jobId,
        ],
      )
      .catch(() => undefined);
  // A handed task waits for the worker's next try (worker/assistant-tasks.ts).
  if (isAutomation(request, "task") && request.automation.id)
    await pool
      .query(
        `UPDATE items SET agent_state = 'queued', agent_result = $3, updated_at = now()
          WHERE id = $1 AND agent_job_id = $2 AND agent_grant_id IS NOT NULL`,
        [
          request.automation.id,
          jobId,
          "The last try didn't finish. It will be tried again later.",
        ],
      )
      .catch(() => undefined);
  if (isAutomation(request, "routine") && request.automation.id)
    await pool
      .query(
        `UPDATE agent_routines SET last_result = $3::jsonb, current_job_id = NULL,
         claimed_at = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND current_job_id = $4`,
        [
          request.automation.id,
          user.id,
          JSON.stringify({
            error: "The scheduled run could not be completed.",
          }),
          jobId,
        ],
      )
      .catch(() => undefined);
}

/** Start or resume one bounded multi-specialist assistant run. */
export async function runAssistantJob(
  jobId: string,
  user: UserRow,
  request: PersistedChatRequest,
  scoped?: unknown,
  loaded?: RunEnvelope,
  logger?: FastifyBaseLogger,
) {
  const log = logger ?? (console as unknown as FastifyBaseLogger);
  const controller = new AbortController();
  // Why the run was interrupted: the person's Stop, or the time limit.
  let stopReason = null as "stop" | "deadline" | "lease" | "shutdown" | null;
  let shutdownRequested = false;
  const interrupt = (reason: "stop" | "deadline" | "lease" | "shutdown") => {
    stopReason ??= reason;
    controller.abort();
  };
  const stopHandle = () => interrupt("stop");
  activeRuns.set(jobId, stopHandle);
  const shutdownControl = {
    request: () => {
      shutdownRequested = true;
    },
    force: () => {
      shutdownRequested = true;
      interrupt("shutdown");
    },
  };
  shutdownControls.set(jobId, shutdownControl);
  const nightEnd = request.automation?.end_at
    ? Date.parse(request.automation.end_at)
    : NaN;
  const deadline = setTimeout(
    () => interrupt("deadline"),
    Math.max(
      1,
      Math.min(
        Number.isFinite(nightEnd) && !loaded?.reviewed
          ? nightEnd - Date.now()
          : Infinity,
        loaded?.reviewed
          ? 30_000
          : assistantRunLimits.maxRunMs -
              (loaded?.elapsed_ms ?? 0) -
              (Date.now() - (loaded?.started_at ?? Date.now())),
      ),
    ),
  );
  const checkCancel = () =>
    pool
      .query<{
        cancel_requested: boolean;
        claimed_by: string | null;
        leased: boolean;
      }>(
        "SELECT cancel_requested, claimed_by, lease_until > now() AS leased FROM ai_jobs WHERE id = $1",
        [jobId],
      )
      .then((result) => {
        const owner = assistantLeaseOwner(jobId);
        if (
          owner &&
          (result.rows[0]?.claimed_by !== owner || !result.rows[0]?.leased)
        )
          interrupt("lease");
        else if (result.rows[0]?.cancel_requested) interrupt("stop");
      })
      .catch(() => undefined);
  const pollCancel = setInterval(() => void checkCancel(), 1000);
  pollCancel.unref?.();
  void checkCancel();
  const stopHeartbeat = keepAlive(jobId);
  const trace = traceWriter(user.id, request, log);
  let applyPlanAttempted = false;
  let appliedStatus: "applied" | "pending" | "not_applied" = "not_applied";
  let principal: Principal | null = null;
  const envelope: RunEnvelope = loaded ?? {
    version: 1,
    request,
    state: newState(request.message),
  };
  envelope.started_at ??= Date.now();
  // A stop that reached this copy while it parked the job ends it instead.
  const parked = async () =>
    (await waitFor(jobId, envelope, request, user, log)) &&
    stopReason !== "stop";

  try {
    if (envelope.declined) {
      await finishJob(
        jobId,
        user,
        request,
        envelope.state,
        `${leadSummary(envelope.state, "")}\n\nI held the changes. Nothing was applied.`,
        "discarded",
      );
      return;
    }
    const ai = await resolveAi();
    if (!ai) throw new Error("The AI assistant is not set up yet.");
    principal = await principalFor(user, request, jobId);
    const recordSources = (value: unknown, targets?: string[]) =>
      recordAssistantSources(jobId, user.id, value, targets);
    const reflecting = request.automation?.night_kind === "reflection";
    const evidenceSources = reflecting
      ? reflectionSources.parse(request.automation?.reflection_sources ?? [])
      : [];
    const evidence = reflecting
      ? await reflectionEvidence(pool, user.id, evidenceSources)
      : [];
    if (
      reflecting &&
      (!evidenceSources.length || evidence.length !== evidenceSources.length)
    )
      throw new Error(
        "The evidence for this reflection changed or is no longer available.",
      );
    if (reflecting) await recordSources(evidence);
    const prepared = await contextFor(user, request, recordSources);
    const snapshot = reflecting
      ? {
          reflection_evidence: evidence.map((entry, index) => ({
            number: index + 1,
            ...entry,
          })),
        }
      : (scoped ?? prepared.snapshot);
    await recordSources([snapshot, request.automation, request.scope]);
    envelope.state.memory = prepared.memory;
    envelope.state.context = snapshot;
    const currentMessage = envelope.state.answer_to_person || request.message;
    await markTask(jobId, request, "working");
    await saveProgress(jobId, envelope, {
      label: "Starting the lead assistant",
      step: envelope.state.lead_steps,
    });
    await checkCancel();
    if (shutdownRequested) throw new AssistantSuspended();
    if (envelope.state.waiting) {
      if (!(await parked())) throw new Error("stopped");
      return;
    }

    let fallback = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (controller.signal.aborted) throw new Error("stopped");
      const result = envelope.state.answer
        ? { state: envelope.state, partial: false }
        : await runLead({
            ai,
            principal,
            identity: prepared.identity,
            timezone: request.timezone,
            state: envelope.state,
            message: attempt
              ? "Review the blocked report and revise the plan or explain why it cannot proceed."
              : currentMessage,
            history: request.history,
            context: prepared.context,
            recordSources,
            allowChanges:
              !reflecting &&
              (isAutomation(request, "idea") ||
                mayChange(envelope.state.original_request)),
            log,
            trace: trace.record,
            progress: (label, event) => {
              const progress = {
                label,
                step: event?.step ?? envelope.state.lead_steps,
                ...(envelope.state.waiting
                  ? { waiting: envelope.state.waiting }
                  : {}),
              };
              void saveProgress(jobId, envelope, progress).catch((error) =>
                log.warn(
                  { err: error },
                  "Assistant progress could not be saved",
                ),
              );
            },
            signal: controller.signal,
            checkpoint: async () => {
              if (reflecting) {
                await currentNightConsent(pool, user.id, request);
                const current = await reflectionEvidence(
                  pool,
                  user.id,
                  evidenceSources,
                );
                if (current.length !== evidenceSources.length)
                  throw new Error(
                    "The evidence for this reflection changed or is no longer available.",
                  );
              }
              await saveProgress(jobId, envelope, {
                label: "Working on your request",
                step: envelope.state.lead_steps,
              });
              if (shutdownRequested) throw new AssistantSuspended();
            },
          });
      fallback = result.state.answer ?? "";
      if (result.state.waiting) {
        if (reflecting) {
          const question = result.state.waiting.question;
          result.state.waiting = null;
          await trace.flush();
          await finishJob(
            jobId,
            user,
            request,
            result.state,
            `${result.state.answer ?? "Reflection needs your input."}\n\nOpen question: ${question}`,
          );
          return;
        }
        if (isAutomation(request, "idea")) {
          result.state.waiting = null;
          await trace.flush();
          await finishJob(
            jobId,
            user,
            request,
            result.state,
            "I could not prepare a ready-to-review idea without asking you for a choice.",
          );
          return;
        }
        await trace.flush();
        if (!(await parked())) throw new Error("stopped");
        return;
      }
      if (!result.state.answer)
        result.state.answer = "I could not finish the request within this run.";
      if (!result.state.selected_steps.length) {
        await trace.flush();
        await finishJob(
          jobId,
          user,
          request,
          result.state,
          leadSummary(result.state, fallback),
        );
        return;
      }
      if (controller.signal.aborted) throw new Error("stopped");
      let applied: Awaited<ReturnType<typeof approvePlan>>;
      try {
        await saveProgress(jobId, envelope, {
          label: "Checking the plan before applying",
          step: result.state.lead_steps,
        });
        applyPlanAttempted = true;
        applied = await approvePlan(
          user,
          jobId,
          principal,
          result.state,
          envelope.reviewed === true,
          request,
          envelope.approved_rules_revision,
        );
      } catch (error) {
        // The apply ran in one transaction that rolled back: nothing changed.
        applyPlanAttempted = false;
        if (controller.signal.aborted) throw error;
        envelope.reviewed = false;
        delete envelope.state.loop;
        blockRejectedPlan(
          result.state,
          error instanceof Error
            ? error.message
            : "The checked plan could not be applied.",
          "The code checker blocked the plan",
        );
        await saveProgress(jobId, envelope, {
          label: "Revising a blocked plan",
          step: result.state.lead_steps,
        });
        continue;
      }
      if (
        !applied.applied &&
        applied.structured === null &&
        (applied.why.length || "what" in applied)
      ) {
        // Asked instead of applied: the plan was rolled back.
        applyPlanAttempted = false;
        result.state.waiting = approvalWaiting(
          result.state,
          request,
          "Do you want me to apply this plan?",
          [
            ...(applied.why ?? []),
            ...("what" in applied ? (applied.what ?? []) : []),
          ].join("\n"),
          "rules_revision" in applied
            ? applied.rules_revision
            : principal.assistant_rules_revision,
        );
        await trace.flush();
        if (!(await parked())) throw new Error("stopped");
        return;
      }
      const structured = applied.structured as {
        status?: string;
        job?: string | null;
        proposal_id?: string;
        pending?: { proposal_id?: string } | null;
      } | null;
      const status = structured?.status;
      appliedStatus =
        status === "pending_review"
          ? "pending"
          : applied.applied
            ? "applied"
            : "not_applied";
      const summary =
        status === "pending_review"
          ? `${leadSummary(result.state, fallback)}\n\nI’ve put these changes in Review for you.`
          : applied.applied
            ? `${leadSummary(result.state, fallback)}\n\nDone — you can undo this change.`
            : leadSummary(result.state, fallback);
      await trace.flush();
      trace.record({
        step: result.state.lead_steps,
        kind: "result",
        label:
          status === "pending_review"
            ? "Plan sent to Review"
            : applied.applied
              ? "Plan applied"
              : "No changes needed",
      });
      await trace.flush();
      await finishJob(
        jobId,
        user,
        request,
        result.state,
        summary,
        status === "pending_review"
          ? "pending"
          : applied.applied
            ? "applied"
            : "info",
        {
          plan_job: structured?.job ?? null,
          // apply_plan names a Review proposal under pending (a single
          // write names it at the top level).
          ...(typeof (
            structured?.pending?.proposal_id ?? structured?.proposal_id
          ) === "string"
            ? {
                proposal_id: (structured?.pending?.proposal_id ??
                  structured?.proposal_id)!,
              }
            : {}),
        },
      );
      return;
    }
    await trace.flush();
    await finishJob(
      jobId,
      user,
      request,
      envelope.state,
      leadSummary(envelope.state, fallback),
    );
  } catch (error) {
    if (error instanceof AssistantLeaseLost || stopReason === "lease") {
      controller.abort();
      return;
    }
    const stillOwned = await assertAssistantLease(jobId).then(
      () => true,
      () => false,
    );
    if (!stillOwned) {
      controller.abort();
      return;
    }
    if (
      shutdownRequested ||
      error instanceof AssistantSuspended ||
      error instanceof WaitingProjectionFailure ||
      stopReason === "shutdown"
    ) {
      controller.abort();
      stopHeartbeat();
      envelope.elapsed_ms =
        (envelope.elapsed_ms ?? 0) +
        (Date.now() - (envelope.started_at ?? Date.now()));
      delete envelope.started_at;
      await saveProgress(jobId, envelope, {
        label:
          error instanceof WaitingProjectionFailure
            ? "Retrying the saved waiting card"
            : "Picking up where I left off",
        step: envelope.state.lead_steps,
      });
      await settleSaves(jobId);
      await pool.query(
        `UPDATE ai_jobs SET lease_until = now() WHERE id = $1
         AND state = 'running' AND ($2::text IS NULL OR claimed_by = $2)`,
        [jobId, assistantLeaseOwner(jobId)],
      );
      return;
    }
    if (!controller.signal.aborted) {
      log.error({ event: "assistant_run_failed" }, "Assistant run failed");
      await failJob(
        jobId,
        user,
        request,
        error instanceof AssistantPausedError
          ? error.message
          : "This run could not be completed. Please try again.",
      );
      return;
    }
    try {
      await trace.flush();
      await settleSaves(jobId);
      if (applyPlanAttempted) {
        // The apply had already started: say only what is known.
        await finishJob(
          jobId,
          user,
          request,
          envelope.state,
          appliedStatus === "applied"
            ? "I stopped. The checked plan completed as one undoable change before the stop was handled."
            : appliedStatus === "pending"
              ? "I stopped. The checked plan is waiting in Review."
              : "I stopped while a checked plan was being applied. Check Review and the change history to see whether it went through.",
          appliedStatus === "applied"
            ? "applied"
            : appliedStatus === "pending"
              ? "pending"
              : "info",
          { stopped: true },
        );
        return;
      }
      if (stopReason === "deadline") {
        // Out of time: never write. Staged work waits for the person's yes.
        const state = envelope.state;
        // A background idea run has nobody watching its chat: it drops the
        // work rather than leave a question there.
        if (
          !state.waiting &&
          state.plan.length &&
          principal &&
          !isAutomation(request, "idea")
        ) {
          state.selected_steps = state.plan;
          state.answer ||=
            "I ran out of time before finishing. These are the changes prepared so far.";
          const checked = await checkMergedPlan(
            pool,
            principal,
            state.selected_steps,
          ).catch(() => null);
          if (checked)
            state.waiting = approvalWaiting(
              state,
              request,
              "I ran out of time. Do you want me to apply the changes prepared so far?",
              checked.approvals.join("\n"),
              principal.assistant_rules_revision,
            );
          else state.selected_steps = [];
        }
        if (state.waiting) {
          if (await waitFor(jobId, envelope, request, user, log)) return;
          state.waiting = null;
          state.selected_steps = [];
          await finishJob(
            jobId,
            user,
            request,
            state,
            STOPPED_TEXT,
            "discarded",
            { stopped: true },
          );
          return;
        }
        await finishJob(
          jobId,
          user,
          request,
          state,
          "I ran out of time before finishing. Nothing was changed.",
          "info",
          { timed_out: true },
        );
        return;
      }
      // The person's Stop never applies anything: staged work is dropped.
      envelope.state.waiting = null;
      envelope.state.selected_steps = [];
      await finishJob(
        jobId,
        user,
        request,
        envelope.state,
        STOPPED_TEXT,
        "discarded",
        { stopped: true },
      );
    } catch (stopError) {
      log.error(
        { err: stopError, event: "assistant_stop_failed" },
        "Assistant stop could not be recorded",
      );
      await failJob(
        jobId,
        user,
        request,
        "This run could not be completed. Please try again.",
      );
    }
  } finally {
    clearTimeout(deadline);
    clearInterval(pollCancel);
    stopHeartbeat();
    if (activeRuns.get(jobId) === stopHandle) activeRuns.delete(jobId);
    if (shutdownControls.get(jobId) === shutdownControl)
      shutdownControls.delete(jobId);
  }
}

/** Persist an answer to ask_person and resume the same run. */
export async function answerAssistantQuestion(
  jobId: string,
  user: UserRow,
  value: unknown,
  log: FastifyBaseLogger,
) {
  const { answer, waiting_id } = pendingInput.parse(value);
  await transaction(async (db) => {
    const row = (
      await db.query<{ run_state: unknown }>(
        `SELECT run_state FROM ai_jobs WHERE id = $1 AND user_id = $2
          AND state = 'waiting' AND EXISTS(SELECT 1 FROM ai_chats c WHERE c.id=ai_jobs.chat_id AND ${assistantChatVisible("c", "$2")}) FOR UPDATE`,
        [jobId, user.id],
      )
    ).rows[0];
    const envelope = envelopeOf(row?.run_state);
    if (
      !envelope ||
      envelope.state.waiting?.kind !== "person" ||
      envelope.state.waiting.id !== waiting_id
    )
      throw new Error(
        "This question changed or was answered. Refresh before answering.",
      );
    const question = envelope.state.waiting;
    // Free text is allowed so the person can explain a different preference;
    // the lead is told when the answer is none of the offered choices.
    const offered =
      !question.choices.length ||
      question.choices.some(
        (choice) => choice.toLowerCase() === answer.toLowerCase(),
      );
    envelope.state.waiting = null;
    delete envelope.state.loop;
    envelope.state.answer_to_person = offered
      ? answer
      : `${answer}\n(This is not one of the offered choices: ${question.choices.join("; ")}.)`;
    envelope.request = {
      ...envelope.request,
      history: [
        ...envelope.request.history,
        { role: "user" as const, content: answer },
      ].slice(-12),
    };
    await db.query(
      `UPDATE ai_jobs SET state = 'queued', run_state = $3::jsonb,
         progress = $4::jsonb, cancel_requested = false, heartbeat_at = now(), lease_until = NULL, claimed_by = NULL
       WHERE id = $1 AND user_id = $2`,
      [
        jobId,
        user.id,
        JSON.stringify(envelope),
        JSON.stringify({ label: "Continuing with your answer" }),
      ],
    );
    const chat = (
      await db.query<{ turns: unknown }>(
        "SELECT turns FROM ai_chats WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [envelope.request.chat_id, user.id],
      )
    ).rows[0];
    if (chat) {
      const turns = Array.isArray(chat.turns) ? chat.turns : [];
      turns.push({ role: "user", text: answer, turn_id: randomUUID() });
      await db.query(
        "UPDATE ai_chats SET turns = $3::jsonb, last_used_at = now() WHERE id = $1 AND user_id = $2",
        [envelope.request.chat_id, user.id, JSON.stringify(turns.slice(-200))],
      );
    }
    return envelope;
  });
  return { accepted: true, job_id: jobId };
}

/** Apply or decline the one checked plan shown in the assistant's chat card. */
export async function answerAssistantApproval(
  jobId: string,
  user: UserRow,
  value: unknown,
  log: FastifyBaseLogger,
) {
  const { approved, scope, waiting_id } = approvalInput.parse(value);
  const row = (
    await pool.query<{ state: string; run_state: unknown }>(
      "SELECT state, run_state FROM ai_jobs WHERE id = $1 AND user_id = $2",
      [jobId, user.id],
    )
  ).rows[0];
  if (row && row.state !== "waiting") throw new Error("Already answered.");
  const seen = envelopeOf(row?.run_state);
  if (
    !seen ||
    seen.state.waiting?.kind !== "approval" ||
    seen.state.waiting.id !== waiting_id
  )
    throw new Error(
      "This approval changed or was answered. Refresh before deciding.",
    );
  const card = seen.state.waiting;
  // Checked before the claim, so a refusal leaves the card answerable.
  if (approved) await principalFor(user, seen.request, jobId);
  if (approved && scope !== "once") {
    if (!seen.state.selected_steps.length)
      throw new Error("This plan has no changes to remember.");
    if (
      (scope === "goal" || scope === "routine") &&
      (automationKind(seen.request) !== scope || !seen.request.automation?.id)
    )
      throw new Error(
        `This approval can only be saved for the current ${scope}.`,
      );
  }

  await transaction(async (db) => {
    const row = (
      await db.query<{ run_state: unknown }>(
        `SELECT run_state FROM ai_jobs WHERE id = $1 AND user_id = $2
       AND state = 'waiting' AND run_state->'state'->'waiting'->>'id' = $3
       AND EXISTS(SELECT 1 FROM ai_chats c WHERE c.id=ai_jobs.chat_id AND ${assistantChatVisible("c", "$2")}) FOR UPDATE`,
        [jobId, user.id, waiting_id],
      )
    ).rows[0];
    const envelope = envelopeOf(row?.run_state);
    if (!envelope || envelope.state.waiting?.kind !== "approval")
      throw new Error("Already answered.");
    const { request, state } = envelope;
    if (approved) {
      const current = (
        await db.query<{ revision: number }>(
          `SELECT assistant_rules_revision AS revision FROM agent_grants
         WHERE user_id=$1 AND kind='assistant' AND revoked_at IS NULL AND suspended_at IS NULL FOR UPDATE`,
          [user.id],
        )
      ).rows[0];
      if (
        !current ||
        current.revision !==
          (envelope.state.waiting.assistant_rules_revision ?? 1)
      )
        fail(409, "Assistant rules changed. Review this plan again.");
      envelope.approved_rules_revision = current.revision;
    }
    state.waiting = null;
    delete state.loop;
    envelope.reviewed = approved;
    envelope.declined = !approved;
    if (approved && scope !== "once") {
      const kinds = [...new Set(state.selected_steps.map(changeKind))];
      const saved = await assistantApprovalScopes(user.id);
      for (const kind of kinds)
        saved[kind] =
          scope === "always"
            ? "always"
            : { scope, id: request.automation!.id! };
      await db.query(
        `UPDATE agent_grants SET approval_scopes = $2::jsonb
         WHERE user_id = $1 AND kind = 'assistant' AND revoked_at IS NULL`,
        [user.id, JSON.stringify(saved)],
      );
    }
    await db.query(
      `UPDATE ai_jobs SET state = 'queued', run_state = $3::jsonb,
       progress = $4::jsonb, cancel_requested = false, heartbeat_at = now(), lease_until = NULL, claimed_by = NULL
       WHERE id = $1 AND user_id = $2`,
      [
        jobId,
        user.id,
        JSON.stringify(envelope),
        JSON.stringify({
          label: approved
            ? "Checking and applying the approved plan"
            : "Holding the changes",
        }),
      ],
    );
  });
  return { accepted: true, job_id: jobId };
}

/**
 * Stop a run. A Stop never applies anything: a job waiting on a question or
 * an approval card is finished here with its staged work dropped; a running
 * one gets the persisted flag, and this copy interrupts it if it holds it.
 */
export async function stopAssistantJob(
  jobId: string,
  user: UserRow,
  log: FastifyBaseLogger,
) {
  const row = await transaction(async (db) => {
    const current = (
      await db.query<{ state: string; run_state: unknown }>(
        `SELECT state, run_state FROM ai_jobs WHERE id = $1 AND user_id = $2
          AND state IN ('queued', 'running', 'waiting') FOR UPDATE`,
        [jobId, user.id],
      )
    ).rows[0];
    if (!current) return null;
    await db.query(
      `UPDATE ai_jobs SET state = 'running', cancel_requested = true,
         progress = jsonb_build_object('label', 'Stopping the run') WHERE id = $1`,
      [jobId],
    );
    return current;
  });
  if (!row) return false;
  if (row.state === "waiting" || row.state === "queued") {
    const envelope = envelopeOf(row.run_state);
    if (!envelope) {
      await pool.query(
        `UPDATE ai_jobs SET state = 'failed', error_status = 409,
           error_message = $2, run_state = NULL WHERE id = $1`,
        [jobId, STOPPED_TEXT],
      );
      return true;
    }
    envelope.state.waiting = null;
    envelope.state.selected_steps = [];
    await finishJob(
      jobId,
      user,
      envelope.request,
      envelope.state,
      STOPPED_TEXT,
      "discarded",
      { stopped: true },
    ).catch((error) =>
      log.error({ err: error }, "Assistant stop could not be recorded"),
    );
    return true;
  }
  activeRuns.get(jobId)?.();
  return true;
}

/**
 * An idea's short title (its first sentence) and the rest as its detail,
 * without the run's own status line.
 */
export function ideaText(summary: string): [string, string] {
  const text = summary
    .replace(/\n+I’ve put these changes in Review for you\.?\s*$/, "")
    .trim();
  const first = /^(.+?[.!?])(\s|$)/s.exec(text)?.[1] ?? text.split("\n")[0];
  const title = first.replace(/\s+/g, " ").trim().slice(0, 120);
  const rest = text.slice(first.length).trim();
  const heading = title || "A useful next step";
  // The detail is required: a one-sentence idea repeats its title there.
  return [heading, (rest || heading).slice(0, 2000)];
}

/** Requeue interrupted leased runs; waiting cards keep their existing expiry. */
export async function failStaleAssistantJobs(
  now: Date = new Date(),
): Promise<string[]> {
  const interrupted =
    "The assistant was interrupted by a server restart. Please ask again.";
  const exhausted =
    "This request was interrupted too many times. Please ask again.";
  const expired = "This request expired before it was answered.";
  const changed = await transaction(async (db) => {
    const rows = (
      await db.query<{
        id: string;
        user_id: string;
        run_state: unknown;
        was: string;
        resume_count: number;
        heartbeat_at: Date;
      }>(
        `SELECT id, user_id, run_state, state AS was, resume_count, heartbeat_at FROM ai_jobs
       WHERE (state = 'running' AND
         (lease_until <= $1 OR (lease_until IS NULL AND heartbeat_at < $1::timestamptz - interval '180 seconds')))
       OR (state = 'waiting' AND heartbeat_at < $1::timestamptz - make_interval(secs => $2::double precision / 1000))
       ORDER BY heartbeat_at FOR UPDATE SKIP LOCKED LIMIT 200`,
        [now, WAITING_EXPIRES_MS],
      )
    ).rows;
    const ended: typeof rows = [];
    const resumed: typeof rows = [];
    for (const row of rows) {
      if (
        row.was === "running" &&
        envelopeOf(row.run_state) &&
        row.resume_count < 3
      ) {
        const checkpoint = jsonObject(row.run_state);
        if (typeof checkpoint.started_at === "number") {
          checkpoint.elapsed_ms =
            (typeof checkpoint.elapsed_ms === "number"
              ? checkpoint.elapsed_ms
              : 0) +
            Math.max(0, row.heartbeat_at.getTime() - checkpoint.started_at);
          delete checkpoint.started_at;
        }
        const envelope = envelopeOf(checkpoint)!;
        await appendChatTrace(
          row.user_id,
          envelope.request.chat_id,
          {
            turn_id: envelope.request.turn_id,
            step: Math.max(1, envelope.state.lead_steps),
            kind: "result",
            label: "Picking up where I left off",
            at: now.toISOString(),
          },
          db,
        );
        await db.query(
          `UPDATE ai_jobs SET state = 'queued', resume_count = resume_count + 1,
           lease_until = NULL, claimed_by = NULL, heartbeat_at = $2, run_state = $3::jsonb,
           progress = jsonb_build_object('label', 'Picking up where I left off')
           WHERE id = $1`,
          [row.id, now, JSON.stringify(checkpoint)],
        );
        resumed.push(row);
      } else {
        const message =
          row.was === "waiting"
            ? expired
            : row.resume_count >= 3
              ? exhausted
              : interrupted;
        await db.query(
          `UPDATE ai_jobs SET state = 'failed', error_status = $2, error_message = $3,
           result = jsonb_build_object('assistant_run', jsonb_build_object('token_estimate',
             coalesce((run_state->'state'->>'token_estimate')::int, (result->'assistant_run'->>'token_estimate')::int, 0))),
           run_state = NULL, lease_until = NULL, claimed_by = NULL,
           progress = jsonb_build_object('label', $3::text), heartbeat_at = $4 WHERE id = $1`,
          [row.id, row.was === "waiting" ? 410 : 503, message, now],
        );
        ended.push(row);
        await notifyAssistantAway(db, row.id, "failed");
        await recordNightRun(db, row.id, message, "pending");
      }
    }
    const ids = ended.map((row) => row.id);
    if (ids.length) {
      await db.query(
        `UPDATE agent_routines SET current_job_id = NULL, claimed_at = NULL,
         last_result = $2::jsonb, updated_at = now() WHERE current_job_id = ANY($1::uuid[])`,
        [ids, JSON.stringify({ error: "The scheduled run was interrupted." })],
      );
      await db.query(
        `UPDATE goals_checkins SET status = 'failed', claimed_at = now()
         WHERE job_id = ANY($1::uuid[]) AND status <> 'done'`,
        [ids],
      );
    }
    return { ended, resumed };
  });
  for (const row of changed.ended) {
    const envelope = envelopeOf(row.run_state);
    if (!envelope) continue;
    await finishChatTurn(
      row.user_id,
      envelope.request.chat_id,
      envelope.request.turn_id,
      {
        summary:
          row.was === "waiting"
            ? expired
            : row.resume_count >= 3
              ? exhausted
              : interrupted,
        trace: [],
        failed: true,
      },
    ).catch(() => undefined);
  }
  return changed.ended.map((row) => row.id);
}

/** Validate the job state before any polling or resume action uses it. */
export const assistantRunStateFor = (value: unknown) => envelopeOf(value);

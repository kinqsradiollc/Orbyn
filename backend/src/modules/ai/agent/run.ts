import { randomUUID } from "node:crypto";
import { type ChatScope, type ChatTurn, type SystemRole } from "@orbyn/core";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { execute } from "../../../capabilities/execute.js";
import { registry } from "../../../capabilities/index.js";
import { checkPlan, type PlanStep } from "../../../capabilities/plan-run.js";
import { policy, type Principal } from "../../../capabilities/policy.js";
import { pool, transaction } from "../../../db/pool.js";
import type { Queryable } from "../../../db/pool.js";
import { keptOutFor } from "../../../lib/assistant-off.js";
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
import { checkMergedPlan } from "./checker.js";
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
  .object({ answer: z.string().trim().min(1).max(4000) })
  .strict();
const approvalInput = z
  .object({
    approved: z.boolean(),
    scope: z.enum(["once", "goal", "routine", "always"]).default("once"),
  })
  .strict();

export type AssistantAutomation = {
  /** A task handed to the agent (W3) carries its item's id. */
  kind: "idea" | "goal" | "routine" | "task";
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

type RunEnvelope = {
  version: 1;
  request: PersistedChatRequest;
  state: LeadState;
};

/** The initial checkpoint is committed with the queued job, before any AI call. */
export function initialAssistantRun(
  request: PersistedChatRequest,
): RunEnvelope {
  return { version: 1, request, state: newState(request.message) };
}

/** Stop handles of the runs on this copy, by job. */
const activeRuns = new Map<string, () => void>();

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
        request.automation?.kind === rule.scope &&
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
      request.automation?.kind === "goal" &&
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
async function principalFor(user: UserRow, request: PersistedChatRequest) {
  const principal = await assistantPrincipal(user, { refusePaused: true });
  if (request.automation?.kind === "idea")
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
      .map((step) => checkPlanStep(step));
    return {
      version: 1,
      request: request as unknown as PersistedChatRequest,
      state: {
        ...newState(request.message),
        ...(state as unknown as Partial<LeadState>),
        plan: parsedPlan,
        selected_steps: parsedSelected,
        token_budget: Math.max(
          typeof state.token_budget === "number" ? state.token_budget : 0,
          LEAD_TOKEN_BUDGET,
        ),
        reports: Array.isArray(state.reports)
          ? (state.reports as LeadState["reports"])
          : [],
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

async function contextFor(user: UserRow, request: PersistedChatRequest) {
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
    recallMemory(pool, user.id, request.message, 4000, [...keptOut.projects]),
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
  const values = [jobId, JSON.stringify(envelope), JSON.stringify(progress)];
  const previous = saveChains.get(jobId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await pool.query(
        `UPDATE ai_jobs SET run_state = $2::jsonb, progress = $3::jsonb,
           heartbeat_at = now(), lease_until = now() + interval '60 seconds'
           WHERE id = $1 AND state = 'running'`,
        values,
      );
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
  const beat = () =>
    void pool
      .query(
        "UPDATE ai_jobs SET heartbeat_at = now(), lease_until = now() + interval '60 seconds' WHERE id = $1 AND state = 'running'",
        [jobId],
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
  await finishChatTurn(user.id, request.chat_id, request.turn_id, {
    summary,
    outcome,
    ...(outcome === "applied" && typeof extra.plan_job === "string"
      ? { changesJob: extra.plan_job }
      : {}),
    trace: [],
  });
  const result = {
    answer: summary,
    chat_id: request.chat_id,
    turn_id: request.turn_id,
    trace:
      (
        await pool.query<{ trace: unknown }>(
          "SELECT trace FROM ai_chats WHERE id = $1 AND user_id = $2",
          [request.chat_id, user.id],
        )
      ).rows[0]?.trace ?? [],
    assistant_run: {
      reports: state.reports.map(({ steps, ...report }) => ({
        ...report,
        step_ids: steps.map((step) => step.id),
      })),
      selected_step_ids: state.selected_steps.map((step) => step.id),
      outcome,
      ...extra,
    },
  };
  await pool.query(
    `UPDATE ai_jobs SET state = 'done', result = $2::jsonb, run_state = NULL,
       progress = $3::jsonb, heartbeat_at = now() WHERE id = $1`,
    [
      jobId,
      JSON.stringify(result),
      JSON.stringify({ label: "Answer ready", outcome }),
    ],
  );
  if (
    request.automation?.kind === "goal" &&
    request.automation.id &&
    request.automation.week_of
  ) {
    await pool.query(
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
    await pool.query(
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
  } else if (request.automation?.kind === "routine" && request.automation.id) {
    await pool.query(
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
  } else if (request.automation?.kind === "task" && request.automation.id) {
    await finishTask(
      jobId,
      user,
      request.automation.id,
      summary,
      outcome === "applied" ||
        (outcome === "info" && !extra.stopped && !extra.timed_out)
        ? "done"
        : "needs_you",
    );
  } else if (
    request.automation?.kind === "idea" &&
    request.automation.local_day
  ) {
    const proposalId =
      typeof extra.proposal_id === "string"
        ? extra.proposal_id.replace(/^proposal:/, "")
        : null;
    if (proposalId) {
      await pool.query(
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
      await pool.query(
        `UPDATE proposals SET kind = 'idea' WHERE id = $1 AND user_id = $2 AND source = 'agent'`,
        [proposalId, user.id],
      );
    }
    await pool.query(
      `INSERT INTO assistant_idea_days (user_id, local_day, slot, finished_at)
       VALUES ($1, $2::date, $3, now())
       ON CONFLICT (user_id, local_day, slot) DO UPDATE SET finished_at = now()`,
      [user.id, request.automation.local_day, request.automation.slot ?? 1],
    );
  }
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
) {
  const text = summary
    .replace(
      /\n+(I’ve put these changes in Review for you|Done — you can undo this change)\.?\s*$/,
      "",
    )
    .trim();
  const [line] = ideaText(text);
  const back = (
    await pool.query<{
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
  await pool.query(
    `INSERT INTO item_updates (item_id, user_id, body, via_grant_id)
     VALUES ($1, $2, $3, $4)`,
    [itemId, user.id, note.slice(0, 1000), back.grant_id],
  );
  await pool.query(
    `UPDATE items SET updates_count = updates_count + 1, last_update_at = now()
      WHERE id = $1`,
    [itemId],
  );
  await announceTo(
    pool,
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
) {
  if (request.automation?.kind !== "task" || !request.automation.id) return;
  await pool
    .query(
      `UPDATE items SET agent_state = $3, agent_result = $4, updated_at = now()
        WHERE id = $1 AND agent_job_id = $2 AND agent_grant_id IS NOT NULL
          AND agent_state IS DISTINCT FROM $3`,
      [request.automation.id, jobId, state, result?.slice(0, 300) ?? null],
    )
    .catch(() => undefined);
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
}): Promise<string | null> {
  const row = (
    await pool.query<{ id: string; name: string; role: SystemRole }>(
      `SELECT id, name, role FROM users WHERE id = $1 AND NOT disabled`,
      [input.userId],
    )
  ).rows[0];
  if (!row) return null;
  const user = row as UserRow;
  const chatId = randomUUID();
  const turnId = randomUUID();
  const history = await beginChatTurn(user, {
    chatId,
    turnId,
    message: input.message,
    scope: null,
    legacyHistory: [],
    origin: input.automation.kind,
    title: input.title,
  });
  const request: PersistedChatRequest = {
    message: input.message,
    history,
    timezone: input.timezone,
    chat_id: chatId,
    turn_id: turnId,
    scope: null,
    automation: input.automation,
  };
  const jobId = await transaction(async (db) => {
    const row = (
      await db.query<{ id: string }>(
        `INSERT INTO ai_jobs (user_id, progress, run_state, chat_id, turn_id, state)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, 'queued') RETURNING id`,
        [
          user.id,
          JSON.stringify({ label: "Starting a scheduled run" }),
          JSON.stringify({
            version: 1,
            request,
            state: newState(input.message),
          }),
          chatId,
          turnId,
        ],
      )
    ).rows[0];
    if (row && input.onQueued) await input.onQueued(db, row.id);
    return row?.id ?? null;
  });
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
  const progress = {
    label:
      envelope.state.waiting?.kind === "person"
        ? "Waiting for your answer"
        : "Review these changes",
    waiting: envelope.state.waiting,
  };
  await settleSaves(jobId);
  const parked = await pool.query(
    `UPDATE ai_jobs SET state = 'waiting', run_state = $2::jsonb,
       progress = $3::jsonb, heartbeat_at = now()
     WHERE id = $1 AND state = 'running' AND NOT cancel_requested`,
    [jobId, JSON.stringify(envelope), JSON.stringify(progress)],
  );
  if (!parked.rowCount) return false;
  await markTask(
    jobId,
    request,
    "needs_you",
    envelope.state.waiting?.question ?? null,
  );
  await transaction(async (db) => {
    const row = (
      await db.query<{ turns: unknown }>(
        "SELECT turns FROM ai_chats WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [request.chat_id, user.id],
      )
    ).rows[0];
    const waiting = envelope.state.waiting;
    if (!row || !waiting) return;
    const turns = Array.isArray(row.turns) ? row.turns : [];
    if (turns.some((turn) => jsonObject(turn).turn_id === waiting.id)) return;
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
    turns.push({
      role: "assistant",
      text: text.slice(0, 12_000),
      turn_id: waiting.id,
    });
    await db.query(
      "UPDATE ai_chats SET turns = $3::jsonb, last_used_at = now() WHERE id = $1 AND user_id = $2",
      [request.chat_id, user.id, JSON.stringify(turns.slice(-200))],
    );
  });
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
) {
  const checked = await checkMergedPlan(pool, principal, state.selected_steps);
  if (!checked.steps.length)
    return { applied: false, structured: null, why: [] as string[] };
  const result = await execute(
    registry,
    principal,
    "apply_plan",
    {
      steps: checked.steps,
      summary: state.answer?.slice(0, 300) || "Assistant plan",
      client_ref: `assistant-${jobId}`,
    },
    {
      primary: true,
      requestId: jobId,
      asking: reviewed ? "approved" : "collect",
      reviewed:
        reviewed ||
        (await approvalScopeCovers(user.id, principal, request, checked.steps)),
      write: (run) => transaction(run),
    },
  );
  if (result.ask)
    return {
      applied: false,
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
): LeadWaiting {
  return {
    kind: "approval",
    id: randomUUID(),
    question,
    detail,
    steps: state.selected_steps,
    summary: state.answer ?? "",
    change_kinds: [...new Set(state.selected_steps.map(changeKind))],
    ...(request.automation?.kind === "goal" ||
    request.automation?.kind === "routine"
      ? {
          automation_kind: request.automation.kind,
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
  await finishChatTurn(user.id, request.chat_id, request.turn_id, {
    summary: message,
    trace: [],
    failed: true,
  }).catch(() => undefined);
  await pool
    .query(
      `UPDATE ai_jobs SET state = 'failed', error_status = 502,
       error_message = $2, run_state = NULL, progress = $3::jsonb,
       heartbeat_at = now() WHERE id = $1`,
      [
        jobId,
        message,
        JSON.stringify({ label: "This run could not be completed" }),
      ],
    )
    .catch(() => undefined);
  if (
    request.automation?.kind === "goal" &&
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
  if (request.automation?.kind === "task" && request.automation.id)
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
  if (request.automation?.kind === "routine" && request.automation.id)
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
  let stopReason = null as "stop" | "deadline" | null;
  const interrupt = (reason: "stop" | "deadline") => {
    stopReason ??= reason;
    controller.abort();
  };
  const stopHandle = () => interrupt("stop");
  activeRuns.set(jobId, stopHandle);
  const deadline = setTimeout(
    () => interrupt("deadline"),
    assistantRunLimits.maxRunMs,
  );
  const checkCancel = () =>
    pool
      .query<{ cancel_requested: boolean }>(
        "SELECT cancel_requested FROM ai_jobs WHERE id = $1",
        [jobId],
      )
      .then((result) => {
        if (result.rows[0]?.cancel_requested) interrupt("stop");
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
  // A stop that reached this copy while it parked the job ends it instead.
  const parked = async () =>
    (await waitFor(jobId, envelope, request, user, log)) &&
    stopReason !== "stop";

  try {
    const ai = await resolveAi();
    if (!ai) throw new Error("The AI assistant is not set up yet.");
    principal = await principalFor(user, request);
    const prepared = await contextFor(user, request);
    envelope.state.memory = prepared.memory;
    envelope.state.context = scoped ?? prepared.snapshot;
    const currentMessage = envelope.state.answer_to_person || request.message;
    await markTask(jobId, request, "working");
    await saveProgress(jobId, envelope, {
      label: "Starting the lead assistant",
      step: envelope.state.lead_steps,
    });
    await checkCancel();

    let fallback = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (controller.signal.aborted) throw new Error("stopped");
      const result = await runLead({
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
        allowChanges:
          request.automation?.kind === "idea" ||
          mayChange(envelope.state.original_request),
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
            log.warn({ err: error }, "Assistant progress could not be saved"),
          );
        },
        signal: controller.signal,
      });
      fallback = result.state.answer ?? "";
      if (result.state.waiting) {
        if (request.automation?.kind === "idea") {
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
        applyPlanAttempted = true;
        applied = await approvePlan(
          user,
          jobId,
          principal,
          result.state,
          false,
          request,
        );
      } catch (error) {
        // The apply ran in one transaction that rolled back: nothing changed.
        applyPlanAttempted = false;
        if (controller.signal.aborted) throw error;
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
          request.automation?.kind !== "idea"
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
  }
}

/** Persist an answer to ask_person and resume the same run. */
export async function answerAssistantQuestion(
  jobId: string,
  user: UserRow,
  value: unknown,
  log: FastifyBaseLogger,
) {
  const { answer } = pendingInput.parse(value);
  const loaded = await transaction(async (db) => {
    const row = (
      await db.query<{ run_state: unknown }>(
        `SELECT run_state FROM ai_jobs WHERE id = $1 AND user_id = $2
          AND state = 'waiting' FOR UPDATE`,
        [jobId, user.id],
      )
    ).rows[0];
    const envelope = envelopeOf(row?.run_state);
    if (!envelope || envelope.state.waiting?.kind !== "person")
      throw new Error("This run is not waiting for an answer.");
    const question = envelope.state.waiting;
    // Free text is allowed so the person can explain a different preference;
    // the lead is told when the answer is none of the offered choices.
    const offered =
      !question.choices.length ||
      question.choices.some(
        (choice) => choice.toLowerCase() === answer.toLowerCase(),
      );
    envelope.state.waiting = null;
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
      `UPDATE ai_jobs SET state = 'running', run_state = $3::jsonb,
         progress = $4::jsonb, cancel_requested = false, heartbeat_at = now()
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
  void runAssistantJob(jobId, user, loaded.request, undefined, loaded, log);
  return { accepted: true, job_id: jobId };
}

/** Apply or decline the one checked plan shown in the assistant's chat card. */
export async function answerAssistantApproval(
  jobId: string,
  user: UserRow,
  value: unknown,
  log: FastifyBaseLogger,
) {
  const { approved, scope } = approvalInput.parse(value);
  const row = (
    await pool.query<{ state: string; run_state: unknown }>(
      "SELECT state, run_state FROM ai_jobs WHERE id = $1 AND user_id = $2",
      [jobId, user.id],
    )
  ).rows[0];
  if (row && row.state !== "waiting") throw new Error("Already answered.");
  const seen = envelopeOf(row?.run_state);
  if (!seen || seen.state.waiting?.kind !== "approval")
    throw new Error("This run is not waiting for plan approval.");
  const card = seen.state.waiting;
  // Checked before the claim, so a refusal leaves the card answerable.
  const principal = approved ? await principalFor(user, seen.request) : null;
  if (approved && scope !== "once") {
    if (!seen.state.selected_steps.length)
      throw new Error("This plan has no changes to remember.");
    if (
      (scope === "goal" || scope === "routine") &&
      (seen.request.automation?.kind !== scope || !seen.request.automation.id)
    )
      throw new Error(
        `This approval can only be saved for the current ${scope}.`,
      );
  }

  // The claim: only one answer moves this card off 'waiting'.
  const claimed = (
    await pool.query<{ run_state: unknown }>(
      `UPDATE ai_jobs SET state = 'running', progress = $4::jsonb,
         heartbeat_at = now()
       WHERE id = $1 AND user_id = $2 AND state = 'waiting'
         AND run_state->'state'->'waiting'->>'id' = $3
       RETURNING run_state`,
      [
        jobId,
        user.id,
        card.id,
        JSON.stringify({
          label: approved
            ? "Checking and applying the approved plan"
            : "Holding the changes",
        }),
      ],
    )
  ).rows[0];
  const envelope = envelopeOf(claimed?.run_state);
  if (!envelope || envelope.state.waiting?.kind !== "approval")
    throw new Error("Already answered.");
  const { request, state } = envelope;
  state.waiting = null;
  if (!approved) {
    await finishJob(
      jobId,
      user,
      request,
      state,
      `${leadSummary(state, "")}\n\nI held the changes. Nothing was applied.`,
      "discarded",
    );
    return { accepted: true, job_id: jobId };
  }

  if (scope !== "once") {
    const kinds = [...new Set(state.selected_steps.map(changeKind))];
    const saved = await assistantApprovalScopes(user.id);
    for (const kind of kinds)
      saved[kind] =
        scope === "always" ? "always" : { scope, id: request.automation!.id! };
    await pool.query(
      `UPDATE agent_grants SET approval_scopes = $2::jsonb
        WHERE user_id = $1 AND kind = 'assistant' AND revoked_at IS NULL`,
      [user.id, JSON.stringify(saved)],
    );
  }

  void (async () => {
    const stopHeartbeat = keepAlive(jobId);
    try {
      const applied = await approvePlan(
        user,
        jobId,
        principal!,
        state,
        true,
        request,
      );
      const structured = applied.structured as {
        status?: string;
        job?: string | null;
        proposal_id?: string;
        pending?: { proposal_id?: string } | null;
      } | null;
      const status = structured?.status;
      const summary =
        status === "pending_review"
          ? `${leadSummary(state, "")}\n\nI’ve put these changes in Review for you.`
          : applied.applied
            ? `${leadSummary(state, "")}\n\nDone — you can undo this change.`
            : `${leadSummary(state, "")}\n\nI held the changes. Nothing was applied.`;
      await finishJob(
        jobId,
        user,
        request,
        state,
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
    } catch (error) {
      blockRejectedPlan(
        state,
        error instanceof Error
          ? error.message
          : "The approved plan failed its checks.",
        "The code checker blocked the approved plan",
      );
      await saveProgress(jobId, envelope, {
        label: "Revising a blocked plan",
        step: state.lead_steps,
      }).catch(() => undefined);
      void runAssistantJob(jobId, user, request, undefined, envelope, log);
    } finally {
      stopHeartbeat();
    }
  })();
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
 * Fail assistant jobs no copy is working on any more: running ones whose
 * heartbeat stopped (a crash or a restart) and questions or approvals left
 * unanswered for a week. Their automations are freed so they can run again.
 * Returns the ids of the jobs it ended. Safe to call from several copies.
 */
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

export async function failStaleAssistantJobs(
  now: Date = new Date(),
): Promise<string[]> {
  const interrupted =
    "The assistant was interrupted by a server restart. Please ask again.";
  const expired = "This request expired before it was answered.";
  const ended = await transaction(async (db) => {
    const rows = (
      await db.query<{
        id: string;
        user_id: string;
        run_state: unknown;
        was: string;
      }>(
        `WITH old AS (
           SELECT id, user_id, run_state, state AS was FROM ai_jobs
            WHERE (state = 'running'
                   AND heartbeat_at < $1::timestamptz - make_interval(secs => $2::double precision / 1000))
               OR (state = 'waiting'
                   AND heartbeat_at < $1::timestamptz - make_interval(secs => $3::double precision / 1000))
            FOR UPDATE SKIP LOCKED
         ), ended AS (
           UPDATE ai_jobs j SET state = 'failed',
                  error_status = CASE WHEN old.was = 'waiting' THEN 410 ELSE 503 END,
                  error_message = CASE WHEN old.was = 'waiting' THEN $5 ELSE $4 END,
                  run_state = NULL,
                  progress = jsonb_build_object('label',
                    CASE WHEN old.was = 'waiting' THEN 'Expired' ELSE 'Interrupted' END),
                  heartbeat_at = $1::timestamptz
             FROM old WHERE j.id = old.id
           RETURNING j.id
         )
         SELECT old.id, old.user_id, old.run_state, old.was
           FROM old JOIN ended USING (id)`,
        [now, ASSISTANT_STALE_MS * 3, WAITING_EXPIRES_MS, interrupted, expired],
      )
    ).rows;
    const ids = rows.map((row) => row.id);
    if (!ids.length) return rows;
    await db.query(
      `UPDATE agent_routines SET current_job_id = NULL, claimed_at = NULL,
         last_result = $2::jsonb, updated_at = now()
       WHERE current_job_id = ANY($1::uuid[])`,
      [ids, JSON.stringify({ error: "The scheduled run was interrupted." })],
    );
    await db.query(
      `UPDATE goals_checkins SET status = 'failed', claimed_at = now()
        WHERE job_id = ANY($1::uuid[]) AND status <> 'done'`,
      [ids],
    );
    return rows;
  });
  for (const row of ended) {
    const envelope = envelopeOf(row.run_state);
    if (!envelope) continue;
    await finishChatTurn(
      row.user_id,
      envelope.request.chat_id,
      envelope.request.turn_id,
      {
        summary: row.was === "waiting" ? expired : interrupted,
        trace: [],
        failed: true,
      },
    ).catch(() => undefined);
  }
  return ended.map((row) => row.id);
}

/** Validate the job state before any polling or resume action uses it. */
export const assistantRunStateFor = (value: unknown) => envelopeOf(value);

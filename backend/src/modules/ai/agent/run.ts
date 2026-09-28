import { randomUUID } from "node:crypto";
import {
  type ChatScope,
  type ChatTurn,
  type AssistantChangeKind,
  type SystemRole,
} from "@orbyn/core";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { execute } from "../../../capabilities/execute.js";
import { registry } from "../../../capabilities/index.js";
import { checkPlan, type PlanStep } from "../../../capabilities/plan-run.js";
import { policy, type Principal } from "../../../capabilities/policy.js";
import { pool, transaction } from "../../../db/pool.js";
import type { Queryable } from "../../../db/pool.js";
import { keptOutFor } from "../../../lib/assistant-off.js";
import { recallMemory } from "../../memory/service.js";
import type { UserRow } from "../../../lib/auth.js";
import type { Proposal } from "@orbyn/core";
import type { ResolvedAi } from "../providers/adapters.js";
import { resolveAi } from "../providers/resolve.js";
import { mayChange } from "../guards.js";
import { overview, type AgentContext } from "./tools.js";
import { runAgent, type AgentTrace, type AgentTraceEvent } from "./loop.js";
import { runLead, LEAD_TOKEN_BUDGET, type LeadState } from "./lead.js";
import { checkMergedPlan } from "./checker.js";
import { appendChatTrace, beginChatTurn, finishChatTurn } from "../chats.js";
import {
  assistantApprovalScopes,
  assistantPrincipal,
} from "../../agents/assistant.js";

const MAX_RUN_MS = 600_000;
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
  kind: "idea" | "goal" | "routine";
  id?: string;
  local_day?: string;
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

const activeRuns = new Map<string, AbortController>();

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
    await pool.query<{ team_id: string | null }>(
      `SELECT team_id FROM items WHERE id = ANY($1::uuid[])
       UNION SELECT team_id FROM docs WHERE id = ANY($1::uuid[])
       UNION SELECT team_id FROM projects WHERE id = ANY($1::uuid[])`,
      [ids],
    )
  ).rows;
  return rows.length ? [...new Set(rows.map((row) => row.team_id))] : [null];
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

async function saveProgress(
  jobId: string,
  envelope: RunEnvelope,
  progress: unknown,
) {
  await pool.query(
    `UPDATE ai_jobs SET run_state = $2::jsonb, progress = $3::jsonb,
       heartbeat_at = now() WHERE id = $1 AND state = 'running'`,
    [jobId, JSON.stringify(envelope), JSON.stringify(progress)],
  );
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
  await finishChatTurn(user.id, request.chat_id, request.turn_id, {
    summary,
    outcome,
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
      `UPDATE goals SET progress = $3::jsonb, updated_at = now()
        WHERE id = $1 AND user_id = $2`,
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
        `INSERT INTO assistant_ideas (user_id, local_day, title, summary, proposal_id)
         VALUES ($1, $2::date, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          user.id,
          request.automation.local_day,
          summary.split(/\n/)[0].slice(0, 160) || "A useful next step",
          summary.slice(0, 2000),
          proposalId,
        ],
      );
      await pool.query(
        `UPDATE proposals SET kind = 'idea' WHERE id = $1 AND user_id = $2 AND source = 'agent'`,
        [proposalId, user.id],
      );
    }
    await pool.query(
      `INSERT INTO assistant_idea_days (user_id, local_day, finished_at)
       VALUES ($1, $2::date, now())
       ON CONFLICT (user_id, local_day) DO UPDATE SET finished_at = now()`,
      [user.id, request.automation.local_day],
    );
  }
}

/** Persist and start a background lead run for a worker-owned task. */
export async function startAssistantAutomation(input: {
  userId: string;
  message: string;
  timezone: string;
  automation: AssistantAutomation;
  logger?: FastifyBaseLogger;
  onQueued?: (db: Queryable, jobId: string) => Promise<void>;
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
        `INSERT INTO ai_jobs (user_id, progress, run_state)
         VALUES ($1, $2::jsonb, $3::jsonb) RETURNING id`,
        [
          user.id,
          JSON.stringify({ label: "Starting a scheduled run" }),
          JSON.stringify({
            version: 1,
            request,
            state: newState(input.message),
          }),
        ],
      )
    ).rows[0];
    if (row && input.onQueued) await input.onQueued(db, row.id);
    return row?.id ?? null;
  });
  if (!jobId) return null;
  void runAssistantJob(
    jobId,
    user,
    request,
    undefined,
    undefined,
    input.logger,
  );
  return jobId;
}

async function waitFor(
  jobId: string,
  envelope: RunEnvelope,
  request: PersistedChatRequest,
  user: UserRow,
  logger: FastifyBaseLogger,
) {
  const progress = {
    label:
      envelope.state.waiting?.kind === "person"
        ? "Waiting for your answer"
        : "Review these changes",
    waiting: envelope.state.waiting,
  };
  await pool.query(
    `UPDATE ai_jobs SET state = 'waiting', run_state = $2::jsonb,
       progress = $3::jsonb, heartbeat_at = now() WHERE id = $1`,
    [jobId, JSON.stringify(envelope), JSON.stringify(progress)],
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

async function forcedStopAnswer(
  ai: ResolvedAi,
  context: AgentContext,
  state: LeadState,
  workStatus: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const systemPrompt = [
    `You are ${context.identity?.name ?? "Orbyn"}, the lead assistant. The person stopped the run.`,
    "In one short message, say what was already done, what happened to completed staged work, and what remains. No tools are available. Do not claim a change happened unless the recorded result says so.",
    `Completed work status: ${workStatus}`,
    `Specialist reports: ${JSON.stringify(state.reports.map(({ steps, ...r }) => ({ ...r, staged_step_ids: steps.map((step) => step.id) }))).slice(0, 12_000)}`,
  ].join("\n\n");
  const result = await runAgent(
    ai,
    context,
    "Explain the work so far and what remains after the stop.",
    [],
    {},
    log,
    undefined,
    {
      systemPrompt,
      tools: [],
      maxSteps: 1,
      maxToolCallsPerStep: 1,
      forceToolLoop: true,
    },
  );
  return result.summary || "I stopped. No staged changes were applied.";
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
  activeRuns.set(jobId, controller);
  const deadline = setTimeout(() => controller.abort(), MAX_RUN_MS);
  const pollCancel = setInterval(() => {
    pool
      .query<{ cancel_requested: boolean }>(
        "SELECT cancel_requested FROM ai_jobs WHERE id = $1",
        [jobId],
      )
      .then((result) => {
        if (result.rows[0]?.cancel_requested) controller.abort();
      })
      .catch(() => undefined);
  }, 1000);
  pollCancel.unref?.();
  void pool
    .query<{ cancel_requested: boolean }>(
      "SELECT cancel_requested FROM ai_jobs WHERE id = $1",
      [jobId],
    )
    .then((result) => {
      if (result.rows[0]?.cancel_requested) controller.abort();
    })
    .catch(() => undefined);
  const trace = traceWriter(user.id, request, log);
  let applyPlanAttempted = false;
  let appliedStatus: "applied" | "pending" | "not_applied" = "not_applied";
  let envelope: RunEnvelope = loaded ?? {
    version: 1,
    request,
    state: newState(request.message),
  };

  try {
    const ai = await resolveAi();
    if (!ai) throw new Error("The AI assistant is not set up yet.");
    const principal = await assistantPrincipal(user);
    if (request.automation?.kind === "idea")
      principal.trust = { level: "suggest", spaces: {}, acts_alone: [] };
    const prepared = await contextFor(user, request);
    envelope.state.memory = prepared.memory;
    envelope.state.context = scoped ?? prepared.snapshot;
    const currentMessage = envelope.state.answer_to_person || request.message;
    await saveProgress(jobId, envelope, {
      label: "Starting the lead assistant",
      step: envelope.state.lead_steps,
    });
    const cancelled = await pool.query<{ cancel_requested: boolean }>(
      "SELECT cancel_requested FROM ai_jobs WHERE id = $1",
      [jobId],
    );
    if (cancelled.rows[0]?.cancel_requested) controller.abort();

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
        await waitFor(jobId, envelope, request, user, log);
        if (controller.signal.aborted) throw new Error("stopped");
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
      try {
        if (controller.signal.aborted) throw new Error("stopped");
        applyPlanAttempted = true;
        const applied = await approvePlan(
          user,
          jobId,
          principal,
          result.state,
          false,
          request,
        );
        if (
          !applied.applied &&
          applied.structured === null &&
          (applied.why.length || "what" in applied)
        ) {
          result.state.waiting = {
            kind: "approval",
            id: randomUUID(),
            question: "Do you want me to apply this plan?",
            detail: [
              ...(applied.why ?? []),
              ...("what" in applied ? (applied.what ?? []) : []),
            ].join("\n"),
            steps: result.state.selected_steps,
            summary: result.state.answer,
            change_kinds: [
              ...new Set(result.state.selected_steps.map(changeKind)),
            ],
            ...(request.automation?.kind === "goal" ||
            request.automation?.kind === "routine"
              ? {
                  automation_kind: request.automation.kind,
                  automation_id: request.automation.id,
                }
              : {}),
          };
          await trace.flush();
          await waitFor(jobId, envelope, request, user, log);
          if (controller.signal.aborted) throw new Error("stopped");
          return;
        }
        const structured = applied.structured as {
          status?: string;
          job?: string | null;
          proposal_id?: string;
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
            ? `${leadSummary(result.state, fallback)}\n\nI placed the changes in Review for you.`
            : applied.applied
              ? `${leadSummary(result.state, fallback)}\n\nI applied the checked plan as one undoable change.`
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
            ...(typeof structured?.proposal_id === "string"
              ? { proposal_id: structured.proposal_id }
              : {}),
          },
        );
        return;
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "The checked plan could not be applied.";
        result.state.reports.push({
          specialist: "planner",
          task_id: `checker-${randomUUID().slice(0, 8)}`,
          status: "blocked",
          summary: "The code checker blocked this combined plan.",
          findings: [reason],
          steps: [],
          open_questions: [],
        });
        result.state.plan = result.state.plan.filter(
          (step) =>
            !result.state.selected_steps.some(
              (selected) => selected.id === step.id,
            ),
        );
        result.state.selected_steps = [];
        result.state.answer = null;
        result.state.answer_to_person = `The code checker blocked the plan: ${reason}`;
        await saveProgress(jobId, envelope, {
          label: "Revising a blocked plan",
          step: result.state.lead_steps,
        });
      }
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
    if (controller.signal.aborted) {
      const stoppedOnApproval = envelope.state.waiting?.kind === "approval";
      envelope.state.waiting = null;
      let workStatus = stoppedOnApproval
        ? "The run stopped while waiting for your approval. Those changes were not applied."
        : applyPlanAttempted
          ? "A checked plan was already being applied when the stop arrived. Do not say whether it committed; direct the person to Review and the change history."
          : "No staged changes were applied yet.";
      let outcome: "info" | "applied" | "pending" | "discarded" = "discarded";
      let extra: Record<string, unknown> = { stopped: true };
      try {
        const ai = await resolveAi();
        const principal = await assistantPrincipal(user);
        if (
          !stoppedOnApproval &&
          !applyPlanAttempted &&
          envelope.state.plan.length
        ) {
          envelope.state.selected_steps = envelope.state.plan;
          envelope.state.answer =
            "The run was stopped after the completed specialist work was checked.";
          applyPlanAttempted = true;
          const applied = await approvePlan(
            user,
            jobId,
            principal,
            envelope.state,
            false,
            request,
          );
          if (
            !applied.applied &&
            applied.structured === null &&
            (applied.why.length || "what" in applied)
          ) {
            envelope.state.waiting = {
              kind: "approval",
              id: randomUUID(),
              question:
                "The run stopped with completed work ready. Do you want me to apply it?",
              detail: [
                ...(applied.why ?? []),
                ...("what" in applied ? (applied.what ?? []) : []),
              ].join("\n"),
              steps: envelope.state.selected_steps,
              summary: envelope.state.answer,
              change_kinds: [
                ...new Set(envelope.state.selected_steps.map(changeKind)),
              ],
            };
            await trace.flush();
            await waitFor(jobId, envelope, request, user, log);
            return;
          }
          const structured = applied.structured as {
            status?: string;
            job?: string | null;
          } | null;
          if (structured?.status === "pending_review") {
            appliedStatus = "pending";
            outcome = "pending";
            workStatus =
              "Completed work was sent to Review and has not been applied.";
            extra = { stopped: true, plan_job: structured.job ?? null };
          } else if (applied.applied) {
            appliedStatus = "applied";
            outcome = "applied";
            workStatus =
              "The checked completed work was applied as one undoable change.";
            extra = { stopped: true };
          } else {
            workStatus =
              "The run stopped. Its completed work remained staged and was not applied.";
          }
        } else if (appliedStatus === "applied") {
          outcome = "applied";
          workStatus =
            "The checked plan completed as one undoable change before the stop was handled.";
        } else if (appliedStatus === "pending") {
          outcome = "pending";
          workStatus = "The checked plan is waiting in Review.";
        }
        if (ai) {
          const prepared = await contextFor(user, request);
          const message = await forcedStopAnswer(
            ai,
            prepared.context,
            envelope.state,
            workStatus,
            log,
          );
          await trace.flush();
          await finishJob(
            jobId,
            user,
            request,
            envelope.state,
            message,
            outcome,
            extra,
          );
          return;
        }
      } catch {
        // A stop remains complete even if the provider is unavailable.
      }
      await trace.flush();
      await finishJob(
        jobId,
        user,
        request,
        envelope.state,
        workStatus === "No staged changes were applied yet."
          ? "I stopped before any staged changes were applied."
          : `I stopped. ${workStatus}`,
        outcome,
        extra,
      );
    } else {
      log.error({ event: "assistant_run_failed" }, "Assistant run failed");
      await finishChatTurn(user.id, request.chat_id, request.turn_id, {
        summary:
          "This turn could not be completed. Please ask again when ready.",
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
            "This run could not be completed. Please try again.",
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
  } finally {
    clearTimeout(deadline);
    clearInterval(pollCancel);
    activeRuns.delete(jobId);
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
    if (question.choices.length && !question.choices.includes(answer)) {
      // Free text is allowed so the person can explain a different preference.
    }
    envelope.state.waiting = null;
    envelope.state.answer_to_person = answer;
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
    await pool.query<{ run_state: unknown }>(
      `SELECT run_state FROM ai_jobs WHERE id = $1 AND user_id = $2 AND state = 'waiting'`,
      [jobId, user.id],
    )
  ).rows[0];
  const envelope = envelopeOf(row?.run_state);
  if (!envelope || envelope.state.waiting?.kind !== "approval")
    throw new Error("This run is not waiting for plan approval.");
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
    if (!kinds.length) throw new Error("This plan has no changes to remember.");
    if (scope === "goal" || scope === "routine") {
      if (request.automation?.kind !== scope || !request.automation.id)
        throw new Error(
          `This approval can only be saved for the current ${scope}.`,
        );
    }
    await assistantPrincipal(user);
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

  await pool.query(
    `UPDATE ai_jobs SET state = 'running', progress = $3::jsonb,
       heartbeat_at = now() WHERE id = $1 AND user_id = $2`,
    [
      jobId,
      user.id,
      JSON.stringify({ label: "Checking and applying the approved plan" }),
    ],
  );
  void (async () => {
    try {
      const principal = await assistantPrincipal(user);
      const applied = await approvePlan(
        user,
        jobId,
        principal,
        state,
        true,
        request,
      );
      const structured = applied.structured as {
        status?: string;
        job?: string | null;
        proposal_id?: string;
      } | null;
      const status = structured?.status;
      const summary =
        status === "pending_review"
          ? `${leadSummary(state, "")}\n\nI placed the changes in Review.`
          : applied.applied
            ? `${leadSummary(state, "")}\n\nI applied the checked plan as one undoable change.`
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
        },
      );
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "The approved plan failed its checks.";
      state.reports.push({
        specialist: "planner",
        task_id: `checker-${randomUUID().slice(0, 8)}`,
        status: "blocked",
        summary: "The code checker blocked this combined plan.",
        findings: [reason],
        steps: [],
        open_questions: [],
      });
      state.plan = state.plan.filter(
        (step) =>
          !state.selected_steps.some((selected) => selected.id === step.id),
      );
      state.selected_steps = [];
      state.answer = null;
      state.answer_to_person = `The code checker blocked the approved plan: ${reason}`;
      await saveProgress(jobId, envelope, {
        label: "Revising a blocked plan",
        step: state.lead_steps,
      });
      void runAssistantJob(jobId, user, request, undefined, envelope, log);
    }
  })();
  return { accepted: true, job_id: jobId };
}

/** Set the persisted cancellation flag and interrupt this API copy if local. */
export async function stopAssistantJob(
  jobId: string,
  user: UserRow,
  log: FastifyBaseLogger,
) {
  const row = await transaction(async (db) => {
    const current = (
      await db.query<{ state: string; run_state: unknown }>(
        `SELECT state, run_state FROM ai_jobs WHERE id = $1 AND user_id = $2
          AND state IN ('running', 'waiting') FOR UPDATE`,
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
  const active = activeRuns.get(jobId);
  if (active) active.abort();
  else if (row.state === "waiting") {
    const envelope = envelopeOf(row.run_state);
    if (envelope)
      void runAssistantJob(
        jobId,
        user,
        envelope.request,
        undefined,
        envelope,
        log,
      );
  }
  return true;
}

/** Validate the job state before any polling or resume action uses it. */
export const assistantRunStateFor = (value: unknown) => envelopeOf(value);

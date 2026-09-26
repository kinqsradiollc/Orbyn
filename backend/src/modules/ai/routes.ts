import { loadPrefs } from "../planner/calendar.js";
import { parseProjectDraft, PROJECT_DRAFT_PROMPT } from "./project-draft.js";
import { proposeProject } from "./project-proposal.js";
import { applyProposal } from "../proposals/service.js";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import {
  chatRequest,
  fail,
  HttpError,
  MAX_REMINDER_MINUTES,
  localDateKey,
  projectRequest,
  type ChatTurn,
  type ChatScope,
  type Proposal,
  type DocBlock,
  quoteOf,
} from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { z } from "zod";
import { docVisibleTo } from "../../lib/doc-visibility.js";

type ChatRequest = z.output<typeof chatRequest>;
import { idParam, strictRateLimit } from "../../lib/params.js";
import { pruneActions } from "./guards.js";
import { ProviderError } from "./providers/adapters.js";
import { resolveAi } from "./providers/resolve.js";
import { complete } from "./providers/adapters.js";
import { runAgent } from "./agent/loop.js";
import {
  overview,
  related,
  requestWords,
  type AgentContext,
  getItem,
  recordSource,
} from "./agent/tools.js";
import { calendarMatches, getProject } from "./agent/workspace.js";
import { rewriteAgenda } from "../docs/agenda.js";
import { adoptDeviceZone } from "../planner/timezone.js";
import { requireTeam } from "../../lib/teams.js";
import { visibleProjectActivity } from "../projects/activity-visibility.js";
import {
  KeptOutError,
  keptOutFor,
  scrubKeptOut,
} from "../../lib/assistant-off.js";
import { visibleItems } from "../../lib/visibility.js";
import { projectVisible } from "../projects/service.js";

/**
 * The request that decides whether changes are allowed. A short reply to the
 * assistant's own question ("the second one") carries the request it answers.
 */
function intentOf(message: string, history: ChatTurn[]) {
  const last = history.at(-1);
  const asked = history.at(-2);
  return last?.role === "assistant" &&
    /\?\s*$/.test(last.content.trim()) &&
    asked?.role === "user"
    ? `${asked.content}\n${message}`
    : message;
}

/** Permission-check the chosen project or task before its facts reach a provider. */
async function scopeOverview(
  u: UserRow,
  timezone: string,
  scope: ChatScope | null,
) {
  if (!scope) return null;
  // A project kept out of the assistant (or a task in one) can't be a scope.
  const out = await keptOutFor(pool, u.id);
  if (out.projects.has(scope.id) || out.ids.has(scope.id))
    fail(422, new KeptOutError().message);
  const ctx: AgentContext = {
    user: { id: u.id, role: u.role },
    timezone,
    intentText: "",
    actions: [],
    clarification: null,
  };
  if (scope.kind === "project") {
    if (!(await projectVisible(pool, u.id, scope.id)))
      fail(404, "Project not found");
    const [project, changes] = await Promise.all([
      getProject(ctx, { project_id: scope.id }),
      pool.query<{ id: string; summary: string; created_at: Date }>(
        `SELECT a.id, a.summary, a.created_at FROM project_activity a
           JOIN project_visits v ON v.project_id = a.project_id AND v.user_id = $1
          WHERE a.project_id = $2 AND v.previous_seen_at IS NOT NULL
            AND a.created_at > v.previous_seen_at
            AND ${visibleProjectActivity("$1")}
          ORDER BY a.event_order DESC LIMIT 8`,
        [u.id, scope.id],
      ),
    ]);
    return {
      kind: "project" as const,
      id: scope.id,
      name: project.name,
      summary: project.summary,
      deadline: project.deadline,
      your_plan: project.your_plan,
      brief: project.brief,
      stages: project.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
      })),
      tasks: project.stages.flatMap((stage) => stage.open_tasks).slice(0, 12),
      open_decisions: project.open_records
        .filter((record) => record.kind === "decision")
        .slice(0, 8),
      pages: project.notes.slice(0, 6),
      your_sessions: project.your_sessions.slice(0, 8),
      since_last_visit: changes.rows.map((change) => ({
        id: change.id,
        summary: change.summary,
        at: change.created_at.toISOString(),
      })),
    };
  }
  const visible = await pool.query(
    `SELECT 1 FROM items i WHERE i.id = $2 AND i.kind = 'task' AND ${visibleItems()}`,
    [u.id, scope.id],
  );
  if (!visible.rows.length) fail(404, "Task not found");
  const task = await getItem(ctx, { id: scope.id });
  const [children, source] = await Promise.all([
    pool.query<{ id: string; title: string; status: string }>(
      `SELECT i.id, i.title, i.status FROM items i
        WHERE i.parent_id = $2 AND ${visibleItems()}
        ORDER BY i.created_at LIMIT 12`,
      [u.id, scope.id],
    ),
    pool.query<{
      doc_id: string;
      title: string;
      block_id: string;
      content: DocBlock[];
    }>(
      `SELECT d.id AS doc_id, d.title, l.block_id, d.content
         FROM doc_task_links l JOIN docs d ON d.id = l.doc_id
        WHERE l.item_id = $2 AND ${docVisibleTo("$1")}
        ORDER BY l.created_at LIMIT 1`,
      [u.id, scope.id],
    ),
  ]);
  const cameFrom = source.rows[0];
  return {
    kind: "task" as const,
    id: scope.id,
    name: task.title,
    due_at: task.due_at,
    notes: task.notes.slice(0, 600),
    planning: task.planning,
    checklist: task.checklist.slice(0, 12),
    subtasks: children.rows,
    source_page: cameFrom
      ? {
          doc_id: cameFrom.doc_id,
          title: cameFrom.title,
          block_id: cameFrom.block_id,
          quote: quoteOf(
            cameFrom.content.find((block) => block.id === cameFrom.block_id),
          ),
        }
      : null,
  };
}

/** One assistant turn for `u`: run the agent and store what it proposes. */
async function answer(
  u: UserRow,
  d: ChatRequest,
  log: FastifyBaseLogger,
  preloadedScope?: Awaited<ReturnType<typeof scopeOverview>>,
): Promise<Proposal> {
  try {
    new Intl.DateTimeFormat("en", { timeZone: d.timezone });
  } catch {
    fail(422, "Unknown timezone");
  }
  const ai = await resolveAi();
  if (!ai)
    fail(
      503,
      "The AI assistant is not set up yet. An admin can connect a provider in Admin → AI.",
    );
  const ctx: AgentContext = {
    user: { id: u.id, role: u.role },
    timezone: d.timezone,
    intentText: intentOf(d.message, d.history),
    actions: [],
    clarification: null,
    cited: new Map(),
    notes: [],
    scope: d.scope,
    keptOut: await keptOutFor(pool, u.id),
    allowOutsideScope:
      /\b(outside|another project|other projects|all projects|whole workspace|across projects)\b/i.test(
        d.message,
      ),
  };
  const scoped =
    preloadedScope === undefined
      ? await scopeOverview(u, d.timezone, d.scope)
      : preloadedScope;
  if (scoped?.kind === "project") {
    for (const task of scoped.tasks.slice(0, 6))
      recordSource(ctx, `task:${task.id}`, {
        kind: "task",
        id: task.id,
        title: task.title,
        quote: task.when ?? "No deadline",
      });
    for (const decision of scoped.open_decisions.slice(0, 4))
      recordSource(ctx, `decision:${decision.id}`, {
        kind: "decision",
        id: decision.id,
        project_id: scoped.id,
        title: decision.title,
        quote: decision.status,
      });
    for (const change of scoped.since_last_visit.slice(0, 4))
      recordSource(ctx, `change:${change.id}`, {
        kind: "change",
        id: change.id,
        project_id: scoped.id,
        title: change.summary,
        quote: change.at,
      });
    for (const page of scoped.pages.slice(0, 4))
      recordSource(ctx, page.id, {
        doc_id: page.id,
        title: page.title,
        block_id: page.first_lines[0]?.block_id ?? null,
        quote: page.first_lines[0]?.text ?? "",
      });
  } else if (scoped?.kind === "task") {
    recordSource(ctx, `task:${scoped.id}`, {
      kind: "task",
      id: scoped.id,
      title: scoped.name,
      quote: scoped.due_at ?? "No deadline",
    });
    if (scoped.source_page)
      recordSource(ctx, scoped.source_page.doc_id, {
        doc_id: scoped.source_page.doc_id,
        title: scoped.source_page.title,
        block_id: scoped.source_page.block_id,
        quote: scoped.source_page.quote ?? "",
      });
  }
  let result;
  try {
    const inside = d.scope && !ctx.allowOutsideScope;
    result = await runAgent(
      ai,
      ctx,
      d.message,
      d.history,
      // Nothing from a project kept out of the assistant is preloaded.
      scrubKeptOut(
        {
          ...(!inside ? await overview(ctx) : {}),
          matching_request: await related(ctx, d.message),
          // Timetable, shift or exam events the request names, further ahead.
          ...(!inside
            ? {
                matching_calendar: await calendarMatches(
                  ctx,
                  requestWords(d.message),
                ),
              }
            : {}),
          ...(scoped ? { scope: scoped } : {}),
          ...(scoped
            ? {
                available_sources: [...(ctx.cited?.values() ?? [])].map(
                  (source) => ({
                    ref: `[${source.number}]`,
                    title: source.title,
                  }),
                ),
              }
            : {}),
        },
        ctx.keptOut!,
      ),
      log,
    );
  } catch (error) {
    // Content is never logged: it contains the user's planner.
    log.error(
      {
        event: "ai_provider_failed",
        reason: (error as { reason?: string }).reason ?? "unexpected",
        provider: ai.kind,
      },
      "AI provider failed",
    );
    // The provider's own reason is written for people (no key, no content).
    fail(
      502,
      error instanceof ProviderError
        ? `The AI provider could not answer: ${error.message} Please try again.`
        : "The AI provider could not answer. Please try again.",
    );
  }
  if (ctx.projectDraft && !ctx.clarification) {
    const proposal = await proposeProject(
      pool,
      u.id,
      ctx.projectDraft,
      d.timezone,
    );
    return { ...proposal, sources: result.sources };
  }
  let actions = result.actions;
  if (result.legacy) {
    // A reply in the old single-JSON format: keep only edits of items this
    // user can see and nothing the request didn't ask for.
    const ids = actions.flatMap((a) => (a.item_id ? [a.item_id] : []));
    const titles = actions.flatMap((a) =>
      a.operation === "create" && a.data ? [a.data.title.toLowerCase()] : [],
    );
    const items = (
      await pool.query(
        `SELECT i.* FROM items i WHERE ${visibleItems()}
           AND (i.id = ANY($2::uuid[]) OR lower(i.title) = ANY($3))`,
        [u.id, ids, titles],
      )
    ).rows;
    actions = pruneActions(actions, items, ctx.intentText).slice(0, 20);
  }
  // New items proposed without alerts get the person's default alerts, so
  // the review shows the reminder they'll really get.
  const defaults = (await loadPrefs(pool, u.id)).default_alerts!;
  actions = actions.map((a) => {
    if (
      a.operation !== "create" ||
      !a.data ||
      a.data.alerts !== undefined ||
      a.data.reminder_minutes !== undefined
    )
      return a;
    const alerts = defaults[a.data.all_day ? "all_day" : a.data.kind];
    const soonest = alerts.length ? Math.min(...alerts) : null;
    return {
      ...a,
      data: {
        ...a.data,
        alerts,
        ...(soonest !== null && soonest <= MAX_REMINDER_MINUTES
          ? { reminder_minutes: soonest }
          : {}),
      },
    };
  });
  log.info(
    {
      event: "ai_agent_turn",
      provider: ai.kind,
      steps: result.steps,
      actions: actions.length,
      partial: result.partial,
      legacy: result.legacy,
    },
    "AI agent turn",
  );
  const p = (
    await pool.query(
      "INSERT INTO proposals(user_id,actions,session_change,decision_links) VALUES($1,$2,$3,$4) RETURNING id",
      [
        u.id,
        JSON.stringify(actions),
        ctx.sessionChange ? JSON.stringify(ctx.sessionChange) : null,
        JSON.stringify(ctx.decisionLinks ?? []),
      ],
    )
  ).rows[0];
  return {
    id: p.id,
    summary: result.summary,
    actions,
    follow_ups: result.follow_ups,
    sources: result.sources,
    notes: result.notes,
    plan: ctx.plan ?? null,
    session_change: ctx.sessionChange ?? null,
    decision_links: ctx.decisionLinks ?? [],
  };
}

/** A running turn's `heartbeat_at` this old means its ai copy is gone. */
const STALE_MS = 60_000;
const HEARTBEAT_MS = 15_000;

/**
 * Run a turn in the background, keeping the job row current. Nothing in
 * front of Orbyn (Cloudflare gives an origin 100 seconds) limits how long the
 * model may take, and a poll may land on any ai copy.
 */
function runJob(
  id: string,
  u: UserRow,
  d: ChatRequest,
  log: FastifyBaseLogger,
  scoped: Awaited<ReturnType<typeof scopeOverview>>,
) {
  const beat = setInterval(() => {
    pool
      .query("UPDATE ai_jobs SET heartbeat_at=now() WHERE id=$1", [id])
      .catch(() => {});
  }, HEARTBEAT_MS);
  answer(u, d, log, scoped)
    .then((proposal) =>
      pool.query(
        "UPDATE ai_jobs SET state='done', result=$2, heartbeat_at=now() WHERE id=$1",
        [id, JSON.stringify(proposal)],
      ),
    )
    .catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : "The assistant hit a problem. Please try again.";
      if (!(error instanceof HttpError))
        log.error({ event: "ai_job_failed", err: error }, "AI turn failed");
      return pool.query(
        `UPDATE ai_jobs SET state='failed', error_status=$2, error_message=$3,
           heartbeat_at=now() WHERE id=$1`,
        [id, status, message],
      );
    })
    .catch(() => {})
    .finally(() => clearInterval(beat));
}

/**
 * Propose-then-approve assistant. `/ai/chat` runs the agent (reads scoped to
 * the user's own and team items) and stores what it proposes; nothing changes
 * until the user calls `/ai/proposals/:id/apply`, which runs atomically.
 */
export async function aiRoutes(app: FastifyInstance) {
  app.get("/ai/capabilities", async (r) => {
    await authenticate(r);
    const provider = await resolveAi();
    return {
      enabled: !!provider,
      tools: !!provider && !provider.structuredOutput,
    };
  });
  // Draft a project from a prompt: a set of subtasks with estimates and due
  // dates, returned as a proposal to review — nothing is saved until applied.
  /**
   * Write today's agenda again from the calendar as it is now, opening with
   * the assistant's summary of the day when a provider is connected. It
   * replaces the page's content, so the apps ask first.
   */
  app.post("/ai/agenda/today", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    const zone = (r.body as { timezone?: unknown } | null)?.timezone;
    if (typeof zone === "string")
      await adoptDeviceZone(u.id, zone.slice(0, 64));
    return rewriteAgenda(u.id, { withBrief: true });
  });

  app.post("/ai/project", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    const d = projectRequest.parse(r.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: d.timezone });
    } catch {
      fail(422, "Unknown timezone");
    }
    if (d.team_id) await requireTeam(d.team_id, u, "items:write");
    const ai = await resolveAi();
    if (!ai)
      fail(
        503,
        "The AI assistant is not set up yet. An admin can connect a provider in Admin → AI.",
      );
    const today = localDateKey(new Date(), d.timezone);
    const system = PROJECT_DRAFT_PROMPT;
    let content: string;
    try {
      content = await complete(
        ai,
        [
          { role: "system", content: system },
          { role: "user", content: `Today is ${today}. Project: ${d.prompt}` },
        ],
        { timeoutMs: 60_000 },
      );
    } catch (error) {
      r.log.error(
        { event: "ai_project_failed", provider: ai.kind },
        "AI project draft failed",
      );
      fail(502, "The AI provider could not answer. Please try again.");
    }
    let draft;
    try {
      draft = parseProjectDraft(content);
    } catch {
      fail(
        502,
        "The AI provider returned an invalid task graph. Please try again.",
      );
    }
    const proposal = await proposeProject(
      pool,
      u.id,
      draft,
      d.timezone,
      new Date(),
      undefined,
      {
        summary: d.summary,
        deadline: d.deadline,
      },
    );
    if (!d.team_id) return proposal;
    // Approving it makes a team project, as a template started for a team does.
    await pool.query(
      "UPDATE proposals SET project = project || $2::jsonb WHERE id = $1",
      [proposal.id, JSON.stringify({ team_id: d.team_id })],
    );
    return {
      ...proposal,
      project: { ...proposal.project!, team_id: d.team_id },
    };
  });

  // The whole turn in one request. Anything in front of Orbyn that gives up
  // early (Cloudflare after 100 seconds) cuts it off: apps use start + poll.
  app.post("/ai/chat", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    return answer(u, chatRequest.parse(r.body), r.log);
  });

  // Start a turn and hand back its job id; the answer comes from GET below.
  app.post("/ai/chat/start", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const d = chatRequest.parse(r.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: d.timezone });
    } catch {
      fail(422, "Unknown timezone");
    }
    if (!(await resolveAi()))
      fail(
        503,
        "The AI assistant is not set up yet. An admin can connect a provider in Admin → AI.",
      );
    const scoped = await scopeOverview(u, d.timezone, d.scope);
    // Finished turns are read once and never needed again.
    await pool.query(
      "DELETE FROM ai_jobs WHERE created_at < now() - interval '1 day'",
    );
    const job = (
      await pool.query("INSERT INTO ai_jobs(user_id) VALUES($1) RETURNING id", [
        u.id,
      ])
    ).rows[0];
    runJob(job.id, u, d, r.log, scoped);
    reply.code(202);
    return { id: job.id };
  });

  // The turn's state: running, its proposal, or why it failed. A turn whose
  // ai copy stopped mid-way (a server update) is reported as failed.
  app.get("/ai/chat/:id", async (r) => {
    const u = await authenticate(r);
    const job = (
      await pool.query(
        `SELECT state, result, error_status, error_message,
                heartbeat_at < now() - ($3::int * interval '1 millisecond') AS stale
           FROM ai_jobs WHERE id=$1 AND user_id=$2`,
        [idParam(r), u.id, STALE_MS],
      )
    ).rows[0];
    if (!job) fail(404, "Conversation not found");
    if (job.state === "done") return { state: "done", proposal: job.result };
    if (job.state === "failed")
      return {
        state: "failed",
        status: job.error_status,
        message: job.error_message,
      };
    if (job.stale)
      return {
        state: "failed",
        status: 503,
        message:
          "The assistant was interrupted, probably by a server update. Please ask again.",
      };
    return { state: "running" };
  });

  // The assistant's Approve: the one proposals service applies it (the
  // Review inbox's own route is POST /proposals/:id/apply). Kept here so the
  // apps and any gateway that sends /ai/ to this service keep working.
  app.post("/ai/proposals/:id/apply", async (r) => {
    const u = await authenticate(r);
    const choice = z
      .object({ give_tasks_deadlines: z.boolean().default(true) })
      .parse(r.body ?? {});
    const done = await transaction((db) =>
      applyProposal(db, u, idParam(r), choice),
    );
    return { applied: true, project_id: done.project_id };
  });
}

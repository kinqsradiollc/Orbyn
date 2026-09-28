import { randomUUID } from "node:crypto";
import { parseProjectDraft, PROJECT_DRAFT_PROMPT } from "./project-draft.js";
import { proposeProject } from "./project-proposal.js";
import { applyProposal } from "../proposals/service.js";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import {
  chatRequest,
  fail,
  localDateKey,
  projectRequest,
  type ChatScope,
  type Proposal,
  type DocBlock,
  quoteOf,
  type ChatTraceEntry,
} from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { readableLinks } from "../links/privacy.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { z } from "zod";
import { assistantMayRead, docVisibleTo } from "../../lib/doc-visibility.js";

type ChatRequest = z.output<typeof chatRequest>;
import { idParam, strictRateLimit } from "../../lib/params.js";
import { resolveAi } from "./providers/resolve.js";
import { complete } from "./providers/adapters.js";
import { beginChatTurn, resolveChatScope } from "./chats.js";
import { type AgentContext, getItem } from "./agent/tools.js";
import { getProject } from "./agent/workspace.js";
import { rewriteAgenda } from "../docs/agenda.js";
import { briefFor } from "./agenda-brief.js";
import { adoptDeviceZone } from "../planner/timezone.js";
import { requireTeam } from "../../lib/teams.js";
import { visibleProjectActivity } from "../projects/activity-visibility.js";
import { KeptOutError, keptOutFor } from "../../lib/assistant-off.js";
import { visibleItems } from "../../lib/visibility.js";
import { projectVisible } from "../projects/service.js";
import {
  answerAssistantApproval,
  answerAssistantQuestion,
  assistantRunStateFor,
  runAssistantJob,
  stopAssistantJob,
} from "./agent/run.js";

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
          AND ${assistantMayRead("d")}
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
          // Links to what the person can't open keep no title (D3aF).
          quote: quoteOf(
            await readableLinks(
              pool,
              u.id,
              cameFrom.content.find((block) => block.id === cameFrom.block_id),
            ),
          ),
        }
      : null,
  };
}

/** Resolve the persisted conversation before accepting a new assistant turn. */
async function prepareChatTurn(u: UserRow, d: ChatRequest) {
  const chatId = d.chat_id ?? randomUUID();
  const turnId = d.turn_id ?? randomUUID();
  const scope = await resolveChatScope(pool, u.id, chatId, d.scope);
  const scoped = await scopeOverview(u, d.timezone, scope);
  const history = await beginChatTurn(u, {
    chatId,
    turnId,
    message: d.message,
    scope,
    legacyHistory: d.history,
  });
  return {
    chatId,
    turnId,
    scoped,
    request: { ...d, chat_id: chatId, turn_id: turnId, scope, history },
  };
}

const STALE_MS = 60_000;

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
    return rewriteAgenda(u.id, { brief: briefFor });
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

  const startChat = async (
    u: UserRow,
    d: ChatRequest,
    log: FastifyBaseLogger,
  ) => {
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
    const prepared = await prepareChatTurn(u, d);
    const job = (
      await pool.query(
        `INSERT INTO ai_jobs(user_id, progress) VALUES($1, $2::jsonb) RETURNING id`,
        [u.id, JSON.stringify({ label: "Starting the lead assistant" })],
      )
    ).rows[0];
    void runAssistantJob(
      job.id,
      u,
      prepared.request as Parameters<typeof runAssistantJob>[2],
      prepared.scoped,
      undefined,
      log,
    );
    return { id: job.id, chat_id: prepared.chatId, turn_id: prepared.turnId };
  };

  // Both paths now start the same persistent, multi-specialist assistant run.
  // /ai/chat remains as a short alias for clients that have not switched to
  // /ai/chat/start yet; neither path uses the removed proposal-only loop.
  app.post("/ai/chat", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const d = chatRequest.parse(r.body);
    reply.code(202);
    return startChat(u, d, r.log);
  });

  // Start a turn and hand back its job id; the answer comes from GET below.
  app.post("/ai/chat/start", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const d = chatRequest.parse(r.body);
    reply.code(202);
    return startChat(u, d, r.log);
  });

  // The turn's state: running, its proposal, or why it failed. A turn whose
  // ai copy stopped mid-way (a server update) is reported as failed.
  app.get("/ai/chat/:id", async (r) => {
    const u = await authenticate(r);
    const job = (
      await pool.query(
        `SELECT state, result, error_status, error_message, progress, run_state,
                heartbeat_at < now() - ($3::int * interval '1 millisecond') AS stale
           FROM ai_jobs WHERE id=$1 AND user_id=$2`,
        [idParam(r), u.id, STALE_MS],
      )
    ).rows[0];
    if (!job) fail(404, "Conversation not found");
    if (job.state === "waiting") {
      const run = assistantRunStateFor(job.run_state);
      return {
        state: "waiting",
        progress: job.progress,
        waiting: run?.state.waiting ?? null,
      };
    }
    if (job.state === "done") {
      const saved = job.result as
        | {
            answer?: string;
            assistant_run?: Record<string, unknown>;
            proposal?: Proposal;
            chat_id?: string;
            turn_id?: string;
            trace?: ChatTraceEntry[];
          }
        | Proposal;
      if (saved && typeof saved === "object" && "answer" in saved)
        return { state: "done", ...saved };
      return saved && typeof saved === "object" && "proposal" in saved
        ? { state: "done", ...saved }
        : { state: "done", proposal: saved };
    }
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
    return { state: "running", progress: job.progress };
  });

  app.post("/ai/chat/:id/answer", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    try {
      const result = await answerAssistantQuestion(
        idParam(r),
        u,
        r.body,
        r.log,
      );
      reply.code(202);
      return result;
    } catch (error) {
      fail(
        409,
        error instanceof Error
          ? error.message
          : "This question can no longer be answered.",
      );
    }
  });

  app.post("/ai/chat/:id/approve", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    try {
      const result = await answerAssistantApproval(
        idParam(r),
        u,
        r.body,
        r.log,
      );
      reply.code(202);
      return result;
    } catch (error) {
      fail(
        409,
        error instanceof Error
          ? error.message
          : "This plan can no longer be approved.",
      );
    }
  });

  app.post("/ai/chat/:id/stop", async (r) => {
    const u = await authenticate(r);
    const stopped = await stopAssistantJob(idParam(r), u, r.log);
    if (!stopped) fail(409, "This assistant run is no longer active.");
    return { stopped: true };
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

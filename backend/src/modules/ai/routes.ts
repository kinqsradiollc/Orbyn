import { loadPrefs } from "../planner/calendar.js";
import { parseProjectDraft, PROJECT_DRAFT_PROMPT } from "./project-draft.js";
import { proposeProject, applyProject } from "./project-proposal.js";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import {
  actionSchema,
  chatRequest,
  fail,
  HttpError,
  MAX_REMINDER_MINUTES,
  localDateKey,
  projectRequest,
  type ChatTurn,
  type Proposal,
} from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import type { z } from "zod";

type ChatRequest = z.output<typeof chatRequest>;
import { idParam, strictRateLimit } from "../../lib/params.js";
import { audit } from "../../lib/audit.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { mutate } from "../items/service.js";
import { pruneActions } from "./guards.js";
import { ProviderError } from "./providers/adapters.js";
import { resolveAi } from "./providers/resolve.js";
import { complete } from "./providers/adapters.js";
import { runAgent } from "./agent/loop.js";
import { overview, related, type AgentContext } from "./agent/tools.js";
import { requireTeam } from "../../lib/teams.js";

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

/** One assistant turn for `u`: run the agent and store what it proposes. */
async function answer(
  u: UserRow,
  d: ChatRequest,
  log: FastifyBaseLogger,
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
  };
  let result;
  try {
    result = await runAgent(
      ai,
      ctx,
      d.message,
      d.history,
      {
        ...(await overview(ctx)),
        matching_request: await related(ctx, d.message),
      },
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
        `SELECT i.* FROM items i WHERE ${VISIBLE_ITEMS}
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
      "INSERT INTO proposals(user_id,actions) VALUES($1,$2) RETURNING id",
      [u.id, JSON.stringify(actions)],
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
) {
  const beat = setInterval(() => {
    pool
      .query("UPDATE ai_jobs SET heartbeat_at=now() WHERE id=$1", [id])
      .catch(() => {});
  }, HEARTBEAT_MS);
  answer(u, d, log)
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
  // Draft a project from a prompt: a set of subtasks with estimates and due
  // dates, returned as a proposal to review — nothing is saved until applied.
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
    const proposal = await proposeProject(pool, u.id, draft, d.timezone);
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
    // Finished turns are read once and never needed again.
    await pool.query(
      "DELETE FROM ai_jobs WHERE created_at < now() - interval '1 day'",
    );
    const job = (
      await pool.query("INSERT INTO ai_jobs(user_id) VALUES($1) RETURNING id", [
        u.id,
      ])
    ).rows[0];
    runJob(job.id, u, d, r.log);
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

  app.post("/ai/proposals/:id/apply", async (r) => {
    const u = await authenticate(r);
    return transaction(async (db) => {
      const p = (
        await db.query(
          "SELECT * FROM proposals WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [idParam(r), u.id],
        )
      ).rows[0];
      if (!p) fail(404, "Proposal not found");
      if (p.applied) return { applied: true };
      if (p.expires_at <= new Date())
        fail(409, "Proposal expired. Ask the assistant again.");
      if (p.project) await applyProject(db, u, p.project);
      else
        for (const raw of p.actions)
          await mutate(db, u, actionSchema.parse(raw));
      await db.query("UPDATE proposals SET applied=true WHERE id=$1", [p.id]);
      await audit(
        {
          actorId: u.id,
          action: "ai.proposal_applied",
          targetType: "proposal",
          targetId: p.id,
          details: { actions: p.actions.length },
        },
        db,
      );
      return { applied: true };
    });
  });
}

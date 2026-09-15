import type { FastifyInstance } from "fastify";
import {
  actionSchema,
  chatRequest,
  fail,
  MAX_REMINDER_MINUTES,
  type ChatTurn,
} from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { audit } from "../../lib/audit.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { mutate } from "../items/service.js";
import { loadPrefs } from "../planner/calendar.js";
import { pruneActions } from "./guards.js";
import { resolveAi } from "./providers/resolve.js";
import { runAgent } from "./agent/loop.js";
import { overview, related, type AgentContext } from "./agent/tools.js";

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

/**
 * Propose-then-approve assistant. `/ai/chat` runs the agent (reads scoped to
 * the user's own and team items) and stores what it proposes; nothing changes
 * until the user calls `/ai/proposals/:id/apply`, which runs atomically.
 */
export async function aiRoutes(app: FastifyInstance) {
  app.post("/ai/chat", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    const d = chatRequest.parse(r.body);
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
        r.log,
      );
    } catch (error) {
      // Content is never logged: it contains the user's planner.
      r.log.error(
        {
          event: "ai_provider_failed",
          reason: (error as { reason?: string }).reason ?? "unexpected",
          provider: ai.kind,
        },
        "AI provider failed",
      );
      fail(502, "The AI provider could not answer. Please try again.");
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
    r.log.info(
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
      plan: ctx.plan ?? null,
    };
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
      for (const raw of p.actions) await mutate(db, u, actionSchema.parse(raw));
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

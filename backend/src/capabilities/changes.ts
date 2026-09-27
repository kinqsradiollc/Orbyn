import { z } from "zod";
import { HttpError } from "@orbyn/core";
import { audit } from "../lib/audit.js";
import { announceTo } from "../modules/presence/live.js";
import { READ, cursorInput } from "./common.js";
import { cleanTitle, localTime } from "./format.js";
import { CapabilityError, defineCapability } from "./registry.js";
import { UNDO_DAYS, runUndo, type UndoOp } from "./undo.js";
import {
  EDITS,
  actorOf,
  cantWait,
  clientRefInput,
  dbOf,
  destination,
} from "./write.js";

/**
 * What this connection changed, and taking it back (H1). At full power an
 * agent changes things directly, deletes included, so it can also see what
 * it did and undo it: one change, or every change one call (a job) made,
 * for 30 days and only while things are as it left them. The person has
 * the same Undo in Settings → Connected agents. Only this connection's own
 * changes, never another's.
 */

const change = z.object({
  id: z.string(),
  tool: z.string(),
  at: z.string(),
  summary: z.string(),
  targets: z.array(z.string()),
  proposal_id: z.string().nullable(),
  job: z.string().nullable(),
  undone_at: z.string().nullable(),
  undo_until: z.string().nullable(),
});

type Row = {
  id: string;
  tool: string;
  at: Date;
  summary: string;
  target_ids: string[];
  outcome: string;
  proposal_id: string | null;
  request_id: string | null;
  undone_at: Date | null;
  undo_until: Date | null;
  has_undo: boolean;
  team_id: string | null;
};

export const listAgentChanges = defineCapability({
  name: "list_agent_changes",
  title: "What this connection changed",
  description:
    "This connection's own changes, newest first: tool, summary, when, what it touched, its proposal if it waits for review, its call (job), and undo_until (null once undone, expired or not undoable). Pass id or job to undo. Pages with next_cursor.",
  input: z
    .object({
      limit: z.number().int().min(1).max(50).default(20),
      include_undone: z.boolean().default(true),
      cursor: cursorInput,
    })
    .strict(),
  output: z.object({
    changes: z.array(change),
    next_cursor: z.string().nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const p = ctx.principal;
    const offset = await ctx.cursor.open(a.cursor);
    const rows = p.grant_id
      ? (
          await ctx.db.query<Row>(
            `SELECT id::text, tool, at, summary, target_ids, outcome, proposal_id,
                    request_id, undone_at, undo_until, undo IS NOT NULL AS has_undo,
                    team_id
               FROM agent_activity
              WHERE grant_id = $1 AND user_id = $2 AND tier <> 'R'
                AND outcome IN ('ok', 'proposed', 'suggested', 'confirmed')
                AND ($3::boolean OR undone_at IS NULL)
              ORDER BY at DESC, id DESC
              OFFSET $4 LIMIT $5`,
            [p.grant_id, p.user.id, a.include_undone, offset, a.limit + 1],
          )
        ).rows
      : [];
    const more = rows.length > a.limit;
    const changes = rows.slice(0, a.limit).map((r) => {
      const open =
        r.has_undo && !r.undone_at && !!r.undo_until && r.undo_until > ctx.now;
      return {
        id: `change:${r.id}`,
        tool: r.tool,
        at: r.at.toISOString(),
        summary: cleanTitle(r.summary),
        targets: r.target_ids ?? [],
        proposal_id: r.proposal_id ? `proposal:${r.proposal_id}` : null,
        job: r.request_id,
        undone_at: r.undone_at?.toISOString() ?? null,
        undo_until: open ? r.undo_until!.toISOString() : null,
      };
    });
    const next = more ? await ctx.cursor.seal(offset + a.limit) : null;
    const markdown = changes.length
      ? changes
          .map(
            (c) =>
              `- ${c.id} · ${localTime(c.at, ctx.timezone)} · ${c.summary}${c.undone_at ? " (undone)" : c.undo_until ? ` (undo until ${c.undo_until.slice(0, 10)})` : ""}${c.job ? ` · job ${c.job}` : ""}`,
          )
          .join("\n")
      : "This connection hasn't changed anything yet.";
    return { structured: { changes, next_cursor: next }, markdown };
  },
});

const changeId = z
  .string()
  .trim()
  .regex(/^(change:)?\d{1,18}$/, "Use a change:<n> id from list_agent_changes.")
  .transform((v) => v.replace(/^change:/, ""));

export const undoCapability = defineCapability({
  name: "undo",
  title: "Undo a change",
  description: `Takes back this connection's own change (change id) or every change of one call (job), from list_agent_changes. For ${UNDO_DAYS} days, and only while things are as it left them; otherwise STALE and nothing is undone.`,
  input: z
    .object({
      change: changeId.optional(),
      job: z.string().trim().min(1).max(64).optional(),
      client_ref: clientRefInput,
    })
    .strict()
    .refine((v) => !!v.change !== !!v.job, {
      message: "Give either change or job.",
    }),
  output: z.object({
    undone: z.array(z.object({ id: z.string(), summary: z.string() })),
  }),
  annotations: EDITS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const p = ctx.principal;
    const db = dbOf(ctx);
    if (!p.grant_id)
      throw new CapabilityError(
        "INVALID",
        "Only an agent's own changes can be undone here.",
      );
    const rows = (
      await db.query<{
        id: string;
        summary: string;
        undo: UndoOp[] | null;
        undo_until: Date | null;
        undone_at: Date | null;
        team_id: string | null;
      }>(
        `SELECT id::text, summary, undo, undo_until, undone_at, team_id
           FROM agent_activity
          WHERE grant_id = $1 AND user_id = $2 AND tier <> 'R'
            AND (($3::bigint IS NOT NULL AND id = $3::bigint)
                 OR ($4::text IS NOT NULL AND request_id = $4))
          ORDER BY at DESC, id DESC
          FOR UPDATE`,
        [p.grant_id, p.user.id, a.change ?? null, a.job ?? null],
      )
    ).rows;
    if (!rows.length)
      throw new CapabilityError(
        "NOT_FOUND",
        a.change
          ? "That isn't one of this connection's changes."
          : "That job made no changes through this connection.",
        "list_agent_changes lists them.",
      );
    const todo = a.job ? rows.filter((r) => r.undo?.length) : rows;
    if (!todo.length)
      throw new CapabilityError(
        "INVALID",
        "Nothing in that job can be undone.",
      );
    for (const r of todo) {
      if (r.undone_at)
        throw new CapabilityError(
          "INVALID",
          `“${cleanTitle(r.summary)}” was already undone.`,
        );
      if (!r.undo?.length)
        throw new CapabilityError(
          "INVALID",
          `“${cleanTitle(r.summary)}” has nothing to undo (it made nothing, or it waits in the Review inbox).`,
        );
      if (!r.undo_until || r.undo_until <= ctx.now)
        throw new CapabilityError(
          "INVALID",
          `“${cleanTitle(r.summary)}” is more than ${UNDO_DAYS} days old, so it can't be undone any more.`,
          "Change it back by hand if it's still wanted.",
        );
      if (destination(ctx, r.team_id, "W2") === "review")
        throw cantWait(ctx, r.team_id);
    }
    const undone: { id: string; summary: string }[] = [];
    const after: (() => Promise<void>)[] = [];
    for (const r of todo) {
      try {
        after.push(...(await runUndo(db, actorOf(p), r.undo!)));
      } catch (e) {
        if (e instanceof HttpError && e.statusCode === 409)
          throw new CapabilityError(
            "STALE",
            `“${cleanTitle(r.summary)}”: ${e.message}`,
            "Nothing was undone. Fetch it for how it is now and change it directly if needed.",
          );
        throw e;
      }
      await db.query(
        "UPDATE agent_activity SET undone_at = now() WHERE id = $1",
        [r.id],
      );
      await audit(
        {
          actorId: p.user.id,
          action: "agent.change_undone",
          targetType: "agent_grant",
          targetId: p.grant_id,
          details: { activity_id: r.id, by: "agent" },
        },
        db,
      );
      undone.push({ id: `change:${r.id}`, summary: cleanTitle(r.summary) });
    }
    await announceTo(db as never, { user_id: p.user.id }, "changed");
    return {
      structured: { undone },
      markdown: `Undone: ${undone.map((u) => `${u.summary} (${u.id})`).join("; ")}.`,
      targets: undone.map((u) => u.id),
      write: {
        outcome: "ok" as const,
        team_id: todo[0].team_id,
        after: after.length ? after : undefined,
      },
    };
  },
});

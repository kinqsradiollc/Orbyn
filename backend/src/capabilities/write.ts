import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentOutcome, ReviewChangeInput } from "@orbyn/core";
import type { Db, Queryable } from "../db/pool.js";
import type { UserRow } from "../lib/auth.js";
import { createAgentProposal } from "../modules/proposals/service.js";
import { policy, type Principal } from "./policy.js";
import {
  CapabilityError,
  type Annotations,
  type CapabilityContext,
  type Effect,
  type Tier,
} from "./registry.js";
import { refUrl } from "./refs.js";
import { UNDO_DAYS, type UndoOp } from "./undo.js";

/**
 * What every change an agent makes shares: where it goes (made directly,
 * as suggestions, or to the Review inbox), idempotency by client_ref, the
 * activity row with its undo, and refusing credentials in what is written.
 *
 * Where a change goes follows the risk tiers:
 * - W1 (adds, privately) and W2 (edits, or visible to teammates) are made
 *   directly when the connection may write in that space;
 * - W3 (deletes, team moves, stage removal, restoring a version, over 25
 *   at once) always goes to review;
 * - anything that reaches beyond Orbyn goes to review unless it may:
 *   notifying a teammate (assigning) needs the connection's "notify
 *   teammates" switch; emailing people outside Orbyn (event invites) and
 *   publishing always go to review;
 * - a connection that may only suggest in a space sends everything to
 *   review (and team pages get suggestions, see edit_doc).
 */

/** Annotations for a change that only adds. */
export const ADDS: Annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
/** Annotations for a change that edits or removes. */
export const EDITS: Annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Makes a change safe to send again: the same key answers as before. */
export const clientRefInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\w.:@-]+$/, "Use letters, digits and . : @ _ -")
  .optional()
  .describe(
    "Your own id for this change. Sending the same client_ref again (for 24 hours) returns the first answer instead of changing anything twice.",
  );

/** The most items one call changes (proposals hold up to 50). */
export const MAX_BATCH = 25;

export type Destination = "direct" | "review";

/**
 * Where a change in `teamId`'s space goes. NOT_FOUND when the connection
 * can't reach the space; READ_ONLY when it can only read there.
 */
export function destination(
  ctx: CapabilityContext,
  teamId: string | null,
  tier: Tier,
  effects: Effect[] = [],
): Destination {
  const p = ctx.principal;
  const level = policy.levelIn(p, teamId);
  if (level === null)
    throw new CapabilityError(
      "NOT_FOUND",
      "Nothing with that id is reachable from this connection.",
      "Use an id from search, query or get_context.",
    );
  if (level === "read")
    throw new CapabilityError(
      "READ_ONLY",
      teamId
        ? "This connection can only read in that team."
        : "This connection can only read your Personal space.",
      "Ask the person to allow changes, or make the change in Orbyn.",
    );
  if (level === "suggest" || tier === "W3") return "review";
  if (effects.includes("email_outside") || effects.includes("publish"))
    return "review";
  if (effects.includes("notify_member") && !p.flags.notify_teammates)
    return "review";
  return "direct";
}

/** What a change sent to review answers with. */
export const pendingOutput = z.object({
  status: z.literal("pending_review"),
  proposal_id: z.string(),
  review_url: z.string(),
  expires_at: z.string(),
  changes: z.number(),
});
export type Pending = z.output<typeof pendingOutput>;

/** Who a principal's changes are made as (an ordinary member). */
export const actorOf = (p: Principal) => policy.actor(p) as unknown as UserRow;

/**
 * File a proposal for the person to approve in the Review inbox, and answer
 * with its link. Runs in the call's transaction.
 */
export async function toReview(
  ctx: CapabilityContext,
  summary: string,
  changes: ReviewChangeInput[],
): Promise<Pending & { targets: string[] }> {
  const p = ctx.principal;
  const made = await createAgentProposal(ctx.db, {
    userId: p.user.id,
    grantId: p.grant_id,
    clientName: p.client.name,
    summary,
    changes: changes as never,
  });
  return {
    status: "pending_review",
    proposal_id: `proposal:${made.id}`,
    review_url: made.review_url,
    expires_at: made.expires_at,
    changes: changes.length,
    targets: [`proposal:${made.id}`],
  };
}

/** The Markdown answer for a change sent to review. */
export const pendingText = (what: string, pending: Pending) =>
  `${what} waits for the person's approval in Orbyn's Review inbox (expires ${pending.expires_at}). Nothing has changed yet.\nproposal: ${pending.proposal_id} · review: ${pending.review_url}\nCheck its status later with fetch("${pending.proposal_id}").`;

/** The link to a proposal, as refs give it. */
export const proposalUrl = (id: string) => refUrl({ type: "proposal", id });

const SECRET =
  /\b(?:ok|oat|ort|oak)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abpr]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * Refuse to write what looks like a credential (an Orbyn key or token, or
 * a common API key shape) into someone's planner, where it could leak.
 */
export function refuseSecrets(...texts: (string | null | undefined)[]) {
  for (const t of texts)
    if (t && SECRET.test(t))
      throw new CapabilityError(
        "INVALID",
        "That text looks like it holds a password, key or token, so it wasn't saved.",
        "Leave the secret out and try again.",
      );
}

/** Extra facts a write capability hands back for its activity row. */
export type WriteMeta = {
  outcome?: AgentOutcome;
  proposal_id?: string | null;
  /** Steps that take the change back (see undo.ts). */
  undo?: UndoOp[];
  /** The team the change was in, if one. */
  team_id?: string | null;
  /** Work to do once the change is committed (live news, Study). */
  after?: (() => Promise<void>)[];
};

// --- client_ref idempotency ---------------------------------------------

const refKey = (grantId: string, tool: string, clientRef: string) =>
  `ref:${createHash("sha256").update(`${grantId}|${tool}|${clientRef}`).digest("base64url")}`;

export type Recorded = {
  structured: unknown;
  markdown: string;
  links?: unknown[];
  targets?: string[];
  outcome: AgentOutcome;
};

/**
 * The answer an earlier call with this client_ref got, or null. Takes a
 * transaction lock on the key first, so a retry sent while the first call
 * is still running waits for it and then gets its answer.
 */
export async function priorAnswer(
  db: Queryable,
  grantId: string,
  tool: string,
  clientRef: string,
): Promise<Recorded | null> {
  const id = refKey(grantId, tool, clientRef);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
  const row = (
    await db.query<{ value: Recorded }>(
      `SELECT value FROM mcp_request_state
        WHERE id = $1 AND grant_id = $2 AND kind = 'client_ref' AND expires_at > now()`,
      [id, grantId],
    )
  ).rows[0];
  return row?.value ?? null;
}

/** Keep a change's answer for 24 hours under its client_ref. */
export async function keepAnswer(
  db: Queryable,
  grantId: string,
  tool: string,
  clientRef: string,
  answer: Recorded,
) {
  await db.query(
    `INSERT INTO mcp_request_state (id, grant_id, kind, value, expires_at)
     VALUES ($1, $2, 'client_ref', $3::jsonb, now() + interval '24 hours')
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value,
       expires_at = EXCLUDED.expires_at`,
    [refKey(grantId, tool, clientRef), grantId, JSON.stringify(answer)],
  );
}

/**
 * The activity row for one change, written in the change's own
 * transaction so its undo steps and proposal are never lost or orphaned.
 */
export async function recordChange(
  db: Queryable,
  p: Principal,
  entry: {
    tool: string;
    tier: Tier;
    outcome: AgentOutcome;
    targets: string[];
    argsDigest: string;
    summary: string;
    meta: WriteMeta;
    requestId?: string | null;
  },
): Promise<string> {
  const undo = entry.meta.undo?.length ? entry.meta.undo : null;
  return (
    await db.query<{ id: string }>(
      `INSERT INTO agent_activity (user_id, grant_id, client_name, tool, tier,
         team_id, target_ids, args_digest, summary, outcome, proposal_id,
         request_id, undo, undo_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
         CASE WHEN $13::jsonb IS NULL THEN NULL
              ELSE now() + make_interval(days => $14) END)
       RETURNING id::text`,
      [
        p.user.id,
        p.grant_id,
        p.client.name.slice(0, 200),
        entry.tool,
        entry.tier,
        entry.meta.team_id ?? null,
        entry.targets.slice(0, 20),
        entry.argsDigest,
        entry.summary.slice(0, 300),
        entry.outcome,
        entry.meta.proposal_id?.replace(/^proposal:/, "") ?? null,
        entry.requestId?.slice(0, 64) ?? null,
        undo ? JSON.stringify(undo) : null,
        UNDO_DAYS,
      ],
    )
  ).rows[0].id;
}

/** The write transaction as a Db (capabilities get it as Queryable). */
export const dbOf = (ctx: CapabilityContext) => ctx.db as Db;

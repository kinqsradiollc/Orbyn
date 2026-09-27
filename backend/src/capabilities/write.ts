import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AGENT_BULK_LIMIT,
  type AgentAskFirst,
  type AgentOutcome,
  type ReviewChangeInput,
} from "@orbyn/core";
import { pool, type Db, type Queryable } from "../db/pool.js";
import type { UserRow } from "../lib/auth.js";
import { createAgentProposal } from "../modules/proposals/service.js";
import { announceTo } from "../modules/presence/live.js";
import { policy, type Principal } from "./policy.js";
import {
  CapabilityError,
  type Annotations,
  type AskReason,
  type CapabilityContext,
  type Effect,
  type Tier,
} from "./registry.js";
import { refUrl } from "./refs.js";
import { UNDO_DAYS, type UndoOp } from "./undo.js";

/**
 * What every change an agent makes shares: where it goes (made directly,
 * asked about, or to the Review inbox), idempotency by client_ref, the
 * activity row with its undo, and refusing credentials in what is written.
 *
 * Where a change goes follows the connection's trust in the space
 * (policy.trustIn):
 * - full power: made directly, deletes and moves included (each with its
 *   undo for 30 days), except the ask-first list (AGENT_ASK_FIRST): a
 *   teammate's work, emailing or inviting people, publishing, bookings
 *   with people not met yet, team admin, the person's profile, and more
 *   than 50 changes at once. The person can let a connection do any of
 *   those alone;
 * - ask: every change asks first;
 * - suggest (or a space the connection or team caps at suggesting):
 *   everything goes to the Review inbox (team pages get suggestions).
 * Asking happens in the chat when the app can (form elicitation, see
 * ctx.asking); otherwise the change waits in the Review inbox, with a
 * push that can approve or decline it.
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
    "Idempotency key: sent again within 24 h, the first answer comes back.",
  );

/** The most items one call changes (proposals hold up to 50). */
export const MAX_BATCH = 25;

export type Destination = "direct" | "review";

/** What destination() needs to know beyond the space and tier. */
export type DestinationOptions = {
  /**
   * Who an existing thing belongs to: a team thing someone else made (or
   * was given) is a teammate's work.
   */
  owner?: { user_id: string | null; assignee_id?: string | null } | null;
  /** An ask-first item the change is, with why in words. */
  asks?: AgentAskFirst;
  why?: string;
  /** How many things the call changes (over 50 asks first). */
  count?: number;
};

/** Why each ask-first item asks, when nothing more specific is known. */
const ASK_WHY: Record<AgentAskFirst, string> = {
  teammates: "it changes a teammate's work",
  people: "it invites or emails people",
  publishing: "it shares or publishes outside the team",
  bookings: "it's a booking with someone you haven't met",
  team_admin: "it changes how a team is run",
  profile: "it changes your profile",
  bulk: `it changes more than ${AGENT_BULK_LIMIT} things at once`,
};

/**
 * Whether a thing in a team is a teammate's: it was given to someone else,
 * or (given to nobody) someone else made it. Something given to the
 * person is theirs, whoever made it.
 */
export function teammatesWork(
  p: Principal,
  teamId: string | null,
  owner: DestinationOptions["owner"],
): boolean {
  if (!teamId || !owner) return false;
  const me = p.user.id;
  if (owner.assignee_id) return owner.assignee_id !== me;
  return !!owner.user_id && owner.user_id !== me;
}

/**
 * Where a change in `teamId`'s space goes. NOT_FOUND when the connection
 * can't reach the space; READ_ONLY when it can only read there.
 */
export function destination(
  ctx: CapabilityContext,
  teamId: string | null,
  tier: Tier,
  effects: Effect[] = [],
  options: DestinationOptions = {},
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
  const trust = policy.trustIn(p, teamId);
  if ((level === "suggest" || trust === "suggest") && !ctx.asking?.reviewed)
    return "review";
  const reasons: AskReason[] = [];
  const need = (kind: AgentAskFirst, text = ASK_WHY[kind]) => {
    if (!p.trust.acts_alone.includes(kind)) reasons.push({ kind, text });
  };
  if (trust === "ask")
    reasons.push({
      kind: "every_change",
      text: "this connection asks you before every change",
    });
  else {
    if (effects.includes("email_outside"))
      need("people", "it emails people outside Orbyn");
    if (effects.includes("publish")) need("publishing");
    if (effects.includes("notify_member") && !p.flags.notify_teammates)
      need("teammates", "it notifies a teammate");
    if (tier !== "W1" && teammatesWork(p, teamId, options.owner))
      need("teammates");
    if (options.asks) need(options.asks, options.why);
    if ((options.count ?? 0) > AGENT_BULK_LIMIT)
      need("bulk", `it changes ${options.count} things at once`);
  }
  if (!reasons.length) return "direct";
  return askFirst(ctx, reasons);
}

/**
 * A change that needs the person first: made directly once they said yes
 * in the chat; noted (and carried on with, to be asked about as a whole)
 * while collecting; otherwise to the Review inbox.
 */
function askFirst(ctx: CapabilityContext, reasons: AskReason[]): Destination {
  const asking = ctx.asking;
  if (asking?.mode === "approved") return "direct";
  if (asking?.mode === "collect") {
    for (const r of reasons)
      if (!asking.reasons.some((x) => x.text === r.text))
        asking.reasons.push(r);
    return "direct";
  }
  return "review";
}

/**
 * The refusal for a change that can't wait in the Review inbox when it
 * would have to: the connection only suggests there, or asks first and the
 * app can't ask in the chat.
 */
export function cantWait(
  ctx: CapabilityContext,
  teamId: string | null,
): CapabilityError {
  const p = ctx.principal;
  const suggests =
    policy.levelIn(p, teamId) === "suggest" ||
    policy.trustIn(p, teamId) === "suggest";
  return suggests
    ? new CapabilityError(
        "FORBIDDEN",
        "This connection can only suggest changes there.",
        "Use propose_changes, or ask the person to make the change in Orbyn.",
      )
    : new CapabilityError(
        "FORBIDDEN",
        "This change needs the person's yes first, and this app can't ask them in the chat.",
        "Use propose_changes, ask the person to let this connection do it alone in Settings → Connected agents, or ask them to make it in Orbyn.",
      );
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
  /**
   * The job the change belongs to, when not the request's own (apply_plan
   * gives every step one job id, so undo({job}) takes the plan back).
   */
  job?: string;
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
        (entry.meta.job ?? entry.requestId)?.slice(0, 64) ?? null,
        undo ? JSON.stringify(undo) : null,
        UNDO_DAYS,
      ],
    )
  ).rows[0].id;
}

/** The write transaction as a Db (capabilities get it as Queryable). */
export const dbOf = (ctx: CapabilityContext) => ctx.db as Db;

// --- What the write tools share -------------------------------------------

/** One thing a change made or changed, as the answer lists it. */
export const doneEntry = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  /** Its version now (tasks and pages), for the next change. */
  version: z.number().nullable(),
  change: z.string(),
});
export type DoneEntry = z.output<typeof doneEntry>;

/** Something asked for that wasn't done, and why. */
export const skippedEntry = z.object({ index: z.number(), reason: z.string() });

/**
 * Every write tool's answer: what was made directly, what waits in the
 * Review inbox (one proposal for the rest), and what was left out.
 */
export const writeOutput = z.object({
  status: z.enum(["done", "pending_review", "partly_pending"]),
  done: z.array(doneEntry),
  pending: pendingOutput.nullable(),
  skipped: z.array(skippedEntry),
});
export type WriteAnswer = z.output<typeof writeOutput>;

/**
 * The answer for a write, filing whatever goes to review as one proposal.
 * `undo` and `after` come from the changes made directly.
 */
export async function finishWrite(
  ctx: CapabilityContext,
  what: string,
  parts: {
    done: DoneEntry[];
    review?: ReviewChangeInput[];
    reviewSummary?: string;
    skipped?: { index: number; reason: string }[];
    undo?: UndoOp[];
    after?: (() => Promise<void>)[];
    teamId?: string | null;
    outcome?: AgentOutcome;
  },
) {
  const review = parts.review ?? [];
  const pending = review.length
    ? await toReview(ctx, parts.reviewSummary ?? what, review)
    : null;
  const skipped = parts.skipped ?? [];
  const status: WriteAnswer["status"] = !pending
    ? "done"
    : parts.done.length
      ? "partly_pending"
      : "pending_review";
  const { targets: pendingTargets = [], ...pendingOut } = pending ?? {};
  const structured: WriteAnswer = {
    status,
    done: parts.done,
    pending: pending ? (pendingOut as Pending) : null,
    skipped,
  };
  const lines = [
    ...parts.done.map(
      (d) => `- ${d.change}: ${d.title}\n  id: ${d.id} · open: ${d.url}`,
    ),
    ...skipped.map((s) => `- Not done (#${s.index + 1}): ${s.reason}`),
  ];
  const head = parts.done.length
    ? `${what}: ${parts.done.length} done${skipped.length ? `, ${skipped.length} not done` : ""}.`
    : skipped.length && !pending
      ? `${what}: nothing changed.`
      : "";
  const markdown = [
    head,
    ...lines,
    ...(pending
      ? [pendingText(parts.done.length ? "The rest" : what, pending)]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
  const outcome: AgentOutcome =
    parts.outcome ??
    (pending && !parts.done.length
      ? "proposed"
      : !parts.done.length && skipped.length
        ? "error"
        : "ok");
  // Records and templates have no news of their own outside their routes:
  // once committed, each one changed here is named, so agents following
  // orbyn://record/<id> or orbyn://template/<id> hear of it.
  const named = [
    ...new Set(
      parts.done
        .map((d) => /^(record|template):([0-9a-f-]{36})$/i.exec(d.id))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => `${m[1].toLowerCase()}:${m[2].toLowerCase()}`),
    ),
  ].slice(0, 20);
  const audience = parts.teamId
    ? { team_id: parts.teamId }
    : { user_id: ctx.principal.user.id };
  const after = [
    ...(parts.after ?? []),
    ...named.map((ref) => async () => {
      const [type, id] = ref.split(":") as ["record" | "template", string];
      await announceTo(pool, audience, "changed", {
        area: type === "record" ? "records" : "templates",
        entity_type: type,
        entity_id: id,
      });
    }),
  ];
  return {
    structured,
    markdown,
    targets: [...parts.done.map((d) => d.id), ...pendingTargets],
    links: parts.done.slice(0, 20).map((d) => ({
      uri: d.id
        .replace(/^event:/, "task:")
        .replace(/^(\w+):([0-9a-f-]{36}).*$/, "orbyn://$1/$2"),
      name: d.title || d.id,
    })),
    write: {
      outcome,
      proposal_id: pending?.proposal_id ?? null,
      undo: parts.undo,
      team_id: parts.teamId ?? null,
      after: after.length ? after : undefined,
    } satisfies WriteMeta,
  };
}

/**
 * Whether a change to something in `teamId` reaches teammates' webhooks
 * (a team change is sent to every member's webhooks listening for it), so
 * it counts as reaching outside Orbyn.
 */
export async function teammatesListen(
  db: Queryable,
  teamId: string | null,
  userId: string,
  events: string[],
): Promise<boolean> {
  if (!teamId) return false;
  return !!(
    await db.query(
      `SELECT 1 FROM webhooks w
        WHERE w.active AND w.events && $3::text[] AND w.user_id <> $2
          AND w.user_id IN (SELECT user_id FROM team_members WHERE team_id = $1)
        LIMIT 1`,
      [teamId, userId, events],
    )
  ).rowCount;
}

/**
 * An ISO 8601 time with its offset ("2026-10-02T15:00:00+10:00"). Checked
 * here rather than with a pattern, which would bloat every tool schema.
 */
export const isoTime = z
  .string()
  .max(40)
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
        v,
      ) && !Number.isNaN(Date.parse(v)),
    "Use an ISO 8601 time with its offset, like 2026-10-02T15:00:00+10:00.",
  )
  .meta({ format: "date-time" });

/** An id (a uuid), checked without a schema pattern. */
export const idField = z
  .string()
  .max(36)
  .refine(
    (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "Use an id (a uuid).",
  )
  .transform((v) => v.toLowerCase())
  .meta({ format: "uuid" });

/** An email address, checked without a schema pattern. */
export const emailField = z
  .string()
  .max(320)
  .refine(
    (v) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v),
    "Use an email address.",
  )
  .meta({ format: "email" });

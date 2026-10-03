import { assistantNightWindow } from "../../worker/night-window.js";
import { captureMaintainedPageModelOrigin } from "./maintenance-model.js";
import { randomUUID } from "node:crypto";
import {
  applyMaintainedPagePatch,
  assistantRuleDecision,
  maintainedPagePatchInput,
  nextOccurrence,
  fail,
  HttpError,
  nightShiftInput,
  maintainedPageRunSummary,
  type MaintainedPageModelOrigin,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import type { Principal } from "../../capabilities/policy.js";
import { visibleDocs } from "../../lib/visibility.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { refuseSecrets } from "../../capabilities/write.js";
import { nightShiftOwns } from "../../worker/assistant-scan.js";
import {
  applyMaintainedPageUpdate,
  assertMaintainedPageFiles,
  maintainedPageContext,
  MaintainedPageReviewRequired,
} from "./maintenance.js";

export type PageRun = {
  id: string;
  binding_id: string;
  user_id: string;
  agent_grant_id: string;
  binding_revision: number;
  doc_version: number;
  assistant_rules_revision: number;
  lane: "background" | "overnight";
  night_id: string | null;
  end_at: Date | null;
  scheduled_for: Date;
  state: "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
  lease_token: string | null;
  lease_expires_at: Date | null;
  attempts: number;
  token_estimate: number;
  reserved_tokens: number;
  model_key: string | null;
  model_origin: MaintainedPageModelOrigin;
  retry_after: Date | null;
  token_budget: number;
  proposal: unknown;
  waiting_id: string | null;
  reviewed: boolean;
  requires_review: boolean;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};
export const PAGE_RUN_LEASE_MS = 60000;

/** Night policy is checked on every automatic boundary, not only when queued. */
async function requirePageNight(
  db: Db,
  userId: string,
  nightId: string,
  endAt: Date,
  now: Date,
  review = false,
) {
  const night = (
    await db.query<{ local_day: string; status: string; budget_used: number }>(
      "SELECT local_day::text,status,budget_used FROM assistant_nights WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [nightId, userId],
    )
  ).rows[0];
  if (!night) fail(404, "Night run not found.");
  if (review) return { night, waitForOk: true };
  if (
    night.status !== "running" ||
    !Number.isFinite(endAt.getTime()) ||
    endAt <= now
  )
    fail(409, "The night window ended.");
  const settings = (
    await db.query<{ night_shift: unknown }>(
      "SELECT night_shift FROM agent_settings WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  const prefs = nightShiftInput.safeParse(settings?.night_shift);
  if (!prefs.success || !prefs.data.enabled || !prefs.data.kinds.follow_through)
    fail(409, "Page updates are disabled for this night.");
  const window = assistantNightWindow(now, prefs.data);
  if (!window || window.localDay !== night.local_day)
    fail(409, "The night window changed or ended.");
  return { night, waitForOk: prefs.data.wait_for_ok };
}

/** Server-selected schedule/lane; queue rows contain references, never source text. */
export async function queueMaintainedPageRun(
  db: Db,
  user: UserRow,
  principal: Principal,
  bindingId: string,
  now: Date,
  lane:
    | { kind: "background" }
    | { kind: "overnight"; nightId: string; endAt: Date },
) {
  const queuedNightPolicy =
    lane.kind === "overnight"
      ? await requirePageNight(db, user.id, lane.nightId, lane.endAt, now)
      : null;
  const context = await maintainedPageContext(db, user, principal, bindingId);
  const binding = context.binding;
  if (
    binding.paused ||
    binding.schedule_exhausted ||
    Date.parse(binding.next_run_at) > now.getTime()
  )
    return null;
  if (lane.kind === "background") {
    if (
      (
        await db.query<{ owned: boolean }>(
          `SELECT ${nightShiftOwns("$1::uuid")} AS owned`,
          [user.id],
        )
      ).rows[0].owned
    )
      return null;
  }
  const active = await db.query(
    "SELECT 1 FROM assistant_page_runs WHERE binding_id=$1 AND state IN ('queued','running','waiting')",
    [bindingId],
  );
  if (active.rowCount) return null;
  const next = nextOccurrence(
    new Date(binding.next_run_at),
    binding.rrule,
    binding.timezone,
    now,
  );
  const modelOrigin = await captureMaintainedPageModelOrigin(db, user.id);
  const run = (
    await db.query<PageRun>(
      `INSERT INTO assistant_page_runs(binding_id,user_id,agent_grant_id,binding_revision,doc_version,assistant_rules_revision,lane,night_id,end_at,scheduled_for,model_origin,requires_review)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) ON CONFLICT DO NOTHING RETURNING *`,
      [
        bindingId,
        user.id,
        context.principal.grant_id,
        binding.revision,
        binding.snapshot.doc_version,
        context.principal.assistant_rules_revision ?? 1,
        lane.kind,
        lane.kind === "overnight" ? lane.nightId : null,
        lane.kind === "overnight" ? lane.endAt : null,
        binding.next_run_at,
        JSON.stringify(modelOrigin),
        queuedNightPolicy?.waitForOk ?? false,
      ],
    )
  ).rows[0];
  if (!run) return null;
  await db.query(
    "UPDATE assistant_page_bindings SET next_run_at=coalesce($2,next_run_at),schedule_exhausted=$3,updated_at=now() WHERE id=$1",
    [bindingId, next, next === null],
  );
  return run;
}

/** Expired windows and invalidated references release their schedule without keeping private output. */
export async function expireMaintainedPageRuns(
  db: Db,
  lane: PageRun["lane"],
  now = new Date(),
) {
  await db.query(
    `UPDATE assistant_page_runs r SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,
    waiting_id=NULL,proposal=NULL,error_message='The page run expired or its authority changed.',updated_at=$1
   WHERE r.lane=$2 AND r.state IN ('queued','running','waiting') AND (
     (r.end_at IS NOT NULL AND r.end_at<=$1 AND r.state<>'waiting')
     OR (r.state='waiting' AND r.updated_at<=$1-interval '7 days')
     OR EXISTS(SELECT 1 FROM assistant_page_bindings b JOIN docs d ON d.id=b.doc_id
       WHERE b.id=r.binding_id AND (b.paused OR b.revision<>r.binding_revision OR d.version<>r.doc_version OR d.deleted_at IS NOT NULL))
     OR EXISTS(SELECT 1 FROM users u WHERE u.id=r.user_id AND u.disabled)
     OR EXISTS(SELECT 1 FROM agent_grants g WHERE g.id=r.agent_grant_id AND
       (g.revoked_at IS NOT NULL OR g.suspended_at IS NOT NULL OR g.assistant_rules_revision<>r.assistant_rules_revision
        OR (g.expires_at IS NOT NULL AND g.expires_at<=$1)))
   )`,
    [now, lane],
  );
}

/** A lost worker cannot mark another worker's run failed or publish its error. */
export async function failMaintainedPageRun(
  db: Db,
  runId: string,
  leaseToken: string,
  reason:
    | "authority_changed"
    | "source_changed"
    | "provider_failed"
    | "budget_exceeded",
  now = new Date(),
) {
  const reasons = {
    authority_changed: "The assistant's authority changed.",
    source_changed: "The page or binding changed.",
    provider_failed: "The model request could not finish.",
    budget_exceeded: "The page run reached its token budget.",
  };
  const row = await db.query(
    `UPDATE assistant_page_runs SET state='failed',lease_token=NULL,lease_expires_at=NULL,
    waiting_id=NULL,proposal=NULL,error_message=$3,updated_at=$4
    WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>$4 RETURNING id`,
    [runId, leaseToken, reasons[reason], now],
  );
  return !!row.rowCount;
}

/** One lane claims a queued run, or takes over a dead worker with a fresh lease. */
export async function claimMaintainedPageRun(
  db: Db,
  lane: PageRun["lane"],
  now = new Date(),
  runId?: string,
): Promise<PageRun | null> {
  await expireMaintainedPageRuns(db, lane, now);
  // Exhausted leases terminate instead of repeatedly charging a stalled provider.
  await db.query(
    `UPDATE assistant_page_runs SET state='failed',lease_token=NULL,lease_expires_at=NULL,
      waiting_id=NULL,error_message='The worker retry limit was reached.',updated_at=$1
    WHERE lane=$2 AND state='running' AND lease_expires_at<=$1 AND (attempts>=5 OR reserved_tokens>0)`,
    [now, lane],
  );
  const row = (
    await db.query<PageRun>(
      `SELECT r.* FROM assistant_page_runs r JOIN assistant_page_bindings b ON b.id=r.binding_id
     WHERE r.lane=$1 AND r.attempts<5 AND ($3::uuid IS NULL OR r.id=$3)
       AND (r.retry_after IS NULL OR r.retry_after<=$2) AND (r.state='queued' OR (r.state='running' AND r.lease_expires_at<=$2))
       AND NOT b.paused AND b.revision=r.binding_revision AND b.snapshot->>'doc_version'=r.doc_version::text
       AND (r.end_at IS NULL OR r.end_at>$2)
     ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
      [lane, now, runId ?? null],
    )
  ).rows[0];
  if (!row) return null;
  return (
    await db.query<PageRun>(
      `UPDATE assistant_page_runs SET state='running',lease_token=$2,lease_expires_at=$3,
      attempts=attempts+1,updated_at=$4 WHERE id=$1 RETURNING *`,
      [row.id, randomUUID(), new Date(now.getTime() + PAGE_RUN_LEASE_MS), now],
    )
  ).rows[0];
}

function assertRunLease(run: PageRun, leaseToken: string | null, now: Date) {
  if (leaseToken !== null && run.end_at && run.end_at <= now)
    fail(409, "The night window ended.");
  if (leaseToken === null) {
    if (run.state !== "waiting")
      fail(409, "This run is not awaiting a decision.");
  } else if (
    run.state !== "running" ||
    run.lease_token !== leaseToken ||
    !run.lease_expires_at ||
    run.lease_expires_at <= now
  ) {
    fail(409, "This worker no longer owns the page run.");
  }
}

/** Fresh context and job ownership are rechecked before model/stage/review/apply. */
export async function guardMaintainedPageRun(
  db: Db,
  runId: string,
  leaseToken: string | null,
  now = new Date(),
  userId?: string,
) {
  const seen = (
    await db.query<PageRun>("SELECT * FROM assistant_page_runs WHERE id=$1", [
      runId,
    ])
  ).rows[0];
  if (!seen || (userId && seen.user_id !== userId))
    fail(404, "Page run not found.");
  assertRunLease(seen, leaseToken, now);
  let nightAvailableTokens: number | null = null;
  let nightWaitForOk = false;
  if (seen.night_id && seen.end_at) {
    const { night, waitForOk } = await requirePageNight(
      db,
      seen.user_id,
      seen.night_id,
      seen.end_at,
      now,
      leaseToken === null,
    );
    nightWaitForOk = waitForOk;
    const cap = (
      await db.query<{ night_token_budget: number }>(
        "SELECT night_token_budget FROM ai_settings WHERE id",
      )
    ).rows[0].night_token_budget;
    nightAvailableTokens = Math.max(0, cap - night.budget_used);
  }
  const user = (
    await db.query<UserRow>(
      "SELECT * FROM users WHERE id=$1 AND NOT disabled",
      [seen.user_id],
    )
  ).rows[0];
  if (!user) fail(403, "This account is unavailable.");
  const principal: Principal = {
    ...(await assistantPrincipal(user, { db, touch: false })),
    assistant_lane: seen.lane,
    unattended: seen.lane === "overnight",
    assistant_rules_revision: seen.assistant_rules_revision,
  };
  if (principal.grant_id !== seen.agent_grant_id)
    fail(403, "This run belongs to another assistant.");
  const context = await maintainedPageContext(
    db,
    user,
    principal,
    seen.binding_id,
  );
  const page = (
    await db.query<{ team_id: string | null }>(
      "SELECT team_id FROM docs WHERE id=$1",
      [context.binding.doc_id],
    )
  ).rows[0];
  if (
    assistantRuleDecision(
      context.principal.assistant_rules ?? [],
      seen.lane,
      page.team_id,
      ["any_change", "edit"],
    ) === "deny"
  )
    fail(403, "A reviewed assistant rule forbids this page update.");
  const run = (
    await db.query<PageRun>(
      "SELECT * FROM assistant_page_runs WHERE id=$1 FOR UPDATE",
      [runId],
    )
  ).rows[0];
  if (!run || run.binding_id !== seen.binding_id)
    fail(404, "Page run not found.");
  if (
    context.binding.paused ||
    context.binding.revision !== run.binding_revision ||
    context.binding.snapshot.doc_version !== run.doc_version
  )
    fail(409, "This run or its page binding changed.");
  assertRunLease(run, leaseToken, now);
  return {
    run,
    user,
    principal: context.principal,
    binding: context.binding,
    blocks: context.blocks,
    nightAvailableTokens,
    nightWaitForOk,
  };
}

/** A heartbeat cannot preserve a run whose grant/source/ownership has changed. */
export async function renewMaintainedPageRun(
  db: Db,
  runId: string,
  leaseToken: string,
  now = new Date(),
) {
  await guardMaintainedPageRun(db, runId, leaseToken, now);
  await db.query(
    "UPDATE assistant_page_runs SET lease_expires_at=$2,updated_at=$3 WHERE id=$1",
    [runId, new Date(now.getTime() + PAGE_RUN_LEASE_MS), now],
  );
}

/** Stage bounded generated replacements, never a caller-selected full-page snapshot. */
export async function stageMaintainedPageRun(
  db: Db,
  runId: string,
  leaseToken: string,
  raw: unknown,
  tokens: number,
  now = new Date(),
) {
  const context = await guardMaintainedPageRun(db, runId, leaseToken, now);
  const proposal = maintainedPagePatchInput.parse(raw);
  if (proposal.expected_revision !== context.run.binding_revision)
    fail(409, "The generated result belongs to another binding revision.");
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    tokens + context.run.token_estimate - context.run.reserved_tokens >
      context.run.token_budget ||
    (context.run.reserved_tokens > 0 && tokens > context.run.reserved_tokens)
  )
    throw new PageRunBudgetExceeded("This page run reached its token budget.");
  assertMaintainedPageFiles(context.blocks, proposal.replacements);
  const serialized = JSON.stringify(proposal);
  if (Buffer.byteLength(serialized) > 262144)
    fail(422, "The generated page update is too large.");
  refuseSecrets(serialized);
  const checked = applyMaintainedPagePatch(
    context.blocks,
    context.run.doc_version,
    {
      ...context.binding.snapshot,
      blocks: context.binding.snapshot.blocks.map((b, index) => ({
        ...b,
        position: index,
      })),
    },
    proposal.replacements,
  );
  // The provider saw only selected blocks; absolute positions remain authoritative in the binding.
  if (!checked.ok)
    fail(409, "The generated update targets blocks outside this binding.");
  if (context.run.proposal !== null)
    fail(409, "This run already has a staged result.");
  if (context.run.night_id) {
    const cap = (
      await db.query<{ night_token_budget: number }>(
        "SELECT night_token_budget FROM ai_settings WHERE id FOR SHARE",
      )
    ).rows[0].night_token_budget;
    const additional = tokens - context.run.reserved_tokens;
    const accepted = await db.query(
      `UPDATE assistant_nights SET budget_used=budget_used+$2,updated_at=$3
      WHERE id=$1 AND budget_used+$2 BETWEEN 0 AND $4 RETURNING id`,
      [context.run.night_id, additional, now, cap],
    );
    if (!accepted.rowCount)
      throw new PageRunBudgetExceeded(
        "The night reached its shared token budget.",
      );
  }
  await db.query(
    "UPDATE assistant_page_runs SET proposal=$2::jsonb,token_estimate=token_estimate-reserved_tokens+$3,reserved_tokens=0,updated_at=$4 WHERE id=$1",
    [runId, serialized, tokens, now],
  );
}

/** Approval is bound to one saved waiting card and its original authority revision. */
export async function decideMaintainedPageRun(
  db: Db,
  userId: string,
  runId: string,
  waitingId: string,
  approved: boolean,
  now = new Date(),
) {
  const context = await guardMaintainedPageRun(db, runId, null, now, userId);
  if (context.run.waiting_id !== waitingId)
    fail(409, "This decision card changed. Reload it.");
  if (!approved) {
    await db.query(
      `UPDATE assistant_page_runs SET state='cancelled',waiting_id=NULL,proposal=NULL,updated_at=$2 WHERE id=$1`,
      [runId, now],
    );
    return { state: "cancelled" as const };
  }
  // A person applies exactly the saved patch; this never resumes a night model runtime.
  if (!context.run.proposal) fail(409, "This run has no saved update.");
  const result = await applyMaintainedPageUpdate(
    db,
    context.user,
    { ...context.principal, unattended: false },
    context.binding.id,
    context.run.proposal,
    { asking: { mode: "approved", reviewed: true, reasons: [] } },
  );
  await db.query(
    `UPDATE assistant_page_runs SET state='done',waiting_id=NULL,reviewed=true,error_message=NULL,updated_at=$2 WHERE id=$1`,
    [runId, now],
  );
  return { state: "done" as const, ...result };
}

/** Caller owns the transaction: page save and job completion commit together. */
export async function applyMaintainedPageRun(
  db: Db,
  runId: string,
  leaseToken: string,
  now = new Date(),
) {
  const context = await guardMaintainedPageRun(db, runId, leaseToken, now);
  if (!context.run.proposal) fail(409, "This run has no generated update.");
  if (
    (context.nightWaitForOk || context.run.requires_review) &&
    !context.run.reviewed
  )
    throw new MaintainedPageReviewRequired(
      "Review this saved Overnight page update.",
    );
  const result = await applyMaintainedPageUpdate(
    db,
    context.user,
    context.principal,
    context.binding.id,
    context.run.proposal,
    context.run.reviewed
      ? { asking: { mode: "approved", reviewed: true, reasons: [] } }
      : {},
  );
  await db.query(
    `UPDATE assistant_page_runs SET state='done',lease_token=NULL,lease_expires_at=NULL,
    waiting_id=NULL,updated_at=$2 WHERE id=$1`,
    [runId, now],
  );
  return result;
}

/** Called after an apply transaction rolls back specifically because review is required. */
export async function waitMaintainedPageRun(
  db: Db,
  runId: string,
  leaseToken: string,
  error: unknown,
  now = new Date(),
) {
  if (!(error instanceof MaintainedPageReviewRequired)) throw error;
  const context = await guardMaintainedPageRun(db, runId, leaseToken, now);
  if (!context.run.proposal) fail(409, "This run has no generated update.");
  const waitingId = randomUUID();
  await db.query(
    `UPDATE assistant_page_runs SET state='waiting',waiting_id=$2,lease_token=NULL,
    lease_expires_at=NULL,updated_at=$3 WHERE id=$1`,
    [runId, waitingId, now],
  );
  return waitingId;
}

/** Reserve cost before transmission. Unconfirmed in-flight requests are never retried automatically. */
export async function reserveMaintainedPageModel(
  db: Db,
  runId: string,
  leaseToken: string,
  tokens: number,
  modelKey: string,
  now = new Date(),
) {
  const { run } = await guardMaintainedPageRun(db, runId, leaseToken, now);
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 1 ||
    tokens + run.token_estimate > run.token_budget
  )
    throw new PageRunBudgetExceeded("This page run reached its token budget.");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(modelKey))
    fail(422, "Use a supported model reference.");
  if (run.proposal || run.reserved_tokens || run.model_key)
    fail(409, "This run already started its model request.");
  if (run.night_id) {
    // The night guard already holds this row; reserve against all existing night work.
    const cap = (
      await db.query<{ night_token_budget: number }>(
        "SELECT night_token_budget FROM ai_settings WHERE id FOR SHARE",
      )
    ).rows[0].night_token_budget;
    const charged = await db.query(
      `UPDATE assistant_nights SET budget_used=budget_used+$3,updated_at=$4
      WHERE id=$1 AND user_id=$2 AND status='running' AND budget_used+$3<=$5 RETURNING id`,
      [run.night_id, run.user_id, tokens, now, cap],
    );
    if (!charged.rowCount)
      throw new PageRunBudgetExceeded(
        "The night reached its shared token budget.",
      );
  }
  await db.query(
    "UPDATE assistant_page_runs SET reserved_tokens=$2,token_estimate=token_estimate+$2,model_key=$3,updated_at=$4 WHERE id=$1",
    [runId, tokens, modelKey, now],
  );
}

/** Unavailable selected runtimes wait without consuming a retry allowance or changing providers. */
export async function deferMaintainedPageModel(
  db: Db,
  runId: string,
  leaseToken: string,
  reason: "chatgpt_device_required" | "not_configured",
  now = new Date(),
) {
  const messages = {
    chatgpt_device_required:
      "This page update is waiting for its selected ChatGPT device.",
    not_configured: "Set up an assistant model to run this page update.",
  };
  await guardMaintainedPageRun(db, runId, leaseToken, now);
  await db.query(
    `UPDATE assistant_page_runs SET state='queued',lease_token=NULL,lease_expires_at=NULL,
    attempts=greatest(attempts-1,0),retry_after=$3,error_message=$4,updated_at=$5
    WHERE id=$1 AND lease_token=$2 AND reserved_tokens=0`,
    [runId, leaseToken, new Date(now.getTime() + 60000), messages[reason], now],
  );
}

/** Distinct from stale-source conflicts so the consumer reports the correct hold reason. */
export class PageRunBudgetExceeded extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

/** Owned progress reads never touch grant activity or disclose a worker lease. */
export async function listMaintainedPageRuns(
  db: Db,
  user: UserRow,
  docId: string,
) {
  const readable = await db.query(
    `SELECT d.id FROM docs d WHERE d.id=$1 AND ${visibleDocs("d", { user: "$2" })}`,
    [docId, user.id],
  );
  if (!readable.rowCount) fail(404, "Document not found.");
  const rows = (
    await db.query<PageRun>(
      `SELECT r.* FROM assistant_page_runs r JOIN assistant_page_bindings b ON b.id=r.binding_id
     WHERE r.user_id=$1 AND b.doc_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,
      [user.id, docId],
    )
  ).rows;
  const summaries = [];
  for (const run of rows) {
    let replacements = null;
    let canReview = false;
    if (run.state === "waiting" && run.waiting_id && run.proposal) {
      try {
        await guardMaintainedPageRun(db, run.id, null, new Date(), user.id);
        replacements = maintainedPagePatchInput.parse(
          run.proposal,
        ).replacements;
        canReview = true;
      } catch {
        /* Changed authority/source holds output; metadata remains owned. */
      }
    }
    summaries.push(
      maintainedPageRunSummary.parse({
        id: run.id,
        binding_id: run.binding_id,
        state: run.state,
        lane: run.lane,
        scheduled_for: run.scheduled_for.toISOString(),
        updated_at: run.updated_at.toISOString(),
        estimated_tokens: run.token_estimate,
        error: run.error_message,
        waiting_id: canReview ? run.waiting_id : null,
        replacements,
        can_review: canReview,
      }),
    );
  }
  return summaries;
}

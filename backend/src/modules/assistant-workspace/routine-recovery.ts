import { LEAD_TOKEN_BUDGET } from "../ai/agent/limits.js";
import { randomUUID } from "node:crypto";
import {
  fail,
  routineRetryPolicy,
  routineRetryPolicyPage,
  routineRetryPolicyUpdate,
  routineRecoveryStop,
  type RoutineRetryPolicy,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { Params, scopeFor } from "../../lib/visibility.js";
import { policy } from "../../capabilities/policy.js";
import {
  assistantExecutionContext,
  assistantExecutionDigest,
  assistantExecutionFingerprints,
} from "./execution-authority.js";
import { scheduledConversationRoute } from "./conversation-schedules.js";

export type RoutineRecoveryBinding = {
  occurrence_id: string;
  attempt_id: string;
  generation: number;
  ordinal: number;
};
export type RoutineRecoveryRow = {
  id: string;
  owner_id: string;
  routine_id: string;
  scheduled_for: Date;
  job_id: string | null;
  recovery_version: 1 | null;
  recovery_state:
    | "active"
    | "waiting"
    | "retry_scheduled"
    | "held"
    | "limited"
    | "completed"
    | "stopped";
  lane: "background" | "overnight";
  policy_snapshot: RoutineRetryPolicy;
  policy_revision: number;
  intent_version: number;
  instruction_snapshot: string;
  config_hash: string;
  provider_hash: string;
  scope_hash: string;
  schedule_exhausted: boolean;
  deadline: Date;
  destination_id: string | null;
  personal_only: boolean;
  generation: number;
  revision: number;
  attempt_count: number;
  consumed_tokens: number;
  reserved_tokens: number;
  next_eligible_at: Date | null;
  last_transition_reason: string;
  last_control: { id: string; digest: string } | null;
  recovery_created_at: Date;
  recovery_updated_at: Date;
};
export type RoutineAttemptRow = {
  id: string;
  occurrence_id: string;
  owner_id: string;
  ordinal: number;
  parent_attempt_id: string | null;
  job_id: string | null;
  generation: number;
  allocated_tokens: number;
  settled_tokens: number | null;
  state: "queued" | "running" | "waiting" | "done" | "failed" | "unavailable";
  terminal_evidence: unknown;
  result_digest: string | null;
  created_at: Date;
  settled_at: Date | null;
};
type RoutineConfig = {
  id: string;
  instruction: string;
  rrule: string;
  timezone: string;
  paused: boolean;
  retry_policy: unknown;
  retry_policy_revision: number;
  recovery_intent_version: number;
};
export type PreparedRoutineRecovery = {
  occurrence_id: string;
  attempt_id: string;
  binding: RoutineRecoveryBinding;
  instruction: string;
  allocation: number;
  deadline: string;
  destination_id: string | null;
  personal_only: boolean;
  route: Awaited<ReturnType<typeof scheduledConversationRoute>>;
  owner_id: string;
  routine_id: string;
  scheduled_for: string;
  lane: "background" | "overnight";
  policy: RoutineRetryPolicy;
  policy_revision: number;
  intent_version: number;
  config_hash: string;
  provider_hash: string;
  scope_hash: string;
  schedule_exhausted: boolean;
  created_at: string;
};
async function config(
  db: Queryable,
  owner: string,
  routine: string,
  lock = false,
) {
  const row = (
    await db.query<RoutineConfig>(
      `SELECT id,instruction,rrule,timezone,paused,retry_policy,retry_policy_revision,recovery_intent_version FROM agent_routines WHERE id=$2 AND user_id=$1${lock ? " FOR SHARE" : ""}`,
      [owner, routine],
    )
  ).rows[0];
  if (!row) fail(404, "Assistant routine not found.");
  return row;
}
function configHash(
  row: RoutineConfig,
  settings: RoutineRetryPolicy,
  route: {
    destinationId: string | null;
    personalOnly: boolean;
    sourceEntryIds?: string[];
  },
) {
  return assistantExecutionDigest({
    instruction: row.instruction,
    rrule: row.rrule,
    timezone: row.timezone,
    policy: settings,
    policy_revision: row.retry_policy_revision,
    intent_version: row.recovery_intent_version,
    destination_id: route.destinationId,
    personal_only: route.personalOnly,
    source_entry_ids: [...(route.sourceEntryIds ?? [])].sort(),
  });
}
export async function readRoutineRecovery(
  db: Queryable,
  owner: string,
  id: string,
) {
  return (
    (
      await db.query<RoutineRecoveryRow>(
        "SELECT * FROM assistant_routine_runs WHERE id=$2 AND owner_id=$1",
        [owner, id],
      )
    ).rows[0] ?? null
  );
}
/** Caller must lock its job before locking the occurrence. Admission may lock only the occurrence before inserting its new queued job. */
export async function lockRoutineRecovery(
  db: Queryable,
  owner: string,
  id: string,
) {
  const row = (
    await db.query<RoutineRecoveryRow>(
      "SELECT * FROM assistant_routine_runs WHERE id=$2 AND owner_id=$1 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!row) fail(404, "Routine occurrence not found.");
  return row;
}
export async function routineRecoveryAttempts(
  db: Queryable,
  row: RoutineRecoveryRow,
) {
  return (
    await db.query<RoutineAttemptRow>(
      "SELECT * FROM assistant_routine_attempts WHERE occurrence_id=$1 AND owner_id=$2 ORDER BY ordinal LIMIT 5",
      [row.id, row.owner_id],
    )
  ).rows;
}
export async function routineRecoverySourcesCurrent(
  db: Queryable,
  row: RoutineRecoveryRow,
) {
  const principal = await assistantExecutionContext(db, row.owner_id, row.lane);
  if (!principal) return false;
  // Routine identity is personal-only; its literal predicate has no team placeholder.
  const params = new Params(row.routine_id),
    scope = scopeFor({ ...policy.spaces(principal), teamIds: null }, params);
  if (
    !(
      await db.query(
        `SELECT r.id FROM agent_routines r WHERE r.id=$1 AND ${assistantSourceVisible("'routine'", "r.id", scope.user, false, scope)}`,
        params.values,
      )
    ).rowCount
  )
    return false;
  const all = await routineRecoveryAttempts(db, row);
  if (!all.length || all.some((a) => !a.job_id)) return false;
  const sourceParams = new Params(all.map((a) => a.job_id)),
    sourceScope = scopeFor(policy.spaces(principal), sourceParams);
  return (
    (
      await db.query(
        `SELECT j.id FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id WHERE j.id=ANY($1::uuid[]) AND ${assistantJobSourcesVisible("j", sourceScope.user, false, sourceScope)} AND ${assistantChatVisible("c", sourceScope.user, sourceScope)}`,
        sourceParams.values,
      )
    ).rowCount === all.length
  );
}
export async function prepareRoutineRecovery(
  db: Queryable,
  owner: string,
  routine: string,
  lane: "background" | "overnight",
  scheduledFor: Date | string,
  options: {
    nextScheduledFor: Date | string | null;
    now?: Date;
    allocationCap?: number;
    expectedIntentVersion?: number;
  },
): Promise<PreparedRoutineRecovery | null> {
  const current = await config(db, owner, routine, true),
    settings = routineRetryPolicy.parse(current.retry_policy ?? {});
  if (
    options.expectedIntentVersion !== undefined &&
    current.recovery_intent_version !== options.expectedIntentVersion
  )
    fail(409, "The routine changed after its schedule was claimed.");
  if (!settings.enabled) return null;
  if (current.paused) fail(409, "This routine is paused.");
  const hashes = await assistantExecutionFingerprints(db, owner, lane),
    route = await scheduledConversationRoute(db, owner, "routine", routine);
  const now = options.now ?? new Date(),
    deadline = new Date(
      Math.min(
        now.getTime() + settings.max_elapsed_minutes * 60000,
        options.nextScheduledFor
          ? new Date(options.nextScheduledFor).getTime()
          : Infinity,
      ),
    );
  if (!Number.isFinite(deadline.getTime()) || deadline <= now)
    fail(409, "This routine occurrence has no recovery window.");
  if (
    options.allocationCap !== undefined &&
    (!Number.isSafeInteger(options.allocationCap) || options.allocationCap < 1)
  )
    fail(409, "No routine recovery allowance is available.");
  const occurrence_id = randomUUID(),
    attempt_id = randomUUID();
  return {
    occurrence_id,
    attempt_id,
    binding: { occurrence_id, attempt_id, generation: 1, ordinal: 1 },
    instruction: current.instruction,
    allocation: Math.min(
      LEAD_TOKEN_BUDGET,
      settings.token_limit,
      options.allocationCap ?? Infinity,
    ),
    deadline: deadline.toISOString(),
    destination_id: route.destinationId,
    personal_only: route.personalOnly,
    route,
    owner_id: owner,
    routine_id: routine,
    scheduled_for:
      scheduledFor instanceof Date ? scheduledFor.toISOString() : scheduledFor,
    lane,
    policy: settings,
    policy_revision: current.retry_policy_revision,
    intent_version: current.recovery_intent_version,
    config_hash: configHash(current, settings, route),
    ...hashes,
    schedule_exhausted: options.nextScheduledFor === null,
    created_at: now.toISOString(),
  };
}
/** Recheck after the scheduler advances next_run_at/auto-pauses its final occurrence. */
export async function assertPreparedRoutineRecovery(
  db: Queryable,
  owner: string,
  routine: string,
  prepared: PreparedRoutineRecovery,
) {
  const current = await config(db, owner, routine, true),
    settings = routineRetryPolicy.parse(current.retry_policy ?? {});
  const hashes = await assistantExecutionFingerprints(db, owner, prepared.lane),
    route = await scheduledConversationRoute(db, owner, "routine", routine);
  if (
    prepared.owner_id !== owner ||
    prepared.routine_id !== routine ||
    !settings.enabled ||
    (current.paused && !prepared.schedule_exhausted) ||
    configHash(current, settings, route) !== prepared.config_hash ||
    hashes.provider_hash !== prepared.provider_hash ||
    hashes.scope_hash !== prepared.scope_hash ||
    Date.parse(prepared.deadline) <= Date.now()
  )
    fail(409, "Routine recovery configuration changed before admission.");
}
export async function assertRoutineRecoveryCurrent(
  db: Queryable,
  owner: string,
  binding: RoutineRecoveryBinding,
  options: {
    jobId?: string;
    write?: boolean;
    admit?: boolean;
    now?: Date;
  } = {},
) {
  const row = await lockRoutineRecovery(db, owner, binding.occurrence_id);
  if (
    row.recovery_version !== 1 ||
    row.generation !== binding.generation ||
    ["completed", "stopped", "held"].includes(row.recovery_state)
  )
    fail(409, "This routine occurrence cannot continue.");
  const current = await config(db, owner, row.routine_id, true),
    settings = routineRetryPolicy.parse(current.retry_policy ?? {});
  const hashes = await assistantExecutionFingerprints(db, owner, row.lane),
    route = await scheduledConversationRoute(
      db,
      owner,
      "routine",
      row.routine_id,
    );
  if (
    !settings.enabled ||
    (current.paused && !row.schedule_exhausted) ||
    current.recovery_intent_version !== row.intent_version ||
    configHash(current, settings, route) !== row.config_hash ||
    hashes.provider_hash !== row.provider_hash ||
    hashes.scope_hash !== row.scope_hash
  )
    fail(409, "The routine, provider or assistant permission changed.");
  const admissionNow = options.admit ? (options.now ?? new Date()) : new Date();
  if ((options.write || options.admit) && row.deadline <= admissionNow)
    fail(409, "This routine occurrence reached its deadline.");
  if (!(await routineRecoverySourcesCurrent(db, row)))
    fail(409, "Routine recovery sources are no longer available.");
  if (options.admit) {
    if (
      row.recovery_state !== "retry_scheduled" ||
      !row.next_eligible_at ||
      row.next_eligible_at > admissionNow ||
      row.attempt_count >= row.policy_snapshot.max_attempts ||
      row.consumed_tokens + row.reserved_tokens >=
        row.policy_snapshot.token_limit ||
      (
        await db.query(
          "SELECT id FROM assistant_routine_attempts WHERE occurrence_id=$1 AND settled_at IS NULL",
          [row.id],
        )
      ).rowCount
    )
      fail(409, "Routine retry is not eligible for admission.");
  } else {
    const attempt = (
      await db.query<RoutineAttemptRow>(
        "SELECT * FROM assistant_routine_attempts WHERE id=$1 AND occurrence_id=$2 AND owner_id=$3 AND generation=$4 AND ordinal=$5 AND settled_at IS NULL",
        [
          binding.attempt_id,
          row.id,
          owner,
          binding.generation,
          binding.ordinal,
        ],
      )
    ).rows[0];
    if (!attempt || (options.jobId && attempt.job_id !== options.jobId))
      fail(409, "This job no longer owns the routine attempt.");
  }
  return row;
}
export async function readRoutineRetryPolicy(
  db: Queryable,
  owner: string,
  routine: string,
) {
  const row = await config(db, owner, routine);
  return routineRetryPolicyPage.parse({
    routine_id: routine,
    revision: row.retry_policy_revision,
    policy: routineRetryPolicy.parse(row.retry_policy ?? {}),
  });
}
export async function saveRoutineRetryPolicy(
  db: Queryable,
  owner: string,
  routine: string,
  raw: unknown,
) {
  const input = routineRetryPolicyUpdate.parse(raw),
    digest = assistantExecutionDigest(input);
  const row = (
    await db.query<
      RoutineConfig & {
        retry_policy_last_control: { id: string; digest: string } | null;
      }
    >("SELECT * FROM agent_routines WHERE id=$2 AND user_id=$1 FOR UPDATE", [
      owner,
      routine,
    ])
  ).rows[0];
  if (!row) fail(404, "Assistant routine not found.");
  if (row.retry_policy_last_control?.id === input.request_id) {
    if (row.retry_policy_last_control.digest !== digest)
      fail(409, "This request already changed different recovery settings.");
    return readRoutineRetryPolicy(db, owner, routine);
  }
  if (row.retry_policy_revision !== input.expected_revision)
    fail(409, "Recovery settings changed. Refresh before saving.");
  if (
    assistantExecutionDigest(input.policy) ===
    assistantExecutionDigest(routineRetryPolicy.parse(row.retry_policy ?? {}))
  ) {
    await db.query(
      "UPDATE agent_routines SET retry_policy_last_control=$3::jsonb WHERE id=$2 AND user_id=$1",
      [owner, routine, JSON.stringify({ id: input.request_id, digest })],
    );
    return readRoutineRetryPolicy(db, owner, routine);
  }
  await db.query(
    "UPDATE agent_routines SET retry_policy=$3::jsonb,retry_policy_revision=retry_policy_revision+1,recovery_intent_version=recovery_intent_version+1,retry_policy_last_control=$4::jsonb,updated_at=clock_timestamp() WHERE id=$2 AND user_id=$1",
    [
      owner,
      routine,
      JSON.stringify(input.policy),
      JSON.stringify({ id: input.request_id, digest }),
    ],
  );
  return readRoutineRetryPolicy(db, owner, routine);
}
export async function stopRoutineRecovery(
  db: Queryable,
  owner: string,
  routine: string,
  id: string,
  raw: unknown,
) {
  const input = routineRecoveryStop.parse(raw),
    digest = assistantExecutionDigest(input),
    seen = await readRoutineRecovery(db, owner, id);
  if (!seen || seen.routine_id !== routine)
    fail(404, "Routine occurrence not found.");
  if (seen.recovery_version !== 1)
    fail(409, "This historical occurrence has no recovery controls.");
  const identities = async () =>
    (
      await db.query<{ id: string; job_id: string | null }>(
        "SELECT id,job_id FROM assistant_routine_attempts WHERE occurrence_id=$1 AND owner_id=$2 ORDER BY id",
        [id, owner],
      )
    ).rows;
  const before = await identities(),
    jobs = before.flatMap((a) => (a.job_id ? [a.job_id] : [])).sort();
  await db.query(
    "SELECT id FROM ai_jobs WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [owner, jobs],
  );
  const row = await lockRoutineRecovery(db, owner, id);
  if (
    row.revision !== seen.revision ||
    assistantExecutionDigest(before) !==
      assistantExecutionDigest(await identities())
  )
    fail(409, "Routine work changed. Refresh before stopping.");
  if (row.last_control?.id === input.request_id) {
    if (row.last_control.digest !== digest)
      fail(409, "This request already controls different work.");
    return { jobs };
  }
  if (
    row.revision !== input.expected_revision ||
    row.generation !== input.generation ||
    ["completed", "stopped"].includes(row.recovery_state)
  )
    fail(409, "This occurrence changed or is already closed.");
  await db.query(
    "UPDATE ai_jobs SET cancel_requested=true,cancel_reason='stopped' WHERE user_id=$1 AND id=ANY($2::uuid[]) AND state IN ('queued','running','waiting')",
    [owner, jobs],
  );
  await db.query(
    "UPDATE assistant_routine_runs SET recovery_state='stopped',generation=generation+1,revision=revision+1,next_eligible_at=NULL,last_transition_reason='Stopped by you',last_control=$3::jsonb,recovery_updated_at=clock_timestamp() WHERE id=$2 AND owner_id=$1",
    [owner, id, JSON.stringify({ id: input.request_id, digest })],
  );
  return { jobs };
}

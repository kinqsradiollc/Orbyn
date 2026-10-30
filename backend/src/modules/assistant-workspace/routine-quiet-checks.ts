import { randomUUID } from "node:crypto";
import {
  fail,
  routineQuietPolicy,
  routineQuietPolicyPage,
  updateRoutineQuietPolicyInput,
  type RoutineQuietPolicy,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import {
  readCurrentQuietProjection,
  type QuietReadEvidence,
} from "./quiet-projection.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { Params, scopeFor } from "../../lib/visibility.js";
import { policy as capabilityPolicy } from "../../capabilities/policy.js";
export type { QuietReadEvidence } from "./quiet-projection.js";
import { assertAssistantLease } from "../ai/agent/lease.js";
import {
  assistantExecutionContext,
  assistantExecutionDigest,
  assistantExecutionFingerprints,
} from "./execution-authority.js";
import { scheduledConversationRoute } from "./conversation-schedules.js";

export type QuietCheckBinding = { check_id: string };
export type QuietSource = { kind: "task" | "doc"; id: string };

export type QuietCheckRow = {
  id: string;
  owner_id: string;
  routine_id: string;
  occurrence_id: string | null;
  job_id: string | null;
  lane: "background" | "overnight";
  policy_snapshot: RoutineQuietPolicy;
  projection_version: 1;
  config_hash: string;
  provider_hash: string;
  scope_hash: string;
  intent_version: number;
  baseline_check_id: string | null;
  requested: boolean;
  decision_seen: boolean;
  status:
    | "pending"
    | "baseline"
    | "verified_unchanged"
    | "changed"
    | "reported"
    | "incomplete";
  reason: string;
  expected_count: number;
  checked_count: number;
  observed_at: Date | null;
  snapshot_aggregate: QuietSnapshot[] | null;
  created_at: Date;
};
export type QuietSnapshot = {
  kind: "task" | "doc";
  id: string;
  revision: string;
  digest: string;
};
export type QuietReadRow = {
  id: string;
  check_id: string;
  source_kind: "task" | "doc";
  source_id: string;
  revision: string;
  digest: string;
  start_index: number;
  end_index: number;
  total: number;
  complete: boolean;
  supported: boolean;
  observed_at: Date;
};
type RoutineWatchConfig = {
  id: string;
  instruction: string;
  rrule: string;
  timezone: string;
  recovery_intent_version: number;
  quiet_check_revision: number;
  quiet_check_policy: unknown;
};
export type PreparedRoutineQuietCheck = {
  check_id: string;
  binding: QuietCheckBinding;
  sources: QuietSource[];
  owner_id: string;
  routine_id: string;
  lane: "background" | "overnight";
  policy: RoutineQuietPolicy;
  projection_version: 1;
  config_hash: string;
  provider_hash: string;
  scope_hash: string;
  intent_version: number;
  baseline_check_id: string | null;
};
export async function readQuietConfig(
  db: Queryable,
  owner: string,
  routine: string,
  lock = false,
) {
  const row = (
    await db.query<RoutineWatchConfig>(
      `SELECT id,instruction,rrule,timezone,recovery_intent_version,quiet_check_revision,quiet_check_policy FROM agent_routines WHERE id=$2 AND user_id=$1${lock ? " FOR SHARE" : ""}`,
      [owner, routine],
    )
  ).rows[0];
  if (!row) fail(404, "Assistant routine not found.");
  return row;
}
async function watchFingerprint(
  db: Queryable,
  owner: string,
  current: RoutineWatchConfig,
) {
  const route = await scheduledConversationRoute(
    db,
    owner,
    "routine",
    current.id,
  );
  return assistantExecutionDigest({
    instruction: current.instruction,
    rrule: current.rrule,
    timezone: current.timezone,
    intent_version: current.recovery_intent_version,
    watch_revision: current.quiet_check_revision,
    policy: routineQuietPolicy.parse(current.quiet_check_policy ?? {}),
    projection_version: 1,
    destination_id: route.destinationId,
    personal_only: route.personalOnly,
    source_entry_ids: [...route.sourceEntryIds].sort(),
  });
}
export async function prepareRoutineQuietCheck(
  db: Queryable,
  owner: string,
  routine: string,
  lane: "background" | "overnight",
  options: { expectedIntentVersion?: number } = {},
): Promise<PreparedRoutineQuietCheck | null> {
  const current = await readQuietConfig(db, owner, routine, true);
  if (
    options.expectedIntentVersion !== undefined &&
    current.recovery_intent_version !== options.expectedIntentVersion
  )
    fail(409, "The routine changed after its schedule was claimed.");
  const settings = routineQuietPolicy.parse(current.quiet_check_policy ?? {});
  if (!settings.enabled) return null;
  const hashes = await assistantExecutionFingerprints(db, owner, lane),
    config_hash = await watchFingerprint(db, owner, current);
  const baseline = (
    await db.query<{ id: string }>(
      `SELECT id FROM assistant_quiet_checks WHERE owner_id=$1 AND routine_id=$2 AND config_hash=$3 AND projection_version=1
  AND provider_hash=$4 AND scope_hash=$5 AND status IN ('baseline','verified_unchanged','changed','reported') AND checked_count=expected_count AND snapshot_aggregate IS NOT NULL AND job_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1`,
      [owner, routine, config_hash, hashes.provider_hash, hashes.scope_hash],
    )
  ).rows[0];
  const check_id = randomUUID();
  return {
    check_id,
    binding: { check_id },
    sources: settings.sources,
    owner_id: owner,
    routine_id: routine,
    lane,
    policy: settings,
    projection_version: 1,
    config_hash,
    ...hashes,
    intent_version: current.recovery_intent_version,
    baseline_check_id: baseline?.id ?? null,
  };
}
export async function recordRoutineQuietCheck(
  db: Queryable,
  owner: string,
  jobId: string,
  prepared: PreparedRoutineQuietCheck,
  occurrenceId?: string,
) {
  const current = await readQuietConfig(db, owner, prepared.routine_id, true),
    hashes = await assistantExecutionFingerprints(db, owner, prepared.lane);
  if (
    prepared.owner_id !== owner ||
    (await watchFingerprint(db, owner, current)) !== prepared.config_hash ||
    hashes.provider_hash !== prepared.provider_hash ||
    hashes.scope_hash !== prepared.scope_hash
  )
    fail(
      409,
      "The routine quiet-check configuration changed before admission.",
    );
  await db.query(
    `INSERT INTO assistant_quiet_checks(id,owner_id,routine_id,occurrence_id,job_id,lane,policy_snapshot,projection_version,config_hash,provider_hash,scope_hash,intent_version,baseline_check_id,expected_count)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,1,$8,$9,$10,$11,$12,$13)`,
    [
      prepared.check_id,
      owner,
      prepared.routine_id,
      occurrenceId ?? null,
      jobId,
      prepared.lane,
      JSON.stringify(prepared.policy),
      prepared.config_hash,
      prepared.provider_hash,
      prepared.scope_hash,
      prepared.intent_version,
      prepared.baseline_check_id,
      prepared.sources.length,
    ],
  );
}
export async function readQuietCheck(
  db: Queryable,
  owner: string,
  id: string,
  lock = false,
) {
  return (
    (
      await db.query<QuietCheckRow>(
        `SELECT * FROM assistant_quiet_checks WHERE id=$2 AND owner_id=$1${lock ? " FOR UPDATE" : ""}`,
        [owner, id],
      )
    ).rows[0] ?? null
  );
}
export async function assertQuietCheckConfiguration(
  db: Queryable,
  row: QuietCheckRow,
) {
  const current = await readQuietConfig(db, row.owner_id, row.routine_id, true),
    hashes = await assistantExecutionFingerprints(db, row.owner_id, row.lane);
  if (
    (await watchFingerprint(db, row.owner_id, current)) !== row.config_hash ||
    hashes.provider_hash !== row.provider_hash ||
    hashes.scope_hash !== row.scope_hash
  )
    fail(409, "The quiet-check configuration or authority changed.");
}
export async function quietJobVisible(db: Queryable, row: QuietCheckRow) {
  if (!row.job_id) return false;
  const principal = await assistantExecutionContext(db, row.owner_id, row.lane);
  if (!principal) return false;
  const params = new Params(row.job_id),
    scope = scopeFor(capabilityPolicy.spaces(principal), params);
  return !!(
    await db.query(
      `SELECT j.id FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id WHERE j.id=$1 AND ${assistantJobSourcesVisible("j", scope.user, false, scope)} AND ${assistantChatVisible("c", scope.user, scope)}`,
      params.values,
    )
  ).rowCount;
}
/** Runtime caller locks its current job before this check/configuration boundary. */
export async function assertQuietCheckCurrent(
  db: Queryable,
  owner: string,
  jobId: string,
  binding: QuietCheckBinding,
) {
  const row = await readQuietCheck(db, owner, binding.check_id, true);
  if (!row || row.job_id !== jobId || row.status !== "pending")
    fail(409, "This quiet check no longer owns the job.");
  await assertQuietCheckConfiguration(db, row);
  if (!(await quietJobVisible(db, row)))
    fail(409, "The quiet-check source context is no longer available.");
  const principal = await assistantExecutionContext(db, owner, row.lane);
  if (!principal) fail(409, "Assistant permission is unavailable.");
  for (const source of row.policy_snapshot.sources) {
    const projection = await readCurrentQuietProjection(db, principal, source);
    if (!projection.supported)
      fail(409, "A selected quiet-check source is no longer supported.");
  }
  return row;
}
export async function quietReadReceipts(db: Queryable, check: string) {
  return (
    await db.query<QuietReadRow>(
      "SELECT * FROM assistant_quiet_read_receipts WHERE check_id=$1 ORDER BY observed_at,id LIMIT 200",
      [check],
    )
  ).rows;
}
/** Pure coverage computation: a later page cannot certify an unread prefix. */
export function quietSourceCoverage(source: QuietSource, rows: QuietReadRow[]) {
  const receipts = rows.filter(
    (r) => r.source_kind === source.kind && r.source_id === source.id,
  );
  if (!receipts.length) return null;
  const first = receipts.find((r) => r.start_index === 0);
  if (!first || !first.supported) return null;
  if (
    receipts.some(
      (r) =>
        !r.supported ||
        r.revision !== first.revision ||
        r.digest !== first.digest ||
        r.total !== first.total,
    )
  )
    return null;
  let end = 0,
    complete = false;
  for (const r of [...receipts].sort(
    (a, b) => a.start_index - b.start_index || a.end_index - b.end_index,
  )) {
    if (r.start_index > end) return null;
    end = Math.max(end, r.end_index);
    if (r.complete && r.end_index === r.total) complete = true;
  }
  return complete && end === first.total
    ? {
        kind: source.kind,
        id: source.id,
        revision: first.revision,
        digest: first.digest,
      }
    : null;
}
/** Called after the actual read transaction commits, in the caller's primary transaction. */
export async function recordQuietReadEvidence(
  db: Queryable,
  owner: string,
  jobId: string,
  binding: QuietCheckBinding,
  evidence: QuietReadEvidence[],
): Promise<void> {
  const job = (
    await db.query<{ state: string; cancel_requested: boolean }>(
      "SELECT state,cancel_requested FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [jobId, owner],
    )
  ).rows[0];
  if (!job || job.state !== "running" || job.cancel_requested)
    fail(409, "This job cannot record quiet-read evidence.");
  await assertAssistantLease(jobId, db, true);
  const row = await assertQuietCheckCurrent(db, owner, jobId, binding);
  for (const read of evidence) {
    if (
      !row.policy_snapshot.sources.some(
        (s) => s.kind === read.kind && s.id === read.source_id,
      )
    )
      continue;
    if (
      read.scope !== (read.kind === "task" ? "task_fields" : "doc_content") ||
      !Number.isSafeInteger(read.start) ||
      !Number.isSafeInteger(read.end) ||
      !Number.isSafeInteger(read.total) ||
      read.start < 0 ||
      read.end < read.start ||
      read.end > read.total ||
      !read.revision ||
      !/^[a-f0-9]{64}$/.test(read.digest)
    )
      fail(422, "Quiet-read evidence is incomplete.");
    await db.query(
      `INSERT INTO assistant_quiet_read_receipts(check_id,source_kind,source_id,revision,digest,start_index,end_index,total,complete,supported)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.id,
        read.kind,
        read.source_id,
        read.revision,
        read.digest,
        read.start,
        read.end,
        read.total,
        read.complete,
        read.supported,
      ],
    );
  }
}
function normalizedPolicy(value: unknown) {
  const parsed = routineQuietPolicy.parse(value);
  return {
    ...parsed,
    sources: [...parsed.sources].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    ),
  };
}
export async function readRoutineQuietPolicy(
  db: Queryable,
  owner: string,
  routine: string,
) {
  const current = await readQuietConfig(db, owner, routine),
    settings = normalizedPolicy(current.quiet_check_policy ?? {});
  const base = { routine_id: routine, revision: current.quiet_check_revision };
  if (!settings.sources.length)
    return routineQuietPolicyPage.parse({
      ...base,
      visibility: "available",
      policy: settings,
      labels: [],
    });
  try {
    const principal = await assistantExecutionContext(db, owner, "background");
    if (!principal) throw new Error("Unavailable authority");
    const labels = [];
    for (const source of settings.sources) {
      const p = await readCurrentQuietProjection(db, principal, source);
      if (!p.supported) throw new Error("Unsupported source");
      labels.push({ ...source, title: p.title.slice(0, 500) });
    }
    return routineQuietPolicyPage.parse({
      ...base,
      visibility: "available",
      policy: settings,
      labels,
    });
  } catch {
    return routineQuietPolicyPage.parse({
      ...base,
      visibility: "restricted",
      enabled: settings.enabled,
      source_count: settings.sources.length,
    });
  }
}
export async function saveRoutineQuietPolicy(
  db: Queryable,
  owner: string,
  routine: string,
  raw: unknown,
) {
  const input = updateRoutineQuietPolicyInput.parse(raw),
    settings = normalizedPolicy(input.policy),
    digest = assistantExecutionDigest({ ...input, policy: settings });
  const current = (
    await db.query<
      RoutineWatchConfig & {
        quiet_check_last_control: { id: string; digest: string } | null;
      }
    >("SELECT * FROM agent_routines WHERE id=$2 AND user_id=$1 FOR UPDATE", [
      owner,
      routine,
    ])
  ).rows[0];
  if (!current) fail(404, "Assistant routine not found.");
  if (current.quiet_check_last_control?.id === input.request_id) {
    if (current.quiet_check_last_control.digest !== digest)
      fail(409, "This request already changed a different quiet check.");
    return readRoutineQuietPolicy(db, owner, routine);
  }
  if (current.quiet_check_revision !== input.expected_revision)
    fail(409, "Quiet-check settings changed. Refresh before saving.");
  const same =
    assistantExecutionDigest(
      normalizedPolicy(current.quiet_check_policy ?? {}),
    ) === assistantExecutionDigest(settings);
  // A no-op preserves intent even when older selected evidence is now restricted.
  if (!same && settings.sources.length) {
    const principal = await assistantExecutionContext(db, owner, "background");
    if (!principal) fail(409, "Assistant permission is unavailable.");
    for (const source of settings.sources) {
      const p = await readCurrentQuietProjection(db, principal, source);
      if (!p.supported)
        fail(422, "Choose a supported task or page you can currently open.");
    }
  }
  if (same)
    await db.query(
      "UPDATE agent_routines SET quiet_check_last_control=$3::jsonb WHERE id=$2 AND user_id=$1",
      [owner, routine, JSON.stringify({ id: input.request_id, digest })],
    );
  else
    await db.query(
      "UPDATE agent_routines SET quiet_check_policy=$3::jsonb,quiet_check_revision=quiet_check_revision+1,recovery_intent_version=recovery_intent_version+1,quiet_check_last_control=$4::jsonb,updated_at=clock_timestamp() WHERE id=$2 AND user_id=$1",
      [
        owner,
        routine,
        JSON.stringify(settings),
        JSON.stringify({ id: input.request_id, digest }),
      ],
    );
  return readRoutineQuietPolicy(db, owner, routine);
}
export {
  finalizeRoutineQuietCheck,
  routineQuietDeliveryProof,
  settleFailedRoutineQuietChecks,
} from "./quiet-check-verification.js";

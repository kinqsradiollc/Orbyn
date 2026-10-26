import { z } from "zod";
import { fail } from "@orbyn/core";
import { transaction, type Db } from "../../../db/pool.js";
import { env } from "../../../config/env.js";
import {
  ASSISTANT_RUNTIME_CAPACITY,
  type AssistantRuntimeLane,
} from "./runtime-lanes.js";

const revision = z.number().int().min(1).max(2147483647);
const limits = z
  .object({
    global_limit: z.number().int().min(0).max(8),
    interactive_limit: z
      .number()
      .int()
      .min(0)
      .max(ASSISTANT_RUNTIME_CAPACITY.interactive),
    background_limit: z
      .number()
      .int()
      .min(0)
      .max(ASSISTANT_RUNTIME_CAPACITY.background),
    overnight_limit: z
      .number()
      .int()
      .min(0)
      .max(ASSISTANT_RUNTIME_CAPACITY.overnight),
  })
  .strict();
const policySchema = limits.extend({ revision });
export type AssistantAdmissionPolicy = z.infer<typeof policySchema>;

export class AssistantAdmissionPolicyMismatch extends Error {
  constructor(expected: number, actual: number | null) {
    super(
      `Assistant admission policy revision mismatch: expected ${expected}, active ${actual ?? "missing"}. Coordinate the admission policy and runtime configuration before claiming work.`,
    );
    this.name = "AssistantAdmissionPolicyMismatch";
  }
}

async function lockAdmission(db: Db) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('assistant-global-slots'))",
  );
}
async function readPolicy(db: Db): Promise<AssistantAdmissionPolicy | null> {
  const row = (
    await db.query(`SELECT revision,global_limit,interactive_limit,background_limit,overnight_limit
    FROM assistant_admission_policy WHERE id FOR SHARE`)
  ).rows[0];
  return row ? policySchema.parse(row) : null;
}

/** Internal operator command. Coordinate compatible runtimes before applying;
 * this does not fence legacy binaries that never check the shared policy. */
export async function applyAssistantAdmissionPolicy(
  value: unknown,
): Promise<AssistantAdmissionPolicy> {
  const input = limits
    .extend({ expected_revision: revision.max(2147483646) })
    .parse(value);
  return transaction(async (db) => {
    await lockAdmission(db);
    const current = await readPolicy(db);
    if (!current || current.revision !== input.expected_revision)
      fail(
        409,
        "Assistant admission policy changed. Reload it before applying a policy.",
      );
    const row = (
      await db.query(
        `UPDATE assistant_admission_policy SET
      revision=revision+1,global_limit=$2,interactive_limit=$3,background_limit=$4,overnight_limit=$5,
      updated_at=clock_timestamp() WHERE id AND revision=$1
      RETURNING revision,global_limit,interactive_limit,background_limit,overnight_limit`,
        [
          input.expected_revision,
          input.global_limit,
          input.interactive_limit,
          input.background_limit,
          input.overnight_limit,
        ],
      )
    ).rows[0];
    if (!row)
      fail(
        409,
        "Assistant admission policy changed. Reload it before applying a policy.",
      );
    return policySchema.parse(row);
  });
}

/** Serialize compatible claims and count every leased provider job across all queues.
 * The caller retains this transaction through budget reservation and claim. */
export async function assistantRuntimeHasRoom(
  db: Db,
  lane: AssistantRuntimeLane,
  suppliedNow?: Date,
  expectedRevision = env.ASSISTANT_ADMISSION_REVISION,
): Promise<boolean> {
  await lockAdmission(db);
  const policy = await readPolicy(db);
  if (
    !policy ||
    !revision.safeParse(expectedRevision).success ||
    policy.revision !== expectedRevision
  )
    throw new AssistantAdmissionPolicyMismatch(
      expectedRevision,
      policy?.revision ?? null,
    );
  // Lease timestamps belong to PostgreSQL, not a replica's wall clock. Sample
  // after acquiring admission/policy locks so waiting cannot stale this cutoff.
  const clock = (
    await db.query<{ at: Date; environment: string | null }>(
      "SELECT clock_timestamp() AS at,current_setting('orbyn.environment',true) AS environment",
    )
  ).rows[0];
  if (
    suppliedNow !== undefined &&
    (clock.environment !== "test" || !Number.isFinite(suppliedNow.getTime()))
  )
    throw new Error(
      "An explicit assistant admission clock requires a marked test database and a valid date.",
    );
  const now = suppliedNow ?? clock.at;
  const occupied = (
    await db.query<{ count: number; lane_count: number }>(
      `SELECT count(*)::int AS count,
       count(*) FILTER (WHERE lane=$1)::int AS lane_count FROM (
         SELECT runtime_lane AS lane FROM ai_jobs
           WHERE state='running' AND run_state->>'version'='1' AND lease_until>$2
         UNION ALL
         SELECT lane FROM assistant_page_runs
           WHERE state='running' AND lease_expires_at>$2
         UNION ALL
         SELECT 'background' AS lane FROM agenda_summary_runs
           WHERE state='running' AND lease_expires_at>$2
       ) occupied`,
      [lane, now],
    )
  ).rows[0];
  return (
    occupied.count < policy.global_limit &&
    occupied.lane_count < policy[`${lane}_limit`]
  );
}

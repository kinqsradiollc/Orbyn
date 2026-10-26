import type { Db } from "../db/pool.js";
import { CapabilityError } from "../capabilities/registry.js";

export const TASK_PROJECT_COMPAT_KEY = "mcp_task_project_version_compat";
const fix =
  "Fetch the task and include its current version in link task_project; review conflicts before retrying.";
const unavailable = () =>
  new CapabilityError(
    "UNAVAILABLE",
    "Legacy task_project compatibility policy is unavailable. Include the task version.",
    fix,
  );

type Policy = {
  version: 1;
  installed_at: string;
  deadline: string;
  legacy_use_count: number;
  legacy_last_used_at: string | null;
};
function policy(value: unknown): Policy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.version !== 1 ||
    typeof row.installed_at !== "string" ||
    !Number.isFinite(Date.parse(row.installed_at)) ||
    typeof row.deadline !== "string" ||
    !Number.isFinite(Date.parse(row.deadline)) ||
    Date.parse(row.deadline) - Date.parse(row.installed_at) !==
      90 * 24 * 60 * 60 * 1000 ||
    !Number.isSafeInteger(row.legacy_use_count) ||
    Number(row.legacy_use_count) < 0 ||
    Number(row.legacy_use_count) >= Number.MAX_SAFE_INTEGER ||
    (row.legacy_last_used_at !== null &&
      (typeof row.legacy_last_used_at !== "string" ||
        !Number.isFinite(Date.parse(row.legacy_last_used_at))))
  )
    return null;
  return row as Policy;
}

/**
 * Only link task_project may temporarily borrow the locked row's version.
 * The caller must use the same transaction for this accounting and placement.
 * Versioned requests always retain their caller's expected version.
 */
export async function taskProjectExpectedVersion(
  db: Db,
  expectedVersion: number | undefined,
  lockedVersion: number,
  testing?: { now: Date },
): Promise<number> {
  if (expectedVersion !== undefined) return expectedVersion;
  const result = await db.query<{ value: unknown }>(
    "SELECT value FROM system_settings WHERE key=$1 FOR UPDATE",
    [TASK_PROJECT_COMPAT_KEY],
  );
  const saved = policy(result.rows[0]?.value);
  if (!saved) throw unavailable();
  // The database clock is shared by all replicas. The optional injection is
  // internal test support and is refused outside a server-marked test database;
  // no HTTP/tool argument, environment setting or process clock controls it.
  const clock = (
    await db.query<{ now: Date; expired: boolean; environment: string | null }>(
      `WITH clock AS (SELECT clock_timestamp() AS now)
       SELECT now, now >= $1::timestamptz AS expired,
         current_setting('orbyn.environment', true) AS environment FROM clock`,
      [saved.deadline],
    )
  ).rows[0];
  if (
    testing &&
    (clock.environment !== "test" || !Number.isFinite(testing.now.getTime()))
  )
    throw new Error(
      "Compatibility clock injection requires a marked test database.",
    );
  const now = testing?.now ?? clock.now;
  if (testing ? now.getTime() >= Date.parse(saved.deadline) : clock.expired)
    throw new CapabilityError(
      "INVALID",
      "Versionless task_project writes have retired. Include the task version.",
      fix,
      { compatibility_deadline: saved.deadline },
    );
  // Content-free adoption evidence commits or rolls back with the placement.
  await db.query(
    `UPDATE system_settings SET value=jsonb_set(jsonb_set(value,
      '{legacy_use_count}', to_jsonb($2::bigint)), '{legacy_last_used_at}', to_jsonb($3::timestamptz)),
      updated_at=clock_timestamp() WHERE key=$1`,
    [TASK_PROJECT_COMPAT_KEY, saved.legacy_use_count + 1, now.toISOString()],
  );
  return lockedVersion;
}

import {
  fail,
  routineQuietChecksPage,
  type RoutineQuietChecksPage,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantExecutionContext } from "./execution-authority.js";
import { readCurrentQuietProjection } from "./quiet-projection.js";
import {
  quietJobVisible,
  quietReadReceipts,
  quietSourceCoverage,
  readQuietCheck,
  type QuietCheckRow,
} from "./routine-quiet-checks.js";
export async function readRoutineQuietChecks(
  db: Queryable,
  owner: string,
  routine: string,
  occurrence: string,
): Promise<RoutineQuietChecksPage> {
  if (
    !(
      await db.query(
        "SELECT id FROM assistant_routine_runs WHERE owner_id=$1 AND routine_id=$2 AND id=$3",
        [owner, routine, occurrence],
      )
    ).rowCount
  )
    fail(404, "Routine occurrence not found.");
  const rows = (
    await db.query<QuietCheckRow>(
      "SELECT * FROM assistant_quiet_checks WHERE owner_id=$1 AND routine_id=$2 AND occurrence_id=$3 ORDER BY created_at,id LIMIT 5",
      [owner, routine, occurrence],
    )
  ).rows;
  const configured =
    !!rows.length ||
    !!(
      await db.query<{ enabled: boolean }>(
        "SELECT coalesce((quiet_check_policy->>'enabled')::boolean,false) AS enabled FROM agent_routines WHERE id=$1 AND user_id=$2",
        [routine, owner],
      )
    ).rows[0]?.enabled;
  const checks = [];
  for (const row of rows) {
    const baseline = row.baseline_check_id
      ? await readQuietCheck(db, owner, row.baseline_check_id)
      : null;
    const baselineAvailable =
      !!baseline?.snapshot_aggregate && (await quietJobVisible(db, baseline));
    const base = {
      id: row.id,
      status: row.status,
      requested: row.requested,
      expected_count: row.expected_count,
      checked_count: row.checked_count,
      created_at: row.created_at.toISOString(),
      observed_at: row.observed_at?.toISOString() ?? null,
      reason: row.reason,
      baseline_available: baselineAvailable,
    };
    try {
      if (!(await quietJobVisible(db, row)))
        throw new Error("Unavailable job sources");
      const principal = await assistantExecutionContext(db, owner, row.lane);
      if (!principal) throw new Error("Unavailable authority");
      const receipts = await quietReadReceipts(db, row.id),
        sources = [];
      for (const source of row.policy_snapshot.sources) {
        const current = await readCurrentQuietProjection(db, principal, source);
        if (!current.supported) throw new Error("Unsupported source");
        const covered = quietSourceCoverage(source, receipts),
          observed = receipts
            .filter(
              (r) => r.source_kind === source.kind && r.source_id === source.id,
            )
            .at(-1);
        const previous = baselineAvailable
          ? baseline!.snapshot_aggregate!.find(
              (s) => s.kind === source.kind && s.id === source.id,
            )
          : null;
        const state = !covered
          ? "incomplete"
          : previous
            ? covered.revision === previous.revision &&
              covered.digest === previous.digest
              ? "unchanged"
              : "changed"
            : "checked";
        sources.push({
          ...source,
          title: current.title.slice(0, 500),
          state,
          checked_at: observed?.observed_at.toISOString() ?? null,
          reason: covered ? null : "A complete fresh read was not recorded.",
        });
      }
      const job = (
        await db.query<{ chat_id: string }>(
          "SELECT chat_id FROM ai_jobs WHERE id=$1 AND user_id=$2",
          [row.job_id, owner],
        )
      ).rows[0];
      if (!job) throw new Error("Pruned job");
      checks.push({
        ...base,
        visibility: "available",
        job_id: row.job_id,
        chat_id: job.chat_id,
        sources,
      });
    } catch {
      checks.push({ ...base, visibility: "restricted" });
    }
  }
  return routineQuietChecksPage.parse({
    routine_id: routine,
    occurrence_id: occurrence,
    configured,
    checks,
  });
}

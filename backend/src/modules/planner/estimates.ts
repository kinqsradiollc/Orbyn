import type { EstimateModel } from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";

/** Finished tasks from this far back feed the estimate ratios. */
const WINDOW_DAYS = 90;
/** Below this many finished tasks a ratio isn't trusted (stays 1). */
const MIN_SAMPLES = 3;
/** A ratio never swings the planner more than half…triple. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 3;

const clamp = (r: number) =>
  Math.round(Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)) * 100) / 100;

/**
 * How long the person's finished tasks really took against what they planned,
 * overall and per tag. A ratio of 1.4 means "you take 40% longer than you
 * estimate". Only tasks with both an estimate and logged time count, and a
 * ratio isn't trusted (kept at 1) until there are a few of them.
 */
export async function loadEstimateModel(
  db: Db,
  userId: string,
  applied: boolean,
): Promise<EstimateModel> {
  const overallRow = (
    await db.query<{ ratio: number | null; samples: number }>(
      `SELECT sum(spent_minutes)::float / nullif(sum(estimate_minutes), 0) AS ratio,
              count(*)::int AS samples
         FROM items
        WHERE user_id = $1 AND status = 'done'
          AND estimate_minutes IS NOT NULL AND spent_minutes > 0
          AND updated_at > now() - ($2 || ' days')::interval`,
      [userId, String(WINDOW_DAYS)],
    )
  ).rows[0];
  const samples = overallRow.samples;
  const overall = {
    ratio:
      samples >= MIN_SAMPLES && overallRow.ratio ? clamp(overallRow.ratio) : 1,
    samples,
  };

  const tags = (
    await db.query<{
      tag_id: string;
      name: string;
      ratio: number | null;
      samples: number;
    }>(
      `SELECT t.id AS tag_id, t.name,
              sum(i.spent_minutes)::float / nullif(sum(i.estimate_minutes), 0) AS ratio,
              count(*)::int AS samples
         FROM items i
         JOIN item_tags it ON it.item_id = i.id
         JOIN tags t ON t.id = it.tag_id
        WHERE i.user_id = $1 AND i.status = 'done'
          AND i.estimate_minutes IS NOT NULL AND i.spent_minutes > 0
          AND i.updated_at > now() - ($2 || ' days')::interval
        GROUP BY t.id, t.name
       HAVING count(*) >= $3
        ORDER BY count(*) DESC, t.name`,
      [userId, String(WINDOW_DAYS), MIN_SAMPLES],
    )
  ).rows
    .filter((r) => r.ratio)
    .map((r) => ({
      tag_id: r.tag_id,
      name: r.name,
      ratio: clamp(r.ratio!),
      samples: r.samples,
    }));

  return { overall, tags, applied };
}

/**
 * The ratio to scale a task's estimate by: the strongest matching tag's ratio
 * (most samples), else the overall ratio. 1 when nothing is trusted yet.
 */
export function ratioFor(
  task: { tag_ids: string[] },
  model: EstimateModel,
): number {
  const byTag = model.tags
    .filter((t) => task.tag_ids.includes(t.tag_id))
    .sort((a, b) => b.samples - a.samples)[0];
  return byTag ? byTag.ratio : model.overall.ratio;
}

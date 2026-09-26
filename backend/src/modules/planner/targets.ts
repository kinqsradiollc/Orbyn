import { deadlineOf, planningDeadline } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";

/** Earliest saved deadline of an open task downstream of each prerequisite. */
export async function dependentTargets(
  db: Queryable,
  userId: string,
  itemIds: string[],
) {
  const targets = new Map<string, string>();
  if (!itemIds.length) return targets;
  const rows = (
    await db.query<{
      root_id: string;
      due_at: Date | null;
      end_at: Date | null;
      all_day: boolean;
      timezone: string;
      project_deadline: Date | null;
    }>(
      `WITH RECURSIVE waiting_on(root_id, item_id) AS (
         SELECT d.prerequisite_id, d.item_id FROM item_dependencies d
           JOIN items i ON i.id = d.item_id AND ${VISIBLE_ITEMS}
          WHERE d.prerequisite_id = ANY($2::uuid[])
         UNION
         SELECT w.root_id, d.item_id FROM waiting_on w
           JOIN item_dependencies d ON d.prerequisite_id = w.item_id
           JOIN items i ON i.id = d.item_id AND ${VISIBLE_ITEMS}
       )
       SELECT w.root_id, i.due_at, i.end_at, i.all_day, i.timezone,
              p.deadline AS project_deadline
         FROM waiting_on w JOIN items i ON i.id = w.item_id
         LEFT JOIN projects p ON p.id = i.project_id
        WHERE i.kind = 'task' AND i.status NOT IN ('done', 'cancelled')`,
      [userId, itemIds],
    )
  ).rows;
  for (const row of rows) {
    const target = planningDeadline(deadlineOf(row), row.project_deadline);
    if (!target) continue;
    const current = targets.get(row.root_id);
    if (!current || Date.parse(target) < Date.parse(current))
      targets.set(row.root_id, target);
  }
  return targets;
}

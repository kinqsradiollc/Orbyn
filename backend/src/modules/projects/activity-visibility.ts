import { docReadableBy } from "../../lib/doc-visibility.js";
import {
  readableDocs,
  visibleItems,
  visibleOwned,
  visibleRecords,
} from "../../lib/visibility.js";

/**
 * Visibility of an activity entry's current target, using `a` as its alias.
 * A session row is one person's planned time: only that person sees it,
 * whatever their role in the team.
 */
export function visibleProjectActivity(userParameter: string) {
  const scope = { user: userParameter };
  return `(
    a.entity_type IN ('project', 'stage', 'milestone')
    OR (a.entity_type = 'session' AND a.session_user_id = ${userParameter})
    OR (a.entity_type = 'task' AND EXISTS (
      SELECT 1 FROM items i WHERE i.id = a.entity_id
        AND ${visibleItems("i", scope)}))
    OR (a.entity_type = 'note' AND EXISTS (
      SELECT 1 FROM docs d WHERE d.id = a.entity_id
        AND ${readableDocs("d", scope)}))
    OR (a.entity_type = 'record' AND EXISTS (
      SELECT 1 FROM work_records w WHERE w.id = a.entity_id
        AND ${visibleRecords("w", scope)}))
    OR (a.entity_type IN ('task', 'note', 'record')
      AND NOT EXISTS (SELECT 1 FROM items i WHERE a.entity_type = 'task' AND i.id = a.entity_id)
      AND NOT EXISTS (SELECT 1 FROM docs d WHERE a.entity_type = 'note' AND d.id = a.entity_id)
      AND NOT EXISTS (SELECT 1 FROM work_records w WHERE a.entity_type = 'record' AND w.id = a.entity_id)
      AND EXISTS (SELECT 1 FROM project_history_access h
        WHERE h.entity_type = a.entity_type AND h.entity_id = a.entity_id
          AND ${visibleOwned("h", "user_id", scope)}))
  )`;
}

import { docReadableBy } from "../../lib/doc-visibility.js";
/** Visibility of an activity entry's current target, using `a` as its alias. */
export function visibleProjectActivity(userParameter: string) {
  const member = `SELECT team_id FROM team_members WHERE user_id = ${userParameter}`;
  return `(
    a.entity_type IN ('project', 'stage')
    OR (a.entity_type = 'task' AND EXISTS (
      SELECT 1 FROM items i WHERE i.id = a.entity_id
        AND ((i.team_id IS NULL AND i.user_id = ${userParameter})
          OR i.team_id IN (${member}))))
    OR (a.entity_type = 'note' AND EXISTS (
      SELECT 1 FROM docs d WHERE d.id = a.entity_id
        AND ${docReadableBy(userParameter)}))
    OR (a.entity_type = 'record' AND EXISTS (
      SELECT 1 FROM work_records w WHERE w.id = a.entity_id
        AND ((w.team_id IS NULL AND w.created_by = ${userParameter})
          OR w.team_id IN (${member}))))
    OR (a.entity_type IN ('task', 'note', 'record')
      AND NOT EXISTS (SELECT 1 FROM items i WHERE a.entity_type = 'task' AND i.id = a.entity_id)
      AND NOT EXISTS (SELECT 1 FROM docs d WHERE a.entity_type = 'note' AND d.id = a.entity_id)
      AND NOT EXISTS (SELECT 1 FROM work_records w WHERE a.entity_type = 'record' AND w.id = a.entity_id)
      AND EXISTS (SELECT 1 FROM project_history_access h
        WHERE h.entity_type = a.entity_type AND h.entity_id = a.entity_id
          AND ((h.team_id IS NULL AND h.user_id = ${userParameter})
            OR h.team_id IN (${member}))))
  )`;
}

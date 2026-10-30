import type { AssistantReviewOrigin } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { visibleItems, visibleProjects } from "../../lib/visibility.js";

/** Current entity identity only. Call in the profile's primary repeatable-read transaction. */
export async function readAssistantReviewOrigins(
  db: Queryable,
  owner: string,
  jobIds: string[],
): Promise<Map<string, AssistantReviewOrigin>> {
  const ids = [...new Set(jobIds)].slice(0, 50);
  if (!ids.length) return new Map();
  const scope = { user: "$1", ai: true };
  const rows = (
    await db.query<{
      job_id: string;
      kind: AssistantReviewOrigin["kind"] | null;
      id: string | null;
      title: string | null;
    }>(
      `SELECT j.id AS job_id,
       CASE WHEN j.work_source_kind='goal' AND g.id IS NOT NULL THEN 'goal'
            WHEN j.work_source_kind='routine' AND r.id IS NOT NULL THEN 'routine'
            WHEN j.work_source_kind='task' AND t.id IS NOT NULL THEN CASE WHEN tp.id IS NOT NULL THEN 'project' ELSE 'task' END
            WHEN j.work_source_kind IS NULL THEN CASE WHEN cp.id IS NOT NULL THEN 'project' WHEN c.project_id IS NULL THEN 'chat' END END AS kind,
       CASE WHEN j.work_source_kind='goal' THEN g.id
            WHEN j.work_source_kind='routine' THEN r.id
            WHEN j.work_source_kind='task' AND t.id IS NOT NULL THEN coalesce(tp.id,t.id)
            WHEN j.work_source_kind IS NULL THEN CASE WHEN cp.id IS NOT NULL THEN cp.id WHEN c.project_id IS NULL THEN c.id END END AS id,
       CASE WHEN j.work_source_kind='goal' THEN g.title
            WHEN j.work_source_kind='routine' THEN r.instruction
            WHEN j.work_source_kind='task' AND t.id IS NOT NULL THEN CASE WHEN tp.id IS NOT NULL THEN tp.name ELSE t.title END
            WHEN j.work_source_kind IS NULL THEN CASE WHEN cp.id IS NOT NULL THEN cp.name WHEN c.project_id IS NULL THEN c.title END END AS title
       FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
       LEFT JOIN goals g ON j.work_source_kind='goal' AND g.id=j.work_source_id AND g.user_id=$1 AND ${assistantSourceVisible("'goal'", "g.id", "$1", false)}
       LEFT JOIN agent_routines r ON j.work_source_kind='routine' AND r.id=j.work_source_id AND r.user_id=$1 AND ${assistantSourceVisible("'routine'", "r.id", "$1", false)}
       LEFT JOIN items t ON j.work_source_kind='task' AND t.id=j.work_source_id AND ${visibleItems("t", scope)}
       LEFT JOIN projects tp ON tp.id=t.project_id AND ${visibleProjects("tp", scope)}
       LEFT JOIN projects cp ON cp.id=c.project_id AND ${visibleProjects("cp", scope)}
       WHERE j.id=ANY($2::uuid[]) AND j.user_id=$1 AND ${assistantJobSourcesVisible("j", "$1", false)} AND ${assistantChatVisible("c", "$1")}`,
      [owner, ids],
    )
  ).rows;
  return new Map(
    rows.flatMap((row) =>
      row.kind && row.id && row.title !== null
        ? [
            [
              row.job_id,
              {
                kind: row.kind,
                id: row.id,
                title: row.title.trim().slice(0, 200) || `Untitled ${row.kind}`,
              },
            ] as const,
          ]
        : [],
    ),
  );
}

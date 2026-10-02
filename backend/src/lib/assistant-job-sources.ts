import type { Scope } from "./visibility.js";
import type { Queryable } from "../db/pool.js";
import { transaction } from "../db/pool.js";
import { assistantSourceVisible } from "./assistant-source-visibility.js";

/** Current access to every recorded source; unknown legacy background snapshots are restricted. */
export function assistantJobSourcesVisible(
  job = "j",
  user = "$1",
  allowLegacyPerson = true,
  scope?: Scope,
): string {
  return `(${job}.user_id=${user} AND (${job}.sources_checked${allowLegacyPerson ? ` OR ${job}.run_origin='person'` : ""})
    AND NOT EXISTS(SELECT 1 FROM assistant_job_sources dependency WHERE dependency.job_id=${job}.id AND NOT ${assistantSourceVisible("dependency.source_kind", "dependency.source_id", user, false, scope)}))`;
}
const kinds: Record<string, string> = {
  chat: "chat",
  task: "task",
  event: "task",
  item: "task",
  doc: "doc",
  page: "doc",
  memory: "doc",
  sub: "calendar",
  project: "project",
  record: "record",
  goal: "goal",
  routine: "routine",
  habit: "habit",
  exam: "exam",
  team: "team",
  calendar: "calendar",
};
const uuid = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi;

/** Save identities before any retrieved content enters a provider conversation. */
export async function recordAssistantSources(
  jobId: string,
  userId: string,
  value: unknown,
  targets: string[] = [],
) {
  const found = new Set<string>();
  const typed: { kind: string; id: string }[] = [];
  const identity = (text: string, hint?: string) => {
    const id = text.match(uuid)?.[0]?.toLowerCase();
    if (!id) return;
    found.add(id);
    const prefix = /^([a-z]+):/i.exec(text)?.[1]?.toLowerCase();
    const kind = kinds[prefix ?? hint ?? ""];
    if (kind) typed.push({ kind, id });
  };
  const visit = (data: unknown) => {
    if (Array.isArray(data)) {
      data.forEach(visit);
      return;
    }
    if (!data || typeof data !== "object") return;
    const entry = data as Record<string, unknown>;
    const kind = String(
      entry.source_kind ?? entry.source_type ?? entry.kind ?? entry.type ?? "",
    );
    if (typeof entry.id === "string") identity(entry.id, kind);
    for (const [key, dataValue] of Object.entries(entry)) {
      if (
        typeof dataValue === "string" &&
        (key.endsWith("_id") || ["source_ref", "calendar_ref"].includes(key))
      )
        identity(
          dataValue,
          key === "source_id" ? kind : key.replace(/_id$/, ""),
        );
      if (key.endsWith("_ids") && Array.isArray(dataValue)) {
        for (const id of dataValue)
          if (typeof id === "string") identity(id, key.slice(0, -4));
      }
      visit(dataValue);
    }
  };
  visit(value);
  targets.forEach((target) => identity(target));
  const ids = [...found];
  await transaction(async (db) => {
    if (ids.length) {
      await db.query(
        `INSERT INTO assistant_job_sources(job_id,source_kind,source_id)
        SELECT $1, kind, id FROM (
          SELECT 'task' AS kind,id FROM items WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'doc',id FROM docs WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'project',id FROM projects WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'record',id FROM work_records WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'goal',id FROM goals WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'routine',id FROM agent_routines WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'habit',id FROM habits WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'exam',id FROM study_exams WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'team',id FROM teams WHERE id=ANY($2::uuid[])
          UNION ALL SELECT 'calendar',id FROM calendar_subscriptions WHERE id=ANY($2::uuid[])
          UNION ALL SELECT CASE s.source_type WHEN 'task' THEN 'task' WHEN 'doc' THEN 'doc' ELSE 'project' END,s.source_id
            FROM memory_sources s WHERE s.doc_id=ANY($2::uuid[]) AND s.source_type IN ('task','doc','project') AND s.source_id IS NOT NULL
        ) matched ON CONFLICT DO NOTHING`,
        [jobId, ids],
      );
      if (typed.length)
        await db.query(
          `INSERT INTO assistant_job_sources(job_id,source_kind,source_id)
        SELECT $1, entry.kind,entry.id FROM jsonb_to_recordset($2::jsonb) AS entry(kind text,id uuid) ON CONFLICT DO NOTHING`,
          [jobId, JSON.stringify(typed)],
        );
    }
    await db.query(
      `WITH RECURSIVE dependencies(kind,id) AS (
      SELECT source_kind,source_id FROM assistant_job_sources WHERE job_id=$1
      UNION SELECT edge.kind,edge.id FROM dependencies parent CROSS JOIN LATERAL (
        SELECT s.source_type AS kind,s.source_id AS id FROM memory_sources s
          WHERE parent.kind='doc' AND s.doc_id=parent.id AND s.source_id IS NOT NULL AND s.source_type IN ('task','doc','project','chat')
        UNION SELECT source_kind,source_id FROM assistant_chat_sources WHERE parent.kind='chat' AND chat_id=parent.id
      ) edge
    ) INSERT INTO assistant_job_sources(job_id,source_kind,source_id) SELECT $1,kind,id FROM dependencies WHERE kind<>'chat' ON CONFLICT DO NOTHING`,
      [jobId],
    );
    await db.query(
      `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
      SELECT j.chat_id,j.turn_id,s.source_kind,s.source_id FROM ai_jobs j JOIN assistant_job_sources s ON s.job_id=j.id
      WHERE j.id=$1 AND j.user_id=$2 AND j.chat_id IS NOT NULL AND j.turn_id IS NOT NULL ON CONFLICT DO NOTHING`,
      [jobId, userId],
    );
    await db.query(
      "UPDATE ai_jobs SET sources_checked=true WHERE id=$1 AND user_id=$2",
      [jobId, userId],
    );
  });
}

/** Batch check dependencies for projections without returning restricted contents. */
export async function visibleAssistantJobs(
  db: Queryable,
  userId: string,
  ids: string[],
) {
  return new Set(
    ids.length
      ? (
          await db.query<{ id: string }>(
            `SELECT j.id FROM ai_jobs j WHERE j.id=ANY($2::uuid[]) AND ${assistantJobSourcesVisible("j", "$1", false)}`,
            [userId, ids],
          )
        ).rows.map((row) => row.id)
      : [],
  );
}

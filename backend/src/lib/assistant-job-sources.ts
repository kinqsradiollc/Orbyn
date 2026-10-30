import { assistantChatContainerVisible } from "./assistant-visibility.js";
import type { Scope } from "./visibility.js";
import type { Queryable } from "../db/pool.js";
import { transaction } from "../db/pool.js";
import {
  assistantSourceVisible,
  assistantTurnSourcesVisible,
  assistantBindingEntrySourcesVisible,
  assistantChatEvidenceKnown,
  type assistantSourceVisibilitySet,
} from "./assistant-source-visibility.js";

/** Current access to every recorded source; unknown legacy background snapshots are restricted. */
export function assistantJobSourcesVisible(
  job = "j",
  user = "$1",
  allowLegacyPerson = true,
  scope?: Scope,
  includeDerived = true,
  sourceSet?: ReturnType<typeof assistantSourceVisibilitySet>,
): string {
  const directSource = sourceSet
    ? sourceSet.predicate(
        "dependency.source_kind",
        "dependency.source_id",
        user,
        scope,
        includeDerived,
      )
    : assistantSourceVisible(
        "dependency.source_kind",
        "dependency.source_id",
        user,
        false,
        scope,
        includeDerived,
      );
  return `(${job}.user_id=${user} AND (${job}.sources_checked${allowLegacyPerson ? ` OR ${job}.run_origin='person'` : ""})
    AND NOT EXISTS(SELECT 1 FROM assistant_job_sources dependency WHERE dependency.job_id=${job}.id AND NOT ${directSource})
    ${
      includeDerived
        ? `AND ${assistantTurnSourcesVisible(`${job}.chat_id`, `${job}.turn_id`, user, scope)} AND NOT EXISTS(
      SELECT 1 FROM assistant_delivery_bindings source_binding WHERE source_binding.work_kind='job' AND source_binding.work_id=${job}.id AND source_binding.owner_id=${user}
      AND NOT ${assistantBindingEntrySourcesVisible("source_binding.id", user, scope)})`
        : ""
    })`;
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
  const jobs = new Set<string>();
  const entries = new Set<string>();
  const typed: { kind: string; id: string }[] = [];
  const observed: { kind: string; id: string; revision: string }[] = [];
  const identity = (text: string, hint?: string, revision?: string) => {
    const id = text.match(uuid)?.[0]?.toLowerCase();
    if (!id) return;
    const prefix = /^([a-z]+):/i.exec(text)?.[1]?.toLowerCase();
    if ((prefix ?? hint) === "job") {
      jobs.add(id);
      return;
    }
    if ((prefix ?? hint) === "entry") {
      entries.add(id);
      return;
    }
    found.add(id);
    const kind = kinds[prefix ?? hint ?? ""];
    if (kind) {
      typed.push({ kind, id });
      if (revision && kind !== "chat") observed.push({ kind, id, revision });
    }
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
    const jobSource =
      entry.source &&
      typeof entry.source === "object" &&
      (entry.source as Record<string, unknown>).kind === "job";
    const revision =
      Number.isSafeInteger(entry.version) && Number(entry.version) > 0
        ? `version:${entry.version}`
        : undefined;
    if (typeof entry.id === "string") identity(entry.id, kind, revision);
    if (typeof entry.doc_id === "string")
      identity(entry.doc_id, "doc", revision);
    for (const [key, dataValue] of Object.entries(entry)) {
      // Status metadata can name an in-flight job without reading its result.
      // Completed work evidence is explicit (`kind: job` or a job: target).
      if (key === "job_id") continue;
      if (key === "chat_id" && jobSource) continue;
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
  const captured = await transaction(async (db) => {
    const target = (
      await db.query<{ chat_id: string | null; turn_id: string | null }>(
        "SELECT chat_id,turn_id FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [jobId, userId],
      )
    ).rows[0];
    if (!target) return false;
    const sourceJobs = [...jobs];
    const chatIds = [
      ...new Set(
        typed
          .filter((source) => source.kind === "chat")
          .map((source) => source.id),
      ),
    ];
    const readChatIds = [
      ...new Set(
        targets
          .filter((ref) => /^chat:/i.test(ref))
          .flatMap((ref) => ref.match(uuid) ?? [])
          .map((id) => id.toLowerCase()),
      ),
    ];
    const verifiedJobs = sourceJobs.length
      ? (
          await db.query(
            `SELECT source_job.id FROM ai_jobs source_job JOIN ai_chats source_chat ON source_chat.id=source_job.chat_id
       WHERE source_job.id=ANY($2::uuid[]) AND ${assistantChatContainerVisible("source_chat", "$1")} AND ${assistantJobSourcesVisible("source_job", "$1", false)}`,
            [userId, sourceJobs],
          )
        ).rowCount
      : 0;
    const verifiedChats = readChatIds.length
      ? (
          await db.query(
            `SELECT c.id FROM ai_chats c WHERE c.id=ANY($2::uuid[]) AND c.user_id=$1 AND ${assistantChatEvidenceKnown("c", "$1")}`,
            [userId, readChatIds],
          )
        ).rowCount
      : 0;
    if (
      verifiedJobs !== sourceJobs.length ||
      verifiedChats !== readChatIds.length ||
      ((entries.size || jobs.size) && (!target.chat_id || !target.turn_id))
    ) {
      await db.query(
        "UPDATE ai_jobs SET sources_checked=false WHERE id=$1 AND user_id=$2",
        [jobId, userId],
      );
      return false;
    }
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
      SELECT source_kind,source_id FROM assistant_job_sources WHERE job_id=$1 AND source_id=ANY($2::uuid[])
      UNION SELECT edge.kind,edge.id FROM dependencies parent CROSS JOIN LATERAL (
        SELECT s.source_type AS kind,s.source_id AS id FROM memory_sources s
          WHERE parent.kind='doc' AND s.doc_id=parent.id AND s.source_id IS NOT NULL AND s.source_type IN ('task','doc','project','chat')
        UNION SELECT source_kind,source_id FROM assistant_chat_sources WHERE parent.kind='chat' AND chat_id=parent.id
      ) edge
    ) INSERT INTO assistant_job_sources(job_id,source_kind,source_id) SELECT $1,kind,id FROM dependencies WHERE kind<>'chat' ON CONFLICT DO NOTHING`,
      [jobId, ids],
    );
    if (sourceJobs.length) {
      await db.query(
        `INSERT INTO assistant_job_sources(job_id,source_kind,source_id)
        SELECT $1::uuid,s.source_kind,s.source_id FROM assistant_job_sources s WHERE s.job_id=ANY($2::uuid[])
        UNION SELECT $1,s.source_kind,s.source_id FROM ai_jobs j JOIN assistant_chat_sources s ON s.chat_id=j.chat_id AND s.turn_id=j.turn_id WHERE j.id=ANY($2::uuid[])
        UNION SELECT $1,'chat',j.chat_id FROM ai_jobs j WHERE j.id=ANY($2::uuid[]) AND j.chat_id IS NOT NULL
        ON CONFLICT DO NOTHING`,
        [jobId, sourceJobs],
      );
    }
    if (target.chat_id && target.turn_id)
      await db.query(
        `INSERT INTO assistant_turn_entry_sources(chat_id,turn_id,source_entry_id)
        SELECT $1::uuid,$2::uuid,source.id FROM (
          SELECT unnest($3::uuid[]) AS id
          UNION SELECT s.source_entry_id FROM assistant_turn_entry_sources s WHERE s.chat_id=ANY($4::uuid[])
          UNION SELECT s.source_entry_id FROM ai_jobs j JOIN assistant_turn_entry_sources s ON s.chat_id=j.chat_id AND s.turn_id=j.turn_id WHERE j.id=ANY($5::uuid[])
          UNION SELECT s.source_entry_id FROM assistant_delivery_bindings b JOIN assistant_delivery_entry_sources s ON s.binding_id=b.id WHERE b.work_kind='job' AND b.work_id=ANY($5::uuid[])
          UNION SELECT e.id FROM assistant_conversation_entries e JOIN assistant_conversation_streams stream ON stream.id=e.destination_id JOIN ai_jobs j ON j.chat_id=stream.chat_id AND j.turn_id=e.turn_id WHERE j.id=ANY($5::uuid[]) AND e.role='assistant'
          UNION SELECT e.id FROM assistant_delivery_bindings b JOIN assistant_delivery_intents i ON i.binding_id=b.id JOIN assistant_conversation_entries e ON e.intent_id=i.id
            WHERE b.work_kind='job' AND (b.work_id=ANY($5::uuid[]) OR i.payload->>'execution_chat_id'=ANY($4::text[]))
        ) source ON CONFLICT DO NOTHING`,
        [target.chat_id, target.turn_id, [...entries], chatIds, sourceJobs],
      );
    await db.query(
      `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
      SELECT j.chat_id,j.turn_id,s.source_kind,s.source_id FROM ai_jobs j JOIN assistant_job_sources s ON s.job_id=j.id
      WHERE j.id=$1 AND j.user_id=$2 AND j.chat_id IS NOT NULL AND j.turn_id IS NOT NULL ON CONFLICT DO NOTHING`,
      [jobId, userId],
    );
    for (const source of observed)
      await db.query(
        `INSERT INTO assistant_job_source_revisions(job_id,source_kind,source_id,observed_revision)
        SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM assistant_job_sources WHERE job_id=$1 AND source_kind=$2 AND source_id=$3)
        ON CONFLICT(job_id,source_kind,source_id) DO UPDATE SET observed_revision=
          CASE WHEN assistant_job_source_revisions.observed_revision=EXCLUDED.observed_revision
            THEN EXCLUDED.observed_revision ELSE NULL END`,
        [jobId, source.kind, source.id, source.revision],
      );
    await db.query(
      "UPDATE ai_jobs SET sources_checked=true WHERE id=$1 AND user_id=$2",
      [jobId, userId],
    );
    return true;
  });
  if (!captured)
    throw new Error("The source history has no verified provenance.");
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

import {
  addDays,
  dayTime,
  localDateKey,
  type StudyOverview,
} from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { visibleDocs } from "../../lib/visibility.js";
import {
  assistantSourceVisible,
  visibleAiItems,
} from "../../lib/assistant-source-visibility.js";
import { LIVE_CARDS } from "../study/service.js";

export type AgendaAiSource = {
  kind: "doc" | "task" | "calendar" | "habit" | "exam";
  id: string;
  version?: number;
};
const teamAllowed = (alias: string) =>
  `NOT EXISTS(SELECT 1 FROM teams restricted WHERE restricted.id=${alias}.team_id AND NOT restricted.assistant_allowed)`;
const readable = (alias: string) =>
  `${visibleDocs(alias, { user: "$1", ai: true })} AND ${teamAllowed(alias)}`;
const examDecksAllowed = (alias: string) =>
  `NOT EXISTS(SELECT 1 FROM unnest(${alias}.doc_ids) attached(id) LEFT JOIN docs attached_doc ON attached_doc.id=attached.id WHERE attached_doc.id IS NULL OR NOT (${readable("attached_doc")}))`;

/** Study facts retain original identities and exclude every AI-disabled source. */
export async function agendaAiStudy(
  owner: string,
  overview: StudyOverview,
  now: Date,
  timezone: string,
) {
  const end = dayTime(addDays(localDateKey(now, timezone), 1), 0, timezone);
  const cards = await pool.query<{
    doc_id: string;
    version: number;
    due: number;
    fresh: number;
    cards: number;
    known: number;
    source_ids: string[];
  }>(
    `SELECT d.id AS doc_id,d.version,
     count(*) FILTER(WHERE c.reps>0 AND c.due_at<$2)::int AS due,
     count(*) FILTER(WHERE c.reps=0)::int AS fresh,
     count(*)::int AS cards,count(*) FILTER(WHERE c.reps>0 AND c.stability>=7)::int AS known,
     coalesce(array_agg(DISTINCT c.source_doc_id) FILTER(WHERE c.source_doc_id IS NOT NULL),'{}') AS source_ids
     FROM ${LIVE_CARDS} WHERE c.user_id=$1 AND ${readable("d")}
     AND (c.source_doc_id IS NULL OR EXISTS(SELECT 1 FROM docs original WHERE original.id=c.source_doc_id AND ${readable("original")}))
     GROUP BY d.id,d.version`,
    [owner, end],
  );
  const sources: AgendaAiSource[] = cards.rows.map((row) => ({
    kind: "doc",
    id: row.doc_id,
    version: row.version,
  }));
  const originalIds = [...new Set(cards.rows.flatMap((row) => row.source_ids))];
  if (originalIds.length) {
    const originals = await pool.query<{ id: string; version: number }>(
      `SELECT original.id,original.version FROM docs original WHERE original.id=ANY($2::uuid[]) AND ${readable("original")}`,
      [owner, originalIds],
    );
    if (originals.rows.length !== originalIds.length)
      throw new Error("Agenda Study source changed.");
    sources.push(
      ...originals.rows.map((row) => ({
        kind: "doc" as const,
        id: row.id,
        version: row.version,
      })),
    );
  }
  const byDeck = new Map(cards.rows.map((row) => [row.doc_id, row]));
  const exams: {
    title: string;
    days_left: number;
    readiness: number | null;
  }[] = [];
  for (const exam of overview.exams.filter((exam) => exam.days_left <= 14)) {
    // Associated decks must all remain eligible; never retain a hidden title
    // merely because another attached deck is available.
    const attached = exam.doc_ids.length
      ? await pool.query<{ id: string; version: number }>(
          `SELECT d.id,d.version FROM docs d WHERE d.id=ANY($2::uuid[]) AND ${readable("d")}`,
          [owner, exam.doc_ids],
        )
      : { rows: [] };
    if (attached.rows.length !== new Set(exam.doc_ids).size) continue;
    const item = /^item:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\|/i.exec(
      exam.key,
    );
    const subscription =
      /^sub:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}):/i.exec(exam.key);
    let source: AgendaAiSource | undefined;
    if (item) {
      const row = await pool.query(
        `SELECT i.id,i.version FROM items i WHERE i.id=$2 AND ${assistantSourceVisible("'task'", "i.id")} AND ${teamAllowed("i")}`,
        [owner, item[1]],
      );
      if (row.rows[0])
        source = {
          kind: "task",
          id: row.rows[0].id,
          version: row.rows[0].version,
        };
    } else if (subscription) {
      if (
        (
          await pool.query(
            `SELECT 1 WHERE ${assistantSourceVisible("'calendar'", "$2::uuid")}`,
            [owner, subscription[1]],
          )
        ).rowCount
      )
        source = { kind: "calendar", id: subscription[1] };
    } else {
      const row = await pool.query(
        `SELECT exam.id FROM study_exams exam WHERE exam.user_id=$1 AND exam.exam_key=$2 AND exam.own AND ${assistantSourceVisible("'exam'", "exam.id")} AND ${examDecksAllowed("exam")}`,
        [owner, exam.key],
      );
      if (row.rows[0]) source = { kind: "exam", id: row.rows[0].id };
    }
    if (!source) continue;
    sources.push(
      source,
      ...attached.rows.map((row) => ({
        kind: "doc" as const,
        id: row.id,
        version: row.version,
      })),
    );
    exams.push({
      title: exam.title,
      days_left: exam.days_left,
      readiness: (() => {
        const total = exam.doc_ids.reduce(
          (n, id) => n + (byDeck.get(id)?.cards ?? 0),
          0,
        );
        return total
          ? Math.round(
              (100 *
                exam.doc_ids.reduce(
                  (n, id) => n + (byDeck.get(id)?.known ?? 0),
                  0,
                )) /
                total,
            ) / 100
          : null;
      })(),
    });
  }
  return {
    study: {
      due: cards.rows.reduce((n, row) => n + row.due, 0),
      newCards: Math.min(
        overview.new_cards,
        cards.rows.reduce((n, row) => n + row.fresh, 0),
      ),
      exams,
    },
    sources: [
      ...new Map(
        sources.map((source) => [`${source.kind}:${source.id}`, source]),
      ).values(),
    ],
  };
}

/** A captured Study reference cannot outlive access, AI policy or its page revision. */
export async function assertAgendaStudySources(
  owner: string,
  sources: AgendaAiSource[],
) {
  const tasks = sources.filter((source) => source.kind === "task");
  if (tasks.length) {
    const ids = [...new Set(tasks.map((source) => source.id))];
    const current = await pool.query<{ id: string; version: number }>(
      `SELECT i.id,i.version FROM items i WHERE i.id=ANY($2::uuid[]) AND ${visibleAiItems()}`,
      [owner, ids],
    );
    const versions = new Map(current.rows.map((row) => [row.id, row.version]));
    if (
      current.rows.length !== ids.length ||
      tasks.some(
        (source) =>
          source.version !== undefined &&
          source.version !== versions.get(source.id),
      )
    )
      throw new Error("Agenda Study source changed.");
  }
  for (const source of sources) {
    if (source.kind === "task") continue;
    if (source.kind === "doc") {
      const row = await pool.query<{ version: number }>(
        `SELECT d.version FROM docs d WHERE d.id=$2 AND ${readable("d")}`,
        [owner, source.id],
      );
      if (
        !row.rowCount ||
        (source.version !== undefined && row.rows[0].version !== source.version)
      )
        throw new Error("Agenda Study source changed.");
    } else {
      const row = await pool.query(
        `SELECT 1 WHERE ${assistantSourceVisible("'" + source.kind + "'", "$2::uuid")}`,
        [owner, source.id],
      );
      if (!row.rowCount) throw new Error("Agenda Study source changed.");
      if (source.kind === "exam") {
        const exam = await pool.query(
          `SELECT 1 FROM study_exams exam WHERE exam.id=$2 AND exam.user_id=$1 AND ${examDecksAllowed("exam")}`,
          [owner, source.id],
        );
        if (!exam.rowCount) throw new Error("Agenda Study source changed.");
      }
    }
  }
}

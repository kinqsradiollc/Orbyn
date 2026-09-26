import type { Queryable } from "../db/pool.js";
import { visibleProjects } from "./visibility.js";

/**
 * Keep a project out of the assistant. An owner or admin (the owner, for a
 * personal project) can switch a project off for the assistant; from then
 * on nothing in it reaches any AI: Orbyn's assistant, Study's AI help, the
 * morning agenda's summary, search by meaning and connected agents never
 * read the project, its tasks, pages or records, not even their titles.
 *
 * Two ways in, for two kinds of code:
 * - SQL builders (`notKeptOut*`) for queries written for the AI (MCP
 *   capabilities, semantic search, the agenda);
 * - `keptOutFor` + `scrubKeptOut` for the assistant's tools, whose results
 *   are scrubbed as a last line, whatever a tool read.
 */

/** SQL true when the row on `alias` (with a project_id) isn't in a kept-out project. */
export const notKeptOut = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM projects ko WHERE ko.id = ${alias}.project_id AND ko.assistant_off)`;

/** SQL true when the project on `alias` isn't kept out. */
export const projectNotKeptOut = (alias: string) =>
  `NOT ${alias}.assistant_off`;

/** Everything a person can see that sits in a project kept out of the assistant. */
export type KeptOut = {
  projects: Set<string>;
  /** Tasks, events, pages and records, by id. */
  ids: Set<string>;
  /** Just the tasks and events. */
  items: Set<string>;
};

export const NOTHING_KEPT_OUT: KeptOut = {
  projects: new Set(),
  ids: new Set(),
  items: new Set(),
};

/** What `userId` can see in kept-out projects, by id (cheap when there are none). */
export async function keptOutFor(
  db: Queryable,
  userId: string,
): Promise<KeptOut> {
  const projects = (
    await db.query<{ id: string }>(
      `SELECT p.id FROM projects p
        WHERE p.assistant_off
          AND ${visibleProjects("p")}`,
      [userId],
    )
  ).rows.map((r) => r.id);
  if (!projects.length) return NOTHING_KEPT_OUT;
  const rows = (
    await db.query<{ id: string; item: boolean }>(
      `SELECT id, true AS item FROM items WHERE project_id = ANY($1::uuid[])
       UNION ALL SELECT id, false FROM docs WHERE project_id = ANY($1::uuid[])
       UNION ALL SELECT id, false FROM work_records WHERE project_id = ANY($1::uuid[])`,
      [projects],
    )
  ).rows;
  return {
    projects: new Set(projects),
    ids: new Set(rows.map((r) => r.id)),
    items: new Set(rows.filter((r) => r.item).map((r) => r.id)),
  };
}

/** Keys that name a thing by id in the assistant's tool results. */
const ID_KEYS = [
  "id",
  "item_id",
  "doc_id",
  "task_id",
  "record_id",
  "entity_id",
  "linked_item_id",
  "source_doc_id",
];

/** Whether an object names something kept out. */
function touches(value: Record<string, unknown>, out: KeptOut): boolean {
  for (const key of ID_KEYS) {
    const v = value[key];
    if (typeof v === "string" && (out.ids.has(v) || out.projects.has(v)))
      return true;
  }
  const project = value.project_id;
  return typeof project === "string" && out.projects.has(project);
}

/** Thrown when what was asked for is in a kept-out project. */
export class KeptOutError extends Error {
  constructor() {
    super(
      "That is in a project kept out of the assistant. Its owner or an admin can change this in the project's settings.",
    );
  }
}

/**
 * `value` with everything kept out removed: list entries that name a
 * kept-out thing are dropped, whatever their depth. A result that is itself
 * a kept-out thing throws `KeptOutError`.
 */
export function scrubKeptOut<T>(value: T, out: KeptOut): T {
  if (!out.projects.size) return value;
  const walk = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v))
      return v
        .filter(
          (x) =>
            !(x && typeof x === "object" && !Array.isArray(x)) ||
            !touches(x as Record<string, unknown>, out),
        )
        .map((x) => walk(x, false));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if (top && touches(o, out)) throw new KeptOutError();
      return Object.fromEntries(
        Object.entries(o)
          .filter(
            ([, x]) =>
              !(x && typeof x === "object" && !Array.isArray(x)) ||
              x instanceof Date ||
              !touches(x as Record<string, unknown>, out),
          )
          .map(([k, x]) => [k, walk(x, false)]),
      );
    }
    return v;
  };
  return walk(value, true) as T;
}

/** The answer when a page's project is kept out. */
export const PAGE_KEPT_OUT =
  "This page's project is kept out of the assistant. Its owner or an admin can change this in the project's settings.";

/** Whether a page is in a kept-out project. */
export async function docKeptOut(db: Queryable, docId: string) {
  return !!(
    await db.query(
      `SELECT 1 FROM docs d JOIN projects p ON p.id = d.project_id
        WHERE d.id = $1 AND p.assistant_off`,
      [docId],
    )
  ).rowCount;
}

/** Whether a project is kept out. */
export async function projectKeptOut(db: Queryable, projectId: string) {
  return !!(
    await db.query("SELECT 1 FROM projects WHERE id = $1 AND assistant_off", [
      projectId,
    ])
  ).rowCount;
}

/** Whether a task or event is in a kept-out project. */
export async function itemKeptOut(db: Queryable, itemId: string) {
  return !!(
    await db.query(
      `SELECT 1 FROM items i JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1 AND p.assistant_off`,
      [itemId],
    )
  ).rowCount;
}

/**
 * `rows` without those whose task or event sits in a project kept out of
 * the assistant: for calendar entries and sessions read for an agent.
 */
export async function dropKeptOut<T extends { item_id?: string | null }>(
  db: Queryable,
  rows: T[],
): Promise<T[]> {
  const ids = [
    ...new Set(rows.map((r) => r.item_id).filter((id): id is string => !!id)),
  ];
  if (!ids.length) return rows;
  const out = new Set(
    (
      await db.query<{ id: string }>(
        `SELECT i.id FROM items i JOIN projects p ON p.id = i.project_id
          WHERE p.assistant_off AND i.id = ANY($1::uuid[])`,
        [ids],
      )
    ).rows.map((r) => r.id),
  );
  return out.size
    ? rows.filter((r) => !r.item_id || !out.has(r.item_id))
    : rows;
}

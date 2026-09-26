import {
  dateTitle,
  fail,
  linkContext,
  type LinkedHere,
  type LinkedHereList,
  type LinkOption,
  type LinkPill,
  type LinkSource,
  type ObjectRef,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { docReadableBy, docVisibleTo } from "../../lib/doc-visibility.js";
import { visibleItems, visibleProjects } from "../../lib/visibility.js";
import { find } from "../search/find.js";

/**
 * Links between things (LNK-01, LNK-02, LNK-05), read from the object_links
 * index (migration 111). The app and, later, the agents' get_links read
 * through these, so the visibility rule lives in one place: a row is shown
 * only when its source and its target are both yours to open, and one that
 * isn't is dropped without being counted — a private page's title never
 * reaches someone who can't open it.
 */

/** The kind a link is indexed under: tasks and events are one table. */
const indexedKind = (kind: ObjectRef["kind"]) =>
  kind === "event" ? "task" : kind;

/** SQL true when user `$1` shares a team with, or is, the person `alias.id`. */
const personVisible = (alias: string) => `(${alias}.id = $1 OR EXISTS (
  SELECT 1 FROM team_members a JOIN team_members b ON b.team_id = a.team_id
   WHERE a.user_id = $1 AND b.user_id = ${alias}.id))`;

/** Whether `userId` may open the thing links are asked about. */
async function targetVisible(
  db: Queryable,
  userId: string,
  target: ObjectRef,
): Promise<boolean> {
  const sql: Record<string, string> = {
    doc: `SELECT 1 FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
    task: `SELECT 1 FROM items i WHERE i.id = $2 AND ${visibleItems("i")}`,
    project: `SELECT 1 FROM projects p WHERE p.id = $2 AND ${visibleProjects("p")}`,
    person: `SELECT 1 FROM users u WHERE u.id = $2 AND ${personVisible("u")}`,
  };
  const query = sql[indexedKind(target.kind)];
  if (!query) return false;
  return (await db.query(query, [userId, target.id])).rowCount! > 0;
}

type HereRow = {
  source_kind: "doc" | "task";
  source_id: string;
  source_block: string;
  link_kind: LinkSource;
  context: string;
  title: string | null;
  hint: string | null;
};

const DOC_HINT = `CASE d.kind WHEN 'note' THEN 'Note' WHEN 'meeting' THEN 'Meeting note'
  WHEN 'agenda' THEN 'Agenda' ELSE 'Page' END`;

/** How many places one "Linked here" list shows. */
export const HERE_LIMIT = 100;

/**
 * What links to one page, task, project or person: one entry per place,
 * newest first, each with the line around the link. 404 when the thing
 * itself isn't yours to open.
 */
export async function linksHere(
  db: Queryable,
  userId: string,
  target: ObjectRef,
): Promise<LinkedHereList> {
  if (!(await targetVisible(db, userId, target))) fail(404, "Not found");
  const kind = indexedKind(target.kind);
  const rows = (
    await db.query<HereRow>(
      `SELECT DISTINCT ON (l.source_kind, l.source_id)
              l.source_kind, l.source_id, l.source_block, l.link_kind, l.context,
              coalesce(d.title, i.title) AS title,
              CASE WHEN l.source_kind = 'doc'
                   THEN coalesce(dp.name, ${DOC_HINT})
                   ELSE coalesce(ip.name, CASE WHEN i.kind = 'event' THEN 'Event'
                                               ELSE 'Task' END) END AS hint,
              coalesce(d.updated_at, i.updated_at) AS updated_at
         FROM object_links l
         LEFT JOIN docs d ON l.source_kind = 'doc' AND d.id = l.source_id
         LEFT JOIN projects dp ON dp.id = d.project_id
         LEFT JOIN items i ON l.source_kind = 'task' AND i.id = l.source_id
         LEFT JOIN projects ip ON ip.id = i.project_id
        WHERE l.target_kind = $2 AND l.target_id = $3
          AND NOT (l.source_kind = $2 AND l.source_id::text = $3)
          AND ((l.source_kind = 'doc' AND d.id IS NOT NULL AND ${docVisibleTo("$1")})
            OR (l.source_kind = 'task' AND i.id IS NOT NULL AND ${visibleItems("i")}))
        ORDER BY l.source_kind, l.source_id,
                 -- A picker link says most about why; then the fixed kinds.
                 CASE l.link_kind WHEN 'link' THEN 0 WHEN 'task_line' THEN 1
                   WHEN 'meeting' THEN 2 WHEN 'project' THEN 3 ELSE 4 END,
                 l.source_block`,
      [userId, kind, target.id.toLowerCase()],
    )
  ).rows as (HereRow & { updated_at: Date })[];
  rows.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
  const items: LinkedHere[] = rows.slice(0, HERE_LIMIT).map((r) => ({
    kind: r.source_kind,
    id: r.source_id,
    title: r.title || "Untitled",
    hint: r.hint,
    source: r.link_kind,
    block_id:
      (r.link_kind === "link" || r.link_kind === "task_line") &&
      r.source_block &&
      !r.source_block.startsWith("#")
        ? r.source_block
        : null,
    context: linkContext(r.context, r.link_kind === "link" ? target : null),
  }));
  return { count: rows.length, items };
}

/**
 * Each link's pill as it stands now: its live title, a task's tick and
 * deadline, or that it was deleted. A page in the Trash that you could open
 * shows as deleted (restorable when you may restore it); anything gone for
 * good or never yours is "missing", with no title, and the two look alike.
 */
export async function resolveLinks(
  db: Queryable,
  userId: string,
  refs: ObjectRef[],
): Promise<LinkPill[]> {
  const ids = (kinds: string[]) =>
    refs.filter((r) => kinds.includes(r.kind)).map((r) => r.id.toLowerCase());
  const docIds = ids(["doc"]);
  const itemIds = ids(["task", "event"]);
  const projectIds = ids(["project"]);
  const personIds = ids(["person"]);
  const [docs, items, projects, people] = await Promise.all([
    docIds.length
      ? db.query<{
          id: string;
          title: string;
          deleted: boolean;
          can_restore: boolean;
        }>(
          `SELECT d.id, d.title, d.deleted_at IS NOT NULL AS deleted,
                  (d.team_id IS NULL OR m.role IN ('owner', 'admin', 'member'))
                    AS can_restore
             FROM docs d
             LEFT JOIN team_members m ON m.team_id = d.team_id AND m.user_id = $1
            WHERE d.id = ANY ($2::uuid[]) AND ${docReadableBy("$1")}`,
          [userId, docIds],
        )
      : null,
    itemIds.length
      ? db.query<{
          id: string;
          title: string;
          status: string;
          due_at: Date | null;
        }>(
          `SELECT i.id, i.title, i.status, i.due_at FROM items i
            WHERE i.id = ANY ($2::uuid[]) AND ${visibleItems("i")}`,
          [userId, itemIds],
        )
      : null,
    projectIds.length
      ? db.query<{ id: string; name: string }>(
          `SELECT p.id, p.name FROM projects p
            WHERE p.id = ANY ($2::uuid[]) AND ${visibleProjects("p")}`,
          [userId, projectIds],
        )
      : null,
    personIds.length
      ? db.query<{ id: string; name: string }>(
          `SELECT u.id, u.name FROM users u
            WHERE u.id = ANY ($2::uuid[]) AND ${personVisible("u")}`,
          [userId, personIds],
        )
      : null,
  ]);
  const byId = <T extends { id: string }>(rows: T[] | undefined) =>
    new Map((rows ?? []).map((r) => [r.id, r]));
  const docMap = byId(docs?.rows);
  const itemMap = byId(items?.rows);
  const projectMap = byId(projects?.rows);
  const personMap = byId(people?.rows);
  const missing = (r: ObjectRef): LinkPill => ({
    kind: r.kind,
    id: r.id,
    state: "missing",
    title: null,
  });
  return refs.map((r): LinkPill => {
    const id = r.id.toLowerCase();
    switch (r.kind) {
      case "doc": {
        const d = docMap.get(id);
        if (!d) return missing(r);
        return d.deleted
          ? {
              kind: r.kind,
              id,
              state: "deleted",
              title: d.title || "Untitled",
              can_restore: d.can_restore,
            }
          : { kind: r.kind, id, state: "ok", title: d.title || "Untitled" };
      }
      case "task":
      case "event": {
        const i = itemMap.get(id);
        if (!i) return missing(r);
        return {
          kind: r.kind,
          id,
          state: "ok",
          title: i.title || "Untitled",
          done: i.status === "done",
          due_at: i.due_at ? new Date(i.due_at).toISOString() : null,
        };
      }
      case "project": {
        const p = projectMap.get(id);
        return p
          ? { kind: r.kind, id, state: "ok", title: p.name || "Untitled" }
          : missing(r);
      }
      case "person": {
        const p = personMap.get(id);
        return p
          ? { kind: r.kind, id, state: "ok", title: p.name || "Someone" }
          : missing(r);
      }
      case "date":
        return { kind: r.kind, id, state: "ok", title: dateTitle(id) };
    }
  });
}

/** `%` and `_` typed are letters to find, not wildcards. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * What the link picker offers for the words typed: pages, tasks, events and
 * projects by name (the quick switcher's ranking, recent ones first when
 * nothing is typed), with each task's tick and deadline, then teammates by
 * name. Dates are the app's own (they depend on the person's day).
 */
export async function pickOptions(
  db: Queryable,
  userId: string,
  q: string,
  limit: number,
): Promise<LinkOption[]> {
  const [hits, people] = await Promise.all([
    find(db, userId, { q, limit }),
    q
      ? db.query<{ id: string; name: string }>(
          `SELECT u.id, u.name FROM users u
            WHERE ${personVisible("u")} AND u.name ILIKE '%' || $2 || '%'
            ORDER BY (u.name ILIKE $2 || '%') DESC, u.name
            LIMIT 5`,
          [userId, likeEscape(q)],
        )
      : null,
  ]);
  const itemIds = hits
    .filter((h) => h.type === "task" || h.type === "event")
    .map((h) => h.id);
  const state = new Map(
    itemIds.length
      ? (
          await db.query<{ id: string; status: string; due_at: Date | null }>(
            "SELECT id, status, due_at FROM items WHERE id = ANY ($1::uuid[])",
            [itemIds],
          )
        ).rows.map((r) => [r.id, r])
      : [],
  );
  const options: LinkOption[] = hits.map((h) => {
    const s = state.get(h.id);
    return {
      kind: h.type,
      id: h.id,
      title: h.title,
      hint: h.hint,
      ...(s
        ? {
            done: s.status === "done",
            due_at: s.due_at ? new Date(s.due_at).toISOString() : null,
          }
        : {}),
    };
  });
  for (const p of people?.rows ?? [])
    options.push({
      kind: "person",
      id: p.id,
      title: p.name || "Someone",
      hint: p.id === userId ? "You" : "Person",
    });
  return options;
}

import type { FastifyInstance } from "fastify";
import { findQuery, recentOpenInput, type FindHit } from "@orbyn/core";
import { pool, reader, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { docArchived, docVisibleTo } from "../../lib/doc-visibility.js";
import { visibleItems, visibleProjects } from "../../lib/visibility.js";

/**
 * The quick switcher (NAV-02): pages, tasks and projects by name, from the
 * first letter typed, with what you opened lately lifted. With nothing
 * typed it lists what you opened last, topped up with what changed last,
 * so a new account's switcher is never empty.
 *
 * Matching is on names only (the letters, then how alike they look), which
 * is what a switcher is for; the words inside pages are /search's job.
 */

/** How many things the recent list remembers per person. */
export const RECENT_KEEP = 50;

type Row = {
  id: string;
  type: FindHit["type"];
  title: string;
  hint: string | null;
  team_id: string | null;
  updated_at: Date;
  opened_at: Date | null;
  score?: number;
};

const DOC_HINT = `CASE d.kind WHEN 'note' THEN 'Note' WHEN 'meeting' THEN 'Meeting note'
  WHEN 'agenda' THEN 'Agenda' ELSE 'Page' END`;

/** `%` and `_` typed are letters to find, not wildcards. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * How well a name fits what was typed: the whole name, its start, anywhere
 * in it, how alike it looks, then lifted a little for something you opened
 * lately and for something changed lately.
 */
const score = (name: string, updated: string) => `
  (CASE WHEN lower(${name}) = lower($2::text) THEN 3
        WHEN ${name} ILIKE $3::text || '%' THEN 2
        WHEN ${name} ILIKE '%' || $3::text || '%' THEN 1
        ELSE 0 END)
  + similarity(${name}, $2::text)
  + CASE WHEN ro.opened_at IS NOT NULL THEN 0.6 ELSE 0 END
  + 0.3 * exp(-(extract(epoch FROM now() - ${updated}) / 2592000))`;

const nameMatch = (name: string) =>
  `(${name} ILIKE '%' || $3::text || '%' OR similarity(${name}, $2::text) > 0.3)`;

/**
 * Another name (LNK-03) fits what was typed: as well as a title would, so a
 * course code finds its page. `aliases` is the text[] column.
 */
const aliasScore = (aliases: string) => `
  (CASE WHEN EXISTS (SELECT 1 FROM unnest(${aliases}) a
                      WHERE lower(a) = lower($2::text)) THEN 3
        WHEN EXISTS (SELECT 1 FROM unnest(${aliases}) a
                      WHERE a ILIKE $3::text || '%') THEN 2
        WHEN orbyn_aliases(${aliases}) ILIKE '%' || $3::text || '%' THEN 1
        ELSE 0 END)`;

/** The other name that matched, for the hint: "Also called CS101". */
const aliasHit = (aliases: string) => `(SELECT a FROM unnest(${aliases}) a
  WHERE a ILIKE '%' || $3::text || '%' ORDER BY length(a) LIMIT 1)`;

const recentJoin = (kind: string, id: string) =>
  `LEFT JOIN recent_opens ro
     ON ro.user_id = $1 AND ro.kind = '${kind}' AND ro.target_id = ${id}`;

/** Archived pages are left out unless asked for (SRCH-03). */
const live = (archived: boolean) =>
  archived ? "" : `AND NOT ${docArchived("d")}`;

async function byName(
  db: Queryable,
  userId: string,
  q: string,
  type: string | undefined,
  limit: number,
  archived = false,
): Promise<Row[]> {
  const params = [userId, q, likeEscape(q), limit];
  const parts: Promise<Row[]>[] = [];
  if (!type || type === "doc")
    parts.push(
      db
        .query<Row>(
          `SELECT d.id, 'doc' AS type, d.title,
                  CASE WHEN d.title NOT ILIKE '%' || $3::text || '%'
                            AND ${aliasHit("d.aliases")} IS NOT NULL
                       THEN 'Also called ' || ${aliasHit("d.aliases")}
                       ELSE COALESCE(p.name, ${DOC_HINT}) END AS hint,
                  d.team_id, d.updated_at, ro.opened_at,
                  ${score("d.title", "d.updated_at")}
                    + ${aliasScore("d.aliases")} AS score
             FROM docs d
             LEFT JOIN projects p ON p.id = d.project_id
             ${recentJoin("doc", "d.id")}
            WHERE ${docVisibleTo("$1")} ${live(archived)}
              AND (${nameMatch("d.title")}
                OR orbyn_aliases(d.aliases) ILIKE '%' || $3::text || '%')
            ORDER BY score DESC, d.updated_at DESC
            LIMIT $4`,
          params,
        )
        .then((r) => r.rows),
    );
  if (!type || type === "task")
    parts.push(
      db
        .query<Row>(
          `SELECT i.id, CASE WHEN i.kind = 'event' THEN 'event' ELSE 'task' END AS type,
                  i.title, COALESCE(p.name, CASE WHEN i.kind = 'event' THEN 'Event'
                    WHEN i.status IN ('done', 'cancelled') THEN 'Done' ELSE 'Task' END) AS hint,
                  i.team_id, i.updated_at, ro.opened_at,
                  ${score("i.title", "i.updated_at")}
                    - CASE WHEN i.status IN ('done', 'cancelled') THEN 0.5 ELSE 0 END AS score
             FROM items i
             LEFT JOIN projects p ON p.id = i.project_id
             ${recentJoin("task", "i.id")}
            WHERE ${visibleItems("i")} AND ${nameMatch("i.title")}
            ORDER BY score DESC, i.updated_at DESC
            LIMIT $4`,
          params,
        )
        .then((r) => r.rows),
    );
  if (!type || type === "project")
    parts.push(
      db
        .query<Row>(
          `SELECT p.id, 'project' AS type, p.name AS title,
                  CASE WHEN p.name NOT ILIKE '%' || $3::text || '%'
                            AND ${aliasHit("p.aliases")} IS NOT NULL
                       THEN 'Also called ' || ${aliasHit("p.aliases")}
                       WHEN p.status = 'archived' THEN 'Archived'
                       WHEN p.status = 'done' THEN 'Done' ELSE 'Project' END AS hint,
                  p.team_id, p.updated_at, ro.opened_at,
                  ${score("p.name", "p.updated_at")}
                    + ${aliasScore("p.aliases")}
                    - CASE WHEN p.status = 'archived' THEN 0.5 ELSE 0 END AS score
             FROM projects p
             ${recentJoin("project", "p.id")}
            WHERE ${visibleProjects("p")}
              AND (${nameMatch("p.name")}
                OR orbyn_aliases(p.aliases) ILIKE '%' || $3::text || '%')
            ORDER BY score DESC, p.updated_at DESC
            LIMIT $4`,
          params,
        )
        .then((r) => r.rows),
    );
  const rows = (await Promise.all(parts)).flat();
  return rows
    .sort(
      (a, b) =>
        Number(b.score) - Number(a.score) ||
        b.updated_at.getTime() - a.updated_at.getTime(),
    )
    .slice(0, limit);
}

/** What you opened last, newest first, still there and still yours to see. */
async function recentlyOpened(
  db: Queryable,
  userId: string,
  type: string | undefined,
  limit: number,
  archived = false,
): Promise<Row[]> {
  const parts: string[] = [];
  if (!type || type === "doc")
    parts.push(`SELECT d.id, 'doc' AS type, d.title,
                       COALESCE(p.name, ${DOC_HINT}) AS hint, d.team_id,
                       d.updated_at, ro.opened_at
                  FROM recent_opens ro
                  JOIN docs d ON d.id = ro.target_id
                  LEFT JOIN projects p ON p.id = d.project_id
                 WHERE ro.user_id = $1 AND ro.kind = 'doc' AND ${docVisibleTo("$1")}
                   ${live(archived)}`);
  if (!type || type === "task")
    parts.push(`SELECT i.id, CASE WHEN i.kind = 'event' THEN 'event' ELSE 'task' END AS type,
                       i.title, COALESCE(p.name, CASE WHEN i.kind = 'event' THEN 'Event'
                         ELSE 'Task' END) AS hint, i.team_id, i.updated_at, ro.opened_at
                  FROM recent_opens ro
                  JOIN items i ON i.id = ro.target_id
                  LEFT JOIN projects p ON p.id = i.project_id
                 WHERE ro.user_id = $1 AND ro.kind = 'task' AND ${visibleItems("i")}`);
  if (!type || type === "project")
    parts.push(`SELECT p.id, 'project' AS type, p.name AS title, 'Project' AS hint,
                       p.team_id, p.updated_at, ro.opened_at
                  FROM recent_opens ro
                  JOIN projects p ON p.id = ro.target_id
                 WHERE ro.user_id = $1 AND ro.kind = 'project' AND ${visibleProjects("p")}`);
  return (
    await db.query<Row>(
      `${parts.join(" UNION ALL ")} ORDER BY opened_at DESC LIMIT $2`,
      [userId, limit],
    )
  ).rows;
}

/** What changed last: your pages, open tasks and live projects. */
async function recentlyChanged(
  db: Queryable,
  userId: string,
  type: string | undefined,
  limit: number,
  archived = false,
): Promise<Row[]> {
  const parts: string[] = [];
  if (!type || type === "doc")
    parts.push(`(SELECT d.id, 'doc' AS type, d.title,
                        COALESCE(p.name, ${DOC_HINT}) AS hint, d.team_id,
                        d.updated_at, NULL::timestamptz AS opened_at
                   FROM docs d LEFT JOIN projects p ON p.id = d.project_id
                  WHERE ${docVisibleTo("$1")} AND d.kind <> 'agenda'
                    ${live(archived)}
                  ORDER BY d.updated_at DESC LIMIT $2)`);
  if (!type || type === "task")
    parts.push(`(SELECT i.id, CASE WHEN i.kind = 'event' THEN 'event' ELSE 'task' END AS type,
                        i.title, COALESCE(p.name, CASE WHEN i.kind = 'event' THEN 'Event'
                          ELSE 'Task' END) AS hint, i.team_id, i.updated_at,
                        NULL::timestamptz AS opened_at
                   FROM items i LEFT JOIN projects p ON p.id = i.project_id
                  WHERE ${visibleItems("i")} AND i.kind <> 'event'
                    AND i.status NOT IN ('done', 'cancelled')
                  ORDER BY i.updated_at DESC LIMIT $2)`);
  if (!type || type === "project")
    parts.push(`(SELECT p.id, 'project' AS type, p.name AS title, 'Project' AS hint,
                        p.team_id, p.updated_at, NULL::timestamptz AS opened_at
                   FROM projects p
                  WHERE ${visibleProjects("p")} AND p.status = 'active'
                  ORDER BY p.updated_at DESC LIMIT $2)`);
  return (
    await db.query<Row>(
      `SELECT * FROM (${parts.join(" UNION ALL ")}) changed
        ORDER BY updated_at DESC LIMIT $2`,
      [userId, limit],
    )
  ).rows;
}

const toHit = (r: Row): FindHit => ({
  id: r.id,
  type: r.type,
  title: r.title || "Untitled",
  hint: r.hint,
  team_id: r.team_id,
  updated_at: new Date(r.updated_at).toISOString(),
  recent: r.opened_at !== null,
});

/** The quick switcher's answer for `q` (empty: the recent list). */
export async function find(
  db: Queryable,
  userId: string,
  o: { q: string; type?: string; limit: number; include_archived?: boolean },
): Promise<FindHit[]> {
  const archived = !!o.include_archived;
  if (o.q)
    return (await byName(db, userId, o.q, o.type, o.limit, archived)).map(
      toHit,
    );
  const opened = await recentlyOpened(db, userId, o.type, o.limit, archived);
  if (opened.length >= o.limit) return opened.map(toHit);
  const seen = new Set(opened.map((r) => `${r.type}:${r.id}`));
  const more = (
    await recentlyChanged(db, userId, o.type, o.limit, archived)
  ).filter((r) => !seen.has(`${r.type}:${r.id}`));
  return [...opened, ...more].slice(0, o.limit).map(toHit);
}

export async function findRoutes(app: FastifyInstance) {
  app.get("/find", async (r): Promise<FindHit[]> => {
    const u = await authenticate(r);
    const q = findQuery.parse(r.query ?? {});
    return find(reader(r.headers), u.id, q);
  });

  /**
   * Something was just opened: it goes to the top of the recent list. Only
   * the newest RECENT_KEEP are kept; the list only ever shows what the
   * person can still see, so an id they can't see is never listed.
   */
  app.post("/recents", async (r, reply) => {
    const u = await authenticate(r);
    const { kind, id } = recentOpenInput.parse(r.body ?? {});
    await pool.query(
      `WITH opened AS (
         INSERT INTO recent_opens(user_id, kind, target_id, opened_at)
         VALUES($1, $2, $3, now())
         ON CONFLICT (user_id, kind, target_id) DO UPDATE SET opened_at = now()
       )
       DELETE FROM recent_opens
        WHERE user_id = $1
          AND (kind, target_id) IN (
            SELECT kind, target_id FROM recent_opens WHERE user_id = $1
             ORDER BY opened_at DESC OFFSET ${RECENT_KEEP - 1})
          AND NOT (kind = $2 AND target_id = $3)`,
      [u.id, kind, id],
    );
    return reply.code(204).send();
  });
}

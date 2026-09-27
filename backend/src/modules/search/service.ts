import type { z } from "zod";
import type { SearchHit, searchQuery } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import type { NearHit } from "./vectors.js";
import { searchRank } from "./rank.js";

export { searchRank };
import {
  assistantMayRead,
  docArchived,
  docVisibleTo,
} from "../../lib/doc-visibility.js";
import {
  visibleItems,
  visibleProjects,
  visibleRecords,
} from "../../lib/visibility.js";
import { readableLinks } from "../links/privacy.js";

/**
 * One search across pages and tasks (and, within a project, its records):
 * the search service. GET /search, the project page's search box and the
 * assistant's search_docs all find things through it, so the app and the
 * assistant rank the same way; agents' search (capabilities/search.ts)
 * ranks with the same formula ({@link searchRank}).
 *
 * Postgres does the searching. It already holds everything written down,
 * and a search service beside eleven containers would be a lot of moving
 * parts for a workspace's worth of words. What it gives up against a
 * dedicated engine is the exact ranking formula, and that is one expression
 * here rather than a rewrite if it ever matters.
 *
 * Two things are looked for at once: the words, weighted so a title counts
 * for more than a mention halfway down a page, and the letters of the title,
 * so `desgin reveiw` still finds Design review. A recently edited page beats
 * an old one that says the words once, because the thing someone is looking
 * for is usually the thing they were last working on.
 */

/**
 * The team filter: a team's id, or "personal" for what belongs to no team
 * (team:personal). Compared as text so the one parameter can carry either.
 */
const TEAM = (alias: string, param: string) =>
  `(${param}::text IS NULL OR (${param} = 'personal' AND ${alias}.team_id IS NULL)
    OR ${alias}.team_id::text = ${param})`;

/** Where the matched words are wrapped, for a client that wants to mark them. */
const MARKS =
  "StartSel=[[, StopSel=]], MaxWords=26, MinWords=10, MaxFragments=1";

const RANK = (vector: string, title: string, updated: string) =>
  searchRank(vector, title, updated, "$2");

export type PageSearch = {
  q: string;
  kind?: string;
  project?: string;
  tag?: string;
  team?: string;
  updatedAfter?: string;
  /** Pages about this task: made from it, or with a checklist line for it. */
  task?: string;
  limit: number;
  /** How matched words are wrapped in snippets (none for the assistant). */
  marks?: string;
  /** Archived pages too (SRCH-03's "Include archived"). */
  archived?: boolean;
  /** The assistant is asking: teams that keep pages out of it are left out. */
  forAssistant?: boolean;
};

/**
 * The one page search: the search box, a project's search and the
 * assistant's search_docs all find pages through it, ranked the same way,
 * and only pages the person can see (never ones in the Trash).
 */
export async function searchPages(
  db: Queryable,
  userId: string,
  o: PageSearch,
): Promise<SearchHit[]> {
  return (
    await db.query<SearchHit>(
      `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
       SELECT d.id, 'doc' AS type, d.title, d.kind, d.team_id,
              d.project_id, p.name AS project_name, d.updated_at,
              ts_headline('english', doc_words(d.content, NULL), q.tsq,
                          '${o.marks ?? MARKS}') AS snippet,
              (SELECT b->>'id' FROM jsonb_array_elements(d.content) b
                WHERE b->>'text' IS NOT NULL AND b->>'id' IS NOT NULL
                  AND to_tsvector('english', b->>'text') @@ q.tsq
                LIMIT 1) AS block_id,
              ${RANK("d.search", "d.title", "d.updated_at")} AS rank
         FROM docs d
         LEFT JOIN projects p ON p.id = d.project_id
         CROSS JOIN q
        WHERE ${docVisibleTo("$1")}
          AND ($2::text = '' OR d.search @@ q.tsq OR similarity(d.title, $2) > 0.25)
          AND ($3::text IS NULL OR d.kind = $3)
          AND ($4::uuid IS NULL OR d.project_id = $4)
          AND ($5::uuid IS NULL OR EXISTS (
                SELECT 1 FROM doc_tags dt
                 WHERE dt.doc_id = d.id AND dt.tag_id = $5))
          AND ${TEAM("d", "$6")}
          AND ($7::timestamptz IS NULL OR d.updated_at >= $7)
          AND ($9::uuid IS NULL OR d.item_id = $9 OR EXISTS (
                SELECT 1 FROM doc_task_links l
                 WHERE l.doc_id = d.id AND l.item_id = $9))
          ${o.archived ? "" : `AND NOT ${docArchived("d")}`}
          ${o.forAssistant ? `AND ${assistantMayRead("d")}` : ""}
        ORDER BY rank DESC, d.updated_at DESC
        LIMIT $8`,
      [
        userId,
        o.q,
        o.kind ?? null,
        o.project ?? null,
        o.tag ?? null,
        o.team ?? null,
        o.updatedAfter ?? null,
        o.limit,
        o.task ?? null,
      ],
    )
  ).rows;
}

/**
 * Search pages, tasks and records for `userId`, ranked on one scale.
 * `nearest` adds meaning to the words (only where the admin turned semantic
 * search on): the app's route passes modules/search/semantic.ts's; agents'
 * paths never do, so this module never loads an AI provider.
 */
export async function searchEverything(
  db: Queryable,
  userId: string,
  q: z.output<typeof searchQuery>,
  options: {
    nearest?: (
      userId: string,
      query: string,
      limit?: number,
      projectId?: string,
    ) => Promise<NearHit[]>;
  },
): Promise<SearchHit[]> {
  // Tasks, records and projects share this list (tasks add their tag as
  // $7): a placeholder a query never mentions has no type for Postgres to
  // infer, and it refuses the whole statement.
  const itemParams = [
    userId,
    q.q,
    q.project ?? null,
    q.team ?? null,
    q.updated_after ?? null,
    q.limit,
  ];

  const wantsDocs = !q.type || q.type === "doc";
  // Tasks carry tags too (item_tags, from the same tags as pages).
  const wantsItems = !q.type || q.type === "task";
  // Projects have no tags, kinds or a project of their own, so a search
  // narrowed by one of those isn't looking for a project.
  const wantsProjects =
    (!q.type || q.type === "project") && !q.tag && !q.kind && !q.project;
  // Records have no search index of their own, so they are looked through
  // only within one project (or when asked for), where there are few.
  const wantsRecords =
    !q.tag && !q.kind && (q.type === "record" || (!q.type && !!q.project));

  const docs = wantsDocs
    ? await searchPages(db, userId, {
        q: q.q,
        kind: q.kind,
        project: q.project,
        tag: q.tag,
        team: q.team,
        updatedAfter: q.updated_after,
        limit: q.limit,
        archived: q.include_archived,
      })
    : [];

  const items = wantsItems
    ? (
        await db.query<SearchHit>(
          `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
           SELECT i.id, 'task' AS type, i.title, i.kind, i.team_id,
                  i.project_id, p.name AS project_name, i.updated_at,
                  ts_headline('english', i.notes, q.tsq, '${MARKS}') AS snippet,
                  NULL AS block_id,
                  ${RANK("i.search", "i.title", "i.updated_at")} AS rank
             FROM items i
             LEFT JOIN projects p ON p.id = i.project_id
             CROSS JOIN q
            WHERE ${visibleItems()}
              AND ($2::text = '' OR i.search @@ q.tsq OR similarity(i.title, $2) > 0.25)
              AND ($3::uuid IS NULL OR i.project_id = $3)
              AND ${TEAM("i", "$4")}
              AND ($5::timestamptz IS NULL OR i.updated_at >= $5)
              AND ($7::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM item_tags x
                     WHERE x.item_id = i.id AND x.tag_id = $7))
            ORDER BY rank DESC, i.updated_at DESC
            LIMIT $6`,
          [...itemParams, q.tag ?? null],
        )
      ).rows
    : [];

  const records = wantsRecords
    ? (
        await db.query<SearchHit>(
          `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
           SELECT w.id, 'record' AS type, w.title, w.kind, w.team_id,
                  w.project_id, p.name AS project_name, w.updated_at,
                  ts_headline('english', w.details, q.tsq, '${MARKS}') AS snippet,
                  NULL AS block_id,
                  ${RANK(
                    "setweight(to_tsvector('english', w.title), 'A') || setweight(to_tsvector('english', w.details), 'C')",
                    "w.title",
                    "w.updated_at",
                  )} AS rank
             FROM work_records w
             LEFT JOIN projects p ON p.id = w.project_id
             CROSS JOIN q
            WHERE ${visibleRecords("w")}
              AND ($2::text = '' OR to_tsvector('english', w.title || ' ' || w.details) @@ q.tsq
                   OR similarity(w.title, $2) > 0.25)
              AND ($3::uuid IS NULL OR w.project_id = $3)
              AND ${TEAM("w", "$4")}
              AND ($5::timestamptz IS NULL OR w.updated_at >= $5)
            ORDER BY rank DESC, w.updated_at DESC
            LIMIT $6`,
          itemParams,
        )
      ).rows
    : [];

  const projects = wantsProjects
    ? (
        await db.query<SearchHit>(
          `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
           SELECT p.id, 'project' AS type, p.name AS title, p.status AS kind,
                  p.team_id, p.id AS project_id, p.name AS project_name,
                  p.updated_at,
                  ts_headline('english', p.summary, q.tsq, '${MARKS}') AS snippet,
                  NULL AS block_id,
                  ${RANK(
                    "setweight(to_tsvector('english', p.name || ' ' || orbyn_aliases(p.aliases)), 'A') || setweight(to_tsvector('english', p.summary), 'C')",
                    "p.name",
                    "p.updated_at",
                  )} AS rank
             FROM projects p
             CROSS JOIN q
            WHERE ${visibleProjects("p")}
              AND ($2::text = '' OR to_tsvector('english', p.name || ' ' || p.summary
                                                   || ' ' || orbyn_aliases(p.aliases)) @@ q.tsq
                   OR similarity(p.name, $2) > 0.25
                   OR orbyn_aliases(p.aliases) ILIKE '%' || $2 || '%')
              AND ($3::uuid IS NULL OR p.id = $3)
              AND ${TEAM("p", "$4")}
              AND ($5::timestamptz IS NULL OR p.updated_at >= $5)
            ORDER BY rank DESC, p.updated_at DESC
            LIMIT $6`,
          itemParams,
        )
      ).rows
    : [];

  // The lists are ranked on the same scale, so they interleave honestly.
  // With no words every rank is level, so the newest leads.
  const found = [...docs, ...items, ...records, ...projects].sort(
    (a, b) =>
      Number(b.rank) - Number(a.rank) ||
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  /**
   * Meaning is added to the words, never used instead of them: a page the
   * words already found is lifted a little, and a page only meaning found
   * joins the end rather than displacing a plain match. That way turning
   * semantic search on can improve an order but not overturn it, and
   * turning it off changes nothing anyone was relying on.
   */
  // Meaning needs words to go on.
  if (wantsDocs && options.nearest && q.q) {
    const near = await options.nearest(userId, q.q, q.limit, q.project);
    if (near.length) {
      const byId = new Map(found.map((h) => [h.id, h]));
      for (const hit of near) {
        const already = byId.get(hit.id);
        if (already) {
          already.rank = Number(already.rank) + hit.nearness * 0.25;
          continue;
        }
        const page = (
          await db.query<SearchHit>(
            `SELECT d.id, 'doc' AS type, d.title, d.kind, d.team_id,
                    d.project_id, p.name AS project_name, d.updated_at
              FROM docs d LEFT JOIN projects p ON p.id = d.project_id
              WHERE d.id = $1
                AND ($2::text IS NULL OR d.kind = $2)
                AND ($3::uuid IS NULL OR d.project_id = $3)
                AND ${docVisibleTo("$4")}
                ${q.include_archived ? "" : `AND NOT ${docArchived("d")}`}`,
            [hit.id, q.kind ?? null, q.project ?? null, userId],
          )
        ).rows[0];
        if (!page) continue;
        found.push({
          ...page,
          snippet: hit.quote,
          block_id: hit.block_id,
          // Below every word match, because it matched no words.
          rank: hit.nearness * 0.2,
        });
        byId.set(page.id, page);
      }
      found.sort((a, b) => Number(b.rank) - Number(a.rank));
    }
  }

  // A hit's words show only the links this reader may open (D3aF).
  return readableLinks(db, userId, found.slice(0, q.limit));
}

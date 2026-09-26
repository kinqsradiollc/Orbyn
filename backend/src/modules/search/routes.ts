import type { FastifyInstance } from "fastify";
import { searchQuery, type SearchHit } from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { nearest } from "./semantic.js";

/**
 * One search across pages and tasks.
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

/** Where the matched words are wrapped, for a client that wants to mark them. */
const MARKS =
  "StartSel=[[, StopSel=]], MaxWords=26, MinWords=10, MaxFragments=1";

/**
 * Rank: how well the words match, lifted for a page touched recently, plus
 * a little for a title that merely looks like what was typed.
 */
const RANK = (vector: string, title: string, updated: string) => `
  ts_rank_cd(${vector}, q.tsq)
    * (1 + 0.5 * exp(-(extract(epoch FROM now() - ${updated}) / 2592000)))
  + greatest(similarity(${title}, $2) - 0.2, 0) * 0.5`;

export async function searchRoutes(app: FastifyInstance) {
  app.get("/search", async (r): Promise<SearchHit[]> => {
    const u = await authenticate(r);
    const q = searchQuery.parse(r.query ?? {});
    const db = reader(r.headers);
    const docParams = [
      u.id,
      q.q,
      q.kind ?? null,
      q.project ?? null,
      q.tag ?? null,
      q.team ?? null,
      q.updated_after ?? null,
      q.limit,
    ];
    // Tasks take their own list: a placeholder a query never mentions has
    // no type for Postgres to infer, and it refuses the whole statement.
    const itemParams = [
      u.id,
      q.q,
      q.project ?? null,
      q.team ?? null,
      q.updated_after ?? null,
      q.limit,
    ];

    const wantsDocs = q.type !== "task";
    const wantsItems = q.type !== "doc" && !q.tag;

    const docs = wantsDocs
      ? (
          await db.query<SearchHit>(
            `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
             SELECT d.id, 'doc' AS type, d.title, d.kind, d.team_id,
                    d.project_id, p.name AS project_name, d.updated_at,
                    ts_headline('english', doc_words(d.content, NULL), q.tsq,
                                '${MARKS}') AS snippet,
                    (SELECT b->>'id' FROM jsonb_array_elements(d.content) b
                      WHERE b->>'text' IS NOT NULL AND b->>'id' IS NOT NULL
                        AND to_tsvector('english', b->>'text') @@ q.tsq
                      LIMIT 1) AS block_id,
                    ${RANK("d.search", "d.title", "d.updated_at")} AS rank
               FROM docs d
               LEFT JOIN projects p ON p.id = d.project_id
               CROSS JOIN q
              WHERE ((d.team_id IS NULL AND d.user_id = $1)
                     OR d.team_id IN (SELECT team_id FROM team_members
                                       WHERE user_id = $1))
                AND (d.search @@ q.tsq OR similarity(d.title, $2) > 0.25)
                AND ($3::text IS NULL OR d.kind = $3)
                AND ($4::uuid IS NULL OR d.project_id = $4)
                AND ($5::uuid IS NULL OR EXISTS (
                      SELECT 1 FROM doc_tags dt
                       WHERE dt.doc_id = d.id AND dt.tag_id = $5))
                AND ($6::uuid IS NULL OR d.team_id = $6)
                AND ($7::timestamptz IS NULL OR d.updated_at >= $7)
              ORDER BY rank DESC, d.updated_at DESC
              LIMIT $8`,
            docParams,
          )
        ).rows
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
              WHERE ${VISIBLE_ITEMS}
                AND (i.search @@ q.tsq OR similarity(i.title, $2) > 0.25)
                AND ($3::uuid IS NULL OR i.project_id = $3)
                AND ($4::uuid IS NULL OR i.team_id = $4)
                AND ($5::timestamptz IS NULL OR i.updated_at >= $5)
              ORDER BY rank DESC, i.updated_at DESC
              LIMIT $6`,
            itemParams,
          )
        ).rows
      : [];

    // Both lists are ranked on the same scale, so they interleave honestly.
    const found = [...docs, ...items].sort(
      (a, b) => Number(b.rank) - Number(a.rank),
    );

    /**
     * Meaning is added to the words, never used instead of them: a page the
     * words already found is lifted a little, and a page only meaning found
     * joins the end rather than displacing a plain match. That way turning
     * semantic search on can improve an order but not overturn it, and
     * turning it off changes nothing anyone was relying on.
     */
    if (wantsDocs) {
      const near = await nearest(u.id, q.q, q.limit, q.project);
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
                  AND ((d.team_id IS NULL AND d.user_id = $4)
                    OR d.team_id IN (SELECT team_id FROM team_members
                                      WHERE user_id = $4))`,
              [hit.id, q.kind ?? null, q.project ?? null, u.id],
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

    return found.slice(0, q.limit);
  });
}

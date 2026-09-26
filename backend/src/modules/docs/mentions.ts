import type { FastifyInstance } from "fastify";
import { plainText, type DocBlock, type PageMention } from "@orbyn/core";
import { z } from "zod";
import { reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";

/**
 * "Mentioned in": the pages that name you, newest first, with the line
 * around each mention. A page you can no longer open (you left its team, it
 * went to Trash) drops out, so its title never shows.
 */
export async function mentionRoutes(app: FastifyInstance) {
  app.get("/me/mentions", async (r): Promise<PageMention[]> => {
    const u = await authenticate(r);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(r.query);
    const rows = (
      await reader(r.headers).query<{
        doc_id: string;
        title: string;
        block_id: string;
        content: DocBlock[] | null;
        mentioned_by: string | null;
        project_id: string | null;
        created_at: Date;
      }>(
        `SELECT m.doc_id, d.title, m.block_id, d.content, b.name AS mentioned_by,
                d.project_id, m.created_at
           FROM doc_mentions m JOIN docs d ON d.id = m.doc_id
           LEFT JOIN users b ON b.id = m.mentioned_by
          WHERE m.user_id = $1 AND ${docVisibleTo("$1")}
          ORDER BY m.created_at DESC, m.doc_id LIMIT $2`,
        [u.id, limit],
      )
    ).rows;
    return rows.map((row) => {
      const block = (row.content ?? []).find(
        (b) => (b.id ?? "") === row.block_id,
      );
      const text = block && "text" in block ? String(block.text ?? "") : "";
      return {
        doc_id: row.doc_id,
        title: row.title,
        block_id: row.block_id,
        quote: plainText(text).slice(0, 240),
        mentioned_by: row.mentioned_by,
        project_id: row.project_id,
        created_at: row.created_at.toISOString(),
      };
    });
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { archiveInput, fail, type Doc } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, writeRateLimit } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { audit } from "../../lib/audit.js";
import { announceDocChange } from "./live.js";
import { TAG_IN_SPACE, checkLinks, readDoc, requireDoc } from "./service.js";
import { actAs } from "../../lib/actor.js";

/**
 * Tidying the library (SRCH-03, ORG-03).
 *
 * - Archive a page or a folder, and bring it back. Archived pages leave the
 *   library, the quick switcher, search, the link picker and "Mentioned
 *   without a link", but stay whole: links to them still open, and "Include
 *   archived" finds them. Archiving changes neither a page's words nor its
 *   version, so nobody's open copy is interrupted.
 * - Several pages at once: move them into a folder (or out of one), archive
 *   them, or tag them. Each page is checked as if it were moved alone, and
 *   one that can't be is named rather than stopping the rest.
 */

export const bulkInput = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100),
    /** A folder to move them into; null takes them out of their folder. */
    folder_id: z.uuid().nullable().optional(),
    archived: z.boolean().optional(),
    /** A tag to add to each (its own tags stay). */
    tag_id: z.uuid().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.folder_id !== undefined ||
      b.archived !== undefined ||
      b.tag_id !== undefined,
    { message: "Say what to do with them." },
  );

export type BulkResult = {
  done: string[];
  skipped: { id: string; reason: string }[];
};

export async function libraryRoutes(app: FastifyInstance) {
  app.put("/docs/:id/archive", writeRateLimit, async (r): Promise<Doc> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { archived } = archiveInput.parse(r.body ?? {});
    const doc = await transaction(async (db) => {
      await requireDoc(db, id, u, "items:write");
      await db.query(
        `UPDATE docs SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now())
                                             ELSE NULL END
          WHERE id = $1`,
        [id, archived],
      );
      return readDoc(db, id, u.id);
    });
    await announceDocChange(pool, id, doc.version, "library").catch(() => {});
    return doc;
  });

  app.put("/folders/:id/archive", writeRateLimit, async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { archived } = archiveInput.parse(r.body ?? {});
    return transaction(async (db) => {
      const row = (
        await db.query<{ user_id: string; team_id: string | null }>(
          "SELECT user_id, team_id FROM folders WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) fail(404, "Folder not found");
      if (row.team_id) await requireTeam(row.team_id, u, "items:write", db);
      else if (row.user_id !== u.id) fail(404, "Folder not found");
      const saved = (
        await db.query<{ id: string; archived_at: Date | null }>(
          `UPDATE folders SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now())
                                                  ELSE NULL END
            WHERE id = $1 RETURNING id, archived_at`,
          [id, archived],
        )
      ).rows[0];
      return {
        id: saved.id,
        archived_at: saved.archived_at?.toISOString() ?? null,
      };
    });
  });

  /** Move, archive or tag several pages at once (ORG-03). */
  app.post("/docs/bulk", writeRateLimit, async (r): Promise<BulkResult> => {
    const u = await authenticate(r);
    const b = bulkInput.parse(r.body ?? {});
    const done: string[] = [];
    const skipped: BulkResult["skipped"] = [];
    const changed: { id: string; version: number }[] = [];
    for (const id of [...new Set(b.ids)]) {
      try {
        const version = await transaction(async (db) => {
          await actAs(db, u.id);
          const doc = await requireDoc(db, id, u, "items:write");
          if (b.folder_id)
            await checkLinks(db, u, doc.team_id, { folder_id: b.folder_id });
          if (b.tag_id) {
            // The same rule as PUT /docs/:id/tags: personal tags on
            // personal pages, a team's tags on that team's pages.
            const tag = (
              await db.query(
                `SELECT 1 FROM tags g WHERE g.id = $1 AND ${TAG_IN_SPACE}`,
                [b.tag_id, u.id, doc.team_id],
              )
            ).rowCount;
            if (!tag) fail(404, "That tag isn't in this page's space.");
            await db.query(
              "INSERT INTO doc_tags (doc_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
              [id, b.tag_id],
            );
          }
          if (b.archived !== undefined)
            await db.query(
              `UPDATE docs SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now())
                                                   ELSE NULL END
                WHERE id = $1`,
              [id, b.archived],
            );
          if (b.folder_id === undefined) return null;
          // Filing a page is an edit like moving it alone: a new version.
          return (
            (
              await db.query<{ version: number }>(
                `UPDATE docs SET folder_id = $2, in_uploads = false,
                      version = version + 1, updated_at = now()
                WHERE id = $1 AND folder_id IS DISTINCT FROM $2
                RETURNING version`,
                [id, b.folder_id],
              )
            ).rows[0]?.version ?? null
          );
        });
        done.push(id);
        if (version !== null) changed.push({ id, version });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 403 || status === 404 || status === 409)
          skipped.push({
            id,
            reason:
              status === 403
                ? "You can't change it."
                : (error as Error).message || "Not found",
          });
        else throw error;
      }
    }
    for (const c of changed)
      await announceDocChange(pool, c.id, c.version, "library").catch(() => {});
    if (done.length > 1)
      await audit({
        actorId: u.id,
        action: "docs.bulk",
        targetType: "page",
        targetId: done[0],
        details: {
          count: done.length,
          folder: b.folder_id !== undefined,
          archived: b.archived ?? null,
          tag: !!b.tag_id,
        },
      });
    return { done, skipped };
  });
}

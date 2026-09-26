import type { FastifyInstance } from "fastify";
import {
  fail,
  FILE_LINK_MINUTES,
  isPageImage,
  pageFileInput,
  pageFileType,
  PAGE_FILE_TYPES,
  type PageFile,
  type PageFileLink,
  type PageFilesUsage,
  type PageFileUpload,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { claimToken, importsEnabled } from "../imports/tokens.js";

/**
 * Pictures and files in pages (EDT-01), on the API's side: a one-time link
 * to upload one, a short-lived link to show or download one, and how much
 * space is left. The bytes themselves go to and come from the file store
 * (see store-routes.ts); the API never holds them.
 *
 * A file can be read by whoever can read a live page that shows it (the
 * page it was added to, or one it was moved, merged or pasted into), and
 * deleted by whoever can change such a page. An id from a page you can't
 * open is "not found". A file no page shows any more goes 30 days later
 * (page_file_refs, migration 114; see sweep.ts).
 */

export const PAGE_FILE_COLUMNS = `f.id, f.doc_id, f.name, f.mime, f.kind,
  f.bytes::float8 AS bytes, f.width, f.height, f.status, f.source, f.created_at`;

/** The largest file, and each person's space, in bytes. */
export const pageFileLimits = () => ({
  maxBytes: env.PAGE_FILES_MAX_MB * 1024 * 1024,
  quotaBytes: env.PAGE_FILES_QUOTA_MB * 1024 * 1024,
});

/** How long an upload link lasts. */
const UPLOAD_MINUTES = 10;

/** How much space someone's pictures and files take (uploads on the way count). */
export async function usedBytes(db: Queryable, userId: string) {
  return Number(
    (
      await db.query<{ n: string | null }>(
        `SELECT sum(bytes) AS n FROM page_files
          WHERE user_id = $1 AND status <> 'failed'`,
        [userId],
      )
    ).rows[0].n ?? 0,
  );
}

/** A page `u` may change, for adding a picture or file to it. */
async function writablePage(db: Queryable, u: UserRow, docId: string) {
  const doc = (
    await db.query<{ id: string; team_id: string | null; user_id: string }>(
      `SELECT d.id, d.team_id, d.user_id FROM docs d
        WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
      [u.id, docId],
    )
  ).rows[0];
  if (!doc) fail(404, "Document not found");
  if (doc.team_id) await requireTeam(doc.team_id, u, "items:write");
  return doc;
}

/**
 * A file `userId` can read, or 404: one on a live page they can read, or
 * shown on one (a picture moved, merged or pasted into another page keeps
 * working there, even once the page it was added to is in Trash or gone).
 * Pages point at a file by its random id, which only people who could
 * already read the file have seen.
 */
async function readableFile(
  db: Queryable,
  userId: string,
  fileId: string,
): Promise<PageFile & { team_id: string | null }> {
  const row = (
    await db.query<PageFile & { team_id: string | null }>(
      `SELECT ${PAGE_FILE_COLUMNS}, d.team_id FROM page_files f
         LEFT JOIN docs d ON d.id = f.doc_id
        WHERE f.id = $2
          AND ((d.id IS NOT NULL AND ${docVisibleTo("$1")})
            OR EXISTS (SELECT 1 FROM page_file_refs r
                         JOIN docs s ON s.id = r.doc_id
                        WHERE r.file_id = f.id AND ${docVisibleTo("$1", "s")}))`,
      [userId, fileId],
    )
  ).rows[0];
  if (!row) fail(404, "File not found");
  return row;
}

/**
 * A page `u` may change that holds the file, for removing it: the page it
 * was added to, or one that shows it.
 */
async function writableHolder(db: Queryable, u: UserRow, file: PageFile) {
  const holders = (
    await db.query<{ id: string }>(
      `SELECT d.id FROM docs d
        WHERE ${docVisibleTo("$1")}
          AND (d.id = $2::uuid OR d.id IN (
                SELECT doc_id FROM page_file_refs WHERE file_id = $3))
        ORDER BY (d.id = $2::uuid) DESC`,
      [u.id, file.doc_id, file.id],
    )
  ).rows;
  let refused: unknown = null;
  for (const h of holders) {
    try {
      return await writablePage(db, u, h.id);
    } catch (e) {
      refused = e;
    }
  }
  if (refused) throw refused;
  fail(404, "File not found");
}

const asFile = (row: PageFile & { team_id?: string | null }): PageFile => {
  const { team_id: _team, ...file } = row;
  return {
    ...file,
    bytes: Number(file.bytes),
    created_at: new Date(file.created_at).toISOString(),
  };
};

/** A link to read one stored file for the next hour. */
export function readLink(file: PageFile): PageFileLink {
  const expires = Math.floor(Date.now() / 1000) + FILE_LINK_MINUTES * 60;
  const token = claimToken("page-read", { f: file.id, e: expires });
  return {
    file,
    url_path: `/files/r/${token}`,
    expires_at: new Date(expires * 1000).toISOString(),
  };
}

export async function pageFileRoutes(app: FastifyInstance) {
  /**
   * Add a picture or file to a page: the file's row, and a link to upload
   * its bytes to, good for ten minutes and one upload.
   */
  app.post(
    "/docs/:id/files",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (r, reply): Promise<PageFileUpload> => {
      const u = await authenticate(r);
      if (!importsEnabled())
        fail(
          503,
          "Pictures and files in pages aren't set up on this server yet.",
        );
      const docId = idParam(r);
      const d = pageFileInput.parse(r.body ?? {});
      const mime = pageFileType(d.name, d.mime);
      if (!mime)
        fail(
          415,
          `Pages can hold pictures (PNG, JPEG, GIF, WebP) and ${Object.values(
            PAGE_FILE_TYPES,
          )
            .filter((t) => !t.includes("picture"))
            .join(", ")} files.`,
        );
      await writablePage(pool, u, docId);
      const { maxBytes, quotaBytes } = pageFileLimits();
      if (d.bytes > maxBytes)
        fail(
          413,
          `This file is over the ${env.PAGE_FILES_MAX_MB} MB limit for a page.`,
        );
      // One person's uploads are counted one at a time, so several at once
      // can't together go over their space.
      const row = await transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `page-files:${u.id}`,
        ]);
        const used = await usedBytes(db, u.id);
        if (used + d.bytes > quotaBytes)
          fail(
            413,
            `Your space for pictures and files is full (${env.PAGE_FILES_QUOTA_MB} MB). Delete ones you no longer need from a page's Info, under Pictures and files.`,
          );
        return (
          await db.query<PageFile>(
            `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes,
             width, height)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${PAGE_FILE_COLUMNS.replace(/f\./g, "")}`,
            [
              u.id,
              docId,
              d.name,
              mime!,
              isPageImage(mime!) ? "image" : "file",
              d.bytes,
              d.width ?? null,
              d.height ?? null,
            ],
          )
        ).rows[0];
      });
      const expires = Math.floor(Date.now() / 1000) + UPLOAD_MINUTES * 60;
      const token = claimToken("page-upload", {
        f: row.id,
        u: u.id,
        e: expires,
        // A little over what was promised, never more than the limit.
        m: Math.min(maxBytes, d.bytes + 64 * 1024),
        t: mime!,
      });
      reply.code(201);
      return {
        file: asFile(row),
        upload_path: `/files/p/${token}`,
        expires_at: new Date(expires * 1000).toISOString(),
      };
    },
  );

  /** A picture or file, with a link to show or download it for an hour. */
  app.get("/docs/files/:id", async (r): Promise<PageFileLink> => {
    const u = await authenticate(r);
    const file = asFile(
      await readableFile(reader(r.headers), u.id, idParam(r)),
    );
    if (file.status !== "ready")
      fail(409, "This file is still uploading. Try again in a moment.");
    return readLink(file);
  });

  /** The pictures and files on a page. */
  app.get("/docs/:id/files", async (r): Promise<PageFile[]> => {
    const u = await authenticate(r);
    const docId = idParam(r);
    const db = reader(r.headers);
    const seen = (
      await db.query(
        `SELECT 1 FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
        [u.id, docId],
      )
    ).rowCount;
    if (!seen) fail(404, "Document not found");
    // Added to this page, or shown on it (moved, merged or pasted here).
    return (
      await db.query<PageFile>(
        `SELECT ${PAGE_FILE_COLUMNS} FROM page_files f
          WHERE (f.doc_id = $1
                 OR f.id IN (SELECT file_id FROM page_file_refs
                              WHERE doc_id = $1))
            AND f.status = 'ready'
          ORDER BY f.created_at`,
        [docId],
      )
    ).rows.map(asFile);
  });

  /**
   * Delete a picture or file for good, freeing its space at once (a line
   * still showing it then says it's gone). Whoever can change a page that
   * holds it may.
   */
  app.delete("/docs/files/:id", async (r, reply) => {
    const u = await authenticate(r);
    const file = await readableFile(pool, u.id, idParam(r));
    await writableHolder(pool, u, file);
    await pool.query("DELETE FROM page_files WHERE id = $1", [file.id]);
    return reply.code(204).send();
  });

  /** How much of your space pictures and files in pages take. */
  app.get("/files/usage", async (r): Promise<PageFilesUsage> => {
    const u = await authenticate(r);
    return {
      used_bytes: await usedBytes(reader(r.headers), u.id),
      quota_bytes: pageFileLimits().quotaBytes,
    };
  });
}

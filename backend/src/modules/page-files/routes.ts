import type { FastifyInstance } from "fastify";
import {
  fail,
  isPageImage,
  pageFileInput,
  pageFileType,
  PAGE_FILE_TYPES,
  type CoverPicture,
  type PageFile,
  type PageFileLink,
  type PageFilesUsage,
  type PageFileUpload,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { pageFileReadableBy } from "../../lib/page-file-access.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { claimToken, importsEnabled } from "../imports/tokens.js";
import {
  PAGE_FILE_COLUMNS,
  pageFileLimits,
  readLink,
  usedBytes,
} from "./service.js";

/**
 * Pictures and files in pages (EDT-01), on the API's side: a one-time link
 * to upload one, a short-lived link to show or download one, and how much
 * space is left. The bytes themselves go to and come from the file store
 * (see store-routes.ts); the API never holds them.
 *
 * A file can be read by whoever can read a live page that shows it (the
 * page it was added to, or one it was moved, merged or pasted into by
 * someone who could read it; see lib/page-file-access.ts), and deleted by
 * its uploader or whoever can change the page it was added to. An id from
 * a page you can't open is "not found". A file no page shows any more goes 30 days later
 * (page_file_refs, migrations 114 and 115; see sweep.ts).
 */

/** How long an upload link lasts. */
const UPLOAD_MINUTES = 10;

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
 * A page only shows a file its saver could already read (allowPageFiles).
 */
async function readableFile(
  db: Queryable,
  userId: string,
  fileId: string,
): Promise<PageFile & { team_id: string | null; user_id: string }> {
  const row = (
    await db.query<PageFile & { team_id: string | null; user_id: string }>(
      `SELECT ${PAGE_FILE_COLUMNS}, f.user_id, d.team_id FROM page_files f
         LEFT JOIN docs d ON d.id = f.doc_id
        WHERE f.id = $2 AND ${pageFileReadableBy("$1")}`,
      [userId, fileId],
    )
  ).rows[0];
  if (!row) fail(404, "File not found");
  return row;
}

/**
 * Whether `u` may delete a file for good: whoever uploaded it, or whoever
 * can change the page it was added to. A page it was only moved, merged or
 * pasted into can drop its line, never the file itself (that would take it
 * from every page showing it).
 */
async function mayDelete(
  db: Queryable,
  u: UserRow,
  file: PageFile & { user_id: string },
) {
  if (file.user_id === u.id) return;
  if (file.doc_id) {
    const home = (
      await db.query(
        `SELECT 1 FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
        [u.id, file.doc_id],
      )
    ).rowCount;
    if (home) {
      await writablePage(db, u, file.doc_id);
      return;
    }
  }
  fail(
    403,
    "This file was added on another page. Remove its line here instead; only that page or whoever uploaded it can delete the file.",
  );
}

const asFile = (
  row: PageFile & { team_id?: string | null; user_id?: string },
): PageFile => {
  const { team_id: _team, user_id: _user, ...file } = row;
  return {
    ...file,
    bytes: Number(file.bytes),
    created_at: new Date(file.created_at).toISOString(),
  };
};

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
            `Your space for pictures and files is full (${env.PAGE_FILES_QUOTA_MB} MB). Delete ones you no longer need from a page's Info, under Pictures and files. Pages in Trash keep their files until the Trash is emptied, so emptying it frees space too.`,
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
   * still showing it then says it's gone). Whoever uploaded it, or can
   * change the page it was added to, may (see mayDelete).
   */
  app.delete("/docs/files/:id", async (r, reply) => {
    const u = await authenticate(r);
    const file = await readableFile(pool, u.id, idParam(r));
    await mayDelete(pool, u, file);
    await pool.query("DELETE FROM page_files WHERE id = $1", [file.id]);
    return reply.code(204).send();
  });

  /**
   * Your pictures, newest first, to choose a cover from (W6): ones you
   * added to pages you can still open.
   */
  app.get("/me/pictures", async (r): Promise<CoverPicture[]> => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<CoverPicture & { created_at: Date }>(
        `SELECT f.id, f.name, f.doc_id, d.title AS doc_title, f.width, f.height,
                f.created_at
           FROM page_files f JOIN docs d ON d.id = f.doc_id
          WHERE f.user_id = $1 AND f.kind = 'image' AND f.status = 'ready'
            AND ${docVisibleTo("$1")}
          ORDER BY f.created_at DESC, f.id
          LIMIT 60`,
        [u.id],
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      created_at: new Date(row.created_at).toISOString(),
    }));
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

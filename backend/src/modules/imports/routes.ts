import type { FastifyInstance } from "fastify";
import {
  IMPORT_LIMITS,
  fail,
  importCreateInput,
  importRefusal,
  importTypeOf,
  type ImportJob,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import type { Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { announceTo } from "../presence/live.js";
import { importsEnabled, uploadToken } from "./tokens.js";

/**
 * Importing files into Docs, from the app's side: ask for an upload link,
 * watch the import's progress, cancel it. The upload itself goes straight to
 * the file store, and the converter does the reading; see ./store.ts and
 * ./converter.ts.
 */

type Row = {
  id: string;
  file_name: string;
  file_type: ImportJob["file_type"];
  bytes: string;
  status: ImportJob["status"];
  pages: number | null;
  ocr_pages: number;
  ocr_done: number;
  doc_id: string | null;
  error: string | null;
  notes: string[];
  created_at: string;
  finished_at: string | null;
  queue_ahead: string | null;
};

const JOB = `i.id, i.file_name, i.file_type, i.bytes, i.status, i.pages,
  i.ocr_pages, i.ocr_done, i.doc_id, i.error, i.notes, i.created_at,
  i.finished_at,
  CASE WHEN i.status = 'ocr' THEN (
    SELECT count(*) FROM import_pages w
     WHERE w.needs_ocr AND w.done_at IS NULL AND w.import_id <> i.id
       AND w.page < coalesce((SELECT min(page) FROM import_pages m
                               WHERE m.import_id = i.id AND m.needs_ocr
                                 AND m.done_at IS NULL), 0)
  ) END AS queue_ahead`;

/** Seconds one scanned page takes lately, for the estimate. */
async function secondsPerPage(db: Queryable): Promise<number> {
  const row = (
    await db.query<{ avg: string | null }>(
      `SELECT avg(ocr_ms) AS avg FROM (
         SELECT ocr_ms FROM import_pages WHERE ocr_ms IS NOT NULL
          ORDER BY done_at DESC LIMIT 50) recent`,
    )
  ).rows[0];
  return row?.avg ? Number(row.avg) / 1000 : 120;
}

function jobOf(row: Row, perPage: number): ImportJob {
  const ahead = row.queue_ahead === null ? null : Number(row.queue_ahead);
  const left = row.ocr_pages - row.ocr_done;
  return {
    id: row.id,
    file_name: row.file_name,
    file_type: row.file_type,
    bytes: Number(row.bytes),
    status: row.status,
    pages: row.pages,
    ocr_pages: row.ocr_pages,
    ocr_done: row.ocr_done,
    doc_id: row.doc_id,
    error: row.error,
    notes: row.notes ?? [],
    queue_ahead: ahead,
    estimate_seconds:
      row.status === "ocr"
        ? Math.round((((ahead ?? 0) + left) * perPage) / env.OCR_WORKERS)
        : null,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

async function jobs(db: Queryable, userId: string, id?: string) {
  const rows = (
    await db.query<Row>(
      `SELECT ${JOB} FROM imports i
        WHERE i.user_id = $1 AND ($2::uuid IS NULL OR i.id = $2)
          AND (i.status IN ('waiting','queued','reading','ocr')
               OR i.created_at > now() - interval '7 days')
        ORDER BY i.created_at DESC LIMIT 50`,
      [userId, id ?? null],
    )
  ).rows;
  const perPage = rows.some((r) => r.status === "ocr")
    ? await secondsPerPage(db)
    : 120;
  return rows.map((r) => jobOf(r, perPage));
}

export async function importRoutes(app: FastifyInstance) {
  /**
   * Start an import: returns the import and a link to upload the file to,
   * good for ten minutes and one upload. The file store queues it for the
   * converter as soon as the upload finishes.
   */
  app.post("/imports", async (r, reply) => {
    const u = await authenticate(r);
    if (!importsEnabled())
      fail(503, "Importing files isn't set up on this server yet.");
    const d = importCreateInput.parse(r.body ?? {});
    const type = importTypeOf(d.file_name, d.mime);
    if (!type) fail(422, importRefusal(d.file_name, d.mime)!);
    const active = Number(
      (
        await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM imports
            WHERE user_id = $1 AND created_at > now() - interval '1 day'
              AND (status IN ('queued','reading','ocr')
                   OR (status = 'waiting'
                       AND created_at > now() - interval '15 minutes'))`,
          [u.id],
        )
      ).rows[0].n,
    );
    if (active >= IMPORT_LIMITS.activePerUser)
      fail(
        429,
        `You have ${active} files importing. Wait for one to finish, then add the next.`,
      );
    const id = (
      await pool.query<{ id: string }>(
        `INSERT INTO imports (user_id, file_name, file_type, bytes)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [u.id, d.file_name, type, d.bytes],
      )
    ).rows[0].id;
    const expires =
      Math.floor(Date.now() / 1000) + IMPORT_LIMITS.uploadLinkMinutes * 60;
    const token = uploadToken({
      i: id,
      u: u.id,
      e: expires,
      m: IMPORT_LIMITS.maxBytes,
      t: type!,
    });
    reply.code(201);
    return {
      import: (await jobs(pool, u.id, id))[0],
      upload_path: `/files/u/${token}`,
      expires_at: new Date(expires * 1000).toISOString(),
    };
  });

  /** Your imports: everything still going, and the last week's finished ones. */
  app.get("/imports", async (r) => {
    const u = await authenticate(r);
    return jobs(pool, u.id);
  });

  app.get("/imports/:id", async (r) => {
    const u = await authenticate(r);
    const job = (await jobs(pool, u.id, idParam(r)))[0];
    if (!job) fail(404, "Import not found");
    return job;
  });

  /**
   * Cancel an import still going, or clear a finished one from the list.
   * A cancelled import's file is deleted by the converter or the file
   * store's sweep, whichever gets there first.
   */
  app.delete("/imports/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const cancelled = (
      await pool.query(
        `UPDATE imports SET status = 'cancelled', finished_at = now()
          WHERE id = $1 AND user_id = $2
            AND status IN ('waiting','queued','reading','ocr')
          RETURNING id`,
        [id, u.id],
      )
    ).rowCount;
    if (cancelled)
      await pool.query(
        "DELETE FROM import_pages WHERE import_id = $1 AND done_at IS NULL",
        [id],
      );
    else {
      const removed = (
        await pool.query(
          "DELETE FROM imports WHERE id = $1 AND user_id = $2 AND object_id IS NULL",
          [id, u.id],
        )
      ).rowCount;
      if (!removed) fail(404, "Import not found");
    }
    await announceTo(pool, { user_id: u.id }, "changed").catch(() => {});
    return reply.code(204).send();
  });
}

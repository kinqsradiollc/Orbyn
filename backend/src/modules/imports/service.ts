import {
  IMPORT_LIMITS,
  type ImportCapabilities,
  type ImportJob,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import type { Queryable } from "../../db/pool.js";
import { importsEnabled } from "./tokens.js";
/**
 * The imports service: import jobs as their owner sees them and what this
 * server can read. The routes and the admin console's storage page use it.
 */
/**
 * Importing files into Docs, from the app's side: ask for an upload link,
 * watch the import's progress, cancel it. The upload itself goes straight to
 * the file store, and the converter does the reading; see ./store.ts and
 * ./converter.ts.
 */

export type Row = {
  id: string;
  file_name: string;
  file_type: ImportJob["file_type"];
  bytes: string;
  status: ImportJob["status"];
  pages: number | null;
  ocr_pages: number;
  ocr_done: number;
  doc_id: string | null;
  doc_in_trash: boolean;
  error: string | null;
  notes: string[];
  created_at: string;
  finished_at: string | null;
  queue_ahead: string | null;
};

// A page in Trash is nothing to open: its id is left out, and the job says
// where it went.
export const JOB = `i.id, i.file_name, i.file_type, i.bytes, i.status, i.pages,
  i.ocr_pages, i.ocr_done,
  CASE WHEN t.deleted_at IS NULL THEN i.doc_id END AS doc_id,
  t.deleted_at IS NOT NULL AS doc_in_trash, i.error, i.notes, i.created_at,
  i.finished_at,
  CASE WHEN i.status = 'ocr' THEN (
    SELECT count(*) FROM import_pages w
     WHERE w.needs_ocr AND w.done_at IS NULL AND w.import_id <> i.id
       AND w.page < coalesce((SELECT min(page) FROM import_pages m
                               WHERE m.import_id = i.id AND m.needs_ocr
                                 AND m.done_at IS NULL), 0)
  ) END AS queue_ahead`;

/** Seconds one scanned page takes lately, for the estimate. */
export async function secondsPerPage(db: Queryable): Promise<number> {
  const row = (
    await db.query<{ avg: string | null }>(
      `SELECT avg(ocr_ms) AS avg FROM (
         SELECT ocr_ms FROM import_pages WHERE ocr_ms IS NOT NULL
          ORDER BY done_at DESC LIMIT 50) recent`,
    )
  ).rows[0];
  return row?.avg ? Number(row.avg) / 1000 : 120;
}

export function jobOf(row: Row, perPage: number): ImportJob {
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
    doc_in_trash: row.doc_in_trash,
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

export async function jobs(db: Queryable, userId: string, id?: string) {
  const rows = (
    await db.query<Row>(
      `SELECT ${JOB} FROM imports i LEFT JOIN docs t ON t.id = i.doc_id
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

/** What this server can read, from the converter's latest report. */
export async function importCapabilities(): Promise<ImportCapabilities> {
  const state = (
    await pool.query<{ scans: string; formulas: boolean; fresh: boolean }>(
      `SELECT scans, formulas, updated_at > now() - interval '2 minutes' AS fresh
         FROM converter_state WHERE id = 1`,
    )
  ).rows[0];
  const scans = !state
    ? "unknown"
    : !state.fresh
      ? "unknown"
      : (state.scans as ImportCapabilities["scans"]);
  const heavy = scans === "full";
  return {
    enabled: importsEnabled(),
    scans,
    formulas: scans === "full" || (scans === "tesseract" && !!state?.formulas),
    photos: scans === "full" || scans === "tesseract",
    limits: {
      maxBytes: IMPORT_LIMITS.maxBytes,
      maxPages: IMPORT_LIMITS.maxPages,
      scanPagesPerFile: heavy
        ? IMPORT_LIMITS.maxOcrPagesPerFile
        : IMPORT_LIMITS.maxPages,
      scanPagesPerDay: heavy
        ? IMPORT_LIMITS.ocrPagesPerDay
        : IMPORT_LIMITS.scanPagesPerDay,
    },
  };
}

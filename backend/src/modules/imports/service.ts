import type { z } from "zod";
import {
  IMPORT_LIMITS,
  fail,
  importCreateInput,
  importRefusal,
  importTypeOf,
  type ImportCapabilities,
  type ImportJob,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import type { Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { announceTo } from "../presence/live.js";
import { importsEnabled, uploadToken } from "./tokens.js";
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
export async function importCapabilities(
  db: Queryable = pool,
): Promise<ImportCapabilities> {
  const state = (
    await db.query<{ scans: string; formulas: boolean; fresh: boolean }>(
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

/**
 * Start an import: the import, and a path to upload the file to, good for
 * ten minutes and one upload (the file store queues it for the converter
 * when the upload finishes). A project's team must be the one the caller
 * saw, so a file never lands in a space they didn't choose.
 */
export async function startImport(
  db: Queryable,
  u: UserRow,
  input: z.input<typeof importCreateInput>,
) {
  const d = importCreateInput.parse(input);
  if (!importsEnabled())
    fail(503, "Importing files isn't set up on this server yet.");
  const type = importTypeOf(d.file_name, d.mime);
  if (!type) fail(422, importRefusal(d.file_name, d.mime)!);
  let projectTeamId: string | null = null;
  if (d.project_id) {
    if (d.project_team_id === undefined)
      fail(400, "The project's current team is required for an import.");
    const project = (
      await db.query<{ user_id: string; team_id: string | null }>(
        "SELECT user_id, team_id FROM projects WHERE id = $1",
        [d.project_id],
      )
    ).rows[0];
    if (!project || (!project.team_id && project.user_id !== u.id))
      fail(404, "Project not found");
    if (project.team_id) await requireTeam(project.team_id, u, "items:write");
    if (project.team_id !== d.project_team_id)
      fail(
        409,
        "This project changed teams. Review who can read the file and try again.",
      );
    projectTeamId = project.team_id;
  }
  const active = Number(
    (
      await db.query<{ n: string }>(
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
    await db.query<{ id: string }>(
      `INSERT INTO imports (user_id, file_name, file_type, bytes,
       project_id, project_team_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [u.id, d.file_name, type, d.bytes, d.project_id ?? null, projectTeamId],
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
  return {
    import: (await jobs(db, u.id, id))[0],
    upload_path: `/files/u/${token}`,
    expires_at: new Date(expires * 1000).toISOString(),
  };
}

/**
 * Cancel an import still going, or clear a finished one that kept no file
 * from the list. A cancelled import's file is deleted by the converter or
 * the file store's sweep.
 */
export async function cancelImport(db: Queryable, userId: string, id: string) {
  const cancelled = (
    await db.query(
      `UPDATE imports SET status = 'cancelled', finished_at = now()
      WHERE id = $1 AND user_id = $2
        AND status IN ('waiting','queued','reading','ocr')
      RETURNING id`,
      [id, userId],
    )
  ).rowCount;
  if (cancelled)
    await db.query(
      "DELETE FROM import_pages WHERE import_id = $1 AND done_at IS NULL",
      [id],
    );
  else {
    const removed = (
      await db.query(
        "DELETE FROM imports WHERE id = $1 AND user_id = $2 AND object_id IS NULL",
        [id, userId],
      )
    ).rowCount;
    if (!removed) fail(404, "Import not found");
  }
  await announceTo(db, { user_id: userId }, "changed").catch(() => {});
}

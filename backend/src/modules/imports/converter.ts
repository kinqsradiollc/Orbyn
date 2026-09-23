import {
  IMPORT_LIMITS,
  assembleImport,
  ocrPageToMarkdown,
  type ImportFileType,
  type ImportedPage,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, transaction } from "../../db/pool.js";
import { announceTo } from "../presence/live.js";
import { NotAWordFile, docxToMarkdown } from "./docx.js";
import { PdfLocked, PdfUnreadable, readPdf, singlePage } from "./pdf.js";
import { serviceKey } from "./tokens.js";

/**
 * The converter: turns uploaded files into Orbyn pages.
 *
 * One lane reads files as they arrive. A Word file, or a PDF whose pages
 * all have real text, is done in seconds. Pages that need OCR (scans,
 * photos, pages of maths) are queued one row per page, and each OCR lane —
 * one per OCR worker — reads one page at a time, taking pages in page
 * order across every file, so a long scan never makes everyone else wait
 * for all of it. When the last page is in, the page is assembled, lands in
 * Uploads, and the file is deleted from the file store.
 *
 * Every step is claimed with SKIP LOCKED, so several converters can run
 * side by side, and work a crashed converter held is taken up again.
 */

type ImportRow = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: ImportFileType;
  object_id: string | null;
  attempts: number;
};

class ImportFailure extends Error {}

const log = (message: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ service: "converter", message, ...extra }));

const changed = (userId: string) =>
  announceTo(pool, { user_id: userId }, "changed").catch(() => {});

// ------------------------------------------------------------ the store ---

async function fetchFile(objectId: string): Promise<Buffer> {
  const res = await fetch(`${env.FILES_URL}/internal/files/${objectId}`, {
    headers: { "x-orbyn-service": serviceKey() },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok)
    throw new ImportFailure(
      "The uploaded file couldn't be found. Please upload it again.",
    );
  return Buffer.from(await res.arrayBuffer());
}

/** Delete an import's file from the store; the sweep catches any miss. */
async function deleteFile(importId: string, objectId: string | null) {
  if (!objectId) return;
  try {
    await fetch(`${env.FILES_URL}/internal/files/${objectId}`, {
      method: "DELETE",
      headers: { "x-orbyn-service": serviceKey() },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The file store's sweep deletes it within the day regardless.
  }
  await pool.query("UPDATE imports SET object_id = NULL WHERE id = $1", [
    importId,
  ]);
}

/** The last file read, so OCR of several pages doesn't fetch it each time. */
let cached: { id: string; data: Buffer } | null = null;
async function fileFor(row: { id: string; object_id: string | null }) {
  if (cached?.id === row.id) return cached.data;
  if (!row.object_id)
    throw new ImportFailure(
      "The uploaded file is gone. Please upload it again.",
    );
  const data = await fetchFile(row.object_id);
  cached = { id: row.id, data };
  return data;
}

// -------------------------------------------------------------- failing ---

async function failImport(row: ImportRow, message: string) {
  const updated = (
    await pool.query(
      `UPDATE imports SET status = 'failed', error = $2, finished_at = now()
        WHERE id = $1 AND status IN ('queued','reading','ocr') RETURNING id`,
      [row.id, message],
    )
  ).rowCount;
  await pool.query(
    "DELETE FROM import_pages WHERE import_id = $1 AND done_at IS NULL",
    [row.id],
  );
  await deleteFile(row.id, row.object_id);
  if (updated) await changed(row.user_id);
}

// ------------------------------------------------------------ reading ---

/** Take the next uploaded file and read what can be read without OCR. */
async function readNext(): Promise<boolean> {
  const row = (
    await pool.query<ImportRow>(
      `UPDATE imports SET status = 'reading', claimed_at = now(),
              attempts = attempts + 1
        WHERE id = (SELECT id FROM imports WHERE status = 'queued'
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, user_id, file_name, file_type, object_id, attempts`,
    )
  ).rows[0];
  if (!row) return false;
  await changed(row.user_id);
  try {
    await readImport(row);
  } catch (error) {
    if (error instanceof ImportFailure) await failImport(row, error.message);
    else {
      log("read failed", { import: row.id, error: (error as Error).message });
      if (row.attempts >= 3)
        await failImport(
          row,
          "This file couldn't be read. Please try again, or save it as PDF.",
        );
      else
        await pool.query(
          "UPDATE imports SET status = 'queued', claimed_at = NULL WHERE id = $1 AND status = 'reading'",
          [row.id],
        );
    }
  }
  return true;
}

async function readImport(row: ImportRow) {
  const data = await fileFor(row);
  const pages: {
    page: number;
    markdown: string;
    needsOcr: boolean;
    tables?: number;
    figures?: number;
  }[] = [];
  const notes: string[] = [];

  if (row.file_type === "docx") {
    try {
      const doc = docxToMarkdown(data);
      pages.push({ page: 1, needsOcr: false, ...doc });
    } catch (error) {
      if (error instanceof NotAWordFile)
        throw new ImportFailure(
          "This isn't a Word document Orbyn can read. Save it as .docx or PDF and try again.",
        );
      throw error;
    }
  } else if (row.file_type === "pdf") {
    let read;
    try {
      read = await readPdf(data, IMPORT_LIMITS.maxPages);
    } catch (error) {
      if (error instanceof PdfLocked)
        throw new ImportFailure(
          "This PDF has a password. Remove the password and upload it again.",
        );
      if (error instanceof PdfUnreadable)
        throw new ImportFailure(
          /too many pages/.test(error.message)
            ? `This PDF has more than ${IMPORT_LIMITS.maxPages} pages. Split it into parts and upload each one.`
            : "This PDF couldn't be read. It may be damaged; try saving it again.",
        );
      throw error;
    }
    pages.push(...read);
  } else {
    // A photo or screenshot of notes: one page, read by OCR.
    pages.push({ page: 1, markdown: "", needsOcr: true });
  }

  let ocr = pages.filter((p) => p.needsOcr);
  if (ocr.length && !env.OCR_URL) {
    if (ocr.length === pages.length || row.file_type !== "pdf")
      throw new ImportFailure(
        row.file_type === "pdf"
          ? "This PDF is scanned, and reading scanned pages isn't turned on on this server yet. Word files and PDFs with real text import fine."
          : "Reading photos of notes isn't turned on on this server yet. Word files and PDFs with real text import fine.",
      );
    // Keep what the text layer had for those pages, and say so.
    notes.push(
      `${ocr.length} scanned page${ocr.length === 1 ? "" : "s"} imported roughly (OCR is off)`,
    );
    for (const p of ocr) p.needsOcr = false;
    ocr = [];
  }
  if (ocr.length > IMPORT_LIMITS.maxOcrPagesPerFile)
    throw new ImportFailure(
      `This file has ${ocr.length} scanned pages. Orbyn reads up to ${IMPORT_LIMITS.maxOcrPagesPerFile} scanned pages per file; split it into parts and upload each one.`,
    );
  if (ocr.length) {
    const today = Number(
      (
        await pool.query<{ n: string }>(
          `SELECT coalesce(sum(ocr_pages), 0) AS n FROM imports
            WHERE user_id = $1 AND id <> $2 AND status <> 'cancelled'
              AND created_at > now() - interval '1 day'`,
          [row.user_id, row.id],
        )
      ).rows[0].n,
    );
    if (today + ocr.length > IMPORT_LIMITS.ocrPagesPerDay)
      throw new ImportFailure(
        `Orbyn reads up to ${IMPORT_LIMITS.ocrPagesPerDay} scanned pages a day per person, and this file would go over. Try again tomorrow; Word files and PDFs with real text don't count.`,
      );
  }

  await transaction(async (db) => {
    await db.query("DELETE FROM import_pages WHERE import_id = $1", [row.id]);
    for (const p of pages)
      await db.query(
        `INSERT INTO import_pages (import_id, page, needs_ocr, markdown,
           tables, figures, done_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 THEN NULL ELSE now() END)`,
        [
          row.id,
          p.page,
          p.needsOcr,
          p.needsOcr ? null : p.markdown,
          p.tables ?? 0,
          p.figures ?? 0,
        ],
      );
    await db.query(
      `UPDATE imports SET pages = $2, ocr_pages = $3, ocr_done = 0,
              notes = $4::jsonb,
              status = CASE WHEN $3 > 0 THEN 'ocr' ELSE status END
        WHERE id = $1`,
      [row.id, pages.length, ocr.length, JSON.stringify(notes)],
    );
  });
  await changed(row.user_id);
  if (!ocr.length) await finish(row.id);
}

// ---------------------------------------------------------------- OCR ---

/** Read one waiting scanned page with the OCR service. */
async function ocrNext(): Promise<boolean> {
  const claimed = (
    await pool.query<{ import_id: string; page: number; attempts: number }>(
      `UPDATE import_pages SET claimed_at = now(), attempts = attempts + 1
        WHERE (import_id, page) = (
          SELECT p.import_id, p.page FROM import_pages p
            JOIN imports i ON i.id = p.import_id AND i.status = 'ocr'
           WHERE p.needs_ocr AND p.done_at IS NULL AND p.claimed_at IS NULL
           ORDER BY p.page, i.created_at
           FOR UPDATE OF p SKIP LOCKED LIMIT 1)
        RETURNING import_id, page, attempts`,
    )
  ).rows[0];
  if (!claimed) return false;
  const row = (
    await pool.query<ImportRow>(
      "SELECT id, user_id, file_name, file_type, object_id, attempts FROM imports WHERE id = $1",
      [claimed.import_id],
    )
  ).rows[0];
  if (!row) return true;
  const started = Date.now();
  let markdown: string;
  let tables = 0;
  let figures = 0;
  try {
    const data = await fileFor(row);
    const body =
      row.file_type === "pdf" ? await singlePage(data, claimed.page) : data;
    const res = await fetch(`${env.OCR_URL}/ocr`, {
      method: "POST",
      headers: {
        "Content-Type":
          row.file_type === "pdf"
            ? "application/pdf"
            : row.file_type === "png"
              ? "image/png"
              : "image/jpeg",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(env.OCR_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OCR answered ${res.status}`);
    const raw = ((await res.json()) as { markdown?: string }).markdown ?? "";
    ({ markdown, tables, figures } = ocrPageToMarkdown(raw, claimed.page));
  } catch (error) {
    if (error instanceof ImportFailure) {
      await failImport(row, error.message);
      return true;
    }
    log("ocr failed", {
      import: row.id,
      page: claimed.page,
      error: (error as Error).message,
    });
    if (claimed.attempts < 3) {
      // Back in the queue for another try.
      await pool.query(
        "UPDATE import_pages SET claimed_at = NULL WHERE import_id = $1 AND page = $2",
        [row.id, claimed.page],
      );
      await new Promise((r) => setTimeout(r, 5_000));
      return true;
    }
    markdown = `*Page ${claimed.page} couldn't be read.*`;
  }
  await pool.query(
    `UPDATE import_pages SET markdown = $3, tables = $4, figures = $5,
            ocr_ms = $6, done_at = now()
      WHERE import_id = $1 AND page = $2`,
    [row.id, claimed.page, markdown, tables, figures, Date.now() - started],
  );
  const left = Number(
    (
      await pool.query<{ left: string }>(
        `WITH done AS (
           UPDATE imports SET ocr_done = (
             SELECT count(*) FROM import_pages
              WHERE import_id = $1 AND needs_ocr AND done_at IS NOT NULL)
            WHERE id = $1 RETURNING id)
         SELECT count(*) AS left FROM import_pages
          WHERE import_id = $1 AND needs_ocr AND done_at IS NULL`,
        [row.id],
      )
    ).rows[0].left,
  );
  await changed(row.user_id);
  if (!left) await finish(row.id);
  return true;
}

// ------------------------------------------------------------ finishing ---

/** Put the pages together as a page in Uploads, then delete the file. */
async function finish(importId: string) {
  // Only one lane finishes an import, and never a cancelled one.
  const row = (
    await pool.query<ImportRow & { notes: string[] }>(
      `UPDATE imports SET finished_at = now()
        WHERE id = $1 AND status IN ('reading','ocr') AND finished_at IS NULL
        RETURNING id, user_id, file_name, file_type, object_id, attempts, notes`,
      [importId],
    )
  ).rows[0];
  if (!row) return;
  try {
    const pages = (
      await pool.query<{
        page: number;
        markdown: string | null;
        needs_ocr: boolean;
        tables: number;
        figures: number;
      }>(
        `SELECT page, markdown, needs_ocr, tables, figures FROM import_pages
          WHERE import_id = $1 ORDER BY page`,
        [row.id],
      )
    ).rows;
    const imported: ImportedPage[] = pages.map((p) => ({
      markdown: p.markdown ?? "",
      ocr: p.needs_ocr,
      tables: p.tables,
      figures: p.figures,
    }));
    const { title, content, notes } = assembleImport(imported, row.file_name, {
      notes: row.notes ?? [],
    });
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [
        row.user_id,
      ]);
      const docId = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, title, kind, content, imported_from, in_uploads)
           VALUES ($1, $2, 'doc', $3::jsonb, $4::jsonb, true) RETURNING id`,
          [
            row.user_id,
            title,
            JSON.stringify(content),
            JSON.stringify({
              file_name: row.file_name,
              file_type: row.file_type,
              pages: pages.length,
              ocr_pages: pages.filter((p) => p.needs_ocr).length,
              imported_at: new Date().toISOString(),
            }),
          ],
        )
      ).rows[0].id;
      await db.query(
        `UPDATE imports SET status = 'ready', doc_id = $2, notes = $3::jsonb
          WHERE id = $1`,
        [row.id, docId, JSON.stringify(notes)],
      );
      await db.query("DELETE FROM import_pages WHERE import_id = $1", [row.id]);
      await db.query(
        `INSERT INTO notifications (user_id, item_id, item_version, channel,
           destination, title, body, state, kind, ref)
         VALUES ($1, NULL, 0, 'inapp', '', $2, $3, 'sent', 'import', $4)
         ON CONFLICT DO NOTHING`,
        [
          row.user_id,
          `“${title}” is ready in Uploads`,
          `Imported from ${row.file_name}. Move it to a folder when you're ready.`,
          `doc:${docId}`,
        ],
      );
    });
  } catch (error) {
    log("finish failed", { import: row.id, error: (error as Error).message });
    await pool.query(
      `UPDATE imports SET status = 'failed', error = $2 WHERE id = $1`,
      [row.id, "This file couldn't be turned into a page. Please try again."],
    );
  }
  if (cached?.id === row.id) cached = null;
  await deleteFile(row.id, row.object_id);
  await changed(row.user_id);
}

// ------------------------------------------------------------- upkeep ---

/**
 * Take up work a crashed converter held, and delete the files of imports
 * that were cancelled or failed while nobody was looking.
 */
async function recover() {
  const stale = (
    await pool.query<ImportRow>(
      `SELECT id, user_id, file_name, file_type, object_id, attempts FROM imports
        WHERE status = 'reading' AND claimed_at < now() - interval '15 minutes'`,
    )
  ).rows;
  for (const row of stale)
    if (row.attempts >= 3)
      await failImport(
        row,
        "This file couldn't be read. Please try again, or save it as PDF.",
      );
    else
      await pool.query(
        "UPDATE imports SET status = 'queued', claimed_at = NULL WHERE id = $1 AND status = 'reading'",
        [row.id],
      );
  await pool.query(
    `UPDATE import_pages SET claimed_at = NULL
      WHERE done_at IS NULL AND claimed_at IS NOT NULL
        AND claimed_at < now() - make_interval(secs => $1::int)`,
    [Math.round(env.OCR_TIMEOUT_MS / 1000) + 300],
  );
  const ended = (
    await pool.query<{ id: string; object_id: string }>(
      `SELECT id, object_id FROM imports
        WHERE object_id IS NOT NULL AND status IN ('ready','failed','cancelled')`,
    )
  ).rows;
  for (const row of ended) await deleteFile(row.id, row.object_id);
}

async function heartbeat() {
  await pool.query(
    `INSERT INTO service_heartbeats (service, last_seen_at) VALUES ('converter', now())
     ON CONFLICT (service) DO UPDATE SET last_seen_at = now()`,
  );
}

/** Run until SIGINT/SIGTERM: one reading lane and one lane per OCR worker. */
export async function runConverter() {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  const sleep = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      const check = setInterval(() => {
        if (stopping) {
          clearTimeout(t);
          clearInterval(check);
          r();
        }
      }, 250);
      setTimeout(() => clearInterval(check), ms + 10);
    });
  const lane = async (name: string, step: () => Promise<boolean>) => {
    while (!stopping) {
      let busy = false;
      try {
        busy = await step();
      } catch (error) {
        log(`${name} lane error`, { error: (error as Error).message });
      }
      if (!busy) await sleep(2_000);
    }
  };
  const upkeep = async () => {
    while (!stopping) {
      try {
        await heartbeat();
        await recover();
      } catch (error) {
        log("upkeep error", { error: (error as Error).message });
      }
      await sleep(10_000);
    }
  };
  log("started", {
    ocr: env.OCR_URL ? `${env.OCR_WORKERS} worker(s)` : "off",
  });
  await Promise.all([
    upkeep(),
    lane("read", readNext),
    ...(env.OCR_URL
      ? Array.from({ length: env.OCR_WORKERS }, (_, n) =>
          lane(`ocr${n + 1}`, ocrNext),
        )
      : []),
  ]);
}

import {
  IMPORT_LIMITS,
  assembleImport,
  ocrPageToMarkdown,
  pageToMarkdown,
  runningLines,
  type ImportFileType,
  type ImportedPage,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, transaction } from "../../db/pool.js";
import { pageFileLimits, usedBytes } from "../page-files/routes.js";
import { announceTo } from "../presence/live.js";
import { NotAWordFile, docxToMarkdown } from "./docx.js";
import { PdfLocked, PdfUnreadable, readPdf, singlePage } from "./pdf.js";
import { formulaAvailable, readFormulas } from "./formula.js";
import { ocrImage, renderPdfPage, tesseractAvailable } from "./tesseract.js";
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

type Engine = "full" | "tesseract" | "none";

/**
 * How this converter reads pages without their own text: the heavy OCR
 * model when OCR_URL is set, else the built-in Tesseract when it's
 * installed (it is in the backend image), else not at all.
 */
async function engine(): Promise<Engine> {
  if (env.OCR_URL) return "full";
  return (await tesseractAvailable()) ? "tesseract" : "none";
}

/** Limits on pages read from images: tight for the heavy model, loose for Tesseract. */
const scanLimits = (e: Engine) =>
  e === "full"
    ? {
        perFile: IMPORT_LIMITS.maxOcrPagesPerFile,
        perDay: IMPORT_LIMITS.ocrPagesPerDay,
      }
    : {
        perFile: IMPORT_LIMITS.maxPages,
        perDay: IMPORT_LIMITS.scanPagesPerDay,
      };

type ReadPage = {
  page: number;
  markdown: string;
  needsOcr: boolean;
  engine: string;
  tables?: number;
  figures?: number;
  equations?: number;
  checks?: number;
};

async function readImport(row: ImportRow) {
  const data = await fileFor(row);
  const pages: ReadPage[] = [];
  const notes: string[] = [];
  const how = await engine();

  if (row.file_type === "docx") {
    try {
      const doc = docxToMarkdown(data);
      pages.push({ page: 1, needsOcr: false, engine: "docx", ...doc });
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
    // Running headers and footers are found across the pages with text.
    const running = runningLines(
      read.filter((p) => !p.needsOcr).map((p) => p.text),
    );
    for (const p of read) {
      const scanned = p.needsOcr && how !== "none";
      const result = pageToMarkdown(p.text, p.page, running);
      pages.push({
        page: p.page,
        needsOcr: scanned,
        engine: scanned ? how : "text",
        markdown: result.markdown.replace(/%%formula \d+%%/g, ""),
        tables: result.tables,
        figures: result.figures,
        equations: result.equations,
        checks: result.checks,
      });
    }
    const rough = read.filter((p) => p.needsOcr).length;
    if (how === "none" && rough) {
      if (rough === read.length)
        throw new ImportFailure(
          "This PDF is scanned, and reading scanned pages isn't set up on this server. Word files and PDFs with real text import fine.",
        );
      notes.push(
        `${rough} scanned page${rough === 1 ? "" : "s"} imported roughly (no OCR on this server)`,
      );
    }
  } else {
    // A photo or screenshot of notes: one page, read by OCR.
    if (how === "none")
      throw new ImportFailure(
        "Reading photos of notes isn't set up on this server. Word files and PDFs with real text import fine.",
      );
    pages.push({ page: 1, markdown: "", needsOcr: true, engine: how });
  }

  const ocr = pages.filter((p) => p.needsOcr);
  const limits = scanLimits(how);
  if (ocr.length > limits.perFile)
    throw new ImportFailure(
      `This file has ${ocr.length} scanned pages. Orbyn reads up to ${limits.perFile} scanned pages per file; split it into parts and upload each one.`,
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
    if (today + ocr.length > limits.perDay)
      throw new ImportFailure(
        `Orbyn reads up to ${limits.perDay} scanned pages a day per person, and this file would go over. Try again tomorrow; Word files and PDFs with real text don't count.`,
      );
  }

  await transaction(async (db) => {
    await db.query("DELETE FROM import_pages WHERE import_id = $1", [row.id]);
    for (const p of pages)
      await db.query(
        `INSERT INTO import_pages (import_id, page, needs_ocr, markdown,
           tables, figures, equations, checks, engine, done_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 CASE WHEN $3 THEN NULL ELSE now() END)`,
        [
          row.id,
          p.page,
          p.needsOcr,
          p.needsOcr ? null : p.markdown,
          p.tables ?? 0,
          p.figures ?? 0,
          p.equations ?? 0,
          p.checks ?? 0,
          p.engine,
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

type PageRead = {
  markdown: string;
  tables: number;
  figures: number;
  equations: number;
  checks: number;
};

/** One page with the heavy OCR model (OCR_URL). */
async function readWithModel(
  row: ImportRow,
  data: Buffer,
  page: number,
): Promise<PageRead> {
  const body = row.file_type === "pdf" ? await singlePage(data, page) : data;
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
  const read = ocrPageToMarkdown(raw, page);
  return {
    ...read,
    equations: (read.markdown.match(/\$\$|\$[^$\n]+\$/g) ?? []).length,
    checks: 0,
  };
}

/**
 * One page with Tesseract: the page as an image (a PDF page drawn at 300
 * dpi, or the photo itself), its words read with their boxes, then the
 * same page reading as a PDF's own text. Lines it couldn't read that look
 * like maths go to the formula model when there is one.
 */
async function readWithTesseract(
  row: ImportRow,
  data: Buffer,
  page: number,
): Promise<PageRead> {
  const image =
    row.file_type === "pdf" ? await renderPdfPage(data, page) : data;
  const text = await ocrImage(image);
  const result = pageToMarkdown(text, page);
  let markdown = result.markdown;
  let equations = result.equations;
  let checks = result.checks;
  if (result.formulaBoxes.length) {
    let latex: string[] = result.formulaBoxes.map(() => "");
    if (formulaAvailable())
      latex = await readFormulas(
        image,
        row.file_type === "jpeg" ? "image/jpeg" : "image/png",
        result.formulaBoxes.map((b) => ({
          left: b.x,
          top: text.height - b.y - b.h,
          width: b.w,
          height: b.h,
        })),
      ).catch((error: Error) => {
        log("formula model failed", { import: row.id, error: error.message });
        return result.formulaBoxes.map(() => "");
      });
    markdown = markdown.replace(/%%formula (\d+)%%/g, (_m, i: string) => {
      const tex = latex[Number(i)];
      if (!tex) return `*Equation on page ${page} (not read)*`;
      equations++;
      checks++;
      return `$$\n${tex}\n%check\n$$`;
    });
  }
  return {
    markdown,
    tables: result.tables,
    figures: result.figures,
    equations,
    checks,
  };
}

/** Read one waiting scanned page. */
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
  const how = await engine();
  let read: PageRead;
  try {
    const data = await fileFor(row);
    read =
      how === "full"
        ? await readWithModel(row, data, claimed.page)
        : await readWithTesseract(row, data, claimed.page);
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
    read = {
      markdown: `*Page ${claimed.page} couldn't be read.*`,
      tables: 0,
      figures: 0,
      equations: 0,
      checks: 0,
    };
  }
  await pool.query(
    `UPDATE import_pages SET markdown = $3, tables = $4, figures = $5,
            equations = $6, checks = $7, engine = $8, ocr_ms = $9,
            done_at = now()
      WHERE import_id = $1 AND page = $2`,
    [
      row.id,
      claimed.page,
      read.markdown,
      read.tables,
      read.figures,
      read.equations,
      read.checks,
      how,
      Date.now() - started,
    ],
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

/** Put the pages together in their chosen project or Uploads, then delete the file. */
async function finish(importId: string) {
  // Only one lane finishes an import, and never a cancelled one.
  const row = (
    await pool.query<
      ImportRow & {
        notes: string[];
        project_id: string | null;
        project_team_id: string | null;
        keep_original: boolean;
        bytes: string | number;
      }
    >(
      `UPDATE imports SET finished_at = now()
        WHERE id = $1 AND status IN ('reading','ocr') AND finished_at IS NULL
        RETURNING id, user_id, file_name, file_type, object_id, attempts,
          notes, project_id, project_team_id, keep_original, bytes`,
      [importId],
    )
  ).rows[0];
  if (!row) return;
  /** The page file the original is kept as, when it was chosen and fits. */
  let original: string | null = null;
  try {
    const pages = (
      await pool.query<{
        page: number;
        markdown: string | null;
        needs_ocr: boolean;
        tables: number;
        figures: number;
        equations: number;
        checks: number;
      }>(
        `SELECT page, markdown, needs_ocr, tables, figures, equations, checks
           FROM import_pages
          WHERE import_id = $1 ORDER BY page`,
        [row.id],
      )
    ).rows;
    const imported: ImportedPage[] = pages.map((p) => ({
      markdown: p.markdown ?? "",
      ocr: p.needs_ocr,
      tables: p.tables,
      figures: p.figures,
      equations: p.equations,
      checks: p.checks,
    }));
    const { title, content, notes } = assembleImport(imported, row.file_name, {
      notes: row.notes ?? [],
    });
    // "Keep the original": only when it fits in the person's space.
    const keep =
      row.keep_original &&
      !!row.object_id &&
      (await usedBytes(pool, row.user_id)) + Number(row.bytes) <=
        pageFileLimits().quotaBytes &&
      Number(row.bytes) <= pageFileLimits().maxBytes;
    if (row.keep_original && !keep)
      notes.push("Original not kept: your space for files is full");
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [
        row.user_id,
      ]);
      const project = row.project_id
        ? (
            await db.query<{ name: string; team_id: string | null }>(
              `SELECT p.name, p.team_id FROM projects p
                WHERE p.id = $1
                  AND p.team_id IS NOT DISTINCT FROM $2::uuid
                  AND ((p.team_id IS NULL AND p.user_id = $3)
                    OR EXISTS (SELECT 1 FROM team_members m
                      WHERE m.team_id = p.team_id AND m.user_id = $3
                        AND m.role IN ('owner', 'admin', 'member')))
                FOR SHARE`,
              [row.project_id, row.project_team_id, row.user_id],
            )
          ).rows[0]
        : null;
      if (row.project_id && !project)
        throw new ImportFailure(
          "This project or your access to it changed while the file was being read. Nothing was shared. Import it again after checking the project.",
        );
      const docId = (
        await db.query<{ id: string }>(
          `INSERT INTO docs (user_id, team_id, project_id, title, kind, content,
             imported_from, in_uploads)
           VALUES ($1, $2, $3, $4, 'doc', $5::jsonb, $6::jsonb, $7)
           RETURNING id`,
          [
            row.user_id,
            project?.team_id ?? null,
            row.project_id,
            title,
            JSON.stringify(content),
            JSON.stringify({
              file_name: row.file_name,
              file_type: row.file_type,
              pages: pages.length,
              ocr_pages: pages.filter((p) => p.needs_ocr).length,
              imported_at: new Date().toISOString(),
            }),
            !row.project_id,
          ],
        )
      ).rows[0].id;
      if (keep) {
        original = (
          await db.query<{ id: string }>(
            `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes,
               source)
             VALUES ($1, $2, $3, $4, 'file', $5, 'import') RETURNING id`,
            [
              row.user_id,
              docId,
              row.file_name.slice(0, 300),
              IMPORT_MIME[row.file_type] ?? "application/octet-stream",
              Number(row.bytes),
            ],
          )
        ).rows[0].id;
        await db.query(
          `UPDATE docs SET imported_from = imported_from ||
             jsonb_build_object('original_file', $2::text) WHERE id = $1`,
          [docId, original],
        );
      }
      if (row.project_id) {
        await db.query(
          `UPDATE project_activity SET summary = 'File added: ' || $2
            WHERE project_id = $1 AND entity_id = $3
              AND kind = 'note_added'`,
          [row.project_id, title, docId],
        );
      }
      await db.query(
        `UPDATE imports SET status = 'ready', doc_id = $2, notes = $3::jsonb,
                engines = (SELECT coalesce(array_agg(DISTINCT engine), '{}')
                             FROM import_pages
                            WHERE import_id = $1 AND engine IS NOT NULL)
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
          `“${title}” is ready in ${project?.name ?? "Uploads"}`,
          project
            ? `Imported from ${row.file_name} into ${project.name}.`
            : `Imported from ${row.file_name}. Move it to a folder when you're ready.`,
          `doc:${docId}`,
        ],
      );
    });
  } catch (error) {
    log("finish failed", { import: row.id, error: (error as Error).message });
    await pool.query(
      `UPDATE imports SET status = 'failed', error = $2 WHERE id = $1`,
      [
        row.id,
        error instanceof ImportFailure
          ? error.message
          : "This file couldn't be turned into a page. Please try again.",
      ],
    );
  }
  if (cached?.id === row.id) cached = null;
  if (original && row.object_id) await keepOriginal(row.object_id, original);
  await deleteFile(row.id, row.object_id);
  await changed(row.user_id);
}

/** What an import's file is kept as, by the type it was read as. */
const IMPORT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpeg: "image/jpeg",
};

/**
 * Hand an import's file to the page store as the original of its page.
 * If that fails, the page says only where it came from, as before.
 */
async function keepOriginal(objectId: string, fileId: string) {
  try {
    const res = await fetch(
      `${env.FILES_URL}/internal/files/${objectId}/keep`,
      {
        method: "POST",
        headers: {
          "x-orbyn-service": serviceKey(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ file: fileId }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (res.ok) return;
  } catch {
    // Handled below, as a refusal is.
  }
  log("original not kept", { file: fileId });
  await pool.query("DELETE FROM page_files WHERE id = $1", [fileId]);
  await pool.query(
    `UPDATE docs SET imported_from = imported_from - 'original_file'
      WHERE imported_from->>'original_file' = $1`,
    [fileId],
  );
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
  // What this server can read, for the apps and Admin → Storage.
  const how = await engine();
  await pool.query(
    `INSERT INTO converter_state (id, scans, formulas, workers, updated_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET scans = $1, formulas = $2, workers = $3,
       updated_at = now()`,
    [how, how === "tesseract" && formulaAvailable(), lanesFor(how)],
  );
}

const lanesFor = (how: Engine) =>
  how === "full"
    ? env.OCR_WORKERS
    : how === "tesseract"
      ? env.TESSERACT_WORKERS
      : 0;

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
  const how = await engine();
  log("started", {
    scans: how,
    lanes: lanesFor(how),
    formulas: formulaAvailable(),
  });
  await Promise.all([
    upkeep(),
    lane("read", readNext),
    ...Array.from({ length: lanesFor(how) }, (_, n) =>
      lane(`ocr${n + 1}`, ocrNext),
    ),
  ]);
}

/**
 * Work through everything waiting, once (reading, then scanned pages), and
 * report what this converter can read. For tests and one-off runs; the
 * service itself runs `runConverter`.
 */
export async function convertPending() {
  await heartbeat();
  while (await readNext());
  if (lanesFor(await engine()) > 0) while (await ocrNext());
}

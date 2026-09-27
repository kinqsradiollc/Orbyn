import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  IMPORT_MIME,
  type ImportFileType,
  type KeptOriginal,
  type OriginalsOverview,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { serviceKey } from "./tokens.js";

/**
 * "Keep the original": the setting, the space it uses, and each page's
 * original to download or delete. The bytes live in the file service; the
 * API reads them back only for someone who can open the page.
 */

/** Originals an agent kept (H2) come in a few more types than imports. */
const KEPT_MIME: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

const quotaBytes = () => env.FILES_KEEP_QUOTA_MB * 1024 * 1024;

/** A kept original's bytes from the file service. */
export async function fetchOriginal(id: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${env.FILES_URL}/internal/kept/${id}`, {
      headers: { "x-orbyn-service": serviceKey() },
      signal: AbortSignal.timeout(60_000),
    });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Delete a kept original's bytes; the file service's sweep catches a miss. */
async function removeOriginal(id: string) {
  try {
    await fetch(`${env.FILES_URL}/internal/kept/${id}`, {
      method: "DELETE",
      headers: { "x-orbyn-service": serviceKey() },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Its row goes now; the sweep removes a file nothing names.
  }
}

/** The page's original, when `userId` can open the page. */
async function originalOf(docId: string, userId: string) {
  const row = (
    await reader().query<
      KeptOriginal & { user_id: string; team_id: string | null }
    >(
      `SELECT k.id, k.doc_id, k.file_name, k.file_type, k.bytes::int AS bytes,
              k.created_at, k.user_id, d.team_id
         FROM kept_files k JOIN docs d ON d.id = k.doc_id
        WHERE k.doc_id = $2 AND ${docVisibleTo("$1")}`,
      [userId, docId],
    )
  ).rows[0];
  if (!row) fail(404, "This page has no original.");
  return row;
}

export async function originalRoutes(app: FastifyInstance) {
  app.get("/me/originals", async (r): Promise<OriginalsOverview> => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const [setting, files] = await Promise.all([
      db.query<{ keep_originals: boolean }>(
        "SELECT keep_originals FROM users WHERE id = $1",
        [u.id],
      ),
      db.query<KeptOriginal & { title: string | null }>(
        `SELECT k.id, k.doc_id, k.file_name, k.file_type, k.bytes::int AS bytes,
                k.created_at, d.title
           FROM kept_files k LEFT JOIN docs d ON d.id = k.doc_id
          WHERE k.user_id = $1 AND k.doc_id IS NOT NULL
          ORDER BY k.created_at DESC LIMIT 500`,
        [u.id],
      ),
    ]);
    return {
      keep: !!setting.rows[0]?.keep_originals,
      used_bytes: files.rows.reduce((n, f) => n + Number(f.bytes), 0),
      quota_bytes: quotaBytes(),
      files: files.rows,
    };
  });

  app.put("/me/originals", async (r) => {
    const u = await authenticate(r);
    const { keep } = z.object({ keep: z.boolean() }).strict().parse(r.body);
    await pool.query("UPDATE users SET keep_originals = $2 WHERE id = $1", [
      u.id,
      keep,
    ]);
    return { keep };
  });

  /** Download a page's original. */
  app.get("/docs/:id/original", async (r, reply) => {
    const u = await authenticate(r);
    const row = await originalOf(idParam(r), u.id);
    const body = await fetchOriginal(row.id);
    if (!body) fail(404, "The original couldn't be found.");
    const type =
      IMPORT_MIME[row.file_type as ImportFileType] ??
      KEPT_MIME[row.file_type] ??
      "application/octet-stream";
    const name = row.file_name.replace(/["\\\r\n]/g, "_");
    reply.header("Content-Type", type);
    reply.header(
      "Content-Disposition",
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    );
    reply.header("Cache-Control", "private, no-store");
    return reply.send(body);
  });

  /**
   * Delete a page's original; the page stays. The person who imported it,
   * or anyone who may edit the page, can.
   */
  app.delete("/docs/:id/original", async (r, reply) => {
    const u = await authenticate(r);
    const row = await originalOf(idParam(r), u.id);
    if (row.user_id !== u.id) {
      if (!row.team_id) fail(404, "This page has no original.");
      await requireTeam(row.team_id, u, "items:write");
    }
    await pool.query("DELETE FROM kept_files WHERE id = $1", [row.id]);
    await removeOriginal(row.id);
    reply.code(204);
  });
}

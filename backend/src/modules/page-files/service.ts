import {
  FILE_LINK_MINUTES,
  type PageFile,
  type PageFileLink,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import type { Queryable } from "../../db/pool.js";
import { claimToken } from "../imports/tokens.js";

/**
 * Pictures and files in pages: what other modules share with the routes
 * (routes.ts) — the columns read, the size limits, the space used and a
 * short-lived read link.
 */

export const PAGE_FILE_COLUMNS = `f.id, f.doc_id, f.name, f.mime, f.kind,
  f.bytes::float8 AS bytes, f.width, f.height, f.status, f.source, f.created_at`;

/** The largest file, and each person's space, in bytes. */
export const pageFileLimits = () => ({
  maxBytes: env.PAGE_FILES_MAX_MB * 1024 * 1024,
  quotaBytes: env.PAGE_FILES_QUOTA_MB * 1024 * 1024,
});

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

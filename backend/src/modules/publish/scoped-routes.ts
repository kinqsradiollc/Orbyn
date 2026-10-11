import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  blocksHtml,
  docContainersHtml,
  docContainerBlocks,
  docOutline,
  publishedPageHtml,
  publishedMissingHtml,
  pagePublicationInput,
  selectPublishedBlocks,
  parseVersionedDocContent,
  fail,
  type PagePublication,
  type VersionedDocContent,
  type PageFile,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { audit } from "../../lib/audit.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { requireDoc } from "../docs/service.js";
import { readVersionedDoc } from "../docs/content-format.js";
import { privacyFrom } from "../links/privacy.js";
import { createMathHtml } from "../../lib/math-html.js";
import { renderPublicationDiagrams } from "./diagrams.js";
import { loadPublishedMedia, PUBLISHED_MEDIA_MAX_BYTES } from "./media.js";
import { PAGE_FILE_COLUMNS } from "../page-files/service.js";
import { contentDisposition } from "../../lib/disposition.js";

type Publication = {
  doc_id: string;
  publisher_id: string;
  token: string;
  revision: number;
  mode: "snapshot" | "live";
  block_ids: string[];
  snapshot: VersionedDocContent;
  title: string;
  source_version: number;
  expires_at: Date | null;
  updated_at: Date;
};
const info = (row: Publication): PagePublication => ({
  revision: row.revision,
  mode: row.mode,
  block_ids: row.block_ids,
  path: `/s/${row.token}`,
  expires_at: row.expires_at?.toISOString() ?? null,
  source_version: row.source_version,
});
const leaves = (doc: VersionedDocContent) =>
  doc.format === 1
    ? doc.blocks
    : docContainerBlocks(doc.nodes, { projected: true });

/** Current source location, publisher access, expiry and team policy fence every public read. */
async function visiblePublication(token: string, db: Queryable = pool) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return (
    (
      await db.query<
        Publication & {
          content: unknown;
          content_nodes: unknown;
          content_format: 1 | 2;
          current_version: number;
        }
      >(
        `SELECT p.*,d.content,d.content_nodes,d.content_format,d.version AS current_version
     FROM scoped_page_publications p JOIN docs d ON d.id=p.doc_id
     JOIN users u ON u.id=p.publisher_id AND NOT u.disabled
     LEFT JOIN teams t ON t.id=d.team_id
     WHERE p.token=$1 AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp())
       AND d.kind NOT IN ('memory','agent')
       AND ${docVisibleTo("p.publisher_id")}
       AND d.team_id IS NOT DISTINCT FROM p.source_team_id
       AND coalesce(t.publishing_allowed,true)`,
        [token],
      )
    ).rows[0] ?? null
  );
}
function selected(
  row: NonNullable<Awaited<ReturnType<typeof visiblePublication>>>,
) {
  try {
    return selectPublishedBlocks(
      row.mode === "snapshot"
        ? row.snapshot
        : row.content_format === 2
          ? { format: 2, nodes: row.content_nodes }
          : { format: 1, blocks: row.content },
      row.block_ids,
    );
  } catch {
    return fail(404, "Published content is no longer available.");
  }
}
async function fence(
  expected: NonNullable<Awaited<ReturnType<typeof visiblePublication>>>,
) {
  const current = await visiblePublication(expected.token);
  if (!current || current.revision !== expected.revision)
    fail(404, "Publication changed or was removed.");
  if (current.current_version !== expected.current_version)
    fail(409, "This page changed. Refresh it.");
  return current;
}

export async function scopedPublicationRoutes(app: FastifyInstance) {
  app.get("/docs/:id/publication", async (r) => {
    const user = await authenticate(r),
      id = idParam(r);
    return transaction(async (db) => {
      await requireDoc(db, id, user, "items:write");
      const row = (
        await db.query<Publication>(
          "SELECT * FROM scoped_page_publications WHERE doc_id=$1",
          [id],
        )
      ).rows[0];
      return row ? info(row) : null;
    });
  });
  app.put("/docs/:id/publication", strictRateLimit, async (r) => {
    const user = await authenticate(r),
      id = idParam(r),
      input = pagePublicationInput.parse(r.body);
    return transaction(async (db) => {
      const doc = await requireDoc(db, id, user, "items:write");
      if (doc.kind === "memory" || doc.kind === "agent")
        fail(403, "Private notes cannot be published.");
      if (doc.version !== input.expected_doc_version)
        fail(409, "Page changed. Review the selected blocks again.");
      if (input.expires_at && new Date(input.expires_at) <= new Date())
        fail(422, "Choose a future expiry.");
      if (doc.team_id) {
        const team = (
          await db.query<{ publishing_allowed: boolean }>(
            "SELECT publishing_allowed FROM teams WHERE id=$1 FOR SHARE",
            [doc.team_id],
          )
        ).rows[0];
        if (!team?.publishing_allowed)
          fail(403, "Publishing is off for this team.");
      }
      const existing = (
        await db.query<Publication>(
          "SELECT * FROM scoped_page_publications WHERE doc_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if ((existing?.revision ?? 0) !== input.expected_revision)
        fail(409, "Publication changed. Reload it.");
      const source = await readVersionedDoc(db, user, id, [1, 2]);
      let snapshot: VersionedDocContent;
      try {
        snapshot = selectPublishedBlocks(source.document, input.block_ids);
      } catch {
        return fail(409, "Selected blocks changed. Select them again.");
      }
      const row = (
        await db.query<Publication>(
          `INSERT INTO scoped_page_publications(doc_id,publisher_id,token,mode,block_ids,snapshot,title,source_version,source_team_id,expires_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
         ON CONFLICT(doc_id) DO UPDATE SET publisher_id=excluded.publisher_id,revision=scoped_page_publications.revision+1,
           mode=excluded.mode,block_ids=excluded.block_ids,snapshot=excluded.snapshot,title=excluded.title,
           source_version=excluded.source_version,source_team_id=excluded.source_team_id,expires_at=excluded.expires_at,updated_at=clock_timestamp()
         RETURNING *`,
          [
            id,
            user.id,
            randomBytes(32).toString("base64url"),
            input.mode,
            JSON.stringify(input.block_ids),
            JSON.stringify(snapshot),
            source.title,
            doc.version,
            doc.team_id,
            input.expires_at,
          ],
        )
      ).rows[0];
      await audit(
        {
          actorId: user.id,
          action: "page.publication_consent",
          targetType: "page",
          targetId: id,
          details: {
            mode: input.mode,
            block_count: input.block_ids.length,
            revision: row.revision,
            expires_at: input.expires_at,
          },
        },
        db,
      );
      return info(row);
    });
  });
  app.delete("/docs/:id/publication", async (r) => {
    const user = await authenticate(r),
      id = idParam(r);
    return transaction(async (db) => {
      await requireDoc(db, id, user, "items:write");
      await db.query("DELETE FROM scoped_page_publications WHERE doc_id=$1", [
        id,
      ]);
      await audit(
        {
          actorId: user.id,
          action: "page.publication_revoked",
          targetType: "page",
          targetId: id,
        },
        db,
      );
      return { ok: true };
    });
  });
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  };
  app.get("/s/:token", async (r, reply) => {
    reply.headers(headers).type("text/html; charset=utf-8");
    const token = String((r.params as { token: string }).token),
      row = await visiblePublication(token);
    if (!row) return reply.code(404).send(publishedMissingHtml());
    // Every internal object label is private on this scoped anonymous surface.
    const document = parseVersionedDocContent(
      privacyFrom(() => true).value(selected(row)),
      { projected: true },
    );
    const content = leaves(document);
    const options = {
      anchors: true,
      math: createMathHtml(),
      diagramSources: true,
      fileUrl: (id: string) => `/s/${token}/media/${id}`,
      linkUrl: (href: string) => (/^https?:\/\//i.test(href) ? href : null),
    };
    const html = await renderPublicationDiagrams(
      document.format === 2
        ? docContainersHtml(document.nodes, { ...options, projected: true })
        : blocksHtml(document.blocks, options),
      r,
      reply,
    );
    await fence(row);
    return reply.send(
      publishedPageHtml({
        title: row.title,
        bodyHtml: html,
        description: "",
        url: `/s/${token}`,
        image: null,
        noindex: true,
        updatedAt: row.updated_at.toISOString(),
        contents: docOutline(content),
        linkedHere: [],
        folder: null,
      }),
    );
  });
  let mediaWorking = 0,
    mediaBytes = 0;
  app.get("/s/:token/media/:file", strictRateLimit, async (r, reply) => {
    reply.headers(headers);
    const { token, file: id } = r.params as { token: string; file: string };
    const authorize = async () => {
      const row = await visiblePublication(token);
      if (!row || !z.uuid().safeParse(id).success)
        return fail(404, "File not published.");
      if (
        !leaves(selected(row)).some(
          (block) =>
            (block.type === "image" || block.type === "file") &&
            block.file.toLowerCase() === id.toLowerCase(),
        )
      )
        return fail(404, "File not published.");
      const file = (
        await pool.query<PageFile>(
          `SELECT ${PAGE_FILE_COLUMNS} FROM page_files f
        JOIN page_file_refs pr ON pr.file_id=f.id WHERE f.id=$1 AND pr.doc_id=$2 AND f.status='ready'`,
          [id, row.doc_id],
        )
      ).rows[0];
      if (!file) return fail(404, "File not published.");
      return { row, file: { ...file, bytes: Number(file.bytes) } };
    };
    const first = await authorize();
    if (first.file.bytes < 1 || first.file.bytes > PUBLISHED_MEDIA_MAX_BYTES)
      fail(413, "File too large.");
    if (
      mediaWorking >= 4 ||
      mediaBytes + first.file.bytes > PUBLISHED_MEDIA_MAX_BYTES
    )
      return reply.code(503).send({ message: "Try again shortly." });
    mediaWorking++;
    mediaBytes += first.file.bytes;
    const controller = new AbortController();
    const abort = () => controller.abort();
    let handedOff = false,
      released = false,
      operationActive = true;
    const release = () => {
      controller.abort();
      if (operationActive || released) return;
      released = true;
      mediaWorking--;
      mediaBytes -= first.file.bytes;
      r.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", release);
      reply.raw.removeListener("finish", release);
    };
    r.raw.once("aborted", abort);
    reply.raw.once("close", release);
    reply.raw.once("finish", release);
    if (r.raw.aborted || reply.raw.destroyed) abort();
    try {
      const data = await loadPublishedMedia(first.file, controller.signal);
      const current = await authorize();
      if (
        first.row.revision !== current.row.revision ||
        first.file.bytes !== current.file.bytes ||
        first.file.mime !== current.file.mime ||
        first.file.name !== current.file.name
      )
        fail(409, "File changed. Refresh it.");
      if (controller.signal.aborted) return reply.hijack();
      handedOff = true;
      return reply
        .type(current.file.mime)
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header(
          "content-disposition",
          contentDisposition(
            current.file.kind === "image" ? "inline" : "attachment",
            current.file.name,
          ),
        )
        .send(data);
    } finally {
      operationActive = false;
      if (!handedOff || controller.signal.aborted) release();
    }
  });
}

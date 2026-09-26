import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { sniffPageFile } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import {
  diskFull,
  filesDir,
  keptDir,
  objectPaths,
  pageFilesDir,
  readObject,
  removeObject,
  storeStream,
  UploadError,
} from "../imports/store.js";
import { isService, readClaimToken } from "../imports/tokens.js";

/**
 * Pictures and files in pages (EDT-01), on the file store's side. Uploads
 * arrive with a one-time link the API signed (PUT /files/p/<link>); a
 * picture is shown, or a file downloaded, with a short-lived link the API
 * signed for someone who can read its page (GET /files/r/<link>). Files are
 * kept encrypted in their own directory for as long as their row lives; the
 * sweep here deletes the bytes of rows that are gone.
 */

type UploadClaim = { f: string; u: string; e: number; m: number; t: string };
type ReadClaim = { f: string; e: number };

/** Remove kept files whose row has gone, or whose upload failed. */
export async function sweepPageFiles(): Promise<number> {
  let names: string[] = [];
  try {
    names = await readdir(pageFilesDir());
  } catch {
    return 0;
  }
  const ids = [
    ...new Set(
      names
        .map((n) => /^([0-9a-f-]{36})\.(bin|key)$/.exec(n)?.[1])
        .filter((x): x is string => !!x),
    ),
  ];
  if (!ids.length) return 0;
  const kept = new Set(
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM page_files
          WHERE id = ANY ($1::uuid[]) AND status <> 'failed'`,
        [ids],
      )
    ).rows.map((r) => r.id),
  );
  let removed = 0;
  for (const id of ids) {
    if (kept.has(id)) continue;
    // A file being written right now has its row already; anything without
    // one is at least a few minutes old before it goes.
    const age = await stat(objectPaths(id, pageFilesDir()).data)
      .then((s) => Date.now() - s.mtimeMs)
      .catch(() => Infinity);
    if (age < 5 * 60_000) continue;
    await removeObject(id, pageFilesDir());
    removed++;
  }
  return removed;
}

/** Content-Disposition for a file's own name, safe in a header. */
const disposition = (kind: "inline" | "attachment", name: string) => {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

export async function pageFileStoreRoutes(app: FastifyInstance) {
  // Raw bytes, as the import uploads are (the parser is set in filesRoutes
  // when both run in one process; set here for the files service alone).
  if (!app.hasContentTypeParser("*"))
    app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

  /** One picture or file for a page, with the link the API handed out. */
  app.put(
    "/files/p/:token",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const claim = readClaimToken<UploadClaim>(
        "page-upload",
        (r.params as { token: string }).token,
      );
      if (!claim)
        return reply.code(403).send({
          message: "This upload link has expired. Please add the file again.",
        });
      const length = Number(r.headers["content-length"] ?? 0);
      if (length > claim.m)
        return reply
          .code(413)
          .send({ message: "This file is bigger than it said it was." });
      if (await diskFull(length || claim.m, pageFilesDir()))
        return reply.code(507).send({
          message:
            "Orbyn can't take new files right now. Try again in a few minutes.",
        });
      // Taking the row makes the link single-use.
      const taken = (
        await pool.query(
          `UPDATE page_files SET stored_at = now()
            WHERE id = $1 AND user_id = $2 AND status = 'waiting'
              AND stored_at IS NULL
            RETURNING id`,
          [claim.f, claim.u],
        )
      ).rowCount;
      if (!taken)
        return reply
          .code(409)
          .send({ message: "This upload link has already been used." });
      let bytes: number;
      try {
        bytes = await storeStream(claim.f, r.body as Readable, claim.m, {
          dir: pageFilesDir(),
          type: claim.t,
          tooBig: "This file is bigger than it said it was.",
          sniff: (head) => sniffPageFile(head, claim.t),
          wrongType:
            "This file isn't what its name says, so it wasn't added to the page.",
        });
      } catch (error) {
        const e = error as UploadError;
        const message =
          e instanceof UploadError
            ? e.message
            : "The upload didn't finish. Please try again.";
        await pool.query(
          "UPDATE page_files SET status = 'failed' WHERE id = $1",
          [claim.f],
        );
        if (!(e instanceof UploadError))
          r.log.warn({ err: e }, "Page file upload failed");
        return reply
          .code(e instanceof UploadError ? e.statusCode : 400)
          .send({ message });
      }
      await pool.query(
        `UPDATE page_files SET status = 'ready', bytes = $2 WHERE id = $1`,
        [claim.f, bytes],
      );
      return reply.code(201).send({ id: claim.f, bytes });
    },
  );

  /** A picture shown, or a file downloaded, with a link the API signed. */
  app.get(
    "/files/r/:token",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const claim = readClaimToken<ReadClaim>(
        "page-read",
        (r.params as { token: string }).token,
      );
      if (!claim)
        return reply
          .code(403)
          .send({ message: "This link has expired. Open the page again." });
      const row = (
        await pool.query<{ name: string; mime: string; kind: string }>(
          `SELECT name, mime, kind FROM page_files
            WHERE id = $1 AND status = 'ready' AND doc_id IS NOT NULL`,
          [claim.f],
        )
      ).rows[0];
      if (!row) return reply.code(404).send({ message: "File not found" });
      let body: Buffer;
      try {
        body = await readObject(claim.f, pageFilesDir());
      } catch {
        return reply.code(404).send({ message: "File not found" });
      }
      // Pictures and recordings (CAP-10) play in the page; other files download.
      const download =
        (r.query as { download?: string }).download === "1" ||
        (row.kind !== "image" && !row.mime.startsWith("audio/"));
      return reply
        .header("Content-Type", row.mime)
        .header(
          "Content-Disposition",
          disposition(download ? "attachment" : "inline", row.name),
        )
        .header("Cache-Control", "private, max-age=3000")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .send(body);
    },
  );

  /**
   * Keep an import's original file with its page ("Keep the original"):
   * the converter hands over the upload, which moves from the day-long
   * import store into the page store under the page file's id. When the
   * upload was already kept as the page's original (`kept`, POST
   * /internal/files/:id/keep), it is copied from the kept originals and
   * left there.
   */
  app.post("/internal/files/:id/keep-in-page", async (r, reply) => {
    if (!isService(r.headers["x-orbyn-service"]))
      return reply.code(403).send({ message: "Forbidden" });
    const objectId = (r.params as { id: string }).id;
    const { file, kept } = (r.body ?? {}) as {
      file?: string;
      kept?: boolean;
    };
    if (
      !/^[0-9a-f-]{36}$/.test(objectId) ||
      !file ||
      !/^[0-9a-f-]{36}$/.test(file)
    )
      return reply.code(400).send({ message: "Bad request" });
    const from = objectPaths(objectId, kept ? keptDir() : filesDir());
    const to = objectPaths(file, pageFilesDir());
    try {
      await mkdir(pageFilesDir(), { recursive: true, mode: 0o700 });
      // Copied, not renamed: the two stores are often on different volumes.
      // The file's key is wrapped with the same master key, so it moves as is.
      await copyFile(from.data, to.data);
      await copyFile(from.key, to.key);
    } catch {
      await rm(to.data, { force: true });
      await rm(to.key, { force: true });
      await pool.query(
        "UPDATE page_files SET status = 'failed' WHERE id = $1",
        [file],
      );
      return reply.code(404).send({ message: "Not found" });
    }
    await pool.query(
      `UPDATE page_files SET status = 'ready', stored_at = now()
        WHERE id = $1`,
      [file],
    );
    if (!kept) await removeObject(objectId, filesDir());
    return { id: file };
  });

  // Every ten minutes, the bytes of rows that are gone go too.
  let timer: NodeJS.Timeout | null = null;
  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      sweepPageFiles().catch((e) =>
        app.log.warn({ err: e }, "Page file sweep failed"),
      );
    }, 10 * 60_000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
  });
}

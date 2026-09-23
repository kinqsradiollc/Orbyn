import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { IMPORT_LIMITS, sniffImportType } from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { announceTo } from "../presence/live.js";
import { isService, readUploadToken } from "./tokens.js";

/**
 * The file store: Orbyn's own home for uploaded files while they're being
 * imported, and nothing longer. It accepts one upload per signed link,
 * encrypts each file with its own key as it streams in, lets only the
 * converter read a file back, and deletes it the moment the import ends —
 * or, whatever happened, within a day.
 *
 * It isn't an object store and doesn't try to be: there is no listing, no
 * public read, no versioning. File names are random ids; the person's file
 * name stays in Postgres.
 */

export const filesDir = () => env.FILES_DIR || join(tmpdir(), "orbyn-files");

/** The key that wraps each file's own key. */
function masterKey(): Buffer {
  if (env.FILES_MASTER_KEY) {
    const key = Buffer.from(env.FILES_MASTER_KEY, "base64");
    if (key.length === 32) return key;
    throw new Error("FILES_MASTER_KEY must be 32 bytes, base64.");
  }
  // Development without a master key: derived from the shared secret.
  return createHmac("sha256", env.FILES_SECRET).update("master").digest();
}

type KeyFile = {
  /** The file's own key, encrypted with the master key. */
  wrapped: string;
  wrapIv: string;
  wrapTag: string;
  /** The file's IV and authentication tag. */
  iv: string;
  tag: string;
  bytes: number;
  type: string;
};

const paths = (id: string) => ({
  data: join(filesDir(), `${id}.bin`),
  key: join(filesDir(), `${id}.key`),
});

const OBJECT_ID = /^[0-9a-f-]{36}$/;

/** Remove a stored file and its key; once the key is gone it can't be read. */
export async function removeObject(id: string) {
  if (!OBJECT_ID.test(id)) return;
  const p = paths(id);
  await rm(p.key, { force: true });
  await rm(p.data, { force: true });
}

class UploadError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Stream `body` to disk, encrypted, refusing anything over `max` bytes or
 * whose first bytes aren't the promised type.
 */
async function storeStream(
  id: string,
  body: Readable,
  max: number,
  type: string,
): Promise<number> {
  await mkdir(filesDir(), { recursive: true, mode: 0o700 });
  const fileKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fileKey, iv);
  const p = paths(id);
  const out = createWriteStream(p.data, { mode: 0o600 });
  let bytes = 0;
  let head: Buffer | null = null;
  try {
    for await (const chunk of body) {
      const buf = chunk as Buffer;
      bytes += buf.length;
      if (bytes > max)
        throw new UploadError(
          413,
          `This file is over the ${Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024)} MB limit.`,
        );
      if (!head) {
        head = buf;
        const actual = sniffImportType(buf);
        if (actual !== type)
          throw new UploadError(
            415,
            "This file isn't what its name says. Orbyn imports PDF, Word (.docx), PNG and JPEG files.",
          );
      }
      if (!out.write(cipher.update(buf)))
        await new Promise<void>((r) => out.once("drain", () => r()));
    }
    if (!bytes) throw new UploadError(400, "The file was empty.");
    out.write(cipher.final());
    await new Promise<void>((resolve, reject) =>
      out.end((e?: Error | null) => (e ? reject(e) : resolve())),
    );
  } catch (error) {
    out.destroy();
    await removeObject(id);
    throw error;
  }
  const wrapIv = randomBytes(12);
  const wrap = createCipheriv("aes-256-gcm", masterKey(), wrapIv);
  const wrapped = Buffer.concat([wrap.update(fileKey), wrap.final()]);
  const keyFile: KeyFile = {
    wrapped: wrapped.toString("base64"),
    wrapIv: wrapIv.toString("base64"),
    wrapTag: wrap.getAuthTag().toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    bytes,
    type,
  };
  await writeFile(p.key, JSON.stringify(keyFile), { mode: 0o600 });
  return bytes;
}

/** A stored file, decrypted. Throws when it's missing or tampered with. */
export async function readObject(id: string): Promise<Buffer> {
  if (!OBJECT_ID.test(id)) throw new UploadError(404, "Not found");
  const p = paths(id);
  const k = JSON.parse(await readFile(p.key, "utf8")) as KeyFile;
  const unwrap = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(k.wrapIv, "base64"),
  );
  unwrap.setAuthTag(Buffer.from(k.wrapTag, "base64"));
  const fileKey = Buffer.concat([
    unwrap.update(Buffer.from(k.wrapped, "base64")),
    unwrap.final(),
  ]);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    fileKey,
    Buffer.from(k.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(k.tag, "base64"));
  return Buffer.concat([
    decipher.update(await readFile(p.data)),
    decipher.final(),
  ]);
}

/** Refuse new uploads when the disk is this full. */
const DISK_FULL = 0.85;

async function diskFull(): Promise<boolean> {
  try {
    await mkdir(filesDir(), { recursive: true, mode: 0o700 });
    const s = await statfs(filesDir());
    return 1 - s.bavail / s.blocks > DISK_FULL;
  } catch {
    return false;
  }
}

/**
 * Delete what must not stay: files whose import has ended or vanished,
 * anything older than a day, and uploads that stopped halfway.
 */
export async function sweepFiles(now = Date.now()) {
  let names: string[] = [];
  try {
    names = await readdir(filesDir());
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
  let removed = 0;
  const maxAge = IMPORT_LIMITS.keepFileHours * 3_600_000;
  for (const id of ids) {
    const p = paths(id);
    const age = await stat(p.data)
      .then((s) => now - s.mtimeMs)
      .catch(() => Infinity);
    const row = (
      await pool.query<{ id: string; status: string; user_id: string }>(
        "SELECT id, status, user_id FROM imports WHERE object_id = $1",
        [id],
      )
    ).rows[0];
    const active =
      row && ["waiting", "queued", "reading", "ocr"].includes(row.status);
    const hasKey = await stat(p.key).then(
      () => true,
      () => false,
    );
    // An upload still streaming has no key file yet; give it half an hour.
    const stalled = !hasKey && age > 30 * 60_000;
    if (
      active &&
      age <= maxAge &&
      !stalled &&
      (hasKey || row.status === "waiting")
    )
      continue;
    await removeObject(id);
    removed++;
    if (row) {
      await pool.query(
        `UPDATE imports SET object_id = NULL,
           status = CASE WHEN status IN ('waiting','queued','reading','ocr')
                         THEN 'failed' ELSE status END,
           error = CASE WHEN status IN ('waiting','queued','reading','ocr')
                        THEN $2 ELSE error END,
           finished_at = coalesce(finished_at, now())
         WHERE id = $1`,
        [
          row.id,
          stalled
            ? "The upload didn't finish. Please upload the file again."
            : "The file waited too long and was deleted. Please upload it again.",
        ],
      );
      if (active)
        await announceTo(pool, { user_id: row.user_id }, "changed").catch(
          () => {},
        );
    }
  }
  return removed;
}

export async function filesRoutes(app: FastifyInstance) {
  // Uploads arrive as raw bytes, streamed straight to disk.
  app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

  /** One upload, with the signed link the API handed out. */
  app.put(
    "/files/u/:token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const claim = readUploadToken((r.params as { token: string }).token);
      if (!claim)
        return reply.code(403).send({
          message:
            "This upload link has expired. Please start the upload again.",
        });
      const length = Number(r.headers["content-length"] ?? 0);
      if (length > claim.m)
        return reply.code(413).send({
          message: `This file is over the ${Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024)} MB limit.`,
        });
      if (await diskFull())
        return reply.code(507).send({
          message:
            "Orbyn can't take new files right now. Try again in a few minutes.",
        });
      const objectId = randomUUID();
      // Reserving the import makes the link single-use.
      const reserved = (
        await pool.query(
          `UPDATE imports SET object_id = $3, claimed_at = now()
            WHERE id = $1 AND user_id = $2 AND status = 'waiting'
              AND object_id IS NULL
            RETURNING id`,
          [claim.i, claim.u, objectId],
        )
      ).rowCount;
      if (!reserved)
        return reply
          .code(409)
          .send({ message: "This upload link has already been used." });
      let bytes: number;
      try {
        bytes = await storeStream(
          objectId,
          r.body as Readable,
          claim.m,
          claim.t,
        );
      } catch (error) {
        const e = error as UploadError;
        const message =
          e instanceof UploadError
            ? e.message
            : "The upload didn't finish. Please try again.";
        await pool.query(
          `UPDATE imports SET status = 'failed', error = $2, object_id = NULL,
             finished_at = now() WHERE id = $1`,
          [claim.i, message],
        );
        await announceTo(pool, { user_id: claim.u }, "changed").catch(() => {});
        if (!(e instanceof UploadError))
          r.log.warn({ err: e }, "Upload failed");
        return reply
          .code(e instanceof UploadError ? e.statusCode : 400)
          .send({ message });
      }
      const queued = (
        await pool.query(
          `UPDATE imports SET status = 'queued', bytes = $2, claimed_at = NULL
            WHERE id = $1 AND status = 'waiting' RETURNING id`,
          [claim.i, bytes],
        )
      ).rowCount;
      // Cancelled while it was uploading: nothing to keep.
      if (!queued) await removeObject(objectId);
      await announceTo(pool, { user_id: claim.u }, "changed").catch(() => {});
      reply.code(queued ? 201 : 409);
      return queued
        ? { id: claim.i, bytes }
        : { message: "This import was cancelled." };
    },
  );

  /** The converter reads a file back, once, to import it. */
  app.get("/internal/files/:id", async (r, reply) => {
    if (!isService(r.headers["x-orbyn-service"]))
      return reply.code(403).send({ message: "Forbidden" });
    try {
      const body = await readObject((r.params as { id: string }).id);
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Cache-Control", "no-store");
      return reply.send(body);
    } catch {
      return reply.code(404).send({ message: "Not found" });
    }
  });

  /** And deletes it as soon as the import has ended. */
  app.delete("/internal/files/:id", async (r, reply) => {
    if (!isService(r.headers["x-orbyn-service"]))
      return reply.code(403).send({ message: "Forbidden" });
    const id = (r.params as { id: string }).id;
    await removeObject(id);
    await pool.query(
      "UPDATE imports SET object_id = NULL WHERE object_id = $1",
      [id],
    );
    return reply.code(204).send();
  });

  // Every ten minutes, whatever else happens.
  let timer: NodeJS.Timeout | null = null;
  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      sweepFiles().catch((e) => app.log.warn({ err: e }, "File sweep failed"));
    }, 10 * 60_000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
  });
}

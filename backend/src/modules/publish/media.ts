import { fail, type PageFile } from "@orbyn/core";
import { env } from "../../config/env.js";
import { claimToken } from "../imports/tokens.js";
import { pageFileLimits } from "../page-files/service.js";

/** Public reads buffer a complete authorized file; bound memory independently of private uploads. */
export const PUBLISHED_MEDIA_MAX_BYTES = 64 * 1024 * 1024;

/** Fetch only already-authorized stored bytes; callers must fence publication again before delivery. */
export async function loadPublishedMedia(
  file: Pick<PageFile, "id" | "mime" | "bytes">,
  signal: AbortSignal,
): Promise<Buffer> {
  const max = Math.min(pageFileLimits().maxBytes, PUBLISHED_MEDIA_MAX_BYTES);
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > max)
    fail(413, "This published file is too large to read.");
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  const active = AbortSignal.any([signal, timeout.signal]);
  try {
    if (env.FILES_SECRET.length < 16)
      throw new Error("File service not configured");
    active.throwIfAborted();
    const base = new URL(env.FILES_URL);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new Error("Invalid file service");
    const token = claimToken("page-read", {
      f: file.id,
      e: Math.floor(Date.now() / 1000) + 30,
    });
    const response = await fetch(new URL(`/files/r/${token}`, base), {
      signal: active,
      redirect: "error",
    });
    if (
      !response.ok ||
      !response.body ||
      response.headers.get("content-type")?.split(";")[0].trim() !== file.mime
    ) {
      await response.body?.cancel();
      throw new Error("File service unavailable");
    }
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== file.bytes) {
      await response.body.cancel();
      throw new Error("File changed");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        active.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > file.bytes || size > max)
          throw new Error("File size exceeded");
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      await reader.cancel();
    }
    if (size !== file.bytes) throw new Error("File incomplete");
    return Buffer.concat(chunks, size);
  } catch {
    fail(503, "Published file loading is unavailable. Try again shortly.");
  } finally {
    clearTimeout(timer);
    timeout.abort();
  }
}

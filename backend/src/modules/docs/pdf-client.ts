import type { FastifyReply, FastifyRequest } from "fastify";
import { fail } from "@orbyn/core";
import { env } from "../../config/env.js";
import { pdfRequestHeaders } from "./pdf-service.js";

/** Send an already authorized/revision-fenced snapshot; never silently downgrade to plain PDF. */
export async function exportRenderedPdf(
  html: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Buffer> {
  if (!env.DOC_PDF_URL || env.DOC_PDF_KEY.length < 32)
    fail(503, "Document PDF rendering is not configured.");
  if (Buffer.byteLength(html) > 20 * 1024 * 1024)
    fail(413, "This document is too large to print.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once("aborted", abort);
  reply.raw.once("close", abort);
  const timer = setTimeout(abort, 35_000);
  try {
    const response = await fetch(
      `${env.DOC_PDF_URL.replace(/\/$/, "")}/render`,
      {
        method: "POST",
        headers: pdfRequestHeaders(html, env.DOC_PDF_KEY),
        body: html,
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("application/pdf") ||
      !response.body
    )
      throw new Error("PDF renderer failed.");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 24 * 1024 * 1024)
          throw new Error("PDF result is too large.");
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      await reader.cancel();
    }
    const pdf = Buffer.concat(chunks, bytes);
    if (pdf.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid PDF result.");
    return pdf;
  } catch {
    fail(503, "Document PDF rendering is unavailable. Try again shortly.");
  } finally {
    clearTimeout(timer);
    request.raw.removeListener("aborted", abort);
    reply.raw.removeListener("close", abort);
  }
}

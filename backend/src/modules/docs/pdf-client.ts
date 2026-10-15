import type { FastifyReply, FastifyRequest } from "fastify";
import { fail } from "@orbyn/core";
import { env } from "../../config/env.js";
import { pdfRequestHeaders } from "./pdf-service.js";

/** Send an already authorized/revision-fenced snapshot; never silently downgrade to plain PDF. */
/** Render a current authorized snapshot as a portable HTML file. */
export async function exportRenderedHtml(
  html: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string> {
  return (await exportRenderedDocument(html, request, reply, "html")).toString(
    "utf8",
  );
}

export async function exportRenderedPdf(
  html: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Buffer> {
  return exportRenderedDocument(html, request, reply, "pdf");
}

export async function compileLatexPdf(
  source: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Buffer> {
  return exportRenderedDocument(source, request, reply, "latex");
}

async function exportRenderedDocument(
  html: string,
  request: FastifyRequest,
  reply: FastifyReply,
  format: "pdf" | "html" | "latex",
): Promise<Buffer> {
  const url = format === "latex" ? env.DOC_LATEX_URL : env.DOC_PDF_URL;
  if (!url || env.DOC_PDF_KEY.length < 32)
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
      `${url.replace(/\/$/, "")}/render${format === "html" ? "/html" : ""}`,
      {
        method: "POST",
        headers: {
          ...pdfRequestHeaders(
            html,
            env.DOC_PDF_KEY,
            Date.now(),
            undefined,
            format,
          ),
          "content-type":
            format === "latex"
              ? "text/plain; charset=utf-8"
              : "text/html; charset=utf-8",
        },
        body: html,
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (
      !response.ok ||
      !response.headers
        .get("content-type")
        ?.startsWith(format !== "html" ? "application/pdf" : "text/html") ||
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
        if (bytes > (format !== "html" ? 24 : 20) * 1024 * 1024)
          throw new Error("PDF result is too large.");
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      await reader.cancel();
    }
    const pdf = Buffer.concat(chunks, bytes);
    if (
      format !== "html"
        ? pdf.subarray(0, 5).toString() !== "%PDF-"
        : !/^<!doctype html>/i.test(pdf.toString("utf8")) ||
          !pdf.toString("utf8").includes('http-equiv="Content-Security-Policy"')
    )
      throw new Error("Invalid document result.");
    return pdf;
  } catch {
    fail(
      503,
      format === "latex"
        ? "Couldn’t compile LaTeX. Check the source or try again shortly."
        : "Document rendering is unavailable. Try again shortly.",
    );
  } finally {
    clearTimeout(timer);
    request.raw.removeListener("aborted", abort);
    reply.raw.removeListener("close", abort);
  }
}

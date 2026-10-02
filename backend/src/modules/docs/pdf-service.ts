import Fastify, { type FastifyRequest } from "fastify";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { renderPdfSnapshot } from "./pdf-renderer.js";

const MAX_HTML = 20 * 1024 * 1024;
const MAX_PDF = 24 * 1024 * 1024;
const WINDOW_MS = 60_000;

/** Sign only the exact authorized snapshot; internal authentication is separate from user sessions. */
export function pdfRequestHeaders(
  html: string,
  key: string,
  now = Date.now(),
  nonce: string = randomUUID(),
) {
  const stamp = String(now);
  const digest = createHash("sha256").update(html).digest("hex");
  const signature = createHmac("sha256", key)
    .update(`orbyn-document-pdf-v1\n${stamp}\n${nonce}\n${digest}`)
    .digest("base64url");
  return {
    "content-type": "text/html; charset=utf-8",
    "x-orbyn-pdf-time": stamp,
    "x-orbyn-pdf-digest": digest,
    "x-orbyn-pdf-nonce": nonce,
    "x-orbyn-pdf-signature": signature,
  };
}

/** Private renderer with no database/provider clients, bounded jobs and replay protection. */
export function buildPdfService({
  key,
  executable,
  limit = 2,
  render = renderPdfSnapshot,
}: {
  key: string;
  executable: string;
  limit?: number;
  render?: typeof renderPdfSnapshot;
}) {
  if (
    key.length < 32 ||
    !executable ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 4
  )
    throw new Error("Document PDF service configuration is incomplete.");
  const app = Fastify({
    bodyLimit: MAX_HTML,
    requestTimeout: 35_000,
    logger: false,
  });
  const seen = new Map<string, number>();
  const reserved = new Set<FastifyRequest>();
  const started = new Set<FastifyRequest>();
  let working = 0;
  const release = (request: FastifyRequest) => {
    if (reserved.delete(request)) working--;
  };
  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url !== "/render") return;
    const stamp = request.headers["x-orbyn-pdf-time"];
    const nonce = request.headers["x-orbyn-pdf-nonce"];
    const digest = request.headers["x-orbyn-pdf-digest"];
    const signature = request.headers["x-orbyn-pdf-signature"];
    if (
      typeof stamp !== "string" ||
      !/^\d{13}$/.test(stamp) ||
      typeof nonce !== "string" ||
      !/^[\w-]{1,80}$/.test(nonce) ||
      typeof digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      typeof signature !== "string" ||
      !/^[\w-]{43}$/.test(signature) ||
      Math.abs(Date.now() - Number(stamp)) > WINDOW_MS
    )
      return reply
        .code(401)
        .send({ message: "PDF request authentication failed." });
    const expected = createHmac("sha256", key)
      .update(`orbyn-document-pdf-v1\n${stamp}\n${nonce}\n${digest}`)
      .digest("base64url");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      return reply
        .code(401)
        .send({ message: "PDF request authentication failed." });
    for (const [id, expiry] of seen) if (expiry < Date.now()) seen.delete(id);
    if (seen.has(nonce))
      return reply
        .code(409)
        .send({ message: "This PDF request was already used." });
    if (working >= limit || seen.size >= 512)
      return reply
        .code(503)
        .header("retry-after", "5")
        .send({ message: "The PDF renderer is busy. Try again shortly." });
    // A signed timestamp may be ahead of this clock. Retain the nonce until
    // the signature itself expires, rather than only one window after receipt.
    seen.set(nonce, Number(stamp) + WINDOW_MS);
    working++;
    reserved.add(request);
  });
  app.addHook("onResponse", async (request) => {
    release(request);
  });
  app.addHook("onError", async (request) => {
    if (!started.has(request)) release(request);
  });
  app.addHook("onRequestAbort", async (request) => {
    if (!started.has(request)) release(request);
  });
  app.addContentTypeParser(
    "text/html",
    { parseAs: "string", bodyLimit: MAX_HTML },
    (_r, body, done) => done(null, body),
  );
  app.get("/health", async () => ({ ok: true }));
  app.post("/render", async (request, reply) => {
    const html = request.body;
    if (
      typeof html !== "string" ||
      createHash("sha256").update(html).digest("hex") !==
        request.headers["x-orbyn-pdf-digest"]
    )
      return reply
        .code(401)
        .send({ message: "PDF request authentication failed." });
    started.add(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once("aborted", abort);
    reply.raw.once("close", abort);
    try {
      const pdf = await render({ html, executable, signal: controller.signal });
      if (controller.signal.aborted) return reply.hijack();
      if (pdf.length > MAX_PDF || pdf.subarray(0, 5).toString() !== "%PDF-")
        throw new Error("Invalid document PDF result.");
      return reply.type("application/pdf").send(pdf);
    } catch {
      if (controller.signal.aborted) return reply.hijack();
      return reply.code(503).send({
        message: "Document PDF rendering is unavailable. Try again shortly.",
      });
    } finally {
      started.delete(request);
      release(request);
      request.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", abort);
    }
  });
  return app;
}

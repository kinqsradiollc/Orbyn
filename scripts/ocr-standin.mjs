#!/usr/bin/env node
// A stand-in for the OCR service, for development and tests: it answers
// POST /ocr like ocr/server.py, with the same kind of Markdown (region
// markers included), without the model. Use it where the real OCR image
// must not be built, such as a development laptop:
//
//   node scripts/ocr-standin.mjs            # listens on 127.0.0.1:8098
//   OCR_URL=http://127.0.0.1:8098 npm run dev:converter -w backend
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8098);
const PAGE = [
  "<|ref|>header<|/ref|><|det|>[[40,20,960,50]]<|/det|>Stand-in OCR",
  "<|ref|>title<|/ref|><|det|>[[60,80,900,140]]<|/det|># Scanned page",
  "<|ref|>text<|/ref|><|det|>[[60,160,900,260]]<|/det|>This text comes from the stand-in OCR service, not the real model.",
  "<|ref|>table<|/ref|><|det|>[[60,280,900,400]]<|/det|><table><tr><td>Term</td><td>Meaning</td></tr><tr><td>OCR</td><td>Reading text from an image</td></tr></table>",
  "<|ref|>equation<|/ref|><|det|>[[60,420,900,480]]<|/det|>\\[ E = mc^2 \\]",
  "<|ref|>page_number<|/ref|><|det|>[[480,960,520,990]]<|/det|>1",
].join("\n");

createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health")
    return send(200, { status: "ok", service: "ocr-standin" });
  if (req.method !== "POST" || req.url !== "/ocr")
    return send(404, { message: "Not found" });
  let bytes = 0;
  req.on("data", (chunk) => (bytes += chunk.length));
  req.on("end", () => send(200, { markdown: PAGE, ms: 5, bytes }));
}).listen(port, "127.0.0.1", () =>
  console.log(`Stand-in OCR on http://127.0.0.1:${port}`),
);

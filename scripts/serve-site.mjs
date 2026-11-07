#!/usr/bin/env node
// Serves dist/ locally the way production does: folders map to index.html,
// /booking/* answers with booking/404.html, anything else missing with 404.html.
//   node scripts/serve-site.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4321);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

async function file(p) {
  try { const s = await stat(p); return s.isDirectory() ? file(join(p, "index.html")) : p; } catch { return null; }
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (/^\/(apps|download|pricing|security|planner|notes|studio|engineering)$/.test(path)) {
    res.writeHead(301, { Location: path + "/" }); return res.end();
  }
  let found = path.startsWith("/_headers") ? null : await file(join(dist, path));
  let status = 200;
  if (!found) {
    status = 404;
    found = /^\/booking(\/|$)/.test(path) ? join(dist, "booking/404.html") : join(dist, "404.html");
  }
  try {
    const data = await readFile(found);
    res.writeHead(status, { "Content-Type": TYPES[extname(found)] || "application/octet-stream" });
    res.end(data);
  } catch {
    // dist/ is being rebuilt; answer instead of crashing.
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("dist/ is being rebuilt; reload in a moment.\n");
  }
}).listen(port, () => console.log(`orbyn.dev on http://localhost:${port}`));

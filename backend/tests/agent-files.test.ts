import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import type { DocBlock } from "@orbyn/core";
import { helpers, type Person } from "./mcp-helpers.js";

/**
 * H2: add_file. An agent sends a file in the call (base64); Orbyn types it
 * from its bytes, keeps it in its own file store (running in this process
 * on a real port, as in production) as a picture or file line on a page or
 * as the page's original, within 25 MB a file and 500 MB a person a day
 * and the person's spaces, and undo removes it. The only request that
 * leaves the mcp code is to the file store.
 */

const dir = await mkdtemp(join(tmpdir(), "orbyn-agent-files-test-"));
process.env.FILES_SECRET = "test-files-secret-0123456789abcdef";
process.env.FILES_DIR = dir;
process.env.FILES_MIN_FREE_MB = "0";
process.env.OCR_URL = "";
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { zip } = await import("../src/modules/docs/zip.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");

const app = await buildApp();
const h = helpers(app);

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const outside: string[] = [];
const realFetch = globalThis.fetch;

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}

const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const idOf = (typed: string) =>
  typed.replace(/^[\w]+:(\/\/\w+\/)?/, "").slice(0, 36);
const content = async (id: string) =>
  (await pool.query("SELECT content FROM docs WHERE id = $1", [id])).rows[0]
    .content as DocBlock[];
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 7),
]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const PPTX = zip([
  { name: "ppt/presentation.xml", body: "<p:presentation/>" },
  { name: "[Content_Types].xml", body: "<Types/>" },
]);

async function newPage(key: string, title: string, team?: string) {
  const made = ok(
    await tool(key, "create_doc", {
      title,
      markdown: "First line ^bone\n\nSecond line ^btwo",
      ...(team ? { team } : {}),
    }),
    "create_doc",
  );
  return idOf(made.done[0].id);
}

before(async () => {
  await migrate();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  env.FILES_URL = `http://127.0.0.1:${port}`;
  // Nothing but the file store may be reached.
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(env.FILES_URL)) {
      outside.push(url);
      throw new Error("Only the file store may be reached.");
    }
    return realFetch(url, init);
  }) as typeof fetch;
  olga = await h.register("af-olga", "Olga");
  mo = await h.register("af-mo", "Mo");
  crew = await h.team(olga, "Crew", [[mo, "member"]]);
  const sets = ["core", "files"];
  for (const [name, who, body] of [
    ["write", olga, { access: "write", team_ids: [crew], toolsets: sets }],
    ["suggest", olga, { access: "suggest", toolsets: sets }],
    ["read", olga, { access: "read", toolsets: sets }],
    ["mo", mo, { access: "write", team_ids: [crew], toolsets: sets }],
  ] as const) {
    keys[name] = (await h.agentKey(who, body)).key;
  }
});

after(async () => {
  globalThis.fetch = realFetch;
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

test("add_file: a picture line, stored encrypted in Orbyn's own file store", async () => {
  const doc = await newPage(keys.write, "Lab photos");
  const r = ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "gel.png",
      content: b64(PNG),
      caption: "The gel after 40 minutes",
    }),
    "add_file",
  );
  assert.equal(r.type, "image/png");
  assert.equal(r.bytes, PNG.length);
  const fileId = idOf(r.file);
  const lines = await content(doc);
  const last = lines[lines.length - 1] as {
    type: string;
    file: string;
    text: string;
  };
  assert.deepEqual(
    [last.type, last.file, last.text],
    ["image", fileId, "The gel after 40 minutes"],
  );
  assert.equal(r.doc, `doc:${doc}#${lines[lines.length - 1].id}`);
  const row = (
    await pool.query("SELECT * FROM page_files WHERE id = $1", [fileId])
  ).rows[0];
  assert.equal(row.source, "agent");
  assert.equal(row.status, "ready");
  assert.equal(row.user_id, olga.id);
  // The bytes are on disk, encrypted, in the page files' folder.
  const stored = await readdir(join(dir, "pages"));
  assert.ok(
    stored.includes(`${fileId}.bin`) && stored.includes(`${fileId}.key`),
  );
  // The person sees it in the page's files, and can read it back whole.
  const files = (await h.call(olga.token, "GET", `/docs/${doc}/files`)).json();
  assert.ok(files.some((f: { id: string }) => f.id === fileId));
  const link = (
    await h.call(olga.token, "GET", `/docs/files/${fileId}`)
  ).json();
  const back = await app.inject({ method: "GET", url: link.url_path });
  assert.equal(back.statusCode, 200);
  assert.deepEqual(back.rawPayload, PNG);
  // fetch shows the line as a picture from Orbyn.
  const page = ok(await tool(keys.write, "fetch", { id: `doc:${doc}` }));
  assert.match(
    page.text,
    new RegExp(`!\\[The gel after 40 minutes\\]\\(orbyn://file/${fileId}\\)`),
  );
  assert.deepEqual(outside, []);
});

test("add_file: a file card after a given line, typed from its bytes", async () => {
  const doc = await newPage(keys.write, "Slides");
  const r = ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "Lecture 5.pptx",
      content: b64(PPTX),
      after: "^bone",
    }),
  );
  assert.match(r.type, /presentationml/);
  const lines = await content(doc);
  assert.deepEqual(
    lines.map((b) => b.type),
    ["paragraph", "file", "paragraph"],
  );
  assert.equal((lines[1] as { text: string }).text, "Lecture 5.pptx");
  // Text and PDFs too; a name without an extension is fine.
  ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "notes.md",
      content: b64("# Notes\n"),
    }),
  );
  ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "reading",
      content: b64(PDF),
    }),
  );
  const missing = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "a.pdf",
    content: b64(PDF),
    after: "^bnope",
  });
  assert.equal(code(missing), "INVALID");
});

test("add_file: what a file is comes from its bytes; the wrong kind is refused and nothing kept", async () => {
  const doc = await newPage(keys.write, "Refusals");
  const before = (
    await pool.query(
      "SELECT count(*)::int AS n FROM page_files WHERE doc_id = $1",
      [doc],
    )
  ).rows[0].n;
  const cases: [string, Buffer | string][] = [
    ["slides.pdf", PNG], // a picture named as a PDF
    [
      "old.doc",
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
    ],
    ["marks.xlsx", zip([{ name: "xl/workbook.xml", body: "<w/>" }])],
    ["song.mp3", Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0])],
    ["essay.docx", "just some words"],
  ];
  for (const [name, body] of cases) {
    const r = await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name,
      content: b64(body),
    });
    assert.equal(code(r), "INVALID", name);
  }
  const bad = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "x.png",
    content: "not base64!",
  });
  assert.equal(code(bad), "INVALID");
  const empty = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "x.txt",
    content: "",
  });
  assert.equal(code(empty), "INVALID");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM page_files WHERE doc_id = $1",
        [doc],
      )
    ).rows[0].n,
    before,
  );
});

test("add_file: 25 MB a file, 500 MB a day, and the person's space", async () => {
  const doc = await newPage(keys.write, "Big ones");
  // One byte over 25 MB (a PDF by its first bytes).
  const huge = Buffer.alloc(25 * 1024 * 1024 + 1, 0x20);
  PDF.copy(huge);
  const over = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "big.pdf",
    content: b64(huge),
  });
  assert.equal(code(over), "INVALID");
  assert.match(over.content[0].text, /at most 25 MB/);
  // What agents sent today counts toward 500 MB.
  await pool.query(
    `INSERT INTO agent_file_days (user_id, day, bytes) VALUES ($1, current_date, $2)
     ON CONFLICT (user_id, day) DO UPDATE SET bytes = EXCLUDED.bytes`,
    [olga.id, 500 * 1024 * 1024 - 100],
  );
  const day = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "gel.png",
    content: b64(PNG),
  });
  assert.equal(code(day), "LIMITED");
  assert.match(day.content[0].text, /500 MB a day/);
  await pool.query("DELETE FROM agent_file_days WHERE user_id = $1", [olga.id]);
  ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "gel.png",
      content: b64(PNG),
    }),
  );
  const counted = (
    await pool.query(
      "SELECT bytes::int AS b FROM agent_file_days WHERE user_id = $1 AND day = current_date",
      [olga.id],
    )
  ).rows[0].b;
  assert.equal(counted, PNG.length);
  // The person's space for pictures and files, and for originals.
  const filler = (
    await pool.query(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
       VALUES ($1, $2, 'filler.pdf', 'application/pdf', 'file', $3, 'ready') RETURNING id`,
      [olga.id, doc, env.PAGE_FILES_QUOTA_MB * 1024 * 1024],
    )
  ).rows[0].id;
  const full = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "gel.png",
    content: b64(PNG),
  });
  assert.equal(code(full), "LIMITED");
  assert.match(full.content[0].text, /space for pictures and files is full/);
  await pool.query("DELETE FROM page_files WHERE id = $1", [filler]);
});

test("add_file: kept as a page's original, downloadable, one per page", async () => {
  const doc = await newPage(keys.write, "Reading pack");
  const r = ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "pack.pdf",
      content: b64(PDF),
      keep: "original",
    }),
  );
  assert.equal(r.version, null);
  const kept = (
    await pool.query("SELECT * FROM kept_files WHERE doc_id = $1", [doc])
  ).rows[0];
  assert.equal(kept.file_type, "pdf");
  assert.equal(Number(kept.bytes), PDF.length);
  // The page's lines are unchanged; the page shows its original.
  assert.deepEqual(
    (await content(doc)).map((b) => b.type),
    ["paragraph", "paragraph"],
  );
  const opened = (await h.call(olga.token, "GET", `/docs/${doc}`)).json();
  assert.equal(opened.original.file_name, "pack.pdf");
  const download = await h.call(olga.token, "GET", `/docs/${doc}/original`);
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, PDF);
  const second = await tool(keys.write, "add_file", {
    doc: `doc:${doc}`,
    name: "other.pdf",
    content: b64(PDF),
    keep: "original",
  });
  assert.equal(code(second), "INVALID");
  // Originals have their own space.
  await pool.query(
    `INSERT INTO kept_files (id, user_id, doc_id, file_name, file_type, bytes)
     VALUES (gen_random_uuid(), $1, $2, 'filler.pdf', 'pdf', $3)`,
    [
      olga.id,
      await newPage(keys.write, "Filler"),
      env.FILES_KEEP_QUOTA_MB * 1024 * 1024,
    ],
  );
  const full = await tool(keys.write, "add_file", {
    doc: `doc:${await newPage(keys.write, "Another")}`,
    name: "pack.pdf",
    content: b64(PDF),
    keep: "original",
  });
  assert.equal(code(full), "LIMITED");
  await pool.query(
    "DELETE FROM kept_files WHERE user_id = $1 AND file_name = 'filler.pdf'",
    [olga.id],
  );
});

test("add_file: undo removes the line and the file, or the original", async () => {
  const doc = await newPage(keys.write, "Undo files");
  const line = ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "gel.png",
      content: b64(PNG),
    }),
  );
  const lineChange = ok(
    await tool(keys.write, "list_agent_changes", { limit: 1 }),
  ).changes[0];
  assert.equal(lineChange.tool, "add_file");
  ok(await tool(keys.write, "undo", { change: lineChange.id }), "undo line");
  assert.deepEqual(
    (await content(doc)).map((b) => b.type),
    ["paragraph", "paragraph"],
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM page_files WHERE id = $1", [
        idOf(line.file),
      ])
    ).rowCount,
    0,
  );
  ok(
    await tool(keys.write, "add_file", {
      doc: `doc:${doc}`,
      name: "pack.pdf",
      content: b64(PDF),
      keep: "original",
    }),
  );
  const keptChange = ok(
    await tool(keys.write, "list_agent_changes", { limit: 1 }),
  ).changes[0];
  ok(
    await tool(keys.write, "undo", { change: keptChange.id }),
    "undo original",
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM kept_files WHERE doc_id = $1", [doc]))
      .rowCount,
    0,
  );
});

test("add_file: never waits for review; reads, suggestions and a teammate's page are refused", async () => {
  const mine = await newPage(keys.write, "Mine");
  assert.equal(
    code(
      await tool(keys.read, "add_file", {
        doc: `doc:${mine}`,
        name: "a.png",
        content: b64(PNG),
      }),
    ),
    "FORBIDDEN",
  );
  assert.equal(
    code(
      await tool(keys.suggest, "add_file", {
        doc: `doc:${mine}`,
        name: "a.png",
        content: b64(PNG),
      }),
    ),
    "FORBIDDEN",
  );
  // Mo's page in the team is a teammate's work: it would need Olga's yes.
  const theirs = await newPage(keys.mo, "Mo's team page", crew);
  const teammate = await tool(keys.write, "add_file", {
    doc: `doc:${theirs}`,
    name: "a.png",
    content: b64(PNG),
  });
  assert.equal(code(teammate), "FORBIDDEN");
  // A page this connection can't reach is simply not found.
  const hidden = (
    await h.call(mo.token, "POST", "/docs", { title: "Mo's own" })
  ).json().id;
  assert.equal(
    code(
      await tool(keys.write, "add_file", {
        doc: `doc:${hidden}`,
        name: "a.png",
        content: b64(PNG),
      }),
    ),
    "NOT_FOUND",
  );
  assert.deepEqual(outside, []);
});

test("the file store's agent route is for services only", async () => {
  const put = (headers: Record<string, string>) =>
    app.inject({
      method: "PUT",
      url: "/internal/agent-files/page/00000000-0000-4000-8000-000000000001",
      headers: { "content-type": "application/octet-stream", ...headers },
      payload: PNG,
    });
  assert.equal((await put({})).statusCode, 403);
  const { serviceKey } = await import("../src/modules/imports/tokens.js");
  const bad = await put({
    "x-orbyn-service": serviceKey(),
    "x-orbyn-type": "application/pdf",
  });
  assert.equal(bad.statusCode, 415);
  const odd = await put({
    "x-orbyn-service": serviceKey(),
    "x-orbyn-type": "application/zip",
  });
  assert.equal(odd.statusCode, 415);
});

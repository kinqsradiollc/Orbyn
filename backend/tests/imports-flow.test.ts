import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Importing, end to end: an upload link, the upload through the file store,
 * the converter reading a Word file and a PDF, the page landing in
 * Uploads, the file deleted, and what Admin → Storage and the apps are told.
 * The file store runs in this process on a real port, as the converter
 * reaches it over HTTP in production.
 */
const dir = await mkdtemp(join(tmpdir(), "orbyn-files-test-"));
process.env.FILES_SECRET = "test-files-secret-0123456789abcdef";
process.env.FILES_DIR = dir;
process.env.OCR_URL = "";
// This machine's disk may be nearly full; the space guard is tested apart.
process.env.FILES_MIN_FREE_MB = "0";
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { zip } = await import("../src/modules/docs/zip.js");
const { convertPending } = await import("../src/modules/imports/converter.js");
const app = await buildApp();
let caller = 0;
const address = () => `10.17.${Math.floor(++caller / 250)}.${caller % 250}`;

async function call(
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: r.statusCode, body: r.body ? (r.json() as any) : null };
}

async function person(admin = false) {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: address(),
    payload: {
      email: `import-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: admin ? "Admin" : "Student",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const { token, user } = r.json();
  if (admin)
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
      user.id,
    ]);
  return { token: token as string, id: user.id as string };
}

async function upload(token: string, name: string, body: Buffer, mime: string) {
  const start = await call(token, "POST", "/imports", {
    file_name: name,
    bytes: body.length,
    mime,
  });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const put = await app.inject({
    method: "PUT",
    url: start.body.upload_path,
    remoteAddress: address(),
    headers: { "content-type": mime },
    payload: body,
  });
  assert.equal(put.statusCode, 201, put.body);
  return start.body.import.id as string;
}

before(async () => {
  await migrate();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  env.FILES_URL = `http://127.0.0.1:${port}`;
});

after(async () => {
  await app.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
function wordFile() {
  const p = (t: string, style = "") =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${t}</w:t></w:r></w:p>`;
  return zip([
    {
      name: "word/document.xml",
      body: `<w:document ${W}><w:body>${p("Consensus", "Title")}${p("Raft elects a leader.")}<w:p><m:oMathPara><m:oMath><m:f><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara></w:p>${p("Quorum :: A majority of servers")}</w:body></w:document>`,
    },
    {
      name: "word/styles.xml",
      body: `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`,
    },
  ]);
}

test("a Word file becomes a page in Uploads, with its equation, and the file is deleted", async () => {
  const me = await person();
  const id = await upload(
    me.token,
    "week6.docx",
    wordFile(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  await convertPending();
  const job = (await call(me.token, "GET", `/imports/${id}`)).body;
  assert.equal(job.status, "ready", JSON.stringify(job));
  const doc = (await call(me.token, "GET", `/docs/${job.doc_id}`)).body;
  assert.equal(doc.title, "Consensus");
  assert.equal(doc.in_uploads, true);
  assert.equal(doc.imported_from.file_name, "week6.docx");
  assert.ok(
    doc.content.some(
      (b: { type: string; text?: string }) =>
        b.type === "math" && b.text === "\\frac{n}{2}",
    ),
  );
  // The file is gone from the store, and the import no longer points at one.
  const row = (
    await pool.query("SELECT object_id FROM imports WHERE id = $1", [id])
  ).rows[0];
  assert.equal(row.object_id, null);
  // Filing it takes it out of Uploads.
  const moved = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: doc.version,
    folder_id: null,
  });
  assert.equal(moved.body.in_uploads, false);
  // The page's card is in Study.
  const study = (await call(me.token, "GET", "/study")).body;
  assert.ok(study.decks.some((d: { doc_id: string }) => d.doc_id === doc.id));
  assert.equal(study.forecast.length, 7);
  assert.equal(job.doc_in_trash, false);
  // With its page in Trash the job has nothing to open, and says why.
  assert.equal((await call(me.token, "DELETE", `/docs/${doc.id}`)).status, 204);
  const trashed = (await call(me.token, "GET", `/imports/${id}`)).body;
  assert.equal(trashed.doc_id, null);
  assert.equal(trashed.doc_in_trash, true);
  const { importStatusLine } = await import("@orbyn/core");
  assert.equal(importStatusLine(trashed), "Ready · the page is in Trash");
  const listed = (await call(me.token, "GET", "/imports")).body;
  const inList = listed.find((j: { id: string }) => j.id === id);
  assert.equal(inList.doc_id, null);
  // Restored, it opens again.
  await call(me.token, "POST", `/docs/${doc.id}/restore`);
  const back = (await call(me.token, "GET", `/imports/${id}`)).body;
  assert.equal(back.doc_id, doc.id);
  assert.equal(back.doc_in_trash, false);
});

test("a PDF's own text is read without OCR; a wrong file type is refused", async () => {
  const me = await person();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 3; n++) {
    const page = pdf.addPage([595, 842]);
    page.drawText("COMP3100 Distributed Systems", {
      x: 50,
      y: 810,
      size: 9,
      font,
    });
    page.drawText(`Part ${n}`, { x: 50, y: 760, size: 22, font: bold });
    page.drawText("Servers agree on one value through a leader.", {
      x: 50,
      y: 720,
      size: 11,
      font,
    });
  }
  const id = await upload(
    me.token,
    "notes.pdf",
    Buffer.from(await pdf.save()),
    "application/pdf",
  );
  await convertPending();
  const job = (await call(me.token, "GET", `/imports/${id}`)).body;
  assert.equal(job.status, "ready", JSON.stringify(job));
  const doc = (await call(me.token, "GET", `/docs/${job.doc_id}`)).body;
  const text = doc.content
    .map((b: { text?: string }) => b.text ?? "")
    .join("\n");
  assert.doesNotMatch(text, /COMP3100/);
  assert.match(text, /Servers agree on one value/);

  // A text file named .pdf: refused by the file store.
  const start = await call(me.token, "POST", "/imports", {
    file_name: "fake.pdf",
    bytes: 5,
    mime: "application/pdf",
  });
  const put = await app.inject({
    method: "PUT",
    url: start.body.upload_path,
    remoteAddress: address(),
    headers: { "content-type": "application/pdf" },
    payload: Buffer.from("hello"),
  });
  assert.equal(put.statusCode, 415);
});

test("capabilities and Admin → Storage describe the server; files can be deleted by an admin", async () => {
  const admin = await person(true);
  const me = await person();
  await convertPending();
  const caps = (await call(me.token, "GET", "/imports/capabilities")).body;
  assert.equal(caps.enabled, true);
  assert.ok(["tesseract", "none"].includes(caps.scans));
  assert.equal(caps.photos, caps.scans === "tesseract");

  // A file waiting in the store (uploaded, not yet converted).
  const id = await upload(
    me.token,
    "later.docx",
    wordFile(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const denied = await call(me.token, "GET", "/admin/storage");
  assert.equal(denied.status, 403);
  const view = (await call(admin.token, "GET", "/admin/storage")).body;
  assert.equal(view.files.reachable, true);
  assert.ok(view.database.bytes > 0);
  const stored = view.stored.find(
    (f: { import_id: string }) => f.import_id === id,
  );
  assert.ok(stored, "the waiting file is listed");
  assert.equal(stored.owner_id, me.id);
  const del = await call(admin.token, "DELETE", `/admin/storage/files/${id}`);
  assert.equal(del.status, 204);
  const job = (await call(me.token, "GET", `/imports/${id}`)).body;
  assert.equal(job.status, "cancelled");
  const audit = (
    await pool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'storage.file_deleted' AND target_id = $1",
      [id],
    )
  ).rows[0].n;
  assert.equal(audit, 1);
  const sweep = await call(admin.token, "POST", "/admin/storage/sweep", {});
  assert.equal(sweep.status, 200);
});

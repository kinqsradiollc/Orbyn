import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * "Keep the original": the setting, an import that keeps its file in the
 * file store's kept/ folder, downloading and deleting it, the quota, the
 * export, and the sweep once its page is deleted for good. The file store
 * runs in this process on a real port, as in production.
 */
const dir = await mkdtemp(join(tmpdir(), "orbyn-originals-test-"));
process.env.FILES_SECRET = "test-files-secret-0123456789abcdef";
process.env.FILES_DIR = dir;
process.env.OCR_URL = "";
process.env.FILES_MIN_FREE_MB = "0";
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { zip } = await import("../src/modules/docs/zip.js");
const { convertPending } = await import("../src/modules/imports/converter.js");
const { sweepKept, keptDir } = await import("../src/modules/imports/store.js");
const app = await buildApp();
let caller = 0;
const address = () => `10.19.${Math.floor(++caller / 250)}.${caller % 250}`;

async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  let body: any = null;
  try {
    body = r.body ? r.json() : null;
  } catch {
    body = r.rawPayload;
  }
  return { status: r.statusCode, body, raw: r };
}

async function person() {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: address(),
    payload: {
      email: `orig-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Keeper",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const { token, user } = r.json();
  return { token: token as string, id: user.id as string };
}

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
function wordFile(title: string) {
  return zip([
    {
      name: "word/document.xml",
      body: `<w:document ${W}><w:body><w:p><w:r><w:t>${title}</w:t></w:r></w:p><w:p><w:r><w:t>Some words in it.</w:t></w:r></w:p></w:body></w:document>`,
    },
  ]);
}

async function importWord(token: string, name: string, keep?: boolean) {
  const body = wordFile(name.replace(/\.docx$/, ""));
  const start = await call(token, "POST", "/imports", {
    file_name: name,
    bytes: body.length,
    mime: DOCX,
    ...(keep === undefined ? {} : { keep_original: keep }),
  });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const put = await app.inject({
    method: "PUT",
    url: start.body.upload_path,
    remoteAddress: address(),
    headers: { "content-type": DOCX },
    payload: body,
  });
  assert.equal(put.statusCode, 201, put.body);
  await convertPending();
  const job = (await call(token, "GET", `/imports/${start.body.import.id}`))
    .body;
  assert.equal(job.status, "ready", JSON.stringify(job));
  return { job, bytes: body };
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

test("the setting is off by default and each person's own", async () => {
  const me = await person();
  assert.equal((await call(null, "GET", "/me/originals")).status, 401);
  const first = (await call(me.token, "GET", "/me/originals")).body;
  assert.equal(first.keep, false);
  assert.equal(first.used_bytes, 0);
  assert.equal(first.quota_bytes, env.FILES_KEEP_QUOTA_MB * 1024 * 1024);
  assert.equal(
    (await call(me.token, "PUT", "/me/originals", { keep: "yes" })).status,
    422,
  );
  const on = await call(me.token, "PUT", "/me/originals", { keep: true });
  assert.equal(on.status, 200);
  assert.equal((await call(me.token, "GET", "/me/originals")).body.keep, true);
});

test("the setting: a personal API key may read it but not change it, and 429 past the limit", async () => {
  const me = await person();
  const made = await call(me.token, "POST", "/me/api-keys", { name: "Script" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const key = made.body.key as string;
  assert.ok(key.startsWith("ok_"));
  assert.equal((await call(key, "GET", "/me/originals")).status, 200);
  assert.equal(
    (await call(key, "PUT", "/me/originals", { keep: true })).status,
    403,
  );
  assert.equal((await call(me.token, "GET", "/me/originals")).body.keep, false);

  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(me.token);
  live.rate_limit_per_minute = 1;
  const from = () =>
    app.inject({
      method: "PUT",
      url: "/me/originals",
      remoteAddress: "10.19.250.1",
      headers: { authorization: `Bearer ${limitedToken}` },
      payload: { keep: true },
    });
  try {
    assert.notEqual((await from()).statusCode, 429);
    assert.equal((await from()).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});

test("without it, an import's file is deleted as before", async () => {
  const me = await person();
  const { job } = await importWord(me.token, "plain.docx");
  const doc = (await call(me.token, "GET", `/docs/${job.doc_id}`)).body;
  assert.equal(doc.original, null);
  assert.equal(
    (await call(me.token, "GET", `/docs/${job.doc_id}/original`)).status,
    404,
  );
});

test("kept, the original downloads for whoever can open the page, and can be deleted", async () => {
  const me = await person();
  const outsider = await person();
  const { job, bytes } = await importWord(me.token, "lecture.docx", true);
  const doc = (await call(me.token, "GET", `/docs/${job.doc_id}`)).body;
  assert.equal(doc.original.file_name, "lecture.docx");
  assert.equal(Number(doc.original.bytes), bytes.length);
  // In the kept folder, not where the day-long uploads wait.
  assert.ok((await readdir(keptDir())).some((n) => n.endsWith(".bin")));
  const got = await call(me.token, "GET", `/docs/${job.doc_id}/original`);
  assert.equal(got.status, 200);
  assert.match(
    String(got.raw.headers["content-disposition"]),
    /attachment; filename="lecture\.docx"/,
  );
  assert.deepEqual(Buffer.from(got.raw.rawPayload), bytes);
  // Someone who can't open the page learns nothing about it.
  assert.equal(
    (await call(outsider.token, "GET", `/docs/${job.doc_id}/original`)).status,
    404,
  );
  assert.equal(
    (await call(outsider.token, "DELETE", `/docs/${job.doc_id}/original`))
      .status,
    404,
  );
  const overview = (await call(me.token, "GET", "/me/originals")).body;
  assert.equal(overview.files.length, 1);
  assert.equal(overview.used_bytes, bytes.length);
  // It comes with the export.
  const exported = await call(me.token, "GET", "/me/export.zip");
  assert.equal(exported.status, 200);
  assert.ok(
    Buffer.from(exported.raw.rawPayload)
      .toString("latin1")
      .includes("originals/lecture.docx"),
  );
  // Deleted on its own, the page stays.
  assert.equal(
    (await call(me.token, "DELETE", `/docs/${job.doc_id}/original`)).status,
    204,
  );
  assert.equal(
    (await call(me.token, "GET", `/docs/${job.doc_id}`)).body.original,
    null,
  );
  assert.equal(
    (await call(me.token, "GET", "/me/originals")).body.files.length,
    0,
  );
});

test("an original goes when its page is deleted for good, and the quota is kept", async () => {
  const me = await person();
  const { job } = await importWord(me.token, "notes.docx", true);
  const kept = (
    await pool.query<{ id: string }>(
      "SELECT id FROM kept_files WHERE doc_id = $1",
      [job.doc_id],
    )
  ).rows[0];
  assert.ok(kept);
  // Purged from Trash: the row loses its page, and the sweep removes both.
  await pool.query("DELETE FROM docs WHERE id = $1", [job.doc_id]);
  await pool.query(
    "UPDATE kept_files SET created_at = now() - interval '2 hours' WHERE id = $1",
    [kept.id],
  );
  await sweepKept();
  assert.equal(
    (await pool.query("SELECT 1 FROM kept_files WHERE id = $1", [kept.id]))
      .rowCount,
    0,
  );
  assert.ok(
    !(await readdir(keptDir())).some((n) => n.startsWith(kept.id)),
    "the file is gone",
  );

  // Over the quota the page is still made, and says the original wasn't kept.
  const before = env.FILES_KEEP_QUOTA_MB;
  env.FILES_KEEP_QUOTA_MB = 0;
  try {
    const { job: full } = await importWord(me.token, "big.docx", true);
    assert.ok(
      full.notes.some((n: string) => /original wasn't kept/.test(n)),
      JSON.stringify(full.notes),
    );
    assert.equal(
      (
        await pool.query("SELECT 1 FROM kept_files WHERE doc_id = $1", [
          full.doc_id,
        ])
      ).rowCount,
      0,
    );
  } finally {
    env.FILES_KEEP_QUOTA_MB = before;
  }
});

test("the file store's own routes refuse anyone but its services", async () => {
  const id = randomUUID();
  const r = await app.inject({
    method: "GET",
    url: `/internal/kept/${id}`,
    remoteAddress: address(),
  });
  assert.equal(r.statusCode, 403);
  const keep = await app.inject({
    method: "POST",
    url: `/internal/files/${id}/keep`,
    remoteAddress: address(),
  });
  assert.equal(keep.statusCode, 403);
});

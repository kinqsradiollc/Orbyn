import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { access, mkdtemp, rm } from "node:fs/promises";
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
process.env.PLUGIN_PUBLIC_URL = "https://plugin-import.example.test/api";
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { zip } = await import("../src/modules/docs/zip.js");
const { convertPending } = await import("../src/modules/imports/converter.js");
const { buildPluginService } = await import("../src/app.js");
const { digest } = await import("../src/lib/auth.js");
const { objectPaths } = await import("../src/modules/imports/store.js");
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

async function upload(
  token: string,
  name: string,
  body: Buffer,
  mime: string,
  projectId?: string,
) {
  const start = await call(token, "POST", "/imports", {
    file_name: name,
    bytes: body.length,
    mime,
    ...(projectId ? { project_id: projectId } : {}),
    ...(projectId ? { project_team_id: null } : {}),
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

test("a project import becomes a project page with file history, and outsiders cannot target it", async () => {
  const owner = await person();
  const outsider = await person();
  const created = await call(owner.token, "POST", "/projects", {
    name: "Research",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.id as string;
  const denied = await call(outsider.token, "POST", "/imports", {
    file_name: "week6.docx",
    bytes: wordFile().length,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    project_id: projectId,
    project_team_id: null,
  });
  assert.equal(denied.status, 404);
  const changedTeam = await call(owner.token, "POST", "/imports", {
    file_name: "week6.docx",
    bytes: wordFile().length,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    project_id: projectId,
    project_team_id: randomUUID(),
  });
  assert.equal(changedTeam.status, 409);

  const id = await upload(
    owner.token,
    "week6.docx",
    wordFile(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    projectId,
  );
  await convertPending();
  const job = (await call(owner.token, "GET", `/imports/${id}`)).body;
  assert.equal(job.status, "ready", JSON.stringify(job));
  const doc = (await call(owner.token, "GET", `/docs/${job.doc_id}`)).body;
  assert.equal(doc.project_id, projectId);
  assert.equal(doc.in_uploads, false);
  const history = (
    await call(owner.token, "GET", `/projects/${projectId}/activity`)
  ).body;
  assert.ok(
    history.some(
      (event: { summary: string; entity_id: string }) =>
        event.entity_id === doc.id &&
        event.summary === `File added: ${doc.title}`,
    ),
  );
  const row = (
    await pool.query("SELECT object_id FROM imports WHERE id = $1", [id])
  ).rows[0];
  assert.equal(row.object_id, null);
});

test("Keep the original: one mechanism, the account setting with a per-import override", async () => {
  const owner = await person();
  const outsider = await person();
  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // Reuse the uploaded bytes: ZIP headers contain their creation time.
  const originalBytes = wordFile();
  const importWord = async (name: string, keep?: boolean) => {
    const start = await call(owner.token, "POST", "/imports", {
      file_name: name,
      bytes: originalBytes.length,
      mime: DOCX,
      ...(keep === undefined ? {} : { keep_original: keep }),
    });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    const put = await app.inject({
      method: "PUT",
      url: start.body.upload_path,
      remoteAddress: address(),
      headers: { "content-type": DOCX },
      payload: originalBytes,
    });
    assert.equal(put.statusCode, 201, put.body);
    await convertPending();
    const job = (
      await call(owner.token, "GET", `/imports/${start.body.import.id}`)
    ).body;
    assert.equal(job.status, "ready", JSON.stringify(job));
    return (await call(owner.token, "GET", `/docs/${job.doc_id}`)).body;
  };

  // Chosen for one import: kept as the page's original, not as a page file.
  const doc = await importWord("week7.docx", true);
  assert.equal(doc.original?.file_name, "week7.docx", JSON.stringify(doc));
  assert.equal(doc.imported_from.original_file, undefined);
  const files = await call(owner.token, "GET", `/docs/${doc.id}/files`);
  assert.equal(files.status, 200, JSON.stringify(files.body));
  assert.equal(files.body.length, 0);
  const got = await app.inject({
    method: "GET",
    url: `/docs/${doc.id}/original`,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${owner.token}` },
  });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.rawPayload, originalBytes);
  assert.match(String(got.headers["content-disposition"]), /^attachment;/);
  // Someone who can't read the page can't read its original.
  assert.equal(
    (await call(outsider.token, "GET", `/docs/${doc.id}/original`)).status,
    404,
  );
  // The second path is gone from the file store.
  const oldRoute = await app.inject({
    method: "POST",
    url: `/internal/files/${randomUUID()}/keep-in-page`,
    remoteAddress: address(),
  });
  assert.equal(oldRoute.statusCode, 404);

  // Left unchosen with the setting off, nothing is kept.
  assert.equal((await importWord("week8.docx")).original, null);

  // With the account setting on, an import keeps its file unasked…
  assert.equal(
    (await call(owner.token, "PUT", "/me/originals", { keep: true })).status,
    200,
  );
  assert.equal(
    (await importWord("week9.docx")).original?.file_name,
    "week9.docx",
  );
  // …unless that import says not to.
  assert.equal((await importWord("week10.docx", false)).original, null);
  const overview = (await call(owner.token, "GET", "/me/originals")).body;
  assert.deepEqual(
    overview.files.map((f: { file_name: string }) => f.file_name).sort(),
    ["week7.docx", "week9.docx"],
  );
});

test("conversion fails closed if the project disappears after upload", async () => {
  const owner = await person();
  const created = await call(owner.token, "POST", "/projects", {
    name: "Temporary project",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.id as string;
  const id = await upload(
    owner.token,
    "week6.docx",
    wordFile(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    projectId,
  );
  const removed = await call(owner.token, "DELETE", `/projects/${projectId}`);
  assert.equal(removed.status, 204, JSON.stringify(removed.body));
  await convertPending();
  const job = (await call(owner.token, "GET", `/imports/${id}`)).body;
  assert.equal(job.status, "failed");
  assert.equal(job.doc_id, null);
  assert.match(job.error, /Nothing was shared/);
  const row = (
    await pool.query("SELECT object_id FROM imports WHERE id = $1", [id])
  ).rows[0];
  assert.equal(row.object_id, null);
});

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

test("real plugin Word conversion rechecks producer authority before saving a page", async () => {
  const plugin = await buildPluginService();
  const cases = [
    "allowed",
    "revoked",
    "deleted",
    "read-only",
    "no-personal",
    "ask-first",
    "blocked-client",
    "excluded-project",
    "expired-token",
    "expired-grant",
    "disabled-owner",
    "lost-files",
    "revoked-before-upload",
    "revoked-mid-upload",
  ] as const;
  try {
    for (const scenario of cases) {
      const me = await person();
      const clientId = `plugin-import-${randomUUID()}`;
      const bearer = `oat_${randomUUID()}`;
      await pool.query(
        "INSERT INTO oauth_clients(id,kind,name,host,redirect_uris) VALUES ($1,'dcr','Import fixture','fixture.example.test',ARRAY['https://fixture.example.test/callback'])",
        [clientId],
      );
      const grantId = (
        await pool.query(
          "INSERT INTO agent_grants(user_id,kind,resource_kind,client_id,access,personal,toolsets,trust,authorized_at) VALUES ($1,'oauth','plugin',$2,'write',true,ARRAY['files'],'full',now()) RETURNING id",
          [me.id, clientId],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO agent_tokens(token_hash,grant_id,kind,resource,expires_at) VALUES ($1,$2,'access',$3,now()+interval '1 hour')",
        [digest(bearer), grantId, env.PLUGIN_PUBLIC_URL],
      );
      const project =
        scenario === "excluded-project"
          ? (
              await call(me.token, "POST", "/projects", {
                name: `Plugin ${scenario}`,
              })
            ).body.id
          : undefined;
      const bytes = wordFile();
      const created = await plugin.inject({
        method: "POST",
        url: "/plugin/jobs/imports",
        remoteAddress: address(),
        headers: { authorization: `Bearer ${bearer}` },
        payload: {
          name: "start_import",
          arguments: {
            file_name: `plugin-${scenario}.docx`,
            bytes: bytes.length,
            client_ref: `import-${randomUUID()}`,
            ...(project ? { project: `project:${project}` } : {}),
          },
        },
      });
      assert.equal(created.statusCode, 200, scenario);
      assert.ok(created.json().job?.id, scenario);
      const result = created.json().result.structuredContent;
      const id = result.done[0].id.slice("import:".length);
      const origin = (
        await pool.query(
          "SELECT plugin_owned,plugin_grant_id,plugin_client_id,plugin_resource FROM imports WHERE id=$1",
          [id],
        )
      ).rows[0];
      assert.deepEqual(origin, {
        plugin_owned: true,
        plugin_grant_id: grantId,
        plugin_client_id: clientId,
        plugin_resource: env.PLUGIN_PUBLIC_URL,
      });
      const uploadPath = new URL(result.upload_url).pathname.replace(
        /^\/api/,
        "",
      );
      if (scenario === "revoked-before-upload")
        await pool.query(
          "UPDATE agent_grants SET revoked_at=now() WHERE id=$1",
          [grantId],
        );
      let streamedObject: string | undefined;
      const stream =
        scenario === "revoked-mid-upload"
          ? Readable.from(
              (async function* () {
                yield bytes.subarray(0, Math.floor(bytes.length / 2));
                const deadline = Date.now() + 5000;
                while (
                  !(
                    await pool.query(
                      "SELECT object_id FROM imports WHERE id=$1",
                      [id],
                    )
                  ).rows[0].object_id
                ) {
                  assert.ok(
                    Date.now() < deadline,
                    "upload reservation must precede mid-stream revocation",
                  );
                  await new Promise((done) => setTimeout(done, 5));
                }
                streamedObject = (
                  await pool.query(
                    "SELECT object_id FROM imports WHERE id=$1",
                    [id],
                  )
                ).rows[0].object_id;
                await pool.query(
                  "UPDATE agent_grants SET revoked_at=now() WHERE id=$1",
                  [grantId],
                );
                yield bytes.subarray(Math.floor(bytes.length / 2));
              })(),
            )
          : bytes;
      const uploaded = await app.inject({
        method: "PUT",
        url: uploadPath,
        remoteAddress: address(),
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        payload: stream,
      });
      if (
        scenario === "revoked-before-upload" ||
        scenario === "revoked-mid-upload"
      ) {
        assert.equal(uploaded.statusCode, 403, scenario);
        const refused = (
          await pool.query("SELECT object_id,status FROM imports WHERE id=$1", [
            id,
          ])
        ).rows[0];
        assert.equal(refused.object_id, null, scenario);
        if (scenario === "revoked-mid-upload") {
          assert.ok(streamedObject);
          const paths = objectPaths(streamedObject!, dir);
          await assert.rejects(access(paths.data), { code: "ENOENT" });
          await assert.rejects(access(paths.key), { code: "ENOENT" });
        }
        assert.equal(
          refused.status,
          scenario === "revoked-before-upload" ? "waiting" : "failed",
          scenario,
        );
        assert.equal(
          (
            await pool.query("SELECT count(*) FROM docs WHERE user_id=$1", [
              me.id,
            ])
          ).rows[0].count,
          "0",
        );
        await pool.query("DELETE FROM users WHERE id=$1", [me.id]);
        await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
        continue;
      }
      assert.equal(uploaded.statusCode, 201, scenario);
      if (scenario === "revoked")
        await pool.query(
          "UPDATE agent_grants SET revoked_at=now() WHERE id=$1",
          [grantId],
        );
      if (scenario === "deleted")
        await pool.query("DELETE FROM agent_grants WHERE id=$1", [grantId]);
      if (scenario === "read-only")
        await pool.query("UPDATE agent_grants SET access='read' WHERE id=$1", [
          grantId,
        ]);
      if (scenario === "no-personal")
        await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
          grantId,
        ]);
      if (scenario === "ask-first")
        await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
          grantId,
        ]);
      if (scenario === "blocked-client")
        await pool.query("UPDATE oauth_clients SET blocked=true WHERE id=$1", [
          clientId,
        ]);
      if (project)
        await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
          project,
        ]);
      if (scenario === "expired-token")
        await pool.query(
          "UPDATE agent_tokens SET expires_at=now()-interval '1 second' WHERE grant_id=$1",
          [grantId],
        );
      if (scenario === "expired-grant")
        await pool.query(
          "UPDATE agent_grants SET expires_at=now()-interval '1 second' WHERE id=$1",
          [grantId],
        );
      if (scenario === "disabled-owner")
        await pool.query("UPDATE users SET disabled=true WHERE id=$1", [me.id]);
      if (scenario === "lost-files")
        await pool.query(
          "UPDATE agent_grants SET toolsets=ARRAY['core'] WHERE id=$1",
          [grantId],
        );
      await convertPending();
      const outcome =
        scenario === "disabled-owner"
          ? (
              await pool.query(
                "SELECT status,doc_id,error FROM imports WHERE id=$1",
                [id],
              )
            ).rows[0]
          : (await call(me.token, "GET", `/imports/${id}`)).body;
      if (scenario === "allowed") {
        assert.equal(outcome.status, "ready");
        assert.ok(outcome.doc_id);
        assert.equal(
          (await call(me.token, "GET", `/docs/${outcome.doc_id}`)).body.title,
          "Consensus",
        );
        const events = await plugin.inject({
          url: `/plugin/jobs/${created.json().job.id}/events`,
          remoteAddress: address(),
          headers: { authorization: `Bearer ${bearer}` },
        });
        assert.equal(events.statusCode, 200);
        assert.equal(events.json().result.id, `doc:${outcome.doc_id}`);
      } else {
        assert.equal(outcome.status, "failed", scenario);
        assert.equal(outcome.doc_id, null, scenario);
        assert.match(outcome.error, /Nothing was shared/, scenario);
        assert.equal(
          (
            await pool.query("SELECT count(*) FROM docs WHERE user_id=$1", [
              me.id,
            ])
          ).rows[0].count,
          "0",
          scenario,
        );
      }
      if (scenario === "deleted")
        assert.equal(
          (
            await pool.query(
              "SELECT plugin_owned,plugin_grant_id FROM imports WHERE id=$1",
              [id],
            )
          ).rows[0].plugin_owned,
          true,
        );
      await pool.query("DELETE FROM users WHERE id=$1", [me.id]);
      await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
    }
  } finally {
    await plugin.close();
  }
});

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

test("Word footnotes survive upload, conversion, storage and source export without crossing ownership", async () => {
  const me = await person();
  const other = await person();
  const { parseDoc, plainText } = await import("@orbyn/core");
  const { docToDocx } = await import("../src/modules/docs/docx.js");
  const source = parseDoc(
    'Read[^source].\n\n[^source]: **Source** [guide](https://example.test/guide "Guide hint")  \n    next line',
  );
  const id = await upload(
    me.token,
    "notes.docx",
    docToDocx("Notes", source),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  await convertPending();
  const job = (await call(me.token, "GET", `/imports/${id}`)).body;
  assert.equal(job.status, "ready", JSON.stringify(job));
  const response = await call(me.token, "GET", `/docs/${job.doc_id}`);
  assert.equal(response.status, 200);
  const blocks = response.body.content;
  assert.ok(
    blocks.some((block: { text?: string }) =>
      block.text?.includes("Read[^word-1]."),
    ),
  );
  const note = blocks.find(
    (block: { type: string }) => block.type === "footnote",
  );
  assert.equal(note.label, "word-1");
  assert.equal(plainText(note.text), "Source guide\nnext line");
  assert.match(note.text, /https:\/\/example.test\/guide/);
  assert.match(note.text, /Guide hint/);
  assert.equal(
    (await call(other.token, "GET", `/docs/${job.doc_id}`)).status,
    404,
  );
  assert.equal((await call(other.token, "GET", `/imports/${id}`)).status, 404);
  const exported = await app.inject({
    method: "GET",
    url: `/docs/${job.doc_id}/export?format=md`,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${me.token}` },
  });
  assert.equal(exported.statusCode, 200, exported.body);
  const restored = parseDoc(exported.body);
  assert.equal(
    plainText(restored.find((block) => block.type === "footnote")!.text),
    "Source guide\nnext line",
  );
  assert.equal(
    (await pool.query("SELECT object_id FROM imports WHERE id=$1", [id]))
      .rows[0].object_id,
    null,
  );
});

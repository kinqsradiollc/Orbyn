import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Taking everything away (DATA-09): the .zip holds every page the person
 * owns as Markdown in its folders, with front matter; their projects and
 * folders; what they imported; their consent history; and the planner file
 * the JSON export still gives on its own. Team pages stay with the team.
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { pageFile, safeFileName } = await import("@orbyn/core");

const app = await buildApp();
type Json = Record<string, any>;
let token = "";
let userId = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  as: string | null = token,
) =>
  app.inject({
    method,
    url,
    headers: as ? { authorization: `Bearer ${as}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

/** Read a zip written without data descriptors: name → contents. */
function unzip(buffer: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const method = buffer.readUInt16LE(at + 8);
    const packed = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extra = buffer.readUInt16LE(at + 28);
    const name = buffer.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extra;
    const body = buffer.subarray(start, start + packed);
    out.set(
      name,
      (method === 8 ? inflateRawSync(body) : body).toString("utf8"),
    );
    at = start + packed;
  }
  return out;
}

let team = "";

before(async () => {
  await migrate();
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `archive-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Leaver",
    },
    headers: { "user-agent": "archive-test" },
  });
  token = r.json().token;
  userId = r.json().user.id;
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Archive crew', $1) RETURNING id",
      [userId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner')",
    [team, userId],
  );
});
after(async () => {
  await app.close();
  await pool.end();
});

test("a page file says what it is before the page itself", () => {
  const file = pageFile(
    {
      title: 'Lab "3"',
      kind: "doc",
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-02T10:00:00.000Z",
      folder: "Physics",
      project: "Physics 101",
      tags: ["lab", "exam"],
      imported_from: { file_name: "lab3.pdf" },
    },
    [{ type: "paragraph", text: "Results" }],
  );
  assert.equal(
    file,
    [
      "---",
      'title: "Lab \\"3\\""',
      'kind: "page"',
      'created: "2026-09-01T10:00:00.000Z"',
      'updated: "2026-09-02T10:00:00.000Z"',
      'folder: "Physics"',
      'project: "Physics 101"',
      'tags: ["lab", "exam"]',
      'imported_from: "lab3.pdf"',
      "---",
      '# Lab "3"',
      "",
      "Results",
      "",
    ].join("\n"),
  );
  assert.equal(safeFileName("a/b: c?"), "a b c");
  assert.equal(safeFileName("..hidden"), "hidden");
  assert.equal(safeFileName("   "), "Untitled");
});

test("the archive holds every page in its folder, and everything beside them", async () => {
  const folder = (await call("POST", "/folders", { name: "Physics" })).json();
  const project = (
    await call("POST", "/projects", { name: "Physics 101" })
  ).json();
  const tag = (await call("POST", "/tags", { name: "lab" })).json();
  const filed = (
    await call("POST", "/docs", {
      title: "Lab 3: results",
      folder_id: folder.id,
      project_id: project.id,
      tags: [tag.id],
      content: [
        { type: "heading", level: 2, text: "Results" },
        { type: "todo", text: "Write up", done: false },
      ],
    })
  ).json();
  // Two pages with the same title get two files.
  await call("POST", "/docs", { title: "Ideas", kind: "note" });
  await call("POST", "/docs", { title: "Ideas", kind: "note" });
  const agenda = (await call("GET", "/agenda/today")).json();
  const binned = (await call("POST", "/docs", { title: "Old draft" })).json();
  await call("DELETE", `/docs/${binned.id}`);
  // A team's page stays with the team.
  await call("POST", "/docs", { title: "Team secret", team_id: team });
  // An import that became a page, and one that failed.
  await pool.query(`UPDATE docs SET imported_from = $2::jsonb WHERE id = $1`, [
    filed.id,
    JSON.stringify({
      file_name: "lab3.pdf",
      file_type: "pdf",
      pages: 4,
      ocr_pages: 0,
      imported_at: "2026-09-01T10:00:00.000Z",
    }),
  ]);
  await pool.query(
    `INSERT INTO imports (user_id, file_name, file_type, bytes, status, pages, doc_id)
     VALUES ($1, 'lab3.pdf', 'pdf', 2048, 'ready', 4, $2),
            ($1, 'blurry.jpg', 'jpeg', 1024, 'failed', NULL, NULL)`,
    [userId, filed.id],
  );
  await call("PUT", "/me/privacy", { analytics_opt_out: true });

  const r = await call("GET", "/me/export.zip");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers["content-type"], "application/zip");
  const date = new Date().toISOString().slice(0, 10);
  assert.match(
    String(r.headers["content-disposition"]),
    new RegExp(`filename="orbyn-export-${date}\\.zip"`),
  );
  const files = unzip(r.rawPayload);
  const root = `orbyn-export-${date}`;
  const names = [...files.keys()];
  for (const name of [
    "README.md",
    "planner.json",
    "projects.json",
    "folders.json",
    "attachments.json",
    "consent.json",
  ])
    assert.ok(names.includes(`${root}/${name}`), name);

  const page = files.get(`${root}/pages/Physics/Lab 3 results.md`);
  assert.ok(page, names.join("\n"));
  assert.match(page, /^---\ntitle: "Lab 3: results"\nkind: "page"\n/);
  assert.match(page, /folder: "Physics"/);
  assert.match(page, /project: "Physics 101"/);
  assert.match(page, /tags: \["lab"\]/);
  assert.match(page, /imported_from: "lab3.pdf"/);
  assert.match(page, /# Lab 3: results\n\n## Results\n\n- \[ \] Write up\n/);
  assert.ok(files.has(`${root}/pages/Ideas.md`));
  assert.ok(files.has(`${root}/pages/Ideas (2).md`));
  const day = files.get(`${root}/pages/Agendas/${agenda.agenda_date}.md`);
  assert.ok(day);
  assert.match(day, /kind: "agenda"/);
  assert.match(day, new RegExp(`date: "${agenda.agenda_date}"`));
  const trashed = files.get(`${root}/pages/Trash/Old draft.md`);
  assert.ok(trashed);
  assert.match(trashed, /in_trash: true/);
  assert.ok(!names.some((n) => /Team secret/.test(n)));
  assert.ok(![...files.values()].some((body) => body.includes("Team secret")));

  const projects: Json[] = JSON.parse(files.get(`${root}/projects.json`)!);
  const p = projects.find((x) => x.name === "Physics 101")!;
  assert.ok(p);
  assert.ok(Array.isArray(p.stages));
  const folders: Json[] = JSON.parse(files.get(`${root}/folders.json`)!);
  assert.deepEqual(
    folders.map((f) => [f.name, f.pages]),
    [["Physics", 1]],
  );
  const attachments = JSON.parse(files.get(`${root}/attachments.json`)!);
  assert.match(attachments.note, /deleted/);
  assert.deepEqual(
    attachments.imports.map((i: Json) => [i.file_name, i.status, i.page]),
    [
      ["lab3.pdf", "ready", "pages/Physics/Lab 3 results.md"],
      ["blurry.jpg", "failed", null],
    ],
  );
  assert.equal(attachments.pages[0].file_name, "lab3.pdf");
  const consent = JSON.parse(files.get(`${root}/consent.json`)!);
  assert.equal(consent.analytics, "off");
  assert.ok(
    consent.history.some(
      (h: Json) => h.kind === "analytics" && h.granted === false,
    ),
  );
  const planner = JSON.parse(files.get(`${root}/planner.json`)!);
  assert.equal(planner.version, 1);
  assert.ok(planner.tags.some((t: Json) => t.name === "lab"));
  assert.match(
    files.get(`${root}/README.md`)!,
    /Team pages and projects belong to their team/,
  );
});

test("the JSON export still works as it did", async () => {
  const r = await call("GET", "/me/export");
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.version, 1);
  assert.ok(Array.isArray(body.items));
  assert.ok(Array.isArray(body.lists));
});

test("only the signed-in person may take the archive, and not too often", async () => {
  assert.equal(
    (await call("GET", "/me/export.zip", undefined, null)).statusCode,
    401,
  );
  const key = (await call("POST", "/me/api-keys", { name: "Script" })).json()
    .key;
  assert.ok(key);
  assert.equal(
    (await call("GET", "/me/export.zip", undefined, key)).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/me/export", undefined, key)).statusCode,
    403,
  );
  const from = () =>
    app.inject({
      method: "GET",
      url: "/me/export.zip",
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: "10.75.0.1",
    });
  let limited = 0;
  for (let i = 0; i < 12; i++) if ((await from()).statusCode === 429) limited++;
  assert.ok(limited >= 1, "the stricter limit applies");
});

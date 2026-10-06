import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import {
  parseDocContainers,
  docContainerBlocks,
  replaceVersionedDocLeaf,
  HttpError,
  appendDocContainerBlocks,
  docContainerTaskBlocks,
} from "@orbyn/core";
import type { UserRow } from "../src/lib/auth.js";
const { migrate } = await import("../src/db/migrate.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { buildApp } = await import("../src/app.js");
const { readVersionedDoc, saveVersionedDoc } =
  await import("../src/modules/docs/content-format.js");
const { addToPage } = await import("../src/modules/docs/service.js");
const { closeLive } = await import("../src/modules/docs/live.js");

const app = await buildApp();
let owner: UserRow, stranger: UserRow;
let token: string;
let strangerToken: string;
const users: string[] = [];
const teams: string[] = [];
async function register(name: string) {
  const email = `structured-${randomUUID()}@example.test`;
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, name, password: "a-long-test-password" },
  });
  assert.equal(response.statusCode, 201);
  const row = (
    await pool.query<UserRow>("SELECT * FROM users WHERE email=$1", [email])
  ).rows[0];
  users.push(row.id);
  return { row, token: response.json().token as string };
}
async function page(user = owner, content: unknown = []) {
  return (
    await pool.query<{ id: string }>(
      "INSERT INTO docs(user_id,title,content) VALUES($1,$2,$3::jsonb) RETURNING id",
      [user.id, "Structured page", JSON.stringify(content)],
    )
  ).rows[0].id;
}
const refuses = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;
before(async () => {
  await migrate();
  const registered = await register("Owner");
  owner = registered.row;
  token = registered.token;
  const other = await register("Stranger");
  stranger = other.row;
  strangerToken = other.token;
});
after(async () => {
  await closeLive();
  await app.close();
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});

test("legacy storage reads in format1; structured save preserves order, identities and complete history", async () => {
  const id = await page(owner, [
    { type: "paragraph", id: "old", text: "Original" },
  ]);
  const before = await readVersionedDoc(pool, owner, id, [1]);
  assert.equal(before.document.format, 1);
  const nodes = parseDocContainers(
    "> # Heading ^heading\n>\n> - Words ^words\n>\n>   ```ts\n>   run();\n>   ```\n^outer",
    { anchors: true },
  );
  const saved = await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.document, { format: 2, nodes });
  const stored = (
    await pool.query(
      "SELECT content,content_format,content_nodes FROM docs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(stored.content, docContainerBlocks(nodes));
  assert.deepEqual(stored.content_nodes, nodes);
  const v1 = (
    await pool.query(
      "SELECT content_format,content_nodes,content FROM doc_versions WHERE doc_id=$1 AND version=1",
      [id],
    )
  ).rows[0];
  assert.equal(v1.content_format, 1);
  assert.equal(v1.content_nodes, null);
  const next = parseDocContainers("> Changed\n^outer", { anchors: true });
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 2, { format: 2, nodes: next }, [1, 2]),
  );
  const v2 = (
    await pool.query(
      "SELECT content_format,content_nodes,content FROM doc_versions WHERE doc_id=$1 AND version=2",
      [id],
    )
  ).rows[0];
  assert.equal(v2.content_format, 2);
  assert.deepEqual(v2.content_nodes, nodes);
  assert.deepEqual(v2.content, stored.content);
});

test("accepting a suggestion preserves nested ownership, history and unrelated leaves", async () => {
  const id = await page();
  const nodes = parseDocContainers(
    "> - Original words ^words\n>\n>   ```ts\n>   keep();\n>   ```\n^outer",
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  // Begin a new editing sitting so the existing history coalescing policy keeps v2.
  await pool.query(
    "UPDATE doc_versions SET created_at=now()-interval '1 day' WHERE doc_id=$1",
    [id],
  );
  const made = await app.inject({
    method: "POST",
    url: `/docs/${id}/suggestions`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      changes: [
        {
          block_id: "words",
          kind: "replace",
          range_start: 0,
          range_end: 8,
          quote: "Original",
          text: "Revised",
        },
      ],
    },
  });
  assert.equal(made.statusCode, 201);
  const sid = made.json()[0].id;
  const url = `/docs/${id}/suggestions/${sid}`;
  assert.equal(
    (await app.inject({ method: "POST", url, payload: { take: true } }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${strangerToken}` },
        payload: { take: true },
      })
    ).statusCode,
    404,
  );
  const taken = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: { take: true },
  });
  assert.equal(taken.statusCode, 200);
  const expected = replaceVersionedDocLeaf({ format: 2, nodes }, "words", {
    type: "paragraph",
    id: "words",
    text: "Revised words",
  });
  const current = await readVersionedDoc(pool, owner, id, [1, 2]);
  assert.equal(current.version, 3);
  assert.deepEqual(current.document, expected);
  const stored = (
    await pool.query("SELECT content,content_nodes FROM docs WHERE id=$1", [id])
  ).rows[0];
  assert.deepEqual(stored.content, docContainerBlocks(stored.content_nodes));
  const past = (
    await pool.query(
      "SELECT content_format,content_nodes FROM doc_versions WHERE doc_id=$1 AND version=2",
      [id],
    )
  ).rows[0];
  assert.equal(past.content_format, 2);
  assert.deepEqual(past.content_nodes, nodes);
  assert.equal(
    (await pool.query("SELECT status FROM doc_suggestions WHERE id=$1", [sid]))
      .rows[0].status,
    "accepted",
  );
});

test("capability, stale revision and ownership refuse writes before changing page or history", async () => {
  const id = await page();
  const nodes = parseDocContainers("> Original");
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  await assert.rejects(readVersionedDoc(pool, owner, id, [1]), refuses(409));
  await assert.rejects(
    readVersionedDoc(pool, stranger, id, [1, 2]),
    refuses(404),
  );
  await assert.rejects(
    transaction((db) =>
      saveVersionedDoc(db, stranger, id, 2, { format: 2, nodes: [] }, [1, 2]),
    ),
    refuses(404),
  );
  await assert.rejects(
    transaction((db) =>
      saveVersionedDoc(db, owner, id, 1, { format: 2, nodes: [] }, [1, 2]),
    ),
    refuses(409),
  );
  await assert.rejects(
    transaction((db) =>
      saveVersionedDoc(db, owner, id, 2, { format: 1, blocks: [] }, [1]),
    ),
    refuses(409),
  );
  await assert.rejects(
    transaction((db) =>
      saveVersionedDoc(db, owner, id, 2, { format: 1, blocks: [] }, [1, 2]),
    ),
    refuses(409),
  );
  assert.equal(
    (await pool.query("SELECT version FROM docs WHERE id=$1", [id])).rows[0]
      .version,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM doc_versions WHERE doc_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
});

test("normal editor read negotiates one revision, preserves metadata and projects private nested labels", async () => {
  const privateId = await page(stranger);
  const id = await page();
  const nodes = parseDocContainers(
    `> - [Secret title][private] ^words\n\n[private]: orbyn://doc/${privateId} "Secret hint"`,
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const url = `/docs/${id}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "x-orbyn-doc-formats": "1,2",
  };
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url,
        headers: { ...headers, "x-orbyn-doc-formats": "3" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url,
        headers: { ...headers, authorization: `Bearer ${strangerToken}` },
      })
    ).statusCode,
    404,
  );
  const response = await app.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const read = response.json();
  assert.equal(read.id, id);
  assert.equal(read.user_id, owner.id);
  assert.equal(read.title, "Structured page");
  assert.equal(read.version, 2);
  assert.equal(read.document.format, 2);
  assert.deepEqual(
    docContainerBlocks(read.document.nodes, { projected: true }),
    read.content,
  );
  assert.doesNotMatch(response.body, /Secret title|Secret hint|content_nodes/);
  assert.match(response.body, /Private page/);
  const later = parseDocContainers("> Updated ^words", { anchors: true });
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 2, { format: 2, nodes: later }, [1, 2]),
  );
  const fresh = await app.inject({
    method: "GET",
    url,
    headers: { ...headers, "if-none-match": response.headers.etag ?? "old" },
  });
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.json().version, 3);
  assert.deepEqual(fresh.json().document, { format: 2, nodes: later });
});

test("normal editor read enforces disabled-account and request-rate limits", async () => {
  const registered = await register("Editor read guard");
  const id = await page(registered.row);
  const headers = {
    authorization: `Bearer ${registered.token}`,
    "x-orbyn-doc-formats": "1,2",
  };
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
    registered.row.id,
  ]);
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: `/docs/${id}`, headers }))
        .statusCode,
      403,
    );
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
      registered.row.id,
    ]);
  }
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  const { freshRateLimitSession } = await import("./rate-limit-session.js");
  const fresh = await freshRateLimitSession(registered.token);
  await settings();
  const live = cachedSettings(),
    previous = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  try {
    const read = () =>
      app.inject({
        method: "GET",
        url: `/docs/${id}`,
        headers: { ...headers, authorization: `Bearer ${fresh}` },
        remoteAddress: "10.88.44.2",
      });
    assert.equal((await read()).statusCode, 200);
    assert.equal((await read()).statusCode, 200);
    const limited = await read();
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
  } finally {
    live.rate_limit_per_minute = previous;
  }
});

test("normal editor saves title and complete nested content as one atomic revision", async () => {
  const id = await page();
  const nodes = parseDocContainers(
    "> - Words ^words\n>\n>   Continuation ^more\n^outer",
    { anchors: true },
  );
  const url = `/docs/${id}`;
  const headers = {
    authorization: `Bearer ${token}`,
    "x-orbyn-doc-formats": "1,2",
  };
  const payload = {
    version: 1,
    title: "Atomic title",
    document: { format: 2, nodes },
  };
  assert.equal(
    (await app.inject({ method: "PUT", url, payload })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url,
        payload,
        headers: { authorization: `Bearer ${token}` },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url,
        payload: { ...payload, content: [] },
        headers,
      })
    ).statusCode,
    422,
  );
  const saved = await app.inject({ method: "PUT", url, payload, headers });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().version, 2);
  assert.equal(saved.json().title, "Atomic title");
  assert.deepEqual(saved.json().document, { format: 2, nodes });
  assert.deepEqual(saved.json().content, docContainerBlocks(nodes));
  assert.equal(
    (await app.inject({ method: "PUT", url, payload, headers })).statusCode,
    409,
  );
  const bad = {
    version: 2,
    title: "Must roll back",
    document: {
      format: 2,
      nodes: [
        {
          kind: "block",
          block: { type: "paragraph", id: "words", text: "x".repeat(10001) },
        },
      ],
    },
  };
  assert.equal(
    (await app.inject({ method: "PUT", url, payload: bad, headers }))
      .statusCode,
    400,
  );
  const downgrade = await app.inject({
    method: "PUT",
    url,
    payload: {
      version: 2,
      title: "Lost structure",
      document: { format: 1, blocks: [] },
    },
    headers,
  });
  assert.equal(downgrade.statusCode, 409);
  const read = await app.inject({ method: "GET", url, headers });
  assert.equal(read.json().version, 2);
  assert.equal(read.json().title, "Atomic title");
  assert.deepEqual(read.json().document, { format: 2, nodes });
  const nextNodes = parseDocContainers("> Revised ^words\n^outer", {
    anchors: true,
  });
  const next = await app.inject({
    method: "PUT",
    url,
    headers,
    payload: {
      version: 2,
      title: "Second title",
      document: { format: 2, nodes: nextNodes },
    },
  });
  assert.equal(next.statusCode, 200);
  assert.equal(next.json().version, 3);
  const past = (
    await pool.query(
      "SELECT title,content_format,content_nodes FROM doc_versions WHERE doc_id=$1 AND version=2",
      [id],
    )
  ).rows[0];
  assert.equal(past.title, "Atomic title");
  assert.equal(past.content_format, 2);
  assert.deepEqual(past.content_nodes, nodes);
  const metadata = await app.inject({
    method: "PUT",
    url,
    headers,
    payload: { version: 3, title: "Metadata only" },
  });
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.json().version, 4);
  assert.deepEqual((await readVersionedDoc(pool, owner, id, [1, 2])).document, {
    format: 2,
    nodes: nextNodes,
  });
});

test("database trigger blocks legacy content and ownership changes and mismatched authorized projection", async () => {
  const id = await page();
  const nodes = parseDocContainers("> Original");
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  for (const sql of [
    "UPDATE docs SET content='[]'::jsonb WHERE id=$1",
    "UPDATE docs SET content_nodes='[]'::jsonb WHERE id=$1",
    "UPDATE docs SET content_format=1,content_nodes=NULL WHERE id=$1",
  ])
    await assert.rejects(
      pool.query(sql, [id]),
      (error: any) => error.code === "23514",
    );
  await assert.rejects(
    transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.doc_content_writer','2',true)");
      await db.query("UPDATE docs SET content='[]'::jsonb WHERE id=$1", [id]);
    }),
    (error: any) => error.code === "23514",
  );
  await pool.query("UPDATE docs SET title=$2 WHERE id=$1", [id, "Renamed"]);
  assert.equal(
    (await pool.query("SELECT content_format FROM docs WHERE id=$1", [id]))
      .rows[0].content_format,
    2,
  );
  await assert.rejects(
    pool.query("UPDATE docs SET content='[]'::jsonb WHERE id=$1", [id]),
    (error: any) => error.code === "23514",
  );
});

test("database projection agrees with shared traversal and applies depth/count limits", async () => {
  const nodes = parseDocContainers(
    "> Words\n>\n> - [x] First\n>   - Second\n\n- Root",
  );
  assert.deepEqual(
    (
      await pool.query("SELECT doc_container_projection($1::jsonb) AS blocks", [
        JSON.stringify(nodes),
      ])
    ).rows[0].blocks,
    docContainerBlocks(nodes),
  );
  for (const nodes of [
    [{ kind: "unknown" }],
    Array.from({ length: 2001 }, () => ({ kind: "quote", children: [] })),
  ])
    await assert.rejects(
      pool.query("SELECT doc_container_projection($1::jsonb)", [
        JSON.stringify(nodes),
      ]),
      (error: any) => error.code === "23514",
    );
  let deep: unknown = {
    kind: "block",
    block: { type: "paragraph", text: "bottom" },
  };
  for (let i = 0; i < 14; i++) deep = { kind: "quote", children: [deep] };
  await assert.rejects(
    pool.query("SELECT doc_container_projection($1::jsonb)", [
      JSON.stringify([deep]),
    ]),
    (error: any) => error.code === "23514",
  );
});

test("invalid content rolls back; ordinary REST save refuses structured content with useful conflict", async () => {
  const id = await page();
  await assert.rejects(
    transaction((db) =>
      saveVersionedDoc(
        db,
        owner,
        id,
        1,
        {
          format: 2,
          nodes: [
            {
              kind: "block",
              block: { type: "paragraph", text: "x", hidden: true },
            },
          ],
        },
        [1, 2],
      ),
    ),
    refuses(400),
  );
  await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      id,
      1,
      { format: 2, nodes: parseDocContainers("> Words") },
      [1, 2],
    ),
  );
  const refused = await app.inject({
    method: "PUT",
    url: `/docs/${id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      version: 2,
      content: [{ type: "paragraph", text: "Flattened" }],
    },
  });
  assert.equal(refused.statusCode, 409, refused.body);
  const collaboration = await app.inject({
    method: "POST",
    url: `/docs/${id}/updates`,
    headers: { authorization: `Bearer ${token}` },
    payload: { updates: ["AA=="] },
  });
  assert.equal(collaboration.statusCode, 409);
  assert.equal(
    (await pool.query("SELECT version FROM docs WHERE id=$1", [id])).rows[0]
      .version,
    2,
  );
});

test("nested link reference labels and hints use complete page visibility; hidden labels survive a save", async () => {
  const privateId = await page(stranger, [
    { type: "paragraph", text: "Secret" },
  ]);
  const id = await page();
  const nodes = parseDocContainers(
    `> [Private title][ref]\n>\n> - [Private title][ref]\n\n[ref]: orbyn://doc/${privateId} "Secret hint"`,
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const read = await readVersionedDoc(pool, owner, id, [1, 2]);
  const visible = JSON.stringify(read.document);
  assert.ok(!visible.includes("Private title"));
  assert.ok(!visible.includes("Secret hint"));
  assert.match(visible, /Private page/);
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 2, read.document, [1, 2]),
  );
  const stored = (
    await pool.query("SELECT content_nodes FROM docs WHERE id=$1", [id])
  ).rows[0].content_nodes;
  assert.match(JSON.stringify(stored), /Private title/);
  assert.match(JSON.stringify(stored), /Secret hint/);
});

test("REST authentication, validation, team permissions and rate limits remain enforced", async () => {
  const id = await page();
  const unauthenticated = await app.inject({
    method: "PUT",
    url: `/docs/${id}/content`,
    payload: { version: 1, document: { format: 1, blocks: [] } },
  });
  assert.equal(unauthenticated.statusCode, 401);
  const invalid = await app.inject({
    method: "PUT",
    url: `/docs/${id}/content`,
    headers: { authorization: `Bearer ${token}` },
    payload: { version: "bad", document: { format: 1, blocks: [] } },
  });
  assert.equal(invalid.statusCode, 422);
  const malformed = await app.inject({
    method: "PUT",
    url: `/docs/${id}/content`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id",
      ["Structured permissions", owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'viewer')",
    [team, owner.id, stranger.id],
  );
  await pool.query("UPDATE docs SET team_id=$2 WHERE id=$1", [id, team]);
  await assert.rejects(
    transaction((db) =>
      saveVersionedDoc(db, stranger, id, 1, { format: 2, nodes: [] }, [1, 2]),
    ),
    refuses(403),
  );
  const viewer = await app.inject({
    method: "PUT",
    url: `/docs/${id}/content`,
    headers: {
      authorization: `Bearer ${strangerToken}`,
      "x-orbyn-doc-formats": "1,2",
    },
    payload: { version: 1, document: { format: 2, nodes: [] } },
  });
  assert.equal(viewer.statusCode, 403);
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  const { freshRateLimitSession } = await import("./rate-limit-session.js");
  const fresh = await freshRateLimitSession(token);
  await settings();
  const live = cachedSettings();
  const previous = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  try {
    const read = () =>
      app.inject({
        method: "GET",
        url: `/docs/${id}/content`,
        headers: { authorization: `Bearer ${fresh}` },
        remoteAddress: "10.88.44.1",
      });
    assert.equal((await read()).statusCode, 200);
    assert.equal((await read()).statusCode, 200);
    const limited = await read();
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
  } finally {
    live.rate_limit_per_minute = previous;
  }
});

test("capable flat downgrade is explicit; unreadable files cannot grant access through nested content", async () => {
  const id = await page();
  const original = { type: "paragraph" as const, id: "words", text: "Words" };
  await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      id,
      1,
      { format: 2, nodes: [{ kind: "block", block: original }] },
      [1, 2],
    ),
  );
  await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      id,
      2,
      { format: 1, blocks: [original] },
      [1, 2],
    ),
  );
  const stored = (
    await pool.query(
      "SELECT content_format,content_nodes FROM docs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(stored.content_format, 1);
  assert.equal(stored.content_nodes, null);
  const filePage = await page();
  const privatePage = await page(stranger);
  const fileId = (
    await pool.query<{ id: string }>(
      "INSERT INTO page_files(user_id,doc_id,name,mime,kind,bytes,status) VALUES($1,$2,'Private fixture','text/plain','file',10,'ready') RETURNING id",
      [stranger.id, privatePage],
    )
  ).rows[0].id;
  await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      filePage,
      1,
      {
        format: 2,
        nodes: [
          {
            kind: "block",
            block: { type: "file", file: fileId, text: "Copied label" },
          },
        ],
      },
      [1, 2],
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM page_file_refs WHERE doc_id=$1 AND file_id=$2",
        [filePage, fileId],
      )
    ).rows[0].n,
    0,
  );
  const readFile = await app.inject({
    method: "GET",
    url: `/docs/files/${fileId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(readFile.statusCode, 404);
  const ownership = (
    await pool.query("SELECT user_id,doc_id FROM page_files WHERE id=$1", [
      fileId,
    ])
  ).rows[0];
  assert.equal(ownership.user_id, stranger.id);
  assert.equal(ownership.doc_id, privatePage);
});

test("capability REST reads and writes complete ownership with fresh cache policy", async () => {
  const id = await page();
  const headers = {
    authorization: `Bearer ${token}`,
    "x-orbyn-doc-formats": "1,2",
  };
  const nodes = parseDocContainers("> Nested\n>\n> - Item");
  const saved = await app.inject({
    method: "PUT",
    url: `/docs/${id}/content`,
    headers,
    payload: { version: 1, document: { format: 2, nodes } },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().document, { format: 2, nodes });
  const read = await app.inject({
    method: "GET",
    url: `/docs/${id}/content`,
    headers,
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers["cache-control"], "no-store");
  assert.equal(read.json().version, 2);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/docs/${id}/content`,
        headers: { authorization: `Bearer ${token}` },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/docs/${id}/content`,
        headers: { ...headers, "x-orbyn-doc-formats": "3" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: `/docs/${id}/content` }))
      .statusCode,
    401,
  );
  const stale = await app.inject({
    method: "PUT",
    url: `/docs/${id}/content`,
    headers,
    payload: { version: 1, document: { format: 2, nodes: [] } },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/docs/${id}/content`,
        headers,
        payload: { version: "bad", document: { format: 2, nodes } },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/docs/${id}/content`,
        headers: { ...headers, "content-type": "application/json" },
        payload: "{",
      })
    ).statusCode,
    400,
  );
});

test("expanded private labels round-trip through API without widening stored limits", async () => {
  const privateId = await page(stranger);
  const text = "[x][ref] ".repeat(1000);
  const id = await page();
  const nodes = parseDocContainers(
    `> ${text}\n\n[ref]: orbyn://doc/${privateId}`,
  );
  const headers = {
    authorization: `Bearer ${token}`,
    "x-orbyn-doc-formats": "1,2",
  };
  const save = (version: number, document: unknown) =>
    app.inject({
      method: "PUT",
      url: `/docs/${id}/content`,
      headers,
      payload: { version, document },
    });
  const saved = await save(1, { format: 2, nodes });
  assert.equal(saved.statusCode, 200);
  const projected = saved.json().document;
  assert.ok(projected.nodes[0].children[0].block.text.length > 10000);
  assert.equal((await save(2, projected)).statusCode, 200);
  const stored = (
    await pool.query("SELECT content_nodes FROM docs WHERE id=$1", [id])
  ).rows[0].content_nodes;
  assert.equal(stored[0].children[0].block.text, text.trim());
  projected.nodes[0].children[0].block.text = "x".repeat(10001);
  assert.equal((await save(3, projected)).statusCode, 400);
  assert.equal(
    (await pool.query("SELECT version FROM docs WHERE id=$1", [id])).rows[0]
      .version,
    3,
  );
});

test("legacy history restore cannot flatten a structured version after a flat downgrade", async () => {
  const id = await page();
  const nodes = [
    {
      kind: "block" as const,
      block: { type: "paragraph" as const, id: "words", text: "Original" },
    },
  ];
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const currentRefusal = await app.inject({
    method: "POST",
    url: `/docs/${id}/versions/1/restore`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(currentRefusal.statusCode, 409);
  await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      id,
      2,
      { format: 1, blocks: [nodes[0].block] },
      [1, 2],
    ),
  );
  const pastRefusal = await app.inject({
    method: "POST",
    url: `/docs/${id}/versions/2/restore`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(pastRefusal.statusCode, 409);
  const stored = (
    await pool.query("SELECT version,content_format FROM docs WHERE id=$1", [
      id,
    ])
  ).rows[0];
  assert.deepEqual(stored, { version: 3, content_format: 1 });
});

test("Export routes retain nested ownership and private-label projections", async () => {
  const privateId = await page(stranger);
  const id = await page();
  const nodes = parseDocContainers(
    `> # Heading\n>\n> - [Secret][ref]\n>\n>   Continuation\n\n[ref]: orbyn://doc/${privateId} "Hidden hint"`,
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const headers = { authorization: `Bearer ${token}` };
  for (const path of ["markdown", "export?format=md&version=2"]) {
    const result = await app.inject({
      method: "GET",
      url: `/docs/${id}/${path}`,
      headers,
    });
    assert.equal(result.statusCode, 200);
    assert.match(result.body, /> - Private page/);
    assert.match(result.body, />   Continuation/);
    assert.ok(!result.body.includes(privateId));
    assert.doesNotMatch(result.body, /Secret|Hidden hint/);
  }
  const text = await app.inject({
    method: "GET",
    url: `/docs/${id}/export?format=txt&version=2`,
    headers,
  });
  assert.equal(text.statusCode, 200);
  assert.match(text.body, /> • Private page/);
  assert.ok(!text.body.includes(privateId));
  const word = await app.inject({
    method: "GET",
    url: `/docs/${id}/export?format=docx&version=2`,
    headers,
  });
  assert.equal(word.statusCode, 200);
  const { readZip } = await import("../src/modules/imports/docx.js");
  const xml =
    readZip(word.rawPayload).get("word/document.xml")?.().toString("utf8") ??
    "";
  assert.match(xml, /Private page/);
  assert.match(xml, /Continuation/);
  assert.match(xml, /w:pBdr/);
  assert.ok(!xml.includes(privateId));
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/docs/${id}/export?format=md&version=1`,
        headers,
      })
    ).statusCode,
    409,
  );
});

test("capture-style append uses structured writer, retains containers and snapshots full history", async () => {
  const id = await page();
  const nodes = parseDocContainers(
    "> Existing **quote** ^words\n>\n> - Nested list\n^outer",
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const saved = await addToPage(
    owner,
    id,
    () => {
      throw new Error("Nested page must not enter the flat writer");
    },
    (document) => ({
      format: 2,
      nodes: appendDocContainerBlocks(document.nodes, [
        { type: "paragraph", id: "capture", text: "Captured words" },
      ]),
    }),
  );
  assert.equal(saved.version, 3);
  const current = await readVersionedDoc(pool, owner, id, [1, 2]);
  assert.equal(current.document.format, 2);
  if (current.document.format !== 2) throw new Error("Lost structured format");
  assert.deepEqual(current.document.nodes.slice(0, -1), nodes);
  assert.equal((current.document.nodes.at(-1) as any).block.id, "capture");
  const history = (
    await pool.query(
      "SELECT content_format,content_nodes FROM doc_versions WHERE doc_id=$1 AND version=2",
      [id],
    )
  ).rows[0];
  assert.equal(history.content_format, 2);
  assert.deepEqual(history.content_nodes, nodes);
});

test("unsupported or unauthorized append cannot mutate a structured page", async () => {
  const id = await page();
  const nodes = parseDocContainers("> Preserved ^words\n^outer", {
    anchors: true,
  });
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  await assert.rejects(
    addToPage(owner, id, () => []),
    refuses(409),
  );
  await assert.rejects(
    addToPage(
      stranger,
      id,
      () => [],
      () => {
        throw new Error("Unauthorized callback");
      },
    ),
    refuses(404),
  );
  const current = await readVersionedDoc(pool, owner, id, [1, 2]);
  assert.equal(current.version, 2);
  assert.deepEqual(current.document, { format: 2, nodes });
});

test("merge keeps structured source/target/relink trees and complete history", async () => {
  const source = await page(),
    target = await page(owner, [
      { type: "paragraph", id: "shared", text: "Target" },
    ]);
  const nodes = parseDocContainers(
    "> Moved words ^shared\n>\n> - Child ^child\n^owner",
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, source, 1, { format: 2, nodes }, [1, 2]),
  );
  const pointer = await page();
  const pointerNodes = parseDocContainers(
    `> [Read](orbyn://doc/${source}#shared) ^ref\n^pointer-owner`,
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      pointer,
      1,
      { format: 2, nodes: pointerNodes },
      [1, 2],
    ),
  );
  const response = await app.inject({
    method: "POST",
    url: `/docs/${source}/merge`,
    headers: { authorization: `Bearer ${token}` },
    payload: { into: target, version: 2 },
  });
  assert.equal(response.statusCode, 200, response.body);
  const result = await readVersionedDoc(pool, owner, target, [1, 2]);
  if (result.document.format !== 2) throw new Error("Merged tree flattened");
  const moved = result.document.nodes.at(-1) as any;
  assert.equal(moved.kind, "quote");
  assert.equal(moved.id, "owner");
  assert.notEqual(moved.children[0].block.id, "shared");
  assert.equal(moved.children[1].kind, "list");
  const linked = await readVersionedDoc(pool, owner, pointer, [1, 2]);
  if (linked.document.format !== 2) throw new Error("Relinked tree flattened");
  assert.equal((linked.document.nodes[0] as any).id, "pointer-owner");
  assert.equal(
    (linked.document.nodes[0] as any).children[0].block.text,
    `[Read](orbyn://doc/${target}#${moved.children[0].block.id})`,
  );
  const history = (
    await pool.query(
      "SELECT content_format,content_nodes FROM doc_versions WHERE doc_id=$1 AND version=2",
      [pointer],
    )
  ).rows[0];
  assert.equal(history.content_format, 2);
  assert.deepEqual(history.content_nodes, pointerNodes);
  assert.equal(
    (
      await pool.query("SELECT merged_into,deleted_at FROM docs WHERE id=$1", [
        source,
      ])
    ).rows[0].merged_into,
    target,
  );
});

test("nested checklist creates one stable task and synchronizes completion without flattening", async () => {
  const id = await page();
  const nodes = parseDocContainers(
    "> - [ ] Open ^open\n> - [x] Finished ^finished\n> - Plain ^plain\n^owner",
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const url = `/docs/${id}/tasks`;
  const headers = { authorization: `Bearer ${token}` };
  assert.equal(
    (await app.inject({ method: "POST", url, payload: {} })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${strangerToken}` },
        payload: {},
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: { ...headers, "content-type": "application/json" },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  const made = await app.inject({
    method: "POST",
    url,
    headers,
    payload: { block_ids: ["open", "finished", "plain"] },
  });
  assert.equal(made.statusCode, 200, made.body);
  assert.equal(made.json().created, 1);
  const task = made.json().items[0];
  assert.equal(task.title, "Open");
  const again = await app.inject({ method: "POST", url, headers, payload: {} });
  assert.equal(again.json().created, 0);
  const current = await readVersionedDoc(pool, owner, id, [1, 2]);
  if (current.document.format !== 2) throw new Error("Checklist flattened");
  assert.deepEqual(
    docContainerBlocks(current.document.nodes),
    docContainerBlocks(nodes),
  );
  const changed = structuredClone(current.document);
  const list = (changed.nodes[0] as any).children[0];
  list.items[0].checked = true;
  const completed = await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      id,
      current.version,
      changed,
      [1, 2],
      current.version,
    ),
  );
  assert.equal(
    (await pool.query("SELECT status FROM items WHERE id=$1", [task.id]))
      .rows[0].status,
    "done",
  );
  if (completed.document.format !== 2) throw new Error("Checklist flattened");
  assert.equal(
    (docContainerTaskBlocks(completed.document.nodes)[0] as any).done,
    true,
  );
  const { setItemStatus } = await import("../src/modules/items/service.js");
  await transaction((db) => setItemStatus(db, owner, task.id, "todo", 0));
  const reopened = await readVersionedDoc(pool, owner, id, [1, 2]);
  if (reopened.document.format !== 2) throw new Error("Checklist flattened");
  assert.equal(
    (docContainerTaskBlocks(reopened.document.nodes)[0] as any).done,
    false,
  );
  const stored = (
    await pool.query("SELECT content,content_nodes FROM docs WHERE id=$1", [id])
  ).rows[0];
  assert.deepEqual(stored.content, docContainerBlocks(stored.content_nodes));
  assert.equal(stored.content_nodes[0].id, "owner");
});

test("stale nested tick cannot undo a task completion change from elsewhere", async () => {
  const id = await page();
  const nodes = parseDocContainers("- [ ] Work ^work", { anchors: true });
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const made = await app.inject({
    method: "POST",
    url: `/docs/${id}/tasks`,
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(made.statusCode, 200, made.body);
  const before = await readVersionedDoc(pool, owner, id, [1, 2]);
  const { setItemStatus } = await import("../src/modules/items/service.js");
  await transaction((db) =>
    setItemStatus(db, owner, made.json().items[0].id, "done", 100),
  );
  const current = await readVersionedDoc(pool, owner, id, [1, 2]);
  assert.ok(current.version > before.version);
  const saved = await transaction((db) =>
    saveVersionedDoc(
      db,
      owner,
      id,
      current.version,
      before.document,
      [1, 2],
      before.version,
    ),
  );
  if (saved.document.format !== 2) throw new Error("Checklist flattened");
  assert.equal(
    (docContainerTaskBlocks(saved.document.nodes)[0] as any).done,
    true,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM items WHERE id=$1", [
        made.json().items[0].id,
      ])
    ).rows[0].status,
    "done",
  );
});

test("extract keeps nested task ownership and complete source history", async () => {
  const id = await page();
  const nodes = parseDocContainers(
    "> - [x] Task ^task\n>\n>   Continuation ^continuation\n> - Other ^other",
    { anchors: true },
  );
  await transaction((db) =>
    saveVersionedDoc(db, owner, id, 1, { format: 2, nodes }, [1, 2]),
  );
  const response = await app.inject({
    method: "POST",
    url: `/docs/${id}/extract`,
    headers: { authorization: `Bearer ${token}` },
    payload: { version: 2, block_ids: ["task"], title: "Moved task" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const destination = response.json().doc.id;
  const moved = await readVersionedDoc(pool, owner, destination, [1, 2]);
  const remaining = await readVersionedDoc(pool, owner, id, [1, 2]);
  if (moved.document.format !== 2 || remaining.document.format !== 2)
    throw new Error("Extraction flattened ownership");
  assert.deepEqual(
    docContainerTaskBlocks(moved.document.nodes)
      .filter((b) => b.type === "todo")
      .map((b) => b.id),
    ["task"],
  );
  assert.equal(
    docContainerTaskBlocks(remaining.document.nodes).filter(
      (b) => b.type === "todo",
    ).length,
    0,
  );
  assert.ok(
    docContainerBlocks(remaining.document.nodes).some(
      (b) => b.id === "continuation",
    ),
  );
  const history = (
    await pool.query(
      "SELECT content_nodes FROM doc_versions WHERE doc_id=$1 AND version=2",
      [id],
    )
  ).rows[0];
  assert.deepEqual(history.content_nodes, nodes);
  assert.equal(remaining.version, 3);
});

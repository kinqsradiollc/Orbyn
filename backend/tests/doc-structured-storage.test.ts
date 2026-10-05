import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { parseDocContainers, docContainerBlocks, HttpError } from "@orbyn/core";
import type { UserRow } from "../src/lib/auth.js";
const { migrate } = await import("../src/db/migrate.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { buildApp } = await import("../src/app.js");
const { readVersionedDoc, saveVersionedDoc } =
  await import("../src/modules/docs/content-format.js");
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

test("Markdown export routes retain nested ownership and refuse unsupported lossy formats", async () => {
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
  for (const format of ["docx", "txt"]) {
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/docs/${id}/export?format=${format}&version=2`,
          headers,
        })
      ).statusCode,
      409,
    );
  }
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

import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { helpers } from "./mcp-helpers.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const h = helpers(app);
let owner: Awaited<ReturnType<typeof h.register>>;
let outsider: typeof owner;
before(async () => {
  await migrate();
  owner = await h.register("comment-owner");
  outsider = await h.register("comment-outsider");
});
after(async () => {
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner.id, outsider.id],
  ]);
  await pool.end();
});
async function page(team_id?: string) {
  const r = await h.call(owner.token, "POST", "/docs", {
    title: "Comment endpoint",
    ...(team_id ? { team_id } : {}),
    content: [{ id: "selected", type: "paragraph", text: "Page source" }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
test("human @orbyn comment queues exactly one scoped binding and ordinary comments do not", async () => {
  const doc = await page();
  const url = `/docs/${doc.id}/comments`;
  assert.equal(
    (await h.call(owner.token, "POST", url, { body: "Ordinary comment" }))
      .statusCode,
    201,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM assistant_page_bindings WHERE doc_id=$1",
        [doc.id],
      )
    ).rowCount,
    0,
  );
  const requested = await h.call(owner.token, "POST", url, {
    body: "@orbyn summarize this",
    block_id: "selected",
  });
  assert.equal(requested.statusCode, 201, requested.body);
  const rows = (
    await pool.query(
      "SELECT source_comment_id,snapshot FROM assistant_page_bindings WHERE doc_id=$1",
      [doc.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_comment_id, requested.json().id);
  assert.deepEqual(rows[0].snapshot.blocks, [
    { block_id: "selected", position: 0 },
  ]);
});
test("strangers cannot create comment work and suspended assistants roll back the request", async () => {
  const doc = await page();
  const url = `/docs/${doc.id}/comments`;
  assert.equal(
    (await h.call(outsider.token, "POST", url, { body: "@orbyn summarize" }))
      .statusCode,
    404,
  );
  await h.call(owner.token, "POST", url, { body: "@orbyn summarize" });
  await pool.query(
    "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1 AND kind='assistant'",
    [owner.id],
  );
  try {
    const count = (
      await pool.query("SELECT count(*) FROM doc_comments WHERE doc_id=$1", [
        doc.id,
      ])
    ).rows[0].count;
    const response = await h.call(owner.token, "POST", url, {
      body: "@orbyn another request",
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(
      (
        await pool.query("SELECT count(*) FROM doc_comments WHERE doc_id=$1", [
          doc.id,
        ])
      ).rows[0].count,
      count,
    );
  } finally {
    await pool.query(
      "UPDATE agent_grants SET suspended_at=NULL WHERE user_id=$1 AND kind='assistant'",
      [owner.id],
    );
  }
});
test("read-only team members cannot create background page work through comments", async () => {
  const team = await h.team(owner, "Comment permission", [
    [outsider, "viewer"],
  ]);
  try {
    const doc = await page(team);
    const response = await h.call(
      outsider.token,
      "POST",
      `/docs/${doc.id}/comments`,
      { body: "@orbyn summarize this" },
    );
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM assistant_page_bindings WHERE doc_id=$1",
          [doc.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

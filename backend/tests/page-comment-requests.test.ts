import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UserRow } from "../src/lib/auth.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { addComment, deleteComment, resolveComment } =
  await import("../src/modules/documents/comments.js");
const { createPageCommentRequest } =
  await import("../src/modules/documents/comment-requests.js");
const {
  maintainedPageContext,
  applyMaintainedPageReply,
  applyMaintainedPageUpdate,
} = await import("../src/modules/documents/maintenance.js");
const {
  queueMaintainedPageRun,
  claimMaintainedPageRun,
  guardMaintainedPageRun,
  stageMaintainedPageRun,
  expireMaintainedPageRuns,
} = await import("../src/modules/documents/maintenance-runs.js");
const { pageCommentMessages } =
  await import("../src/modules/documents/maintenance-model.js");
const { scanMaintainedPages } =
  await import("../src/worker/maintained-page-scan.js");
const people: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [people]);
  await pool.end();
});
async function fixture() {
  const id = randomUUID();
  people.push(id);
  const user = (
    await pool.query<UserRow>(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Page asker','unusable') RETURNING *",
      [id, `comment-${id}@orbyn.test`],
    )
  ).rows[0];
  const principal = await assistantPrincipal(user);
  const content = [
    { id: "selected", type: "paragraph", text: "Selected source." },
    {
      id: "human",
      type: "paragraph",
      text: "Do not send these unrelated words.",
    },
  ];
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Scoped reply',$2::jsonb) RETURNING id,version",
      [id, JSON.stringify(content)],
    )
  ).rows[0];
  const comment = await transaction(async (db) => {
    const current = await assistantPrincipal(user, { db, lane: "background" });
    const c = await addComment(db, user, doc.id, {
      body: "@orbyn summarize this",
      block_id: "selected",
      mentions: [],
    });
    await createPageCommentRequest(db, user, c, current);
    await createPageCommentRequest(db, user, c, current);
    return c;
  });
  const rows = (
    await pool.query(
      "SELECT * FROM assistant_page_bindings WHERE source_comment_id=$1",
      [comment.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  return { user, principal, doc, comment, binding: rows[0], content };
}
test("comment request deduplicates and only exposes its selected block and initiating remark", async () => {
  const f = await fixture();
  await transaction((db) =>
    addComment(db, f.user, f.doc.id, {
      body: "Unrelated comment secret.",
      mentions: [],
    }),
  );
  const context = await transaction((db) =>
    maintainedPageContext(db, f.user, f.principal, f.binding.id),
  );
  assert.deepEqual(context.blocks, [f.content[0]]);
  assert.equal(context.comment?.id, f.comment.id);
  const messages = JSON.stringify(
    pageCommentMessages(context.comment!.body, context.blocks, 1),
  );
  assert.ok(!messages.includes("Unrelated comment secret"));
  assert.ok(!messages.includes("unrelated words"));
  await assert.rejects(
    transaction((db) =>
      applyMaintainedPageUpdate(db, f.user, f.principal, f.binding.id, {
        expected_revision: 1,
        replacements: [f.content[0]],
      }),
    ),
    /only publish replies/,
  );
  const now = new Date(Date.now() + 1000);
  const run = await transaction((db) =>
    queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, now, {
      kind: "background",
    }),
  );
  assert.ok(run);
  assert.equal(
    (
      await pool.query(
        "SELECT schedule_exhausted FROM assistant_page_bindings WHERE id=$1",
        [f.binding.id],
      )
    ).rows[0].schedule_exhausted,
    true,
  );
  const claimed = await transaction((db) =>
    claimMaintainedPageRun(db, "background", now, run.id),
  );
  assert.ok(claimed?.lease_token);
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      run.id,
      claimed.lease_token!,
      { expected_revision: 1, reply: "Selected source summary." },
      10,
      now,
    ),
  );
  await transaction(async (db) => {
    const context = await guardMaintainedPageRun(
      db,
      run.id,
      claimed.lease_token!,
      now,
    );
    await applyMaintainedPageReply(
      db,
      f.user,
      context.principal,
      f.binding.id,
      context.run.proposal,
      { asking: { mode: "approved", reviewed: true, reasons: [] } },
    );
    await applyMaintainedPageReply(
      db,
      f.user,
      context.principal,
      f.binding.id,
      context.run.proposal,
      { asking: { mode: "approved", reviewed: true, reasons: [] } },
    );
  });
  const replies = (
    await pool.query(
      "SELECT * FROM doc_comments WHERE assistant_request_id=$1",
      [f.comment.id],
    )
  ).rows;
  assert.equal(replies.length, 1);
  assert.equal(replies[0].parent_id, f.comment.id);
  assert.equal(replies[0].via_grant_id, f.principal.grant_id);
  assert.deepEqual(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id]))
      .rows[0].content,
    f.content,
  );
});
test("resolved or changed comment invalidates queued work before claim", async () => {
  const f = await fixture();
  const now = new Date(Date.now() + 1000);
  const run = await transaction((db) =>
    queueMaintainedPageRun(db, f.user, f.principal, f.binding.id, now, {
      kind: "background",
    }),
  );
  assert.ok(run);
  await transaction((db) =>
    resolveComment(db, f.user, f.doc.id, f.comment.id, true),
  );
  await transaction((db) => expireMaintainedPageRuns(db, "background", now));
  assert.equal(
    (
      await pool.query("SELECT state FROM assistant_page_runs WHERE id=$1", [
        run.id,
      ])
    ).rows[0].state,
    "cancelled",
  );
  await assert.rejects(
    transaction((db) =>
      maintainedPageContext(db, f.user, f.principal, f.binding.id),
    ),
    /changed or was removed/,
  );
});
test("resolving a parent thread invalidates an attached request", async () => {
  const f = await fixture();
  const parent = await transaction((db) =>
    addComment(db, f.user, f.doc.id, {
      body: "Discuss this block",
      block_id: "selected",
      mentions: [],
    }),
  );
  const request = await transaction(async (db) => {
    const principal = await assistantPrincipal(f.user, {
      db,
      lane: "background",
    });
    const comment = await addComment(db, f.user, f.doc.id, {
      body: "@orbyn explain",
      parent_id: parent.id,
      block_id: "selected",
      mentions: [],
    });
    await createPageCommentRequest(db, f.user, comment, principal);
    return comment;
  });
  const binding = (
    await pool.query(
      "SELECT id FROM assistant_page_bindings WHERE source_comment_id=$1",
      [request.id],
    )
  ).rows[0];
  await transaction((db) =>
    resolveComment(db, f.user, f.doc.id, parent.id, true),
  );
  await assert.rejects(
    transaction((db) =>
      maintainedPageContext(db, f.user, f.principal, binding.id),
    ),
    /thread was resolved/,
  );
  await scanMaintainedPages(new Date(Date.now() + 1000), { only: [f.user.id] });
  assert.equal(
    (
      await pool.query(
        "SELECT schedule_exhausted FROM assistant_page_bindings WHERE id=$1",
        [binding.id],
      )
    ).rows[0].schedule_exhausted,
    true,
  );
});
test("scanner retires withdrawn pre-queue comments and releases the full request quota", async () => {
  const f = await fixture();
  const make = () =>
    transaction(async (db) => {
      const principal = await assistantPrincipal(f.user, {
        db,
        lane: "background",
      });
      const c = await addComment(db, f.user, f.doc.id, {
        body: "@orbyn summarize",
        block_id: "selected",
        mentions: [],
      });
      await createPageCommentRequest(db, f.user, c, principal);
      return c;
    });
  const comments = [f.comment];
  for (let i = 1; i < 100; i++) comments.push(await make());
  await assert.rejects(make(), /100 page bindings/);
  for (const c of comments.slice(0, 50))
    await transaction((db) => resolveComment(db, f.user, f.doc.id, c.id, true));
  // A captured revision cannot be reused after editing its initiating remark.
  await pool.query(
    "UPDATE doc_comments SET body='Withdrawn',revision=revision+1 WHERE id=ANY($1::uuid[])",
    [comments.slice(50).map((c) => c.id)],
  );
  await pool.query("UPDATE agent_grants SET suspended_at=now() WHERE id=$1", [
    f.principal.grant_id,
  ]);
  assert.equal(
    await scanMaintainedPages(new Date(Date.now() + 1000), {
      only: [f.user.id],
    }),
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_page_bindings WHERE user_id=$1 AND NOT schedule_exhausted",
        [f.user.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM doc_comments WHERE doc_id=$1 AND assistant_request_id IS NOT NULL",
        [f.doc.id],
      )
    ).rows[0].n,
    0,
  );
  await pool.query("UPDATE agent_grants SET suspended_at=NULL WHERE id=$1", [
    f.principal.grant_id,
  ]);
  await make();
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_page_bindings WHERE user_id=$1 AND NOT schedule_exhausted",
        [f.user.id],
      )
    ).rows[0].n,
    1,
  );
});
test("deleting the originating comment removes its request and any committed reply", async () => {
  const f = await fixture();
  await transaction((db) =>
    applyMaintainedPageReply(
      db,
      f.user,
      f.principal,
      f.binding.id,
      { expected_revision: 1, reply: "A scoped reply." },
      { asking: { mode: "approved", reviewed: true, reasons: [] } },
    ),
  );
  await transaction((db) => deleteComment(db, f.user, f.doc.id, f.comment.id));
  assert.equal(
    (
      await pool.query("SELECT id FROM assistant_page_bindings WHERE id=$1", [
        f.binding.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM doc_comments WHERE assistant_request_id=$1",
        [f.comment.id],
      )
    ).rowCount,
    0,
  );
});

import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
after(async () => {
  await pool.end();
});

test("independent embedding schema upgrades idempotently and disables legacy workers", async () => {
  await migrate();
  await migrate();
  const state = (
    await pool.query(
      "SELECT semantic_search, embedding_search_enabled, embedding_dimensions FROM ai_settings",
    )
  ).rows[0];
  assert.deepEqual(state, {
    semantic_search: false,
    embedding_search_enabled: false,
    embedding_dimensions: null,
  });
  await assert.rejects(
    pool.query("UPDATE ai_settings SET semantic_search = true"),
    (error: any) => error.code === "23514",
  );
  await assert.rejects(
    pool.query("UPDATE ai_settings SET embedding_dimensions = 16001"),
    (error: any) => error.code === "23514",
  );
  const dimensions = (
    await pool.query(
      "SELECT atttypmod FROM pg_attribute WHERE attrelid='doc_embeddings'::regclass AND attname='embedding'",
    )
  ).rows[0];
  assert.equal(
    dimensions.atttypmod,
    -1,
    "storage accepts verified dimensions without a fixed typmod",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT to_regclass('doc_embeddings_vector_idx') AS index",
      )
    ).rows[0].index,
    null,
    "legacy fixed-dimension HNSW index is not recreated",
  );
});

test("provider edits and repeated document changes receive distinct revision tokens", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const provider = (
      await client.query(
        "INSERT INTO ai_providers(kind,name) VALUES ('openai','Test') RETURNING id, embedding_revision",
      )
    ).rows[0];
    assert.equal(provider.embedding_revision, "1");
    const changed = (
      await client.query(
        "UPDATE ai_providers SET options = '{\"fixture\":true}' WHERE id=$1 RETURNING embedding_revision",
        [provider.id],
      )
    ).rows[0];
    assert.equal(changed.embedding_revision, "2");
    const user = (
      await client.query(
        "INSERT INTO users(email,name,password_hash) VALUES ($1,'Fixture','unusable-test-hash') RETURNING id",
        [`embedding-${randomUUID()}@example.com`],
      )
    ).rows[0];
    const doc = (
      await client.query(
        "INSERT INTO docs(user_id,content) VALUES ($1,'[]') RETURNING id",
        [user.id],
      )
    ).rows[0];
    const queued = async () =>
      (
        await client.query(
          "SELECT queue_revision FROM doc_embedding_queue WHERE doc_id=$1",
          [doc.id],
        )
      ).rows[0]?.queue_revision;
    const first = await queued();
    assert.ok(first);
    await client.query("UPDATE docs SET version=version+1 WHERE id=$1", [
      doc.id,
    ]);
    const second = await queued();
    assert.notEqual(
      first,
      second,
      "same transaction timestamp cannot collapse edit identity",
    );
    assert.equal(
      (
        await client.query(
          "DELETE FROM doc_embedding_queue WHERE doc_id=$1 AND queue_revision=$2",
          [doc.id, first],
        )
      ).rowCount,
      0,
      "old acknowledgement leaves the newer edit queued",
    );
    await client.query(
      "UPDATE docs SET deleted_at=now(),version=version+1 WHERE id=$1",
      [doc.id],
    );
    assert.equal(await queued(), undefined, "trash removes queued work");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("measuring uses the independent provider and discards an answer for an edited document", async () => {
  const { measureQueued, nearest } =
    await import("../src/modules/search/semantic.js");
  let entered: (() => void) | undefined;
  let resume: (() => void) | undefined;
  let barrier: Promise<void> | undefined;
  const requested: string[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", async () => {
      const body = JSON.parse(raw);
      requested.push(body.model);
      entered?.();
      if (barrier) await barrier;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: body.input
            .map((_: string, index: number) => ({
              index,
              embedding: [1, 0, 0],
            }))
            .reverse(),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let userId: string | undefined;
  const providerIds: string[] = [];
  try {
    const generation = (
      await pool.query(
        "INSERT INTO ai_providers(kind,name,base_url) VALUES ('openai','Generation','https://unused.invalid') RETURNING id",
      )
    ).rows[0].id;
    providerIds.push(generation);
    const embedding = (
      await pool.query(
        "INSERT INTO ai_providers(kind,name,base_url) VALUES ('openai','Embeddings',$1) RETURNING id",
        [`http://127.0.0.1:${(server.address() as { port: number }).port}`],
      )
    ).rows[0].id;
    providerIds.push(embedding);
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model='chat-model',embedding_search_enabled=true,embedding_provider_id=$2,embedding_provider_revision=1,embedding_model='embedding-model',embedding_dimensions=3,semantic_accepted_at=now(),embedding_generation=gen_random_uuid()",
      [generation, embedding],
    );
    userId = (
      await pool.query(
        "INSERT INTO users(email,name,password_hash) VALUES ($1,'Fixture','unusable-test-hash') RETURNING id",
        [`worker-${randomUUID()}@example.com`],
      )
    ).rows[0].id;
    const content = [
      {
        id: "passage",
        type: "paragraph",
        text: "An original passage with enough words.",
      },
    ];
    const docId = (
      await pool.query(
        "INSERT INTO docs(user_id,content) VALUES ($1,$2::jsonb) RETURNING id",
        [userId, JSON.stringify(content)],
      )
    ).rows[0].id;
    assert.equal(await measureQueued(), 1);
    assert.equal((await nearest(userId!, "original passage")).length, 1);
    assert.deepEqual(
      await nearest(randomUUID(), "original passage"),
      [],
      "read access remains required",
    );
    assert.ok(
      requested.every((model) => model === "embedding-model"),
      "generation connection is never called",
    );
    await pool.query(
      "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
      [
        docId,
        JSON.stringify([
          { ...content[0], text: "A changed passage with enough words." },
        ]),
      ],
    );
    const received = new Promise<void>((resolve) => {
      entered = resolve;
    });
    barrier = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const measuring = measureQueued();
    await received;
    await pool.query(
      "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
      [
        docId,
        JSON.stringify([
          { ...content[0], text: "The newest passage still has enough words." },
        ]),
      ],
    );
    resume!();
    assert.equal(
      await measuring,
      0,
      "old provider answer cannot acknowledge a newer document",
    );
    barrier = undefined;
    entered = undefined;
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM doc_embedding_queue WHERE doc_id=$1",
          [docId],
        )
      ).rows[0].count,
      1,
    );
    assert.deepEqual(
      await nearest(userId!, "original passage"),
      [],
      "old document versions cannot answer search",
    );
    assert.equal(
      await measureQueued(),
      1,
      "new edit can subsequently be measured",
    );
    const beforeRevision = requested.length;
    await pool.query("UPDATE ai_providers SET options=options WHERE id=$1", [
      embedding,
    ]);
    assert.deepEqual(
      await nearest(userId!, "passage"),
      [],
      "provider revision changes invalidate accepted configuration",
    );
    assert.equal(
      requested.length,
      beforeRevision,
      "invalidated consent sends no query text",
    );
    // Simulate explicit renewed acceptance in this service-level fixture.
    await pool.query(
      "UPDATE ai_settings SET embedding_provider_revision=2,embedding_generation=gen_random_uuid()",
    );
    await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [docId]);
    const disableReceived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    barrier = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const disablingRun = measureQueued();
    await disableReceived;
    await pool.query(
      "UPDATE ai_settings SET embedding_search_enabled=false,embedding_generation=gen_random_uuid()",
    );
    resume!();
    assert.equal(
      await disablingRun,
      0,
      "disable during provider call prevents stale writes",
    );
    barrier = undefined;
    entered = undefined;
    assert.deepEqual(await nearest(userId!, "passage"), []);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM doc_embedding_queue WHERE doc_id=$1",
          [docId],
        )
      ).rows[0].count,
      1,
      "discarded response cannot clear pending work",
    );
  } finally {
    resume?.();
    await pool.query(
      "UPDATE ai_settings SET provider_id=NULL,model='',embedding_search_enabled=false,embedding_provider_id=NULL,embedding_provider_revision=NULL,embedding_model='',embedding_dimensions=NULL,semantic_accepted_at=NULL,embedding_generation=gen_random_uuid()",
    );
    if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.query("DELETE FROM ai_providers WHERE id=ANY($1::uuid[])", [
      providerIds,
    ]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

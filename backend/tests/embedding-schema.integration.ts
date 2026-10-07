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
    await client.query(
      "INSERT INTO doc_embeddings(doc_id,block_id,quote,embedding,model,embedding_generation,doc_version) SELECT $1,'legacy-guard','Current accepted passage','[1,0,0]'::vector,'fixture',embedding_generation,1 FROM ai_settings",
      [doc.id],
    );
    await client.query("SAVEPOINT legacy_write");
    await assert.rejects(
      client.query(
        "INSERT INTO doc_embeddings(doc_id,block_id,quote,embedding,model) VALUES ($1,'legacy-guard','Stale legacy passage','[0,1,0]'::vector,'old-model') ON CONFLICT(doc_id,block_id) DO UPDATE SET quote=excluded.quote,embedding=excluded.embedding,model=excluded.model",
        [doc.id],
      ),
      (error: any) => error.code === "23502",
    );
    await client.query("ROLLBACK TO SAVEPOINT legacy_write");
    assert.equal(
      (
        await client.query(
          "SELECT quote FROM doc_embeddings WHERE doc_id=$1 AND block_id='legacy-guard'",
          [doc.id],
        )
      ).rows[0].quote,
      "Current accepted passage",
    );
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
    await pool.query("UPDATE ai_providers SET options=options WHERE id=$1", [
      embedding,
    ]);
    await pool.query(
      'UPDATE ai_providers SET options=options || \'{"reasoningEffort":"high","cacheMode":"explicit"}\'::jsonb WHERE id=$1',
      [embedding],
    );
    assert.equal(
      (await nearest(userId!, "passage")).length > 0,
      true,
      "no-op and generation-only edits preserve measured embedding search",
    );
    const beforeRevision = requested.length;
    await pool.query(
      'UPDATE ai_providers SET options=options || \'{"apiVersion":"fixture-v2"}\'::jsonb WHERE id=$1',
      [embedding],
    );
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

test("project and team keep-out changes prevent later batches and final storage", async () => {
  const { measureQueued } = await import("../src/modules/search/semantic.js");
  let changePermission: (() => Promise<void>) | undefined;
  const batchSizes: number[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", async () => {
      const body = JSON.parse(raw);
      batchSizes.push(body.input.length);
      await changePermission?.();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: body.input.map((_: string, index: number) => ({
            index,
            embedding: [1, 0, 0],
          })),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let user: string | undefined;
  let provider: string | undefined;
  const teams: string[] = [];
  try {
    user = (
      await pool.query(
        "INSERT INTO users(email,name,password_hash) VALUES ($1,'Fixture','unusable-test-hash') RETURNING id",
        [`permission-${randomUUID()}@example.com`],
      )
    ).rows[0].id;
    provider = (
      await pool.query(
        "INSERT INTO ai_providers(kind,name,base_url) VALUES ('openai','Permission fixture',$1) RETURNING id",
        [`http://127.0.0.1:${(server.address() as { port: number }).port}`],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE ai_settings SET embedding_search_enabled=true,embedding_provider_id=$1,embedding_provider_revision=1,embedding_dimensions=3,embedding_model='fixture',semantic_accepted_at=now(),embedding_generation=gen_random_uuid()",
      [provider],
    );
    const project = (
      await pool.query(
        "INSERT INTO projects(user_id,name) VALUES ($1,'Permission fixture') RETURNING id",
        [user],
      )
    ).rows[0].id;
    const projectDoc = (
      await pool.query(
        "INSERT INTO docs(user_id,project_id,content) VALUES ($1,$2,$3::jsonb) RETURNING id",
        [
          user,
          project,
          JSON.stringify(
            Array.from({ length: 65 }, (_, i) => ({
              id: `p${i}`,
              type: "paragraph",
              text: `Paragraph ${i} has enough words to measure.`,
            })),
          ),
        ],
      )
    ).rows[0].id;
    changePermission = async () => {
      await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        project,
      ]);
    };
    assert.equal(await measureQueued(), 0);
    assert.deepEqual(
      batchSizes,
      [64],
      "the second batch is not sent after project keep-out",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM doc_embeddings WHERE doc_id=$1",
          [projectDoc],
        )
      ).rows[0].count,
      0,
    );
    const team = (
      await pool.query(
        "INSERT INTO teams(name,created_by) VALUES ('Permission fixture',$1) RETURNING id",
        [user],
      )
    ).rows[0].id;
    teams.push(team);
    const teamDoc = (
      await pool.query(
        "INSERT INTO docs(user_id,team_id,content) VALUES ($1,$2,$3::jsonb) RETURNING id",
        [
          user,
          team,
          JSON.stringify([
            {
              id: "team",
              type: "paragraph",
              text: "A team paragraph with enough words.",
            },
          ]),
        ],
      )
    ).rows[0].id;
    changePermission = async () => {
      await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
        team,
      ]);
    };
    assert.equal(await measureQueued(), 0);
    assert.deepEqual(batchSizes, [64, 1]);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM doc_embeddings WHERE doc_id=$1",
          [teamDoc],
        )
      ).rows[0].count,
      0,
      "a changed team policy prevents the completed response from being stored",
    );
  } finally {
    await pool.query(
      "UPDATE ai_settings SET embedding_search_enabled=false,embedding_provider_id=NULL,embedding_provider_revision=NULL,embedding_dimensions=NULL,embedding_model='',semantic_accepted_at=NULL,embedding_generation=gen_random_uuid()",
    );
    await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
    if (user) await pool.query("DELETE FROM users WHERE id=$1", [user]);
    if (provider)
      await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

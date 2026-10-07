import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { measureQueued, nearest } =
  await import("../src/modules/search/semantic.js");
after(() => pool.end());

test("native Perplexity signed vectors survive storage/search and full dimension replacement", async (t) => {
  await migrate();
  const owner = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash) VALUES($1,'Inert fixture','unusable') RETURNING id",
      [`perplexity-vector-${randomUUID()}@example.com`],
    )
  ).rows[0].id;
  let provider: string | undefined;
  const requests: { url: string; model: string; encoding: string }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(String(url), "https://api.perplexity.ai/v1/embeddings");
      assert.equal(body.encoding_format, "base64_int8");
      const width =
        body.model === "pplx-embed-v1-0.6b"
          ? 1024
          : body.model === "pplx-embed-v1-4b"
            ? 2560
            : 0;
      assert.ok(width);
      requests.push({
        url: String(url),
        model: body.model,
        encoding: body.encoding_format,
      });
      const bytes = Buffer.alloc(width);
      bytes[0] = 127;
      bytes[1] = 128;
      bytes[2] = 255;
      return Response.json({
        data: body.input.map((_: string, index: number) => ({
          index,
          embedding: bytes.toString("base64"),
        })),
      });
    },
  );
  try {
    provider = (
      await pool.query(
        "INSERT INTO ai_providers(kind,name,base_url) VALUES('perplexity','Inert native fixture','https://api.perplexity.ai') RETURNING id",
      )
    ).rows[0].id;
    const doc = (
      await pool.query(
        "INSERT INTO docs(user_id,content) VALUES($1,$2::jsonb) RETURNING id",
        [
          owner,
          JSON.stringify([
            {
              id: "fixture",
              type: "paragraph",
              text: "Inert document with enough fixed words.",
            },
          ]),
        ],
      )
    ).rows[0].id;
    for (const [model, dimensions] of [
      ["pplx-embed-v1-0.6b", 1024],
      ["pplx-embed-v1-4b", 2560],
    ] as const) {
      await pool.query(
        "UPDATE ai_settings SET embedding_search_enabled=true,embedding_provider_id=$1,embedding_provider_revision=1,embedding_model=$2,embedding_dimensions=$3,embedding_generation=gen_random_uuid(),semantic_accepted_at=now(),semantic_accepted_by=$4",
        [provider, model, dimensions, owner],
      );
      if (dimensions === 2560) {
        assert.deepEqual(
          await nearest(owner, "Inert query"),
          [],
          "old model generation cannot answer after replacement",
        );
        await pool.query(
          "INSERT INTO doc_embedding_queue(doc_id) VALUES($1) ON CONFLICT(doc_id) DO UPDATE SET queued_at=now(),queue_revision=gen_random_uuid()",
          [doc],
        );
      }
      assert.equal(await measureQueued(), 1);
      const stored = (
        await pool.query(
          "SELECT vector_dims(embedding) AS dimensions,model,embedding::text FROM doc_embeddings WHERE doc_id=$1",
          [doc],
        )
      ).rows[0];
      assert.equal(stored.dimensions, dimensions);
      assert.equal(stored.model, model);
      assert.deepEqual(
        JSON.parse(stored.embedding).slice(0, 3),
        [127, -128, -1],
      );
      const hits = await nearest(owner, "Inert query");
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, doc);
      assert.ok(hits[0].nearness > 0.99);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM doc_embedding_queue WHERE doc_id=$1",
            [doc],
          )
        ).rows[0].count,
        0,
      );
    }
    assert.equal(requests.length, 5);
  } finally {
    await pool.query(
      "UPDATE ai_settings SET embedding_search_enabled=false,embedding_provider_id=NULL,embedding_provider_revision=NULL,embedding_model='',embedding_dimensions=NULL,semantic_accepted_at=NULL,semantic_accepted_by=NULL,embedding_generation=gen_random_uuid()",
    );
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    if (provider)
      await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
  }
});

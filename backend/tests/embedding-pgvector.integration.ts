import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
const { embed, ProviderError } =
  await import("../src/modules/ai/providers/adapters.js");
const { pool } = await import("../src/db/pool.js");

// Explicit opt-in: this test requires the marked pgvector test database.
// The ordinary stock-Postgres suite continues to exercise the disabled path.
test("Azure indexed vectors survive PostgreSQL storage and cosine search", async () => {
  const vector = (axis: number) =>
    Array.from({ length: 3072 }, (_, i) => (i === axis ? 1 : 0));
  let malformed = false;
  const requests: { path: string; body: unknown; key: string | undefined }[] =
    [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({
        path: req.url ?? "",
        body: JSON.parse(raw),
        key: req.headers["api-key"] as string | undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: malformed
            ? [
                { index: 0, embedding: vector(0) },
                { index: 0, embedding: vector(1) },
              ]
            : [
                { index: 1, embedding: vector(1) },
                { index: 0, embedding: vector(0) },
              ],
        }),
      );
    });
  });
  const client = await pool.connect();
  try {
    assert.equal(
      (
        await client.query(
          "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS present",
        )
      ).rows[0].present,
      true,
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const ai = {
      format: "azure" as const,
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      apiKey: "test-only-azure-key",
      model: "generation-deployment",
      options: { apiVersion: "2024-10-21" },
    };
    const embeddings = await embed(ai, ["first passage", "second passage"], {
      model: "embedding-deployment",
      expectedDimensions: 3072,
    });
    assert.deepEqual(requests[0], {
      path: "/openai/deployments/embedding-deployment/embeddings?api-version=2024-10-21",
      body: { input: ["first passage", "second passage"] },
      key: "test-only-azure-key",
    });
    await client.query("BEGIN");
    await client.query(
      "CREATE TEMP TABLE embedding_probe (passage text PRIMARY KEY, embedding vector) ON COMMIT DROP",
    );
    for (const [index, embedding] of embeddings.entries()) {
      await client.query(
        "INSERT INTO embedding_probe VALUES ($1, $2::vector)",
        [
          index === 0 ? "first passage" : "second passage",
          JSON.stringify(embedding),
        ],
      );
    }
    const rows = (
      await client.query(
        "SELECT passage, vector_dims(embedding) AS dimensions, 1 - (embedding <=> $1::vector) AS score FROM embedding_probe ORDER BY embedding <=> $1::vector",
        [JSON.stringify(vector(0))],
      )
    ).rows;
    assert.deepEqual(rows, [
      { passage: "first passage", dimensions: 3072, score: 1 },
      { passage: "second passage", dimensions: 3072, score: 0 },
    ]);
    malformed = true;
    await assert.rejects(
      embed(ai, ["first passage", "second passage"], {
        model: "embedding-deployment",
      }),
      ProviderError,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::integer AS count FROM embedding_probe",
        )
      ).rows[0].count,
      2,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
});

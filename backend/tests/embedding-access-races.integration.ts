import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { measureQueued, nearest } =
  await import("../src/modules/search/semantic.js");
before(async () => {
  await migrate();
});
after(async () => {
  await pool.end();
});

/** Inert local recipient; mutations occur after receipt and before its reply. */
async function fixture(
  run: (state: {
    owner: string;
    reader: string;
    team: string;
    doc: string;
    provider: string;
    mutate: (callback: () => Promise<void>) => void;
  }) => Promise<void>,
) {
  let mutation: (() => Promise<void>) | undefined;
  let mutationCount = 0;
  let requestFailure: unknown;
  const users: string[] = [];
  let team: string | undefined;
  let provider: string | undefined;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", async () => {
      try {
        const input = JSON.parse(raw).input;
        const callback = mutation;
        mutation = undefined;
        if (callback) {
          mutationCount++;
          await callback();
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: input.map((_: string, index: number) => ({
              index,
              embedding: [1, 0, 0],
            })),
          }),
        );
      } catch (error) {
        requestFailure = error;
        res.writeHead(500);
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const name of ["owner", "reader"]) {
      users.push(
        (
          await pool.query(
            "INSERT INTO users(email,name,password_hash) VALUES($1,$2,'unusable-test-hash') RETURNING id",
            [`embedding-access-${randomUUID()}@example.com`, name],
          )
        ).rows[0].id,
      );
    }
    team = (
      await pool.query(
        "INSERT INTO teams(name,created_by) VALUES('Access fixture',$1) RETURNING id",
        [users[0]],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
      [team, ...users],
    );
    provider = (
      await pool.query(
        "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai','Inert access fixture',$1) RETURNING id",
        [`http://127.0.0.1:${(server.address() as { port: number }).port}`],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE ai_settings SET embedding_search_enabled=true,embedding_provider_id=$1,embedding_provider_revision=1,embedding_dimensions=3,embedding_model='fixture',semantic_accepted_at=now(),embedding_generation=gen_random_uuid()",
      [provider],
    );
    const doc = (
      await pool.query(
        "INSERT INTO docs(user_id,team_id,content) VALUES($1,$2,$3::jsonb) RETURNING id",
        [
          users[0],
          team,
          JSON.stringify([
            {
              id: "passage",
              type: "paragraph",
              text: "An inert passage with enough words.",
            },
          ]),
        ],
      )
    ).rows[0].id;
    await run({
      owner: users[0],
      reader: users[1],
      team: team!,
      provider: provider!,
      doc,
      mutate: (callback) => {
        mutation = callback;
      },
    });
    assert.equal(
      requestFailure,
      undefined,
      "fixture recipient/mutation succeeded",
    );
    assert.equal(
      mutationCount,
      1,
      "the intended in-flight mutation ran exactly once",
    );
  } finally {
    await pool.query(
      "UPDATE ai_settings SET embedding_search_enabled=false,embedding_provider_id=NULL,embedding_provider_revision=NULL,embedding_dimensions=NULL,embedding_model='',semantic_accepted_at=NULL,embedding_generation=gen_random_uuid()",
    );
    if (team) await pool.query("DELETE FROM teams WHERE id=$1", [team]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    if (provider)
      await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const change of [
  "membership",
  "team-keep-out",
  "private-owner",
] as const) {
  test(`semantic query withholds results after in-flight ${change} change`, async () => {
    await fixture(async (state) => {
      if (change === "private-owner")
        await pool.query("UPDATE docs SET team_id=NULL WHERE id=$1", [
          state.doc,
        ]);
      assert.equal(await measureQueued(), 1);
      const user = change === "private-owner" ? state.owner : state.reader;
      assert.equal(
        (await nearest(user, "Inert query")).length,
        1,
        "baseline has a readable current vector",
      );
      state.mutate(async () => {
        if (change === "membership")
          await pool.query(
            "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
            [state.team, state.reader],
          );
        else if (change === "team-keep-out")
          await pool.query(
            "UPDATE teams SET assistant_allowed=false WHERE id=$1",
            [state.team],
          );
        else
          await pool.query("UPDATE docs SET user_id=$2 WHERE id=$1", [
            state.doc,
            state.reader,
          ]);
      });
      assert.deepEqual(
        await nearest(user, "Inert query"),
        [],
        "post-response visibility must prevail",
      );
    });
  });
}

for (const change of [
  "trash",
  "delete",
  "provider-delete",
  "team-keep-out",
  "move-to-kept-out-team",
] as const) {
  test(`measuring withholds storage after in-flight ${change}`, async () => {
    await fixture(async (state) => {
      if (change === "move-to-kept-out-team")
        await pool.query("UPDATE docs SET team_id=NULL WHERE id=$1", [
          state.doc,
        ]);
      state.mutate(async () => {
        if (change === "trash")
          await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [
            state.doc,
          ]);
        else if (change === "delete")
          await pool.query("DELETE FROM docs WHERE id=$1", [state.doc]);
        else if (change === "provider-delete")
          await pool.query("DELETE FROM ai_providers WHERE id=$1", [
            state.provider,
          ]);
        else if (change === "team-keep-out")
          await pool.query(
            "UPDATE teams SET assistant_allowed=false WHERE id=$1",
            [state.team],
          );
        else {
          // Moving a private page into a kept-out team does not edit its content.
          await pool.query(
            "UPDATE teams SET assistant_allowed=false WHERE id=$1",
            [state.team],
          );
          await pool.query("UPDATE docs SET team_id=$2 WHERE id=$1", [
            state.doc,
            state.team,
          ]);
        }
      });
      assert.equal(await measureQueued(), 0);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::integer count FROM doc_embeddings WHERE doc_id=$1",
            [state.doc],
          )
        ).rows[0].count,
        0,
      );
      if (change !== "trash" && change !== "delete")
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer count FROM doc_embedding_queue WHERE doc_id=$1",
              [state.doc],
            )
          ).rows[0].count,
          1,
          "discarded output does not acknowledge queued work",
        );
      if (change === "team-keep-out" || change === "move-to-kept-out-team") {
        assert.equal(
          await measureQueued(),
          0,
          "kept-out work remains unprocessed",
        );
        await pool.query(
          "UPDATE teams SET assistant_allowed=true WHERE id=$1",
          [state.team],
        );
        assert.equal(
          await measureQueued(),
          1,
          "restored permission resumes queued work",
        );
        assert.equal(
          await measureQueued(),
          0,
          "completed work is acknowledged once",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer count FROM doc_embeddings WHERE doc_id=$1",
              [state.doc],
            )
          ).rows[0].count,
          1,
          "only a fresh authorized vector is stored",
        );
      }
      if (change === "trash") {
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer count FROM doc_embedding_queue WHERE doc_id=$1",
              [state.doc],
            )
          ).rows[0].count,
          0,
          "Trash intentionally removes indexing work",
        );
        await pool.query("UPDATE docs SET deleted_at=NULL WHERE id=$1", [
          state.doc,
        ]);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer count FROM doc_embedding_queue WHERE doc_id=$1",
              [state.doc],
            )
          ).rows[0].count,
          1,
          "restoring creates new pending work",
        );
        assert.equal(
          await measureQueued(),
          1,
          "the restored page can be freshly measured",
        );
      }
    });
  });
}

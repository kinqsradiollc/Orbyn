import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AiChatSummary } from "@orbyn/core";

process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { pool, closeDatabase } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { listAiChats } = await import("../src/modules/ai/chats.js");
const { env } = await import("../src/config/env.js");
before(() => migrate());
after(() => closeDatabase());

test("empty chat search preserves ordered summaries and current source revocation", async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  await db.query("SET LOCAL jit=off");
  try {
    const owner = randomUUID(),
      other = randomUUID(),
      team = randomUUID();
    const project = randomUUID(),
      source = randomUUID(),
      grant = randomUUID();
    for (const id of [owner, other])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Chat list fixture','unused')",
        [id, `${id}@chat-list.invalid`],
      );
    await db.query("INSERT INTO teams(id,name) VALUES($1,'Chat list team')", [
      team,
    ]);
    await db.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
      [team, owner],
    );
    await db.query(
      "INSERT INTO projects(id,user_id,team_id,name) VALUES($1,$2,$3,'Team project')",
      [project, other, team],
    );
    await db.query(
      "INSERT INTO docs(id,user_id,team_id,title) VALUES($1,$2,$3,'Team source')",
      [source, other, team],
    );
    await db.query(
      "INSERT INTO agent_grants(id,user_id,kind,personal) VALUES($1,$2,'key',true)",
      [grant, owner],
    );
    const at = "2026-01-01T00:00:00.000Z";
    const expected = new Map<string, AiChatSummary>();
    async function chat(
      title: string,
      options: {
        project?: string;
        pinned?: boolean;
        owner?: string;
        origin?: string;
      } = {},
    ) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO ai_chats(id,user_id,title,project_id,pinned,origin,turns,created_at,last_used_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [
          id,
          options.owner ?? owner,
          title,
          options.project ?? null,
          options.pinned ?? false,
          options.origin ?? "person",
          JSON.stringify([{ role: "user", text: "Legacy needle" }]),
          at,
        ],
      );
      expected.set(id, {
        id,
        title,
        project_id: options.project ?? null,
        project_name: options.project ? "Team project" : null,
        pinned: options.pinned ?? false,
        turn_count: 1,
        created_at: at,
        last_used_at: at,
        summary_doc_id: null,
        swept_at: null,
        scope: null,
        active: null,
      });
      return id;
    }
    const legacy = await chat("Legacy", { pinned: true });
    const retained = await chat("Private legacy title", { pinned: true });
    const work = await chat("Team work", { project });
    const automated = await chat("Background", { origin: "task" });
    await chat("Other owner", { owner: other });
    await chat("Idea", { origin: "idea" });
    const stream = randomUUID(),
      binding = randomUUID();
    await db.query(
      "INSERT INTO assistant_conversation_streams(id,owner_id,chat_id) VALUES($1,$2,$3)",
      [stream, owner, retained],
    );
    await db.query(
      `INSERT INTO assistant_delivery_bindings(id,owner_id,work_kind,work_id,destination_id,reason,lane,sources_checked,timezone,grant_id,summary_retained_at)
      VALUES($1,$2,'job',$3,$4,'origin','background',true,'UTC',$5,now())`,
      [binding, owner, randomUUID(), stream, grant],
    );
    async function entry(
      text: string,
      checked = true,
      kind?: string,
      sourceId?: string,
    ) {
      const id = randomUUID();
      const sequence = (
        await db.query(
          "SELECT count(*)::int+1 AS n FROM assistant_conversation_entries WHERE destination_id=$1",
          [stream],
        )
      ).rows[0].n;
      await db.query(
        `INSERT INTO assistant_conversation_entries(id,destination_id,sequence,kind,turn_id,role,payload,sources_checked)
        VALUES($1,$2,$3,'turn',$4,'user',$5,$6)`,
        [id, stream, sequence, randomUUID(), { role: "user", text }, checked],
      );
      if (kind)
        await db.query(
          "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) VALUES($1,$2,$3)",
          [id, kind, sourceId],
        );
    }
    await entry("Independent retained needle");
    await entry("Team retained needle", true, "doc", source);
    await entry("Grant retained needle", true, "binding", binding);
    await entry("Unchecked secret", false);
    expected.get(retained)!.turn_count = 3;
    const oldTurn = randomUUID();
    await db.query(
      "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
      [retained, oldTurn, source],
    );
    await db.query(
      "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
      [legacy, randomUUID(), source],
    );
    const job = randomUUID();
    await db.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'waiting','task',true)",
      [job, owner, retained],
    );
    await db.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
      [job, source],
    );
    expected.get(retained)!.active = "needs_you";

    type Options = Parameters<typeof listAiChats>[2];
    async function parity(ids: string[], options: Partial<Options> = {}) {
      const query = { search: "", limit: 100, ...options };
      const empty = await listAiChats(db, owner, query);
      // Every displayed title is nonempty: '%' exercises the unchanged search
      // path while matching the same chats, including a redacted title.
      const wildcard = await listAiChats(db, owner, { ...query, search: "%" });
      assert.deepEqual(empty, wildcard);
      const ordered = ids
        .map((id) => expected.get(id)!)
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) || a.id.localeCompare(b.id),
        );
      assert.deepEqual(empty, ordered.slice(0, query.limit));
      return empty;
    }
    await parity([legacy, retained, work, automated]);
    await db.query("UPDATE ai_chats SET swept_at=$2 WHERE id=$1", [legacy, at]);
    expected.get(legacy)!.swept_at = at;
    await parity([legacy, retained, work, automated]);
    await parity([legacy, retained, automated], { kind: "chat" });
    await parity([work], { kind: "work" });
    await parity([work], { project_id: project });
    await parity([legacy, retained, work, automated], { limit: 1 });
    await parity([legacy, retained, work], { conversation_only: true });
    env.ASSISTANT_CONVERSATION_ENABLED = "false";
    await parity([legacy, retained, work, automated], {
      conversation_only: true,
    });
    env.ASSISTANT_CONVERSATION_ENABLED = "true";
    assert.deepEqual(
      (
        await listAiChats(db, owner, { search: "Team retained", limit: 100 })
      ).map((row) => row.id),
      [retained],
    );
    assert.deepEqual(
      await listAiChats(db, owner, { search: "Unchecked secret", limit: 100 }),
      [],
    );
    await db.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
      project,
    ]);
    await parity([legacy, retained, automated]);
    await parity([], { project_id: project });
    await db.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
      project,
    ]);

    for (const state of ["revoked_at", "suspended_at", "expires_at"] as const) {
      await db.query(
        `UPDATE agent_grants SET ${state}=now()-interval '1 day' WHERE id=$1`,
        [grant],
      );
      expected.get(retained)!.turn_count = 2;
      await parity([legacy, retained, work, automated]);
      assert.deepEqual(
        await listAiChats(db, owner, { search: "Grant retained", limit: 100 }),
        [],
      );
      await db.query(`UPDATE agent_grants SET ${state}=NULL WHERE id=$1`, [
        grant,
      ]);
    }
    expected.get(retained)!.turn_count = 3;
    await db.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [source]);
    expected.get(retained)!.title = "Conversation";
    expected.get(retained)!.turn_count = 2;
    expected.get(retained)!.active = null;
    await parity([retained, work, automated]);
    await db.query("UPDATE docs SET deleted_at=NULL WHERE id=$1", [source]);
    expected.get(retained)!.title = "Private legacy title";
    expected.get(retained)!.turn_count = 3;
    expected.get(retained)!.active = "needs_you";
    await db.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
      team,
      owner,
    ]);
    expected.get(retained)!.title = "Conversation";
    expected.get(retained)!.turn_count = 2;
    expected.get(retained)!.active = null;
    await parity([retained, automated]);
    for (const search of [
      "Private legacy title",
      "Legacy needle",
      "Team retained",
    ])
      assert.ok(
        !(await listAiChats(db, owner, { search, limit: 100 })).some(
          (row) => row.id === retained,
        ),
      );
    assert.deepEqual(
      (
        await listAiChats(db, owner, {
          search: "Independent retained",
          limit: 100,
        })
      ).map((row) => row.id),
      [retained],
    );
    await assert.rejects(
      listAiChats(db, owner, { project_id: project, search: "", limit: 100 }),
    );
    await db.query(
      "UPDATE assistant_conversation_streams SET retired_at=now() WHERE id=$1",
      [stream],
    );
    await parity([automated]);
    // Even an active retained stream cannot revive a swept chat whose legacy
    // sources are inaccessible. Insert it after sweeping to exercise that gate.
    const swept = await chat("Swept source-derived title");
    await db.query("UPDATE ai_chats SET swept_at=$2 WHERE id=$1", [swept, at]);
    await db.query(
      "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
      [swept, randomUUID(), source],
    );
    await db.query(
      "INSERT INTO assistant_conversation_streams(owner_id,chat_id) VALUES($1,$2)",
      [owner, swept],
    );
    await parity([automated]);
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = "true";
    await db.query("ROLLBACK");
    db.release();
  }
});

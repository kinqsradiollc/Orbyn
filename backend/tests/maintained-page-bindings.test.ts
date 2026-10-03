import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DocBlock } from "@orbyn/core";
import type { UserRow } from "../src/lib/auth.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { createMaintainedPageBinding, maintainedPageContext } =
  await import("../src/modules/docs/maintenance.js");
const users: string[] = [];
const teams: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  users.push(id);
  const user = (
    await pool.query<UserRow>(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Page maintainer','unusable') RETURNING *",
      [id, `page-maintenance-${id}@orbyn.test`],
    )
  ).rows[0];
  const principal = await assistantPrincipal(user);
  return { user, principal };
}
const blocks: DocBlock[] = [
  {
    id: "human",
    type: "paragraph",
    text: "Human material is not model context.",
  },
  { id: "summary", type: "paragraph", text: "Update this summary." },
];
async function page(
  user: UserRow,
  team: string | null = null,
  project: string | null = null,
) {
  return (
    await pool.query<{ id: string; version: number }>(
      "INSERT INTO docs(user_id,team_id,project_id,title,content) VALUES($1,$2,$3,'Maintained page',$4::jsonb) RETURNING id,version",
      [user.id, team, project, JSON.stringify(blocks)],
    )
  ).rows[0];
}
const input = (version: number) => ({
  instruction: "Refresh the selected summary.",
  rrule: "FREQ=DAILY",
  timezone: "UTC",
  next_run_at: "2026-10-05T09:00:00Z",
  expected_doc_version: version,
  block_ids: ["summary"],
});
const status = (expected: number) => (error: any) =>
  error.statusCode === expected;

test("stored page bindings are owner/grant-bound, paused and contain no copied page text", async () => {
  const { user, principal } = await person();
  const doc = await page(user);
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      user,
      principal,
      doc.id,
      input(doc.version),
    ),
  );
  assert.equal(binding.user_id, user.id);
  assert.equal(binding.agent_grant_id, principal.grant_id);
  assert.equal(binding.paused, true);
  assert.deepEqual(binding.snapshot, {
    doc_version: doc.version,
    blocks: [{ block_id: "summary", position: 1 }],
  });
  assert.ok(!JSON.stringify(binding).includes("Human material"));
  assert.ok(!JSON.stringify(binding).includes("Update this summary"));
  const context = await transaction((db) =>
    maintainedPageContext(db, user, principal, binding.id),
  );
  assert.deepEqual(context.blocks, [blocks[1]]);
  const other = await person();
  await assert.rejects(
    transaction((db) =>
      maintainedPageContext(db, other.user, other.principal, binding.id),
    ),
    status(404),
  );
  await assert.rejects(
    transaction((db) =>
      createMaintainedPageBinding(
        db,
        user,
        other.principal,
        doc.id,
        input(doc.version),
      ),
    ),
    status(403),
  );
});

test("bindings reject stale versions, overlapping ownership and moved targets", async () => {
  const { user, principal } = await person();
  const doc = await page(user);
  await assert.rejects(
    transaction((db) =>
      createMaintainedPageBinding(
        db,
        user,
        principal,
        doc.id,
        input(doc.version + 1),
      ),
    ),
    status(409),
  );
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      user,
      principal,
      doc.id,
      input(doc.version),
    ),
  );
  await assert.rejects(
    transaction((db) =>
      createMaintainedPageBinding(
        db,
        user,
        principal,
        doc.id,
        input(doc.version),
      ),
    ),
    status(409),
  );
  await pool.query("UPDATE docs SET content=$2::jsonb WHERE id=$1", [
    doc.id,
    JSON.stringify([...blocks].reverse()),
  ]);
  await assert.rejects(
    transaction((db) => maintainedPageContext(db, user, principal, binding.id)),
    status(409),
  );
  await pool.query(
    "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
    [doc.id, JSON.stringify(blocks)],
  );
  await assert.rejects(
    transaction((db) => maintainedPageContext(db, user, principal, binding.id)),
    status(409),
  );
});

test("current grant and account changes revoke binding context", async () => {
  for (const [change, code] of [
    ["personal=false", 404],
    ["access='read'", 403],
    ["suspended_at=now()", 403],
  ] as const) {
    const { user, principal } = await person();
    const doc = await page(user);
    const binding = await transaction((db) =>
      createMaintainedPageBinding(
        db,
        user,
        principal,
        doc.id,
        input(doc.version),
      ),
    );
    await pool.query(`UPDATE agent_grants SET ${change} WHERE id=$1`, [
      principal.grant_id,
    ]);
    await assert.rejects(
      transaction((db) =>
        maintainedPageContext(db, user, principal, binding.id),
      ),
      status(code),
    );
  }
  const { user, principal } = await person();
  const doc = await page(user);
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      user,
      principal,
      doc.id,
      input(doc.version),
    ),
  );
  await assert.rejects(
    pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
      principal.grant_id,
    ]),
    (error: any) => error.code === "P0001",
  );
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [user.id]);
  await assert.rejects(
    transaction((db) => maintainedPageContext(db, user, principal, binding.id)),
    status(403),
  );
});

test("project exclusion and current team membership or policy block page context", async () => {
  const owner = await person();
  const member = await person();
  const team = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Maintenance team',$2)",
    [team, owner.user.id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.user.id, member.user.id],
  );
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,team_id,name) VALUES($1,$2,'Maintenance project') RETURNING id",
      [owner.user.id, team],
    )
  ).rows[0].id;
  const doc = await page(owner.user, team, project);
  const principal = await assistantPrincipal(member.user);
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      member.user,
      principal,
      doc.id,
      input(doc.version),
    ),
  );
  const read = () =>
    transaction((db) =>
      maintainedPageContext(db, member.user, principal, binding.id),
    );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  await assert.rejects(read(), status(404));
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    project,
  ]);
  await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
    team,
  ]);
  await assert.rejects(read(), status(404));
  await pool.query("UPDATE teams SET assistant_allowed=true WHERE id=$1", [
    team,
  ]);
  await pool.query(
    "UPDATE team_members SET role='viewer' WHERE team_id=$1 AND user_id=$2",
    [team, member.user.id],
  );
  await assert.rejects(read(), status(403));
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.user.id,
  ]);
  await assert.rejects(read(), status(404));
});

test("scoped context redacts owner-visible links outside the assistant grant", async () => {
  const own = await person();
  const team = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Scoped context',$2)",
    [team, own.user.id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, own.user.id],
  );
  const personal = await page(own.user);
  const doc = await page(own.user, team);
  const text = `See [Private personal project title](orbyn://doc/${personal.id})`;
  await pool.query("UPDATE docs SET content=$2::jsonb WHERE id=$1", [
    doc.id,
    JSON.stringify([blocks[0], { ...blocks[1], text }]),
  ]);
  await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
    own.principal.grant_id,
  ]);
  const principal = await assistantPrincipal(own.user);
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      own.user,
      principal,
      doc.id,
      input(doc.version),
    ),
  );
  const context = await transaction((db) =>
    maintainedPageContext(db, own.user, principal, binding.id),
  );
  assert.equal(
    (context.blocks[0] as { text: string }).text,
    `See [Private page](orbyn://doc/${personal.id})`,
  );
  assert.ok(
    !JSON.stringify(context.blocks).includes("Private personal project title"),
  );
  assert.equal(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [doc.id])).rows[0]
      .content[1].text,
    text,
    "projection never edits stored words",
  );
});

test("page bindings cannot bypass the separate reviewed memory and profile workflows", async () => {
  const own = await person();
  for (const kind of ["memory", "profile"]) {
    const doc = await page(own.user);
    await pool.query("UPDATE docs SET kind=$2 WHERE id=$1", [doc.id, kind]);
    await assert.rejects(
      transaction((db) =>
        createMaintainedPageBinding(
          db,
          own.user,
          own.principal,
          doc.id,
          input(doc.version),
        ),
      ),
      status(403),
    );
  }
});

test("binding model context hides labels for linked sources kept out of AI", async () => {
  const own = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Excluded source',true) RETURNING id",
      [own.user.id],
    )
  ).rows[0].id;
  const hidden = await page(own.user, null, project);
  const doc = await page(own.user);
  await pool.query("UPDATE docs SET content=$2::jsonb WHERE id=$1", [
    doc.id,
    JSON.stringify([
      blocks[0],
      {
        ...blocks[1],
        text: `[Excluded source title](orbyn://doc/${hidden.id})`,
      },
    ]),
  ]);
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      own.user,
      own.principal,
      doc.id,
      input(doc.version),
    ),
  );
  const context = await transaction((db) =>
    maintainedPageContext(db, own.user, own.principal, binding.id),
  );
  assert.equal(
    (context.blocks[0] as { text: string }).text,
    `[Private page](orbyn://doc/${hidden.id})`,
  );
});

test("binding foreign keys prevent cross-account agent substitution and revoke on page deletion", async () => {
  const own = await person();
  const other = await person();
  const doc = await page(own.user);
  const binding = await transaction((db) =>
    createMaintainedPageBinding(
      db,
      own.user,
      own.principal,
      doc.id,
      input(doc.version),
    ),
  );
  await assert.rejects(
    pool.query(
      "UPDATE assistant_page_bindings SET agent_grant_id=$2 WHERE id=$1",
      [binding.id, other.principal.grant_id],
    ),
    (error: any) => error.code === "23503",
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [doc.id]);
  assert.equal(
    (
      await pool.query("SELECT id FROM assistant_page_bindings WHERE id=$1", [
        binding.id,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    transaction((db) =>
      maintainedPageContext(db, own.user, own.principal, binding.id),
    ),
    status(404),
  );
});

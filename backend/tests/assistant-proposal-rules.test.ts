import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpError, type AssistantActionRule } from "@orbyn/core";
import type { UserRow } from "../src/lib/auth.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { replaceAssistantRules } =
  await import("../src/modules/agents/assistant-rules.js");
const { execute } = await import("../src/capabilities/execute.js");
const { registry } = await import("../src/capabilities/index.js");
const { applyProposal, createAgentProposal } =
  await import("../src/modules/proposals/service.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;
const rule = (
  decision: AssistantActionRule["decision"],
): AssistantActionRule => ({
  id: randomUUID(),
  lane: "background",
  scope: { kind: "personal" },
  action: "create",
  decision,
});
async function prepare(plan = false) {
  const id = randomUUID();
  owners.push(id);
  const user = (
    await pool.query<UserRow>(
      "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Proposal rules') RETURNING *",
      [id, `proposal-rules-${id}@example.test`],
    )
  ).rows[0];
  await assistantPrincipal(user);
  await replaceAssistantRules(id, {
    expected_revision: 1,
    rules: [rule("ask")],
  });
  const p = await assistantPrincipal(user);
  p.assistant_lane = "background";
  const args = plan
    ? {
        summary: "Background plan",
        steps: [
          {
            id: "task",
            tool: "create_tasks",
            args: { tasks: [{ title: "Reviewed background work" }] },
          },
        ],
      }
    : { tasks: [{ title: "Reviewed background work" }] };
  const result = await execute(
    registry,
    p,
    plan ? "apply_plan" : "create_tasks",
    args,
    { write: transaction },
  );
  assert.equal(result.result.isError, undefined, JSON.stringify(result.result));
  const output = result.result.structuredContent as {
    proposal_id?: string;
    pending?: { proposal_id: string };
  };
  const proposal = (output.proposal_id ?? output.pending?.proposal_id)?.replace(
    /^proposal:/,
    "",
  );
  assert.ok(proposal, JSON.stringify(output));
  return { user, p, proposal };
}
async function unchanged(owner: string, proposal: string) {
  assert.equal(
    (await pool.query("SELECT status FROM proposals WHERE id=$1", [proposal]))
      .rows[0].status,
    "pending",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
        [owner],
      )
    ).rows[0].n,
    0,
  );
}
for (const plan of [false, true]) {
  test(`${plan ? "whole plan" : "typed change"} retains Background rule evidence through actual review`, async () => {
    const { user, proposal } = await prepare(plan);
    const guard = (
      await pool.query("SELECT assistant_guard FROM proposals WHERE id=$1", [
        proposal,
      ])
    ).rows[0].assistant_guard;
    assert.equal(guard.lane, "background");
    assert.equal(guard.rules_revision, 2);
    assert.ok(
      guard.checks.some((check: { actions: string[] }) =>
        check.actions.includes("create"),
      ),
    );
    const applied = await transaction((db) =>
      applyProposal(db, user, proposal),
    );
    assert.equal(applied.applied, true);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].n,
      1,
    );
  });
  test(`${plan ? "whole plan" : "typed change"} cannot approve after a rule edit`, async () => {
    const { user, proposal } = await prepare(plan);
    await replaceAssistantRules(user.id, {
      expected_revision: 2,
      rules: [rule("deny")],
    });
    await assert.rejects(
      transaction((db) => applyProposal(db, user, proposal)),
      status(409),
    );
    await unchanged(user.id, proposal);
  });
}
test("review checks current personal access and suspension without making changes", async () => {
  const { user, p, proposal } = await prepare();
  await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
    p.grant_id,
  ]);
  await assert.rejects(
    transaction((db) => applyProposal(db, user, proposal)),
    status(403),
  );
  await unchanged(user.id, proposal);
  await pool.query(
    "UPDATE agent_grants SET personal=true,suspended_at=now() WHERE id=$1",
    [p.grant_id],
  );
  await assert.rejects(
    transaction((db) => applyProposal(db, user, proposal)),
    status(403),
  );
  await unchanged(user.id, proposal);
});
test("stored action input cannot choose a different connection", async () => {
  const { user, p } = await prepare();
  const outside = (
    await pool.query(
      "INSERT INTO agent_grants(user_id,kind,name,access,personal,toolsets) VALUES($1,'key','Outside','write',true,ARRAY['core']) RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  const created = await transaction((db) =>
    createAgentProposal(db, {
      userId: user.id,
      grantId: outside,
      clientName: "Outside",
      summary: "Foreign authority",
      changes: [
        {
          type: "action",
          action: "plan.apply",
          target_id: null,
          title: "Foreign authority",
          team_id: null,
          headline: "Foreign authority",
          rows: [],
          input: {
            grant_id: p.grant_id,
            job: "foreign-authority",
            summary: "Foreign authority",
            steps: [
              {
                id: "task",
                tool: "create_tasks",
                args: { tasks: [{ title: "Should never exist" }] },
              },
            ],
          },
        },
      ],
    }),
  );
  await assert.rejects(
    transaction((db) => applyProposal(db, user, created.id)),
    status(403),
  );
  await unchanged(user.id, created.id);
});
test("a removed source connection cannot acquire assistant guard metadata", async () => {
  const { user } = await prepare();
  await assert.rejects(
    transaction((db) =>
      createAgentProposal(db, {
        userId: user.id,
        grantId: randomUUID(),
        clientName: "Outside",
        summary: "Forged guard",
        changes: [
          {
            type: "task.create",
            title: "Not made",
            team_id: null,
            data: { title: "Not made" },
            emails: [],
          },
        ],
        assistantGuard: { lane: "background", rules_revision: 2, checks: [] },
      }),
    ),
    status(403),
  );
});

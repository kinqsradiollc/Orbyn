import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const app = await buildApiService(),
  h = helpers(app),
  network = await trapNetwork(),
  owners: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
  assert.deepEqual(network.calls, []);
});
async function person() {
  const p = await h.register("page-stop-api");
  owners.push(p.id);
  const principal = await assistantPrincipal({
    id: p.id,
    name: p.name,
    role: "member",
  });
  return { ...p, principal };
}
type State = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
async function fixture(
  p: Awaited<ReturnType<typeof person>>,
  state: State = "queued",
  options: { night?: boolean; team?: string; author?: string } = {},
) {
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,team_id,title,content) VALUES($1,$2,'Page Stop fixture',$3) RETURNING id",
      [
        options.author ?? p.id,
        options.team ?? null,
        JSON.stringify([
          { id: "selected", type: "paragraph", text: "Preserved human page" },
        ]),
      ],
    )
  ).rows[0];
  const binding = (
    await pool.query(
      "INSERT INTO assistant_page_bindings(doc_id,user_id,agent_grant_id,snapshot,instruction,rrule,timezone,next_run_at,paused) VALUES($1,$2,$3,$4,'Preserve this schedule','FREQ=DAILY','UTC',now()+interval '1 day',false) RETURNING *",
      [
        doc.id,
        p.id,
        p.principal.grant_id,
        { doc_version: 1, blocks: [{ block_id: "selected", position: 0 }] },
      ],
    )
  ).rows[0];
  const night = options.night
    ? (
        await pool.query(
          "INSERT INTO assistant_nights(user_id,local_day,budget_used) VALUES($1,current_date,300) ON CONFLICT(user_id,local_day) DO UPDATE SET budget_used=300 RETURNING id",
          [p.id],
        )
      ).rows[0].id
    : null;
  const run = (
    await pool.query(
      `INSERT INTO assistant_page_runs(binding_id,user_id,agent_grant_id,binding_revision,doc_version,assistant_rules_revision,lane,night_id,end_at,scheduled_for,state,lease_token,lease_expires_at,proposal,waiting_id,error_message,token_estimate,reserved_tokens)
 VALUES($1,$2,$3,1,1,$4,$5,$6,$7,now(),$8,$9,$10,$11,$12,$13,300,$14) RETURNING *`,
      [
        binding.id,
        p.id,
        p.principal.grant_id,
        p.principal.assistant_rules_revision ?? 1,
        night ? "overnight" : "background",
        night,
        night ? new Date(Date.now() + 3600000) : null,
        state,
        state === "running" ? randomUUID() : null,
        state === "running" ? new Date(Date.now() + 60000) : null,
        {
          expected_revision: 1,
          replacements: [
            {
              id: "selected",
              type: "paragraph",
              text: "PRIVATE saved generated proposal",
            },
          ],
        },
        state === "waiting" ? randomUUID() : null,
        state === "cancelled"
          ? "An earlier cancellation."
          : state === "failed"
            ? "An earlier failure."
            : null,
        state === "waiting" ? 0 : 100,
      ],
    )
  ).rows[0];
  const reservation = (
    await pool.query(
      `INSERT INTO assistant_work_reservations(user_id,lane,page_run_id,budget_day,reserved_tokens,starting_estimate,state,reported_tokens,settled_at) VALUES($1,$2,$3,current_date,1000,0,$4,$5,$6) RETURNING *`,
      [
        p.id,
        night ? "overnight" : "background",
        run.id,
        state === "running" ? "active" : "settled",
        state === "running" ? null : 300,
        state === "running" ? null : new Date(),
      ],
    )
  ).rows[0];
  const path = `/docs/${doc.id}/maintenance/runs/${run.id}/stop`;
  const stop = (token: string | null = p.token, payload: unknown = {}) =>
    app.inject({
      method: "POST",
      url: path,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return { doc, binding, night, run, reservation, path, stop };
}
test("page Stop requires a person session and exact owned run/document identity with strict empty body", async () => {
  const p = await person(),
    other = await person(),
    f = await fixture(p, "waiting");
  assert.equal((await f.stop(null)).statusCode, 401);
  const key = await h.call(p.token, "POST", "/me/api-keys", {
    name: "Page Stop denial fixture",
  });
  assert.equal(key.statusCode, 201, key.body);
  assert.equal((await f.stop(key.json().key)).statusCode, 403);
  const agent = await h.agentKey(p);
  assert.equal(
    (await f.stop(agent.key)).statusCode,
    401,
    "MCP credentials are rejected before first-party auth",
  );
  assert.equal((await f.stop(other.token)).statusCode, 404);
  const wrong = await app.inject({
    method: "POST",
    url: `/docs/${randomUUID()}/maintenance/runs/${f.run.id}/stop`,
    headers: { authorization: `Bearer ${p.token}` },
    payload: {},
  });
  assert.equal(wrong.statusCode, 404);
  assert.equal((await f.stop(p.token, { approved: true })).statusCode, 422);
  assert.equal(
    (
      await pool.query("SELECT state FROM assistant_page_runs WHERE id=$1", [
        f.run.id,
      ])
    ).rows[0].state,
    "waiting",
  );
  const stopped = await f.stop();
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.deepEqual(stopped.json(), { state: "cancelled", stopped: true });
  assert.ok(!stopped.body.includes("PRIVATE"));
});
test("queued, waiting and running Stop clear private work while preserving page/schedule and conservative accounting", async () => {
  const p = await person();
  for (const state of ["queued", "waiting", "running"] as const) {
    const f = await fixture(p, state, { night: state === "waiting" });
    const response = await f.stop();
    assert.equal(response.statusCode, 200, response.body);
    const run = (
      await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
        f.run.id,
      ])
    ).rows[0];
    assert.equal(run.state, "cancelled");
    assert.equal(run.proposal, null);
    assert.equal(run.waiting_id, null);
    assert.equal(run.lease_token, null);
    assert.equal(run.lease_expires_at, null);
    assert.equal(run.error_message, "Stopped by you.");
    for (const field of [
      "token_estimate",
      "reserved_tokens",
      "token_budget",
      "attempts",
      "binding_id",
      "binding_revision",
      "doc_version",
      "scheduled_for",
    ])
      assert.deepEqual(run[field], f.run[field], field);
    assert.deepEqual(
      (
        await pool.query("SELECT * FROM assistant_page_bindings WHERE id=$1", [
          f.binding.id,
        ])
      ).rows[0],
      f.binding,
    );
    const reservation = (
      await pool.query(
        "SELECT * FROM assistant_work_reservations WHERE id=$1",
        [f.reservation.id],
      )
    ).rows[0];
    assert.equal(reservation.reserved_tokens, f.reservation.reserved_tokens);
    assert.equal(reservation.state, "settled");
    assert.equal(reservation.reported_tokens, 300);
    if (state !== "running") assert.deepEqual(reservation, f.reservation);
    if (f.night)
      assert.equal(
        (
          await pool.query(
            "SELECT budget_used FROM assistant_nights WHERE id=$1",
            [f.night],
          )
        ).rows[0].budget_used,
        300,
      );
    const doc = (
      await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id])
    ).rows[0];
    assert.ok(JSON.stringify(doc).includes("Preserved human page"));
    assert.ok(!JSON.stringify(doc).includes("PRIVATE"));
  }
});
test("terminal Stop is idempotent and never rewrites an actual done, failed or prior-cancelled result", async () => {
  const p = await person();
  for (const state of ["done", "failed", "cancelled"] as const) {
    const f = await fixture(p, state),
      before = (
        await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
          f.run.id,
        ])
      ).rows[0];
    const first = await f.stop(),
      again = await f.stop();
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), { state, stopped: false });
    assert.deepEqual(again.json(), first.json());
    assert.deepEqual(
      (
        await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
          f.run.id,
        ])
      ).rows[0],
      before,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT * FROM assistant_work_reservations WHERE id=$1",
          [f.reservation.id],
        )
      ).rows[0],
      f.reservation,
    );
  }
});
test("a binding owner can stop their team-page run when another teammate authored the document", async () => {
  const owner = await person(),
    author = await person(),
    team = await h.team(author, "Page Stop team", [[owner, "admin"]]);
  const f = await fixture(owner, "waiting", { team, author: author.id });
  assert.notEqual(owner.id, author.id);
  assert.equal(
    (await f.stop(author.token)).statusCode,
    404,
    "Document authorship does not confer ownership of another person's run",
  );
  const response = await f.stop();
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { state: "cancelled", stopped: true });
});
test("concurrent Stop requests serialize on one run and replay preserves its first cancellation timestamp", async () => {
  const p = await person(),
    f = await fixture(p, "waiting");
  const responses = await Promise.all([f.stop(), f.stop(), f.stop()]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { state: "cancelled", stopped: true });
  }
  const before = (
    await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
      f.run.id,
    ])
  ).rows[0];
  const replay = await f.stop();
  assert.deepEqual(replay.json(), { state: "cancelled", stopped: true });
  assert.deepEqual(
    (
      await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [
        f.run.id,
      ])
    ).rows[0],
    before,
  );
  assert.deepEqual(
    (
      await pool.query("SELECT * FROM assistant_page_bindings WHERE id=$1", [
        f.binding.id,
      ])
    ).rows[0],
    f.binding,
  );
});

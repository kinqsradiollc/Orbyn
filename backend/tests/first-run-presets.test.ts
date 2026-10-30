import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { helpers, trapNetwork } from "./mcp-helpers.js";
import { withWorkspacePresets } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
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
async function fixture() {
  const person = await h.register("first-run-presets");
  owners.push(person.id);
  const call = (
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: unknown,
  ) => h.call(person.token, method, path, payload);
  const prefs = (await call("GET", "/me/prefs")).json();
  const saved = await call("PUT", "/me/prefs", {
    sidebar: { order: ["Tasks", "Library"], hidden: ["Study"] },
    views: {
      workspace: {
        layout: "compact",
        sort: "custom",
        pins: ["private-section"],
      },
      tasks: { layout: "board" },
    },
    home: { ...prefs.home, quote: { ...prefs.home.quote, on: false } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const read = async () => (await call("GET", "/me/prefs")).json();
  return { person, call, read, original: saved.json() };
}
const choice = { selected: ["engineer", "student"], expected: [] };
test("first-run atomically adopts both presets with the canonical starter and preserves customized preferences", async () => {
  const f = await fixture();
  const saved = await f.call("POST", "/me/first-run", {
    purpose: "study",
    starter: "term",
    workspace_presets: choice,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.ok(saved.json().project_id);
  const prefs = await f.read();
  assert.deepEqual(prefs, {
    ...f.original,
    updated_at: prefs.updated_at,
    views: {
      ...f.original.views,
      workspace: {
        ...f.original.views.workspace,
        pins: ["private-section", "engineer", "student"],
      },
    },
  });
  assert.equal(
    (
      await pool.query("SELECT id FROM projects WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query("SELECT id FROM agent_grants WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount,
    0,
  );
  const changed = await f.call("PUT", "/me/prefs", {
    views: {
      workspace: withWorkspacePresets(prefs.views.workspace, ["student"]),
    },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.deepEqual(changed.json().views.workspace.pins, [
    "private-section",
    "student",
  ]);
  const replay = await f.call("POST", "/me/first-run", {
    purpose: "study",
    starter: "term",
    workspace_presets: choice,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().project_id, null);
  assert.deepEqual(
    await f.read(),
    changed.json(),
    "A replay must not reapply first-run preferences",
  );
});
test("legacy first-run omission leaves all existing preferences untouched", async () => {
  const f = await fixture();
  const saved = await f.call("POST", "/me/first-run", {
    purpose: "personal",
    starter: "none",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().project_id, null);
  assert.deepEqual(await f.read(), f.original);
});
test("stale recognized choices reject before creating any starter, and reloading permits the same authored starter", async () => {
  const f = await fixture();
  const current = await f.call("PUT", "/me/prefs", {
    views: {
      workspace: withWorkspacePresets(f.original.views.workspace, ["student"]),
    },
  });
  assert.equal(current.statusCode, 200, current.body);
  const input = {
    purpose: "study",
    starter: "term",
    workspace_presets: choice,
  };
  const stale = await f.call("POST", "/me/first-run", input);
  assert.equal(stale.statusCode, 409, stale.body);
  assert.deepEqual(await f.read(), current.json());
  assert.equal(
    (
      await pool.query("SELECT id FROM projects WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query("SELECT first_run_at FROM users WHERE id=$1", [
        f.person.id,
      ])
    ).rows[0].first_run_at,
    null,
  );
  const saved = await f.call("POST", "/me/first-run", {
    ...input,
    workspace_presets: { ...choice, expected: ["student"] },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.ok(saved.json().brief_id);
});
test("concurrent finish and skip serialize first-run ownership without duplicate starter data", async () => {
  for (const skip of [false, true]) {
    const f = await fixture(),
      input = { purpose: "study", starter: "term", workspace_presets: choice };
    const responses = await Promise.all([
      f.call("POST", "/me/first-run", input),
      f.call(
        "POST",
        skip ? "/me/first-run/skip" : "/me/first-run",
        skip ? {} : input,
      ),
    ]);
    responses.forEach((response) =>
      assert.equal(response.statusCode, 200, response.body),
    );
    const projects = (
      await pool.query("SELECT id FROM projects WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount;
    assert.equal(
      projects,
      responses.filter((response) => response.json().project_id).length,
    );
    assert.ok(projects! <= 1);
    if (!skip) assert.equal(projects, 1);
    const prefs = await f.read();
    assert.deepEqual(
      prefs.views.workspace.pins,
      projects
        ? ["private-section", "engineer", "student"]
        : ["private-section"],
    );
    assert.ok(
      (
        await pool.query("SELECT first_run_at FROM users WHERE id=$1", [
          f.person.id,
        ])
      ).rows[0].first_run_at,
    );
  }
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import type { DocBlock } from "@orbyn/core";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * H6b: every feature, no gaps, by extending the tools there are (still 60).
 * Pages (other names, folds, linking a mention, moving lines to a new page,
 * merging, taking a source off, Info through fetch, restoring a version,
 * the Trash), your own fields, pinning and exporting views, milestones and
 * the keep-out switch, running a team (always asked first), recents and a
 * team's recent changes, and changing or refreshing a subscribed calendar.
 * Each with its refusals and its undo.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { EXCLUDED, COVERED } = await import("../src/capabilities/exclusions.js");
const { AGENT_TOOLSETS } = await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};
const ALL = [...AGENT_TOOLSETS];

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}

const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const refused = (r: Result, want: string, what = "call") => {
  assert.equal(r.isError, true, `${what} should be refused`);
  assert.equal(code(r), want, `${what}: ${r.content?.[0]?.text}`);
};
const idOf = (typed: string) =>
  typed.replace(/^[\w]+:(\/\/\w+\/)?/, "").slice(0, 36);

/** Undo the latest change `grant` made with `name`, as the person. */
async function undoLast(grant: string, name: string) {
  const act = (
    await pool.query<{ id: string }>(
      "SELECT id FROM agent_activity WHERE tool = $1 AND grant_id = $2 ORDER BY id DESC LIMIT 1",
      [name, grant],
    )
  ).rows[0];
  assert.ok(act, `no ${name} change to undo`);
  const r = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(r.statusCode, 200, r.body);
}

const doc = async (id: string) =>
  (await pool.query("SELECT * FROM docs WHERE id = $1", [id])).rows[0];
const lines = async (id: string) => (await doc(id)).content as DocBlock[];

/** A page of Olga's own, made by the full-power connection. */
async function page(title: string, markdown: string, team?: string) {
  const made = ok(
    await tool(keys.full, "create_doc", {
      title,
      markdown,
      ...(team ? { team } : {}),
    }),
    "create_doc",
  );
  const id = idOf(made.done[0].id);
  return { id, version: (await doc(id)).version as number };
}

async function approve(proposal: string) {
  const r = await h.call(
    olga.token,
    "POST",
    `/proposals/${proposal.replace(/^proposal:/, "")}/apply`,
    {},
  );
  assert.equal(r.statusCode, 200, r.body);
}

before(async () => {
  await migrate();
  olga = await h.register("h6b-olga", "Olga");
  mo = await h.register("h6b-mo", "Mo");
  crew = await h.team(olga, "H6b crew", [[mo, "member"]]);
  const make = async (
    name: string,
    who: Person,
    body: Record<string, unknown>,
  ) => {
    const k = await h.agentKey(who, { team_ids: [crew], ...body });
    keys[name] = k.key;
    grants[name] = k.id;
  };
  await make("full", olga, { access: "write", toolsets: ALL });
  await make("alone", olga, { access: "write", toolsets: ALL });
  await pool.query(
    "UPDATE agent_grants SET acts_alone = '{team_admin,people}' WHERE id = $1",
    [grants.alone],
  );
  await make("suggest", olga, {
    access: "write",
    toolsets: ALL,
    trust: "suggest",
  });
  await make("read", olga, { access: "read", toolsets: ALL });
  await make("mo", mo, { access: "write", toolsets: ALL });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  network.restore();
  await app.close();
  await pool.end();
});

test("pages: other names and folds, shown by fetch's Info, with undo", async () => {
  const p = await page("Cell biology", "## Membranes ^bmem\n\nLipids ^blip");
  ok(
    await tool(keys.full, "organize", {
      changes: [
        { do: "aliases", id: `doc:${p.id}`, add: ["BIOL1001", "Cells"] },
      ],
    }),
  );
  assert.deepEqual((await doc(p.id)).aliases, ["BIOL1001", "Cells"]);
  ok(
    await tool(keys.full, "organize", {
      changes: [{ do: "fold", id: `doc:${p.id}`, lines: ["bmem"] }],
    }),
  );
  const fetched = ok(await tool(keys.full, "fetch", { id: `doc:${p.id}` }));
  assert.match(fetched.text, /Also called: BIOL1001, Cells/);
  assert.match(fetched.text, /folded: \^bmem/);
  assert.match(fetched.text, /kept version/);
  // The page's words didn't change: other names aren't lines.
  assert.equal((await doc(p.id)).version, p.version);
  await undoLast(grants.full, "organize");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM doc_folds WHERE doc_id = $1 AND user_id = $2",
        [p.id, olga.id],
      )
    ).rowCount,
    0,
  );
  // Undo the names too (the change before).
  const acts = (
    await pool.query<{ id: string }>(
      "SELECT id FROM agent_activity WHERE tool = 'organize' AND grant_id = $1 AND undone_at IS NULL ORDER BY id DESC LIMIT 1",
      [grants.full],
    )
  ).rows[0];
  assert.equal(
    (await h.call(olga.token, "POST", `/me/agents/activity/${acts.id}/undo`))
      .statusCode,
    200,
  );
  assert.deepEqual((await doc(p.id)).aliases, []);
  // A read connection can't; a suggest-only one can't wait in review.
  refused(
    await tool(keys.read, "organize", {
      changes: [{ do: "aliases", id: `doc:${p.id}`, add: ["X"] }],
    }),
    "FORBIDDEN",
    "read",
  );
  refused(
    await tool(keys.suggest, "organize", {
      changes: [{ do: "aliases", id: `doc:${p.id}`, add: ["X"] }],
    }),
    "FORBIDDEN",
    "suggest",
  );
});

test("pages: linking an unlinked mention, moving lines to a new page and merging, with undo", async () => {
  const target = await page("Photosynthesis", "Light and dark reactions.");
  const notes = await page(
    "Week 3",
    "We covered Photosynthesis today ^bm1\n\nChloroplasts ^bc1\n\nStomata ^bc2\n\nWrap-up ^bw1",
  );
  const linked = ok(
    await tool(keys.full, "organize", {
      changes: [
        {
          do: "link_mention",
          id: `doc:${notes.id}`,
          lines: ["^bm1"],
          words: "Photosynthesis",
          to: `doc:${target.id}`,
        },
      ],
    }),
  );
  assert.equal(linked.status, "done");
  const first = (await lines(notes.id)).find((b) => b.id === "bm1") as {
    text: string;
  };
  assert.match(first.text, new RegExp(`orbyn://doc/${target.id}`));
  await undoLast(grants.full, "organize");
  const back = (await lines(notes.id)).find((b) => b.id === "bm1") as {
    text: string;
  };
  assert.equal(back.text, "We covered Photosynthesis today");

  // Move two lines to a new page: a link takes their place.
  const now = (await doc(notes.id)).version;
  const moved = ok(
    await tool(keys.full, "organize", {
      changes: [
        {
          do: "extract",
          id: `doc:${notes.id}`,
          lines: ["bc1", "bc2"],
          version: now,
          name: "Leaf parts",
        },
      ],
    }),
  );
  const newPage = idOf(moved.done[0].id);
  assert.equal((await doc(newPage)).title, "Leaf parts");
  assert.deepEqual(
    (await lines(newPage)).map((b) => b.id),
    ["bc1", "bc2"],
  );
  const left = await lines(notes.id);
  assert.ok(!left.some((b) => b.id === "bc1"));
  assert.ok(
    left.some(
      (b) => "text" in b && String(b.text).includes(`orbyn://doc/${newPage}`),
    ),
  );
  // A stale version is refused, and nothing moves.
  const stale = await tool(keys.full, "organize", {
    changes: [
      { do: "extract", id: `doc:${notes.id}`, lines: ["bw1"], version: now },
    ],
  });
  assert.equal(stale.isError, true);
  // Undo: the lines come back and the new page goes to Trash.
  await undoLast(grants.full, "organize");
  assert.ok((await lines(notes.id)).some((b) => b.id === "bc1"));
  assert.ok((await doc(newPage)).deleted_at);

  // Merge the notes into the other page: it goes to Trash, undo brings it back.
  const merged = ok(
    await tool(keys.full, "organize", {
      changes: [
        {
          do: "merge",
          id: `doc:${notes.id}`,
          to: `doc:${target.id}`,
          version: (await doc(notes.id)).version,
        },
      ],
    }),
  );
  assert.match(merged.done[0].change, /Merged/);
  assert.ok((await doc(notes.id)).deleted_at);
  assert.ok((await lines(target.id)).some((b) => b.id === "bw1"));
  await undoLast(grants.full, "organize");
  assert.equal((await doc(notes.id)).deleted_at, null);
  assert.ok(!(await lines(target.id)).some((b) => b.id === "bw1"));
});

test("pages: a teammate's page asks first, so a change the app can't ask about is refused", async () => {
  const mine = ok(
    await tool(keys.mo, "create_doc", {
      title: "Mo's plan",
      markdown: "Step one ^bs1",
      team: crew,
    }),
  );
  const id = idOf(mine.done[0].id);
  refused(
    await tool(keys.full, "organize", {
      changes: [{ do: "aliases", id: `doc:${id}`, add: ["Plan"] }],
    }),
    "FORBIDDEN",
    "a teammate's page",
  );
  assert.deepEqual((await doc(id)).aliases, []);
});

test("pages: taking a source off (tool and route), with undo", async () => {
  const p = await page("Reading", "Claim one ^bcl");
  const src = ok(
    await tool(keys.full, "save_source", {
      url: "https://example.org/paper",
      title: "A paper",
      doc: `doc:${p.id}`,
      lines: ["bcl"],
    }),
  );
  const shown = ok(await tool(keys.full, "fetch", { id: `doc:${p.id}` }));
  assert.match(shown.text, /Sources: source:/);
  ok(
    await tool(keys.full, "organize", {
      changes: [{ do: "remove_source", id: `doc:${p.id}`, to: src.source }],
    }),
  );
  const uses = async () =>
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM source_uses WHERE doc_id = $1",
        [p.id],
      )
    ).rows[0].n;
  assert.equal(await uses(), 0);
  // Not on the page any more: said so.
  refused(
    await tool(keys.full, "organize", {
      changes: [{ do: "remove_source", id: `doc:${p.id}`, to: src.source }],
    }),
    "INVALID",
  );
  await undoLast(grants.full, "organize");
  assert.equal(await uses(), 1);
  // The person's own route (page Info → Sources): 401, 404, then 204.
  const url = `/docs/${p.id}/sources/${idOf(src.source)}`;
  assert.equal((await h.call(null, "DELETE", url)).statusCode, 401);
  assert.equal((await h.call(mo.token, "DELETE", url)).statusCode, 404);
  assert.equal((await h.call(olga.token, "DELETE", url)).statusCode, 204);
  assert.equal(await uses(), 0);
  assert.equal((await h.call(olga.token, "DELETE", url)).statusCode, 404);
});

test("pages: a version restored directly, and a page back from Trash (emptying it stays the person's)", async () => {
  const p = await page("Drafts", "First draft");
  ok(
    await tool(keys.full, "edit_doc", {
      doc: `doc:${p.id}`,
      version: p.version,
      edits: [{ op: "append", markdown: "More words" }],
    }),
  );
  const v = (await doc(p.id)).version;
  const restored = ok(
    await tool(keys.full, "propose_changes", {
      summary: "Back to the first draft",
      changes: [
        {
          type: "restore_doc_version",
          target: `doc:${p.id}`,
          version: v,
          to_version: p.version,
        },
      ],
    }),
  );
  assert.equal(restored.status, "done");
  assert.equal((await lines(p.id)).length, 1);
  await undoLast(grants.full, "propose_changes");
  assert.equal((await lines(p.id)).length, 2);

  // Trash, list it, bring it back.
  ok(
    await tool(keys.full, "propose_changes", {
      summary: "Tidy up",
      changes: [
        {
          type: "delete_doc",
          target: `doc:${p.id}`,
          version: (await doc(p.id)).version,
        },
      ],
    }),
  );
  const trash = ok(await tool(keys.full, "get_history", { of: "trash" }));
  assert.ok(trash.entries.some((e: any) => e.ref === `doc:${p.id}`));
  const back = ok(
    await tool(keys.full, "propose_changes", {
      summary: "Bring it back",
      changes: [{ type: "restore_doc", target: `doc:${p.id}` }],
    }),
  );
  assert.equal(back.status, "done");
  assert.equal((await doc(p.id)).deleted_at, null);
  // Undo sends it back to Trash.
  await undoLast(grants.full, "propose_changes");
  assert.ok((await doc(p.id)).deleted_at);
  // Emptying the Trash for good is never an agent's.
  assert.equal(EXCLUDED["DELETE /docs/:id/forever"], "trash");
  // A read connection lists but can't restore.
  refused(
    await tool(keys.read, "propose_changes", {
      summary: "x",
      changes: [{ type: "restore_doc", target: `doc:${p.id}` }],
    }),
    "FORBIDDEN",
  );
});

test("fields: made, changed, filled on pages and projects, deleted, each undoable", async () => {
  const p = await page("Essay", "Intro");
  const made = ok(
    await tool(keys.full, "organize", {
      changes: [
        {
          do: "create_field",
          name: "Stage",
          type: "select",
          for: "page",
          add: ["Draft", "Done"],
        },
      ],
    }),
  );
  const field = made.done[0].id as string;
  assert.match(field, /^field:/);
  ok(
    await tool(keys.full, "organize", {
      changes: [
        { do: "set_field", id: field, to: `doc:${p.id}`, value: "Draft" },
      ],
    }),
  );
  const shown = ok(await tool(keys.full, "fetch", { id: `doc:${p.id}` }));
  assert.match(
    shown.text,
    new RegExp(`Stage \\(${field}, select: Draft\\|Done\\) = Draft`),
  );
  // A value that isn't a choice is refused.
  assert.equal(
    (
      await tool(keys.full, "organize", {
        changes: [
          { do: "set_field", id: field, to: `doc:${p.id}`, value: "Nope" },
        ],
      })
    ).isError,
    true,
  );
  ok(
    await tool(keys.full, "organize", {
      changes: [{ do: "change_field", id: field, name: "Phase" }],
    }),
  );
  await undoLast(grants.full, "organize");
  const row = async () =>
    (
      await pool.query("SELECT name FROM custom_fields WHERE id = $1", [
        idOf(field),
      ])
    ).rows[0];
  assert.equal((await row()).name, "Stage");
  // A project field too.
  const proj = ok(await tool(keys.full, "create_project", { name: "Launch" }));
  const pf = ok(
    await tool(keys.full, "organize", {
      changes: [
        { do: "create_field", name: "Budget", type: "number", for: "project" },
      ],
    }),
  ).done[0].id;
  ok(
    await tool(keys.full, "organize", {
      changes: [{ do: "set_field", id: pf, to: proj.done[0].id, value: 1200 }],
    }),
  );
  const projText = ok(
    await tool(keys.full, "fetch", { id: proj.done[0].id }),
  ).text;
  assert.match(projText, /Budget \(field:[0-9a-f-]{36}, number\) = 1200/);
  // Delete the page field directly (it's hers), and undo brings it and its value back.
  const del = ok(
    await tool(keys.full, "propose_changes", {
      summary: "Drop the stage field",
      changes: [{ type: "delete", what: "field", target: field }],
    }),
  );
  assert.equal(del.status, "done");
  assert.equal(await row(), undefined);
  await undoLast(grants.full, "propose_changes");
  assert.equal((await row()).name, "Stage");
  assert.equal(
    (
      await pool.query(
        "SELECT value FROM custom_field_values WHERE field_id = $1",
        [idOf(field)],
      )
    ).rows[0].value,
    "Draft",
  );
  // A suggest-only connection can't make fields.
  refused(
    await tool(keys.suggest, "organize", {
      changes: [
        { do: "create_field", name: "Nope", type: "text", for: "page" },
      ],
    }),
    "FORBIDDEN",
  );
});

test("views: pinned in the sidebar (undoable) and exported as CSV text, kept-out projects left out", async () => {
  const kept = ok(await tool(keys.full, "create_project", { name: "Secret" }));
  ok(
    await tool(keys.full, "create_tasks", {
      tasks: [
        { title: "Visible chore" },
        { title: "Hidden chore", project: kept.done[0].id },
      ],
    }),
  );
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    idOf(kept.done[0].id),
  ]);
  const view = ok(
    await tool(keys.full, "save_view", {
      name: "Chores",
      source: "tasks",
      columns: ["title", "status"],
      pin: true,
    }),
  );
  const viewId = idOf(view.done[0].id);
  const pinned = async () =>
    (
      await pool.query(
        "SELECT 1 FROM saved_view_pins WHERE user_id = $1 AND view_id = $2",
        [olga.id, viewId],
      )
    ).rowCount;
  assert.equal(await pinned(), 1);
  const out = ok(
    await tool(keys.full, "save_view", {
      view: `view:${viewId}`,
      export: "csv",
    }),
  );
  assert.match(out.csv, /Visible chore/);
  assert.ok(!out.csv.includes("Hidden chore"));
  assert.match(out.done[0].change, /Exported/);
  // Unpin, and undo pins it again.
  ok(
    await tool(keys.full, "save_view", {
      view: `view:${viewId}`,
      version: view.done[0].version,
      pin: false,
    }),
  );
  assert.equal(await pinned(), 0);
  await undoLast(grants.full, "save_view");
  assert.equal(await pinned(), 1);
  refused(await tool(keys.full, "save_view", { export: "csv" }), "INVALID");
});

test("projects: milestones added, filled, changed and removed, in get_project, with undo", async () => {
  const proj = ok(
    await tool(keys.full, "create_project", {
      name: "Thesis",
      stages: [{ name: "Write", tasks: ["Chapter 1"] }],
    }),
  );
  const pid = proj.done.find((d: any) => d.id.startsWith("project:")).id;
  const task = proj.done.find((d: any) => d.id.startsWith("task:")).id;
  ok(
    await tool(keys.full, "update_project", {
      project: pid,
      milestones: [{ name: "Draft in", due_on: "2026-11-01", tasks: [task] }],
    }),
  );
  const hub = ok(await tool(keys.full, "get_project", { project: pid }));
  assert.equal(hub.milestones.length, 1);
  assert.equal(hub.milestones[0].name, "Draft in");
  assert.equal(hub.milestones[0].tasks, 1);
  const mid = hub.milestones[0].id;
  ok(
    await tool(keys.full, "update_project", {
      project: pid,
      milestones: [{ id: mid, due_on: "2026-11-08", done: true }],
    }),
  );
  await undoLast(grants.full, "update_project");
  const m = async () =>
    (
      await pool.query(
        "SELECT to_char(due_on, 'YYYY-MM-DD') AS due_on, done_at FROM project_milestones WHERE id = $1",
        [mid],
      )
    ).rows[0];
  assert.equal((await m()).due_on, "2026-11-01");
  assert.equal((await m()).done_at, null);
  // A bad day is refused.
  refused(
    await tool(keys.full, "update_project", {
      project: pid,
      milestones: [{ name: "Oops", due_on: "soon" }],
    }),
    "INVALID",
  );
  // Removing it: her own project, so at once; undo brings it back with its task.
  ok(
    await tool(keys.full, "update_project", {
      project: pid,
      milestones: [{ id: mid, remove: true }],
    }),
  );
  assert.equal(await m(), undefined);
  await undoLast(grants.full, "update_project");
  assert.ok(await m());
  assert.equal(
    (
      await pool.query("SELECT milestone_id FROM items WHERE id = $1", [
        idOf(task),
      ])
    ).rows[0].milestone_id,
    mid,
  );
});

test("projects: the agent may keep a project out of AI; letting it back in always asks", async () => {
  const proj = ok(await tool(keys.full, "create_project", { name: "Diary" }));
  const pid = proj.done[0].id;
  const off = ok(
    await tool(keys.full, "update_project", { project: pid, assistant: "off" }),
  );
  assert.match(off.done[0].change, /Kept out of AI/);
  // Gone from the connection's sight.
  refused(await tool(keys.full, "get_project", { project: pid }), "NOT_FOUND");
  // Letting it back in: a proposal that doesn't name it, even at full power
  // and even when the person lets team admin happen alone.
  const asked = ok(
    await tool(keys.alone, "update_project", { project: pid, assistant: "on" }),
  );
  assert.equal(asked.status, "pending_review");
  const outcome = ok(
    await tool(keys.alone, "fetch", { id: asked.pending.proposal_id }),
  );
  assert.ok(!outcome.text.includes("Diary"));
  assert.equal(
    (
      await pool.query("SELECT assistant_off FROM projects WHERE id = $1", [
        idOf(pid),
      ])
    ).rows[0].assistant_off,
    true,
  );
  await approve(asked.pending.proposal_id);
  ok(await tool(keys.full, "get_project", { project: pid }));
  // "on" goes alone.
  refused(
    await tool(keys.full, "update_project", {
      project: pid,
      assistant: "on",
      name: "x",
    }),
    "INVALID",
  );
  // A project that isn't kept out, or one she can't reach.
  refused(
    await tool(keys.full, "update_project", { project: pid, assistant: "on" }),
    "INVALID",
  );
});

test("teams: made, renamed, invited and run only after asking (or when let alone); deleting stays people-only", async () => {
  const carl = await h.register("h6b-carl", "Carl");
  // Full power still asks for team admin: a proposal, approved by the person.
  const asked = ok(
    await tool(keys.full, "organize", {
      changes: [{ do: "create_team", name: "Reading group" }],
    }),
  );
  assert.equal(asked.status, "pending_review");
  const count = async () =>
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.name = 'Reading group' AND m.user_id = $1 AND m.role = 'owner'",
        [olga.id],
      )
    ).rows[0].n;
  assert.equal(await count(), 0);
  await approve(asked.pending.proposal_id);
  assert.equal(await count(), 1);
  // Let alone (team admin and people), the connection renames and invites directly.
  ok(
    await tool(keys.alone, "organize", {
      changes: [{ do: "rename_team", id: crew, name: "H6b crew two" }],
    }),
  );
  const name = async () =>
    (await pool.query("SELECT name FROM teams WHERE id = $1", [crew])).rows[0]
      .name;
  assert.equal(await name(), "H6b crew two");
  await undoLast(grants.alone, "organize");
  assert.equal(await name(), "H6b crew");
  ok(
    await tool(keys.alone, "organize", {
      changes: [
        { do: "invite", id: crew, email: carl.email, role: "viewer" },
        { do: "meeting_budget", id: crew, minutes: 300 },
      ],
    }),
  );
  const role = async (who: string) =>
    (
      await pool.query(
        "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
        [crew, who],
      )
    ).rows[0]?.role;
  assert.equal(await role(carl.id), "viewer");
  ok(
    await tool(keys.alone, "organize", {
      changes: [{ do: "set_role", id: crew, person: carl.id, role: "member" }],
    }),
  );
  assert.equal(await role(carl.id), "member");
  await undoLast(grants.alone, "organize");
  assert.equal(await role(carl.id), "viewer");
  // Full power (not let alone) asks to remove someone.
  const removing = ok(
    await tool(keys.full, "organize", {
      changes: [{ do: "remove_member", id: crew, person: carl.id }],
    }),
  );
  assert.equal(removing.status, "pending_review");
  assert.equal(await role(carl.id), "viewer");
  // Deleting a team, or its agent policy, is never an agent's.
  refused(
    await tool(keys.alone, "organize", {
      changes: [{ do: "delete_team", id: crew }],
    }),
    "INVALID",
  );
  assert.equal(EXCLUDED["DELETE /teams/:id"], "team_admin");
  assert.equal(EXCLUDED["PUT /teams/:id/agent-access"], "team_admin");
  // A member (not an admin) can't run the team, even when asked.
  const moAsk = ok(
    await tool(keys.mo, "organize", {
      changes: [{ do: "rename_team", id: crew, name: "Mo's crew" }],
    }),
  );
  assert.equal(moAsk.status, "pending_review");
  // A read connection can't ask at all.
  refused(
    await tool(keys.read, "organize", {
      changes: [{ do: "rename_team", id: crew, name: "Nope" }],
    }),
    "FORBIDDEN",
  );
});

test("recents and a team's recent changes, only what the connection reaches", async () => {
  const p = await page("Opened lately", "Words");
  assert.equal(
    (await h.call(olga.token, "POST", "/recents", { kind: "doc", id: p.id }))
      .statusCode,
    204,
  );
  const recent = ok(await tool(keys.full, "get_history", { of: "recent" }));
  assert.equal(recent.entries[0].ref, `doc:${p.id}`);
  assert.match(recent.entries[0].what, /^Opened: Opened lately/);
  // Mo writes on a team page: Olga's agent sees it in the team's changes.
  ok(
    await tool(keys.mo, "create_doc", {
      title: "Team minutes",
      markdown: "Agreed things",
      team: crew,
    }),
  );
  const changes = ok(await tool(keys.full, "get_history", { of: "changes" }));
  assert.ok(
    changes.entries.some(
      (e: any) => /Team minutes/.test(e.what) && e.by === "Mo",
    ),
  );
  const one = ok(await tool(keys.full, "get_history", { of: `team:${crew}` }));
  assert.ok(one.entries.length >= 1);
  refused(
    await tool(keys.full, "get_history", {
      of: "team:00000000-0000-4000-8000-000000000000",
    }),
    "NOT_FOUND",
  );
});

test("a subscribed calendar: changed (name, colour, busy) and refreshed on demand, with undo", async () => {
  const sub = ok(
    await tool(keys.full, "update_planner_settings", {
      subscribe: { url: "https://93.184.216.34/timetable.ics", name: "Uni" },
    }),
  );
  const id = idOf(sub.done[0].id);
  ok(
    await tool(keys.full, "update_planner_settings", {
      subscribe: { id, name: "Timetable", color: "#376c51", busy: false },
    }),
  );
  const row = async () =>
    (
      await pool.query(
        "SELECT name, color, busy FROM calendar_subscriptions WHERE id = $1",
        [id],
      )
    ).rows[0];
  assert.deepEqual(await row(), {
    name: "Timetable",
    color: "#376c51",
    busy: false,
  });
  await undoLast(grants.full, "update_planner_settings");
  assert.equal((await row()).name, "Uni");
  const refreshed = ok(
    await tool(keys.full, "update_planner_settings", {
      subscribe: { id, refresh: true },
    }),
  );
  assert.match(refreshed.done[0].change, /fetch/);
  // A new link must reach a public address.
  refused(
    await tool(keys.full, "update_planner_settings", {
      subscribe: { id, url: "https://10.0.0.5/cal.ics" },
    }),
    "INVALID",
  );
  refused(
    await tool(keys.full, "update_planner_settings", {
      subscribe: { id: "00000000-0000-4000-8000-000000000000", refresh: true },
    }),
    "NOT_FOUND",
  );
});

test("the routes H6b covers are covered, and the ones that stay people-only are excluded", () => {
  for (const key of [
    "POST /docs/:id/extract",
    "POST /docs/:id/merge",
    "PUT /docs/:id/aliases",
    "PUT /docs/:id/folds",
    "POST /links/mentions/link",
    "POST /docs/:id/restore",
    "GET /docs/trash",
    "POST /fields",
    "PUT /fields/:id/value",
    "PUT /views/:id/pin",
    "GET /views/:id/export.csv",
    "POST /projects/:id/milestones",
    "PUT /projects/:id/assistant",
    "POST /teams",
    "PUT /teams/:id/members/:userId",
    "PUT /teams/:id/attention",
    "GET /changes",
    "PUT /me/calendar-subscriptions/:id",
    "POST /me/calendar-subscriptions/:id/refresh",
    "DELETE /docs/:id/sources/:sourceId",
  ])
    assert.ok(key in COVERED, key);
  for (const key of [
    "DELETE /teams/:id",
    "PUT /teams/:id/agent-access",
    "DELETE /docs/:id/forever",
    "POST /me/passkeys",
    "DELETE /me",
    "GET /admin/users",
  ])
    assert.ok(key in EXCLUDED, key);
});

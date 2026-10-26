import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";
import type { UserRow } from "../src/lib/auth.js";
import { itemData } from "@orbyn/core";

const { buildApp } = await import("../src/app.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { setItemPlacement, mutate, restoreDerivedItemPlacement } =
  await import("../src/modules/items/service.js");
const { makeLineTasks, requireDoc } =
  await import("../src/modules/docs/service.js");
const { removeLink, staleness, createAgentProposal, mergedItem } =
  await import("../src/modules/proposals/service.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { deleteProject, updateProject } =
  await import("../src/modules/projects/service.js");
const { snapshot } = await import("../src/capabilities/snapshot.js");
const { runUndo } = await import("../src/capabilities/undo.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
let owner: Person, stranger: Person, viewer: Person;
let teamId: string, writeKey: string, askKey: string, webhookId: string;
let actor: UserRow;

before(async () => {
  await migrate();
  owner = await h.register("placement-owner");
  stranger = await h.register("placement-stranger");
  viewer = await h.register("placement-viewer");
  actor = (
    await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [owner.id])
  ).rows[0];
  teamId = await h.team(owner, "Placement team", [[viewer, "viewer"]]);
  writeKey = (await h.agentKey(owner, { access: "write", team_ids: [teamId] }))
    .key;
  askKey = (
    await h.agentKey(owner, {
      access: "write",
      trust: "ask",
      team_ids: [teamId],
    })
  ).key;
  // A durable-event fixture only: no worker runs and no request reaches this URL.
  webhookId = (
    await pool.query<{ id: string }>(
      `INSERT INTO webhooks(user_id,url,events,secret_encrypted)
     VALUES($1,'https://example.invalid/placement',ARRAY['item.created','item.updated'],'fixture') RETURNING id`,
      [owner.id],
    )
  ).rows[0].id;
});
after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(
    network.calls,
    [],
    "placement never calls outside providers",
  );
  network.restore();
  await app.close();
  await pool.end();
});

async function made(path: string, input: object) {
  const r = await h.call(owner.token, "POST", path, input);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
const task = (input: object = {}) =>
  made("/items", { title: "Placement task", kind: "task", ...input });
const project = (input: object = {}) =>
  made("/projects", {
    name: "Placement project",
    stages: ["First", "Next"],
    ...input,
  });
const place = (id: string, body: object, token = owner.token) =>
  h.call(token, "PUT", `/items/${id}/project`, body);
const row = async (id: string) =>
  (await pool.query("SELECT * FROM items WHERE id=$1", [id])).rows[0];
const events = async (id: string, event = "item.updated") =>
  (
    await pool.query(
      "SELECT payload FROM webhook_deliveries WHERE webhook_id=$1 AND event=$2 AND payload->'data'->>'id'=$3",
      [webhookId, event, id],
    )
  ).rows;
async function tool(key: string, name: string, args: object) {
  limiter.reset();
  strikes.reset();
  return (await h.tool(key, name, args)) as any;
}

test("placement preserves task fields and commits one version, history, webhook and live event", async () => {
  const p = await project();
  const t = await task({
    notes: "Keep notes",
    priority: "high",
    progress: 35,
    estimate_minutes: 90,
  });
  const listener = await pool.connect();
  await listener.query("LISTEN orbyn_live");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let receive: ((message: { payload?: string }) => void) | undefined;
  const live = new Promise<any>((resolve, reject) => {
    receive = (message) => {
      const value = JSON.parse(message.payload ?? "{}");
      if (value.entity_type === "task" && value.entity_id === t.id)
        resolve(value);
    };
    listener.on("notification", receive);
    timer = setTimeout(
      () => reject(new Error("No placement live event")),
      3000,
    );
  });
  try {
    const r = await place(t.id, {
      version: t.version,
      project_id: p.id,
      stage_id: p.stages[0].id,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await live).user, owner.id);
    const saved = r.json().item;
    assert.equal(saved.version, t.version + 1);
    for (const field of [
      "title",
      "notes",
      "status",
      "priority",
      "progress",
      "estimate_minutes",
      "due_at",
      "end_at",
    ])
      assert.deepEqual(saved[field], t[field], field);
    assert.equal(saved.project_id, p.id);
    assert.equal(saved.stage_id, p.stages[0].id);
    const queued = await events(t.id);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].payload.data.project_id, p.id);
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM project_activity WHERE project_id=$1 AND entity_id=$2 AND kind='task_added'",
          [p.id, t.id],
        )
      ).rowCount,
      1,
    );
    const retained = await place(t.id, {
      version: saved.version,
      project_id: p.id,
    });
    assert.equal(retained.json().item.stage_id, p.stages[0].id);
    const other = await project();
    const moved = await place(t.id, {
      version: retained.json().item.version,
      project_id: other.id,
    });
    assert.equal(moved.json().item.stage_id, null);
    const unfiled = await place(t.id, {
      version: moved.json().item.version,
      project_id: null,
    });
    assert.equal(unfiled.json().item.project_id, null);
    assert.equal(unfiled.json().item.stage_id, null);
  } finally {
    clearTimeout(timer);
    if (receive) listener.off("notification", receive);
    await listener.query("UNLISTEN orbyn_live");
    listener.release();
  }
});

test("concurrent stale placement and retries cannot overwrite or publish twice", async () => {
  const p = await project(),
    other = await project(),
    t = await task();
  const replies = await Promise.all([
    place(t.id, { version: t.version, project_id: p.id }),
    place(t.id, { version: t.version, project_id: other.id }),
  ]);
  assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 409]);
  const winner = replies.find((r) => r.statusCode === 200)!.json().item;
  const stale = await place(t.id, { version: t.version, project_id: null });
  assert.equal(stale.statusCode, 409);
  assert.equal((await row(t.id)).project_id, winner.project_id);
  assert.equal((await row(t.id)).version, t.version + 1);
  assert.equal((await events(t.id)).length, 1);
});

test("old clients and unauthorized or invalid placements fail without writes", async () => {
  const p = await project(),
    other = await project(),
    t = await task();
  const old = await place(t.id, { project_id: p.id });
  assert.equal(old.statusCode, 422);
  assert.match(old.json().message, /Reload.*update Orbyn/);
  assert.equal(
    (
      await place(
        t.id,
        { version: t.version, project_id: p.id },
        stranger.token,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await place(t.id, {
        version: t.version,
        project_id: p.id,
        stage_id: other.stages[0].id,
      })
    ).statusCode,
    422,
  );
  const teamProject = await project({ team_id: teamId });
  assert.equal(
    (await place(t.id, { version: t.version, project_id: teamProject.id }))
      .statusCode,
    422,
  );
  const teamTask = await task({ team_id: teamId });
  assert.equal(
    (
      await place(
        teamTask.id,
        { version: teamTask.version, project_id: teamProject.id },
        viewer.token,
      )
    ).statusCode,
    403,
  );
  const meeting = await made("/items", {
    title: "Meeting",
    kind: "event",
    due_at: "2026-12-01T10:00:00Z",
  });
  assert.equal(
    (await place(meeting.id, { version: meeting.version, project_id: p.id }))
      .statusCode,
    422,
  );
  assert.equal((await row(t.id)).version, t.version);
  assert.equal((await events(t.id)).length, 0);
});

test("rolling back placement rolls back its version and durable effects", async () => {
  const p = await project(),
    t = await task();
  await assert.rejects(
    transaction(async (db) => {
      await setItemPlacement(db, actor, t.id, {
        version: t.version,
        project_id: p.id,
      });
      throw new Error("fixture rollback");
    }),
    /fixture rollback/,
  );
  assert.equal((await row(t.id)).version, t.version);
  assert.equal((await row(t.id)).project_id, null);
  assert.equal((await events(t.id)).length, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM project_activity WHERE project_id=$1 AND entity_id=$2",
        [p.id, t.id],
      )
    ).rowCount,
    0,
  );
});

test("MCP legacy placement uses active compatibility while explicit stale versions still conflict", async () => {
  const p = await project(),
    t = await task();
  const input = {
    action: "link",
    kind: "task_project",
    from: `task:${t.id}`,
    to: `project:${p.id}`,
  };
  const legacy = await tool(writeKey, "link", input);
  assert.ok(!legacy.isError, legacy.content?.[0]?.text);
  const made = await tool(writeKey, "link", {
    ...input,
    version: (await row(t.id)).version,
  });
  assert.ok(!made.isError, made.content?.[0]?.text);
  assert.equal((await row(t.id)).project_id, p.id);
  assert.equal((await events(t.id)).length, 2);
  const stale = await tool(writeKey, "link", { ...input, version: t.version });
  assert.equal(stale._meta?.["orbyn/error"]?.code, "VERSION_CONFLICT");
  assert.equal((await events(t.id)).length, 2);
});

test("project unlink proposals capture a version and old or stale proposals cannot apply", async () => {
  const p = await project(),
    t = await task({ project_id: p.id });
  const proposal = async () => {
    const result = await tool(askKey, "propose_changes", {
      summary: "Unfile the task",
      changes: [
        {
          type: "unlink",
          target: `task:${t.id}`,
          unlink: "project",
          to: `project:${p.id}`,
        },
      ],
    });
    assert.ok(!result.isError, result.content?.[0]?.text);
    return result.structuredContent.pending.proposal_id.replace(
      /^proposal:/,
      "",
    );
  };
  const id = await proposal();
  const change = (
    await pool.query("SELECT changes FROM proposals WHERE id=$1", [id])
  ).rows[0].changes[0];
  assert.equal(change.version, t.version);
  const legacy = { ...change };
  delete legacy.version;
  await assert.rejects(
    createAgentProposal(pool, {
      userId: owner.id,
      grantId: null,
      clientName: "Fixture",
      summary: "Reject new versionless unlink",
      changes: [legacy],
    }),
    /capture its version/,
  );
  assert.match((await staleness(pool, owner.id, legacy))!, /propose it again/);
  await pool.query("UPDATE proposals SET changes=$2::jsonb WHERE id=$1", [
    id,
    JSON.stringify([legacy]),
  ]);
  const rejected = await h.call(
    owner.token,
    "POST",
    `/proposals/${id}/apply`,
    {},
  );
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.equal((await row(t.id)).project_id, p.id);
  assert.equal((await events(t.id)).length, 0);
  await assert.rejects(
    transaction((db) => removeLink(db, actor, legacy)),
    /propose it again/,
  );
  const stale = await proposal();
  const revised = await place(t.id, { version: t.version, project_id: p.id });
  assert.equal(revised.statusCode, 200, revised.body);
  const staleApproval = await h.call(
    owner.token,
    "POST",
    `/proposals/${stale}/apply`,
    {},
  );
  assert.equal(staleApproval.statusCode, 409, staleApproval.body);
  assert.equal((await row(t.id)).project_id, p.id);
  const current = await proposal();
  const applied = await h.call(
    owner.token,
    "POST",
    `/proposals/${current}/apply`,
    {},
  );
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal((await row(t.id)).project_id, null);
  assert.equal((await events(t.id)).length, 2);
  await assert.rejects(
    transaction((db) => removeLink(db, actor, change)),
    /project changed|item changed/,
  );
  const unrelated = { ...legacy, kind: "depends_on" as const };
  assert.equal(await staleness(pool, owner.id, unrelated), null);
  await transaction((db) => removeLink(db, actor, unrelated));
});

test("document extraction and Clipper create final placement before item.created", async () => {
  const p = await project();
  const doc = await made("/docs", {
    title: "Tasks",
    content: [{ type: "todo", text: "Extract me", done: false }],
  });
  const extracted = await transaction(async (db) => {
    const owned = await requireDoc(db, doc.id, actor, "items:write");
    return await makeLineTasks(db, actor, owned, { projectId: p.id });
  });
  assert.equal(extracted?.length, 1);
  const extractedId = extracted![0].id;
  assert.equal(
    (await events(extractedId, "item.created"))[0].payload.data.project_id,
    p.id,
  );
  assert.equal((await row(extractedId)).stage_id, p.stages[0].id);
  const clipped = await h.call(owner.token, "POST", "/clips", {
    type: "read_later",
    url: "https://example.invalid/article",
    title: "Read this",
    project_id: p.id,
  });
  assert.equal(clipped.statusCode, 201, clipped.body);
  const clippedId = clipped.json().made.id;
  assert.equal(
    (await events(clippedId, "item.created"))[0].payload.data.project_id,
    p.id,
  );
  assert.equal((await row(clippedId)).stage_id, p.stages[0].id);
});

test("document extraction rejects an inaccessible destination without creating tasks or changing source", async () => {
  const privateProject = await h.call(stranger.token, "POST", "/projects", {
    name: "Private destination",
  });
  assert.equal(privateProject.statusCode, 201, privateProject.body);
  const doc = await made("/docs", {
    title: "Retained source",
    content: [{ type: "todo", text: "Never extract to stranger", done: false }],
  });
  const before = (
    await pool.query("SELECT content,version FROM docs WHERE id=$1", [doc.id])
  ).rows[0];
  await assert.rejects(
    transaction(async (db) => {
      const owned = await requireDoc(db, doc.id, actor, "items:write");
      await makeLineTasks(db, actor, owned, {
        projectId: privateProject.json().id,
      });
    }),
    /Project not found/,
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM items WHERE user_id=$1 AND title=$2", [
        owner.id,
        "Never extract to stranger",
      ])
    ).rowCount,
    0,
  );
  assert.deepEqual(
    (await pool.query("SELECT content,version FROM docs WHERE id=$1", [doc.id]))
      .rows[0],
    before,
  );
});

test("create validates fallback placement and inserts final placement once with explicit data precedence", async () => {
  const p = await project(),
    other = await project(),
    teamProject = await project({ team_id: teamId });
  const privateProject = await h.call(stranger.token, "POST", "/projects", {
    name: "Private fallback",
  });
  assert.equal(privateProject.statusCode, 201, privateProject.body);
  const create = (
    data: object,
    fallback = { project_id: p.id, stage_id: p.stages[0].id },
  ) =>
    transaction((db) =>
      mutate(
        db,
        actor,
        {
          operation: "create",
          data: itemData.parse({
            title: "Fallback placement",
            kind: "task",
            ...data,
          }),
        },
        undefined,
        { place: fallback },
      ),
    );
  for (const destination of [privateProject.json(), teamProject]) {
    await assert.rejects(
      create(
        {},
        { project_id: destination.id, stage_id: destination.stages[0].id },
      ),
      /Project not found/,
    );
  }
  await assert.rejects(
    create({}, { project_id: p.id, stage_id: other.stages[0].id }),
    /stage isn't in this project/,
  );
  await assert.rejects(
    create({ kind: "event", due_at: "2026-12-01T10:00:00Z" }),
    /Only tasks/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id=$1 AND title='Fallback placement'",
        [owner.id],
      )
    ).rowCount,
    0,
  );
  const own = (await create({}))!;
  assert.equal(own.project_id, p.id);
  assert.equal(own.stage_id, p.stages[0].id);
  const history = (
    await pool.query(
      "SELECT kind,after_state FROM project_activity WHERE entity_id=$1 ORDER BY event_order",
      [own.id],
    )
  ).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].kind, "task_added");
  assert.equal(history[0].after_state.stage_id, p.stages[0].id);
  assert.equal(
    (await events(own.id, "item.created"))[0].payload.data.project_id,
    p.id,
  );
  const unfiled = (await create({ project_id: null }))!;
  assert.equal(unfiled.project_id, null);
  assert.equal(unfiled.stage_id, null);
  const explicit = (await create({ project_id: other.id }))!;
  assert.equal(explicit.project_id, other.id);
  assert.equal(explicit.stage_id, null);
  const stage = (await create({ stage_id: p.stages[1].id }))!;
  assert.equal(stage.project_id, p.id);
  assert.equal(stage.stage_id, p.stages[1].id);
});

test("deleting a project derives one versioned unfile event per task and preserves unrelated tasks", async () => {
  const p = await project(),
    other = await project();
  const a = await task({
    project_id: p.id,
    stage_id: p.stages[0].id,
    notes: "Keep me",
    progress: 45,
    priority: "high",
  });
  const b = await task({ project_id: p.id, status: "done" });
  const untouched = await task({ project_id: other.id });
  const deleted = await h.call(owner.token, "DELETE", `/projects/${p.id}`);
  assert.equal(deleted.statusCode, 204, deleted.body);
  for (const original of [a, b]) {
    const saved = await row(original.id);
    assert.equal(saved.version, original.version + 1);
    assert.notEqual(saved.updated_at.toISOString(), original.updated_at);
    assert.equal(saved.project_id, null);
    assert.equal(saved.stage_id, null);
    for (const field of ["title", "notes", "status", "progress", "priority"])
      assert.equal(saved[field], original[field], field);
    const queued = await events(original.id);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].payload.data.project_id, null);
    assert.equal(queued[0].payload.data.version, saved.version);
  }
  assert.equal((await row(untouched.id)).version, untouched.version);
  assert.equal((await events(untouched.id)).length, 0);
});

test("deleting a stage clears only matching tasks and retains their project", async () => {
  const p = await project();
  const a = await task({ project_id: p.id, stage_id: p.stages[0].id });
  const b = await task({ project_id: p.id, stage_id: p.stages[1].id });
  const c = await task({ project_id: p.id });
  const changed = await h.call(owner.token, "PUT", `/projects/${p.id}`, {
    stages: [{ id: p.stages[1].id, name: p.stages[1].name }],
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const saved = await row(a.id);
  assert.equal(saved.project_id, p.id);
  assert.equal(saved.stage_id, null);
  assert.equal(saved.version, a.version + 1);
  assert.notEqual(saved.updated_at.toISOString(), a.updated_at);
  assert.equal((await events(a.id)).length, 1);
  for (const original of [b, c]) {
    assert.equal((await row(original.id)).version, original.version);
    assert.equal((await row(original.id)).stage_id, original.stage_id ?? null);
    assert.equal((await events(original.id)).length, 0);
  }
});

test("denied project/stage deletion changes no task versions or events", async () => {
  const p = await project({ team_id: teamId });
  const t = await task({
    team_id: teamId,
    project_id: p.id,
    stage_id: p.stages[0].id,
  });
  for (const who of [viewer, stranger]) {
    const expected = who === viewer ? 403 : 404;
    assert.equal(
      (await h.call(who.token, "DELETE", `/projects/${p.id}`)).statusCode,
      expected,
    );
    assert.equal(
      (await h.call(who.token, "PUT", `/projects/${p.id}`, { stages: [] }))
        .statusCode,
      expected,
    );
  }
  assert.equal((await row(t.id)).version, t.version);
  assert.equal((await row(t.id)).stage_id, p.stages[0].id);
  assert.equal((await events(t.id)).length, 0);
});

test("a rejected derived task rolls back earlier task changes and the project command", async () => {
  const p = await project();
  const items = [
    await task({ project_id: p.id }),
    await task({ project_id: p.id }),
  ].sort((a, b) => a.id.localeCompare(b.id));
  // Simulate an inconsistent retained row; the owner must refuse rather than bypass its access check.
  await pool.query("UPDATE items SET user_id=$2 WHERE id=$1", [
    items[1].id,
    stranger.id,
  ]);
  const rejected = await h.call(owner.token, "DELETE", `/projects/${p.id}`);
  assert.equal(rejected.statusCode, 404, rejected.body);
  assert.equal(
    (await h.call(owner.token, "GET", `/projects/${p.id}`)).statusCode,
    200,
  );
  for (const original of items) {
    assert.equal((await row(original.id)).version, original.version);
    assert.equal((await row(original.id)).project_id, p.id);
    assert.equal((await events(original.id)).length, 0);
  }
});

test("concurrent creation cannot attach to a deleted project without a derived event", async () => {
  const p = await project(),
    id = randomUUID();
  const [created, deleted] = await Promise.allSettled([
    transaction((db) =>
      mutate(
        db,
        actor,
        {
          operation: "create",
          data: itemData.parse({
            title: "Concurrent attachment",
            project_id: p.id,
          }),
        },
        id,
      ),
    ),
    transaction((db) => deleteProject(db, actor, p.id)),
  ]);
  assert.equal(deleted.status, "fulfilled");
  const saved = await row(id);
  if (created.status === "fulfilled") {
    assert.equal(saved.project_id, null);
    assert.equal(saved.version, created.value!.version + 1);
    assert.equal((await events(id)).length, 1);
  } else {
    assert.equal(created.reason.statusCode, 404);
    assert.equal(saved, undefined);
    assert.equal((await events(id, "item.created")).length, 0);
  }
});

test("concurrent move cannot attach to a removed stage after its cascade", async () => {
  const p = await project(),
    t = await task();
  const [moved, removed] = await Promise.allSettled([
    transaction((db) =>
      setItemPlacement(db, actor, t.id, {
        version: t.version,
        project_id: p.id,
        stage_id: p.stages[0].id,
      }),
    ),
    transaction((db) =>
      updateProject(db, actor, p.id, {
        stages: [{ id: p.stages[1].id, name: p.stages[1].name }],
      }),
    ),
  ]);
  assert.equal(removed.status, "fulfilled");
  const saved = await row(t.id);
  assert.equal(saved.stage_id, null);
  if (moved.status === "fulfilled") {
    assert.equal(saved.project_id, p.id);
    assert.equal(saved.version, t.version + 2);
    assert.equal((await events(t.id)).length, 2);
  } else {
    assert.equal(moved.reason.statusCode, 422);
    assert.equal(saved.project_id, null);
    assert.equal(saved.version, t.version);
    assert.equal((await events(t.id)).length, 0);
  }
});

test("project snapshot undo restores project and stage with one canonical item change", async () => {
  const p = await project(),
    t = await task({
      project_id: p.id,
      stage_id: p.stages[0].id,
      notes: "Retain note",
    });
  const saved = await transaction(async (db) => {
    const copy = await snapshot(db, "project", [p.id]);
    await deleteProject(db, actor, p.id);
    return copy;
  });
  assert.equal(saved.placementVersions?.[t.id], t.version);
  assert.equal((await row(t.id)).version, t.version + 1);
  await transaction((db) =>
    runUndo(db, actor, [
      { op: "rows.recreate", label: "Restore project", ...saved },
    ]),
  );
  const restored = await row(t.id);
  assert.equal(restored.project_id, p.id);
  assert.equal(restored.stage_id, p.stages[0].id);
  assert.equal(restored.notes, "Retain note");
  assert.equal(restored.version, t.version + 2);
  const queued = await events(t.id);
  assert.equal(queued.length, 2);
  assert.equal(queued[1].payload.data.stage_id, p.stages[0].id);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM project_activity WHERE project_id=$1 AND entity_id=$2 AND kind='task_added'",
        [p.id, t.id],
      )
    ).rowCount,
    2,
  );
});

test("stage snapshot undo restores only unchanged stage memberships", async () => {
  const p = await project(),
    a = await task({ project_id: p.id, stage_id: p.stages[0].id }),
    b = await task({ project_id: p.id, stage_id: p.stages[1].id });
  const saved = await transaction(async (db) => {
    const copy = await snapshot(db, "stage", [p.stages[0].id]);
    await updateProject(db, actor, p.id, {
      stages: [{ id: p.stages[1].id, name: p.stages[1].name }],
    });
    return copy;
  });
  await transaction((db) =>
    runUndo(db, actor, [
      { op: "rows.recreate", label: "Restore stage", ...saved },
    ]),
  );
  assert.equal((await row(a.id)).project_id, p.id);
  assert.equal((await row(a.id)).stage_id, p.stages[0].id);
  assert.equal((await row(a.id)).version, a.version + 2);
  assert.equal((await events(a.id)).length, 2);
  assert.equal((await row(b.id)).version, b.version);
  assert.equal((await events(b.id)).length, 0);
});

test("snapshot undo preserves a newer project choice and a newer deliberate unfile", async () => {
  for (const unfile of [false, true]) {
    const p = await project(),
      other = await project(),
      t = await task({ project_id: p.id, stage_id: p.stages[0].id });
    const saved = await transaction(async (db) => {
      const copy = await snapshot(db, "project", [p.id]);
      await deleteProject(db, actor, p.id);
      return copy;
    });
    const choice = await place(t.id, {
      version: (await row(t.id)).version,
      project_id: unfile ? null : other.id,
      ...(!unfile ? { stage_id: other.stages[0].id } : {}),
    });
    assert.equal(choice.statusCode, 200, choice.body);
    const before = await row(t.id);
    await transaction((db) =>
      runUndo(db, actor, [
        { op: "rows.recreate", label: "Restore without overwriting", ...saved },
      ]),
    );
    const after = await row(t.id);
    assert.equal(after.project_id, before.project_id);
    assert.equal(after.stage_id, before.stage_id);
    assert.equal(after.version, before.version);
    assert.equal((await events(t.id)).length, 2);
    assert.equal(
      (await h.call(owner.token, "GET", `/projects/${p.id}`)).statusCode,
      200,
    );
  }
});

test("legacy snapshots restore parents while preserving task placement without guessing versions", async () => {
  const p = await project(),
    t = await task({ project_id: p.id, stage_id: p.stages[0].id });
  const saved = await transaction(async (db) => {
    const copy = await snapshot(db, "project", [p.id]);
    await deleteProject(db, actor, p.id);
    return copy;
  });
  delete saved.placementVersions;
  await transaction((db) =>
    runUndo(db, actor, [
      { op: "rows.recreate", label: "Restore legacy parent", ...saved },
    ]),
  );
  assert.equal(
    (await h.call(owner.token, "GET", `/projects/${p.id}`)).statusCode,
    200,
  );
  assert.equal((await row(t.id)).project_id, null);
  assert.equal((await row(t.id)).stage_id, null);
  assert.equal((await row(t.id)).version, t.version + 1);
  assert.equal((await events(t.id)).length, 1);
  const report = (
    await pool.query(
      "SELECT details FROM audit_log WHERE actor_id=$1 AND action='agent.snapshot_placement_preserved' ORDER BY id DESC LIMIT 1",
      [owner.id],
    )
  ).rows[0].details;
  assert.equal(report.preserved, 1);
  assert.equal(report.restored, 0);
});

test("restored stage cannot be attached to a different current project", async () => {
  const p = await project(),
    other = await project(),
    t = await task({ project_id: other.id });
  const result = await transaction((db) =>
    restoreDerivedItemPlacement(db, actor, [
      { id: t.id, stage_id: p.stages[0].id, expectedVersion: t.version },
    ]),
  );
  assert.deepEqual(result, { restored: 0, preserved: 1 });
  assert.equal((await row(t.id)).project_id, other.id);
  assert.equal((await row(t.id)).stage_id, null);
  assert.equal((await row(t.id)).version, t.version);
  assert.equal((await events(t.id)).length, 0);
});

test("snapshot placement still checks item permission and rolls back the restored parent on refusal", async () => {
  const p = await project(),
    t = await task({ project_id: p.id });
  const saved = await transaction(async (db) => {
    const copy = await snapshot(db, "project", [p.id]);
    await deleteProject(db, actor, p.id);
    return copy;
  });
  await pool.query("UPDATE items SET user_id=$2 WHERE id=$1", [
    t.id,
    stranger.id,
  ]);
  await assert.rejects(
    transaction((db) =>
      runUndo(db, actor, [
        { op: "rows.recreate", label: "Refused restored placement", ...saved },
      ]),
    ),
    /Item not found/,
  );
  assert.equal(
    (await h.call(owner.token, "GET", `/projects/${p.id}`)).statusCode,
    404,
  );
  assert.equal((await row(t.id)).project_id, null);
  assert.equal((await row(t.id)).version, t.version + 1);
  assert.equal((await events(t.id)).length, 1);
});

test("same-job undo carries only successful item receipts across snapshot restoration", async () => {
  for (const editBeforeDeletion of [true, false]) {
    const p = await project(),
      t = await task({
        project_id: p.id,
        stage_id: p.stages[0].id,
        notes: "Original note",
      });
    let editVersion = 0;
    const saved = await transaction(async (db) => {
      const edit = async () => {
        const current = (
          await db.query("SELECT * FROM items WHERE id=$1", [t.id])
        ).rows[0];
        const updated = await mutate(db, actor, {
          operation: "update",
          item_id: t.id,
          version: current.version,
          data: mergedItem(
            current,
            editBeforeDeletion ? { priority: "high" } : { notes: "Later note" },
          ),
        });
        editVersion = updated!.version;
      };
      if (editBeforeDeletion) await edit();
      const copy = await snapshot(db, "project", [p.id]);
      await deleteProject(db, actor, p.id);
      if (!editBeforeDeletion) await edit();
      return copy;
    });
    const snapshotUndo = {
      op: "rows.recreate" as const,
      label: "Restore project in job",
      ...saved,
    };
    const itemUndo = {
      op: "item.restore" as const,
      id: t.id,
      version: editVersion,
      fields: editBeforeDeletion
        ? { priority: "medium" }
        : { notes: "Original note" },
    };
    await transaction((db) =>
      runUndo(
        db,
        actor,
        editBeforeDeletion
          ? [itemUndo, snapshotUndo]
          : [snapshotUndo, itemUndo],
      ),
    );
    const restored = await row(t.id);
    assert.equal(restored.project_id, p.id);
    assert.equal(restored.stage_id, p.stages[0].id);
    assert.equal(restored.priority, "medium");
    assert.equal(restored.notes, "Original note");
    assert.equal(restored.version, t.version + 4);
    assert.equal((await events(t.id)).length, 4);
  }
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");

/**
 * Links between things must stay inside one space. Found by the full API
 * pass: pages could hang off other people's events, projects and folders,
 * and tasks could be filed into projects of another space.
 */
const app = await buildApp();
const people: Record<string, string> = {};

const as = (who: string) => ({
  call: (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${people[who]}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    }),
});

let eventId = "";
let projectId = "";
let folderId = "";
let teamId = "";
let teamProjectId = "";
let personalTaskId = "";
let teamTaskId = "";

before(async () => {
  await migrate();
  for (const who of ["owner", "outsider"]) {
    const body = (
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: `space-${who}-${randomUUID()}@example.com`,
          password: "a-long-test-password",
          name: who,
        },
      })
    ).json();
    people[who] = body.token;
  }
  const owner = as("owner");
  const start = new Date(Date.now() + 86_400_000);
  eventId = (
    await owner.call("POST", "/items", {
      kind: "event",
      title: "Board meeting",
      due_at: start.toISOString(),
      end_at: new Date(start.getTime() + 3_600_000).toISOString(),
    })
  ).json().id;
  projectId = (
    await owner.call("POST", "/projects", { name: "Secret plan" })
  ).json().id;
  folderId = (await owner.call("POST", "/folders", { name: "Private" })).json()
    .id;
  teamId = (await owner.call("POST", "/teams", { name: "Crew" })).json().id;
  teamProjectId = (
    await owner.call("POST", "/projects", {
      name: "Crew plan",
      team_id: teamId,
    })
  ).json().id;
  personalTaskId = (
    await owner.call("POST", "/items", { title: "Mine" })
  ).json().id;
  teamTaskId = (
    await owner.call("POST", "/items", { title: "Ours", team_id: teamId })
  ).json().id;
});

after(async () => {
  await app.close();
  await pool.end();
});

test("a page can't hang off someone else's event, project or folder", async () => {
  const outsider = as("outsider");
  const ownTeam = (
    await outsider.call("POST", "/teams", { name: "Mine" })
  ).json().id;
  for (const link of [
    { kind: "meeting", team_id: ownTeam, item_id: eventId },
    { kind: "note", project_id: projectId },
    { kind: "note", folder_id: folderId },
  ]) {
    const made = await outsider.call("POST", "/docs", {
      title: "INJECTED",
      content: [],
      ...link,
    });
    assert.equal(made.statusCode, 404, JSON.stringify(link) + made.body);
  }
  // An id that doesn't exist is the same 404, not a 500.
  for (const link of [
    { project_id: randomUUID() },
    { folder_id: randomUUID() },
  ])
    assert.equal(
      (
        await outsider.call("POST", "/docs", {
          title: "x",
          content: [],
          ...link,
        })
      ).statusCode,
      404,
    );
  // Nor can their own page be moved into the owner's folder.
  const own = (
    await outsider.call("POST", "/docs", { title: "Own", content: [] })
  ).json();
  assert.equal(
    (
      await outsider.call("PUT", `/docs/${own.id}`, {
        version: own.version,
        folder_id: folderId,
      })
    ).statusCode,
    404,
  );
  // The owner's meeting note is the owner's own.
  const note = await as("owner").call("POST", `/items/${eventId}/note`);
  assert.equal(note.statusCode < 300, true, note.body);
  assert.notEqual(note.json().title, "INJECTED");
});

test("only what you can see can be starred, and folders count what you can see", async () => {
  assert.equal(
    (
      await as("outsider").call("PUT", "/favourites", {
        kind: "project",
        target_id: projectId,
        starred: true,
      })
    ).statusCode,
    404,
  );
  const folders = (await as("owner").call("GET", "/folders")).json();
  assert.equal(
    folders.find((f: { id: string }) => f.id === folderId).doc_count,
    0,
  );
});

test("a task goes into a project in its own space", async () => {
  const owner = as("owner");
  assert.equal(
    (
      await owner.call("PUT", `/items/${teamTaskId}/project`, {
        project_id: projectId,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await owner.call("PUT", `/items/${personalTaskId}/project`, {
        project_id: teamProjectId,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await owner.call("PUT", `/items/${teamTaskId}/project`, {
        project_id: teamProjectId,
      })
    ).statusCode,
    200,
  );
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { favouriteSet, favouriteKey } = await import("@orbyn/core");

const app = await buildApp();
let token = "";
let otherToken = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  as = () => token,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${as()}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string) =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `folder-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    })
  ).json().token as string;

before(async () => {
  await migrate();
  token = await register("Filer");
  otherToken = await register("Stranger");
});
after(async () => {
  await app.close();
  await pool.end();
});

test("a favourite set answers 'is this starred' by kind and id", () => {
  const set = favouriteSet([
    { kind: "doc", target_id: "a", created_at: "" },
    { kind: "project", target_id: "b", created_at: "" },
  ]);
  assert.ok(set.has(favouriteKey("doc", "a")));
  assert.ok(set.has(favouriteKey("project", "b")));
  // The same id under a different kind is a different thing.
  assert.ok(!set.has(favouriteKey("project", "a")));
});

test("folders are created in order and count their documents", async () => {
  const first = await call("POST", "/folders", { name: "Research" });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().position, 0);
  assert.equal(first.json().doc_count, 0);
  const second = (await call("POST", "/folders", { name: "Admin" })).json();
  assert.equal(second.position, 1);

  const doc = (
    await call("POST", "/docs", {
      title: "Filed away",
      folder_id: first.json().id,
    })
  ).json();
  assert.equal(doc.folder_id, first.json().id);

  const listed = (await call("GET", "/folders")).json();
  const research = listed.find((f: { id: string }) => f.id === first.json().id);
  assert.equal(research.doc_count, 1);
});

test("a document can be filed, moved and unfiled", async () => {
  const a = (await call("POST", "/folders", { name: "A" })).json();
  const b = (await call("POST", "/folders", { name: "B" })).json();
  const doc = (await call("POST", "/docs", { title: "Wanderer" })).json();
  assert.equal(doc.folder_id, null);

  const filed = (
    await call("PUT", `/docs/${doc.id}`, {
      folder_id: a.id,
      version: doc.version,
    })
  ).json();
  assert.equal(filed.folder_id, a.id);

  const moved = (
    await call("PUT", `/docs/${doc.id}`, {
      folder_id: b.id,
      version: filed.version,
    })
  ).json();
  assert.equal(moved.folder_id, b.id);

  const unfiled = (
    await call("PUT", `/docs/${doc.id}`, {
      folder_id: null,
      version: moved.version,
    })
  ).json();
  assert.equal(unfiled.folder_id, null);

  // An edit that says nothing about the folder leaves it where it is.
  const refiled = (
    await call("PUT", `/docs/${doc.id}`, {
      folder_id: a.id,
      version: unfiled.version,
    })
  ).json();
  const renamedOnly = (
    await call("PUT", `/docs/${doc.id}`, {
      title: "Still filed",
      version: refiled.version,
    })
  ).json();
  assert.equal(renamedOnly.folder_id, a.id);
});

test("deleting a folder keeps its documents, unfiled", async () => {
  const folder = (await call("POST", "/folders", { name: "Temporary" })).json();
  const doc = (
    await call("POST", "/docs", { title: "Survivor", folder_id: folder.id })
  ).json();

  assert.equal((await call("DELETE", `/folders/${folder.id}`)).statusCode, 204);
  const still = await call("GET", `/docs/${doc.id}`);
  assert.equal(still.statusCode, 200, "the document is still there");
  assert.equal(still.json().folder_id, null, "and is unfiled");
});

test("folders can be renamed, and someone else's is not found", async () => {
  const folder = (await call("POST", "/folders", { name: "Old name" })).json();
  const renamed = (
    await call("PUT", `/folders/${folder.id}`, { name: "New name" })
  ).json();
  assert.equal(renamed.name, "New name");

  assert.equal(
    (
      await call(
        "PUT",
        `/folders/${folder.id}`,
        { name: "Hijack" },
        () => otherToken,
      )
    ).statusCode,
    404,
  );
  const theirs = await call("GET", "/folders", undefined, () => otherToken);
  assert.ok(!theirs.json().some((f: { id: string }) => f.id === folder.id));
});

test("starring is idempotent, and unstarring removes it", async () => {
  const doc = (await call("POST", "/docs", { title: "Keeper" })).json();
  assert.equal(
    (
      await call("PUT", "/favourites", {
        kind: "doc",
        target_id: doc.id,
        starred: true,
      })
    ).statusCode,
    204,
  );
  // Starring again doesn't duplicate or error.
  await call("PUT", "/favourites", {
    kind: "doc",
    target_id: doc.id,
    starred: true,
  });
  const stars = (await call("GET", "/favourites")).json();
  assert.equal(
    stars.filter((f: { target_id: string }) => f.target_id === doc.id).length,
    1,
  );

  await call("PUT", "/favourites", {
    kind: "doc",
    target_id: doc.id,
    starred: false,
  });
  const after = (await call("GET", "/favourites")).json();
  assert.ok(!after.some((f: { target_id: string }) => f.target_id === doc.id));
});

test("favourites are private to the person who starred", async () => {
  const doc = (await call("POST", "/docs", { title: "Mine" })).json();
  await call("PUT", "/favourites", {
    kind: "doc",
    target_id: doc.id,
    starred: true,
  });
  const theirs = await call("GET", "/favourites", undefined, () => otherToken);
  assert.ok(
    !theirs.json().some((f: { target_id: string }) => f.target_id === doc.id),
  );
});

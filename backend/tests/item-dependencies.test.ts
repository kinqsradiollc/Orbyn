import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { itemBody } from "@orbyn/core";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { migrate } = await import("../src/db/migrate.js");
const { pool } = await import("../src/db/pool.js");

const app = await buildApp();
after(async () => {
  await app.close();
  await pool.end();
});
let token = "";
let strangerToken = "";

const call = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
        email: `dep-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    })
  ).json().token as string;

const newTask = async (title: string, as = () => token) =>
  (await call("POST", "/items", { title, kind: "task" }, as)).json();

/** Save a task, carrying the version it was last read at. */
const save = async (
  id: string,
  body: Record<string, unknown>,
  as = () => token,
) => {
  const current = (await call("GET", `/items/${id}`, undefined, as)).json();
  return call(
    "PUT",
    `/items/${id}`,
    { title: current.title, kind: "task", version: current.version, ...body },
    as,
  );
};

before(async () => {
  await migrate();
  token = await register("Planner");
  strangerToken = await register("Stranger");
});

test("a task carries what it waits on, and says so on every read", async () => {
  const first = await newTask("Draw the thing");
  const second = await newTask("Build the thing");
  const saved = await save(second.id, { prerequisite_ids: [first.id] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().prerequisite_ids, [first.id]);

  // The list and the single read agree; a client should not have to ask twice.
  const one = await call("GET", `/items/${second.id}`);
  assert.deepEqual(one.json().prerequisite_ids, [first.id]);
  assert.deepEqual(
    itemBody(one.json()).prerequisite_ids,
    [first.id],
    "the mobile write payload retains the selected prerequisites",
  );
  const listed = (await call("GET", "/items?limit=500&offset=0")).json();
  const row = (listed.items ?? listed).find(
    (i: { id: string }) => i.id === second.id,
  );
  assert.deepEqual(row.prerequisite_ids, [first.id]);
  // Nothing waits on the first one.
  assert.deepEqual(
    (await call("GET", `/items/${first.id}`)).json().prerequisite_ids,
    [],
  );
});

test("omitting the field keeps what is saved; an empty array clears it", async () => {
  const first = await newTask("Sand it");
  const second = await newTask("Paint it");
  await save(second.id, { prerequisite_ids: [first.id] });
  // An older client that knows nothing about dependencies must not drop them.
  const renamed = await save(second.id, { title: "Paint it twice" });
  assert.deepEqual(renamed.json().prerequisite_ids, [first.id]);
  const cleared = await save(second.id, { prerequisite_ids: [] });
  assert.deepEqual(cleared.json().prerequisite_ids, []);
});

test("a task cannot wait on itself", async () => {
  const task = await newTask("Bootstrap");
  const response = await save(task.id, { prerequisite_ids: [task.id] });
  assert.equal(response.statusCode, 422, response.body);
  assert.match(response.json().message, /wait on itself/i);
});

test("a loop is refused, however far around it goes", async () => {
  const a = await newTask("A");
  const b = await newTask("B");
  const c = await newTask("C");
  const link = (item: { id: string }, on: { id: string }[]) =>
    save(item.id, { prerequisite_ids: on.map((p) => p.id) });
  assert.equal((await link(b, [a])).statusCode, 200);
  assert.equal((await link(c, [b])).statusCode, 200);
  // A waiting on C would close the ring A -> B -> C -> A.
  const looped = await link(a, [c]);
  assert.equal(looped.statusCode, 422, looped.body);
  assert.match(looped.json().message, /loop/i);
  // The refusal changed nothing.
  assert.deepEqual(
    (await call("GET", `/items/${a.id}`)).json().prerequisite_ids,
    [],
  );
});

test("a task can only wait on tasks you can see", async () => {
  const mine = await newTask("Mine");
  const theirs = await newTask("Theirs", () => strangerToken);
  const response = await save(mine.id, { prerequisite_ids: [theirs.id] });
  assert.equal(response.statusCode, 422, response.body);
  assert.match(response.json().message, /tasks you can see/i);
});

test("a task that becomes an event stops waiting on anything", async () => {
  const first = await newTask("Prepare");
  const second = await newTask("Present");
  await save(second.id, { prerequisite_ids: [first.id] });
  const asEvent = await save(second.id, {
    kind: "event",
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
    end_at: new Date(Date.now() + 90_000_000).toISOString(),
  });
  assert.equal(asEvent.statusCode, 200, asEvent.body);
  assert.deepEqual(asEvent.json().prerequisite_ids, []);
});

test("a deleted prerequisite takes its edge with it", async () => {
  const first = await newTask("Goes away");
  const second = await newTask("Stays");
  await save(second.id, { prerequisite_ids: [first.id] });
  const gone = await call(
    "DELETE",
    `/items/${first.id}?version=${first.version}`,
  );
  assert.equal(gone.statusCode, 204, gone.body);
  const left = await call("GET", `/items/${second.id}`);
  assert.equal(left.statusCode, 200);
  assert.deepEqual(left.json().prerequisite_ids, []);
});

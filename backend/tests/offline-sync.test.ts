import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `sync-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return r.json().token as string;
}

let me = "";
let other = "";
before(async () => {
  await migrate();
  me = await newUser("Me");
  other = await newUser("Other");
});
after(async () => {
  await app.close();
  await pool.end();
});

const count = async (token: string, title: string) =>
  (await call(token, "GET", "/items"))
    .json()
    .filter((i: { title: string }) => i.title === title).length;

test("a change sent twice with the same key happens once", async () => {
  const key = `k-${randomUUID()}`;
  const first = await call(
    me,
    "POST",
    "/items",
    { title: "Call the venue", kind: "task" },
    { "idempotency-key": key },
  );
  assert.equal(first.statusCode, 201, first.body);
  const again = await call(
    me,
    "POST",
    "/items",
    { title: "Call the venue", kind: "task" },
    { "idempotency-key": key },
  );
  assert.equal(again.statusCode, 201);
  assert.equal(again.headers["idempotent-replay"], "true");
  assert.equal(again.json().id, first.json().id);
  assert.equal(await count(me, "Call the venue"), 1);

  // Status updates too: one timeline entry, not two.
  const id = first.json().id;
  const statusKey = `k-${randomUUID()}`;
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await call(
          me,
          "POST",
          `/items/${id}/updates`,
          { status: "done" },
          { "idempotency-key": statusKey },
        )
      ).statusCode,
      201,
    );
  const detail = (await call(me, "GET", `/items/${id}`)).json();
  assert.equal(
    detail.updates.filter((u: { status?: string }) => u.status === "done")
      .length,
    1,
  );
});

test("keys belong to whoever sent them, and to one request", async () => {
  const key = `k-${randomUUID()}`;
  await call(
    me,
    "POST",
    "/items",
    { title: "Mine", kind: "task" },
    { "idempotency-key": key },
  );
  // The same key from someone else is their own, fresh request.
  const theirs = await call(
    other,
    "POST",
    "/items",
    { title: "Theirs", kind: "task" },
    { "idempotency-key": key },
  );
  assert.equal(theirs.statusCode, 201);
  assert.equal(theirs.json().title, "Theirs");
  // Reusing a key for a different request is refused.
  const reused = await call(
    me,
    "POST",
    "/planner/habits",
    { name: "Read", cadence: 1, period: "day", duration_minutes: 20 },
    { "idempotency-key": key },
  );
  assert.equal(reused.statusCode, 422);
  // A malformed key is refused before anything happens.
  const bad = await call(
    me,
    "POST",
    "/items",
    { title: "Bad key", kind: "task" },
    { "idempotency-key": "no spaces allowed" },
  );
  assert.equal(bad.statusCode, 422);
  assert.equal(await count(me, "Bad key"), 0);
});

test("a device can name the task it made offline", async () => {
  const id = randomUUID();
  const made = await call(me, "POST", "/items", {
    id,
    title: "Made on the train",
    kind: "task",
  });
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(made.json().id, id);
  // Sending it again is the same task.
  const again = await call(me, "POST", "/items", {
    id,
    title: "Made on the train",
    kind: "task",
  });
  assert.equal(again.statusCode, 200);
  assert.equal(await count(me, "Made on the train"), 1);
  // Someone else can't claim that id, or read the task through it.
  const claimed = await call(other, "POST", "/items", {
    id,
    title: "Hijack",
    kind: "task",
  });
  assert.equal(claimed.statusCode, 409);
  assert.equal(await count(other, "Hijack"), 0);
  assert.equal(
    (
      await call(me, "POST", "/items", {
        id: "not-a-uuid",
        title: "x",
        kind: "task",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await call(null, "POST", "/items", { id, title: "x", kind: "task" }))
      .statusCode,
    401,
  );
});

// ---- the outbox, without a server ------------------------------------------

const { applyOutbox, itemBody, isOfflineError, mergeEdit, fieldsLabel } =
  await import("@orbyn/core");
type CoreItem = Parameters<typeof itemBody>[0];

const base: CoreItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Launch brief",
  notes: "",
  kind: "task",
  status: "todo",
  priority: "medium",
  due_at: "2026-09-18T07:00:00.000Z",
  end_at: null,
  team_id: null,
  progress: 0,
  version: 3,
} as unknown as CoreItem;

test("edits that don't overlap merge; a real collision is left to the person", () => {
  // Offline: I renamed it. Elsewhere: someone moved the date.
  const mine = { ...itemBody(base), title: "Launch brief v2" };
  const theirs = {
    ...base,
    due_at: "2026-09-19T07:00:00.000Z",
    version: 4,
  } as CoreItem;
  const merged = mergeEdit(base, mine, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.body.title, "Launch brief v2");
  assert.equal(merged.body.due_at, "2026-09-19T07:00:00.000Z");
  assert.equal(merged.body.version, 4);

  // Both renamed it: that one is theirs to decide.
  const clash = mergeEdit(base, mine, {
    ...theirs,
    title: "Launch plan",
  } as CoreItem);
  assert.deepEqual(clash.conflicts, ["title"]);
  assert.equal(clash.body.title, "Launch plan");
  // The same change on both sides isn't a collision.
  assert.deepEqual(
    mergeEdit(base, mine, { ...theirs, title: "Launch brief v2" } as CoreItem)
      .conflicts,
    [],
  );
  assert.equal(
    fieldsLabel(["title", "due_at", "end_at"]),
    "title, date and end time",
  );
});

test("waiting changes show in the lists before they are sent", () => {
  const made = "22222222-2222-4222-8222-222222222222";
  const shown = applyOutbox(
    [base],
    [
      {
        key: "k1",
        queued_at: "",
        attempts: 0,
        state: "pending",
        op: {
          type: "item.create",
          input: { id: made, title: "Call the venue" },
        },
      },
      {
        key: "k2",
        queued_at: "",
        attempts: 0,
        state: "pending",
        op: {
          type: "item.post",
          id: base.id,
          title: base.title,
          body: { status: "done" },
        },
      },
    ],
  );
  assert.equal(shown.length, 2);
  assert.equal(shown.find((i) => i.id === base.id)?.status, "done");
  assert.equal(shown.find((i) => i.id === made)?.kind, "task");
  const deleted = applyOutbox(shown, [
    {
      key: "k3",
      queued_at: "",
      attempts: 0,
      state: "pending",
      op: {
        type: "item.delete",
        id: made,
        version: 1,
        title: "Call the venue",
      },
    },
  ]);
  assert.equal(deleted.length, 1);
});

test("no connection is told apart from a refusal", () => {
  assert.equal(isOfflineError(new TypeError("Network request failed")), true);
  assert.equal(isOfflineError({ name: "TimeoutError", message: "" }), true);
  assert.equal(
    isOfflineError({ status: 409, message: "This item changed" }),
    false,
  );
  assert.equal(isOfflineError(null), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  proposeProject,
  applyProject,
  type StoredProject,
  type ProjectProposalServices,
} from "../src/modules/ai/project-proposal.js";
import { parseProjectDraft } from "../src/modules/ai/project-draft.js";
import type { Db } from "../src/db/pool.js";
import type { UserRow } from "../src/lib/auth.js";
const now = new Date("2026-09-22T08:00:00Z");
const user = { id: randomUUID(), role: "member" } as UserRow;
const draft = parseProjectDraft(
  JSON.stringify({
    title: "Ship",
    tasks: [
      {
        id: "design",
        title: "Design",
        estimate_minutes: 30,
        due_in_days: 0,
        depends_on: [],
      },
      {
        id: "build",
        title: "Build",
        estimate_minutes: 60,
        due_in_days: 1,
        depends_on: ["design"],
      },
    ],
  }),
);
function fixture() {
  const calls: { sql: string; args: unknown[] }[] = [];
  const mutations: Parameters<ProjectProposalServices["mutate"]>[2][] = [];
  let saved: StoredProject;
  let fingerprint = "calendar-v1";
  const db = {
    query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.startsWith("INSERT INTO proposals"))
        saved = JSON.parse(args[2] as string);
      return { rows: [{ id: randomUUID() }], rowCount: 1 };
    },
  } as unknown as Db;
  const services: ProjectProposalServices = {
    snapshot: async () => ({
      prefs: {
        work_days: [0, 1, 2, 3, 4, 5, 6],
        work_start: "09:00",
        work_end: "17:00",
        pad_percent: 0,
        split_after_minutes: 60,
        min_block_minutes: 15,
        break_level: "none",
      } as Awaited<ReturnType<ProjectProposalServices["snapshot"]>>["prefs"],
      frames: [],
      busy: [],
      fingerprint,
    }),
    mutate: async (_db, _user, action) => {
      assert.equal(_db, db);
      assert.equal(_user.id, user.id);
      mutations.push(action);
      return { id: randomUUID() } as NonNullable<
        Awaited<ReturnType<ProjectProposalServices["mutate"]>>
      >;
    },
  };
  return {
    db,
    services,
    calls,
    mutations,
    saved: () => saved,
    setFingerprint: (v: string) => {
      fingerprint = v;
    },
  };
}
test("drafting stores only a proposal, with a reviewable graph and schedule", async () => {
  const f = fixture();
  const p = await proposeProject(f.db, user.id, draft, "UTC", now, f.services);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].sql, /INSERT INTO proposals/);
  assert.equal(f.mutations.length, 0);
  assert.equal(p.actions.length, 2);
  assert.deepEqual(p.project?.tasks[1].depends_on, ["design"]);
  assert.equal(p.project?.blocks.length, 2);
  assert.equal(
    (p.project as unknown as { fingerprint?: string }).fingerprint,
    undefined,
  );
});
test("approval maps temporary graph references to created subtasks inside the supplied transaction", async () => {
  const f = fixture();
  await proposeProject(f.db, user.id, draft, "UTC", now, f.services);
  f.calls.length = 0;
  const result = await applyProject(f.db, user, f.saved(), now, f.services);
  assert.equal(f.mutations.length, 3);
  assert.equal(f.mutations[0].data?.title, "Ship");
  assert.equal(f.mutations[1].data?.parent_id, result.parent_id);
  assert.equal(f.mutations[2].data?.parent_id, result.parent_id);
  const edges = f.calls.filter((c) =>
    c.sql.startsWith("INSERT INTO item_dependencies"),
  );
  assert.equal(edges.length, 1);
  assert.notEqual(edges[0].args[0], "build");
  assert.notEqual(edges[0].args[1], "design");
  assert.equal(
    f.calls.filter((c) => c.sql.startsWith("INSERT INTO time_blocks")).length,
    2,
  );
});
test("changed calendar or elapsed preview is rejected before any domain writes", async () => {
  for (const mode of ["stale", "past"]) {
    const f = fixture();
    await proposeProject(f.db, user.id, draft, "UTC", now, f.services);
    f.calls.length = 0;
    if (mode === "stale") f.setFingerprint("calendar-v2");
    await assert.rejects(
      () =>
        applyProject(
          f.db,
          user,
          f.saved(),
          mode === "past" ? new Date("2026-09-22T10:00:00Z") : now,
          f.services,
        ),
      /changed/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.mutations.length, 0);
  }
});
test("mutation failure propagates to the caller's transaction instead of marking approval complete", async () => {
  const f = fixture();
  await proposeProject(f.db, user.id, draft, "UTC", now, f.services);
  f.services.mutate = async () => {
    throw new Error("write failed");
  };
  await assert.rejects(
    () => applyProject(f.db, user, f.saved(), now, f.services),
    /write failed/,
  );
  assert.equal(
    f.calls.some((c) => c.sql.startsWith("INSERT INTO time_blocks")),
    false,
  );
  assert.equal(
    f.calls.some((c) => c.sql.includes("applied=true")),
    false,
  );
});

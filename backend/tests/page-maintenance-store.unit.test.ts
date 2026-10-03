import { test } from "node:test";
import assert from "node:assert/strict";
import { PageMaintenanceStore } from "@orbyn/api-client";
import type {
  Doc,
  MaintainedPageBinding,
  MaintainedPageRunSummary,
} from "@orbyn/core";
const doc = {
  id: "doc",
  title: "Human page",
  version: 7,
  content: [{ id: "human", type: "paragraph", text: "Keep this" }],
} as Doc;
type Api = ConstructorParameters<typeof PageMaintenanceStore>[0];
function api(overrides: Partial<Api> = {}): Api {
  return {
    getDoc: async () => doc,
    updateDoc: async () => doc,
    listPageMaintenance: async () => [],
    listPageMaintenanceRuns: async () => [],
    createPageMaintenance: async () => ({}) as MaintainedPageBinding,
    updatePageMaintenance: async () => ({}) as MaintainedPageBinding,
    deletePageMaintenance: async () => ({ ok: true }),
    decidePageMaintenanceRun: async () => ({ state: "done" }),
    ...overrides,
  };
}
test("prepare names missing blocks through a versioned save and reports the authoritative page", async () => {
  let updates = 0;
  let changed: Doc | undefined;
  let saved = {
    ...doc,
    content: [{ type: "paragraph" as const, text: "Human words" }],
  };
  const store = new PageMaintenanceStore(
    api({
      getDoc: async (_id, opts) => {
        assert.equal(opts?.fresh, true);
        return saved;
      },
      updateDoc: async (_id, input) => {
        updates++;
        assert.equal(input.version, 7);
        assert.equal(input.content[0].text, "Human words");
        assert.ok(input.content[0].id);
        saved = { ...saved, content: input.content };
        return saved;
      },
    }),
    "doc",
    () => "owner",
    (page) => {
      changed = page;
    },
  );
  await store.prepare();
  assert.equal(updates, 1);
  assert.equal(changed, saved);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().error, "");
});
test("switching account during prepare stops its dependent save and hides the old result", async () => {
  let owner = "a";
  let finish!: (value: Doc) => void;
  let writes = 0;
  let changed = 0;
  const store = new PageMaintenanceStore(
    api({
      getDoc: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      updateDoc: async () => {
        writes++;
        return doc;
      },
    }),
    "doc",
    () => owner,
    () => {
      changed++;
    },
  );
  const loading = store.prepare();
  owner = "b";
  finish({ ...doc, content: [{ type: "paragraph", text: "Private A" }] });
  await loading;
  assert.equal(writes, 0);
  assert.equal(changed, 0);
  assert.equal(store.getSnapshot().doc, null);
  assert.equal(store.getSnapshot().busy, false);
  await store.prepare();
  assert.equal(writes, 0);
});
test("effect disposal and replay do not leave the store permanently busy or restore an old read", async () => {
  let count = 0;
  let finish!: (value: Doc) => void;
  const store = new PageMaintenanceStore(
    api({
      getDoc: async () => {
        if (count++ === 0)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return doc;
      },
    }),
    "doc",
    () => "owner",
    () => {},
  );
  const first = store.prepare();
  store.dispose();
  await store.prepare();
  finish({ ...doc, title: "Obsolete" });
  await first;
  assert.equal(store.getSnapshot().doc?.title, "Human page");
  assert.equal(store.getSnapshot().busy, false);
});
test("pause preserves the reviewed page revision and decisions send the exact saved waiting card", async () => {
  let mutation: unknown;
  let decision: unknown;
  const store = new PageMaintenanceStore(
    api({
      updatePageMaintenance: async (...args) => {
        mutation = args;
        return {} as MaintainedPageBinding;
      },
      decidePageMaintenanceRun: async (...args) => {
        decision = args;
        return { state: "done" };
      },
    }),
    "doc",
    () => "owner",
    () => {},
  );
  const binding = {
    id: "binding",
    revision: 3,
    instruction: "Review summary",
    rrule: "FREQ=WEEKLY",
    timezone: "UTC",
    next_run_at: "2026-10-05T00:00:00Z",
    paused: false,
    snapshot: {
      doc_version: 5,
      blocks: [{ block_id: "summary", position: 1 }],
    },
  } as MaintainedPageBinding;
  await store.pause(binding);
  assert.deepEqual(mutation, [
    "doc",
    "binding",
    {
      instruction: binding.instruction,
      rrule: binding.rrule,
      timezone: "UTC",
      next_run_at: binding.next_run_at,
      block_ids: ["summary"],
      expected_doc_version: 5,
      paused: true,
      expected_revision: 3,
    },
  ]);
  const run = {
    id: "run",
    waiting_id: "waiting-1",
    can_review: true,
  } as MaintainedPageRunSummary;
  await store.decide(run, true);
  assert.deepEqual(decision, ["doc", "run", "waiting-1", true]);
  await store.decide({ ...run, can_review: false }, true);
  assert.equal(store.getSnapshot().error, "Reload this decision card.");
});

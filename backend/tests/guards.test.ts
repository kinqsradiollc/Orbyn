import { test } from "node:test";
import assert from "node:assert/strict";
const { pruneActions } = await import("../src/modules/ai/guards.js");
const { parseReply } = await import("../src/modules/ai/provider.js");

const dentist = {
  id: "7c1f7a56-4c3e-4d8a-9b1e-2f3a4b5c6d7e",
  title: "Dentist",
  notes: "",
  kind: "event",
  status: "todo",
  priority: "medium",
  due_at: new Date("2026-09-16T09:00:00+10:00"),
  end_at: null,
  reminder_minutes: 30,
  team_id: null,
};
const data = (over: Record<string, unknown> = {}) => ({
  title: "Dentist",
  notes: "",
  kind: "event" as const,
  status: "todo" as const,
  priority: "medium" as const,
  due_at: "2026-09-16T09:00:00+10:00",
  end_at: null,
  reminder_minutes: 30,
  team_id: null,
  ...over,
});

test("invented, no-op and duplicate actions are dropped; real ones kept", () => {
  const kept = pruneActions(
    [
      // Invented id: not in the snapshot.
      {
        operation: "update",
        item_id: "7c1f7aae-2e4b-4d8a-9b1e-2f3a4b5c6d7e",
        version: 3,
        data: data({ title: "X" }),
      },
      // Changes nothing.
      { operation: "update", item_id: dentist.id, version: 3, data: data() },
      // Duplicates the existing item.
      { operation: "create", data: data() },
      // Real changes.
      {
        operation: "update",
        item_id: dentist.id,
        version: 3,
        data: data({ due_at: "2026-09-16T10:00:00+10:00" }),
      },
      {
        operation: "create",
        data: data({
          title: "Call Mum",
          kind: "task",
          due_at: "2026-09-18T18:00:00+10:00",
        }),
      },
      { operation: "delete", item_id: dentist.id, version: 3 },
    ] as never,
    [dentist],
  );
  assert.deepEqual(
    kept.map((a) => `${a.operation}:${a.data?.title ?? ""}`),
    ["update:Dentist", "create:Call Mum", "delete:"],
  );
});

test("timestamps without an offset get the user's local offset", () => {
  const reply = parseReply(
    JSON.stringify({
      summary: "Added.",
      actions: [
        {
          operation: "create",
          data: {
            title: "Call Mum",
            kind: "task",
            due_at: "2026-09-18T18:00:00",
          },
        },
        {
          operation: "create",
          data: {
            title: "Summer call",
            kind: "task",
            due_at: "2027-01-08T18:00",
          },
        },
      ],
    }),
    "Australia/Melbourne",
  );
  assert.equal(reply.actions[0].data?.due_at, "2026-09-18T18:00:00+10:00");
  assert.equal(reply.actions[1].data?.due_at, "2027-01-08T18:00:00+11:00");
});

test("only what the latest message asks for survives", () => {
  const actions = [
    { operation: "delete", item_id: dentist.id, version: 3 },
    {
      operation: "update",
      item_id: dentist.id,
      version: 3,
      data: data({ due_at: "2026-09-16T10:00:00+10:00" }),
    },
  ] as never;
  assert.deepEqual(pruneActions(actions, [dentist], "Summarize my week"), []);
  assert.deepEqual(
    pruneActions(actions, [dentist], "Move the dentist to 10am").map(
      (a) => a.operation,
    ),
    ["update"],
  );
  assert.deepEqual(
    pruneActions(actions, [dentist], "Delete the dentist").map(
      (a) => a.operation,
    ),
    ["delete", "update"],
  );
});

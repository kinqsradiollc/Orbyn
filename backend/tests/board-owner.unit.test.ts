import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardColumns,
  boardFilterCounts,
  dropChange,
  groupTasks,
  inBoardRange,
  matchesBoardFilter,
  NO_GROUP,
  OWNER_AGENT,
  OWNER_ME,
  OWNER_REVIEW,
  ownerAgentKey,
  type GroupNames,
  type Item,
} from "@orbyn/core";

/** W2: the board's "Who's on it" lanes, quick filters and date range. */
const now = new Date(2026, 8, 30, 12); // Wednesday 30 Sep 2026, noon
const me = "11111111-1111-4111-8111-111111111111";
const mia = "22222222-2222-4222-8222-222222222222";
const team = "33333333-3333-4333-8333-333333333333";
const claude = "44444444-4444-4444-8444-444444444444";
const grant = "55555555-5555-4555-8555-555555555555";

let n = 0;
const task = (over: Partial<Item> = {}): Item =>
  ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    version: 1,
    kind: "task",
    title: `Task ${n}`,
    notes: "",
    status: "todo",
    priority: "medium",
    due_at: null,
    team_id: null,
    assignee_id: null,
    ...over,
  }) as Item;

const mine = task({ title: "Mine" });
const assignedToMe = task({ team_id: team, assignee_id: me });
const miasTask = task({
  team_id: team,
  assignee_id: mia,
  assignee_name: "Mia",
});
const backlog = task({ team_id: team });
const handed = task({ agent_grant_id: grant, agent_state: "working" });
const touched = task({ team_id: team, title: "Claude's" });
const items = [mine, assignedToMe, miasTask, backlog, handed, touched];
const names: GroupNames = {
  userId: me,
  agentName: "Muse",
  agents: [{ grant_id: claude, name: "Claude", item_ids: [touched.id] }],
};

test("tasks fall into you, teammates, your agent, connected agents and the backlog", () => {
  const groups = groupTasks(items, "owner", names);
  assert.deepEqual(
    groups.map((g) => [g.key, g.title, g.items.length]),
    [
      [OWNER_ME, "You", 2],
      [mia, "Mia", 1],
      [OWNER_AGENT, "Muse", 1],
      [ownerAgentKey(claude), "Claude", 1],
      [NO_GROUP, "Backlog", 1],
    ],
  );
});

test("the board always shows you, your agent, Needs review and the Backlog", () => {
  const empty = boardColumns([], "owner", { userId: me, agentName: "Muse" });
  assert.deepEqual(
    empty.map((c) => [c.key, c.title]),
    [
      [OWNER_ME, "You"],
      [OWNER_AGENT, "Muse"],
      [OWNER_REVIEW, "Needs review"],
      [NO_GROUP, "Backlog"],
    ],
  );
  const hidden = boardColumns(items, "owner", names, { hideEmpty: true });
  assert.ok(
    hidden.some((c) => c.key === OWNER_REVIEW),
    "the Review lane stays for its proposals",
  );
  assert.equal(boardColumns(items, "owner", names).map((c) => c.key).length, 6);
});

test("dragging hands over, takes back, assigns and unassigns", () => {
  assert.deepEqual(dropChange(mine, "owner", OWNER_ME, OWNER_AGENT, names), {
    ok: true,
    change: { agent: "hand" },
  });
  assert.deepEqual(dropChange(handed, "owner", OWNER_AGENT, OWNER_ME, names), {
    ok: true,
    change: { agent: "take_back" },
  });
  assert.deepEqual(dropChange(backlog, "owner", NO_GROUP, mia, names), {
    ok: true,
    change: { assignee_id: mia },
  });
  assert.deepEqual(dropChange(miasTask, "owner", mia, NO_GROUP, names), {
    ok: true,
    change: { assignee_id: null },
  });
  assert.deepEqual(dropChange(backlog, "owner", NO_GROUP, OWNER_ME, names), {
    ok: true,
    change: { assignee_id: me },
  });
  const handedTeam = task({ team_id: team, agent_grant_id: grant });
  assert.deepEqual(dropChange(handedTeam, "owner", OWNER_AGENT, mia, names), {
    ok: true,
    change: { agent: "take_back", assignee_id: mia },
  });
  for (const to of [OWNER_REVIEW, ownerAgentKey(claude)]) {
    const refused = dropChange(mine, "owner", OWNER_ME, to, names);
    assert.equal(refused?.ok, false);
  }
  assert.equal(
    dropChange(mine, "owner", OWNER_ME, NO_GROUP, names)?.ok,
    false,
    "your own task can't wait in the Backlog",
  );
  assert.equal(
    dropChange(task({ status: "done" }), "owner", OWNER_ME, OWNER_AGENT, names)
      ?.ok,
    false,
  );
  assert.equal(
    dropChange(handed, "owner", OWNER_AGENT, OWNER_AGENT, names),
    null,
  );
});

test("quick filters count live, Review's proposals included", () => {
  const set = [
    task({ status: "in_progress" }),
    task({ agent_grant_id: grant, agent_state: "queued" }),
    task({ agent_state: "needs_you" }),
    task({ due_at: new Date(2026, 8, 20).toISOString() }),
    task({ status: "done", updated_at: new Date(2026, 8, 28).toISOString() }),
    task({ status: "done", updated_at: new Date(2026, 8, 10).toISOString() }),
  ];
  assert.deepEqual(boardFilterCounts(set, now, 2), {
    all: 6,
    in_progress: 2,
    needs_review: 3,
    overdue: 1,
    done_week: 1,
  });
  assert.equal(matchesBoardFilter(set[3], "overdue", now), true);
  assert.equal(matchesBoardFilter(set[0], "overdue", now), false);
});

test("the range filters by due or planned date", () => {
  const today = task({ due_at: new Date(2026, 8, 30, 9).toISOString() });
  const nextMonth = task({ due_at: new Date(2026, 9, 12).toISOString() });
  const undated = task();
  assert.equal(inBoardRange(today, { kind: "day" }, now), true);
  assert.equal(inBoardRange(nextMonth, { kind: "week" }, now), false);
  assert.equal(inBoardRange(nextMonth, { kind: "month" }, now), false);
  assert.equal(inBoardRange(undated, { kind: "all" }, now), true);
  assert.equal(inBoardRange(undated, { kind: "week" }, now), false);
  assert.equal(
    inBoardRange(undated, { kind: "day" }, now, [
      new Date(2026, 8, 30, 15).toISOString(),
    ]),
    true,
    "a session planned today counts",
  );
  assert.equal(
    inBoardRange(
      nextMonth,
      { kind: "range", from: "2026-10-10", to: "2026-10-12" },
      now,
    ),
    true,
  );
  assert.equal(
    inBoardRange(nextMonth, { kind: "range", from: "2026-10-10" }, now),
    true,
    "a range without both days shows everything",
  );
});

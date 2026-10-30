import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNotices, noticeSource, type Notice } from "@orbyn/core";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const notice = (n: number, patch: Partial<Notice> = {}): Notice => ({
  id: id(n),
  title: "Same title",
  body: "Saved content",
  read: false,
  created_at: "2026-10-30T10:00:00Z",
  ...patch,
});

test("notification grouping uses stable source identity, never equal titles, and retains every notice/read state", () => {
  const rows = [
    notice(1, { item_id: id(100) }),
    notice(2, { item_id: id(101) }),
    notice(3, { item_id: id(100), read: true }),
    notice(4),
    notice(5),
  ];
  const before = structuredClone(rows),
    groups = groupNotices(rows);
  assert.deepEqual(
    groups.map((group) => group.notices.map((row) => row.id)),
    [[id(1), id(3)], [id(2)], [id(4)], [id(5)]],
  );
  assert.deepEqual(
    groups.map((group) => group.unread),
    [1, 1, 1, 1],
  );
  assert.equal(groups[0].notices[1], rows[2]);
  assert.deepEqual(rows, before);
  assert.deepEqual(groupNotices([]), []);
});

test("Review and person decisions retain exact proposal/question/ask identity even when they share a task", () => {
  const rows = [
    notice(1, { kind: "review", ref: `proposal:${id(200)}`, item_id: id(100) }),
    notice(2, { kind: "review", ref: `proposal:${id(201)}`, item_id: id(100) }),
    notice(3, { kind: "review", ref: `proposal:${id(200)}`, read: true }),
    notice(4, { kind: "question", ref: `question:${id(200)}` }),
    notice(5, { kind: "ask", ref: id(200), item_id: id(100) }),
  ];
  const groups = groupNotices(rows);
  assert.equal(groups.length, 4);
  assert.deepEqual(
    groups[0].notices.map((row) => row.id),
    [id(1), id(3)],
  );
  assert.equal(groups[0].source?.kind, "proposal");
  assert.deepEqual(
    groups.slice(1).map((group) => group.source?.kind),
    ["proposal", "question", "ask"],
  );
});

test("typed page, project, conversation and other producer refs share only their own source namespace", () => {
  const cases: [Partial<Notice>, string][] = [
    [{ kind: "import", ref: `doc:${id(100)}` }, "doc"],
    [{ kind: "mention", ref: `doc:${id(100)}:remark` }, "doc"],
    [{ kind: "project", ref: `${id(100)}:2026-10-30` }, "project"],
    [{ kind: "booking", ref: id(100) }, "booking"],
    [{ kind: "template", ref: id(100) }, "template"],
    [
      { kind: "assistant", ref: `conversation:${id(100)}:${id(101)}` },
      "conversation",
    ],
    [{ kind: "assistant", ref: `chat:${id(100)}:${id(101)}` }, "chat"],
    [{ kind: "assistant", ref: `overnight:${id(100)}` }, "overnight"],
    [
      { kind: "reminder_nudge", ref: `chat:${id(100)}:nudge:${id(101)}` },
      "chat",
    ],
    [{ kind: "agent", ref: `grant:${id(100)}` }, "grant"],
    [{ kind: "agent", ref: `team:${id(100)}` }, "team"],
    [{ kind: "promise", ref: id(100) }, "record"],
    [{ kind: "session", ref: `${id(100)}:2026-10-30T10:00:00Z` }, "session"],
  ];
  for (const [patch, kind] of cases)
    assert.deepEqual(noticeSource(notice(1, patch)), { kind, id: id(100) });
  assert.equal(
    groupNotices(cases.map(([patch], index) => notice(index, patch))).length,
    11,
  );
});

test("unsupported or malformed source refs remain separate while explicit item IDs still join reminder/session history", () => {
  const rows = [
    notice(1, { kind: "review", ref: "proposal:not-an-id", item_id: id(100) }),
    notice(2, { kind: "review", ref: "proposal:not-an-id", item_id: id(100) }),
    notice(3, { kind: "system", ref: `doc:${id(100)}` }),
    notice(4, { kind: "reminder", item_id: id(100) }),
    notice(5, {
      kind: "session",
      item_id: id(100),
      ref: `${id(300)}:2026-10-30T10:00:00Z`,
    }),
  ];
  const groups = groupNotices(rows);
  assert.deepEqual(
    groups.map((group) => group.notices.length),
    [1, 1, 1, 2],
  );
  assert.deepEqual(
    groups.slice(0, 3).map((group) => group.source),
    [null, null, null],
  );
});

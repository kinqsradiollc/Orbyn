import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAssistantChats, type AiChatSummary } from "@orbyn/core";

const chat = (
  id: string,
  values: Partial<AiChatSummary> = {},
): AiChatSummary => ({
  id,
  title: id,
  project_id: null,
  project_name: null,
  pinned: false,
  turn_count: 1,
  created_at: "2026-10-22T00:00:00Z",
  last_used_at: "2026-10-22T00:00:00Z",
  summary_doc_id: null,
  swept_at: null,
  scope: null,
  ...values,
});

test("chat navigation shows the canonical conversation once and keeps project ownership", () => {
  const projectChat = chat("project-chat", {
    project_id: "project",
    project_name: "Research",
    pinned: true,
  });
  const groups = groupAssistantChats(
    [
      chat("personal", { pinned: true }),
      projectChat,
      chat("pinned", { pinned: true }),
      chat("recent"),
      projectChat,
    ],
    "personal",
  );
  assert.deepEqual(
    groups.projects.map((p) => [p.name, p.chats.map((c) => c.id)]),
    [["Research", ["project-chat"]]],
  );
  assert.deepEqual(
    groups.pinned.map((c) => c.id),
    ["pinned"],
  );
  assert.deepEqual(
    groups.recent.map((c) => c.id),
    ["recent"],
  );
});

test("empty and unnamed project groups remain usable without inventing chats", () => {
  assert.deepEqual(groupAssistantChats([], null), {
    projects: [],
    pinned: [],
    recent: [],
  });
  assert.equal(
    groupAssistantChats([chat("one", { project_id: "p" })], null).projects[0]
      .name,
    "Project",
  );
});

test("conversation dates group by local calendar days across DST", async () => {
  const { assistantDateLabel } = await import("@orbyn/core");
  const now = new Date("2026-10-04T01:00:00Z");
  assert.equal(
    assistantDateLabel(
      "2026-10-03T14:30:00Z",
      undefined,
      "Australia/Melbourne",
      now,
    ),
    "Today",
  );
  assert.equal(
    assistantDateLabel(
      "2026-10-03T02:00:00Z",
      undefined,
      "Australia/Melbourne",
      now,
    ),
    "Yesterday",
  );
  assert.equal(
    assistantDateLabel(
      "2026-10-03T15:00:00Z",
      "2026-10-03T14:30:00Z",
      "Australia/Melbourne",
      now,
    ),
    null,
  );
});

test("selected visible words match shared Markdown rendering without accepting invented text", async () => {
  const { assistantExcerptMatches } = await import("@orbyn/core");
  assert.equal(
    assistantExcerptMatches(
      "Review **this phrase** and `this code`.",
      "this phrase and this code",
    ),
    true,
  );
  assert.equal(
    assistantExcerptMatches(
      "# Heading\n\n- First item\n- Second item",
      "Heading First item Second item",
    ),
    true,
  );
  assert.equal(
    assistantExcerptMatches("Review **this phrase**.", "a different phrase"),
    false,
  );
  assert.equal(assistantExcerptMatches("any text", "  "), false);
  assert.equal(
    assistantExcerptMatches("a".repeat(3000), "a".repeat(2001)),
    false,
  );
});

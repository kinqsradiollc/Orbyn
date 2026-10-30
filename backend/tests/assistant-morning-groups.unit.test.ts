import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assistantProfiles,
  groupAssistantReview,
  assistantOutcomeReceipt,
  type AssistantProfiles,
  type AssistantReviewOrigin,
} from "@orbyn/core";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-30T07:00:00.000Z";
const base = {
  recent_activity: [],
  outputs: [],
  work: [],
  state: "idle",
  runtime: { reporting: true, last_seen_at: at },
  counts: { working: 0, queued: 0, waiting: 0, recovering: 0 },
  last_activity_at: null,
  window: null,
  budget: null,
};
const data = () =>
  assistantProfiles.parse({
    observed_at: at,
    profiles: [
      { ...base, lane: "background" },
      { ...base, lane: "overnight" },
    ],
  });
const output = (n: number, origin?: AssistantReviewOrigin) => ({
  job_id: id(n),
  chat_id: id(n + 100),
  title: `Execution ${n}`,
  completed_at: at,
  state: "done" as const,
  summary: "A retained report.",
  ...(origin ? { origin } : {}),
});
const origin = (
  n: number,
  title = "Release review",
): AssistantReviewOrigin => ({ kind: "goal", id: id(n), title });
test("stable origins combine different chats and lanes without dropping any selected result", () => {
  const p = data(),
    source = origin(1);
  p.profiles[0].outputs = [output(10, source), output(11, source)];
  p.profiles[1].outputs = [output(12, source)];
  const groups = groupAssistantReview(p);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, `goal:${source.id}`);
  assert.equal(groups[0].items.length, 3);
  assert.deepEqual(
    new Set(groups[0].items.map((i) => i.chatId)),
    new Set([id(110), id(111), id(112)]),
  );
  assert.deepEqual(
    new Set(groups[0].items.map((i) => i.lane)),
    new Set(["background", "overnight"]),
  );
});
test("same titles do not merge different origins, and current renamed labels are used", () => {
  const p = data();
  p.profiles[0].outputs = [
    output(10, origin(1, "Same title")),
    output(11, origin(2, "Same title")),
  ];
  assert.equal(groupAssistantReview(p).length, 2);
  p.profiles[0].outputs[0].origin = origin(1, "Renamed goal");
  assert.equal(
    groupAssistantReview(p).find((g) => g.id === `goal:${id(1)}`)?.title,
    "Renamed goal",
  );
});
test("an older decision and its action survive a newer successful result in the same origin", () => {
  const p = data(),
    source = origin(1);
  p.profiles[0].counts.waiting = 1;
  p.profiles[0].state = "waiting";
  p.profiles[0].work = [
    {
      job_id: id(10),
      chat_id: id(110),
      title: "An older decision",
      state: "waiting",
      cancel_requested: false,
      recovering: false,
      updated_at: "2026-10-29T07:00:00.000Z",
      origin: source,
    },
  ];
  p.profiles[1].outputs = [output(11, source)];
  const groups = groupAssistantReview(p);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items[0].action, "Review decision");
  assert.equal(groups[0].items[0].chatId, id(110));
  assert.equal(groups[0].items[0].priority, 0);
});
test("evidence, open questions, uncertainty and source grouping remain separate", () => {
  const p = data();
  const receipt = assistantOutcomeReceipt.parse({
    version: 1,
    job_id: id(10),
    process: "finished",
    outcome: "partial",
    reason: "specialist_incomplete",
    observed_at: at,
    artifacts: [{ kind: "response", id: id(110) }],
    checks: [
      { id: "verification", title: "Source verification", status: "not_run" },
    ],
    open_questions: ["Which release?"],
  });
  p.profiles[0].outputs = [
    { ...output(10, origin(1)), execution_outcome: receipt },
  ];
  const item = groupAssistantReview(p)[0].items[0];
  assert.equal(item.priority, 0);
  assert.deepEqual(item.execution_outcome, receipt);
  assert.notEqual(item.execution_outcome?.outcome, "completed");
});
test("older snapshots fall back to actual conversation identity, never title guesses", () => {
  const p = data();
  p.profiles[0].outputs = [output(10), { ...output(11), title: "Same title" }];
  p.profiles[0].outputs[0].title = "Same title";
  const groups = groupAssistantReview(p);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.kind === "chat"));
  assert.equal(new Set(groups.map((g) => g.id)).size, 2);
});
test("bounded active lists disclose missing decisions and avoid duplicate known jobs", () => {
  const p = data();
  p.profiles[0].counts.waiting = 3;
  p.profiles[0].state = "waiting";
  p.profiles[0].work_truncated = true;
  p.profiles[0].work = [
    {
      job_id: id(10),
      chat_id: id(110),
      title: "Selected decision",
      state: "waiting",
      cancel_requested: false,
      recovering: false,
      updated_at: at,
      origin: origin(1),
    },
  ];
  p.profiles[0].outputs = [output(10, origin(1))];
  const groups = groupAssistantReview(p);
  assert.equal(
    groups.flatMap((g) => g.items).filter((i) => i.jobId === id(10)).length,
    1,
  );
  const more = groups.find((g) => g.kind === "activity")!;
  assert.match(more.items[0].detail, /2 additional runs/);
  assert.equal(more.items[0].action, "Review decisions");
});
test("explicit unavailable origins stay isolated and never inherit a chat title", () => {
  const p = data();
  p.profiles[0].outputs = [
    { ...output(10), origin: null },
    { ...output(11), chat_id: id(110), origin: null },
  ];
  const groups = groupAssistantReview(p);
  assert.equal(groups.length, 2);
  assert.ok(
    groups.every(
      (g) => g.kind === "activity" && g.title === "Work source unavailable",
    ),
  );
});
test("group summaries expose decision and failure counts without claiming acceptance", async () => {
  const { assistantReviewGroupSummary } = await import("@orbyn/core");
  const p = data();
  p.profiles[0].outputs = [
    output(10, origin(1)),
    { ...output(11, origin(1)), state: "failed" },
  ];
  const group = groupAssistantReview(p)[0];
  assert.equal(
    assistantReviewGroupSummary(group),
    "1 failure · 1 result to review",
  );
  assert.equal(group.items[0].detail, "Background · Run failed");
});
test("server-owned pending Review state remains a decision even when an old run lacks a receipt", () => {
  const p = data();
  p.profiles[0].outputs = [{ ...output(10, origin(1)), review_pending: true }];
  const item = groupAssistantReview(p)[0].items[0];
  assert.equal(item.priority, 0);
  assert.equal(item.target, "review");
  assert.equal(item.action, "Review changes");
  assert.match(item.detail, /Changes waiting for review/);
});

test("page decisions remain actionable alongside chat results from the same project", () => {
  const p = data(),
    source: AssistantReviewOrigin = {
      kind: "project",
      id: id(700),
      title: "Current project",
    };
  p.profiles[0].outputs = [output(11, source)];
  p.profiles[1].counts.waiting = 1;
  p.profiles[1].state = "waiting";
  p.profiles[1].page_runs = [
    {
      id: id(900),
      doc_id: id(901),
      title: "Current page",
      origin: source,
      state: "waiting",
      recovering: false,
      updated_at: at,
      work_kind: "page_update",
    },
  ];
  const groups = groupAssistantReview(assistantProfiles.parse(p));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items[0].docId, id(901));
  assert.equal(groups[0].items[0].action, "Review in page");
  assert.equal(groups[0].items[0].chatId, undefined);
  assert.equal(groups[0].items[0].execution_outcome, undefined);
});

test("page active rows represent combined lane counts without duplicate generic work", () => {
  const p = data();
  p.profiles[0].counts = { working: 1, queued: 1, waiting: 1, recovering: 1 };
  p.profiles[0].state = "working";
  p.profiles[0].page_runs = (
    ["running", "queued", "waiting", "running"] as const
  ).map((state, n) => ({
    id: id(900 + n),
    doc_id: id(950 + n),
    title: "Page",
    origin: { kind: "page" as const, id: id(950 + n), title: "Page" },
    state,
    recovering: n === 3,
    updated_at: at,
    work_kind: "comment_reply" as const,
  }));
  const items = groupAssistantReview(assistantProfiles.parse(p)).flatMap(
    (g) => g.items,
  );
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.id.startsWith("page-run:")));
  p.profiles[0].counts.waiting = 2;
  assert.ok(
    groupAssistantReview(p)
      .flatMap((g) => g.items)
      .some((i) => i.id === "background:waiting"),
  );
});

test("finished page metadata does not fabricate a goal outcome or approval receipt", () => {
  const p = data();
  p.profiles[0].page_runs = [
    {
      id: id(900),
      doc_id: id(901),
      title: "Page",
      origin: { kind: "page", id: id(901), title: "Page" },
      state: "done",
      recovering: false,
      updated_at: at,
      work_kind: "page_update",
    },
  ];
  const item = groupAssistantReview(assistantProfiles.parse(p))[0].items[0];
  assert.match(item.detail, /Run finished/);
  assert.equal(item.execution_outcome, undefined);
  assert.equal(item.action, "Open page");
  assert.equal(item.target, undefined);
  assert.equal(
    assistantProfiles.safeParse({
      ...p,
      profiles: [
        {
          ...p.profiles[0],
          page_runs: [
            { ...p.profiles[0].page_runs[0], proposal: { private: "hidden" } },
          ],
        },
        p.profiles[1],
      ],
    }).success,
    false,
  );
});

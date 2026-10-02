import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assistantHandoff,
  assistantHandoffInput,
  advanceAssistantHandoff,
  ASSISTANT_HANDOFF_LIMITS,
  type AssistantHandoff,
} from "@orbyn/core";

const id = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const producer = "33333333-3333-4333-8333-333333333333";
const recipient = "44444444-4444-4444-8444-444444444444";
const now = "2026-10-02T08:00:00.000Z";
function fixture(overrides: Partial<AssistantHandoff> = {}): AssistantHandoff {
  return {
    id,
    owner_id: owner,
    root_id: id,
    parent_id: null,
    depth: 0,
    revision: 1,
    producer_lane: "overnight",
    recipient_lane: "background",
    producer_job_id: producer,
    recipient_job_id: null,
    title: "Review a reflected follow-up",
    instruction: "Check the cited outcome before proposing the next action.",
    sources: [{ kind: "job", id: producer, revision: "producer-revision-1" }],
    status: "proposed",
    delivery_attempts: 0,
    result: null,
    failure: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
function accepted() {
  return advanceAssistantHandoff(
    advanceAssistantHandoff(fixture(), 1, { kind: "attempt" }, now),
    2,
    { kind: "accept", recipient_job_id: recipient },
    now,
  );
}

test("handoff requests cannot assign owner, authority, runtime provenance or receiving job", () => {
  const input = {
    producer_job_id: producer,
    expected_producer_revision: "r1",
    recipient_lane: "background",
    title: "Follow-up",
    instruction: "Review the outcome.",
  };
  assert.ok(assistantHandoffInput.safeParse(input).success);
  for (const field of [
    "owner_id",
    "producer_lane",
    "recipient_job_id",
    "root_id",
    "depth",
    "approved",
    "scope",
  ])
    assert.equal(
      assistantHandoffInput.safeParse({ ...input, [field]: owner }).success,
      false,
      field,
    );
});

test("handoffs require separate runtimes, distinct receiving work and producing evidence", () => {
  for (const overrides of [
    { recipient_lane: "overnight" },
    { recipient_job_id: producer, status: "accepted", delivery_attempts: 1 },
    { sources: [{ kind: "task", id: producer, revision: "r1" }] },
    { sources: [...fixture().sources, ...fixture().sources] },
    { sources: [] },
    { sources: [{ kind: "job", id: producer, revision: " " }] },
  ])
    assert.equal(
      assistantHandoff.safeParse({ ...fixture(), ...overrides }).success,
      false,
    );
});

test("handoff chain and receipt bounds reject malformed or unbounded provenance", () => {
  for (const overrides of [
    { depth: ASSISTANT_HANDOFF_LIMITS.depth + 1 },
    { depth: 1 },
    { root_id: recipient },
    { parent_id: id, depth: 1 },
    { parent_id: recipient, depth: 0 },
    { parent_id: recipient, depth: 1 },
    { delivery_attempts: ASSISTANT_HANDOFF_LIMITS.deliveryAttempts + 1 },
    { updated_at: "2026-10-01T08:00:00.000Z" },
  ])
    assert.equal(
      assistantHandoff.safeParse({ ...fixture(), ...overrides }).success,
      false,
    );
  assert.ok(
    assistantHandoff.safeParse(
      fixture({ id: recipient, parent_id: id, root_id: id, depth: 1 }),
    ).success,
  );
});

test("delivery creates a distinct receiving job and completes with its exact result revision", () => {
  const received = accepted();
  assert.equal(received.status, "accepted");
  assert.equal(received.revision, 3);
  assert.equal(received.recipient_job_id, recipient);
  const result = {
    kind: "job" as const,
    id: recipient,
    revision: "recipient-result-2",
  };
  const completed = advanceAssistantHandoff(
    received,
    3,
    { kind: "complete", result },
    now,
  );
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, result);
  assert.deepEqual(completed.sources, fixture().sources);
  assert.equal(completed.producer_job_id, producer);
  assert.equal(fixture().revision, 1);
});

test("stale actions, duplicate acceptance and premature completion are rejected", () => {
  assert.throws(() =>
    advanceAssistantHandoff(fixture(), 2, { kind: "attempt" }, now),
  );
  assert.throws(() =>
    advanceAssistantHandoff(
      fixture(),
      1,
      { kind: "accept", recipient_job_id: recipient },
      now,
    ),
  );
  assert.throws(() =>
    advanceAssistantHandoff(
      fixture(),
      1,
      {
        kind: "complete",
        result: { kind: "job", id: recipient, revision: "r1" },
      },
      now,
    ),
  );
  const received = accepted();
  assert.throws(() =>
    advanceAssistantHandoff(
      received,
      3,
      { kind: "accept", recipient_job_id: recipient },
      now,
    ),
  );
  assert.throws(() =>
    advanceAssistantHandoff(received, 3, { kind: "attempt" }, now),
  );
  for (const result of [
    { kind: "job" as const, id: producer, revision: "r1" },
    { kind: "task" as const, id: recipient, revision: "r1" },
  ])
    assert.throws(() =>
      advanceAssistantHandoff(received, 3, { kind: "complete", result }, now),
    );
});

test("delivery attempts are finite and terminal failures cannot restart themselves", () => {
  let receipt = fixture();
  for (
    let attempt = 0;
    attempt < ASSISTANT_HANDOFF_LIMITS.deliveryAttempts;
    attempt++
  )
    receipt = advanceAssistantHandoff(
      receipt,
      receipt.revision,
      { kind: "attempt" },
      now,
    );
  assert.throws(() =>
    advanceAssistantHandoff(
      receipt,
      receipt.revision,
      { kind: "attempt" },
      now,
    ),
  );
  const failed = advanceAssistantHandoff(
    receipt,
    receipt.revision,
    { kind: "fail", reason: "delivery" },
    now,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure, "delivery");
  assert.throws(() =>
    advanceAssistantHandoff(failed, failed.revision, { kind: "attempt" }, now),
  );
});

test("all ended receipts reject further changes and result/failure states stay consistent", () => {
  const completed = advanceAssistantHandoff(
    accepted(),
    3,
    {
      kind: "complete",
      result: { kind: "job", id: recipient, revision: "r1" },
    },
    now,
  );
  const cancelled = advanceAssistantHandoff(
    fixture(),
    1,
    { kind: "cancel" },
    now,
  );
  const failed = advanceAssistantHandoff(
    accepted(),
    3,
    { kind: "fail", reason: "access" },
    now,
  );
  for (const receipt of [completed, cancelled, failed])
    assert.throws(() =>
      advanceAssistantHandoff(
        receipt,
        receipt.revision,
        { kind: "cancel" },
        now,
      ),
    );
  for (const overrides of [
    { result: completed.result },
    { failure: "access" },
    { status: "failed", failure: null },
    { status: "accepted", recipient_job_id: recipient, delivery_attempts: 0 },
  ])
    assert.equal(
      assistantHandoff.safeParse({ ...fixture(), ...overrides }).success,
      false,
    );
});

test("receipt updates reject backwards timestamps and malformed runtime actions", () => {
  assert.throws(() =>
    advanceAssistantHandoff(
      fixture(),
      1,
      { kind: "attempt" },
      "2026-10-01T08:00:00.000Z",
    ),
  );
  assert.throws(() =>
    advanceAssistantHandoff(fixture(), 1, { kind: "attempt" }, "invalid"),
  );
  assert.throws(() =>
    advanceAssistantHandoff(
      fixture(),
      1,
      { kind: "accept", recipient_job_id: "not-a-job" },
      now,
    ),
  );
});

test("handoff payloads remain bounded and interactive conversations are excluded", () => {
  for (const overrides of [
    { producer_lane: "interactive" },
    { recipient_lane: "interactive" },
    { title: "x".repeat(241) },
    { instruction: "x".repeat(4001) },
    {
      sources: Array.from(
        { length: ASSISTANT_HANDOFF_LIMITS.sources + 1 },
        () => fixture().sources[0],
      ),
    },
    { revision: 0 },
    { revision: 1.5 },
    { delivery_attempts: -1 },
  ])
    assert.equal(
      assistantHandoff.safeParse({ ...fixture(), ...overrides }).success,
      false,
    );
  assert.ok(
    assistantHandoff.safeParse(
      fixture({ producer_lane: "background", recipient_lane: "overnight" }),
    ).success,
  );
});

test("receipt transitions leave caller-owned evidence and state unchanged", () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const next = advanceAssistantHandoff(original, 1, { kind: "attempt" }, now);
  assert.deepEqual(original, snapshot);
  next.sources[0].revision = "changed";
  assert.deepEqual(original, snapshot);
});

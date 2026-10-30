import { projectOutcomeReceipt } from "../src/modules/ai/outcome-receipts.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assistantOutcomeReceipt,
  projectChatInput,
  assistantProfiles,
  recentAssistantWork,
} from "@orbyn/core";
import { runtimeOutcome } from "../src/modules/ai/agent/outcome.js";
import {
  executionIntent,
  reconcileExecution,
  canAdmitExternalEffect,
  OPEN_DUET_ADMISSION,
} from "../src/modules/ai/agent/execution-adapter.js";
const ids = () => ({
  jobId: randomUUID(),
  chatId: randomUUID(),
  turnId: randomUUID(),
});
test("successful process remains unverified, not a completed goal", () => {
  const receipt = runtimeOutcome(ids());
  assert.equal(receipt.process, "finished");
  assert.equal(receipt.outcome, "unverified");
  assert.equal(
    assistantOutcomeReceipt.safeParse({
      ...receipt,
      outcome: "completed",
      reason: "accepted",
    }).success,
    false,
  );
});
test("structured limits, blocked specialists, review, interruption and failure stay distinct", () => {
  const base = ids();
  assert.equal(runtimeOutcome({ ...base, timedOut: true }).outcome, "partial");
  assert.equal(
    runtimeOutcome({
      ...base,
      state: {
        reports: [],
        token_estimate: 10,
        token_budget: 100,
        completion_limited: true,
      },
    }).reason,
    "execution_limit",
  );
  assert.equal(
    runtimeOutcome({ ...base, proposalOutcome: "pending" }).outcome,
    "waiting",
  );
  assert.equal(
    runtimeOutcome({ ...base, stopped: true }).outcome,
    "interrupted",
  );
  assert.equal(runtimeOutcome({ ...base, failed: true }).process, "failed");
  assert.equal(
    runtimeOutcome({ ...base, interrupted: true }).reason,
    "worker_interrupted",
  );
  assert.equal(
    runtimeOutcome({ ...base, expiredWaiting: true }).reason,
    "waiting_expired",
  );
});
test("client history imports cannot mint a trusted execution receipt", () => {
  const receipt = runtimeOutcome(ids());
  const imported = projectChatInput.parse({
    project_id: randomUUID(),
    turns: [
      { role: "assistant", text: "A response", execution_outcome: receipt },
    ],
  });
  assert.equal("execution_outcome" in imported.turns[0], false);
});
test("lost dispatch reconciles one external identity before completion; no blind retry", () => {
  let state = executionIntent({
    jobId: "job",
    attemptId: "attempt",
    ownerId: "person",
    generation: 2,
  });
  const event = (kind: any, sequence: number, extra = {}) => ({
    id: `event-${sequence}`,
    generation: 2,
    sequence,
    kind,
    ...extra,
  });
  state = reconcileExecution(state, event("dispatch", 1));
  state = reconcileExecution(state, event("response_lost", 2));
  assert.equal(state.phase, "uncertain");
  assert.throws(() => reconcileExecution(state, event("dispatch", 3)));
  state = reconcileExecution(
    state,
    event("reconciled", 3, { externalId: "worker-run" }),
  );
  assert.throws(() =>
    reconcileExecution(
      state,
      event("accepted", 4, { externalId: "other-run" }),
    ),
  );
  state = reconcileExecution(state, event("finished", 4));
  assert.equal(state.phase, "finished");
  assert.equal(reconcileExecution(state, event("finished", 4)), state);
  const grant = {
    effectId: "effect",
    ownerId: "person",
    generation: 2,
    qualified: {
      isolation: true,
      reconciliation: true,
      cancellation: true,
      outcomes: true,
    },
    currentAccess: true,
    currentSources: true,
    preauthorized: true,
  };
  assert.equal(canAdmitExternalEffect(state, grant), true);
  for (const change of [
    { ownerId: "other" },
    { generation: 1 },
    { currentAccess: false },
    { currentSources: false },
    { preauthorized: false },
    { qualified: { ...grant.qualified, isolation: false } },
  ])
    assert.equal(canAdmitExternalEffect(state, { ...grant, ...change }), false);
  assert.equal(
    canAdmitExternalEffect({ ...state, effectIds: ["effect"] }, grant),
    false,
  );
});
test("cancel requested is not stopped; late/old-generation completion cannot admit effects", () => {
  let state = executionIntent({
    jobId: "job",
    attemptId: "attempt",
    ownerId: "person",
    generation: 2,
  });
  state = reconcileExecution(state, {
    id: "dispatch",
    generation: 2,
    sequence: 1,
    kind: "dispatch",
  });
  state = reconcileExecution(state, {
    id: "accepted",
    generation: 2,
    sequence: 2,
    kind: "accepted",
    externalId: "worker-run",
  });
  state = reconcileExecution(state, {
    id: "cancel",
    generation: 2,
    sequence: 3,
    kind: "cancel_requested",
  });
  assert.equal(state.phase, "cancel_requested");
  assert.equal(
    reconcileExecution(state, {
      id: "old",
      generation: 1,
      sequence: 4,
      kind: "finished",
    }),
    state,
  );
  assert.equal(
    reconcileExecution(state, {
      id: "late",
      generation: 2,
      sequence: 4,
      kind: "finished",
    }),
    state,
  );
  state = reconcileExecution(state, {
    id: "stop",
    generation: 2,
    sequence: 5,
    kind: "stopped",
  });
  assert.equal(state.phase, "stopped");
  assert.equal(OPEN_DUET_ADMISSION.enabled, false);
});

test("terminal runtime evidence takes precedence over a pending review", () => {
  const identity = {
    jobId: randomUUID(),
    chatId: randomUUID(),
    turnId: randomUUID(),
  };
  assert.equal(
    runtimeOutcome({ ...identity, stopped: true, proposalOutcome: "pending" })
      .outcome,
    "interrupted",
  );
  assert.equal(
    runtimeOutcome({ ...identity, failed: true, waiting: true }).outcome,
    "failed",
  );
  assert.equal(
    runtimeOutcome({ ...identity, expiredWaiting: true, waiting: true }).reason,
    "waiting_expired",
  );
  const state = executionIntent({
    ...identity,
    attemptId: randomUUID(),
    ownerId: randomUUID(),
    generation: 1,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(state)),
    state,
    "persisted attempts retain their complete reconciliation identity",
  );
});

test("review decisions resolve waiting without certifying goal completion", () => {
  const receipt = runtimeOutcome({ ...ids(), proposalOutcome: "pending" });
  for (const status of ["applied", "declined", "cancelled"]) {
    const projected = projectOutcomeReceipt(receipt, receipt.job_id, status);
    assert.equal(projected?.outcome, "unverified");
    assert.equal(projected?.acceptance, undefined);
  }
  assert.equal(
    projectOutcomeReceipt(receipt, receipt.job_id, "expired")?.outcome,
    "unverified",
  );
  assert.equal(
    projectOutcomeReceipt(receipt, receipt.job_id, "expired")?.reason,
    "waiting_expired",
  );
  assert.equal(
    projectOutcomeReceipt(receipt, receipt.job_id, "pending")?.outcome,
    "waiting",
  );
});
test("a newer neutral response cannot bury a partial result in the same conversation", () => {
  const chat = randomUUID();
  const partial = runtimeOutcome({ ...ids(), chatId: chat, timedOut: true });
  const base = {
    recent_activity: [],
    outputs: [],
    state: "idle",
    runtime: { reporting: false, last_seen_at: null },
    counts: { working: 0, queued: 0, waiting: 0, recovering: 0 },
    last_activity_at: null,
    window: null,
    budget: null,
  };
  const snapshot = assistantProfiles.parse({
    observed_at: new Date().toISOString(),
    profiles: [
      {
        ...base,
        lane: "background",
        outputs: [
          {
            job_id: partial.job_id,
            chat_id: chat,
            title: "Shared work",
            completed_at: "2026-10-29T10:00:00Z",
            handoff: null,
            execution_outcome: partial,
          },
          {
            job_id: randomUUID(),
            chat_id: chat,
            title: "Shared work",
            completed_at: "2026-10-30T10:00:00Z",
            handoff: null,
          },
        ],
      },
      { ...base, lane: "overnight" },
    ],
  });
  const rows = recentAssistantWork(snapshot);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priority, 2);
  assert.match(rows[0].detail, /Partial result/);
});

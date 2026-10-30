import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyTerminalEvidence,
  classifyAssistantEffects,
  readStoredAssistantApplyEffect,
  readTerminalEvidence,
  terminalEvidence,
  type TerminalCause,
  type TerminalEffectContext,
  type TerminalErrorContext,
} from "../src/modules/ai/agent/terminal-evidence.js";

const job_id = "b0fdd06a-bfd6-4d14-996c-60dd9b450187";
const observed_at = "2050-01-02T03:04:05.000Z";
const none: TerminalEffectContext = {
  mode: "live",
  applyStarted: false,
  originalKnownNoWrite: true,
};
const transient: TerminalErrorContext = {
  kind: "provider",
  reason: "http_503",
};
function classify(
  effects: TerminalEffectContext = none,
  error: TerminalErrorContext = transient,
  cause?: TerminalCause,
) {
  return classifyTerminalEvidence({
    job_id,
    observed_at,
    effects,
    error,
    cause,
  });
}
const applied = {
  applied: true,
  structured: {
    status: "done",
    job: "plan_fixture",
    steps: [
      {
        id: "one",
        tool: "create_task",
        done: [
          {
            id: "task_fixture",
            title: "Task",
            url: "/task",
            app_url: "/task",
            change: "created",
          },
        ],
      },
    ],
    pending: null,
  },
  why: [],
};
const held = {
  applied: false,
  structured: {
    status: "pending_review",
    job: "plan_fixture",
    steps: [{ id: "one", tool: "create_task", done: [] }],
    pending: {
      status: "pending_review",
      proposal_id: "proposal_fixture",
      review_url: "/review",
      expires_at: "2050-01-03T03:04:05Z",
      changes: 1,
    },
  },
  why: ["Review required"],
};

test("only allowlisted provider transient reasons with original live no-write proof qualify", () => {
  for (const reason of [
    "http_429",
    "http_500",
    "http_502",
    "http_503",
    "http_504",
  ]) {
    const receipt = classify(none, { kind: "provider", reason });
    assert.equal(receipt.cause, "provider_transient");
    assert.equal(receipt.effects, "none");
    assert.equal(receipt.retry, "eligible");
    assert.deepEqual(readTerminalEvidence(receipt, job_id), receipt);
  }
});

test("each no-write live fact is necessary and reconciliation never infers it", () => {
  for (const effects of [
    { mode: "live" as const },
    { mode: "live" as const, applyStarted: false },
    { mode: "live" as const, originalKnownNoWrite: true },
    { ...none, applyStarted: true },
    { ...none, originalKnownNoWrite: false },
    { ...none, mode: "reconcile" as const },
    { ...none, mode: "reconcile" as const, apply_result: null },
  ]) {
    assert.equal(classify(effects).effects, "uncertain");
    assert.equal(classify(effects).retry, "reconcile");
  }
});

test("validated durable applied and pending receipts prevent a retry even after transient errors", () => {
  for (const [receipt, expected] of [
    [applied, "applied"],
    [held, "pending"],
  ] as const) {
    const result = classify({ mode: "reconcile", apply_result: receipt });
    assert.equal(result.effects, expected);
    assert.equal(result.retry, "never");
  }
});

test("malformed or contradictory apply evidence overrides live no-write claims", () => {
  for (const receipt of [
    {},
    "applied",
    { applied: true },
    { applied: false, structured: null, why: [] },
    { ...applied, applied: false },
    { ...held, applied: true },
    {
      ...held,
      structured: { ...held.structured, steps: applied.structured.steps },
    },
    { ...applied, structured: { ...applied.structured, job: null } },
    { ...applied, unexpected: "unknown receipt version" },
  ]) {
    const result = classify({ ...none, apply_result: receipt });
    assert.equal(result.effects, "uncertain");
    assert.equal(result.retry, "reconcile");
  }
});

test("unknown dispatch stays reconciliation-only even with proven no application effects", () => {
  for (const reason of [
    "network",
    "timeout",
    "chatgpt_timeout",
    "chatgpt_unknown",
    "chatgpt_interrupted",
  ]) {
    assert.equal(
      classify(none, { kind: "provider", reason }).cause,
      "provider_dispatch_uncertain",
    );
    assert.equal(
      classify(none, { kind: "provider", reason }).retry,
      "reconcile",
    );
  }
});

test("explicit stop/deadline observations take precedence without erasing unknown dispatch", () => {
  for (const cause of ["stopped", "deadline", "worker_interrupted"] as const) {
    const result = classify(
      none,
      { kind: "provider", reason: "timeout" },
      cause,
    );
    assert.equal(result.cause, cause);
    assert.equal(result.retry, "reconcile");
  }
});

test("lifecycle causes never acquire retry authority from concurrent provider failure", () => {
  for (const cause of [
    "finished",
    "stopped",
    "deadline",
    "waiting_expired",
    "worker_interrupted",
    "recovery_exhausted",
    "authority_changed",
    "runtime_failure",
    "provider_configuration",
  ] as const) {
    const result = classify(none, transient, cause);
    assert.equal(result.cause, cause);
    assert.equal(result.retry, "never");
  }
});

test("configuration, changed authority and unrecognized provider reasons are not transient", () => {
  for (const reason of [
    "configuration",
    "unsupported_model_controls",
    "redirect",
    "http_401",
    "http_404",
    "chatgpt_unavailable",
    "chatgpt_usage_limit",
    "provider_changed",
    "managed_authority_unverified",
    "http_501",
    "no_choices",
    "error_envelope",
    "future_transient_reason",
  ])
    assert.notEqual(
      classify(none, { kind: "provider", reason }).retry,
      "eligible",
    );
  assert.equal(
    classify(none, { kind: "provider", reason: "provider_changed" }).cause,
    "authority_changed",
  );
});

test("typed pause/auth failures differ from generic conflicts and server errors", () => {
  assert.equal(classify(none, { kind: "paused" }).cause, "authority_changed");
  for (const statusCode of [401, 403])
    assert.equal(
      classify(none, { kind: "http", statusCode }).cause,
      "authority_changed",
    );
  for (const statusCode of [404, 409, 429, 500, 502, 503, 504]) {
    const result = classify(none, { kind: "http", statusCode });
    assert.equal(result.cause, "runtime_failure");
    assert.equal(result.retry, "never");
  }
});

test("a claimed transient cause cannot qualify without actual allowlisted provider context", () => {
  const result = classify(none, { kind: "runtime" }, "provider_transient");
  assert.equal(result.cause, "runtime_failure");
  assert.equal(result.retry, "never");
});

test("read binding rejects legacy, future, malformed and unsafe combinations", () => {
  const receipt = classify();
  for (const value of [
    undefined,
    null,
    {},
    "Run completed successfully",
    { ...receipt, version: 2 },
    { ...receipt, observed_at: "yesterday" },
    { ...receipt, extra: "ignored?" },
    { ...receipt, cause: "stopped" },
    { ...receipt, effects: "applied" },
    { ...receipt, cause: "provider_dispatch_uncertain" },
    { ...receipt, job_id: "invalid" },
  ])
    assert.equal(readTerminalEvidence(value, job_id), undefined);
  assert.equal(
    readTerminalEvidence(receipt, "02cfd960-d3bd-4a98-9ef1-290f80223ca6"),
    undefined,
  );
  assert.equal(
    terminalEvidence.safeParse({
      ...receipt,
      effects: "uncertain",
      retry: "never",
    }).success,
    false,
  );
  assert.equal(
    readTerminalEvidence({ ...receipt, retry: "reconcile" }, job_id)?.retry,
    "reconcile",
  );
});

test("shared effect readers preserve the same deep validation and reconciliation boundary", () => {
  assert.equal(readStoredAssistantApplyEffect(applied), "applied");
  assert.equal(readStoredAssistantApplyEffect(held), "pending");
  for (const value of [
    undefined,
    null,
    {},
    { applied: false, structured: null, why: [] },
  ])
    assert.equal(readStoredAssistantApplyEffect(value), "uncertain");
  assert.equal(classifyAssistantEffects(none), "none");
});

test("only explicit trusted rollback proof establishes no effects during reconciliation", () => {
  for (const mode of ["live", "reconcile"] as const) {
    for (const apply_result of [undefined, null]) {
      const effects = {
        mode,
        applyStarted: true,
        apply_result,
        confirmedRollback: true,
      };
      const result = classify(effects);
      assert.equal(result.effects, "none");
      assert.equal(result.retry, "eligible");
      assert.equal(
        classify({ ...effects, confirmedRollback: false }).effects,
        "uncertain",
      );
      const uncertain = classify(effects, {
        kind: "provider",
        reason: "chatgpt_timeout",
      });
      assert.equal(uncertain.effects, "none");
      assert.equal(uncertain.retry, "reconcile");
    }
    for (const apply_result of [
      {},
      { applied: false, structured: null, why: [] },
    ]) {
      const result = classify({ mode, apply_result, confirmedRollback: true });
      assert.equal(result.effects, "uncertain");
      assert.equal(result.retry, "reconcile");
    }
    assert.equal(
      classify({ mode, apply_result: applied, confirmedRollback: true })
        .effects,
      "applied",
    );
    assert.equal(
      classify({ mode, apply_result: held, confirmedRollback: true }).effects,
      "pending",
    );
  }
});

test("failed device-safe-deferral remains dispatch uncertain and missing managed authority never retries", () => {
  const deferred = classify(none, {
    kind: "provider",
    reason: "chatgpt_device_offline",
  });
  assert.equal(deferred.cause, "provider_dispatch_uncertain");
  assert.equal(deferred.retry, "reconcile");
  const authority = classify(none, {
    kind: "provider",
    reason: "managed_authority_unverified",
  });
  assert.equal(authority.cause, "authority_changed");
  assert.equal(authority.retry, "never");
});

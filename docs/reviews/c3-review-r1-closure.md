# C3 round 1/3 — correction review

**Decision: changes required; C3 is not yet accepted for main integration.** Original R1 and R2 are closed as defects, but their correction exposes the queue-progress defect R3 below. Continue targeted closure within round 1/3.

Candidate: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`, `codex/c3-agent-platform`, code `6082b5eacc542c3fb8688e8531a8050fb2afa20f`, documentation HEAD `f6abc75f`. Inspected the correction against `7b052a4f`, added test assertions, surrounding claim/provider guards and `c3-test-r1-review-fixes.md`. Candidate was clean.

## Original findings

- **R1 closed:** Scheduled Agenda now intersects separate provider consent with current Background authority. The shared guard checks personal/source-space reads, edit/any-change rules and captured rules revision. It is used at claim, private inference authority checks and apply. Ask/deny blocks unattended work; migration 261 leaves legacy revisions null so old work fails closed. Tests cover pre-enqueue denial, post-enqueue changes and rejection of a signed pending result without changing the paragraph.
- **R2 closed:** Reservations subtract cumulative prior usage (retaining unknown reserved usage) and checkpoint estimates from the current per-run ceiling. Recovery cannot replenish the allowance. Lowered limits apply at the next segment. Job and page tests cover 600 + 400 against a 1,000 ceiling, exhausted/stale checkpoints, lowering limits and competing daily reservations. The resulting null reservation must also be handled correctly by the caller, as R3 explains.

## R3 — P1: An exhausted queued job can block the entire lane

**Location:** `backend/src/modules/ai/agent/runner.ts:80–89`, together with the new zero-reservation refusal in `backend/src/modules/ai/agent/work-budget.ts:88`.

The job query selects only the oldest candidate. Its SQL budget predicate checks daily/hourly availability, not remaining cumulative per-run capacity. When the selected job has exhausted its per-run allowance, the corrected reservation function returns null; the claimant returns null without changing or excluding that job. Every subsequent tick selects it again. The global runtime claim lock also means additional replicas do not provide a reliable escape. Later eligible jobs, including another owner's jobs, cannot advance through this claimant.

Concrete case: an old Background job has consumed 1,200 tokens and is requeued after its owner lowers the per-run cap to 1,000; daily allowance and hourly starts remain available. A newer Background job for another owner has budget available. The old job remains the first candidate indefinitely, preventing the newer job from being claimed. Recovery at an exhausted original budget has the same failure. The new budget tests correctly assert null from the reservation helper but never exercise this queue consequence.

**Builder correction:** Ensure ineligible per-run work cannot remain a permanent head-of-line blocker. Filter exhausted candidates using the same cumulative budget semantics and/or explicitly transition them to an appropriate held/terminal state, while continuing to eligible candidates. Preserve transactional reservation checks and cancellation/recovery behavior. A bounded scan alone is insufficient if an exhausted prefix can permanently fill the scan; eligibility or state must make progress across ticks. Distinguish temporary daily/hourly limits from exhausted per-run capacity and provide a recoverable disposition if an owner later raises the limit.

**Tester verification:** Use real `claimAssistantJob` calls with an older exhausted/requeued job and a newer eligible job belonging to another owner. Assert the eligible job is claimed within bounded calls, no extra tokens are reserved for the exhausted job, and repeated ticks do not stall. Cover both checkpoint exhaustion and a lowered cap, plus concurrent claimers and both automation lanes. Recheck existing recovery/lane and budget suites after the fix.

## Retained evidence and limits

Inspected retained log summaries: **43/43** affected Agenda/budget/page tests and **19/19** recovery/lane tests passed; the additional Agenda phase log records **2/2** successful authority checks. Tester reports migration 261, zero pending migrations and backend typecheck passed. The extra two-case verifier is outside the repository; the committed suite still contains the principal authority regressions. No full aggregate rerun was claimed. Unchanged client/core source supports retaining earlier package/client evidence.

No tests/builds were run by Reviewer, no QA database was accessed, and no product/test source was edited. Routine visuals and separate desktop/iOS/Android builds remain excluded/untested. No merge, push or deployment is claimed; production deployment remains user-owned.

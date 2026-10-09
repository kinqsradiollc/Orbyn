# C3 review — round 1/3

**Decision: changes required.** Two findings remain open. Builder owns fixes; Tester owns execution. Targeted correction and closure can remain in round 1.

Reviewed candidate: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`, branch `codex/c3-agent-platform`, code `7b052a4f3d0d1d70eca431a012b79084ba6b7e34`, documentation HEAD `1e4d08e0f11b4101f308e8106678643539a0512d`, base `88b49d8810974bbcfefd1f44e9477f8c81734972`. Candidate checkout was clean. Review followed `AGENT.md`, `docs/agents/review.md`, coordination and applicable UI/content guidance.

## R1 — P1: Scheduled Agenda bypasses Background read/effect rules

**Location:** `backend/src/modules/docs/agenda-summary-runs.ts:213–223` (guard), enqueue at 121–146; `backend/src/modules/auth/agenda-private-permission.ts:168–204`.

Scheduled Agenda is Background work, but its authority path checks its separate Agenda/provider permission and source visibility without evaluating the Background assistant principal or typed rules. `captureAgendaAiSnapshot` reads the owner's Agenda facts directly. The scheduled provider guard delegates back to `guardScheduledAgendaRun`, so it does not supply the missing rule check either. An owner can retain scheduled-summary consent and then deny Background reads of personal content; summaries can still send those personal facts to inference. The same path does not intersect the new effect rules before the summary write. Separate provider consent must not override a current deny rule.

**Correction:** Intersect scheduled Agenda consent with current Background authority. Enforce effective source-space read policy before snapshot capture and before provider dispatch, and the applicable effect policy before applying the paragraph. Capture/recheck rules revision for queued and in-flight work; do not silently continue with a snapshot collected under obsolete authority. Preserve the existing explicit Agenda/provider consent requirement.

**Tester verification:** With otherwise valid scheduled Agenda consent, deny/ask Background personal reads before enqueue and after enqueue; verify no prohibited provider payload is delivered. Edit relevant effect rules before application and verify the paragraph is held. Include an allowed control case and a rule change while private inference is pending. Existing read-rule unit tests exercise `policy.spaces`, not this direct snapshot path.

## R2 — P2: Recovery replenishes the advertised per-run budget

**Location:** `backend/src/modules/ai/agent/work-budget.ts:65–82,98–113`; `backend/src/modules/ai/agent/runner.ts` claim writes the returned value into `state.token_budget`. Maintained-page reclaim uses the same reservation function.

The reservation takes `min(originalLimit - startingEstimate, per_run_token_limit, dailyRemaining)` and returns `startingEstimate + reserved`. Consequently the owner limit applies to each worker segment rather than the complete run. For example, with a 1,000-token per-run setting and a larger original automation budget, a job that checkpoints 600 tokens and then resumes receives a cumulative ceiling of 1,600. Further recovery/approval resumes can raise it again. Both clients label this setting “Tokens per run,” and the C3 scope promises a per-run limit. Daily accounting does not enforce that separate promise.

**Correction:** Compute remaining capacity against a cumulative run ceiling, including the configured per-run limit, before reserving another segment. Preserve that ceiling across recovery and approval resumes and decide explicitly how lowering limits affects existing runs. Apply the same contract to page-run recovery. Keep reservation settlement separate from the cumulative work ceiling; avoid replenishment merely because a lease or waiting interval ended.

**Tester verification:** Start a run with a 1,000-token cap, checkpoint 600, settle/requeue and reclaim; assert its cumulative ceiling remains at most 1,000 and remaining reservation at most 400. Repeat recovery and approval resume, exercise the exhausted case, and cover maintained-page reclaim. The present budget suite tests fresh sequential reservations and settlement, not cumulative resumed limits. Add competing-claim coverage for the shared daily reservation boundary as part of this targeted budget qualification.

## Evidence and scope

Reviewed the full C3 changed-file scope with emphasis on typed policy/context narrowing, current authority checks, independent lane claims and recovery, source-revisioned handoff creation/dispatch/acknowledgment, storage invariants, budget reservation/settlement, reflection source checks, and shared web/mobile contracts. No additional blocker identified in handoff bounds, recipient ownership/provenance, Overnight window checks, or the explicit-consent reflection path. Client assessment is source-level, not visual qualification.

Read `c3-agent-platform-progress.md`, `c3-test-r1.md`, and `c3-test-r1-retest.md`. Inspected retained log summaries: focused checks **41/41**, unchanged recovery retest **13/13**, and rules retest **29/29**, all with zero failures. Tester reports shared package build and backend/web/mobile typechecks passed; the revised backend typecheck passed. The correction from `0287f4fd` is confined to the checkpoint guard and documentation, supporting reuse of unchanged focused/client evidence.

The original wider run was **93/103**, with all ten failures in recovery. The unchanged recovery retest closes that original regression; it does not cover R1 or R2 above. The entire 103-test command was not rerun together. The legacy-checkpoint exception is appropriately restricted to untouched revision-1 empty rules; edited rules remain fail-closed.

Reviewer ran no tests/builds, accessed no QA database, and changed no product/test code. Routine visuals and separate installed desktop/iOS/Android builds were excluded and remain untested. Approval, merge, push and deployment have not occurred as part of this review.

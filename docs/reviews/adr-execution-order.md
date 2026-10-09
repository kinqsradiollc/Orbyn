# ADR execution order

Updated 9 October 2026. This orders the complete retained ADR; it does not replace
its acceptance contract in `devday-2026-implementation-review.md`.

## Current instruction

C1 and C2/M1 are accepted under their final user-approved scopes. C2/M1 was
merged and pushed to main at `c778c25f`. The user-requested content cleanup
before C3 passed Test → Review in round 1/3 and was pushed to main at
`70e7e687`. C3 then passed Test → Review in round 1/3 and was pushed to main
at `db0913e6`. C4/D1 is next when the user resumes the paused goal. Hosted
independent web sign-in is deferred; phone-owned inference has no independent
proof. Production deployment is user-owned.
The user explicitly stopped Visual Check for the content cleanup; source and
targeted checks do not count as visual acceptance.

## Working rule

Complete the full agreed scope before the formal Test → Review handoff. Builder implements, Tester qualifies
the frozen candidate, and Reviewer reviews code/evidence and guides Builder on fixes without coding or running tests. Follow
[the checkpoint workflow](checkpoint-workflow.md), including its recorded maximum
of three review rounds and retesting after fixes. Record native/external gates;
an incomplete gate keeps the checkpoint open. Only qualified scopes may integrate
into main; candidate-only behavior is not shipped and pushed main is not deployment.

On 8 October the user authorized Orbyn Visual Check to analyze the rendered UI
and report findings, superseding its capture-only assignment for this checkpoint.
Request one checkpoint at a time with source ref, page, states, viewport/theme,
and a Markdown handoff. The implementation session reviews the evidence and owns
corrections, qualification and integration. Identify delegated pixel review
accurately; inaccessible historical images remain unreviewed.
Existing visual reports remain historical evidence. The earlier capture manifest
is `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/review-tracking.md`.

## Canonical top-down delivery queue

The user explicitly requires the full ADR from top down (7 October 2026).
This supersedes the earlier Docs-first queue. QA-006 remains a completed scoped
checkpoint, not evidence that an entire ADR stage is complete. C1 and C2/M1 are complete under their final user-approved scopes;
normal Docs activation stays queued under C4. Existing work is retained.

| Order | Scope                                                | Current state                                                                      | Exit condition                                                                                                                                                                           |
| ----- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | C1: model/provider/connection contracts              | Complete; accepted round2/3, merged main6f56c548                                   | Managed/BYO/plan boundaries, supported models/request capabilities, explicit fallback, caching evaluation, multiple-provider and embedding configuration/migration requirements verified |
| 2     | C2/M1: SIWC, account catalogs/defaults and execution | Accepted round1/3, pushed main `c778c25f` under revised scope; hosted web deferred | Correct platform connection, verified account/plan permissions, truthful usage, catalog/default persistence, protected tokens, lifecycle/revocation and actual inference acceptance      |
| 3     | C3: rules, ownership, activity and budgets           | Accepted round 1/3; pushed main `db0913e6`                                         | Typed rules on every write path, authority/recovery, budget accounting and independent Background/Overnight profiles, triggers, collaboration and reflection verified                    |
| 4     | C4/D1: Docs parity and UI regressions                | Foundation candidate; normal editor activation unfinished                          | Complete ownership through normal editing/saving/recovery/history/tasks/collaboration; all required Markdown/Mermaid families, import/export/privacy and browser/native matrices pass    |
| 5     | C5: bound pages, publication and channels            | Foundations/candidates implemented                                                 | Exact block ownership and schedules, human conflicts/mentions, public consent/revocation, real authorized Slack/Teams installation/delivery/replies/lifecycle verified                   |
| 6     | C6: separate plugin backend/UI and security          | Partial                                                                            | Independent connector authority, managed/BYO provider execution and launch contexts, real host OAuth/UI, authorized scan evidence and triage verified                                    |
| 7     | U1: final whole-app acceptance                       | Required within each stage; sampled checks only so far                             | Every named surface and cross-client feature, themes, narrow/wide/collapsed panels, large text, errors/loading/keyboard/overlays and native parity verified                              |
| 8     | Final integration and cleanup                        | Pending                                                                            | All retained ADR requirements reconciled and qualified on main; preserve user/character work; remove only safe merged branches/worktrees; user deploys manually                          |

Within each stage, implement its full scope in a coherent order before formal
qualification and review. UI/backend/shared/mobile work belongs to that stage,
not a separate random workstream. Record a dependency or production incident before an exceptional
reorder; an incomplete external gate remains visible and is not waived. Do not
move to the next canonical stage while claiming the current stage complete
without its full acceptance evidence.

## Evidence boundaries

- Task checkpoint on main: `3844b5c8`; production deployment unconfirmed.
- Frozen candidate `400ee67e`: 3,939 tests passed, zero failures/skips.
- Newer candidate `5523afe1`: full run finished with 3,969 passes, zero
  failures/skips, terminal exit zero (783008ms). Log:
  `/tmp/orbyn-adr-full-5523afe1-20261007.log`. It predates QA-006, subsequently committed to main3844b5c8.
- QA-006's initial two failures were test-harness extraction failures: JSX was
  wrapped in a parenthesized expression. The corrected harness executes the same
  product guards/callbacks; all five cases pass in the ownership worktree.
- Browser QA then exposed the existing native Alert web no-op. Task cancellation
  now uses Orbyn's cross-platform confirmation helper. Expanded checkpoint checks
  pass 26/26 on the candidate and main working tree; refreshed browser recheck passed. Mobile typecheck passes. Promoted as main3844b5c8 after the recorded recheck.
- Browser review is not installed OAuth/keystore/native keyboard acceptance.
- Voice, computer-use product features and the speculative Decisions adapter
  remain excluded. MCP grants remain separate from ChatGPT provider credentials.

Mobile browser confirmation is now an app-owned sheet with full explanatory text,
Keep task and Cancel task choices, and fresh task/permission/busy checks. Native
iOS/Android retain native alerts. This replaces the browser-native prompt after
visual QA could not establish safe dismissal. Browser review accepts390/320 confirmation containment and safe Keep task dismissal with status preserved after reload. Native visual acceptance remains open.

## Visual coordination requirement

All visual requests must be sent to **Orbyn Visual Check**. Its current authorized
assignment includes analysis and a Markdown report. Preserve source checkout,
URL, actual viewport/scale and original image paths or inline capture IDs; state
when export or root inspection is unavailable. Assess task space, concise copy,
interaction and recovery alongside containment, using `skills/orbyn-ui-design`.
A blocked permission or stale preview is an open gate, never acceptance;
respect tool restrictions without alternate-port/browser or indirect workarounds.

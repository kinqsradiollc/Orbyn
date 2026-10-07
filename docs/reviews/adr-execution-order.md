# ADR execution order

Updated 7 October 2026. This orders the complete retained ADR; it does not replace
its acceptance contract in `devday-2026-implementation-review.md`.

## Working rule

Finish the active checkpoint before starting another product change. For each
checkpoint: reproduce/audit, implement backend and both clients as applicable,
run focused checks, obtain browser review, record remaining native/external gates,
then commit and integrate a production-ready scope into main. Do not describe
candidate-only or unverified behavior as shipped. A failing or incomplete gate
keeps that checkpoint open. External gates remain explicit and do not erase scope.

Orbyn Visual Check owns browser review. Its authoritative findings file is:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/review-tracking.md`.
Request one checkpoint at a time. Findings, steps, screenshots and untested limits
go in that Markdown file; messages contain only a short file-path handoff or a
blocking finding. This session owns implementation, qualification and integration.

## Ordered delivery queue

| Order | Scope                                       | Current state                                                                | Exit condition                                                                                                                                                            |
| ----- | ------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | U1 task-panel controls, QA-006              | Completed on main3844b5c8; browser rechecks accepted; 26-check cohort passes | Both browsers verify the menu/confirmation and contained layout; types/tests pass; scoped main checkpoint                                                                 |
| 2     | C4/D1 normal editor ownership               | Active; foundation candidate, normal editors still use flat transport        | Web and mobile use complete-document loading, exact operations, serialized saves and conflict-safe recovery; task/history/collaboration paths preserve ownership          |
| 3     | C4/D1 Markdown and Mermaid acceptance       | Partial; QA-008 title and QA-009 code controls open                          | Required syntax/diagram families, source/preview, structural editing, imports/exports and privacy matrices pass on both clients                                           |
| 4     | C1/C2/M1 ChatGPT and providers              | Partial; standalone web and installed OAuth/inference open                   | Supported desktop/mobile/web connection, real account/catalog/default/plan/usage acceptance; explicit fallback; managed capability/caching and embedding migration checks |
| 5     | C3 agents and independent runtimes          | Foundations implemented                                                      | Typed rules, activity, budgets, Background/Overnight transitions, collaboration and reflection pass actual runtime/client checks                                          |
| 6     | C5 maintained/shared/published pages        | Foundations implemented                                                      | Exact block bindings, human conflicts, mentions, schedules, consent/revocation and public/private boundaries pass end to end                                              |
| 7     | C5 Slack and Teams                          | Implementation candidates                                                    | Authorized installation, delivery/replies, waiting identity, unsubscribe/revocation and replay acceptance in real tenants                                                 |
| 8     | C6 separate plugin integration and security | Partial                                                                      | Independent managed/BYO inference and launch contexts; real host authorization/UI; authorized scan artifact and triage workflow                                           |
| 9     | U1 full application acceptance              | Sampled browser checks; many states unverified                               | Every named surface, themes, narrow/wide/collapsed panels, large text, errors/loading/keyboard/overlays and mobile parity verified                                        |
| 10    | Final integration and cleanup               | Pending                                                                      | Relevant work reconciled and qualified on main; preserve user/character work; remove only safe merged branches/worktrees; user deploys manually                           |

If a discovered defect blocks the active checkpoint, fix it within that checkpoint.
Otherwise record it in the backlog and retain this order. Reorder only for a real
dependency, production incident or user priority, documenting the reason first.

## Evidence boundaries

- Task checkpoint on main: `3844b5c8`; production deployment unconfirmed.
- Frozen candidate `400ee67e`: 3,939 tests passed, zero failures/skips.
- Newer candidate `5523afe1`: full run finished with 3,969 passes, zero
  failures/skips, terminal exit zero (783008ms). Log:
  `/tmp/orbyn-adr-full-5523afe1-20261007.log`. It excludes uncommitted QA-006.
- QA-006's initial two failures were test-harness extraction failures: JSX was
  wrapped in a parenthesized expression. The corrected harness executes the same
  product guards/callbacks; all five cases pass in the ownership worktree.
- Browser QA then exposed the existing native Alert web no-op. Task cancellation
  now uses Orbyn's cross-platform confirmation helper. Expanded checkpoint checks
  pass 26/26 on the candidate and main working tree; refreshed browser recheck is
  pending. Mobile typecheck passes. Promoted as main3844b5c8 after the recorded recheck.
- Browser review is not installed OAuth/keystore/native keyboard acceptance.
- Voice, computer-use product features and the speculative Decisions adapter
  remain excluded. MCP grants remain separate from ChatGPT provider credentials.

Mobile browser confirmation is now an app-owned sheet with full explanatory text,
Keep task and Cancel task choices, and fresh task/permission/busy checks. Native
iOS/Android retain native alerts. This replaces the browser-native prompt after
visual QA could not establish safe dismissal. Browser review accepts390/320 confirmation containment and safe Keep task dismissal with status preserved after reload. Native visual acceptance remains open.

# Final integration and cleanup

Baseline: remote main `ac1ef39507b3af7951557c98ae6a5f0dfbdf26a3`, verified
12 October 2026. This reconciles the retained requirements with the owner's
later scope decisions. Historical reports remain evidence at their own commits;
their old pending decisions are not current status.

## Requirement reconciliation

| Requirement                            | Delivered evidence                                                                                                                                                                                                                                                             | Limits retained                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact scope                         | The governing proposal excludes A8 voice, A9 computer use and speculative A12 Decisions. Contributor rules prohibit unrequested security scans.                                                                                                                                | These are excluded features, not missing implementations.                                                                                                                             |
| A1: ChatGPT connection                 | [C2 acceptance](c2-r1-closure-b7b05211.md): PKCE/state/nonce, protected local credentials, refresh/lifecycle, device execution and inference authority; owner reported phone Connect success.                                                                                  | Independent hosted web connection deferred. Phone-owned enrollment/inference not independently observed. Browser uses an available signed-in executor; no hosted credential pooling.  |
| A2: managed AI                         | [C1 closeout](c1-closeout-2026-10-08.md), provider boundaries and explicit fallback; [C6 assessment](c6-acceptance-assessment-2026-10-12.md) records the separately authorized live managed path.                                                                              | One live `matilda` path is not proof of every vendor.                                                                                                                                 |
| A3: models, capabilities and caching   | C1 model/request capability and cache evaluation receipts; selected catalog/default state retained.                                                                                                                                                                            | Additional live OpenAI cache and embedding measurements are owner-approved follow-ups.                                                                                                |
| A4: agent rules, ownership and budgets | [C3 closeout](c3-closeout-2026-10-09.md): independent Background/Overnight profiles, activity, typed rules, fenced handoffs, budgets and reviewable reflection.                                                                                                                | No newly claimed native interaction or live-provider result.                                                                                                                          |
| A5: maintained pages and comments      | [C5 review](c5-review.md): exact structured block ownership, schedules, human conflicts, scoped comment jobs/replies and two-way client synchronization.                                                                                                                       | Earlier C4 browser follow-ups remain separate.                                                                                                                                        |
| A6: Slack and Teams                    | C5 accepted local installation/signature/replay/outbox/reply/lifecycle contracts.                                                                                                                                                                                              | Live authorized Slack/Teams delivery deferred by owner.                                                                                                                               |
| A7: publication                        | C5 selected snapshot/live publication, consent, source/media privacy and anonymous revocation; rendered checks and bounded browser observations.                                                                                                                               | No fresh universal viewport audit is claimed.                                                                                                                                         |
| A10: saved security findings           | [Remediation record](security-remediation-2026-10-11.md), correction/Tester/Reviewer records and C6 acceptance retain fixed saved findings.                                                                                                                                    | No new scan, exhaustive security claim or scheduled scan delivery. Owner explicitly prohibited scans.                                                                                 |
| A11/P1: plugin integration             | [ADR 002](../adr/002-unified-mcp-integration.md), [C6 assessment](c6-acceptance-assessment-2026-10-12.md): canonical `/mcp`, legacy coexistence, previews/fallback, separate inference permission/worker, real document Review/Submit/Refresh and bounded live request/replay. | Uploads and owner-stopped host cases deferred; account switching/revocation owner-confirmed, not independently observed. Exact deployed image and permission caps remain unavailable. |
| M1: account catalog/default            | Current `backend/src/modules/auth/chatgpt-model-routes.ts` exposes authenticated `GET /models` and `PUT /models/default`; C2 catalog, account/default and overlapping refresh receipts accepted.                                                                               | Stale/offline devices are unavailable, not managed models mislabeled ChatGPT.                                                                                                         |
| D1: Markdown visualization             | [C4 requirement ledger](c4-d1-requirements-ledger.md) maps all eight families: CommonMark/GFM, code, ten Mermaid families, math, extended text, source/preview, exports and media/security. Actual rendered PDF/HTML and ownership/recovery tests are recorded.                | [C4 scope disposition](c4-d1-progress.md) defers remaining editor/browser interactions to production; enrollment/native gates are excluded. These are not passes.                     |
| U1: shared UI and content              | [U1 acceptance](u1-implementation.md), [Tester](u1-tester-r1.md), [Reviewer](u1-review-r1.md), [Visual](u1-visual-r1.md): full family reconciliation; shared prompts/alerts, compact Sheets, pane sizing, long values, modal ownership/dismissal/focus. Approved round 1/3.    | Bounded web 320/900/1280 and Expo 320 evidence; nested credential prompt and forced retry not rendered. No every-state/every-device claim.                                            |
| Ready checkpoints on main              | C1 `1a92a2c0`, C2 `b7b05211`, C3 `1fce0b66`, C4 `0b96ad61`, C5 `bbb7f28d`, C6 closeout `a779176c`, U1 `e0997ae4` are all ancestors of `ac1ef395` (Git checks exit 0).                                                                                                          | Main delivery is not production deployment.                                                                                                                                           |
| Environment and gateway                | [C6 environment review](c6-mcp-env-review-2026-10-12.md) and deployment docs preserve canonical MCP plus separate legacy recipient/profile and optional Workspace AI; one `.env.example` per workspace and protected private production configuration.                         | Private values are not committed or reproduced in receipts. Legacy retirement requires separate owner approval.                                                                       |

## Source continuity

Read-only comparisons against current main found C2 model/inference routes,
C3 assistant rules, C5 channel/publication modules and C6 backend/core/API-client
runtime unchanged within their named compared paths. This is bounded continuity,
not a whole-application equivalence claim.

C1 provider adapter/network changes after its accepted candidate belong to the
saved-finding remediation checkpoint `4da327dc`; retain its subsequent correction
and qualification evidence. C4 backend Docs changes belong to C5 maintained-page
and scoped comment work. Their later stage receipts apply, rather than asserting
that all C1/C4 source is unchanged. Since C6 closeout, runtime changes are the
accepted U1 UI/confirmation batch; no provider or plugin runtime changed.

Do not add overlapping counts into a fictitious final full-suite run. Current
qualification uses accepted stage receipts and affected-source retests. No new
native build, vendor call, full visual sweep or security scan is required here.

## Cleanup

The [Tester inventory](final-cleanup-tester.md) identifies six obsolete detached
C6 test checkouts with clean tracked/non-ignored state, no ahead commits, only
reproducible ignored build/dependency output, and no active process use.
Builder rechecked clean state and ancestry before removing those exact paths.
The removal command completed with exit 0 for all six paths on 12 October 2026.
Each frozen commit remains reachable through main. No unique source/evidence or
local environment was removed.

Preserve the active `c6-next` checkout, backend/web/Expo previews, primary dirty
checkout, character work, other agent-owned changes and the Visual-owned C6
report. No remote branch deletion, blanket prune, persistent-volume deletion or
private environment removal is part of this cleanup. Remaining historical
worktrees are retained rather than assumed disposable.

## Acceptance and delivery

[Tester verification](final-integration-tester.md) passed changed local links,
environment-template coverage (131 backend/Compose variables and both clients),
all accepted-ref ancestry checks, cleanup absence and retained preview listeners.
[Reviewer](final-integration-review.md) approved candidate `c1aedfb9` in final
round **1/3**, finding no remaining required product correction or qualification
batch under the owner-revised scope.

This final batch changes records, not product behavior. Approved candidate
`c1aedfb901016da54f71bd8b9b6b5b589c2c7aee` was fast-forwarded and pushed to
main, confirmed with `git ls-remote`. Closing Tester/Reviewer/tracker records
follow as a documentation-only receipt commit. The agreed implementation,
integration and safe cleanup delivery is complete under the owner's recorded
revised scope. Production deployment is owner-managed. Deferred follow-ups remain
visible after release closeout; full native/external matrices are not claimed.

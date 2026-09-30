# R1–R10 durable assistant: review, repairs and acceptance

**Status: all 24 finding areas patched and locally verified; ready for the authorized merge.** Review prepared 30 September 2026. The original static review is retained below as baseline evidence.

## Implementation ledger

Work is on `codex/r1-r10-fixes` in `/Users/anhdang/Documents/Github/orbyn-wt/runs-durable`, based on `f1df5e474438cd5e4d5fb828b14901ea7e65c518`. No merge or deployment has occurred at this checkpoint. Verification used local fake providers and disposable databases; no real provider or OS push delivery is claimed. This ledger records implementation and observed checks; it does not turn every original acceptance scenario into a passing result.

| Findings    | Implemented repair                                                                                                                                                                              | Evidence / remaining limits                                                                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01/F08/F09 | Durable per-run origin; persisted notice intents reconsidered after the grace period; resolved/obsolete waiting and terminal deliveries cancelled                                               | Notice transition, delayed recovery, multiple-device and stale-delivery tests pass. Legacy human replies in reminder chats migrate as personal runs. OS delivery unverified.                                                                                                                                                                    |
| F02         | Displayed waiting UUID required in chat and Overnight requests; checked under the job transaction lock                                                                                          | Missing/malformed/stale question and approval tests pass. Native and desktop stale question/approval submissions were exercised at a held transaction boundary; both returned 409 without consuming the newer card.                                                                                                                             |
| F03/F10     | Navigation generations; abortable restore, retry and polling; Send supersedes restore; draft preservation; late action responses guarded                                                        | Desktop and mobile web send-during-held-restore checks pass; desktop unsent-draft check passes. iOS Expo Go send-during-restore, receipt recovery after reload, Stop and background/resume checks pass. This is not exhaustive device coverage.                                                                                                 |
| F04/F07     | Shared current chat/project/task authorization for polling, active jobs, replay, action, notices and inbox                                                                                      | Backend ownership/visibility regressions pass. Source-level gates below extend this beyond chat scope.                                                                                                                                                                                                                                          |
| F05         | Ten-second row-write throttle; Retry-After seconds/date parsing; bounded cancelable retry without added normal delay                                                                            | 60 concurrent local polls produced one row revision; fresh poll under a runner row lock completed in 35 ms. Expired presence writes again. This does not establish production load.                                                                                                                                                             |
| F06/F24     | Live notice announcements; one morning push with a provisional in-app card; material updates as jobs settle; fair refresh cursor                                                                | Late settlement/recovery and 25-night fairness tests pass. Real push arrival remains unverified.                                                                                                                                                                                                                                                |
| F11/F12     | Submission identity and content match; chat advisory serialization; atomic saved turn plus job enqueue                                                                                          | Retry/concurrent submission/rollback/access tests pass. Legacy surplus runs are cancelled while preserving transcripts and apply receipts.                                                                                                                                                                                                      |
| F13/F14     | Delegate and specialist tool receipts; persistent specialist loops; atomic waiting projections with retryable recovery                                                                          | Database fault tests and real SIGKILL tests at completed specialist-tool and delegate checkpoints pass; replacement runner avoids duplicate logical steps. Provider work before a checkpoint may repeat.                                                                                                                                        |
| F15/F16     | Ordinary follow-through ownership preserved when disabled; Tonight consent gates; fresh routine due/rule/instruction checks; scanner isolation; current consent and trust checked before writes | Scheduler/settings/process regressions pass. Waiting personal questions no longer block unrelated nightly work. Shared goal attempt/backoff policy enforced.                                                                                                                                                                                    |
| F17/F18     | Durable job and saved-chat source dependencies; nested Memory dependencies; current source gates across cards, decisions, inbox and digest; safe restricted leftovers                           | Opt-out, ownership, missing-source and retained-chat tests pass. Unknown historical background snapshots fail closed. Not an exhaustive security certification.                                                                                                                                                                                 |
| F19         | Revisions on goals/routines/sessions/comments; locked compare-and-write for all mutation paths; complete revision-session set guard                                                             | 21 action/Undo race tests and receipt rollback/changed-card tests pass; all-writer revisions include workers.                                                                                                                                                                                                                                   |
| F23         | Server action receipt plus mutation commit together; intent/generation dedup; durable guarded Undo; both cards restore the receipt                                                              | 8 receipt tests pass, including API-key denial, malformed JSON and rate limits. Mobile action restored on desktop and Undo executed across clients. Reload checks pass on both web previews.                                                                                                                                                    |
| F20         | Bulk decisions require exactly the rendered eligible run IDs and content tokens                                                                                                                 | Backend races/rollback tests pass; desktop changed-during-confirmation check returns 409. Native bulk confirmation also rejects changed work with 409; action feedback now survives automatic refresh. The mobile web browser dialog could not be controlled in the in-app browser.                                                             |
| F21         | Authorized historical-night API; IDs retained through notifications, deep links and both clients; digest links name the night                                                                   | Old-night deep links display the intended date on desktop and mobile web. Removed obsolete mobile Review branch so proposal links reach Review. Native in-app notice navigation opens the retained older night and preserves it through background/resume. Installed-app universal links and OS push arrival are outside these observed checks. |
| F22         | Disabled/quiet/cap gates before discovery; selected-category predicates; stop after cap; targeted exam/calendar lookup                                                                          | Query-count tests pass. Selected task revalidation uses one source query with 1,004 tasks (3 ms locally). Production scan duration/backlog and all-category load remain unmeasured.                                                                                                                                                             |

### Chosen contracts

- Human submissions own personal away notices, even in an automation-origin chat. Automated work uses its dedicated surface; Night shift uses Overnight. A recently polled job gets a grace period before an away notice. Poll presence is not proof that a person read the result.
- One active submitted turn per chat. Identical submission IDs return the original job only for matching content and current access; different concurrent turns return conflict. Old duplicate history and receipts remain retained.
- Missing/stale waiting IDs and stale bulk snapshots fail closed with 409 (malformed input uses validation status). Old clients must update; the server does not infer the latest displayed card.
- Restoring is visible. Sending supersedes restoration; unsent drafts survive successful restoration. Navigation owns exactly one poll loop.
- Night follow-through claims ordinary goals/routines only while enabled. Tonight requires Night shift plus handed tasks. Disabling Night shift/kinds revokes queued execution and prevents later writes; current stricter morning hold wins over the saved setting. Trust/grant and scope are rechecked in the write transaction.
- Morning uses one push per night plus a live provisional card showing unsettled work. It updates when late questions, plans or failures settle. Latest and historical destinations are distinct.
- Source access follows current permissions, assistant-off and deletion state. Recorded dependencies survive job cleanup with the saved chat. Restricted historical background results hide content and decisions. Source checks cannot retract content already delivered to an OS or provider.
- A reminder card has one committed action per generation. Same intent retries return its receipt. A different stale intent conflicts. After successful Undo, the next explicit action starts a new generation. Undo protects later changes with server revisions and the complete affected set.
- Eight leased execution slots are shared across replicas. Specialist checkpoints reuse completed logical steps, not exact instruction-level execution.
- Token limits are an incremental character-based estimate, **not a provider billing cap**. Admission persists an 8,192-token output reservation before each provider attempt; replies over 32 KiB are rejected. Lost/interrupted replies retain their reservation. At most one additional tools-off final call is recorded per loop; its input and reservation can exceed the nominal estimate. Actual provider tokenizer/context-history costs differ. Persisted iteration counts prevent resumed loops from resetting their step allowance.

### Verification record and limits

The complete backend run passed **1,726 tests, zero failures** in 522.5 seconds. After the final conflict-message cleanup, the assistant-run batch passed **41/41**. Final backend/desktop/mobile typechecks, backend and desktop production builds, and iOS/Android exports passed. `git diff --check` passed. Build output retains the existing large-chunk warning; exports are not native installation proof.

Observed UI checks use a separate disposable PostgreSQL database and local fake provider: desktop restore/draft races; mobile web and iOS Expo Go send-during-restore races; receipt recovery after reload on both web previews and iOS; cross-client Undo; old-night deep links on desktop/mobile web and native in-app notice navigation; native background/resume; stale bulk confirmation on desktop/iOS; and native plus desktop stale question/approval submissions while a held database transaction advanced the displayed waiting ID. The newer card stayed waiting; stopped fixtures had no apply receipt. The approval fixture used an empty plan, while backend regressions cover real staged writes and saved scopes. Screenshots are in [evidence/r1-r10](./evidence/r1-r10/). The stale-card screenshots preceded the final conflict wording cleanup; final backend message behavior is covered by the 41-test batch.

**Local acceptance is complete for these repairs.** No production deployment, real provider call, real OS push arrival, Android native interaction, installed-app universal-link launch or production load claim is made. iOS interaction was verified in Expo Go 57 on an iPhone 17 Pro / iOS 26.5 simulator. The in-app browser's mobile web confirmation timed out; the native confirmation route and desktop confirmation route were verified independently. These are verification limits, not claims that every original proposed test combination or every device has been exercised.

## Original review baseline — scope and evidence

This expands the initial R1/R5 review across **all ten durable-assistant requirements**: continuity, queueing, checkpoints, recovery, away notices, preferences, night execution, morning results, reminders, and decisions. The comparison contains 137 changed files (12,649 additions and 749 deletions), including tests and documentation. Findings below trace interactions with unchanged authorization, scheduling, planner, and comment code where relevant. This is a static review of this feature set, not a claim that every defect in the entire Orbyn repository has been discovered.

- Reviewed implementation: `runs/review` and `runs/durable` at `f1df5e474438cd5e4d5fb828b14901ea7e65c518`.
- Review checkout: `/Users/anhdang/Documents/Github/orbyn-wt/runs-review` (initially clean; the final status also contained an untracked Android `.gradle/` directory, which this review did not create or alter).
- Comparison base and primary checkout: `main` at `b32257cc285178787579504dfbfdcdfa3b061127`.
- The supplied line numbers match the review branch. In particular, `agent/notices.ts` does **not** exist on this `main`; these findings must not be described as confirmed deployed defects.
- Evidence: source inspection, local Git history/diff, existing test-source inspection, caller/callee tracing. No application, tests, database fixtures, provider requests, or push delivery were run for this review.
- “Confirmed” below means the source admits the described sequence, not that the sequence was reproduced at runtime. Severity describes potential user impact, not observed incident frequency.
- The earlier [delivery verification report](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/docs/runs-durable-verification.md) records passing checks. Those are prior claims, not checks repeated here; their existence does not cover the additional scenarios below.

All code links below refer to the review checkout and the commit above. Line references may move after implementation. Those links remain review-baseline evidence; implementation changes are tracked in the ledger above.

## Full feature coverage and priorities

The first twelve findings are retained below; F13–F24 are the broader review. **Source-confirmed behavior is not runtime reproduction.** F15, F20, F23 and F24 also call out a product-contract decision; do not count those decisions as independently proven incidents.

| Requirement        | Surfaces inspected                                                                                                                                      | Findings / remaining evidence                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| R1 continuity      | Both hooks, saved chats, routes, polling/client contracts, navigation and persisted mobile session                                                      | F02–03, F07, F10–12. Native lifecycle still needs runtime verification.                                        |
| R2 durable queue   | Enqueue transactions, runner claims, leases, app/worker startup and configuration, migration 181                                                        | F11–12. Eight slots are per runner process, not a deployment-wide cap.                                         |
| R3 checkpoints     | Lead/tool-loop saves, specialist report reuse, envelope serialization, apply receipts, migrations 181–182                                               | F13. Interrupted specialist conversations restart; only completed reports are reused.                          |
| R4 recovery        | Expired leases, retry exhaustion, waiting states, Stop, shutdown, sweeper retention, process-test source                                                | F14, F24. Proposed fault boundaries below supplement existing crash tests.                                     |
| R5 notices         | Insert, deduplication, delivery staleness, inbox reads, live refresh, migration 183                                                                     | F01, F04–06, F08–09. Push arrival and database load are unmeasured.                                            |
| R6 preferences     | Schemas/defaults, first-party settings routes, both settings screens, Tonight handoff, migrations 184–185                                               | F15–16. Changes to settings during queued/running work need an explicit policy.                                |
| R7 night work      | Window/DST calculation, saved candidate list, claims, ordinary worker handoff, trust/write gates, token accounting, migration 186                       | F13–16, F18, F24. No demonstrated bypass of the inspected unattended destructive/outside-effect review guards. |
| R8 morning results | Digest/Home projections, notices, delivery, both Overnight screens and links, retention, migration 189                                                  | F17, F21, F24, plus F04/F06. Historical snapshot access needs a defined visibility policy.                     |
| R9 reminders       | Candidate queries, delivery revalidation, Stop, quiet/cap logic, both cards/settings, shared actions, habit/goal/study APIs, migrations 187–188/190–191 | F18–19, F22–23. Calendar exam identity and habit versions were examined; no migration/runtime pass is claimed. |
| R10 decisions      | Owner-only routes, selected proposal steps, activity Undo, bulk transactions, both confirmation flows                                                   | F02, F17, F20. Existing rollback/dependency tests do not establish rendered-set consent.                       |

**Recommended first work:** authorization/privacy (F04/F07/F17/F18), decision identity (F02/F20), and durable transaction/replay boundaries (F11–14). Correct notification ownership F01 before enabling unattended night work. Then address scheduler liveness, client races and reminder Undo. Performance work follows correctness, with measurements.

## Review of Claude's six findings

| ID  | Priority | Verdict                       | What needs correcting or extending                                                                                                                                                                                                       |
| --- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | High     | Confirmed with qualifications | Automation transitions can create personal-chat pushes after the 30-second threshold. Not literally every run. Reminder nudges are a separate path; duplicate task-completion pushes through `agents/service.ts` were not substantiated. |
| F02 | High     | Confirmed                     | The server checks a server-fetched approval ID, not the ID displayed on the submitting device. Overnight also omits the displayed waiting ID.                                                                                            |
| F03 | High     | Confirmed                     | Restoration can replace a newly sent message, an unsent draft, scope, and poll ownership on both clients. Durable deletion of the message is not established.                                                                            |
| F04 | High     | Confirmed and broader         | Project visibility is missing at notification creation, delivery, and inbox reads. “No data leaks” is not a supportable conclusion.                                                                                                      |
| F05 | Medium   | Confirmed                     | Every successful owner poll writes the job row, including waiting/terminal jobs. Lock/load impact is plausible but not measured.                                                                                                         |
| F06 | Low      | Confirmed                     | No notification-specific live announcement. Automatic refresh normally bounds foreground staleness to roughly 30 seconds plus request time; it is not necessarily a manual-refresh-only failure.                                         |

Related findings: **F07** job-result visibility mismatch; **F08** no delayed away-notice reconsideration; **F09** obsolete queued waiting pushes; **F10** stale action responses update a different chat; **F11** duplicate jobs for retried turns/concurrent chat submissions; **F12** persisted turn and queue insertion are not atomic.

## Findings, evidence, and acceptance criteria

### F01 — Automation transitions use the personal away-notice path

**High · introduced by R5 · confirmed from source.**

[notices.ts:10](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/notices.ts:10) joins the owning chat/user and fans out to an in-app row and every registered push destination. Its eligibility condition is only job identity and `coalesce(last_polled_at, created_at) < now() - interval '30 seconds'`. It has no origin or automation predicate. Calls occur in [finishJob:624](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:624), [waitFor:982](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:982), [failJob:1200](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:1200), and [recovery failure:2032](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:2032).

Automation creation at [run.ts:826](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:826) persists idea/goal/routine/task/night origins and requests. A never-polled automation older than 30 seconds becomes eligible at its next transition. Night work can therefore send multiple immediate notices before the separate [morning notice](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/overnight-notices.ts:6). The delivery worker's quiet-hours deferral is specific to reminder nudges, not these assistant notices. Ideas are excluded by [listAiChats](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/chats.ts:407), but `readAiChat` does not exclude their origin, so a notice can expose a normally hidden idea chat.

**Qualifications:** Runs finishing within 30 seconds, recently polled jobs, disabled users, and users without push devices do not all produce phone pushes. A queued push is not proof of OS delivery. Reminder nudges use [their own insert and announcement](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/reminder-nudges.ts:151), not an assistant job. `finishTask` writes an item update and live event; its inspected path does not call `noticeAgentEvent`. Do not claim duplicate task-completion pushes without a separate reproducer.

**Proposed direction:** Decide notification ownership per **run**, then enforce it consistently for done, failed, waiting, and recovery. Preserve the intended morning summary and dedicated reminder lane.

**Why the suggested one-liners are insufficient:** `finishJob`, `failJob`, and recovery clear `run_state` before calling the notifier. Checking `j.run_state->'request'->'automation' IS NULL` there would admit completed automation jobs. Also, a human can continue a goal/routine/task chat whose stored `origin` stays unchanged; `c.origin = 'person'` would suppress those human follow-ups. Prefer durable run-level provenance, or passing reliable request provenance on every transition, including recovery. Define legacy-job behavior explicitly.

**Acceptance:** Exercise every automation kind at waiting/done/failed, before and after 30 seconds; verify no personal away notice. Verify a human follow-up in an automation-origin chat follows the chosen policy. Verify one morning notice, dedicated reminder behavior, multiple devices, and replay deduplication.

### F02 — A response is not bound to the card the person saw

**High · underlying contract defect also present on main; R1 increases exposure.**

[Input schemas:50](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:50) accept only answer or approved/scope. [Shared client:3548](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/packages/api-client/src/client.ts:3548) sends no waiting ID. [Question handling:1729](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:1729) consumes whichever person question is waiting when the transaction locks the job. [Approval handling:1798](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:1798) first reads the current card, then compares that server-read ID inside its claim transaction.

**Sequence:** Device A answers card 1; the run produces card 2 of the same kind; device B submits its still-visible card 1. The server reads card 2 and accepts B's answer/approval against it. The existing approval guard protects against changes between the server's own read and lock, not between UI rendering and submission. Declines are affected too. An `always` approval can additionally persist consent for the wrong selected change kinds.

**Wider surface:** [Overnight projection:163](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/assistant-workspace/overnight.ts:163) drops waiting IDs; [OvernightRun](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/packages/core/src/overnight.ts:5) has no ID in question/approval. Desktop Overnight and mobile Overnight call the same answer/approve methods. Fixing only the chat hooks leaves another stale-card route.

**Proposed direction:** Require the displayed `waiting_id` in both payloads, check owner, waiting kind and ID under the job lock before consuming the response or persisting approval scope. Include IDs in Overnight contracts and every consumer. Return a clear 409 on stale cards and refresh the displayed job. Do not silently re-submit against a newly fetched ID.

**Acceptance:** Two-device card-1/card-2 races for answers, approve, decline, and remembered scopes; duplicate same-card submissions; wrong-kind IDs; cross-owner IDs; malformed/missing IDs; both chat and Overnight on both platforms. Stale requests must change neither the job nor remembered permissions. Define whether identical retries get an idempotent receipt or 409.

### F03 — Restoration overwrites newer user work and loses poll ownership

**High · confirmed on desktop and mobile.**

[Desktop openChat:513](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/hooks/useAssistant.ts:513) and [mobile openChat:486](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/hooks/useAssistant.ts:486) clear the chat and fetch/retry while the composer is available. [Desktop ask:295](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/hooks/useAssistant.ts:295) and [mobile ask:293](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/hooks/useAssistant.ts:293) capture but do not advance the generation. A late restore still passes its generation check, replaces turns/scope/chat ID, clears the composer, and assigns a new poll without aborting an intervening poll.

**Sequence:** Delay opening A; send a new message while the empty screen is shown; resolve A with an active job. Both polls can then update the same screen, and either completion can clear the other's run state. Even without Send, `setMessage("")` discards a draft typed during loading. Desktop `draftProject` has the same unchanged-generation exposure. “Message lost” means local display/draft loss; a submitted message may still exist in its separately created saved chat.

**Proposed direction:** Give restore/send/draft/navigation explicit operation ownership. Choose whether composition during restoration is blocked or treated as a new conversation that invalidates restoration. Preserve unsent text. Abort the previous poll before replacing it, and guard progress/result/finally mutations by operation, chat, and controller identity. Make restore retry waits cancellable and show retry state rather than an unexplained blank screen.

**Acceptance:** Delayed success, 429, 5xx, and offline restore; type-only, Send, desktop Draft project, second chat selection, scope change, sign-out, unmount; A with and without an active job. At most one owned poll; no old result clears a newer draft, scope, message, or progress.

### F04 — Notification visibility is weaker than saved-chat visibility

**High · privacy boundary mismatch, not proven cross-account disclosure.**

The [saved-chat predicate](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/chats.ts:30) requires current project visibility and `NOT assistant_off`. The [notice insert](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/notices.ts:10) does neither and copies `c.title` into the notification body. [assistantNoticeStale:191](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/delivery.ts:191) rechecks chat ownership and account status only. [listNotifications:11](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/notifications/service.ts:11) allows null-item notices without a chat/project check.

**Sequence:** A project chat becomes inaccessible or its project is kept out of AI. A later run transition creates a notice, or an earlier queued push is delivered after the change. The title is still readable in the inbox/push although `readAiChat` returns 404. Previously inserted in-app rows remain readable even if creation is fixed. Assistant-off is an AI exclusion rule, distinct from membership revocation; both must match the intended product contract.

**Proposed direction:** Reuse an explicit owner/project/assistant-visibility policy at creation, delivery, and inbox read. Account for scoped tasks whose relationship changes, deleted sources, and generic chats that reference sources as a follow-up policy question. Do not assume `item_id = NULL` means no authorization is required. Make queued legacy rows subject to the new delivery gate.

**Acceptance:** Revoke membership or toggle assistant-off before enqueue, between enqueue and delivery, and after an in-app insert; restore access; delete chat/project; disable account; change device ownership. Hidden title/body must not be returned or newly pushed. Already delivered OS notifications cannot be recalled by a database predicate.

### F05 — Polling performs an unconditional primary-database update

**Medium · new write amplification; runtime cost unmeasured.**

[GET /ai/chat/:id:343](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/routes.ts:343) updates `last_polled_at` and returns the job in one statement. [Client polling:3467](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/packages/api-client/src/client.ts:3467) grows to a four-second interval, with a two-hour waiting cap. This is about 15 updates/minute/client, or 1,800 in two hours, ignoring initial ramp, network latency and retries. More open clients multiply it. Writes share the job row with runner/decision transactions; impact depends on load and lock duration.

**Proposed direction:** Throttle timestamp updates (for example ten seconds) and return a fresh authorized read when no update occurs. An empty throttled UPDATE result must not become a false 404. Keep presence semantics safely below the away threshold. Throttling reduces writes but does not guarantee no lock waits when an update is due. Redis is a possible later architecture choice, not a prerequisite for this repair.

**Related retry detail:** 429 handling uses a fixed ten-second pause plus the ordinary polling delay and ignores `Retry-After`. Polling retries are deadline-bounded; `openChat` retries are not time-bounded while generation remains current. Decide a common retry policy, preserve abortability, and expose retry metadata if the current error contract lacks it.

**Acceptance:** Multiple clients polling one waiting job: measure timestamp-write frequency; verify results remain fresh and authorization enforced; exercise locked job rows and ownership failures; cover numeric/date Retry-After if supported, outage deadlines, and Stop during backoff.

### F06 — Inserted assistant notices have no reliable live invalidation

**Low · confirmed; usually delayed freshness rather than permanent absence.**

`notifyAssistantAway` never announces. [noticeAgentEvent:213](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/agents/service.ts:213) provides the comparison pattern. [queueOvernightNotices](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/overnight-notices.ts:6) also inserts in-app notices without its own announcement. Other incidental events can refresh clients, so the symptom is path-dependent.

[Desktop planner:145](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/hooks/usePlanner.ts:145) and [mobile planner:296](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/hooks/usePlanner.ts:296) normally refresh active clients every 30 seconds; mobile also refreshes when receiving a push or returning to foreground.

**Proposed direction:** Announce an owner-only change in the same transaction when new in-app rows are inserted; use PostgreSQL transactional notification behavior so rollback cannot announce nonexistent data. Avoid unnecessary announcements for a deduplication no-op, and cover the morning notice path too.

**Acceptance:** A connected client on another screen learns of a new notice without periodic refresh; replay/rollback/zero-insert cases; no cross-user delivery.

### F07 — A known job ID remains readable after its chat becomes hidden

**High · related privacy gap; owner-only polling predates this branch.**

[GET /ai/jobs/active:193](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/routes.ts:193) and `readAiChat` check project visibility. The individual [job GET:343](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/routes.ts:343) checks only job owner. It returns waiting questions/plans, result answers/proposals/trace, or errors without rechecking chat visibility.

**Sequence:** Retain an owned job ID, revoke project membership or set assistant-off, then poll that ID. The route can return stored content while the saved-chat route refuses it. This does not establish access to another user's job or arbitrary projects. It does establish inconsistent current-access enforcement.

**Proposed direction:** Apply the same visibility contract to direct job reads and audit answer/approve/stop eligibility against it. Approval execution has additional principal/capability checks, so this review does not claim arbitrary unauthorized writes. Resolve legacy jobs without a linked chat explicitly rather than accidentally granting or denying them.

**Acceptance:** Owned known job after access loss in queued/running/waiting/done/failed states; no content-bearing fallback or timestamp write before authorization; cross-owner requests remain denied. Test reconnecting polls and old job URLs, not just discovery APIs.

### F08 — A recently disconnected person can miss an away notice entirely

**Medium · confirmed control flow; exact desired grace-period behavior needs agreement.**

The notifier is called at transitions only and suppresses notices when the last poll/creation is less than 30 seconds old. There is no delayed reconsideration call among the inspected notifier callers.

**Sequence:** Last poll at t=0, disconnect at t=1, run waits or completes at t=10. The transition suppresses the notice. At t=31 the person is away, but no transition occurs to retry the decision. A waiting card can therefore stay quiet; a later distinct reminder mechanism is not equivalent to delivering the original away event. Fast runs with no poll also fall into the creation-time grace period.

**Proposed direction:** Decide whether the requirement is “away at transition” or “unseen after a grace period.” Recommend a persisted delayed candidate evaluated after the grace period, canceled by viewing/answering or loss of eligibility. Distinguish seeing a chat from merely background polling it. Reuse event keys for restart-safe deduplication.

**Acceptance:** Disconnect just before completion/wait; reconnect within and after grace; no devices; process restart during delay; ensure one eligible notice and no notice for a resolved card.

### F09 — Queued waiting pushes remain valid after the card is resolved

**Medium · confirmed.**

The notification reference includes job/event/waiting ID, but [assistantNoticeStale](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/delivery.ts:191) examines only the chat/night portion. It never compares the waiting ID with the current job/card.

**Sequence:** Queue “needs your answer”; delivery is delayed or fails once; the person answers on another device; the retry later pushes the obsolete message. A subsequent card can compound the confusion. Event deduplication prevents duplicate rows for one event, not obsolete delivery.

**Proposed direction:** Parse/validate event references or persist structured event metadata. Before sending a waiting push, require the same job and same active waiting ID, plus current visibility. Define the treatment of superseded done/failed notices and resumed activity separately. Decide whether obsolete in-app entries are retained as history or marked resolved.

**Acceptance:** Answer/decline/Stop/expiry/new card between enqueue and send; push retries; deleted job; malformed/legacy references; morning notices remain a distinct policy.

### F10 — Late Answer/Approve/Stop responses can change the newly opened chat

**Medium · adjacent client race, separate from server card identity.**

[Desktop handlers:354](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/hooks/useAssistant.ts:354) and [mobile handlers:352](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/hooks/useAssistant.ts:352) capture `runProgress`, await the HTTP action, then append a user answer or set run progress/thinking without a generation/chat check.

**Sequence:** Submit an action for A, navigate to B or reset the session while the request is in flight, then resolve A's request. Its response can show A's answer/status in B. Server execution still targets A's job; this is not evidence of server changes to B. Poll callbacks can also outrun the action response within the same chat and be replaced by its older “running” state.

**Proposed direction:** Guard action response writes using operation/chat/job identity, invalidate them on navigation/session changes, and avoid overwriting a newer observed job state. Keep acceptance on the server independent of whether the originating UI remains mounted.

**Acceptance:** Deferred answer/approve/decline/Stop responses across navigation, sign-out and newer poll results on desktop/mobile; busy controls alone must not be the correctness mechanism.

### F11 — Retrying a saved turn can enqueue a second independent job

**High · adjacent durable-submission gap; effect duplication is conditional.**

[beginChatTurn:232](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/chats.ts:232) deduplicates the user turn by `turn_id`. [startChat:308](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/routes.ts:308) then always inserts a new job. [Migration 181](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/migrations/181_durable_assistant_jobs.sql:1) has nonunique chat/queue indexes and no uniqueness constraint for user/chat/turn; the inspected migration set has no such constraint elsewhere.

**Sequence:** Repeat the same start payload after a lost response, or concurrently. One durable user turn can have two jobs. Job-level apply receipts and `assistant-${jobId}` references cannot deduplicate work across different job IDs. Duplicate model work and competing answers are possible; duplicate domain effects depend on tools and their own idempotency checks. Different devices can also submit distinct turns concurrently to one chat; discovery currently returns only the newest active job.

**Proposed direction:** Make turn submission idempotent and return the existing job for a repeated user/chat/turn identity. Bind that identity to compatible request content. Separately decide whether one chat serializes active turns or supports a visible queue. Do not confuse per-job worker leasing with per-chat serialization.

**Acceptance:** Simultaneous identical POSTs, lost 202 response/retry, changed payload with the same turn ID, distinct concurrent turns, process restart and legacy duplicate rows. One logical submission must produce one job/effect sequence; any permitted multiple active turns must all be discoverable.

### F12 — Saving the user turn and enqueueing its job are separate commits

**Medium · adjacent durable-submission failure window.**

[prepareChatTurn:162](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/routes.ts:162) awaits `beginChatTurn`, which uses its own transaction when no shared database handle is passed. `startChat` subsequently inserts the job through `pool.query`.

**Sequence:** The turn commits, then the process stops or the job INSERT fails. Reopening shows the saved message with no job to resume. Recovery scans jobs and cannot recover a job never inserted. This is a crash/failure-window argument, not a claim that a 202 was returned before enqueueing.

**Proposed direction:** Commit durable turn creation and queue creation/reuse together, using the same transaction and the F11 identity rules. Keep provider calls out of that transaction.

**Acceptance:** Fault injection between turn creation and queue insertion; rollback must leave neither a new orphan turn nor a runnable job without its turn. Successful commit followed by lost response must be recoverable through F11 retry semantics.

## Additional findings across R2–R10

### F13 — A completed delegation can run again after a crash

**High · R3/R4 · source-confirmed crash window.**

[lead.ts:376](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/lead.ts:376) deletes `pending_delegate` and checkpoints after adding reports and staged steps. The delegate tool reply is only appended and checkpointed later by [loop.ts:403](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/loop.ts:403). Recovery at [loop.ts:424](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/loop.ts:424) replays assistant calls with no saved tool reply.

**Sequence:** Kill after the lead's aggregation checkpoint but before the tool-reply checkpoint. The saved state contains completed reports/plan entries, no pending delegation, and an unanswered delegate call. Replay treats it as a new delegation, increments specialist counters, generates new task IDs and can stage the same intended work again. Budget/duplicate-call guards may instead reject the replay, losing the tool's completed answer. The apply receipt protects repeated application of one plan; it does not deduplicate semantic steps added twice before application.

**Proposed direction:** Persist a completed delegate receipt keyed by tool-call ID until the loop has durably consumed it, or atomically save aggregate state and its tool reply. Keep completed reports reusable throughout that handoff.

**Acceptance:** Kill immediately before/after each report save, aggregate save, and tool-reply save. Each specialist result contributes once, budget counters remain consistent, and no duplicate logical writes reach the applied plan. Inspect the actual saved checkpoint, not only final job status.

### F14 — Parking a job and publishing its waiting state are separate commits

**Medium · R4/R7/R8 · source-confirmed crash window.**

[waitFor:932](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/run.ts:932) commits `state='waiting'` and releases the lease before `markTask`, chat transcript insertion, notice insertion and `recordNightRun` in a later transaction. A process loss or database error between these operations leaves a parked job whose task, transcript, night summary or budget ledger was never updated. Runner claims exclude waiting jobs; ordinary expired-running recovery will not replay these missing effects. Polling can still return the waiting card, so this is not total loss of the question.

**Proposed direction:** Commit the waiting transition and durable projections together, or retain a replayable transition/outbox record with idempotent consumers. Waiting-state recovery must reconcile all required projections.

**Acceptance:** Inject failure after each boundary; after restart, exactly one waiting transcript/event appears, task status is needs-you, and the night ledger reflects the parked run. Answering while reconciliation occurs must not resurrect an obsolete card.

### F15 — Night-shift ownership can leave routines and goals with no scheduler

**Medium–high · R6/R7 · confirmed behavior; intended fallback policy needs review.**

[nightShiftOwns:25](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/assistant-scan.ts:25) tests only `enabled=true`. Ordinary [goal:77](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/assistant-goals.ts:77) and [routine:57](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/assistant-routines.ts:57) scans exclude those users all day. Night candidate generation at [night-shift.ts:134](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/night-shift.ts:134) includes goals/routines only when `follow_through` is enabled.

**Sequence:** Enable Night shift for Study but turn off Follow through. Existing due routines and goal check-ins are picked up by neither scheduler. Even with Follow through on, daytime schedules are deferred to the night; if the person is active throughout that window or a waiting job blocks the queue, they receive no ordinary fallback. Separately, [Tonight handoff:36](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/items/agent.ts:36) accepts Tonight while Night shift is disabled, leaving work queued until the setting changes.

**Proposed direction:** Define ownership per source and occurrence. Recommended: preserve ordinary due scheduling when that source is not enabled for Night shift, and make Tonight's disabled-state behavior explicit in both clients. Do not infer a global pause from selecting unrelated night work.

**Acceptance:** Every combination of enabled/follow-through/handed; daytime and night routine due times; continuous user activity; parked jobs; Tonight with disabled settings. Every queued source has a documented executor or a visible paused explanation.

### F16 — Persisted routine candidates can stall a night or overwrite a newer schedule

**Medium–high · R6/R7 · source-confirmed stale snapshot mismatch.**

[Candidate construction:159](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/night-shift.ts:159) saves instruction and computed next occurrence in the night's candidate list. [available:84](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/night-shift.ts:84) checks only owner, pause and null current job for routines. [claimSource:412](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/night-shift.ts:412) additionally requires the routine to be due and writes the previously calculated `next` without a schedule version check.

**Sequence A:** While an earlier night task runs, move a saved routine to tomorrow. Availability remains true, claim fails because it is no longer due, and the transaction rolls back without advancing the cursor. Subsequent scans retry that same entry and later candidates cannot run. **Sequence B:** Edit its recurrence/instruction but leave it due; the saved old instruction executes and the old computed next occurrence replaces the newly intended schedule. These sequences need no simultaneous worker race.

**Proposed direction:** Re-read and validate the source under its claim lock, recompute occurrence/instruction from current data, and distinguish a no-longer-eligible candidate from a retryable infrastructure error. Skip or refresh stale entries with an explicit leftover reason. Isolate per-person scan failures so one bad entry does not abort the remaining batch.

**Acceptance:** Move due time, edit recurrence/timezone/instruction, pause/delete/take back after candidate persistence; later candidates must continue and updated schedules must survive. Also switch Night shift ownership during an ordinary-worker claim to check handoff races.

### F17 — Overnight returns historical content without current source visibility checks

**High · R8/R10 · source-confirmed authorization mismatch.**

[RUN_SELECT:40](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/assistant-workspace/overnight.ts:40) checks night/job/chat ownership but not current project/source access or assistant-off. [card:137](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/assistant-workspace/overnight.ts:137) returns raw saved title, summary, waiting text and step labels; [latestNight:205](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/assistant-workspace/overnight.ts:205) also returns raw leftover titles. Authorization in individual apply/Undo commands does not redact these read projections.

**Sequence:** Finish or park work containing a team source, then revoke membership or keep that source out of AI. The owner can still retrieve its saved content through Overnight even when the ordinary source or saved scoped chat cannot be read. Night chats are created unscoped, so adding only a chat-project predicate is insufficient. Both clients consume the same projection. No cross-owner read is established.

**Proposed direction:** Record source provenance for saved night outputs and enforce current access when returning summaries, steps, questions, activity and leftovers. Review morning digest/Home copies under the same policy; keyword-based kept-out filtering is not a substitute for membership authorization. Decide how historical copies should behave before migrating existing records.

**Acceptance:** Revoke membership, delete/trash source, toggle assistant-off, and restore access after creation; inspect Overnight, Home, digest, notification and direct job reads. Include unscoped runs combining multiple projects and leftovers that never became jobs.

### F18 — Reminder candidate queries can read team content after membership is lost

**High · R9, related R7 source selection · source-confirmed.**

[Task candidates:193](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/reminder-nudges.ts:193) use `i.user_id=$1` plus assistant-off exclusion, without `visibleItems`. [Promise candidates:226](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/reminder-nudges.ts:226) similarly use assignment/creation identity without `visibleRecords`; goal selection checks kept-out sources but not full current source visibility. These are weaker than the canonical [visibility.ts:47](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/lib/visibility.ts:47) rule, which requires current team membership for team-owned rows even when the user created them.

**Sequence:** Create a team task, leave the team while its `user_id` remains yours, and let it become overdue. Candidate generation can still copy its title into the personal Reminders chat and notification. Revalidation repeats the same candidate query, so repeating it at posting/delivery does not close this gap. Waiting-chat, comment and calendar-source branches already use stronger visibility helpers; the problem is not universal to every reminder kind. Night handed-task/goal selection also deserves the same correction before including raw source titles/notes in automated requests.

**Proposed direction:** Apply the shared source visibility predicates at selection, enqueue, delivery and saved-card reads, including indirect goal/record document relationships. Keep current write authorization in ordinary action endpoints as a separate requirement.

**Acceptance:** Former team creator, assigned promise after membership removal, hidden goal plan, source deletion and assistant-off races. Check generated chat text and in-app/email/push payloads, not only whether an action later returns 404.

### F19 — Reminder Undo can erase an intervening edit

**High · R9 · source-confirmed read/write race.**

[Task booking Undo:84](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/packages/api-client/src/reminder-actions.ts:84) reads sessions and checks unchanged times/outcome, then calls an unversioned delete. [removeSession:230](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/planner/blocks.ts:230) deletes by owner and ID alone. Start or edit that session between the read and DELETE and Undo still removes it. [Routine/goal Undo:179](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/packages/api-client/src/reminder-actions.ts:179) likewise compares `updated_at` in the client before a separate unguarded update. [Comment resolution:231](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/docs/comments.ts:231) has no expected resolution version; Undo can reopen a thread another person subsequently resolved.

**Proposed direction:** Make Undo a server-side compare-and-mutate operation bound to the action's result version/state. Check the condition under the same transaction/row lock as mutation. Preserve task/record version checks and habit optimistic concurrency already present; do not replace those with client-only checks.

**Acceptance:** Pause after the Undo pre-read, perform another device's edit/start/check-in/resolution, then resume Undo. It must return a conflict without removing or reverting the newer work. Include revision-booking deletion and associated sessions in this audit.

### F20 — Bulk decisions include runs that were never in the confirmed view

**High · R10 · confirmed selection race; consent contract must be explicit.**

[Bulk routes:364](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/assistant-workspace/overnight.ts:364) take a night ID and select all currently eligible runs inside the transaction. [Desktop confirmation:70](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/features/assistant/OvernightView.tsx:70) and [mobile confirmation:86](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/screens/OvernightSheet.tsx:86) submit no reviewed run set, proposal revision or snapshot token.

**Sequence:** Open Keep all with run A visible and B still working. B finishes with a held proposal before the request obtains the night lock. The server includes B and can apply its unseen changes. Undo all can likewise include newly finished work. Atomic rollback protects consistency, not consent to the selected set.

**Proposed direction:** Bind the operation to displayed run/proposal identities and expected states, or require a fresh preview token before confirmation. Recommended: reject changed membership with 409 and show the new work; never silently expand the set. If the intended contract really is all eligible work at execution time, make that consequence explicit and review whether it meets the approval requirement.

**Acceptance:** Finish another job during confirmation, expire/change/decline a proposal concurrently, retry after a lost response, and run overlapping bulk/individual operations. Only the confirmed set may be changed; rollback and dependency guarantees must remain intact.

### F21 — A notice for an older night opens the latest night

**Medium · R8/R10 · source-confirmed routing gap.**

[Morning notices:47](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/overnight-notices.ts:47) save `overnight:<night-id>`, but [desktop inbox:320](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/features/notifications/NotificationsView.tsx:320) and [mobile inbox:267](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/screens/InboxScreen.tsx:267) call an ID-less Overnight opener. The [GET route:322](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/assistant-workspace/overnight.ts:322) only exposes latest-night reading. Digest links also use generic `/app/overnight`.

**Sequence:** Leave Monday's notice unread until Tuesday's night record exists. Opening it displays Tuesday, making Monday's questions/held work hard to locate through the intended result surface. This can happen within the proposal review lifetime.

**Proposed direction:** Carry night ID through URL, client navigation and authorized read API. Provide a history selector and a clear expired/deleted state. Preserve latest as an explicit destination.

**Acceptance:** Open old/new notices on desktop and mobile, cold-start deep links, another owner's ID, retained nights with expired proposals, and nights removed by retention.

### F22 — Reminder scans repeatedly recompute the whole candidate set

**Medium · R9 · confirmed query amplification; production cost unmeasured.**

[scanReminderNudges:454](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/reminder-nudges.ts:454) computes all candidates for each eligible user, then calls `postReminderNudge` for each. [postReminderNudge:76](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/reminder-nudges.ts:76) recomputes that entire set before checking daily cap, stopped key and global enabled preference through `canSendReminderNudge`. Candidate discovery includes calendar/Study identity upserts, so it is not purely a read. The scan continues after three sends and also discovers candidates for users whose reminders are disabled.

**Impact:** With N candidates, there are approximately N+1 full candidate computations, including their source scans/upserts. This unnecessarily consumes database work and holds each per-user posting transaction longer. [worker/index.ts:212](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/index.ts:212) awaits the scan in its main loop, so slow scans can delay later worker work. No latency or load figure is claimed.

**Proposed direction:** Gate disabled/capped users early, stop after the cap, separate discovery writes, and revalidate only the selected source under the send lock. Keep the authoritative cap/dedup reservation transactional.

**Acceptance:** Query-count assertions for disabled, capped and high-candidate users; concurrent senders still cap at three; measure scan duration, transaction time and worker backlog with realistic population sizes.

### F23 — Reminder action receipts disappear on reload and do not deduplicate retries

**Medium · R9 · confirmed persistence gap; one-shot action policy needs review.**

[Desktop:32](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/desktop/src/features/assistant/ReminderNudge.tsx:32) and [mobile:32](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/mobile/src/components/ReminderNudge.tsx:32) keep successful action receipts/Undo closures only in component state, except Skip's persisted turn outcome. [performReminderAction:24](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/packages/api-client/src/reminder-actions.ts:24) uses ordinary action endpoints without a reminder-action idempotency key.

**Sequence:** Book succeeds, but the response is lost or the app reloads before the receipt is retained. The same saved card again offers Book; retry can create another free session. The original card's Undo is no longer available after reload or on the other device. Ordinary planner controls may still remove the booking; this is loss of the reminder receipt, not necessarily irreversible data loss.

**Proposed direction:** Persist action identity/result and a version-bound Undo reference. Define whether repeated booking is a new explicit action or retry of the old one; use separate IDs for intentional additional bookings. Project stopped/completed card state from the server.

**Acceptance:** Lost response after commit, reload, unmount, second device, repeated same action, intentional second booking and expired Undo. A retry returns the prior receipt without another mutation.

### F24 — Morning aggregation can finalize before the last job settles

**Medium · R4/R7/R8 · confirmed timing behavior; completion policy needs review.**

[scanNightShift:433](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/night-shift.ts:433) closes elapsed nights and calls the notifier without waiting for active jobs to settle. [queueOvernightNotices:19](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/overnight-notices.ts:19) tests window end, then permanently sets `notified_at` after the snapshot. [Digest projection:200](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/worker/digest.ts:200) can describe queued/running jobs, but the push first line only reports finished/review/question/leftover counts.

**Sequence:** A queued or finishing job remains unsettled at the first post-window scan. The only morning notice is created before its final question, held proposal or failure exists. Later changes update the live view but do not revise that notice. A generic R5 push may currently mask this; fixing F01 makes ownership of late results especially important.

**Proposed direction:** Decide between waiting for terminal/parked reconciliation with a bounded cutoff, or sending a clearly provisional summary and a deduplicated material-update notice. Persist the aggregation state/version; do not merely mark the night done by clock time and assume all results are final.

**Acceptance:** Queue congestion across window end, provider response at the boundary, lease expiry/restart, waiting transition failure F14, and late final proposal. The morning result must accurately communicate outstanding work and provide an eventual route to its final state.

## Evidence gaps and behaviors requiring decisions

These are deliberately separate from the defect list:

- **Specialist durability claim:** The verification report says lead/specialist messages are retained. [runSpecialist invocation:314](/Users/anhdang/Documents/Github/orbyn-wt/runs-review/backend/src/modules/ai/agent/lead.ts:314) supplies no specialist loop checkpoint/resume. Completed reports are retained; an interrupted specialist restarts. Decide whether that satisfies R3, and measure replayed provider work. Do not describe it as exact instruction-level resume.
- **Capacity:** Runner concurrency eight is local to each process. Multiple AI replicas plus worker fallback increase aggregate concurrency. Decide the deployment-wide provider limit before calling the queue bounded globally.
- **Settings changes:** Night enabled/kinds/window/morning-hold are captured at scheduling. Define whether disabling Night shift or turning morning hold on must affect already queued/running jobs. Recheck at execution/apply if immediate revocation is intended.
- **Waiting jobs:** Any active waiting job prevents another nightly candidate from starting. This can last across nights. Define whether that is deliberate serialization or whether unrelated work should proceed. No speculative concurrency fix is approved here.
- **Goals/routine ownership transitions:** Night goal claims use `status <> 'done'`, weaker than ordinary attempt/backoff rules. Normal scans exclude enabled Night-shift users, so an always-on duplicate-worker claim is not established. Test setting switches during an existing claim rather than asserting constant duplication.
- **Budget semantics:** Tokens are estimated, with night accounting updated at recorded transitions. Recovery between provider use and checkpoint can repeat unrecorded work. Establish allowed estimation/replay overshoot before treating the night token cap as a billing guarantee.
- **Exam booking:** The shared reminder action reuses the revision planner, including longer sessions near the exam and its planning horizon. The earlier hypothesis that it only selected one earliest day was rejected on reading the actual planner: it generates sessions across days. Verify that the displayed minutes/date promise matches those semantics.
- **Prior tests:** Existing sources cover owner checks, apply receipts, several process kills, DST, caps, hidden projects, partial Undo and bulk rollback. They do not by themselves establish the exact F13/F14/F19/F20 interleavings. No test suite, build, typecheck, migration, native UI session or live delivery was executed in this review.

## Proposed implementation plan for approval

This is the original proposed sequence, now implemented as recorded above. Its acceptance checklist remains the review baseline; completion evidence and unresolved checks are stated in the ledger.

| Order | Package                            | Findings                     | Concrete deliverable                                                                                                                                      |
| ----- | ---------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Visibility policy                  | F04, F07, F17, F18           | Shared source authorization across chat/job/Overnight/reminder/inbox/enqueue/delivery, with provenance and historical-data policy.                        |
| 2     | Decision identity                  | F02, F20                     | Waiting IDs and reviewed bulk sets across backend/shared client/both chat and Overnight clients, transaction guards, stale-state UX and rollout contract. |
| 3     | Client operation ownership         | F03, F10                     | Restore/send/draft/action/poll ownership rules implemented identically on desktop and mobile, draft preservation, cancelable retries.                     |
| 4     | Durable transitions                | F11–14                       | Atomic turn/job creation, submission identity, delegate receipts, atomic/replayable waiting projections and fault-boundary verification.                  |
| 5     | Scheduler ownership and freshness  | F15, F16                     | Per-source scheduler contract, current routine claims, edited candidate handling, disabled Tonight UX and per-person failure isolation.                   |
| 6     | Reminder action safety             | F19, F23                     | Server-atomic Undo conditions, durable action receipts/idempotency and restored card state across both clients.                                           |
| 7     | Notification and morning lifecycle | F01, F06, F08, F09, F21, F24 | Run provenance, lane ownership, obsolete-card cancellation, live invalidation, final/provisional morning semantics and historical night navigation.       |
| 8     | Poll and scan efficiency           | F05, F22                     | Throttled polling writes, targeted reminder revalidation, cap short-circuits, coordinated retry and measured load/lock evidence.                          |

High-priority safety packages can be delivered incrementally, but do not declare R1–R10 ready while a stale decision can authorize unseen work, restricted content remains readable, or replay can duplicate completed delegation. Resolve F01 before enabling night runs for real users. Avoid swallowing all notifier errors inside job transactions as a shortcut: that can silently lose required notices; any decoupling should retain a durable delivery record. Each package should be independently reviewable with its contract, data migration/backfill implications, changed-file list and proposed verification evidence before implementation is approved.

### Product and rollout decisions to review

1. **Run provenance:** Recommended: personal away notices belong to human-submitted runs, even when their chat originated from automation. Night uses the morning summary; each other automation lane needs an explicit result/attention surface so suppressing generic pushes does not strand actionable work.
2. **Presence:** Recommended: an unseen result gets a grace period, then one notice; a background open tab should not automatically mean the person saw it. Exact foreground/view acknowledgment behavior needs a contract.
3. **Restoring UI:** Recommended: show restoring/retrying state and preserve drafts; if Send is allowed, it explicitly supersedes restoration. Both choices require operation guards.
4. **Concurrent turns:** Recommended: one active run per chat with a clear conflict or visible queue. Repeated identical turn IDs return the existing job. A hidden second run is unacceptable.
5. **Old clients:** Missing waiting IDs must fail closed; inferring the latest ID recreates F02. Stage support for sending IDs before enforcing them, or require a client update. Account for already-open web tabs and mobile versions. Overnight IDs must ship with this transition.
6. **Existing data:** Define provenance for legacy jobs, deduplicate existing submissions before adding uniqueness, and re-evaluate queued assistant pushes. Decide whether stale in-app rows should be hidden or resolved. No cleanup should delete evidence before the migration plan is reviewed.
7. **Authorization semantics:** Agree that job reads and notices follow current saved-chat access, including assistant-off. Separately define source-level redaction for unscoped chats; this review has not proved that project-only filtering covers every historical reference.
8. **Scheduler ownership:** Decide which routine occurrences move into Night shift, what happens with Follow through off, whether waiting questions block unrelated work, and how Tonight behaves when disabled. Preserve existing schedules unless migration is explicit.
9. **Bulk consent:** Recommended: only displayed and version-matched runs/proposals belong to Keep all/Undo all; refresh and reconfirm if the set changes.
10. **Durable reminders:** Recommended: preserve receipts/Undo references across reloads; distinguish retries from intentional additional bookings. A local UI success flag cannot define cross-device action identity.
11. **Morning completion:** Choose bounded finalization or provisional-with-update behavior, and keep old-night navigation available through the retained review period.
12. **Limits and revocation:** Define global concurrency, acceptable estimated-token overshoot, interrupted-specialist restart semantics, and whether setting changes revoke already queued work. These contracts determine the correct implementation and checks.

### Verification required after implementation

This is the original acceptance checklist. Consult the implementation ledger for checks actually run and remaining gaps.

- Backend: deterministic state-transition and concurrent-transaction tests for the exact sequences above. Cover 401/403-or-owner-safe-404/400-or-contract-appropriate-validation/409/429, live event rollback, deduplication, visibility revocation, and queue failure boundaries. Mock provider/push integrations; use isolated database fixtures for lock/transaction assertions where necessary.
- Shared client: response freshness, Retry-After/backoff, deadlines and cancellation, missing/stale waiting IDs, lost-response retry identity. Do not equate mocked request counts with production database performance.
- Desktop and native mobile: deferred restore and action requests; two-device approval/question progression; navigation during polling; draft preservation; client reload while queued/waiting; notifications opening only accessible chats. A mobile web rendering check does not establish native lifecycle correctness.
- Notification matrix: human vs all automation kinds, done/failed/waiting, foreground/background/disconnected, one/multiple devices, age below/above threshold, membership/assistant-off changes before and after enqueue, resolved waiting card, push retry, restart, morning aggregation, reminder quiet hours.
- Performance: report update counts per job under multiple pollers, query latency, lock waits, and behavior when the runner holds the row. Set an acceptance target before optimizing beyond throttling.
- Recovery: deterministic kill/failure injection around delegate aggregation/tool-reply persistence, waiting projection commits, receipt commits and night-window closure. Verify stored identities, exactly-once logical steps, ledger reconciliation and later candidate progress.
- Scheduling: saved-candidate edits, setting switches during claims, daytime due routines, Follow through off, Tonight disabled, stale waiting jobs, per-person scanner failures, timezone/DST changes and source removal. Assert which executor owns every occurrence.
- Overnight: confirmed-set races, old-night links, source visibility changes, expired proposals, concurrent Keep/Undo, partial dependent steps and a job finishing after the morning summary.
- Reminder actions: lost-response/reload/two-device receipts, server-side Undo conflicts after a pre-read, completed/removed sources, exam date/duration semantics and goal deadline booking. Test disabled/capped scan query counts and realistic backlog separately from mutation correctness.
- Complete appropriate shared-package build/typecheck and focused tests after code changes; then broader regression checks for durable recovery, Overnight decisions, and reminder delivery. Report exact final commit and which checks actually ran. OS push arrival requires separate controlled evidence; queue rows or mocked Expo responses do not establish it.

## Limits and release recommendation

Do not adopt the claim “six real bugs and no data leaks” unchanged. This expanded register has **24 findings/risks across R1–R10**, with product-policy qualifications stated individually. F04/F07/F17/F18 concern continued exposure after access restrictions; owner identity is not enough to establish current source access. No cross-account exploit or production incident is claimed. The count is an issue register, not a claim of 24 independently reproduced bugs or an exhaustive security certification.

The original static review performed no fixes, tests, deployments, live-data mutations, or notification sends. Implementation is authorized and the 24 finding areas are patched and locally verified; the ledger above records observed checks and their limits. Recheck this report against any newer branch revision before applying it. Remaining runtime and requirement uncertainties are listed explicitly so that review approval does not silently become acceptance of unverified behavior.

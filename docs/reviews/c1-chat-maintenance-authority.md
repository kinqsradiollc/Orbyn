# C1 chat maintenance provider authority

8 October 2026. Qualified checkpoint `a5d2274f`, merged and pushed to main.
Built from main `6351e48a` on `codex/c1-chat-maintenance-authority`. This checkpoint belongs to the first remaining C1
entrypoint/recovery gate. It does not complete C1 or start C2.

## Finding and scope

The old Memory worker and old-chat compactor resolved one workspace provider for
an entire batch. They ignored an owner's captured personal-provider choice.
Two inert reproduction checks fail before the repair: a ChatGPT-only owner,
without fallback consent, still reaches the workspace completion callback.
No vendor request or production database was used.

## Candidate behavior

| Area | Behavior |
| --- | --- |
| Capture | New Memory queue entries and chat compactions create version6 background jobs with immutable owner choice and managed-provider/model snapshots; no provider credentials enter these jobs. |
| Personal model | Capture the private model preference and revision; reject changes before dispatch, publication and derived writes. Signed replies use the existing private executor broker. |
| Source | Check live ownership, disabled status, visibility and AI exclusions before disclosure and commit. Appended chat turns preserve earlier Memory authority; edits/removals of the captured prefix reject it. Compaction requires an unchanged old, unpinned source. |
| Fallback | Only the user's captured explicit fallback consent allows workspace generation. Preserve actual provider/model/fallback provenance and measured managed/private usage separation. |
| Recovery | Encrypt completed output for write retries. Unknown completion is not replayed. Confirmed invalid JSON receives a new operation identity with the existing bounded retry limit and the same captured recipient. |
| Lease | Finish/release require the exact worker claim. Job UPDATE locks precede maintenance snapshot SHARE locks, preventing the reproduced private-poll lock upgrade deadlock. |
| Deployment | Stop the old notifier before migration; start only its updated image afterward. A failed stop aborts migration. Queued work stays in PostgreSQL. |
| Re-entry | Reopening or pinning a chat revokes compaction without consuming a failure attempt; settle the old maintenance job. |
| Offline | Undisclosed calls wait for the selected personal executor without consuming failure attempts or switching provider. |
| Forget/retention | Removing a pending Memory source settles its maintenance job. Retention preserves job identity while a queue or unswept chat depends on it, preventing a new automatic call after receipt deletion. |
| Legacy | Existing Memory backlog has no recoverable enqueue-time authority and cannot adopt today's provider. A fresh personal turn captures new authority. |

Memory and Agent notes retain their existing output shapes. No client layout,
connection flow, plan entitlement or live-provider certification is changed or
claimed. The broader C1 client/provider matrix remains open.

## Qualification

| Check | Result |
| --- | --- |
| Before reproduction | 0/2 pass; both unintended managed callbacks reproduced |
| Corrected maintenance/private/provider/worker/deployment cohort | 103/103 pass; no failures, skips or cancellations; exit0, signal:null |
| Actual migration258 upgrade and idempotence | 1/1 pass in a fresh marked database; legacy authority preserved, old writer makes progress under actual schema locking |
| Backend types | Pass, terminal exit0 |
| Backend build | Pass, terminal exit0 |
| Frozen f5445544 full regression | Failed at existing chat re-entry assertion; stopped the owned run, exit1, no final TAP summary |
| Corrected frozen a5d2274f full regression | 4286/4286 pass; exit0, signal:null, zero failures/skips/cancellations; 821581ms |
| Main delivery | Fast-forwarded and pushed as a5d2274f; unrelated primary changes preserved |

During development, focused runs exposed a bigint preference comparison, invalid
job cancellation state, source-deletion cleanup and a SHARE-to-UPDATE deadlock.
The corrected focused source resolves them. The f5445544 full run then exposed
a reopened chat being counted as a failed compaction attempt. The correction
passes the original worker cohort and two new reopening/pinning checks.
No successful whole-suite result is inferred from these focused results. Earlier partial passes are not acceptance
of the refined candidate.

Local evidence:

- `/tmp/orbyn-c1-housekeeping-authority-before-fixed-harness-20261008.log`
- `/tmp/orbyn-c1-maintenance-authority-full-20261008.log` (failed frozen source)
- `/tmp/orbyn-c1-maintenance-authority-full-terminal-20261008.json`
- `/tmp/orbyn-c1-maintenance-authority-v12-focused-20261008.log`
- `/tmp/orbyn-c1-maintenance-authority-v12-focused-terminal-20261008.json`
- `/tmp/orbyn-c1-maintenance-v12-types-20261008.log`
- `/tmp/orbyn-c1-maintenance-v12-build-20261008.log`
- `/tmp/orbyn-c1-maintenance-authority-upgrade-corrected-v13-focused-20261008.log`
- `/tmp/orbyn-c1-maintenance-authority-upgrade-corrected-v13-focused-terminal-20261008.json`

Database connection details stay in private local files. Previews still use the
previous API build until a deliberate refresh; browser acceptance of this
backend checkpoint is not claimed. Docker is restored, the stock test database
is healthy, and the stopped pgvector fixture is retained for the next embedding
checks. No persistent volumes or unrelated project containers were removed.

QA-031 does not establish 200% text enlargement: the diagnostic was pinch
magnification, and native Codex app control was denied by Computer Use policy.
Its enlarged-text/browser and native acceptance gates stay open. Scoped normal
Settings acceptance on main is unchanged. No alternate access route was used.

Final regression evidence: `/tmp/orbyn-c1-maintenance-authority-corrected-full-20261008.log`
and `/tmp/orbyn-c1-maintenance-authority-corrected-full-terminal-20261008.json`.
The receipt identifies a5d2274f,465 files and a clean source tree. Production
deployment remains user-owned and unconfirmed. The deploy script will stop the
old notifier before applying migration258, then roll out the updated worker.

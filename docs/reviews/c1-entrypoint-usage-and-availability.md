# C1 remaining entrypoint corrections

8 October 2026. Audited a5d2274f; the preceding maintenance authority checkpoint
is qualified and pushed to main. These findings are before-fix evidence. Finish
the usage checkpoint before changing scanner availability.

| Order | Finding | Reproduction | Required correction |
| --- | --- | --- | --- |
| 1 — active | Managed Agenda briefs omit measured usage | Actual local provider returns120 input/20 output tokens and a successful summary; owner has zero managed usage receipts. Existing6 pass, new usage assertion fails. | Attach an owned captured job and observed usage to managed completion while preserving source/choice checks, session requirements for personal calls, and analytics opt-out. |
| 1 — active | Hosted maintained pages omit measured usage | Actual local provider returns210/30 tokens; guarded page update succeeds with zero owner usage receipts. Existing24 pass, new usage assertion fails. | Bind observed usage to the exact page run and captured recipient. Preserve parent cancellation, leases, approval reuse and unknown-completion handling. |
| 2 — queued | Personal automation requires an unrelated workspace provider | All five scanners return0 with configured personal connections and managed selection unset. Each positive control bypassing only availability queues the same work with captured ChatGPT authority. | Resolve eligibility per owner before claims; preserve default-unavailable behavior, paused/disabled/kept-out rules and bounded retries. |

The scanner fixture includes connection, model preference, executor identity,
live lease and catalog. Covered paths: goals, ideas, routines, handed tasks and
Overnight. It does not claim live vendor acceptance.

Evidence:

- /tmp/orbyn-c1-entrypoint-probe-v2-focused-20261008.log:7pass/2fail, including
  the earlier routine eligibility control and managed Agenda usage failure.
- /tmp/orbyn-c1-page-usage-probe-focused-20261008.log:24pass/1fail.
- /tmp/orbyn-c1-personal-scanners-probe-focused-20261008.log:0pass/5fail;
  every eligible positive control succeeded before the expected failure assertion.

All use separate marked local databases and inert provider responses. No vendor
request, production data, billing claim or new private authority is involved.
The usage correction is implemented on the C1 branch; main delivery and full
regression remain pending. Scanner availability is still queued.

Acceptance includes observed and missing counters, owner isolation, analytics
opt-out, failed post-response publication, unchanged authority, explicit fallback,
private usage separation and no duplicate call on approval/recovery. Browser
usage states remain a separate C1 acceptance gate with Orbyn Visual Check.

## Usage candidate qualification

Managed Agenda briefs now use an owned captured job, including default-provider
morning summaries without an interactive session. Personal calls still require a
live session. Hosted page usage belongs to its exact parent run and lease;
completion provenance is recorded in the same transaction as its authority check.
Previously staged output is reused without inventing receipts or repeating calls.

Focused final cohort:125/125 pass, zero failures/skips/cancellations, exit0,
signal:null,53219.721875ms. Evidence:
`/tmp/orbyn-c1-entrypoint-usage-v3-focused-20261008.log` and matching terminal JSON.
It covers missing counters, opt-out, provider rejection, post-response source/model
changes, session revocation, owner separation, explicit fallback, private usage
exclusion, approval reuse and existing lease/recovery behavior. Backend typecheck
and build pass. These are local inert provider fixtures, not vendor acceptance.
Full frozen regression and browser usage-state acceptance are not yet complete.

### Full-run interruption

Frozen candidate c1dde1d3 was launched in a fresh marked database. The runner
terminated with exit1 when writing its terminal JSON failed with ENOSPC. The log
ends after1384 passing checks with no final TAP summary; the child exit/signal was
not persisted and is unknown. This is incomplete qualification, not a full pass.
Evidence: `/tmp/orbyn-c1-entrypoint-usage-full-20261008.log`; tool session56499
contains the ENOSPC failure. No main merge occurred.

Ten earlier completed C1 logs were compressed losslessly, with decompressed
SHA-256 verified before deleting their originals, recovering68005724 bytes.
Archive mapping and hashes: `/tmp/orbyn-c1-compressed-log-index-20261008.json`.
Earlier log paths in this ledger resolve to the same name plus `.gz` when listed
in that index. About280MiB remains free; more headroom is needed before restarting
the full regression. User has been asked to free several GiB.

### Malformed-output review

The hosted-page cohort now explicitly covers invalid JSON and invalid patch
schema after a response carrying observed210/30 counters. Both leave the page
unchanged with no staged proposal, retain one usage receipt, and make no new
request when the failed run is visited again. Actual provider adapter and worker
paths are exercised against the inert HTTP fixture.

Updated page-consumer cohort32/32 passes, zero failures/skips/cancellations,
exit0/signal:null,10798.8925ms:
`/tmp/orbyn-c1-entrypoint-usage-parse-focused-20261008.log` and matching terminal
JSON. Product source remains c1dde1d3; these additional tests do not replace the
pending full regression. Disk remains below300MiB.

## Recovered qualification and expanded usage wording

Disk recovered to12GiB. The retained test container restarted; its tmpfs preview
database was recreated and migrated, the disposable QA admin restored, and
API8008/web5174/mobile8083 returned200. Synthetic positive-display records are
restricted to that QA account and establish no vendor usage or billing.

Frozen15c4a8e3 full regression passed4300/4300 across465 files, zero
failures/skips/cancellations, exit0/signal:null,803068.725583ms. Terminal receipt
confirms clean source:
`/tmp/orbyn-c1-entrypoint-usage-recovered-full-terminal-20261008.json`;
log: `/tmp/orbyn-c1-entrypoint-usage-recovered-full-20261008.log`.
The interrupted prior attempt remains historical incomplete evidence.

QA-032 delegated recovery review passed fresh sign-in and normal empty-state
layout/controls on web and mobile browser320×740/1280×800. Its old saved-assistant
wording is not accepted for expanded feature coverage. Both client counters now
say provider responses and explain that recorded responses are not billing or
ChatGPT plan limits. Privacy defaults name saved runs, Agenda, maintained pages,
Memory and compaction, preserving30-day retention/opt-out and unknown counters;
default legal version advances to2026-10-08-managed-features.

This post-full delta is copy/legal/test-only; backend implementation is unchanged.
Actual-component UI and legal cohort15/15 passes, zero skips/failures,4420.283833ms,
exit0/signal:null (`/tmp/orbyn-c1-entrypoint-usage-copy-focused-20261008.log`).
Both client typechecks, shared packages build and desktop production build pass.
Positive-state visual review of corrected wording is assigned to Orbyn Visual
Check. Do not treat these results as full-stage, native or live-vendor acceptance.

## Scoped visual acceptance

Root reviewed Orbyn Visual Check's final QA-033 report for2f6c7f82. Corrected
positive-state wording and all five synthetic counters fit on web and mobile
browser at320×740 and1280×800, Light/Dark; refresh, scrolling and Close work.
The initial mobile stale bundle was resolved by restarting this task's Metro
without CI (which disabled reloads). Historical failing frames remain in the
report. Evidence is delegated actual-pixel review with inline captures, not
exported originals or root pixel inspection.

Report: `/Users/anhdang/.codex/visualizations/2026/10/08/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-033-positive-usage-copy-2026-10-08/visual-analysis.md`.
Two explicitly marked synthetic jobs were removed after review; zero fixture
usage rows remain, and other jobs were preserved. Receipt:
`/tmp/orbyn-c1-usage-fixture-cleanup-reopened-20261008.json`.

This qualifies the Agenda/page usage correction with cross-client truthful copy.
It does not close error/overflow, enlarged/native, vendor, scanner availability,
or overall C1 gates. Next ordered implementation is personal scanner admission.

## Main delivery

Qualified branch fast-forwarded and pushed to main as e90699c4. Product source
2f6c7f82 is included. Primary mobile/app.json SHA-1 remains
`dacd602172347441f2fd92f16d8772b3ba1ef7a8`; unrelated untracked files were preserved.
This records repository delivery, not production deployment or full C1 completion.

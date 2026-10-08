# C1 consolidated final candidate handoff

Cycle C1-full-2026-10-08. Builder implementation complete for retained C1 scope.
This is formal Test admission, not acceptance. Review counter remains1/3; the
next new full Reviewer pass records2/3 before starting.

## Frozen source

Checkout: `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
Branch: `codex/c1-production-checkpoint`. Tester records the exact commit
containing this handoff before any execution. Application/test source is frozen;
Builder makes no competing source edits. Compared with tested3ccf8f57, source
changes are the capture Gradle plugin repair10d3d1e3 and full mobile consent
accessible name plus three regressions0fe6b087. Main role/scope docs are merged.
No dependency versions or backend application implementation changed.

## Retained full scope and evidence

Use the12 requirement groups in `c1-builder-readiness-2026-10-08.md`, the full
ADR C1 contract, provider inventory, entrypoint/recovery matrix and existing
qualification plan, subject to the current user overrides. Qualify the whole
checkpoint, not only the two latest changed files.

- Full backend4337/4337 at244abc21; exact unchanged backend/dependencies retained.
- Independent205/205 retest at3ccf8f57, typechecks/build receipts and operational
  pgvector69/69 plus independent fresh migration fixtures remain source-scoped.
- `c1-full-2026-10-08-runtime-qualification.md`: real synthetic3D→7D indexing,
  revision/access fencing,503 persistent backoff/scheduled recovery, heartbeat
  expiry/restart, revalidation, off cleanup and word search with provider stopped.
- Matilda authorized six-request baseline passed fixed checks; zero reported
  counters/unknown cache writes do not imply zero billing or cache savings.
- QA033–039 scoped reports and QA040 narrow web consent plus Expo mobile
  enable/status/off available. QA040001 accessibility closure independently
  verified DOM: full visible sentence equals switch accessible name, including
  recipient and exclusions. Actual assistive-technology announcement untested.
- Latest Builder development checks: embedding-controls34/34, zero failures,
  skips/cancellations; mobile TypeScript exit0. Tester independently verifies.

## Explicit user scope and limitations

- No iOS builds or Android-specific verification. Do not run native exports,
  packaging/device jobs. Shared mobile type and Expo web browser parity retained.
- Live OpenAI cache economics and live accepted vendor embedding measurements
  are approved follow-ups; not C1 blockers. Do not fabricate vendor/cost outcomes.
- Genuine200% enlargement unsupported by exposed internal-browser capabilities;
  historical native permission denial is not bypassed. Keep limitation explicit.
- Source-bound unsigned Electron artifact exists at
  `/tmp/orbyn-c1-desktop-source-package-unsigned-20261008/mac-arm64/Orbyn.app`;
  manifest identifies unchanged renderer/preload/Electron files and archive hash.
  Packaged successfully, not previously launched/installed. Applicable desktop
  interaction qualification/disposition remains part of consolidated Test/Review.

## Runtime ownership and executable plan

API8010 uses unchanged compiled244abc21 backend against isolated marked
`orbyn_c1_visual_20261008_test`, pgvector55437. Web5174 serves equivalent3ccf8f57
desktop source; Expo8083 serves this candidate mobile source. Normal disposable
QA session available; do not expose account credentials in reports.
QA040 persisted cleanup verified search off, consent null, queue/vectors/failures
zero. Owned measuring worker37325 stopped; local synthetic provider18090 stopped.
No vendor calls or competing fixture writer. Preserve primary user mobile/app.json,
other providers/accounts, unrelated containers/worktrees.

Tester selects full impact-based focused/regression/type/build/runtime execution
against exact freeze. Reuse older receipts only with explicit unchanged-source
justification; do not relabel4337 as a new passing run. Create independently named
marked `_test` databases when fixtures require clean state; never reset QA DB.
Use `npm run typecheck`, `npm run build` and appropriate C1 tests/full regression
per retained plan. Backend full test fixture variables are private; obtain them
from existing local test configuration without printing secrets. Avoid duplicated
runs and oversized native builds. All formal results go in one Markdown report.
Return actionable defects to Builder; Tester never patches source. Reviewer waits
for that report, inspects code/evidence only, increments next full round to2/3,
and records explicit acceptance including limitations. No new visual sweep;
request only a named material defect. Builder fixes findings as a complete batch.

## Delivery

Main9768f350 contains role/scope docs. Product candidate is not promoted yet.
After full C1 acceptance merge/push, then honor user pause before C2/M1. User
owns production deployment. The broader ADR is not complete.

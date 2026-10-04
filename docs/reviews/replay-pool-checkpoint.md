# Replay planning and checked-out connection checkpoint

Date: 5 October 2026. Candidate based on main `7f253b80`.

## Changes

- Bind replay reference IDs as a text array, allowing PostgreSQL to estimate the
  actual list size. Keep all ownership, grant, membership and producing-source
  predicates in the same query.
- Observe transport errors on checked-out primary/replica clients as well as idle
  pool clients. A lost connection rejects its transaction; it is never retried or
  reported successful by the observer.
- Preserve the original transaction error if rollback cannot reach the database.

These changes need no migration, provider configuration or UI changes. They do
not promote the broader ChatGPT, maintained-page or layout candidate.

## Evidence

Fresh focused checks on this main-based source pass25/25, no skips, in
`/tmp/orbyn-main-replay-focused-tests.log`. Workspace typechecks pass in
`/tmp/orbyn-main-replay-types.log`. The marked disposable database is
`orbyn_replay_checkpoint_0b0e430c_test`; production/development databases were not
used. The disconnect test terminates only its tagged owned backend connection.

Broader candidate replay/process/rules/runner checks previously passed102/102.
Those results do not replace full-source qualification for this checkpoint.
Fresh full local tests, production build and CI remain required before main merge.
The full ADR stays open in C1-C6/M1/D1/U1. User deploys main manually.

## Notification-query follow-up

CI37212727662 passed all jobs for97914b50. Its local full suite ended2574/2578
pass,4fail: notification-source privacy lost its database connection, with
subsequent setup/recovery failures. This is not a passing local gate.

The checkpoint now includes bounded notification pages and separate source
checks only for notice families actually present. Hidden notices do not consume
the100 visible-result limit; the final source guards remain mandatory. Exact
PostgreSQL timestamp/ID cursors avoid losing microsecond precision, and internal
cursor fields are stripped from responses. These changes were already covered
on the broader candidate; this main-based source requires its own fresh checks.

The expanded main-based source passes105/105 focused notification/replay/privacy/
planner/disconnect checks, no skips, in
`/tmp/orbyn-main-notice-replay-focused-tests.log`. Workspace types pass in
`/tmp/orbyn-main-notice-replay-types.log`. A fresh full suite and CI must qualify
this new head before merging; the preceding CI result belongs to97914b50.

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

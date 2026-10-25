# Prove the writer boundary before conversion

Use for durable schema/format or writer transitions. A design-only answer must
still name the enforcement and its evidence; a working backfill does not supply
that boundary. Keep the record in the existing design/runbook, not a new platform.

## Required migration deliverable

For every phase that changes what may be stored, state:

| Question | Concrete answer required |
| --- | --- |
| Who can write? | API, worker, delayed job/replay, import, direct database client and operator paths; supported/deployed versions; unknowns |
| What may each write? | Old/new format, canonical owner, allowed coexistence and lossless translation limits |
| What enforces this? | Actual storage/effect boundary or verified stop/drain; scope, owner and bypass paths |
| What proves readiness? | Current deployed identities plus an old-writer attempt rejected without mutation and a legitimate new-writer control |
| What happens if it fails? | Stop condition, retained data/checkpoint, compatible recovery and who restores the service |

Do not replace these answers with “use a lock,” “deploy v2,” “fence writers” or a
clean source search. If a writer cannot be enumerated or excluded, state that
conversion/cutover is not ready and continue safe discovery, compatibility work
or a disposable rehearsal. Do not turn uncertainty into either assumed safety
or a request to halt all engineering.

## Choose enforcement that reaches every writer

- A new API flag or application lock cannot exclude a legacy worker or direct
  database client that bypasses it. Either route all writes through an enforced
  boundary, restrict the old path under authorized operations, or keep a compatible
  coexistence mode until it can be stopped. Account for in-flight transactions,
  cached credentials, queued retries and automatic restart after draining.
- A lease expiry does not stop a paused process. If using fencing epochs/tokens,
  the resource must atomically compare the presented generation with its durable
  current fence and reject stale work at the effect. Define how the fence advances
  and becomes effective before conversion; merely issuing a new token is not proof
  that the resource has observed it. No caller-supplied token may authorize a new
  epoch. Monotonicity must survive restart and recovery.
- A schema/version condition and mutation must share the engine's atomic boundary.
  Checking a version in application code and later writing unconditionally leaves
  a race. A row revision protects concurrent changes; it does not establish fleet
  adoption. A writer epoch excludes obsolete authority; it does not alone prevent
  two valid writers from losing each other's updates.
- An exclusive maintenance window is a valid smaller option when authorized and
  compatible with availability requirements. Verify admission is stopped, active
  work is drained or fenced, and scheduled/replay paths cannot restart. Do not
  impose a distributed lease system on a single-process conversion.

Backfill only under the phase's explicit writer contract. During compatible
coexistence, use conditional conversion/checkpoints and reconcile changed or
deleted rows. Before incompatible writes or retirement, prove every affected
path compatible or excluded. Preserve external-client support commitments.

## Rehearse the dangerous interleaving

In an authorized disposable environment, start an old writer, pause it before its
effect, advance the cutover boundary, then resume it. Assert rejection and unchanged
stored data, with a successful current-writer control. Also exercise a bypass path,
retry/restart, interrupted batch and a failed recovery where relevant. Use barriers
or the actual database boundary, not arbitrary sleep timing. A sequential in-memory
check is useful but cannot qualify concurrent database enforcement or a live fleet.

After partial conversion, preserve checkpoints, source revisions and original data
where needed. Stop further incompatible effects; choose a compatible forward repair
or a demonstrated restore/replay path. Do not lower a fence or restart old binaries
merely to clear an error. Reconcile writes made after the recovery point, duplicate
replays and user-visible outcomes before resuming. Record remaining operator steps.

Primary context, reviewed 25 October 2026:
[PostgreSQL advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS),
[Kleppmann on fencing](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html),
and [AWS deployment compatibility](https://aws.amazon.com/builders-library/ensuring-rollback-safety-during-deployments/).
This is an independently written method; use the target engine/version and policy.

# Worked example: ranges become sessions

Synthetic migration plan. A task has one stored range; the new representation
has multiple session rows. An older deployed worker still writes the old range.

## Worked result

First identify all writers: interactive API, old worker, import path and any
scheduled processing. Introduce session storage and a compatibility reader before
retiring the old representation. Do not assume a merged commit replaced the worker.

Backfill bounded batches using a durable cursor and stable source-to-session key.
Store enough original data to detect a source change during a batch. Retrying a
batch must not add another copy. Compare counts and representative records;
counts alone cannot establish that every time range was translated correctly.

| Phase    | Allowed writers               | Exit condition                                |
| -------- | ----------------------------- | --------------------------------------------- |
| Expand   | Existing writer contract      | Compatible schema/read path available         |
| Backfill | Explicitly coordinated writes | Progress recorded; changed sources reconciled |
| Cut over | New writer contract only      | Old workers fenced or confirmed stopped       |
| Retire   | New readers/writers           | Old clients handled and recovery approved     |

If the old worker cannot be inspected or stopped, cutover remains unresolved.
Propose an enforceable writer version/fence or a compatible transition. A lock
used only by the new code cannot exclude the old writer.

**Recovery.** Before retirement, retain original values and migration identity.
After a lossy cutover, recovery may require a forward repair or restoration with
controlled writers. Restarting old code against a new format is not a rollback.

**Evidence plan.** Use old records, an interrupted batch, duplicate retry and a
concurrent legacy write in disposable scope. Record exact schema/candidate and
the remaining operator steps; this plan performs no migration.

**Failure example.** Backfill once, delete the old field and mark the migration
complete while the old deployed worker is still active.

**Reuse.** Capture the phase dependencies in the
[failure and verification record](../../orbyn-workflow/references/task-record.md).

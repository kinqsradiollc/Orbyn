---
name: orbyn-data-migration
description: "Plan and implement stored-data, schema and writer migrations with compatibility, cutover, retry and recovery evidence. Use for durable format changes; not a routine in-memory type refactor or permission to run production migrations."
---

# Migrate data with an explicit writer boundary

Read the consuming project's migration conventions, current schema and every
active reader/writer, including jobs, released clients and cached payloads. Define
the old/new representation, invariant, migration identity and cutover condition.
Use [architect](../architect/SKILL.md) for an unsettled model.

Choose expansion, backfill, reader/writer transition and retirement only as the
system needs them. Name what can run concurrently with each phase. A lock helps
only when all writers honor it; an older deployed service may require fencing or
shutdown before data conversion. Do not infer deployed writer state from a local
branch. Retain compatibility for external clients that cannot move atomically.

Make backfills bounded and resumable at a durable cursor or operation key. Account
for deleted records, partial batches, transactions, unique constraints and evolving
data while the migration runs. Keep original values or a defined recovery route
when conversion loses information. Avoid “rollback” instructions that restart old
writers against an incompatible format.

For example, replacing one task time range with multiple sessions changes stored
records, API shapes, background work and calendar rendering. Define the translation
and ownership once; several UI adapters cannot establish storage compatibility.

When authorized, exercise representative old data, a partial/retried migration,
legitimate concurrent behavior and recovery in a disposable environment. Capture
the exact schema/candidate and counts without exposing user payloads. A dry-run
query is not a completed data conversion. Production execution, backups, operator
cutover and irreversible retirement remain within the user's explicit effect scope.

Deliver the migration and caller changes, phase/order, actual evidence and remaining
operator steps. Use [backend design](../orbyn-backend-design/SKILL.md) for effect
boundaries and [CI design](../orbyn-ci-design/SKILL.md) for a repeatable qualification
lane. Keep the owning product guide current rather than creating a second backlog.

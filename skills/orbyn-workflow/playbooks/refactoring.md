# Refactoring

The lead owns the preserved contract and target shape. Use the parent
[workflow](../SKILL.md) to delegate substantial structural changes.

1. Trace behavior and callers; define compatibility and evidence to preserve.
   Capture an authorized baseline when practical. A test/harness still needs
   testing authorization.
2. Design the target ownership and interfaces. Write the throughput checkpoint,
   separating independent consumers while keeping shared-contract edits owned.
3. Delegate scoped changes with the caller inventory and target shape. Simplify
   at the owning boundary, migrate consumers and remove proven obsolete paths.
4. Review semantic equivalence and the full owned diff, including string/prose
   references for renames. Route missed callers or regressions back to the owner.
5. Perform authorized checks and report the actual equivalence evidence and gaps.

Small clear moves stay direct. A child completes its owned changes directly.
Avoid unrelated formatting and preserve useful contracts throughout delivery.

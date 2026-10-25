# Refactoring

The lead owns the preserved contract and target shape. Use the parent
[workflow](../SKILL.md) to delegate substantial structural changes.

1. Trace behavior and callers; define compatibility and evidence to preserve.
   Capture a baseline when practical. An implementation request normally includes
   proportional local tests; respect explicit exclusions and external-effect limits.
2. Design the target ownership and interfaces. Write the throughput checkpoint,
   separating independent consumers while keeping shared-contract edits owned.
3. Delegate scoped changes with the caller inventory and target shape. Simplify
   at the owning boundary, migrate consumers and remove proven obsolete paths.
4. Review semantic equivalence and the full owned diff, including string/prose
   references for renames. Route missed callers or regressions back to the owner.
5. Perform authorized checks and report the actual equivalence evidence and gaps.

Small clear moves stay direct. A child completes its owned changes directly.
Avoid unrelated formatting and preserve useful contracts throughout delivery.

For independently owned or released consumers, use the architect's
[staged change method](../../architect/references/large-changes.md): pilot a slice,
batch with drift checks and retire compatibility only after adoption evidence.
Use the [impact map](../../how/references/impact-map.md) when source search alone
cannot establish generated, dynamic or deployed dependencies.

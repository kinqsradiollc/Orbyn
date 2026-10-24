---
name: principle-minimize-reader-load
description: "Reduce indirection and hidden mutable state in difficult-to-follow code."
---

# Principle minimize reader load

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Trace where values originate and who changes them. Collapse wrappers that add no boundary, shrink mutable scope and derive state instead of synchronizing duplicates. Keep useful separation around effects and authority. Judge clarity by whether a maintainer can follow the contract, not an arbitrary file or function count.

## Decision in practice

Can a maintainer explain where this value changes?

For a reviewable proposal, keep its lifecycle in the shared domain owner and render the current state directly. Avoid a second local status plus effects that continually synchronize it. Keep separate presentation state, such as an expanded panel, local to the view.

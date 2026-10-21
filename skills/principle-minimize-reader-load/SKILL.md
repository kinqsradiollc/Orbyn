---
name: principle-minimize-reader-load
description: "Reduce indirection and hidden mutable state in difficult-to-follow code."
---

# Principle minimize reader load

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Trace where values originate and who changes them. Collapse wrappers that add no boundary, shrink mutable scope and derive state instead of synchronizing duplicates. Keep useful separation around effects and authority. Judge clarity by whether a maintainer can follow the contract, not an arbitrary file or function count.

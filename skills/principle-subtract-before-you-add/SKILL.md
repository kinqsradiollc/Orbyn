---
name: principle-subtract-before-you-add
description: "Reduce existing complexity before extending an affected design."
---

# Principle subtract before you add

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Find redundant controls, dead paths and duplicate interpretation. Verify callers and contracts before removal. Build on the simpler owner when possible. Do not discard user data, meaningful tests or public compatibility to make an addition smaller.

## Decision in practice

Does the product already have the right owner or surface?

Before adding another review drawer, inspect the existing proposal review flow and remove duplicate state interpretation. Reuse its authority and decision contract. Do not delete a distinct consequence or recovery path simply because both controls look similar.

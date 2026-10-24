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

## Apply and hand off

Locate existing behavior and duplicated interpretation before adding another surface or owner. Verify consumers before removing the redundant path.

Concrete check: Reuse an existing proposal review flow when its decision contract fits. Preserve a distinct destructive consequence or recovery action even if the controls look similar.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../architect/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

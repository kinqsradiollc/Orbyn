---
name: principle-subtract-before-you-add
description: "Reduce existing complexity before extending an affected design."
---

# Principle subtract before you add

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Find redundant controls, dead paths and duplicate interpretation. Verify callers and contracts before removal. Build on the simpler owner when possible. Do not discard user data, meaningful tests or public compatibility to make an addition smaller.

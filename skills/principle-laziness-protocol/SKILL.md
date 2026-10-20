---
name: principle-laziness-protocol
description: "Simplify a design or diff without losing required behavior."
---

# Principle laziness protocol

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Aim for less maintenance work. Remove proven unused paths, collapse unnecessary wrappers and consolidate decisions at one owner. Prefer a small coherent fix over layers built for hypothetical reuse. Do not delete checks, compatibility or evidence just to reduce line count.

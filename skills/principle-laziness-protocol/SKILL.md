---
name: principle-laziness-protocol
description: "Simplify a design or diff without losing required behavior."
---

# Principle laziness protocol

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Aim for less maintenance work. Remove proven unused paths, collapse unnecessary wrappers and consolidate decisions at one owner. Prefer a small coherent fix over layers built for hypothetical reuse. Do not delete checks, compatibility or evidence just to reduce line count.

## Decision in practice

Which maintained path can disappear without losing the contract?

If three wrappers only rename a request field, consolidate interpretation in the transport owner and migrate its callers. Keep a wrapper that enforces authority, cancellation or recovery. Fewer lines are not useful when a real boundary becomes implicit.

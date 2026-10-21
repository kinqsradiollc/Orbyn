---
name: principle-type-system-discipline
description: "Use types to express valid states and prevent meaningful contract mistakes."
---

# Principle type system discipline

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Model state variants explicitly, derive from authoritative schemas and handle variants exhaustively. Validate external and persisted data at runtime; static types do not prove authorization or freshness. Use semantic IDs where they prevent real confusion. Keep unavoidable casts local and justified; avoid ceremony that makes callers harder to read.

---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Replace an internal API while eliminating duplicate old paths."
---

# Principle migrate callers then delete legacy apis

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Inventory callers and compatibility obligations. Migrate owned internal consumers together, then remove the obsolete interface and implementation-specific tests when testing is in scope. Public clients and persisted formats need explicit versioning or a staged migration. Do not break external consumers for a cleaner local diff.

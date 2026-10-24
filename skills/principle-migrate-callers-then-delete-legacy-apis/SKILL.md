---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Replace an internal API while eliminating duplicate old paths."
---

# Principle migrate callers then delete legacy apis

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Inventory callers and compatibility obligations. Migrate owned internal consumers together, then remove the obsolete interface and implementation-specific tests when testing is in scope. Public clients and persisted formats need explicit versioning or a staged migration. Do not break external consumers for a cleaner local diff.

## Decision in practice

Which consumers can move atomically?

Move owned web/mobile callers and the shared client in one change when practical. A released mobile client or stored document version cannot be migrated by editing the monorepo alone: keep an explicit compatibility window. Remove the internal adapter after caller and persisted-format inventory is reconciled.

## Apply and hand off

Separate atomically owned callers from released clients and stored formats. Set the retirement condition from that inventory, not from a successful repository search alone.

Concrete check: Deleting an old route is unsafe while a released mobile client still uses it. Keep an explicit compatibility window or a versioned migration and record the actual deployment limit.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [orbyn-data-migration](../orbyn-data-migration/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

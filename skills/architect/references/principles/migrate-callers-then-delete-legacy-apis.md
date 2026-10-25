# Migrate callers then delete legacy apis

Inventory callers and compatibility obligations. Migrate owned internal consumers together, then remove the obsolete interface and implementation-specific tests when testing is in scope. Public clients and persisted formats need explicit versioning or a staged migration. Do not break external consumers for a cleaner local diff.

## Decision in practice

Which consumers can move atomically?

Move owned web/mobile callers and the shared client in one change when practical. A released mobile client or stored document version cannot be migrated by editing the monorepo alone: keep an explicit compatibility window. Remove the internal adapter after caller and persisted-format inventory is reconciled.

## Apply and hand off

Separate atomically owned callers from released clients and stored formats. Set the retirement condition from that inventory, not from a successful repository search alone.

Concrete check: Deleting an old route is unsafe while a released mobile client still uses it. Keep an explicit compatibility window or a versioned migration and record the actual deployment limit.

Return the changed invariant, its owning location and the observation or evidence
gap. Use [staged API changes](../large-changes.md) for refactoring; use
[orbyn-data-migration](../../../orbyn-data-migration/SKILL.md) only when durable
data or wire formats change. This method adds no mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [migrate callers then delete legacy apis](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).

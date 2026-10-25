# Separate before serializing shared state

Give independent workers separate owned paths or records. When one shared object is a real invariant, use a transaction, lock, compare-and-swap or single owner. Conventions alone are not concurrency control. Distinct worktrees may isolate files while shared databases or generated artifacts still need coordination.

## Decision in practice

Which resources are actually shared?

Two worktrees isolate files, but can still race on one database, export directory or QA account. Give workers separate fixtures and output paths. Where a shared row is the invariant, use a transaction/version condition and assign cleanup ownership; a chat message is not a lock.

## Apply and hand off

Inventory shared refs, generated files, databases, ports and external fixtures even when files are isolated. Give independent writers distinct resources or one explicit serialization owner.

Concrete check: Two worktrees using one export directory can overwrite evidence. Separate output paths first; use a transaction or version condition for a genuinely shared row.

Return the changed invariant, its owning location and the observation or evidence
gap. Use [workflow coordination](../../SKILL.md) for assignment/resources,
[worktrees](../../../orbyn-worktree/SKILL.md) for checkout isolation and
[backend design](../../../orbyn-backend-design/SKILL.md) for application concurrency. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [separate before serializing shared state](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).

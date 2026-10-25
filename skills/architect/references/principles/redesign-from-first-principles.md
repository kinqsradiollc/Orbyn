# Redesign from first principles

Reconsider the owning data model and constraints as if the requirement had existed initially. Keep useful existing contracts and migrate affected consumers. Deliver the smallest justified redesign; an isolated defect does not authorize a repository rewrite. Update the related documentation and rationale.

## Decision in practice

Would the current owner still make sense with this requirement included?

When one task gains several work sessions, model sessions as owned records with their own identity instead of adding numbered start/end fields. Migrate the API and calendar consumers coherently. Keep an isolated label fix isolated; it does not require a domain redesign.

## Apply and hand off

Restate the new requirement in the owning model and compare the current design against it. Keep compatible contracts and migrate only the affected scope.

Concrete check: Multiple sessions for one task require explicit session identity and readers/writers. A typo in a session label does not justify redesigning that model.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [redesign from first principles](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-redesign-from-first-principles/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).

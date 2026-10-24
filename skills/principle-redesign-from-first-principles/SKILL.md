---
name: principle-redesign-from-first-principles
description: "Integrate a new requirement into a coherent design instead of layering patches."
---

# Principle redesign from first principles

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Reconsider the owning data model and constraints as if the requirement had existed initially. Keep useful existing contracts and migrate affected consumers. Deliver the smallest justified redesign; an isolated defect does not authorize a repository rewrite. Update the related documentation and rationale.

## Decision in practice

Would the current owner still make sense with this requirement included?

When one task gains several work sessions, model sessions as owned records with their own identity instead of adding numbered start/end fields. Migrate the API and calendar consumers coherently. Keep an isolated label fix isolated; it does not require a domain redesign.

## Apply and hand off

Restate the new requirement in the owning model and compare the current design against it. Keep compatible contracts and migrate only the affected scope.

Concrete check: Multiple sessions for one task require explicit session identity and readers/writers. A typo in a session label does not justify redesigning that model.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../architect/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

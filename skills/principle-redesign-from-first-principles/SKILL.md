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

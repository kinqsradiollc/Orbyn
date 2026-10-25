# Exhaust the design space

Compare a small number of plausible sketches against user outcomes, complexity and failure behavior. Use a prototype for an empirical uncertainty. Stop when evidence selects an approach; do not enumerate every possible design or run panels for established patterns. See [arena](../../../arena/SKILL.md).

## Decision in practice

Which uncertainty can change the design?

Compare server-driven updates and client polling against reconnect behavior, latency needs and operational cost. Prototype only the uncertain part. If the existing polling contract already meets the requirement, stop; producing a second architecture is not itself useful evidence.

## Apply and hand off

Name the uncertainty, two plausible approaches and an observation that selects between them. Stop generating candidates when the actual requirement is met.

Concrete check: If polling already meets the documented latency and reconnect contract, a streaming prototype needs a new consequential reason. Do not score an unsupported cost estimate as a fact.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [arena](../../../arena/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [exhaust the design space](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-exhaust-the-design-space/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).

# Make operations idempotent

Define operation identity and the state transitions before effects. Use idempotency keys, transactional claims or reconciliation where the actual system needs them. Separate unknown external outcomes from safe retries. Check partial completion, restarts and cleanup ownership; a reused PID alone does not prove process identity.

## Decision in practice

What does a repeated request mean after an unknown outcome?

Persist an operation key before an external effect and record the returned receipt. A timeout is an unknown result, not proof nothing happened. Reconcile with the provider before issuing a second effect; a database transaction alone cannot make a remote action exactly once.

## Apply and hand off

Define operation identity before the external effect and record accepted, known-complete and unknown outcomes separately. Specify which receipt or reconciliation makes retry safe.

Concrete check: A timeout after remote acceptance must not generate a new operation key on retry. Reconcile the existing key and preserve the possibility that the first request completed.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [orbyn-backend-design](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [make operations idempotent](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-make-operations-idempotent/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).

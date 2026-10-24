---
name: principle-foundational-thinking
description: "Choose data shape, ownership and lifecycle before adding logic."
---

# Principle foundational thinking

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Start from caller usage and dominant access paths. Identify shared mutable state, concurrency and invalid states. Put prerequisites before dependent work. Prefer one clear representation and simple explicit code over speculative abstraction; preserve external compatibility.

## Decision in practice

What owns identity and lifetime?

Before adding a background action, specify job identity, accepted/running/waiting/terminal states, cancellation owner and durable result location. Then derive UI states from that contract. A spinner plus an in-memory promise cannot define crash recovery.

## Apply and hand off

Specify identity, state lifetime, owner and allowed transitions before designing adapters. Assign every committed effect and terminal result a single authoritative owner.

Concrete check: An accepted background operation needs durable identity before its UI displays running. Decide what restart and cancellation mean before adding progress events.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../architect/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

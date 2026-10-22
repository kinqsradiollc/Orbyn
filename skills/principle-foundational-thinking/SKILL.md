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

---
name: principle-foundational-thinking
description: "Choose data shape, ownership and lifecycle before adding logic."
---

# Principle foundational thinking

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Start from caller usage and dominant access paths. Identify shared mutable state, concurrency and invalid states. Put prerequisites before dependent work. Prefer one clear representation and simple explicit code over speculative abstraction; preserve external compatibility.

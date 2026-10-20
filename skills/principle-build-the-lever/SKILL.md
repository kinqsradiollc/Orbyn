---
name: principle-build-the-lever
description: "Choose reusable automation for repetitive or fragile work."
---

# Principle build the lever

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Inspect one representative unit, then use an existing tool or a small deterministic helper when it improves repeatability or evidence. Make mutation scripts scoped and safe to rerun. Do not create a framework for a few obvious edits. A tool is useful only if its outputs can be checked against the real contract.

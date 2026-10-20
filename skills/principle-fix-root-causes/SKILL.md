---
name: principle-fix-root-causes
description: "Trace a defect to the owner of the invalid state or interpretation."
---

# Principle fix root causes

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Reproduce with authorized evidence, follow the producing boundary and consumers, and fix the cause. Check directly related occurrences. For restart bugs inspect persistence, locks and stale ownership before rewriting logic. If reproduction is unavailable, label the diagnosis as source-derived. Do not erase user data to make a symptom disappear.

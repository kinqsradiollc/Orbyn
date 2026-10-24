---
name: principle-fix-root-causes
description: "Trace a defect to the owner of the invalid state or interpretation."
---

# Principle fix root causes

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Reproduce with authorized evidence, follow the producing boundary and consumers, and fix the cause. Check directly related occurrences. For restart bugs inspect persistence, locks and stale ownership before rewriting logic. If reproduction is unavailable, label the diagnosis as source-derived. Do not erase user data to make a symptom disappear.

## Decision in practice

Where did the invalid state first become possible?

When a mobile update reverts a web edit, trace versions through shared schema, client request and database update. Repair the concurrency contract at its owner rather than forcing every screen to refresh. A UI workaround may hide the symptom while stale writes still lose data.

## Apply and hand off

Track the first producer of the invalid value or ownership claim. State the source-derived hypothesis and the observation that would distinguish it from a competing cause.

Concrete check: For a value that reappears after restart, inspect its durable writer and startup reader. Clearing the cache is diagnostic evidence only; it does not repair the writer.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [how](../how/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

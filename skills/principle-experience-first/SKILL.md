---
name: principle-experience-first
description: "Resolve product trade-offs around the person completing the task."
---

# Principle experience first

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

State the task and observable success. Remove redundant controls and explanations, preserve essential choices and make errors recoverable. A library caller and future maintainer are users too. Polish the agreed scope; do not silently remove requirements or broaden the project in the name of simplicity.

## Decision in practice

Can the person finish the task and recover from failure?

For a failed save, preserve the draft and focus, identify what failed, and offer a retry. Verify the error state at the actual narrow pane width. A cleaner screenshot is not an improvement if the essential action moves out of reach or a long value becomes inaccessible.

## Apply and hand off

Trace the person’s main action, consequence, interruption and recovery. Retain the choice and content needed to finish the action at the actual pane width.

Concrete check: A retry must preserve the draft and identify the affected item. A smaller dialog that loses either is a regression even if its screenshot is cleaner.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [orbyn-ui-design](../orbyn-ui-design/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

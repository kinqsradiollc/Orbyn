# Fix root causes

Reproduce with authorized evidence, follow the producing boundary and consumers, and fix the cause. Check directly related occurrences. For restart bugs inspect persistence, locks and stale ownership before rewriting logic. If reproduction is unavailable, label the diagnosis as source-derived. Do not erase user data to make a symptom disappear.

## Decision in practice

Where did the invalid state first become possible?

When a mobile update reverts a web edit, trace versions through shared schema, client request and database update. Repair the concurrency contract at its owner rather than forcing every screen to refresh. A UI workaround may hide the symptom while stale writes still lose data.

## Apply and hand off

Track the first producer of the invalid value or ownership claim. State the source-derived hypothesis and the observation that would distinguish it from a competing cause.

Concrete check: For a value that reappears after restart, inspect its durable writer and startup reader. Clearing the cache is diagnostic evidence only; it does not repair the writer.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [how](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [fix root causes](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-fix-root-causes/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).

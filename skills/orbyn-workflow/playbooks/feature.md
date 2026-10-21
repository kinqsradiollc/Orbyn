# Feature

The lead owns the outcome and design, delegates substantial implementation and
reviews and verifies the result under the parent [workflow](../SKILL.md).

1. State the user outcome, inputs, data ownership and failure states. Trace
   existing behavior with `how` and use `architect` for consequential contracts.
2. Write the throughput checkpoint before dispatch. Resolve blocking facts and
   choose disjoint owned paths or one owner for coupled code.
3. Delegate implementation with the chosen data shape, file scope, authorized
   checks and completion condition. Preserve permission and recovery behavior.
4. Inspect the diff and affected callers. If the design remains contested, use
   `interrogate` for a bounded challenge within the same model/child limits. Route corrections to the same child.
5. Perform authorized checks proportional to the changed contract and inspect
   the requested flow. Report missing surface/runtime evidence explicitly.

Small clear work stays direct. A child completes its owned implementation
without further delegation. Delivery remains within the user's requested scope.

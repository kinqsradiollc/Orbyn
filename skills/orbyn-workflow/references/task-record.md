# Optional task record

Routine work needs no separate log when the diff, PR and CI already explain the
result. The template supplies methods, helpers and synthetic examples; actual
task records belong to the consuming project and stay outside public skill sync.

The agent chooses the smallest useful record automatically when a long task,
consequential decision, owner transfer or context-loss risk needs continuation.
Do not make the human invoke logging, fill out a form or maintain another tracker.
Reuse the existing owning task document and project-approved artifact location.
Do not create a logging directory merely because these skills were installed.

A compact checkpoint usually needs only:

- Goal and exclusions.
- Current candidate and relevant dirty work.
- Last verified result, with evidence and any failed or unrun checks.
- Next unfinished action and owner.

Use the sections below only when they resolve a real review need. Select the
[versioned continuation record](handoffs.md) and its offline checker when another
tool or owner needs structured validation. JSON is optional, not a requirement
for every substantive task. Keep raw transcripts and debug output in an ignored,
project-owned location or approved CI artifacts; publish only deliberately
reviewed summaries. Follow the consumer's retention and contribution policy.

For example, a one-line typo correction needs its diff and normal delivery result,
not a new checkpoint file. A migration handed to another owner needs the current
candidate, last checked batch and next safe action in the existing task document;
choose JSON only if a recipient or helper needs to validate it.

## Change map

| User trigger and result | Current owner/source | Contract to change | Affected callers |
| ----------------------- | -------------------- | ------------------ | ---------------- |
|                         |                      |                    |                  |

## Failure and recovery

| Failure or concurrent event | State retained | Recovery owner/action | Unresolved dependency |
| --------------------------- | -------------- | --------------------- | --------------------- |
|                             |                |                       |                       |

## Verification record

- Candidate checkout and revision (or exact dirty diff):
- Input/fixture and allowed scope:
- Observation and supporting command/artifact:
- Failed attempts and remaining unverified behavior:
- Actual delivery state:

## Continue the task

- Last completed unit and evidence:
- Next unfinished action:
- Decisions still needed:
- Owned files, running resources and other writers:
- Constraints/exclusions that still apply:

A planned check has no observed result. A source trace does not establish a live
provider, rendered UI or deployed state. Preserve earlier failed observations
when explaining a correction. Use a short paragraph instead of this template for
a small task with no meaningful handoff.

For retained previews or running resources, add only the useful path/URL, current
state, process/session ownership and cleanup/restart condition from
[artifact lifecycle](artifact-lifecycle.md). Preserve an existing record instead
of requiring another resource manifest for every task.

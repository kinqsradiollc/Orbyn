# Progress tracking

Stage Tracker owns routine status reports so Builder can focus on implementation.
This guide applies to any task or project plan; no particular project roadmap is
required. Direct user questions and pause/completion handoffs still get answers.

## Read evidence first

| Source                                        | Use                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Current task request, plan and status record  | Agreed scope, order, phase, owner and remaining requirements          |
| Linked Tester/Reviewer reports                | Exact source, executed checks, findings and acceptance decision       |
| Linked runtime/visual reports                 | Observed behavior, renderer/viewport, limits and source applicability |
| Git status, log, worktrees and remote refs    | Uncommitted, candidate, merged and confirmed pushed states            |
| Builder's latest activity / named live handle | Work newer than the handoff; resolve a specific missing fact          |

Locate the current task's status record from its handoff or plan. Verify checkout,
branch, commit and timestamp. Historical “running” text does not prove a process
is live; poll the identified handle when necessary. Old green tests and partial
logs are not current acceptance evidence. If verification is unavailable, label
that fact **Unverified** and state the evidence date/source.

## Report format

Start with one sentence naming the task and current phase, followed by:

| Task / stage | State                                                             | Done          | Still required       | Next action            | Evidence / delivery              |
| ------------ | ----------------------------------------------------------------- | ------------- | -------------------- | ---------------------- | -------------------------------- |
| Agreed scope | ⏳ Active / ✅ Complete / ❌ Not complete / 🚫 Blocked / ⏸ Paused | Verified work | Missing requirements | Ordered step and owner | Source/report and delivery state |

Use the full agreed plan for a full status request; use the active task and next
step for a short question. Keep cells concise and link details. **❌ means unfinished**,
not necessarily failed. A delivered subtask can be complete while its parent is not.

Separate implementation, verification, review, merge, push and production deployment.
Name blockers and what clears them. Do not invent percentages, dates or ETAs.

## Ownership

- Builder maintains the task record at handoffs and delivery transitions.
- Track task/cycle, phase, candidate, review round0–3, reports and unresolved findings.
  Apply [delivery workflow](checkpoint-workflow.md); never reset the review counter.
- Read existing evidence before asking Builder. Ask only for missing/conflicting facts.
- Tracker does not edit product code, start competing tests, merge, advance scope
  or initiate screenshot jobs to prepare a report.
- Preserve user scope, pauses, messaging authorization and other contributors' work.

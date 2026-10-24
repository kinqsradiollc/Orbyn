---
name: show-me-your-work
description: "Keep a compact decision and evidence trail for substantial migrations or unattended work that the user will review later."
---

# Show me your work

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Use the [task-record defaults](../orbyn-workflow/references/task-record.md).
Routine edits need no separate log when existing Git, PR and CI evidence suffices.
For long work or consequential decisions, the agent maintains a compact checkpoint
automatically; the human does not need to request logging or fill a template.
Record meaningful decisions, not every tool call. Reuse an existing project-owned
task report; the optional [TSV helper](scripts/log.sh) is available when useful:
`bash skills/show-me-your-work/scripts/log.sh <file> <phase> <decision> <why> <evidence> <result>`.
The helper is single-writer. If parallel work needs logs, each writer owns a
separate file.

Each entry names what changed, why, source/evidence and actual outcome. Correct
old conclusions with a superseding entry. Do not invent measurements or links.
Keep secrets and private payloads out of logs. Retain failures and unverified
results; an attempted command is not a completed check.

When a transfer or context-loss recovery needs structured validation, use the
[versioned continuation contract](../orbyn-workflow/references/handoffs.md) in
the same owning task record. Reconcile current HEAD, dirty work and user scope
before reusing a completion claim. The optional offline checker catches stale
revisions and inconsistent records; inspect actual evidence yourself. A concise
status explanation or small task does not require a JSON packet.

Actual checkpoints and raw traces belong to the consumer, outside public skill
sync. Follow its approved locations and retention policy; keep raw output ignored
or in approved CI artifacts. Installing the template does not create a log folder
or authorize publishing records. Only reviewed reusable methods and synthetic
examples belong in the shared skill tree.

Before delivery, follow the evidence pointers and reconcile the trail with actual
artifacts. The lead may assign a review subagent for a substantial independent
concern under [coordination](../../docs/agents/coordination.md); children reconcile
their own trail directly. This skill does not authorize a separate chat. Commit a
report only within delivery scope.
Summarize the useful findings without copying the entire log into the reply.

## Keep a reviewable evidence chain

For a schema rollout, record the candidate, the writer-cutover decision, the observation and the remaining operator step. Link to the actual artifact rather than copying private payloads. A later reviewer should be able to distinguish a planned check, a failed attempt and a completed observation.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

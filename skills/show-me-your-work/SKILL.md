---
name: show-me-your-work
description: "Keep a compact decision and evidence trail for substantial migrations or unattended work that the user will review later."
---

# Show me your work

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Record decisions and meaningful checkpoints, not every tool call. Use an existing
task report or the bundled [TSV helper](scripts/log.sh):
`bash skills/show-me-your-work/scripts/log.sh <file> <phase> <decision> <why> <evidence> <result>`.
The helper is single-writer; use separate logs for parallel workers.

Each entry names what changed, why, source/evidence and actual outcome. Correct
old conclusions with a superseding entry. Do not invent measurements or links.
Keep secrets and private payloads out of logs. Retain failures and unverified
results; an attempted command is not a completed check.

Before delivery, follow the evidence pointers and reconcile the trail with actual
artifacts. The lead may assign a review subagent for a substantial independent
concern under [coordination](../../docs/agents/coordination.md); children reconcile
their own trail directly. This skill does not authorize a separate chat. Commit a
report only within delivery scope.
Summarize the useful findings without copying the entire log into the reply.

## Keep a reviewable evidence chain

For a schema rollout, record the candidate, the writer-cutover decision, the observation and the remaining operator step. Link to the actual artifact rather than copying private payloads. A later reviewer should be able to distinguish a planned check, a failed attempt and a completed observation.

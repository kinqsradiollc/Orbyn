---
name: show-me-your-work
description: "Keep a compact decision and evidence trail for substantial migrations or unattended work that the user will review later."
---

# Show me your work

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Record decisions and meaningful checkpoints, not every tool call. Use an existing
task report or the bundled [TSV helper](scripts/log.sh):
`bash skills/show-me-your-work/scripts/log.sh <file> <phase> <decision> <why> <evidence> <result>`.
The helper is single-writer; use separate logs for parallel workers.

Each entry names what changed, why, source/evidence and actual outcome. Correct
old conclusions with a superseding entry. Do not invent measurements or links.
Keep secrets and private payloads out of logs. Retain failures and unverified
results; an attempted command is not a completed check.

Before delivery, follow the evidence pointers and reconcile the trail with actual
artifacts. A review subagent is optional for a substantial independent concern;
never create a separate chat for it. Commit a report only within delivery scope.
Summarize the useful findings without copying the entire log into the reply.

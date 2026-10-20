---
name: rea-changelog-update
description: "Prepare REA release notes from pinned upstream history when requested; does not publish or infer REA history from Orbyn Git."
---

# Rea changelog update

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Read the complete [upstream skill](../../tools/rea/.agents/skills/rea-changelog-update/SKILL.md) and the relevant
nested REA contribution guides. Follow its references at their original location.
Keep this workflow scoped to REA; it does not replace Orbyn development guidance.

The imported snapshot has no independent Git history. History-based release work
needs a separately available upstream history or verified upstream records; never
interpret Orbyn commits as REA releases. Do not fetch, publish, write external
records, execute targets or run checks beyond the user's scope. Use in-task
subagents only when useful, with the repository's model/effort limits.
Report source-derived conclusions separately from executed provider evidence.

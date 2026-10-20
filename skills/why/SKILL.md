---
name: why
description: "Investigate design rationale, regressions and trade-offs using Git history and relevant authorized records; distinguish documented intent from inference."
---

# Why

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Find the code anchor, symbols and introducing/changing commits with scoped
`git log`, `git blame` and diffs. Read linked ADRs, issues and PR discussions when
needed. Expand to available authorized records only to resolve a specific gap;
do not search all connected accounts or private chats by default.

Treat the user's proposed explanation as a hypothesis. Capture direct rationale,
contradictory evidence and plausible alternatives. Code establishes mechanics,
not necessarily motivation. An empty bounded search does not prove a record
never existed. Describe the searched boundary.

Use an in-task subagent for a substantial independent evidence question when
useful. Do not create tickets or send messages while investigating.
Return the supported explanation with sources, inference and unknowns. If work
will change the design, identify constraints to preserve and decisions to revisit.

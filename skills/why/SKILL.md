---
name: why
description: "Investigate design rationale, regressions and trade-offs using Git history and relevant authorized records; distinguish documented intent from inference."
---

# Why

Follow the consuming project's instructions and requested scope; use the
[portable defaults](../orbyn-workflow/references/project-policy.md) only where guidance is missing.

Find the code anchor, symbols and introducing/changing commits with scoped
`git log`, `git blame` and diffs. Read linked ADRs, issues and PR discussions when
needed. Expand to available authorized records only to resolve a specific gap;
do not search all connected accounts or private chats by default.

Treat the user's proposed explanation as a hypothesis. Capture direct rationale,
contradictory evidence and plausible alternatives. Code establishes mechanics,
not necessarily motivation. An empty bounded search does not prove a record
never existed. Describe the searched boundary.

For substantial historical investigation, the lead delegates bounded evidence
questions to named Orbyn Investigators under the [workflow](../orbyn-workflow/SKILL.md),
then inspects their cited records and owns the explanation. Narrow questions and
children assigned a slice proceed directly. Do not create tickets or send messages
while investigating.
Return the supported explanation with sources, inference and unknowns. If work
will change the design, identify constraints to preserve and decisions to revisit.

## Separate rationale from mechanics

When a worker uses a lease instead of a process-local lock, inspect the introducing change and related recovery contract. Source can show that cross-process recovery is possible; only a linked rationale or other authorized record can establish why the original author selected it. Return both at their actual confidence.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

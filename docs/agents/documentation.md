# Documentation maintenance

Use current source and the user's task brief. Documentation should explain a
current contract or preserve a decision worth revisiting; it must not create a
second backlog or carry an old chat's pause/approval instructions into new work.

## Ownership

- `AGENTS.md` is the repository policy. `AGENT.md` and `CLAUDE.md` route to it.
- `skills/` owns reusable task instructions; host skill folders link to it.
- `docs/agents/` owns development workflow, roles, coordination and delivery.
- Product guides under `docs/` describe setup, architecture, API, operations,
  deployment and client behavior. Keep them separate from agent orchestration.
- Generated API/catalog files retain their source/generator ownership. Do not
  rewrite runtime contracts just to reflect a change in agent skills.
- `tools/` contains third-party source and provenance. Original license notices
  and source identities are preserved there; active Orbyn instructions are ours.

Use [orbyn-skill-creator](../../skills/orbyn-skill-creator/SKILL.md) when changing
workflow instructions and [skill routing](skill-system.md) to avoid overlapping
owners. New contracts should match the [current stack](stack.md).

## When updating a feature

Update the affected contract guide alongside the implementation. Verify commands
against package scripts and paths against source. Link to the owning implementation
when a detail changes often. Describe observable behavior and recovery; avoid
untested capacity claims or copying a full test transcript into a reference guide.

A material architecture choice can have a short rationale beside its owning guide:
problem, selected design, rejected alternative and consequence. Do not recreate
the retired ADR queue or require a numbered ADR for routine changes.

## Work records

For a substantial task that needs a durable handoff, use one scoped file under
`docs/work/` (create it only when needed). Record outcome, source revision, owned
files, actual evidence, unresolved limits and delivery state. Scope historical
facts to their date/revision. A report is not an instruction to continue old work.
Do not create permanent named tester/reviewer chats or repeated report trees.

When retiring material, check inbound links and source consumers. Git preserves
committed history; preserve uncommitted documents outside the active tree before
removal and record where they can be recovered. Keep current operational guides
and user-authored content. Validate links without running unrelated product tests.

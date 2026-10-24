# Claude instructions for Orbyn

Read and follow [AGENTS.md](AGENTS.md). It is the canonical policy for this
repository and applies to Claude as well as other agents.

Project skills are available through per-skill relative links under
`.claude/skills` to canonical folders in `skills/`. Start substantial engineering work with
[orbyn-workflow](skills/orbyn-workflow/SKILL.md); load its task-specific references on
demand. Use the current session's actual tools and models. Missing Cursor tools
or REA providers do not authorize installing or reconfiguring them implicitly.

Use `.claude/agents/orbyn-agent.md` for complex work and
`.claude/agents/orbyn-light.md` for bounded work; preserve the
[workflow role mapping](docs/agents/roles.md). Their current model and effort
come from [the shared registry](docs/agents/models.json) through the sync tool.
Follow [model policy](docs/agents/model-policy.md); the human-only tier requires
explicit human selection. Use standard processing only; never enable Fast,
Priority or Ultrafast or select speed-optimized variants. New branches follow
[branch naming](docs/agents/development.md#branch-naming).

For substantial work, act as the lead: delegate investigation and implementation
to the appropriate named native agents, then review their actual changes and
verify the result. Follow the shared coordination and delivery rules. A delegated
child completes its owned slice directly; it does not spawn more agents.

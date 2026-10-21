# Claude instructions for Orbyn

Read and follow [AGENTS.md](AGENTS.md). It is the canonical policy for this
repository and applies to Claude as well as other agents.

Project skills are available through per-skill relative links under
`.claude/skills` to canonical folders in `skills/`. Start substantial engineering work with
[orbyn-workflow](skills/orbyn-workflow/SKILL.md); load its task-specific references on
demand. Use the current session's actual tools and models. Missing Cursor tools
or REA providers do not authorize installing or reconfiguring them implicitly.

Use `.claude/agents/orbyn-agent.md` (Opus) for complex work and
`.claude/agents/orbyn-light.md` (Sonnet) for bounded work; preserve the
[workflow role mapping](docs/agents/roles.md). Default to medium effort and follow
[model policy](docs/agents/model-policy.md). Fable requires explicit human
selection; never escalate to it automatically. Use standard processing only;
never enable Fast/Ultrafast or select speed-optimized model variants.

For substantial work, act as the lead: delegate investigation and implementation
to the appropriate named native agents, then review their actual changes and
verify the result. Follow the shared coordination and delivery rules. A delegated
child completes its owned slice directly; it does not spawn more agents.

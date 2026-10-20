# Claude instructions for Orbyn

Read and follow [AGENTS.md](AGENTS.md). It is the canonical policy for this
repository and applies to Claude as well as other agents.

Project skills are available through per-skill relative links under
`.claude/skills` to canonical folders in `skills/`. Start substantial engineering work with
[orbyn-workflow](skills/orbyn-workflow/SKILL.md); load its task-specific references on
demand. Use the current session's actual tools and models. Missing Cursor tools
or REA providers do not authorize installing or reconfiguring them implicitly.

Use `.claude/agents/orbyn-agent.md` for delegated Orbyn work and preserve the
[workflow role mapping](docs/agents/roles.md). Default to Sonnet/medium;
never select Astra, Fable or maximum effort.

# Model and delegation policy

Prefer GPT-6.1 Sol at medium effort for most work. Claude Code defaults to
Sonnet at medium. Use a cheaper model or low effort only when the user explicitly
chooses it; optional choices are GPT-6 Luna or Claude Haiku for bounded discovery.
Use high only after recording the concrete reason a complex audit or reasoning
task needs it. Never select Astra, Fable, xhigh, max, ultra, or an automatic
deep-effort mode. Never automatically escalate to Opus. Keep prompts scoped,
pass file references instead of whole transcripts, reuse existing children, and
request concise findings with evidence.

The named host agent is **`orbyn-agent`**. [Orbyn roles](roles.md) define the
assignment and effect boundaries for investigation, design, engineering,
verification, review, writing and artifact analysis. Every role uses Sol/medium
or Sonnet/medium by default; it does not require a separate permanent agent.

These are project defaults, subject to the current host's supported models and
account access. Claude aliases resolve by installed version and provider. An
unavailable model is a reported limitation; do not silently switch model families.
Ordinary work needs no independent reviewer.

Follow [Coordination](coordination.md) to choose the unit of work. A separate
user-owned project session is appropriate for substantial separately tracked work
when the human explicitly requests that session. Use supported session tools for
that authorized action; never recursively create sessions. Each parent or project
session may use at most two native children, with disjoint write ownership and no
recursive fanout. Children report to their parent. Do not invoke separate
`codex exec` / `claude -p` processes for delegation. If native subagents are
unavailable, continue with one agent.

## Host configuration

Codex uses `.codex/config.toml` and `.codex/agents/*.toml`. The project sets a
medium parent and explicit model/effort in `orbyn-agent`. `agents.max_threads = 2`
uses the compatibility alias for the current concurrent-child limit. The agent
entry also provides a `config_file` path for compatible hosts. The standalone agent
carries the required name, description and instructions. Current Codex documentation
says role-file model/effort takes precedence over spawn values, so a justified
high review, or an explicitly requested low/cheaper explorer, requires selecting
the requested values in the applicable role definition before launch; do not assume a spawn override beats the file. Project configuration
requires a trusted project. Parent permissions, provider and MCP configuration
remain inherited. See [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Claude Code uses `.claude/settings.json` (`sonnet`, `effortLevel: medium`) and
`.claude/agents/*.md` with explicit model and effort. Definitions deny `Agent`
and the older `Task` spelling to prevent child delegation. The parent must enforce
the two-child limit; this project does not invent a Claude concurrency setting.
Use definitions for effort selection on older clients; per-invocation effort
requires v2.1.292 or later. For a justified high review or explicitly requested
low/cheaper explorer on an older client, select the requested values in the role
definition before launch. See [Claude subagents](https://code.claude.com/docs/en/sub-agents)
and [model configuration](https://code.claude.com/docs/en/model-config).

These defaults are not a security or billing cap: explicit host overrides,
managed settings and environment variables can affect effective settings.
`CLAUDE_CODE_EFFORT_LEVEL` takes precedence over Claude frontmatter;
`maxEffortLevel` is a managed setting, so it is intentionally absent from project
settings. Check the effective model/effort before delegation and correct a
conflicting override to an allowed level. No permission or MCP configuration is
changed by these project files.

## Evidence and limits

Official documentation checked on 2026-10-21. Installed tools report Codex CLI
0.133.0 and Claude Code 2.1.150; current documentation describes newer features
as well. TOML/JSON parsing and source review cover the authored files. The
installed Codex CLI rejects `--strict-config features list` because strict mode
is unsupported for that subcommand; `codex features list` succeeds.
`codex --strict-config doctor --summary` accepts the configuration and reports
config loaded, then exits 1 for `TERM=dumb`; it also reports an existing optional
MCP environment warning. This diagnostic is not a clean runtime qualification.
No model request, subagent execution, app tests or build was used to qualify this setup.
Claude role discovery and effective model/effort during a live run remain
unverified; do not equate static configuration with runtime proof.

# Model and delegation policy

Use multiple model tiers according to the actual assignment. Model routing and
reasoning effort and processing speed are separate choices. Use the explicit
model/effort assignments below, always at standard processing speed.
The provider pairs below are Orbyn routing tiers, not measured equivalence in
capability, latency, price or reasoning budget.

<!-- agent-models:start -->

| Agent / selection             | OpenAI model / effort                 | Claude model / effort           |
| ----------------------------- | ------------------------------------- | ------------------------------- |
| `orbyn-agent`                 | `gpt-6.1-sol` / medium                | `opus` / medium                 |
| `orbyn-light`                 | `gpt-6-luna` / high                   | `sonnet` / medium               |
| Explicit human selection only | `gpt-6-astra` / human-selected effort | `fable` / human-selected effort |

<!-- agent-models:end -->

The human manually selects Astra when stronger reasoning is needed. Treat the
paired Fable tier the same way: never select it automatically, including through
parent-model inheritance or a fallback. A human-selected strongest-model parent
does not implicitly authorize strongest-model children. Keep routine children on
one of the two explicit agent definitions unless the human requests otherwise.
Do not silently replace a model the human selected.

## Update models in one place

[models.json](models.json) is the canonical, human-editable model and effort
registry for **both OpenAI/Codex and Claude Code**, including human-only models
and standard-speed settings. Edit the appropriate provider entries there when
models change. The sync command preserves unrelated configuration and updates
both hosts' parent settings, named-agent model/effort, descriptions and the table
above. It does not invoke a model or reload a running chat.

```sh
python3 scripts/sync-agent-models.py --write
python3 scripts/sync-agent-models.py --check
python3 scripts/check-agent-assets.py
```

The updater accepts conventional plain-text Claude metadata and rejects YAML
punctuation or multiline values it cannot safely emit. Unsafe TOML edits also
fail before writes if parsed unrelated values would change. A rejected update
leaves all generated destinations untouched; simplify the registry value or make
a reviewed tooling change instead of hand-editing generated model settings.

Review the diff before a new session. Do not replace the entire config from an
old snippet or setup script. The asset checker detects drift from the registry;
it does not silently rewrite files or act as a background watcher. If a running
host rejects a new named agent, refresh/restart that host through its supported
user controls; a config edit alone does not change this chat's fixed tool catalog.
Never remove the model pin or use a generic fallback to conceal discovery failure.

## Route the assignment

Use Sol/Opus for cross-cutting plans, architecture and ownership decisions,
complex implementation, ambiguous diagnosis and consequential reviews. Use
Luna/Sonnet for bounded source discovery, clear small edits, documentation,
routine authorized verification and focused evidence collection. Roles do not
have a single mandatory model: select by scope, ambiguity and consequences.
See [roles](roles.md) for role responsibilities and examples.

The owner may route a task from Luna/Sonnet to Sol/Opus when the bounded brief
proves insufficient; record the concrete reason and pass the existing findings.
Do not automatically escalate beyond Sol/Opus. Use one suitable model for each
assignment; multiple available tiers do not require a panel, duplicate work or
extra sessions. Keep prompts scoped, pass file references instead of whole
transcripts and reuse a matching child.

Use Sol/medium, Luna/high, Opus/medium and Sonnet/medium. Luna/high follows the
Codex subagent starting recommendation; it is not a locally benchmarked optimum.
Higher effort does not make Luna equivalent to Sol. A Sol/Opus high-effort
assignment requires a recorded reason and supported definition/configuration.
Do not select xhigh, max, ultra or automatic deep-effort modes automatically. A human's
explicit model/effort choice takes precedence. Optional cheaper families or low
effort require an explicit human choice; they are not implicit fallbacks.

## Sessions and children

Follow [coordination](coordination.md). Separate user-owned project chats require
an explicit human request. A model tier does not create a chat. Each owner may
use at most two native children with disjoint write ownership and no recursive
fanout. Children report to their owner. Do not invoke separate `codex exec` or
`claude -p` processes for delegation. If native subagents are unavailable, continue
with one agent and report the lost delegation separation. The lead must review
substantial handoffs and verify authorized outcomes; an additional independent
reviewer remains optional unless requested.

Model availability is subject to the current host, provider and account access.
Report an unavailable model; do not silently substitute a family or install a
provider. Model routing does not authorize tests, messages, publication or other
effects beyond the assignment.

## Standard processing and delegation checks

Never enable Fast, Priority or Ultrafast processing, `/fast`, automatic speed
selection or a speed-optimized model variant, including on human-selected
Astra/Fable sessions. Luna remains an allowed model family; the restriction is
on accelerated processing modes and variants. If the host cannot preserve the
required model, effort and standard speed, report the limitation and keep
independent work in the current session instead of launching a mismatched child.

Before delegation, select `orbyn-agent` or `orbyn-light` for the assignment, check
that the host exposes that type, and read its model/effort definition. Reuse the
matching child. Do not substitute a generic built-in with inherited settings or
assume a spawn argument overrides a pinned definition. Check model, effort and
speed in the returned metadata or supported status UI when available. Stop a
mismatched delegate and report the conflict. If metadata is unavailable, report
that effective settings remain unverified; do not claim runtime qualification.

Codex sets `service_tier = "default"`, `features.fast_mode = false` and
`features.ultrafast_mode = false` in project configuration. These express the
standard-speed policy and disable accelerated controls on supporting hosts.
Child definitions inherit parent processing settings; do not invent an
unsupported child-level speed field. CLI or app overrides and older hosts may
behave differently, so project files alone do not prove standard-speed execution.
See [Codex speed controls](https://learn.chatgpt.com/docs/agent-configuration/speed)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Claude disables Fast through both project settings and the supported disable
environment variable; see [Claude Fast mode](https://code.claude.com/docs/en/fast-mode).
No global user settings, managed policy or provider configuration is modified.

## Host configuration

Codex uses `.codex/config.toml` and `.codex/agents/*.toml`. The parent defaults to
Sol/medium. `orbyn-agent` pins Sol/medium and `orbyn-light` pins Luna/high.
`agents.max_threads = 2` is the compatibility alias for the concurrent-child
limit. Each registered type supplies a `config_file` and its standalone file
contains its name, description and instructions. A trusted project is required.
Permissions, provider and MCP configuration remain inherited.

Custom Codex role-file model/effort takes precedence over spawn values. Select
the appropriate named type rather than spawning the Sol definition with a Luna
override. A requested different effort requires an applicable definition or a
host-supported configuration change before launch; do not assume a spawn value
wins. See [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Claude Code uses `.claude/settings.json` (`opus`, `effortLevel: medium`) and
`.claude/agents/*.md`. `orbyn-agent` pins Opus/medium and `orbyn-light` pins
Sonnet/medium. `fastMode: false` and project environment
`CLAUDE_CODE_DISABLE_FAST_MODE=1` disable Fast mode. Both deny `Agent` and legacy `Task` child delegation.
The parent
enforces the two-child limit; no invented Claude concurrency setting is used.
Check installed-version support before per-invocation model/effort overrides.
Per-invocation effort requires Claude Code 2.1.292 or later. The installed
2.1.150 CLI predates that control, so retain explicit definition-level effort.
Current docs resolve a per-invocation model before frontmatter, but before
2.1.251 `CLAUDE_CODE_SUBAGENT_MODEL` took precedence over both. A forced model
environment setting can collapse these tiers; check effective selection rather
than assuming the definition wins.
See [Claude subagents](https://code.claude.com/docs/en/sub-agents) and
[model configuration](https://code.claude.com/docs/en/model-config).

These project settings are defaults, not a security or billing cap. Explicit
host overrides, managed settings and environment variables can affect effective
selection. In Claude, `CLAUDE_CODE_EFFORT_LEVEL` can override frontmatter; model
aliases resolve by provider and installed version. Check effective settings before
delegation. Report conflicting overrides rather than claiming an unobserved
model. No permission or MCP configuration is changed by this policy.

## Research and evidence (2026-10-21)

| Question                                        | Official source                                                                                                                                                                                                                           | Finding and implication                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does OpenAI support this tier split?            | [Model selection](https://developers.openai.com/api/docs/guides/deployment-checklist#choose-a-model-for-the-workload)                                                                                                                     | Astra for highest capability, GPT-6.1 Sol for complex work, Luna for efficient repeatable work. This supports routing by assignment.                                                                                                                                                                     |
| Is medium required for all models?              | [API effort guidance](https://developers.openai.com/api/docs/guides/deployment-checklist#set-up-reasoningeffort), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents#reasoning-effort-model_reasoning_effort) | Medium is supported. API guidance routes low to routine work and medium/high to reasoning; the Codex guide suggests high as a starting point for Luna and low for Astra. Use Luna/high as the Codex starting recommendation; retain Sol/medium. These are project choices, not benchmark-derived optima. |
| Do Claude tiers and effort map directly?        | [Claude selection guidance](https://claude.com/resources/articles/claude-model-and-effort-level-in-claude-code), [model configuration](https://code.claude.com/docs/en/model-config)                                                      | Fable targets hardest work, Opus complex reasoning, Sonnet daily coding. Effort is calibrated per model; identical labels do not imply identical work. Aliases vary by provider/version.                                                                                                                 |
| Do named agent settings ensure runtime routing? | [Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents), [Claude subagents](https://code.claude.com/docs/en/sub-agents#choose-a-model)                                                          | Definitions are supported, but precedence differs across hosts and versions. Inspect actual model/effort before claiming qualification.                                                                                                                                                                  |

When an assignment fails, inspect its context, tools and scope first. If it had
sufficient context and tried thoroughly but could not solve the problem, consider
the higher routine tier. If it skipped necessary investigation or verification,
consider whether more effort within the existing authorized checks is appropriate.
This is a diagnostic heuristic, not automatic authority to select Astra/Fable or
run tests. The configured Luna/high and Sol/Opus/Sonnet medium settings remain
starting points until representative Orbyn tasks provide local evidence.

Read-only version checks returned **Codex CLI 0.133.0** and **Claude Code
2.1.150** on 2026-10-21. These CLI versions do not identify the running desktop
host's runtime version. Current online docs include newer features, so no claim
of their installed support follows from those docs alone.

For this update, `python3 scripts/check-agent-assets.py`,
`python3 scripts/sync-agent-skills.py --check` and `git diff --check` passed.
`codex features list` loaded project configuration and reported `fast_mode=false`.
That CLI did not list `ultrafast_mode`, so its configured false value is not
runtime proof that this older CLI implements the newer independent control.
No model invocation was used for those static checks. A later authorized native
Sol probe verified recorded Sol/medium. A fresh-chat named Luna probe then
verified Luna/high; delegate processing speed remains unverified. See the
[runtime verification receipt](../work/agent-runtime-verification-2026-10-21.md)
for the exact evidence and remaining limits.

Earlier Codex setup diagnostics accepted configuration loading but exited for
`TERM=dumb` and reported an optional MCP warning. They do not qualify these new
model routes. Static asset checks establish file integrity and configured routing
only. Named Codex discovery and recorded model/effort were subsequently verified
as described in the receipt; Claude runtime selection and delegate processing
speed remain unverified. This change does not switch an already running chat's model;
discovery may require a fresh session or host reload. No paid model trial is
required solely to validate policy documentation.

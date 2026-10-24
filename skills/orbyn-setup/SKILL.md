---
name: orbyn-setup
description: "Configure Orbyn repository skills, agent roles, models and session coordination for Codex or Claude Code when requested."
---

# Orbyn agent setup

Read [repository policy](../../AGENTS.md), [roles](../../docs/agents/roles.md),
[model policy](../../docs/agents/model-policy.md) and the actual host capabilities.
Inspect only relevant non-secret settings. Preserve unrelated config and MCP access.

Use `orbyn-agent` for complex assignments and `orbyn-light` for bounded
assignments, with the model and effort from [the shared registry](../../docs/agents/models.json).
Use `orbyn-workflow` for task routing and one canonical skill source linked into
both hosts. Standard processing only: no Fast, Priority,
Ultrafast or speed-optimized variants. Verify delegation against the named
definition; do not silently fall back to an inherited model or speed setting.
The registry's human-only tier requires explicit human selection; follow model policy. Do not
silently substitute an unavailable model or install a provider to hide the gap.

Follow [coordination](../../docs/agents/coordination.md) for requested project
sessions and bounded children. Keep prompts small, reuse suitable owners and
serialize shared writes. Do not create sessions or recursive agent chains merely
to complete setup.

For model updates, edit [the shared model registry](../../docs/agents/models.json)
for both providers, then run `python3 scripts/sync-agent-models.py --write` and
`python3 scripts/sync-agent-models.py --check`. Do not recreate host config from
an old snippet. The registry owns model/effort and standard-speed settings;
[model policy](../../docs/agents/model-policy.md) owns routing and authority.

Change only requested project or user configuration. Check syntax, discoverable
paths and the installed client's supported fields. A file does not prove runtime
discovery or effective model selection. State which changes affect future sessions
and which were actually observed. Project defaults cannot override every host flag,
environment setting or managed policy; do not claim a hard billing cap.

## Consumer-aware setup

Read the consuming project’s host definitions before applying the reference registry. The library may be installed without its model presets; installing skills does not authorize replacing the user’s preferred model. If the named tier or required processing mode is unavailable, report it and use only the permitted direct fallback.

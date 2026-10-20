---
name: orbyn-setup
description: "Configure Orbyn repository skills, agent roles, models and session coordination for Codex or Claude Code when requested."
---

# Orbyn agent setup

Read [repository policy](../../AGENTS.md), [roles](../../docs/agents/roles.md),
[model policy](../../docs/agents/model-policy.md) and the actual host capabilities.
Inspect only relevant non-secret settings. Preserve unrelated config and MCP access.

Use `orbyn-agent` for assigned roles, `orbyn-workflow` for task routing and one
canonical skill source linked into both hosts. Default to Sol/medium for Codex and
Sonnet/medium for Claude. Never select Astra, Fable, xhigh, max or ultra. Do not
silently substitute an unavailable model or install a provider to hide the gap.

Follow [coordination](../../docs/agents/coordination.md) for requested project
sessions and bounded children. Keep prompts small, reuse suitable owners and
serialize shared writes. Do not create sessions or recursive agent chains merely
to complete setup.

Change only requested project or user configuration. Check syntax, discoverable
paths and the installed client's supported fields. A file does not prove runtime
discovery or effective model selection. State which changes affect future sessions
and which were actually observed. Project defaults cannot override every host flag,
environment setting or managed policy; do not claim a hard billing cap.

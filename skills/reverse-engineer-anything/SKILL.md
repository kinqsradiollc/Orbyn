---
name: reverse-engineer-anything
description: "Analyze shipped binaries, packages, Electron/JavaScript apps or authorized runtime behavior with REA and preserve evidence provenance. Ordinary source questions use how."
---

# Reverse engineer anything

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Use REA when the answer depends on an artifact or runtime evidence unavailable
from ordinary source inspection. Read the complete
[REA skill](../../tools/rea/.agents/skills/reverse-engineer-anything/SKILL.md)
and only its relevant references. Every bundled reference stays with that source.

Discover actual connected tools and schemas. Do not assume copying this skill
installed the runtime or engines. If tools are absent, read
[repository tooling](../../docs/agents/tooling.md) before following upstream setup.
Use the pinned local CLI when built; do not implicitly replace it with latest npm.
Preserve target identity, request scope, evidence IDs and unknowns. Static evidence
cannot establish runtime behavior. Host/browser restrictions apply to all transports.

Broad investigations follow [coordination](../../docs/agents/coordination.md):
use a named project session when the user requests separately tracked work, and
at most two native subagents inside it for bounded questions. Give each a target,
evidence pointer and stopping condition. No recursive session/agent fanout;
Sol/medium or Sonnet/medium defaults, never Astra, Fable or maximum effort.
Close only owned resources when finished and keep unresolved cleanup explicit.

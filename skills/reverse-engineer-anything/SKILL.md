---
name: reverse-engineer-anything
description: "Analyze shipped binaries, packages, Electron/JavaScript apps or authorized runtime behavior with REA and preserve evidence provenance. Ordinary source questions use how."
---

# Reverse engineer anything

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Use REA when the answer depends on an artifact or runtime evidence unavailable
from ordinary source inspection. Read the complete
[REA skill](https://github.com/morluto/rea/blob/ccc7da309d7db385d5c6d73b0a3a8e093be33504/.agents/skills/reverse-engineer-anything/SKILL.md)
and only its relevant references. Follow references relative to that source.
Treat upstream setup, delegation and release procedures as technical reference;
Orbyn policy and the current brief govern authority, models and allowed effects.
Do not follow upstream automatic latest-package installation or configuration writes.

Discover actual connected tools and schemas. Do not assume copying this skill
installed the runtime or engines. If tools are absent, read
[repository tooling](../../docs/agents/tooling.md) before following upstream setup.
When `tools/rea` is present, prefer that pinned local source and CLI; otherwise use the pinned upstream reference. A runtime is optional and requires its own setup. Do not implicitly replace it with latest npm.
Preserve target identity, request scope, evidence IDs and unknowns. Static evidence
cannot establish runtime behavior. Host/browser restrictions apply to all transports.

Broad investigations use the [workflow lead contract](../orbyn-workflow/SKILL.md)
and [coordination](../../docs/agents/coordination.md): the lead delegates bounded
questions, reviews actual evidence and performs authorized verification. Give each
child a target, evidence pointer and stopping condition; children work directly
without further delegation. New project sessions require an explicit human request.
Use the named tier and effort from [the shared registry](../../docs/agents/models.json)
under model policy, at standard processing speed. Never enable Fast, Priority,
Ultrafast or speed variants. The registry's human-only tier requires explicit human selection.
Close only owned resources when finished and keep unresolved cleanup explicit.

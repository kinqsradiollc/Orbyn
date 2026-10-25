---
name: automate-me
description: "Capture explicitly requested working preferences in a reusable local skill, using the current conversation or user-selected examples."
---

# Automate me

Follow the consuming project's instructions and requested scope; use the
[portable defaults](../orbyn-workflow/references/project-policy.md) only where guidance is missing.

Locate an existing skill for the requested workflow before creating one. Use
only the conversation or records the user selected; do not mine unrelated sessions.
Distinguish explicit preferences from inferred patterns and one-off constraints.

Preserve useful defaults, tool permissions, task scope and existing authorization.
Use the available skill-authoring guidance, concise descriptions and references
loaded only when needed. Prefer a small edit over another overlapping mode skill.
Choose a repository path for shared conventions and a personal path only when
requested. Do not change global models, memory, connectors or schedules as a
side effect. Show the resulting file and the preferences it encodes.

## Preference → maintained owner

If the user repeatedly requests export readback, place that check in the export owner when they ask to encode it. Preserve what the preference actually covers: a PDF readback rule should not require application builds for a prose edit. Return the changed owner and an example of when it should not activate.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

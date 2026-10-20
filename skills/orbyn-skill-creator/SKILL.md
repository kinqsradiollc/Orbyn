---
name: orbyn-skill-creator
description: "Create, refine, merge or retire Orbyn repository skills while keeping task routing, technology boundaries, host discovery and documentation consistent."
---

# Maintain Orbyn skills

Read [AGENTS.md](../../AGENTS.md), [skill system](../../docs/agents/skill-system.md),
[stack boundaries](../../docs/agents/stack.md) and [documentation ownership](../../docs/agents/documentation.md).
Inspect nearby skills before editing. Prefer improving the existing owner over
creating a second skill that attracts the same requests.

## Define a useful contract

Write the trigger, expected input, result and boundaries. Identify the applicable
stack and role, the skills this one genuinely depends on, and its handoff. Use
`orbyn-research` for unknown host/specification behavior; do not assume tools from
another product exist here. Make examples realistic to Orbyn's architecture.

Keep essential choices in `SKILL.md`; put conditional templates or deep guidance
in linked references. Do not duplicate model/session/permission policy in every
skill. Name Orbyn-specific entrypoints `orbyn-*`; descriptive generic principles
can retain meaningful names. Keep third-party attribution in source/provenance
records, never as an inherited active agent identity.

## Author and integrate

Use a matching folder/name with lowercase letters, digits and hyphens (under 64
characters), and concise `name`/`description` frontmatter. Keep the description on one line
for the repository catalog generator. Describe actual routing,
not a catchall. Include only resources needed to perform the task. Do not add
placeholder folders, mandatory panels or a new approval flow without a reason.

Register the skill in `skills/catalog.json` with its category and maintainer-facing
routing relationship. Update the owning task route in the workflow/system guide
when needed. Use `python3 scripts/sync-agent-skills.py --write` to refresh the
catalog index and host links; review its diff. Never overwrite unrelated host
settings or install global skills/MCP providers as part of repository authoring.

For a rename or retirement, migrate incoming links and discovery paths first.
Keep source-to-local attribution maps correct; do not delete provenance to hide
an import. Update affected documentation and remove obsolete competing guidance.

## Validate the whole path

Run `python3 scripts/check-agent-assets.py` and
`python3 scripts/sync-agent-skills.py --check`. Check a few realistic routing cases:
expected trigger, adjacent task that should not trigger, missing tools/evidence,
and the downstream handoff. Check references and role/stack boundaries. Metadata
and routing inspection are static evidence, not proof of live model behavior.

Use an available host skill validator for frontmatter when present. Execute new
helper scripts in disposable scope and inspect their outputs. A live skill trial,
external effect or product test still needs applicable authorization. Avoid a
paid model panel just to validate documentation. Report checks actually performed,
remaining behavior gaps, changed files and local/committed delivery state.

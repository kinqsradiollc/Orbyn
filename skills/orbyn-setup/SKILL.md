---
name: orbyn-setup
description: "Set up Orbyn skills in an existing project for Codex, Claude Code or Cursor; preserve target guidance and migrate explicitly owned company skills. Model/role configuration requires separate scope and host support."
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

Follow the [offline setup contract](references/offline.md). Use local instructions
and references first; inspect available local tools without assuming internet,
a hosted model or a model subscription. Source URLs remain attribution/update
pointers. Setup and validation must not silently download missing dependencies.

## Complete setup from the user’s goal

A request to set up or migrate this project selects this workflow directly.
First resolve the [workspace layout choice](references/repository-workspaces.md):
ask once between nested (recommended/default for new workspaces) and an existing
project in place when the user has not selected a destination/layout. Honor an
explicit existing path or “use the default” without another question. Wait for
an unresolved choice before dependent writes; silence is not acceptance. Preserve
active checkouts and output; never relocate them merely to apply the default.
Inspect existing instructions, skills, docs and host settings; infer clear
company/repo ownership from that evidence, preview the selected changes, then
perform authorized registration/migration and checks. Do not ask the human to
invoke another skill or run helper commands the agent can execute. Use the
creator for authoring changes internally. Ask only for a consequential unresolved
ownership conflict or unavailable authority after the layout decision; preserve
that material and continue independent setup. Do not silently guess ownership
of a foreign installation.

## Consumer-aware setup

For targets inside a library-root `repo/`, follow the
[workspace contract](references/repository-workspaces.md). Resolve the target's
Git root and preserve upstream-owned instructions and skills in place. Local
contribution assistance differs from proposing adoption of this library. Setup,
local migration and model changes retain their separate scope.

Read the consuming project’s host definitions before applying the reference registry. The library may be installed without its model presets; installing skills does not authorize replacing the user’s preferred model. If the named tier or required processing mode is unavailable, report it and use only the permitted direct fallback.

Use [worktree policy](../orbyn-worktree/SKILL.md) when configuring repository
isolation. Identify the primary clone and established sibling worktree root;
record project-specific overrides in consumer-owned guidance. Do not relocate
active worktrees or create one merely to install skills.

## Agent-owned setup result

Within an authorized setup request, resolve the actual consumer root and library
clone under the selected layout, read consumer instructions, inventory current
skills/docs/config and identify the relevant stack. Choose the default/core or justified additive
selection yourself. Preview helper changes, migrate only clearly owned selected
skills with backups, register shared/local discovery, then initialize/check the
context map and add only source-grounded guide/owner pointers. Run local skill,
context and applicable shared-pin checks. Do not ask the human to fill out a map
or run a second setup invocation when you can inspect and complete it.

Report the consumer path, installed/retained skill sets, canonical local namespace,
preserved docs/config, backup/receipt, checks and unavailable host capabilities.
The human's requested setup is the authorization for these local reversible steps;
new models/providers, external publication and production effects retain their
own authority requirements. A dry-run is an internal preflight, not an automatic
additional approval gate.

## Select skills and project context

Inspect existing company/repo skills before setup. Follow the
[local ownership guide](references/project-skills.md): keep their canonical
content under the consumer's `project-skills/` namespace, preserve supporting
assets/credits, and register both host links. Reconcile legacy locations only
within authorized scope after classifying ownership; never overwrite collisions.
Keep local skills outside the shared catalog and public export. Use
`--project-skills` to register them with the installer, or the local helper for
registration without installing library skills.

Use the [preset catalog](assets/presets.json) with the library installer. New
installations default to `core`; `--all` is explicit. Presets are additive skill
selections, separate from model presets. Inspect with `--list-presets` and preview
with `--dry-run`; never remove an existing selection as a side effect.

Choose the actual host: `--host cursor` creates project `.cursor/skills` links;
`--host both` retains Codex/Claude behavior; `--host all` explicitly registers all
three. Cursor can also discover existing `.agents/skills` links, so do not add
duplicate links merely to claim support. Inventory all host discovery paths for
same-name target skills before setup; never assume which copy wins. Preserve
Cursor rules/settings and require `--host all` to reconcile selected Cursor copies
during a migration. These are skill paths, not portable model/role settings.

For an installation failure, report the original error, changes still owned by
the attempt, preserved concurrent replacements, cleanup failures and any backup
receipt. State the recovery boundary explicitly: ordinary exception rollback
does not provide crash or power-loss atomicity. Process interruption, a failed
cleanup or another writer requires inspecting actual paths before retrying.
Preserving a replacement is correct recovery behavior, not a successful install.

Use the [project-context guide](references/project-context.md) to create or check
`.agents/orbyn-context.json` in the **consuming checkout**, when setup is requested.
It points to existing instructions, stack, design, brand and verification guides.
Read relevant pointers on demand; the map supplies neither new permissions nor
commands. Keep it outside the shared skill export and preserve existing entries.

The core preset includes language-aware implementation and stack-selection
routing. Inspect the consumer's real manifests before selecting a guide; do not
infer that it uses TypeScript from this library's examples. The additive
`languages` and `architecture` presets support focused installations. This does
not install runtimes, choose a new stack or change the consumer's model settings.

Before reporting the installed version, identify the library checkout's HEAD,
branch and managed dirty state, and compare any consumer lock. Use the requested
reviewed release by default; do not silently install pending PR content as if it
were public `main`. A discovery link follows its source working tree, so report
that actual source and any unmerged/local changes. When online freshness cannot
be checked, keep the cached revision and limitation explicit.

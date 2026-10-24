# Keep company and repository skills with their owner

Resolve the consuming checkout before reading or creating skills. Installing
Orbyn Engineering provides reusable methods; it does not transfer ownership of
the consumer's internal conventions, procedures or intellectual property.

| Material | Canonical owner | Public skill sync |
| --- | --- | --- |
| Reusable library method or explicitly approved public improvement | Library `skills/<name>/`, shared catalog and provenance | Managed at the reviewed pin |
| Company/repository workflow or local adaptation | Consumer `project-skills/<company-or-repo>/<namespaced-skill>/` | Excluded |
| Existing instructions, stack, brand and design guides | Consumer's existing guides and optional context pointers | Excluded |
| Independent third-party skill | Its existing licensed source or a consumer-owned local copy with credit | No automatic contribution upstream |

For example, an Acme checkout can own
`project-skills/acme/acme-release/SKILL.md`, with `name: acme-release` and a concise
`description` in its frontmatter. Use lowercase hyphenated names under 64
characters and prefix each skill name with its company/repo namespace. A monorepo
can use several namespaces; each skill has exactly one canonical source.

Codex discovers `.agents/skills/acme-release`; Claude discovers
`.claude/skills/acme-release`. Both are relative links to the consumer-owned
folder. Discovery shares host directories, not content ownership. Neither a
namespaced skill nor its internal assets belongs in `skills/catalog.json`, the
public distribution manifest or `skills/upstream-lock.json`.

## Instructions for the agent

Before creating or adapting a skill, classify its audience and owner. A request
such as “teach the agent our company release process” belongs to that company's
namespace. Use existing company/repo naming and instructions. Inspect existing
local skills first; improve the existing owner instead of duplicating it. Keep
internal examples and policy local. A generic-looking procedure is not evidence
that its owner has approved public distribution.

Read applicable project instructions and relevant local skills along with the
shared method. Resolve local guide paths from the consuming checkout, never from
the installed library's symlink target. Local guidance can specialize the method;
it cannot expand user authority or host permissions. Keep reusable method changes
separate from company-specific overrides. Do not patch the shared upstream copy
merely to store local preferences.

If the ownership is clear and migration is within the authorized setup scope,
move existing company skills to the consumer namespace with a recoverable
backup, preserving content, supporting assets and applicable credits/licenses.
Inventory references and both host discovery paths first. Update the skill name,
callers, relative resource links and discovery links together, then validate the
new paths before removing the old duplicate. Moving a directory can break
relative references; inspect them rather than assuming a rename is sufficient.
Leave unrelated third-party installations alone. If ownership or redistribution
rights are unclear, preserve the files and report the unresolved decision. Never
overwrite a name collision or automatically export existing company material.

## Register and verify

From a complete library clone or vendored consumer, use its helper with the
**consumer root**, not the library root:

```sh
python3 /path/to/library/skills/orbyn-setup/scripts/project_skills.py link --project /path/to/company-repo --dry-run
python3 /path/to/library/skills/orbyn-setup/scripts/project_skills.py link --project /path/to/company-repo
python3 /path/to/library/skills/orbyn-setup/scripts/project_skills.py check --project /path/to/company-repo
```

The helper validates names/frontmatter and preflights both hosts before adding
links. It refuses collisions, symlinked source/host paths and foreign discovery
targets; it never migrates content, rewrites policy, exports or deletes skills.
Registration is explicit. The library installer can also register existing local
skills with `--project-skills`; ordinary installation preserves them. A vendored
consumer's `sync-agent-skills.py --write` maintains both sets, while its generated
shared index still lists only the upstream catalog.

Run the local helper check and public sync check as separate CI checks. Changing
company skills must leave the public lock valid. Public pull/export is limited
to the managed `skills/` allowlist, so it neither imports nor exports
`project-skills/`. This is a structural boundary, not a secret scanner or a
prohibition on an author manually copying private content. Review actual public
contributions and the consumer's Git visibility; a folder is not access control.


## Existing host-folder migration

After classifying a skill as consumer-owned, use explicit selected names:

```sh
python3 /path/to/library/scripts/install.py --project /path/to/company-repo --namespace acme --migrate-skill release --dry-run
python3 /path/to/library/scripts/install.py --project /path/to/company-repo --namespace acme --migrate-skill release
```

The default shared preset is also installed. Choose `--skill` / `--preset` when
needed. Migration stages originals, retains licenses/assets, normalizes the local
frontmatter name, and registers both hosts. Divergent copies, unsafe symlinks,
managed-tree ownership or references needing rebasing stop before writes. Backups
and a JSON receipt stay in a private sibling directory outside the checkout.
Ordinary write exceptions roll back owned changes; an interrupted process or
failed recovery requires inspecting that receipt. Keep backups until reviewed.

The helper does not rewrite project docs or arbitrary textual skill references.
Agents must inspect incoming references and update only authorized owning docs.
External source folders stay intact when selected host symlinks are replaced.
Use ordinary registration after migration; repeating an obsolete old name is an
error, never a signal to overwrite an existing canonical local skill.

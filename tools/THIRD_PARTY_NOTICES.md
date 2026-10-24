# Imported agent tooling

## pstack

Full tracked plugin source from [cursor/plugins](https://github.com/cursor/plugins),
`pstack` subdirectory, revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Copyright 2026 Lauren Tan. MIT license: [original license](pstack/LICENSE).
Orbyn's pstack skill adaptations in `skills/` derive from this source; the original
copyright and permission notice apply to those adaptations as well. The complete
plugin, including all 34 skills, references, playbooks and helpers, is retained.

## Reverse Engineer Anything (REA)

Full tracked source from [morluto/rea](https://github.com/morluto/rea), revision
`ccc7da309d7db385d5c6d73b0a3a8e093be33504`, package 6.7.0.
Copyright 2026 morluto. MIT license: [original license](rea/LICENSE).
Bundled dependencies retain their own licenses and
[third-party notices](rea/THIRD_PARTY_NOTICES.md). Five optional submodules retain
their original repositories and exact revisions in the root `.gitmodules` and Git
index; they are not initialized by this migration.

## Provenance

[upstream-manifest.json](upstream-manifest.json) records 85 pstack files and 4,933
REA files, their hashes, executable bits and gitlink pins. Local adaptations are
separate from those immutable snapshots. No upstream repository history, installed
dependencies, generated outputs or local caches are included. Follow
[tooling](../docs/agents/tooling.md) to update or use the source deliberately.


## Portable offline reference additions

The shared tree carries original pinned source text under its original license:
Corey Haines social (MIT), Anthropic canvas-design text (Apache-2.0), Cloudflare
security audit (MIT) and Matt Pocock engineering/productivity Markdown (MIT).
See the local records in [social writing](../skills/social-content/references/source-record.md),
[social preview](../skills/social-preview/references/source-record.md),
[audit protocol](../skills/orbyn-security-audit/references/protocol.md) and
[engineering methods](../skills/orbyn-workflow/references/engineering-methods.md).
Hash-pinned snapshots are reference data under Orbyn policy. Existing full source
snapshots above are unchanged. Complete additional research archives are retained
in the public library; the consumer receives portable managed references.

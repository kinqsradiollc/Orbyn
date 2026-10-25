# Retained tooling and helper notices

These source snapshots are retained for provenance. They do not install an active
engineering skillset in Orbyn. Engineering guidance is maintained in the
[outer workspace](https://github.com/kinqsradio/orbyn-fullstack-skills).

## pstack

Full tracked plugin source from [cursor/plugins](https://github.com/cursor/plugins),
`pstack` subdirectory, revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Copyright 2026 Lauren Tan. The complete original MIT notice remains in
[pstack/LICENSE](pstack/LICENSE). All 85 recorded source files remain unchanged.

Former local adaptations and their notices are preserved in Git history and in
their maintained public engineering library. The copied installation and its
adaptation map were retired from this application; source names are attribution,
not active roles or task instructions.

## Reverse Engineer Anything (REA)

Full tracked source from [morluto/rea](https://github.com/morluto/rea), revision
`ccc7da309d7db385d5c6d73b0a3a8e093be33504`, package 6.7.0.
Copyright 2026 morluto. The original MIT notice remains in [rea/LICENSE](rea/LICENSE).
Bundled dependencies retain [their notices](rea/THIRD_PARTY_NOTICES.md). The five
optional provider submodules retain their exact repositories and revisions in
`.gitmodules` and the Git index. They are not initialized by this cleanup.

## Project-owned CI helper

`scripts/ci_scope.py` was adapted from Orbyn Engineering's portable CI helper at
public revision `251cd2e9013d2cbb74a6b3c4b88243c7a4094813`. Its complete
[MIT notice](../scripts/licenses/ci-scope-MIT.txt) is retained. Orbyn now owns its
classifier, aggregate gate and deployment-receipt validation; no external skill
installation is needed to run CI.

## Integrity and historical records

[upstream-manifest.json](upstream-manifest.json) continues to record 85 pstack and
4,933 REA source files, hashes, modes and gitlink pins. It and the source trees
are unchanged. [Operations](../docs/operations.md) explains their bounded use;
`python3 scripts/check-tool-sources.py` checks static integrity without executing
upstream engines. Dated research records describe their original review context.
Retired local-guide links in those records point to the historical public revision.

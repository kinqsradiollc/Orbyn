# Nested engineering workspace migration — 25 October 2026

## Decision and ownership

The public `orbyn-fullstack-skills` workspace owns engineering guidance and host
configuration. Orbyn owns application source, project documentation and its CI.
Orbyn no longer installs a copied skill tree or pins/pulls public skill releases.
Future project-owned instruction files, settings and local skills remain allowed;
the removal below applies to today’s known duplicated installation.
Other targets retain their own upstream instructions and skills; retiring Orbyn's
explicitly duplicated installation does not authorize deleting those targets' rules.
See [CONTRIBUTING](../../CONTRIBUTING.md) for the entrypoint and intended layout.

This candidate removes the duplicated root agent entrypoints, generated host
settings/roles/discovery, installed skills and lock, project-skill scaffold and
installation/sync checks. The CI classifier, aggregate gate and deployment receipt
validator now live in `scripts/ci_scope.py`, with the original MIT notice retained.
The skills-only lane is retired; docs/full scope and conservative deployment
selection remain. Vendored source validation is project-owned and independent of
host discovery. Current guide links have a separate document check.

Application facts from the retired agent guides survive in
[development](../development.md), [operations](../operations.md) and
[design](../design.md). The full generic engineering policy is not copied there.
Historical records retain their dated meaning. The product's connector skill at
`docs/agent-skill/orbyn/` is an application contract, not an engineering installation,
and remains intact.

## Existing work and preservation

Product documentation PR #231 was reconciled with current main, source-checked,
formatted and merged as `beb060d2f87d6447462042dca595781e70e5b382` after fresh
required checks passed. Its five application lanes were intentionally skipped
for docs-only scope. This cleanup includes that merged documentation as its base.
Five older draft app stacks remain separate: no source-equivalence conclusion or
closure follows from their historical checks or conflicting merge state.

The active legacy primary checkout is not moved. Several live processes use it;
its untracked audit documents, output and private configuration retain their owner.
The preservation inventory grew beyond older release receipts and must be captured
again before any main fast-forward or cleanup. An unintended task-owned public
helper was moved by its author out of primary after a hash comparison; it is not
part of this application candidate.

A later fresh nested clone may be prepared at
`orbyn-fullstack-skills/repo/Orbyn` with sibling `repo/orbyn-wt/`. Such a clone does
not transfer local files, environment settings, databases or process ownership.
The existing primary remains the active local-work/recovery owner until an explicit
transfer is complete. Filesystem nesting does not establish live host discovery.

## Evidence and delivery limits

- Twenty-four focused CI/source-integrity/boundary checks pass in disposable repositories.
  They cover normal and rejected classification/gating/deployment records, safe
  server preflight, retained source hashes, file modes, external symlinks,
  tracking and gitlink revisions. Indexed-path guards reject recognized retired installation
  controls and force-added research, including bare symlink/gitlink research roots.
  Negated ignore rules do not count as exclusions. Positive controls retain staged
  project AGENT/AGENTS, host settings and local skills, including same-name skills.
  The guard does not classify prose ownership. Checks allow product connector guidance,
  retained tool snapshots and untracked private work.
- The first local verification attempt for the project-guidance correction failed
  with seven ENOSPC environment errors. No unrelated data was deleted; after disk
  headroom recovered, the complete 24-case retry passed. Both outcomes are retained
  in the external preservation evidence. Earlier-head CI is not final-head evidence.
- All 5,018 retained upstream files and five gitlink pins pass static validation.
  REA/pstack source trees, `tools/upstream-manifest.json`, `.gitmodules`, application
  code, runtime manifests and deployment scripts are unchanged.
- Current guide links, changed authored-document formatting, Python syntax and
  whitespace checks pass. Historical work records are outside current-guide link
  checks because their source paths describe earlier revisions.
- The cleanup changes CI implementation/paths, so it requires fresh hosted full
  application CI on its final candidate. Local fixture success is not that result.
- No application, REA engine, native provider, deployment or client/model setup
  was run locally. The engine/runtime upgrade remains deferred.

The owning lead reviews the frozen candidate before an authorized merge. Hosted
checks and any subsequent main sync or worktree removal must be reported with
the actual source identity and preservation receipt; this record does not assert
those later delivery steps have happened.

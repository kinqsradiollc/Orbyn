# Orbyn workflow migration

## Current structure

- `AGENTS.md` owns the policy; `AGENT.md` and `CLAUDE.md` are host entrypoints.
- `orbyn-agent` is the configured agent. [Orbyn roles](roles.md) define its bounded
  assignments; `orbyn-workflow` routes tasks and `orbyn-setup` maintains settings.
- There are 45 canonical skills and 16 task playbooks. Both hosts use per-skill
  links to the same files. Ten old standalone skill documents were removed. The Orbyn planner, researcher
  and skill creator share a stack guide and explicit routing catalog.
- Delivery and status guidance now live in `docs/agents/`. The documentation
  index and verification guide describe current contracts and evidence boundaries.
- Complete third-party sources remain under `tools/`, with unchanged licenses,
  hashes and dependency pins. Source identities are provenance, not active branding.

## Retired documentation

The old `docs/adr/` and `docs/reviews/` trees, the dated DevDay pointer and durable-run
verification report were removed from the active tree. Current delivery/status
guides were relocated first. The dated verification report was replaced with an
evergreen guide. Product architecture, API, setup, deployment, mobile, MCP and
plugin references remain; their application contracts were not replaced by skills.

An exact 204-file local archive was created before retirement, including
uncommitted documents and the old standalone skills. Each archived file was read
back and matched by SHA-256. Recovery location for this local migration:

`/Users/anhdang/Documents/Orbyn documentation archives/20261021-103444`

The directory contains `legacy-docs.tar.gz`, `manifest.json` and the pre-retirement
Git status. It is outside the repository and is not automatically shared by a
future clone. Committed history also remains available through Git. Do not treat
archived pause instructions or review outcomes as current policy or qualification.

## Checks and limits

Use `python3 scripts/check-agent-assets.py` for source hashes, dependency pins,
skill discovery links, Orbyn agent identity, host defaults and maintained-doc links.
The migration uses static documentation/configuration checks. No application
builds/tests, paid model qualification or REA engine setup are implied. Earlier
host diagnostic limitations remain in [model policy](model-policy.md).

The migration is delivered through `codex/agent-workflows`. Git and the pull
request record its delivery state. Unrelated application/config changes are
preserved separately during checkout cleanup. No deployment is part of this work.

The new catalog synchronizer maintains both host links and the skill index.
Planning and UI research is recorded under tooling; active workflows use Orbyn
components and actual host capabilities. The supplied UI reference files remain
unchanged in their source folder and are not required by the new skills.

## Final static checks

The asset checker passed for 5,018 preserved files, five dependency pins, 45 skills
and all maintained Markdown links. The catalog/index/host-link check passed;
the initial 44 entrypoints passed skill frontmatter validation. The new synchronizer was
exercised in a temporary repository for missing-link detection, generation,
idempotence and refusal to replace an unrelated file. Stack source pointers were
checked against the working tree, and the authored-file whitespace check passed.
Unchanged upstream snapshots retain their original whitespace. No live model
trial, product suite or visual inspection was run for this documentation task.

The migration was reconciled with current main, retaining its security remediation
skill and newer UI/product contracts. Current main's retired ADR/review trees are
also preserved in the local worktree recovery archive and Git history.

Checkout cleanup recovery: `/Users/anhdang/Documents/Orbyn worktree archives/20261021-105013`.
This contains original local configuration, untracked source/reference material,
ignored native project files and the latest retired-document snapshot. Managed
worktree snapshots remain recoverable through the app. Recovery data is local
and is not part of the repository.

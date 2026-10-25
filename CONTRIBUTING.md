# Contributing to Orbyn

Engineering work uses the [Orbyn Engineering workspace](https://github.com/kinqsradio/orbyn-fullstack-skills).
Follow that workspace's current setup guide and start the engineering session
from its root. Coding agents begin with [AGENTS.md](AGENTS.md); AGENT.md and
CLAUDE.md point to that same project entrypoint.

## Engineering setup

When starting from an ordinary Orbyn clone, the agent should prepare this setup
within the contributor's authorization:

1. Inspect the current Git root, remotes, branch, worktrees and local commits.
   Inventory uncommitted work, private configuration, valuable output and active
   processes before changing paths. Preserve needed files and recovery refs;
   do not move an active session's checkout or overwrite an existing directory.
2. Obtain or reuse a complete, verified checkout of the
   [Orbyn Engineering library](https://github.com/kinqsradio/orbyn-fullstack-skills).
   Clone it for use; a library fork is only needed when contributing library
   changes without upstream write permission. Read its current AGENTS.md and
   relevant setup/worktree methods before proceeding.
3. Open that outer library as the engineering workspace. Use its workspace helper
   to prepare ignored `repo/`, then create or reuse an independent target clone
   at `repo/Orbyn`. Verify the target's actual Git root, common metadata, origin,
   revision and local state. A fresh clone contains committed source only;
   reconcile local branches, edits, configuration and outputs with their owners
   before reporting the old checkout as migrated.
4. Run the outer workspace check for the selected target. Read Orbyn's root and
   applicable nested instructions, contribution rules and local skills alongside
   the relevant outer methods. If automatic host discovery is not observed,
   read them explicitly and report that limit. Reopen the workspace through a
   supported host action; never rewrite internal app state to rebind an active
   session or claim that its working directory changed when it did not.

For a fresh destination, the Git layout can be prepared with the following
commands. Reuse verified existing checkouts instead of running these over them:

```sh
git clone https://github.com/kinqsradio/orbyn-fullstack-skills.git
cd orbyn-fullstack-skills
# Open this directory as the agent workspace and read AGENTS.md.
python3 skills/orbyn-setup/scripts/workspace.py prepare
git clone https://github.com/kinqsradiollc/Orbyn.git repo/Orbyn
python3 skills/orbyn-setup/scripts/workspace.py check --target repo/Orbyn
```

Use sibling task worktrees only when isolation is needed. The expected layout is:

```text
orbyn-fullstack-skills/
  repo/
    Orbyn/                 application checkout
    orbyn-wt/<purpose>/    application task worktrees
```

The outer workspace owns shared engineering methods and its own host configuration.
This repository owns application source, CI and the project guides below. It does
not carry a copied skill installation, public-skill pin or synchronization job.
Nesting alone is not proof that a host loaded instructions or skills; read the
workspace guidance and the relevant target guides explicitly.

Orbyn may add its own project-specific `AGENT.md`, `AGENTS.md`, `CLAUDE.md`,
Cursor rules, host settings or local skills in future. Read those alongside the
outer methods: target guidance specializes compatible shared methods and governs
its stack and contribution contracts. Resolve material conflicts before edits.
Today's removal retires the known duplicated installation, not those filenames
or future target-owned guidance. Preserve other targets' own guidance as well.

CI rejects recognized legacy installation controls (catalog, pin and old sync
commands) and tracked raw research. It does not infer ownership from prose or
skill names, detect every possible copy, or prove an agent read a policy.
Reviewers remain responsible for those semantic checks.

## Contribution destination

Orbyn owners and maintainers with verified upstream write permission can publish
approved task branches directly to `kinqsradiollc/Orbyn` and open PRs against its
`main`; a personal fork is not required. Other contributors use the contribution
path permitted by their account and the repository. Verify the actual remote,
permission and requested delivery scope before any push. Cloning or preparing a
workspace does not authorize a push, PR, merge or deployment.

Changes to shared methods belong in the separate engineering library. Use that
library's contribution rules and a fork when upstream write permission is absent;
do not mix its changes into an Orbyn application PR.

## Project guides

- [Development](docs/development.md): stack, module boundaries, local commands,
  disposable databases and CI behavior.
- [Operations](docs/operations.md): environment and service ownership, recovery
  boundaries and retained tooling snapshots.
- [Product design](docs/design.md): Orbyn's tokens, controls and interaction conventions.
- [Setup](docs/setup.md), [architecture](docs/architecture.md) and
  [verification](docs/verification.md): application contracts and evidence limits.

Existing checkouts and running processes must be preserved during adoption. A
fresh nested clone has its own Git state; it does not inherit uncommitted work,
ignored output, environment files, databases or process ownership from another
checkout. Keep those assets in their existing owner until a deliberate transfer
is complete. Do not move an active checkout merely to match the layout.

Use the workspace's contribution workflow for planning, review and delivery.
A pull request should describe its application changes, checks actually run and
remaining limits. Current source and package scripts define project behavior.

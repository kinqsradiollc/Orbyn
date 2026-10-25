# Contributing to Orbyn

Engineering work uses the [Orbyn Engineering workspace](https://github.com/kinqsradio/orbyn-fullstack-skills).
Follow that workspace's current setup guide and start the engineering session
from its root. The expected layout is:

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

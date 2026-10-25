# Contributing to Orbyn

Engineering work uses the [Orbyn Engineering workspace](https://github.com/kinqsradio/orbyn-fullstack-skills).
Follow that workspace's current setup guide and start the engineering session
from its root. The expected layout is:

```text
orbyn-fullstack-skills/
  repo/
    Orbyn/                 application checkout
    Orbyn-wt/<purpose>/    application task worktrees
```

The outer workspace owns engineering policies, skills and host configuration.
This repository owns application source, CI and the project guides below. It does
not carry a copied skill installation, public-skill pin or synchronization job.
Nesting alone is not proof that a host loaded instructions or skills; read the
workspace guidance and the relevant target guides explicitly.

When contributing to another target, preserve and follow that target's own
instructions and skills alongside the outer workspace. Orbyn's previous copied
installation was deliberately retired; this does not authorize deleting another
project's guidance.

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

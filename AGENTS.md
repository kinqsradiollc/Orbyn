# Orbyn project instructions

This is Orbyn's project-owned entrypoint for coding agents. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before editing and follow its
[engineering setup](CONTRIBUTING.md#engineering-setup) when starting from an
ordinary Orbyn clone. Complete authorized setup steps for the contributor;
do not ask them to invoke each helper manually.

## Workspace and preservation

Use a complete [Orbyn Engineering library](https://github.com/kinqsradio/orbyn-fullstack-skills)
checkout as the outer agent workspace, with an independent Orbyn clone at
`repo/Orbyn` and task worktrees at `repo/orbyn-wt/<purpose>/`. Shared methods and
host configuration stay in the outer library. Do not install, copy or synchronize
those skills into Orbyn, or add a public-skills pin.

Before adoption or cleanup, inspect both repositories, branches, worktrees,
uncommitted work, private configuration, output and active path owners. Preserve
valuable work and recovery refs. Never move an active checkout or treat a fresh
clone as a transfer of its environment, local changes or running services.

Read the outer entrypoint and relevant methods, then Orbyn's root, applicable
nested instructions and local skills. Read required files explicitly when host
discovery is unobserved; nesting alone does not prove they were loaded. Preserve
legitimate project-owned guidance and skills, including same-name skills. User
scope and host permissions take precedence; resolve material instruction
conflicts before dependent work.

## Application contracts

- [Development](docs/development.md): stack, module ownership, commands and CI.
- [Operations](docs/operations.md): environment, services, data and retained tools.
- [Design](docs/design.md): product conventions and responsive behavior.
- [Verification](docs/verification.md): evidence and qualification limits.

Use these maintained guides and current source rather than copying shared policy
here. Match checks to the change and the user's scope; documentation needs link
and document checks, not a product build. Report actual local, committed, pushed,
merged and deployed states separately. Setup does not authorize publication,
production changes or a REA engine upgrade.

Orbyn owners and maintainers with verified write permission may use the canonical
`kinqsradiollc/Orbyn` upstream directly. Other contributors follow its contribution
and permission rules. Cloning the skills library for use does not require a fork;
contributing changes to that library is a separate delivery task.

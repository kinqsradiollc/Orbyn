---
name: orbyn-worktree
description: "Manage local task branches, private contribution storage when supported and Git worktree isolation; use sibling <repo>-wt directories, purpose-based names and preservation before cleanup."
---

# Worktree ownership and lifecycle

Use this skill when a task needs checkout isolation, the user requests a worktree,
or an existing worktree needs reconciliation/cleanup. The owning
[workflow](../orbyn-workflow/SKILL.md) selects it from the ordinary task request;
the human does not need a separate invocation. Follow the consuming project's
instructions, requested checkout and host permissions. A small clear edit can
stay in its current checkout; a new worktree is not mandatory for every task.

## Resolve the repository and owner first

Inspect the current checkout, branch, HEAD, tracked/untracked changes and
`git worktree list --porcelain`. Resolve the primary clone and common repository
from Git registration and the task, rather than assuming the current working
directory is the primary clone. A linked worktree's `.git` is normally a pointer;
do not treat it as another independent clone or derive another `-wt` root from it.
Bare or separately configured Git directories need an explicit project anchor.

Check existing worktrees and any applicable host attachment inventory before
creating another. Reuse a suitable worktree only when its repository, task owner,
branch, source and local work fit this task. A clean directory is not evidence
that another active session has released it. Preserve unrelated changes and
outputs; do not stash, reset, switch another owner's checkout, copy dirty files
or move existing worktrees merely to enforce this convention.

## Sibling location and names

The nested library-root `repo/` option keeps contribution clones and
worktrees together; follow the [nested repository contract](../orbyn-setup/references/repository-workspaces.md).
It is the recommended/default choice for new contribution workspaces after the
setup agent resolves the user's layout choice, not a reason to move existing work.
For `orbyn-fullstack-skills/repo/widget`, use sibling `repo/widget-wt/<purpose>/`.
Target instructions and skills apply to its work; the outer library owns its
ignore/export boundary. Do not put targets inside canonical `skills/`, infer
target cleanliness from library status, or relocate existing work for this layout.

For a primary clone `<parent>/<repo>`, the default root is its sibling
`<parent>/<repo-slug>-wt/`. Use a stable lowercase hyphenated repo slug; reuse an
existing established sibling root rather than creating a case-only alternative.
Each worktree has one direct child directory named for its purpose:

```text
Documents/GitHub/
  orbyn/                         primary clone
  orbyn-wt/
    task-rescheduling/           feat/task-rescheduling
    save-retry/                  fix/save-retry
    worktree-policy/             chore/worktree-policy
```

Use lowercase letters, digits and hyphens for a short directory slug, normally
under 64 characters. Use neutral branch prefixes such as `feat/`, `fix/`,
`chore/`, `docs/` or `refactor/`. Do not use agent, assistant, vendor or model
branding in a new branch or directory name. Avoid path separators, traversal,
spaces, Windows device names and case-only distinctions. A directory leaf uses
the purpose slug, not the branch's slash-separated path.

Inspect collisions before choosing another name. If the existing path/branch is
unrelated or still owned, choose a distinct purpose or a suffix such as `-2`;
never overwrite a directory, reuse a foreign branch or use force to bypass Git's
already-checked-out protection. Keep existing legacy paths/branch names intact.
An explicit user location or an established consuming-project policy wins.

## Keep task branches local and publish deliberately

A worktree and its branch are local Git state. Creating them does not require a
branch on the company's remote. Reuse one owned task branch and worktree through
implementation, correction and review. Do not create another branch for each
agent, phase or retry. Independent writers may need bounded temporary local
branches/worktrees; consolidate their changes into the owning task branch and
retire them only after preserving the work. Never push every delegate branch.
Serialize operations on shared Git refs, remotes and configuration under one owner.

Keep work local by default. Publish only when pushing/PR delivery is authorized
and the patch is concrete and reviewable. Inspect existing project contribution
policy, sanitized remote identities, upstream relationship, repository visibility,
account permission and fork restrictions before choosing a push destination.
A remote named `origin` is not evidence that it is a personal fork.

For company upstreams, prefer one existing permitted **private** personal contribution fork
for the approved account. Create one only within authorized delivery/setup scope
and when company/host policy allows it. Use a meaningful stable name such as
`<Repository>-contributions`, retaining the upstream identity:

| Identity                                             | Example                                       |
| ---------------------------------------------------- | --------------------------------------------- |
| Company upstream                                     | `company/Orbyn`                               |
| Reused personal fork                                 | `approved-account/Orbyn-contributions`        |
| Task branch on that fork, when publication is needed | `feat/task-rescheduling`                      |
| Local task checkout                                  | `Documents/GitHub/orbyn-wt/task-rescheduling` |

### Privacy before publication

Prefer private contribution storage whenever the host, upstream visibility and
organization policy support it. Inspect the actual API/host result after creation;
a requested flag or a private-sounding name is not visibility evidence. Verify
upstream permissions and organization approval before copying restricted code
into any personal account, including a private repository.

On GitHub, native forks of a public repository are public and cannot independently
be made private. Private upstream forks stay private where forking is permitted;
internal-repository behavior also depends on account/enterprise policy. Do not
attempt to bypass these rules or promise a private public-parent native fork.

If the desired privacy is unavailable, keep task branches/commits local. Within
explicit backup scope, a permitted private standalone repository can hold work,
but it is a separate repository, not a native fork or an automatic upstream PR
source. Verify its actual visibility, access and remotes before any push. Do not
create it merely because an API token can. Never detach, delete or recreate an
existing fork, rewrite its history or change upstream visibility to enforce a
naming/privacy preference.

When a public upstream PR is explicitly authorized, promote only its reviewed
allowlisted changes through the required public contribution path. Keep unrelated
branches, company-only material, reports and backups local/private. Explain the
visibility boundary before a public push when privacy was requested; if public
publication is not authorized, preserve the patch and report the specific limit.
A private backup does not retract commits already published to a public network.

Verified 24 October 2026 against [GitHub fork visibility and permissions](https://docs.github.com/en/pull-requests/reference/forks).
Other providers require their own current policy check; do not generalize GitHub's
constraints into a universal claim about forks.

Verify that a candidate fork actually belongs to the intended upstream; matching
names are insufficient. Preserve an established fork/name rather than renaming it
or creating one per task. A local worktree stays within the primary clone's Git
repository and can push its task branch to the permitted fork remote; it is not
another hosted fork. Keep fetch/base selection tied to the canonical upstream
and target the contribution PR back to the correct upstream branch.

Never copy private/restricted company code into a public or otherwise unauthorized
fork, standalone mirror or account. An available API token does not establish
redistribution authority. If forks are disallowed, use an explicitly authorized
internal contribution path; otherwise preserve the local branch/commits and prepare
a reviewable patch with the exact publishing blocker. Do not silently fall back
to pushing a new company branch or stop independent local work. Respect an existing
explicit company-branch instruction instead of inventing a fork requirement.

Before any push, verify the destination account/repository/visibility, source
branch and refspec. Add/change a remote or branch tracking only within scope;
do not rewrite `origin`, alter global Git settings, force-push a foreign branch
or publish merely because a branch exists. Report where work is local, backed up,
pushed and proposed for review. A local branch is recoverable only while its
checkout/Git data remain; preserve valuable unpushed work before cleanup.

## Create and verify the selected checkout

For unattended execution, verify required host capabilities on a disposable
checkout with the actual topology before expensive work. A primary-clone commit
probe does not establish write access to a linked worktree's separate Git index
or common metadata. Test only effects already authorized by the task.
If the host denies metadata writes, preserve the patch and report delivery as
blocked; do not rewrite `.git`, supply an alternate index or bypass the sandbox.
A separately authorized new workspace must have its own readiness evidence;
never move or reset existing owned work to manufacture a passing probe.

Resolve the requested base revision before writes. Continue an existing task/PR
from its actual branch or reviewed commit. For new work, use the project's
verified default branch/ref; do not assume that an unrelated current feature
branch or a stale local `main` is the desired base. Fetch only when available and
authorized; label an offline/cached base as such. A clean worktree does not copy
the primary checkout's uncommitted changes. If those changes are required, plan
a selective, recoverable transfer with their owner instead of silently omitting
or copying them.

Use a supported host worktree tool when it meets the requested layout and
ownership contract. If its storage path is fixed elsewhere, report the limitation
and use a permitted Git operation when appropriate; do not claim a custom path
was honored when the tool chose another. Creating a worktree does not create a
new project chat or authorize messaging another owner.

For a **new** branch with a verified base, an example operation is:

```sh
git -C /work/orbyn worktree add -b feat/task-rescheduling /work/orbyn-wt/task-rescheduling origin/main
git -C /work/orbyn-wt/task-rescheduling status --short --branch
git -C /work/orbyn-wt/task-rescheduling rev-parse --show-toplevel HEAD
```

These paths/ref are examples, not values to copy into another project. Reuse an
existing branch with `worktree add <path> <branch>` only after ownership/checkout
inspection. Avoid `-B`, `--force` and duplicate branch checkouts. Verify the final
path, branch, base/HEAD and status before editing. Use the selected worktree as
the working directory for every subsequent edit/check; reread relevant nested
instructions there. Preserve project environment files; do not automatically copy
secrets or run setup hooks from source. Worktrees share Git objects and may still
share databases, ports, fixtures or external services: assign those separately.

## Preserve before cleanup

Clean up only an owned, inactive worktree within the authorized delivery/cleanup
scope. Check tracked and untracked changes, unpushed/unmerged commits, locks,
ignored output, local configuration and active processes. `git status` alone does
not reveal ignored artifacts. Inspect ignored paths without printing secrets;
classify reproducible dependency caches separately from valuable output and
configuration. Preserve needed data in an owned recoverable location first.

For managed worktrees, use their supported archive flow and separately preserve
needed ignored files. For ordinary Git worktrees, use `git worktree remove` on
the verified exact path after preservation; never delete a checkout with a blanket
filesystem removal, forced reset/clean or force removal. Do not delete branches
or prune another owner's registrations as an incidental step. Move/repair/prune
only a diagnosed owned registration within scope; removal of a directory alone
does not reconcile Git metadata. If preservation or ownership is unresolved,
leave the worktree intact, record the reason and continue independent work.

Return the primary clone, sibling root, selected path, branch/base/HEAD, owner,
preserved data and actual retained/removed/archived state. A merged PR does not
prove its local checkout or outputs are safe to delete.

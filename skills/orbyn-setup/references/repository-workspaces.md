# Independent contribution repositories inside a library checkout

Nested is the recommended default for a new contribution workspace. Offer the
two layouts below before creating a checkout or registering discovery when the
user has not chosen one. This is a workspace decision, not a preset/model choice.

| Layout | Location | When it fits |
| --- | --- | --- |
| Nested (recommended/default) | `<library>/repo/<project>/`, worktrees at `<library>/repo/<project>-wt/<purpose>/` | New contribution clones kept beside the shared library |
| Existing project in place | The user's existing project path, with its established sibling worktree root | An active project or preferred checkout elsewhere |

Ask one short question, with nested first and preselected when the host supports
choices: “Where should I set up this project: nested under `<library>/repo/`
(recommended/default), or keep an existing project in place?” Include resolved
paths and an existing-checkout option when known. An explicit layout, destination
or request to set up a named existing checkout already answers the question;
honor it without asking again. A current working directory alone does not select
a layout for a new contribution workspace.

Wait for the answer before layout-dependent writes; inventory known paths and
read instructions while waiting. A preselected default or silence is not an
answer. If the user says “use the default” or delegates the layout choice, select
nested and report its paths. Do not repeatedly ask during reinstall, validation,
worktree continuation or later ordinary tasks. No separate skill invocation is
needed after the choice.

Existing projects elsewhere keep their location. Nested is not a reason to move
active work, create a duplicate clone, alter remotes or clone an unrelated repository.
Explain an existing checkout/collision before proposing a new destination. Use
the selected layout for new authorized work; relocation needs explicit scope and
preservation of existing work and output. Once identity, destination and authority
are clear, complete authorized setup rather than asking the human to run commands.

```text
orbyn-fullstack-skills/           library Git repository
  skills/                       portable library methods
  orbyn-references/              ignored read-only research
  repo/                         ignored independent workspaces
    widget/                     independent target clone
    widget-wt/
      pagination-fix/            linked worktree of widget
```

`repo/` belongs at the library root, never inside canonical `skills/`. Its clones
are independent repositories, not library submodules or vendored skill assets.
Read-only comparisons stay in `orbyn-references/`; a contribution checkout owns
its own remote, branch and delivery scope. Nesting is not a shared environment,
database, account or permission boundary.

## Select the target before acting

Resolve library and target roots explicitly. Use the target's Git top-level,
common-directory and worktree registration to identify its primary clone; an
installed skill's symlink target is not the project root. Use an explicit working
directory or `git -C` for every operation. A command at the library root still
acts on the library. Resolve ambiguous targets before writes and continue safe
independent reading. Refuse a default `repo/` path that is a symlink or collides
with non-directory content; do not delete user data to repair the layout.

Read target root and applicable nested instructions: AGENTS.md, CLAUDE.md,
codex.md, `.cursorrules`, `.cursor/rules/` and relevant contribution, security and skill
guidance. Respect the host's real instruction precedence; a nested `.git` does
not guarantee isolation from ancestor instructions. Library maintenance rules
are not a mandate to change a target's architecture or agent configuration.

Use target conventions for implementation and publication, supplementing them
with compatible library methods. Imported scripts or skills do not grant
permission for external actions. For a material instruction conflict, retain
user/host authority, identify the owning paths and resolve it before dependent
changes. Do not invent one universal host precedence algorithm.

## Preserve the target's own skills

Upstream-owned instructions and skills stay in their established locations.
Read relevant ones alongside the shared method. Do not automatically move,
rename, overwrite or relicense them. The company-skill migration helper applies
to explicitly selected local migrations, not ordinary open-source contributions.

A code task can read a library method directly without installing host links.
When setup is requested, inventory names for both hosts, choose compatible
additions and preview against the target root. Preserve a collision: omit that
addition and read its library source directly, or obtain an explicit adaptation
decision. Never move an existing skill simply to make installation pass. Report
retained and skipped owners; do not ask the human to invoke every helper.

For local contribution assistance, keep newly created discovery links and
optional context pointers out of the target PR. Inspect its existing local
exclusion mechanism. When appropriate, add only newly owned paths to local Git
`info/exclude`, preserving existing entries and tracked files. Resolve the file
through `git rev-parse --git-path info/exclude`: worktrees share some Git
metadata, so serialize that write. Do not rewrite upstream `.gitignore`,
AGENTS.md or model settings just to install our tooling. Inspect the target diff
before any authorized publication.

Deliberate upstream adoption of the library is a separate contribution. Agree
portable installation, pinning and notices with the target's owner. A link into
one developer's library checkout is not portable project adoption.

## Worktrees and export boundaries

For `repo/widget`, use sibling `repo/widget-wt/<purpose>/` under the existing
[worktree policy](../../orbyn-worktree/SKILL.md). Resolve the primary clone even
when starting in its worktree, reuse an owned checkout and use neutral names.
Keep branches local by default and follow the verified target/fork contribution
path. Never push the library's branch to a target remote or infer publication
authority from a clone operation.

A linked worktree receives tracked project instructions and skills, but not the
primary clone's untracked local discovery links, context pointers or settings.
When setup is authorized for that worktree, register the needed links against
that exact checkout and recheck its existing names. Do not copy private settings
or secrets from the primary clone. Shared local exclude rules can cover owned
link paths across worktrees without replacing their tracked project guidance.

The library's `/repo/` ignore rule is a packaging safeguard, not access control.
Library checks reject tracked paths and gitlinks under `repo/`, `openSrc/` and
`orbyn-references/`, including forced additions. Public sync remains limited to
catalog-owned `skills/` paths. Never force-add a target, register it as a library
submodule or copy its instructions into a public skill.

Cleanup requires target ownership, delivery evidence, ignored-output inspection
and preservation. Keep primary clones and active worktrees. Do not recursively
delete completed-looking folders under `repo/`. The library's clean status says
nothing about a target's dirty or unpushed work.

Report both repository identities, selected checkout, relevant instructions and
skills, authorized setup changes, exclusions, actual checks and delivery state.
Claim live host discovery only when observed, not from directory layout alone.

## Keep layout separate from distribution

Either layout can read methods from a stable local library clone. Host links are
developer-local setup; a reviewed pinned copy is the portable option for team
adoption under [ownership](project-skills.md) and the consuming project's sync
policy. Do not invent an installer layout flag: `scripts/install.py --project`
still takes the exact consuming checkout. The agent resolves the chosen layout
first, then runs that helper when installation is authorized. Merely choosing
nested does not authorize publishing local links or adopting skills upstream.

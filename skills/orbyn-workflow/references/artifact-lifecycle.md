# Own artifacts and development resources through cleanup

Use when work creates previews, captures, test data or running services. Prefer the
consuming project's existing locations and retention policy. A small edit needs
no extra folders. Create a task directory only when an artifact is needed.

## Choose storage deliberately

| Artifact | Default when the project has no convention | Keep until |
| --- | --- | --- |
| Product source, reusable tests and accepted examples | Existing source/test owners; tracked when intended for delivery | Normal product lifecycle |
| Interactive prototype | Ignored `output/<task>/preview/`, with local assets and a short opening/reset note | Human review ends, or the selected interaction is transferred and the artifact is intentionally retired |
| Screenshots, test captures, profiles and trial receipts | Ignored `output/<task>/evidence/` or approved CI artifacts; retain candidate/state identity | Required review/reproduction and project retention are satisfied |
| Decision or sanitized result summary | Existing design/task document; tracked only when appropriate | Owning decision's useful lifetime |
| Disposable database, queue, volume, environment or cache | Unique task-owned namespace/path outside production | Checks finish and required failure evidence/data are preserved |
| Downloaded research | Ignored `orbyn-references/` under upstream-review policy | Its research/retention purpose ends |

Verify ignore/export behavior before writing sensitive or raw material. Do not
force-add output, copy secrets into examples, install global dependencies or create
one log per routine change. Files under a temporary OS directory may disappear;
move a requested handoff to a durable project-approved location before promising it.

## Record the resources actually started

For a server/worker, retain the session or process identity, command/cwd, bound
address/port, task owner and stopping method. Bind local previews to loopback by
default and serve only their dedicated directory, not the repository or home.
A port number alone does not prove process ownership. If a port is occupied, use
another available owned port; never kill the listener to make room.

Worktrees isolate source, not database names, queues, containers or caches. Use
unique task resource names and fixture data; preserve shared dependency caches and
user-managed services. Keep credentials outside output and public artifacts.

## Close out by state, not elapsed time

- While implementation/review is active, retain the checkout, artifacts and
  reproducible inputs. Do not delete failed receipts when a rerun passes.
- At a human preview handoff, keep the artifact and say whether its server is
  running. Keep an owned server only while it is needed for that handoff; a local
  URL is not permanent hosting. If stopping it, provide the retained artifact and
  exact restart entrypoint. Do not promise future uptime or schedule cleanup
  without a requested automation.
- When the task's checks finish, stop owned background work no longer needed,
  inspect termination and preserve relevant diagnostics. Remove only known
  disposable task data within cleanup authority. Shared or unknown resources stay.
- Before worktree removal, preserve needed ignored artifacts/configuration and
  verify the destination can be reopened. Follow
  [worktree cleanup](../../orbyn-worktree/SKILL.md#preserve-before-cleanup) for Git
  state, active ownership, archive/remove and recovery. A clean status or merged
  PR does not prove the tree has no valuable output. Uncommitted/unpushed work or
  pending human review keeps the tree active unless deliberately preserved and
  released within scope.

Prefer graceful session/process termination and the environment's normal teardown.
For containers, identify the exact task project and distinguish stopping services
from deleting volumes. Never use a global prune, broad kill, forced clean or
volume deletion as routine cleanup. Inspect remaining resources after teardown;
report retained/removed/running state and why, not “cleaned” without evidence.

Example: a reviewed patch is merged, but its ignored prototype is the only copy
and a teammate uses the same database. Preserve/reopen the prototype outside the
retiring tree, release only the task's own preview process, leave the shared database,
and then perform eligible Git cleanup. No merge-triggered deletion of all resources.

Primary background: [Git worktrees](https://git-scm.com/docs/git-worktree) and
[Docker Compose teardown](https://docs.docker.com/reference/cli/docker/compose/down/).
Use the installed tool's semantics; this policy grants no new destructive authority.

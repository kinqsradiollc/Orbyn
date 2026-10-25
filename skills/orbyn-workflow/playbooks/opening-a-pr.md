# PR delivery

For any new branch, follow the consuming project's naming policy and the
local [branch guidance](../../orbyn-worktree/SKILL.md#sibling-location-and-names).
Use a neutral purpose-based name, never an agent/vendor/tool/model prefix or
suffix. Preserve an existing branch when continuing work; do not rename a shared
remote branch without an explicit request.

Follow [local branch and fork ownership](../../orbyn-worktree/SKILL.md) before
publishing. Reuse the task branch; keep delegate branches local. For a company
upstream, prefer an approved permitted private personal contribution fork when supported, with a stable
name such as `Orbyn-contributions`, rather than spawning company-remote branches.
Verify account, upstream relationship, actual visibility and exact push destination.
If a public-parent native fork cannot be private, keep work local/private until
public PR publication is explicitly authorized; a private standalone backup is not
a native upstream PR source. Follow the owning policy for that transition.
If no permitted delivery path exists, preserve the local patch and report the
blocker; never publish private company code into a public fork or silently push
to the company remote instead.

Confirm PR creation is part of the requested delivery. Inspect the exact owned diff, checks and target branch. Exclude unrelated files and secrets. Write a concise body with actual evidence and limits, create the requested PR and attach it when the host supports attachments. Merge or publish only within authorization. No automatic babysitting job or separate session.

Use the parent [workflow](../SKILL.md) and repository scope.

## Commit and push gate

Verification, staging, commit, push and PR/CI actions are dependent steps. Stop
dependent actions when a prerequisite fails. Use checked return codes or `&&`
for a shell sequence; separators such as `;` can push the old HEAD after a failed
commit and return the later command's success. A final zero exit code does not
establish that the earlier commit succeeded.

Before pushing, verify the successful owned commit, its tree/diff and actual
HEAD against the validated source/tests. Preserve unrelated index/worktree data;
never use broad staging or commit unrelated files to obtain a clean status.
After pushing, verify the remote ref matches that intended commit before opening
the PR or accepting CI evidence. A pushed baseline is not a delivered fix.

A transient hook or transport failure needs an identified cause and bounded
permitted retry. Do not skip hooks, change the Git index/metadata location,
disable controls or use an alternate execution path to bypass a host denial.
Preserve the local patch and report the exact blocked dependency when the
required operation remains unavailable.

For an upstream contribution, start with [intake](contribution-intake.md) to check
the target instructions, issue overlap and reproduction. Once a PR exists, use
[bounded iteration](pr-iteration.md) for feedback, current-head checks and honest
delivery gates. PR creation alone does not authorize comments, merge or a monitor.

# PR delivery

For any new branch, follow [branch naming](../../../docs/agents/development.md#branch-naming).
Use a neutral purpose-based name, never an agent/vendor/tool/model prefix or
suffix. Preserve an existing branch when continuing work; do not rename a shared
remote branch without an explicit request.

Follow [local branch and fork ownership](../../orbyn-worktree/SKILL.md) before
publishing. Reuse the task branch; keep delegate branches local. For a company
upstream, prefer an approved permitted personal contribution fork, with a stable
name such as `Orbyn-contributions`, rather than spawning company-remote branches.
Verify account, upstream relationship, visibility and exact push destination.
If no permitted delivery path exists, preserve the local patch and report the
blocker; never publish private company code into a public fork or silently push
to the company remote instead.

Confirm PR creation is part of the requested delivery. Inspect the exact owned diff, checks and target branch. Exclude unrelated files and secrets. Write a concise body with actual evidence and limits, create the requested PR and attach it when the host supports attachments. Merge or publish only within authorization. No automatic babysitting job or separate session.

Use the parent [workflow](../SKILL.md) and repository scope.

# Checkable continuation without a second tracker

Use this structured form when an owner transfer or context-loss recovery benefits
from machine validation. First choose the minimum useful record under the
[task-record defaults](task-record.md); a paragraph can be enough even for a
substantive task. Keep any JSON beside the existing owning document, outside the
shared skill export. The agent prepares it internally; the human does not need
another invocation. The template ships synthetic examples, not project run logs.

The version-1 JSON format is shown in the [worked record](../examples/public-only-handoff.json).
Use the same fields; the local [validator](../scripts/check_handoff.py) rejects
missing or unknown fields and contradictory completion states without dependencies:

```sh
python3 /path/to/library/skills/orbyn-workflow/scripts/check_handoff.py \
  /path/to/task/handoff.json --revision CURRENT_FULL_HEAD
```

- `goal`, `excluded` and `allowed_actions` carry the actual user scope. They are
  a summary of existing authority, never a new grant to merge, message or deploy.
- `checkout` identifies the actual target root, full Git revision and optional
  dirty-diff SHA-256. Capture the diff outside the record; include staged,
  unstaged and relevant untracked inputs in the task's snapshot procedure. A
  clean HEAD alone cannot identify dirty work. Do not include secrets.
- `owner` and `owned_files` identify responsibility. Include live resources or
  shared writers in the owning document and point to it from the record.
- `completed` contains finished units with evidence pointers; `verification`
  distinguishes passed, failed and unverified checks, including which checks
  are required for this task. Planned commands stay unverified.
- `status` describes the requested task, while `delivery.state` describes the
  artifact's actual local, committed, pushed, merged or deployed state. A task
  requesting a local design can be complete with local delivery. A merge request
  cannot be completed by relabelling a pushed PR as merged.
- `decisions` lists unresolved choices; `next_action` is an executable continuation
  for unfinished work and null only for completion. A blocked record still names
  the dependency to resolve. It does not authorize polling or a scheduled job.

On pickup, read user steering and applicable target instructions first. Compare
current HEAD and retained dirty snapshot with the record (`--revision` and, when
dirty, `--diff-sha256`). Inspect referenced evidence, available tools and changes
by other writers. Reconcile stale claims in the same task record before acting;
do not reset another writer's edits to recreate an old candidate. Keep earlier
failed observations and unverified boundaries visible.

The checker validates structure and internal consistency. It cannot prove that
evidence is truthful, files still exist, user authority remains current, or a
host/model performed a check. The receiving owner must verify those facts. The
JSON contract works offline and across hosts without agent-to-agent transport,
hooks, a database or provider-specific orchestration.

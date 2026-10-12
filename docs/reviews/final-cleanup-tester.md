# C6 frozen worktree cleanup-readiness inventory

Date: 12 October 2026  
Role: Orbyn Tester  
Comparison target: `ac1ef39507b3af7951557c98ae6a5f0dfbdf26a3` (`origin/main`)  
Scope: the six registered Git worktrees under `/private/tmp/orbyn-c6-*` listed below.

This is a read-only readiness inventory. No worktree, ignored file, secret, database, preview service, or process was removed or modified. Git worktree metadata does not record the creating agent, so this report is scoped to the six matching registered paths supplied by the cleanup handoff; it does not infer ownership for other worktrees.

## Frozen worktree state

Every listed worktree is detached, has no tracked changes and no non-ignored untracked files, and is an ancestor of the comparison target. The `behind/ahead` column is `ac1ef395...HEAD`; each has zero commits ahead of the target, and its HEAD is the merge base.

| Worktree | Frozen HEAD | Behind/ahead | Ignored files |
| --- | --- | ---: | --- |
| `/private/tmp/orbyn-c6-frozen-81e4` | `81e4c81262df24efe7ca2c93846e6da1cf95d0bd` | `50/0` | 58,166 generated dependency/build files |
| `/private/tmp/orbyn-c6-r1-937cb16f` | `937cb16f14ef3f67eadc72293466a52836c5c71b` | `40/0` | None |
| `/private/tmp/orbyn-c6-r1-dc094b4b` | `dc094b4ba06e68e0c48ac12eb6ae4363db5f60ad` | `44/0` | 57,678 generated dependency/build files |
| `/private/tmp/orbyn-c6-r2-8f99272c` | `8f99272c66101734f0536405ad5bb68f5122e60b` | `21/0` | None |
| `/private/tmp/orbyn-c6-r2-bc43d9d5` | `bc43d9d58865d0c74f3c402f61063143c279a758` | `25/0` | 752 generated package-build files |
| `/private/tmp/orbyn-c6-remediation-4da327d` | `4da327dc05f93dc8aa4d8aa35225767e175bcf73` | `48/0` | 58,167 generated dependency/build files |

The ignored files are confined to dependency or generated build output: `node_modules`, package `dist` output, and (where present) `backend/dist`. No ignored QA evidence, test result, local environment file, or credential path was identified outside those generated/dependency trees. File contents were not read. Nothing in these worktrees appears necessary as unique evidence/config for the final U1 handoff; their generated caches are reproducible.

## Process and service use

An open-file scan found no running process with an open file descriptor under any of the six frozen worktrees. The active U1 preview listeners remain outside those paths in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`: API/backend on `8008` (PID `71469`), desktop preview on `5174` (PID `67198`), and Expo web on `8083` (PID `67238`). Their working directories are `backend`, `desktop`, and `mobile`, respectively. They were left running.

No tests, native builds, vendor calls, or security scans were run; they are outside this cleanup-readiness inventory. Builder can reconcile this inventory with the current requirements before deciding whether any disposable worktree is safe to clean up.

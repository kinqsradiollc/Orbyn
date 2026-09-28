# Muse build progress

## Scope and branch

- Branch: `muse/m3-m10`, based on `origin/main` at `6e7d3ae` (M1/M2 merged by PR #132; Claude reviewed them per the user).
- The M3, M4 and M5 base commits are `b3a47933`, `ab49b5f0` and `0bcff46c`; the `get_chats` registry follow-up is committed as `9e1947c`. This snapshot includes the M3 desktop history UI and M4 desktop run controls; the mobile history/run screen remains in the working tree for final client integration.
- The planner remains a planner. The full working tree has 65 listable tools, 33 core; the M3 follow-up snapshot has 63 tools, 31 core. There is no global 60-tool ceiling.
- The M2 worktree and its preview processes remain untouched. No PR or merge is planned.

## Chunk status

| Chunk | Status | Migrations | Implementation and tests |
| --- | --- | --- | --- |
| M3 — Chat history | Server, APIs, MCP registry, and desktop history UI committed; mobile screen still in the working tree | 165 | Durable private chats, migration from project chats, list/read/search/update/delete/save-as-note APIs, private `get_chats`, and content-free traces. New turns queue only their own memory content. |
| M4 — Lead and specialists | Server, desktop run controls, and polling client committed; mobile screen still in the working tree | 167 | Lead plus six specialists; bounded delegation, staged plans, questions, approvals, stop/report/apply/undo, and persistent traces. Fake-provider tests cover exam revision and stop/approval races. |
| M5 — Sweep old history | Done, committed | 170 | Daily worker compacts unpinned chats after seven days into private Agent notes; pinned chats stay. Tests cover retries, invalid summaries, privacy and retention limits. |
| M6 — One set of tools | Done; focused verification passed | 166 | Internal Assistant and Connected agents share the MCP capability registry and executor. Assistant grants cannot raise trust. The M6 catalog snapshot is exactly 63 tools, 31 core; later M8/M9 additions bring the full tree to 65/33. |
| M7 — Ideas feed | Implemented; focused checks passed; final full-suite run pending | 171, 173 | Worker creates up to three daily Review ideas from planner context. Today and Review surfaces support undo. Slot keys keep same-day ideas distinct. The feed filters existing ideas that reference assistant-off work. |
| M8 — Goals | Implemented; focused integration checks passed; final full-suite run pending | 168 | Private dated goals, optional project/plan note, weekly check-ins and replanning. Agent reads and writes exclude goals linked to assistant-off projects or docs. The weekly scanner uses the person's local Monday and does not run kept-out goals. |
| M9 — Routines and Upcoming | In progress; not yet committed or fully verified | 169 | Worker-managed recurring Assistant routines, pause/resume, approval scopes and Upcoming on web and phone. |
| M10 — Morning brief | In progress; not yet committed or fully verified | 172 | Daily private Agent brief covers Today, clashes, slipping work, goals, ideas and pending questions. Digest email links to the brief; email is mocked in tests. |

## Verification

- `npm run build:packages`, `npm run typecheck`, and the focused M8 checks passed. The focused checks cover goal API privacy/validation, local-week dates, the weekly worker with a fake provider, route inventory, and catalog parity.
- `npm run mcp:catalog -w backend`: passed for M8; the snapshot has 64 listable tools, 32 core tools, and no global tool-count cap. It reports 264 routes covered, 209 excluded and 0 pending.
- The disposable test Postgres was recreated from Compose's `test` profile and is healthy at `127.0.0.1:55434`. Its tmpfs data reset, so the former preview account no longer exists. The full suite has not yet been rerun against this fresh database.
- Desktop preview: `http://localhost:5175/app` serves HTTP 200; the worktree API at `http://localhost:8011/health` returns `200` with `status: ok`. Responsive visual checks at 1440 px and 390 px remain pending.
- Expo Metro is listening on port 8085. Native interactions were not rechecked in this run.

## Decisions and owner notes

- M7 uses three numbered idea slots per local day so a worker can persist up to three distinct suggestions.
- Assistant-off privacy is applied to every new agent path, including linked goals, plan docs, events, sessions, ideas and saved briefs.
- Assistant and privacy/retention wording was updated; `DEFAULT_LEGAL_VERSION` was not changed. Owner review of the revised copy is still needed.

## Remaining end-to-end verification

- Run the full suite after M10 against the restored disposable database, then refresh the M7–M10 integration results.
- Confirm the website at desktop and narrow mobile widths and recreate a disposable preview account for the user.
- Recheck native Expo interactions without using the M2 simulator.

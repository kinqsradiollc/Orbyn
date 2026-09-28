# Muse build progress

## Final report — 2026-09-28

- **Checks:** `npm run build:packages`, `npm run typecheck` (backend, desktop and mobile),
  `npm run format:check`, and `npm test` all pass. The full suite reports 1,512 passed, 0 failed.
- **Chunks:** M3 done (migration 165); M4 done (167); M5 done (170); M6 done (166); M7 done
  (171, 173); M8 done (168); M9 done (169); M10 done (172). Reviewer review and merge are pending.
- **MCP tools:** added `get_chats`, `manage_goals` and `manage_agent_routines`. The catalog has 65
  listable tools and 33 core tools; the registry has no 60-tool ceiling. The planner remains a
  planner.
- **Preview:** `http://localhost:5175/app` and its `/api/health` proxy return HTTP 200. Desktop,
  390px mobile web, and an iPhone 16 Pro simulator running Expo Go were checked. Chat history and
  Upcoming open and close on web and mobile; the mobile web history uses a drawer.
- **Fixes in the final verification pass:** a failed routine queue attempt now leaves its due
  occurrence available for retry, with an integration regression test. The M10 digest worker was
  formatted so the repository-wide formatting check passes.
- **Decisions and owner actions:** three Review idea slots per local day; `assistant_off` data stays
  excluded from new agent paths; no change to `DEFAULT_LEGAL_VERSION`. The owner should review the
  revised Assistant and privacy/retention copy. No implementation work remains in this branch.

## Scope and branch

- Branch: `muse/m3-m10`, based on `origin/main` at `6e7d3ae` (M1/M2 merged by PR #132; Claude reviewed them per the user).
- The M3, M4 and M5 base commits are `b3a47933`, `ab49b5f0` and `0bcff46c`; the `get_chats` registry follow-up is `9e1947c`. Mobile M3/M4 history and run screens are complete in follow-up commit `00a66bd`.
- The planner remains a planner. The full working tree has 65 listable tools, 33 core; the M3 follow-up snapshot has 63 tools, 31 core. There is no global 60-tool ceiling.
- The M2 worktree and its preview processes remain untouched. No PR or merge is planned.

## Chunk status

| Chunk                      | Status                                             | Migrations | Implementation and tests                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3 — Chat history          | Done, committed                                    | 165        | Durable private chats, migration from project chats, list/read/search/update/delete/save-as-note APIs, private `get_chats`, and content-free traces on desktop and mobile. New turns queue only their own memory content.                           |
| M4 — Lead and specialists  | Done, committed                                    | 167        | Lead plus six specialists; bounded delegation, staged plans, questions, approvals, stop/report/apply/undo, and persistent traces on desktop and mobile. Fake-provider tests cover exam revision and stop/approval races.                            |
| M5 — Sweep old history     | Done, committed                                    | 170        | Daily worker compacts unpinned chats after seven days into private Agent notes; pinned chats stay. Tests cover retries, invalid summaries, privacy and retention limits.                                                                            |
| M6 — One set of tools      | Done; focused verification passed                  | 166        | Internal Assistant and Connected agents share the MCP capability registry and executor. Assistant grants cannot raise trust. The M6 catalog snapshot is exactly 63 tools, 31 core; later M8/M9 additions bring the full tree to 65/33.              |
| M7 — Ideas feed            | Done; full backend suite passed                    | 171, 173   | Worker creates up to three daily Review ideas from planner context. Today and Review surfaces support undo. Slot keys keep same-day ideas distinct. The feed filters existing ideas that reference assistant-off work.                              |
| M8 — Goals                 | Done; full backend suite passed                    | 168        | Private dated goals, optional project/plan note, weekly check-ins and replanning. Agent reads and writes exclude goals linked to assistant-off projects or docs. The weekly scanner uses the person's local Monday and does not run kept-out goals. |
| M9 — Routines and Upcoming | Done; full backend suite passed                    | 169        | Worker-managed recurring Assistant routines, pause/resume, approval scopes and Upcoming on web and phone. The scanner advances recurrence only after queue success; an integration test proves failed enqueues remain retryable.                    |
| M10 — Morning brief        | Done; implementation and full backend suite passed | 172        | One private Agent brief per local day covers Today, clashes, slipping work, goals, ideas and pending questions. Digest email links to the brief; email is mocked in tests. Brief creation is concurrent-safe and filters assistant-off content.     |

## Verification

- `npm run build:packages`, `npm run typecheck` (backend, desktop and mobile), `npm run format:check`, and the full backend suite passed. The backend suite reported 1,512 passed, 0 failed.
- Focused M8 goal privacy/validation, local-week dates, and weekly-worker checks passed. M9 routine API/worker, route inventory and catalog parity passed. M10 tests cover kept-out data filtering, saved private-doc behavior, digest links and concurrent idempotence. The current catalog has 65 listable tools and 33 core tools, no global tool-count cap, 268 routes covered, 211 excluded and 0 pending.
- The disposable test Postgres from Compose's `test` profile is healthy at `127.0.0.1:55434`.
- Desktop preview: `http://localhost:5175/app` serves HTTP 200 through `API_PROXY_URL=http://localhost:8011`; the worktree API at `http://localhost:8011/health` returns `200` with `status: ok`. Signed into a fresh disposable account and visually confirmed Assistant history, New chat and Upcoming at the desktop viewport.
- At 390 CSS pixels, the web Assistant fills the viewport; the history toggle opens and closes its drawer, and Upcoming shows the empty goals/routines state. Native Expo Go 57 on a separate iPhone 16 Pro simulator completed sign-in and verified Chat history and Upcoming. The M2 worktree's port 8083 and iPhone 17 simulator remain untouched. Metro for this worktree is listening on port 8085.

## Decisions and owner notes

- M7 uses three numbered idea slots per local day so a worker can persist up to three distinct suggestions.
- Assistant-off privacy is applied to every new agent path, including linked goals, plan docs, events, sessions, ideas and saved briefs.
- Assistant and privacy/retention wording was updated; `DEFAULT_LEGAL_VERSION` was not changed. Owner review of the revised copy is still needed.

## Remaining end-to-end verification

- None for implementation. The reviewer still needs to review and merge the branch; the owner should review the revised legal copy described above.

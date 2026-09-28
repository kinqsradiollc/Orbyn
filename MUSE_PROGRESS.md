# Muse build progress

## Scope and branch

- M3–M10 code is present on `muse/m3-m10`, based on `origin/main` at `6e7d3ae`; artifact acceptance is still open.
- M1/M2 are already present in that base through PR #132; per the user, Claude has reviewed them.
- Planner stays a planner. The MCP registry exposes 65 listable tools (33 core); there is no 60-tool ceiling.
- The M2 worktree and its active preview processes remain untouched.
- No commit, push, or pull request has been made.

## Chunk status

| Chunk | Status | Migrations | Notes |
| --- | --- | --- | --- |
| M3 — Chat history | Persistence/API foundation committed; new-turn and web/mobile history integration remains | 165 | Unified durable chat records, legacy project-chat migration, search/list/read/update/delete/save-as-note APIs, private `get_chats` capability, and content-free activity trace. The M4 assistant runner wires each new turn into the persistent history. |
| M4 — Lead and specialists | Backend runtime committed; cross-platform client controls follow with the complete assistant surface | 167 | Lead with six specialists, max three concurrent and one delegation level; checked atomic plans, person questions and approvals, stop/report/apply/undo, persistent trace, per-run caps and progress. Fake-provider tests cover the exam-revision worked example and stop/approval races. |
| M5 — Sweep old history | Code present; audit open | 170 | After seven days, unpinned chats compact into private Agent notes with Asked/Decided/Changed/links, then turns and traces clear and Memory is queued. Pinned chats stay; questions retain 14 days, post-undo activity 90 days, and jobs one day. |
| M6 — One set of tools | Code present; audit open | 166 | Removed the separate assistant registry/proposal-only path; built-in assistant and Connected agents use the shared MCP registry. Grant trust can only lower to Ask/Suggest. The artifact's dedicated parity test still needs audit. |
| M7 — Ideas feed | Code present; audit open | 171 | Daily Review ideas (up to three) from tasks, calendar, study, deadlines, and Memory; Today and Review surfaces, and undo. |
| M8 — Goals | Code present; audit open | 168 | Dated goals with optional project and Agent plan note, weekly check-ins, and replanning worker. |
| M9 — Routines and Upcoming | Code present; audit open | 169 | Recurring assistant routines, Upcoming list, pause/resume, and approval scopes. |
| M10 — Morning brief | Code present; audit open | 172 | Daily private Agent brief with Today, clashes, slipping work, goal progress, ideas, pending questions, and quick links; email digest links to the brief. |

## Verification

- Latest complete required gate passed on the full M3–M10 working tree: `npm run build:packages`, `npm run typecheck`, `npm run format:check`, and `npm test`; the backend suite passed 1,503/1,503 tests against the disposable test database. Repeat all four checks before every chunk commit.
- `npm run mcp:catalog -w backend` completed and regenerated the MCP docs and distribution manifests.
- Latest read-only check: `git diff --check` passed.
- Web preview at `http://localhost:5175`: previously verified the disposable account, Docs/Today/Assistant views, persistent chat actions, goal creation, and routine pause/resume. Artifact-required 1440 px and 390 px visual checks are not evidenced.
- iPhone 17 Expo Go preview on port 8085: previously verified Assistant, chat history/search, Upcoming, and native goal/routine forms. The native session’s chat/goal/routine lists were empty, so persistence actions were verified in the web preview and backend tests.
- M10’s test saves one private brief per local day, checks its Agent-note content and email link, and verifies the daily scan does not send duplicates. SMTP delivery was mocked; no external email was sent.

## Remaining verification

- Web preview at `http://localhost:5175` and iPhone 17 Expo Go were previously exercised on the disposable account as listed above. The exact 1440 px and 390 px web viewport checks are still unverified.
- Disk remains above the 3 GB floor. The M2 worktree and its preview processes remain untouched.
- Commits and push are in progress; no PR or merge will be opened.

## Owner

- Updated the assistant and privacy language plus retention periods for private chats, traces, ideas, goals, routines and briefs. `DEFAULT_LEGAL_VERSION` was not changed; please review the revised copy before merge.

## Preview services

- API: `http://localhost:8011`, using the verified `_test` database and a local mock AI provider.
- Desktop web: `http://localhost:5175`.
- Expo Go Metro: port `8085`.
- The M2 preview on ports 4173 and 8083 was left alone.

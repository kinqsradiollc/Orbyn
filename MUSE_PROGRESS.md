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
| M6 — One set of tools | Implemented; integration verification blocked | 166 | Internal Assistant and Connected agents share the MCP capability registry and executor. Assistant grants cannot raise trust. Parity test checks the shared list; 65/33 count remains exact. |
| M7 — Ideas feed | Implemented; integration verification blocked | 171, 173 | Worker creates up to three daily Review ideas from planner context. Today and Review surfaces support undo. Slot keys keep same-day ideas distinct. Privacy filters exclude assistant-off data. |
| M8 — Goals | Implemented; integration verification blocked | 168 | Private dated goals, optional project/plan note, weekly check-ins and replanning. Agent reads and writes exclude goals linked to assistant-off projects or docs. |
| M9 — Routines and Upcoming | Implemented; integration verification blocked | 169 | Worker-managed recurring Assistant routines, pause/resume, approval scopes and Upcoming on web and phone. |
| M10 — Morning brief | Implemented; integration verification blocked | 172 | Daily private Agent brief covers Today, clashes, slipping work, goals, ideas and pending questions. Digest email links to the brief; email is mocked in tests. |

## Verification

- `npm run build:packages`: passed.
- `npm run typecheck`: passed for backend, desktop and mobile.
- `npm run format:check`: passed; `git diff --check`: passed.
- Focused registry, protocol and structured-provider tests: 28/28 passed, including exact 65-tool parity and the Matilda local-day prompt.
- `npm run mcp:catalog -w backend`: passed and regenerated the catalog and distribution metadata.
- Latest full `npm test` attempt: 339 passed, 125 failed. 124 database-backed test files could not connect to `127.0.0.1:55434`; the remaining failure was a structured-provider test still importing the removed graph prompt. That test now uses the shared assistant prompt and passes in the focused suite. The full suite has not passed because the database is unavailable.
- Desktop preview: `http://localhost:5175/app` serves HTTP 200 and remains open in the in-app browser. The page shows a cached signed-in session, but `/health` returns 503 and `GET /lists` returns 500 while PostgreSQL is unavailable. Exact 1440 px and 390 px visual checks are still unverified.
- Expo Metro is listening on port 8085. Native interactions were not rechecked in this run.
- Disk has about 19 GB free. Docker Desktop processes are running, but the Docker API socket still times out on `/_ping`, `docker ps` does not return, and `postgres-test` cannot be inspected or started. Port 55434 refuses connections. Its database is tmpfs, so the prior test account may need to be recreated after the database returns.

## Decisions and owner notes

- M7 uses three numbered idea slots per local day so a worker can persist up to three distinct suggestions.
- Assistant-off privacy is applied to every new agent path, including linked goals, plan docs, events, sessions, ideas and saved briefs.
- Assistant and privacy/retention wording was updated; `DEFAULT_LEGAL_VERSION` was not changed. Owner review of the revised copy is still needed.

## Blocked

- The full database suite, live API behavior and current test-account validity depend on the disposable PostgreSQL service at `127.0.0.1:55434`. Docker Desktop is running, but its daemon socket times out and the database port refuses connections. The web shell stays available at `http://localhost:5175/app`; API-backed features will work again once that test database is reachable.

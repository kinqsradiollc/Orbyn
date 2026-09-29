# Assistant Runs That Survive: delivery verification

Scope: the governing Claude artifact, R1–R10. Branch `runs/durable`;
checkout `/Users/anhdang/Documents/Github/orbyn-wt/runs-durable`.

## Scope and evidence

| Requirement        | Implementation and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 chat continuity | Jobs link to chat/turn; active-job discovery and working/needs-you markers; each workspace tab retains its own chat. Web at 1440/390 and native Expo Go reloads restore progress, questions, choices and Stop. Native now automatically reopens Assistant. Answering the restored question completes the same job. Polling bypasses response caches and recovers from 429, 5xx and network failures.                                                                                                                                                                                                                  |
| R2 queue           | Start requests only enqueue. Database claims use SKIP LOCKED, renewable 60-second leases, concurrency eight and optional worker fallback. All automation starters use the durable queue. Claim/concurrency and queue rollback tests pass.                                                                                                                                                                                                                                                                                                                                                                             |
| R3 checkpoints     | Serial versioned saves retain lead/specialist messages, reports, staged steps, selected steps, budgets and trace cursor. Stable apply receipts/client references prevent duplicate writes. Checkpoint and receipt tests cover interrupted specialists and interruption after apply commits.                                                                                                                                                                                                                                                                                                                           |
| R4 recovery        | Actual child-process SIGKILL tests replace runners, reuse completed reports and apply once. A mid-night restart resumes its specialist and continues the saved next candidate. Other tests cover waiting restart, saved answers, remote Stop, retry exhaustion and graceful shutdown.                                                                                                                                                                                                                                                                                                                                 |
| R5 away notices    | Unpolled completion/failure/wait notices route to the owning chat. Tests cover transition deduplication, recent polling, delivery and stale-channel rechecks.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R6 preferences     | Night shift defaults off; personal timezone/window, seven enabled kinds, Tonight handoff and default morning hold are supported on both clients. Settings and ownership tests pass.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R7 night work      | Persisted local-day window/list, DST, handed-first and due ordering, ten-run/token caps, leftovers, pause/provider/recent-activity gates, kept-out work and trust checks. Seven named instructions use ordinary lead/specialist tools, including linked private Agent notes and Study cards/revision. Selection tests cover calendar-only exams/meetings, fresh notes and Friday review. Execution tests cover ordinary private writes, morning hold, safe session moves and dynamic outside invites. Deletion, notifications, outside email, publishing and oversized bulk work remain in Review even at full trust. |
| R8 morning summary | Overnight and Home on both clients expose result links, questions, Review, Undo and leftovers. Morning email/push generation and concurrent delivery reservation are covered by integration tests.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R9 reminders       | Every-fifteen-minute detection is templated and makes no AI calls. Personal pinned Reminders, kind/channel settings, quiet hours, cap three, 24-hour deduplication and Stop are covered. Native Done/Move/Skip/Book and Undo passed. Habit Book follows saved duration/cadence; goal Book uses owned unfinished linked work. Renaming a feed/exam preserves Stop, notes and Study metadata; simultaneous subscribed exams keep separate identities.                                                                                                                                                                   |
| R10 decisions      | Owned Overnight routes support per-run/per-change Keep/Undo, confirmed bulk decisions, three-day Review expiry, answers and Approve/Decline. Web/native individual and bulk actions were exercised; direct web answer/Approve and native Decline applied or declined as expected. Declined cards show Undone. Ownership, dependency, partial activity Undo and transaction rollback tests pass.                                                                                                                                                                                                                       |

Provider behavior is tested with disposable local fake providers. The seven
work kinds share the ordinary assistant pipeline; test results do not measure
a live model's judgment or quality. No real AI service was called for these
checks. Email/push delivery uses mocked integrations; actual SMTP delivery and
OS notification arrival are not claimed. Expo Go also has notification limits.

## Final checks

- `npm run build:packages`: passed.
- `npm run typecheck`: passed after the final implementation change.
- `npm run format:check`: passed; final documentation formatting also passed.
- `npm test`: all 1,679 tests passed, with zero failures, skips or cancellations.
- Focused process recovery: nine passed, including mid-night continuation.
- Focused polling recovery: six passed, including cache bypass and Stop during backoff.

Logs: `/tmp/orbyn-runs-live-poll-build.log`,
`/tmp/orbyn-runs-last-typecheck.log`, `/tmp/orbyn-runs-handoff-format.log`,
`/tmp/orbyn-runs-delivery-final-tests.log`,
`/tmp/orbyn-runs-night-continuation-tests.log`,
`/tmp/orbyn-runs-last-poll-tests.log`.

## Files and migrations

Primary backend changes: `modules/ai/agent/{runner,lease,run,night-status,notices}`,
chat routes, automation starters, `worker/{night-shift,night-window,overnight-notices,reminder-nudges,delivery}`,
Overnight/Home routes, Study source identity and capability runtime safety.
Shared packages contain job/progress, night/reminder/Overnight contracts and
API/action helpers. Desktop and mobile add settings, Tonight controls,
Overnight, reminders, Home summaries, route handling and chat restoration.
Architecture, setup, privacy text and MCP references are updated.

Migrations: 181 durable jobs; 182 apply receipts; 183 assistant notices;
184 night settings; 185 Tonight tasks; 186 nights/runs; 187 reminder settings
and ledger; 188 reminder sources; 189 morning notice receipt;
190 revision-to-exam link; 191 stable calendar exam source identity.
Migration 191 preserves existing unambiguous exam keys and metadata; ambiguous
historical matches are retained rather than guessed.

## Runtime screenshots

- `/tmp/orbyn-midrun-refresh-1440.png`: pending message, progress and Stop after web reload.
- `/tmp/orbyn-midrun-refresh-390.png`: saved question and Stop after narrow web reload.
- `/tmp/orbyn-native-automatic-reopen-progress.png`: native app automatically reopens its active Assistant chat.
- `/tmp/orbyn-native-automatic-reopen-question.png`: native automatic reopen restores choices, answer field and Stop.
- `/tmp/orbyn-midrun-answer-native.png`: completed native answer from the earlier continuity check.
- `/tmp/orbyn-goal-booked-native.png`: native goal Book time.
- `/tmp/orbyn-overnight-direct-decisions-web.png`: direct Overnight decisions and corrected declined status.

Both disposable UI providers were stopped gracefully and their prior preview
provider settings restored. Disposable rendering-only fixtures are not treated
as proof of an executing assistant run.

## Local preview and handoff

Web: `http://localhost:5188/`; API: port 8018; Expo Go: Metro port 8083.
The preview uses a separate marked test database. The worktree is retained;
`.env` and `mobile/app.json` are excluded from commits. Free disk space remains
above the artifact's 3 GB minimum (last measured 7.0 GiB).

Latest fetched main remains the branch's base, `b32257cc`. Delivery is on
`runs/durable`, pushed to origin after final checks. No pull request or merge.

No artifact implementation remains outstanding. Live-provider output quality,
SMTP delivery and OS push arrival are outside the fake-provider verification
performed here; they are not presented as tested.

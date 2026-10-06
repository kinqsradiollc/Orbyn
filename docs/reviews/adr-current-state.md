# ADR implementation tracker

Updated 6 October 2026. Goal resumed at the user's request. This is a concise
status index; [ADR 001](../adr/001-devday-agent-platform.md) and
[task handoff](task.md) retain the full scope and evidence.

| Area                           | Current state                                                                                                                                                     | Remaining acceptance / next implementation                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main                           | `origin/main` verified at `29b74ecd`; user deploys manually                                                                                                       | Candidate integration, qualification and main promotion; production deployment is not confirmed                                                                                                                                                                      |
| ChatGPT native                 | Direct local OAuth, protected tokens, model catalog/defaults, signed inference and Settings/foreground activation implemented on `codex/chatgpt-direct-web-oauth` | Installed iOS/Android OAuth/keystore/browser/lifecycle acceptance; account management and truthful plan/usage acceptance                                                                                                                                             |
| Current recovery work          | Failed/cancelled reconnect resumes preserved credentials; catalog refresh runs every two minutes so its five-minute freshness window does not expire              | Candidate only; 348 ChatGPT unit tests and all workspace typechecks pass; refresh coordination, revocation, idle saved-account controls and confirmed invalid-refresh recovery implemented; signed iOS startup inspected; OAuth/storage/inference acceptance pending |
| ChatGPT hosted web             | No supported direct browser-only implementation established; desktop handoff is not completion                                                                    | Supported authorization and user-controlled runtime; actual popup/callback/provider acceptance without desktop                                                                                                                                                       |
| Main integration               | Read-only merge-tree check detected no conflicts; full DB70 run failed after Docker/database loss                                                                 | Restore disk/database, rerun full regression and qualify installed platforms before promotion                                                                                                                                                                        |
| Docs D1                        | Structured ownership and Markdown/Mermaid foundations exist; owned editor/offline candidates remain in separate worktrees                                         | Normal editor adoption, remaining flat writers/task identity, collaboration, complete import/render/edit/export/privacy matrices and native visual checks                                                                                                            |
| Whole-app UI U1                | Existing settings/assistant/responsive checkpoints plus candidate native ChatGPT controls                                                                         | Review every page and interaction on web/desktop/mobile, collapsed/narrow/panel/large-text states; avoid overlaps and duplicate actions                                                                                                                              |
| Providers/plugins/MCP C1–C3/M1 | Separate provider and plugin/backend boundaries remain in scope                                                                                                   | Governing capability/account/budget/usage audit and real host/provider acceptance; keep MCP grants separate                                                                                                                                                          |
| Background/Overnight C4–C5     | Separate identities/runtime/reflection foundations recorded in ADR                                                                                                | Collaboration, budgets, maintained/shared/published-page audit and runtime/client acceptance                                                                                                                                                                         |
| Channels C6                    | Slack/Teams implementation candidates recorded in ADR                                                                                                             | Real tenant, lifecycle, delivery, exact-question reply and cross-client acceptance                                                                                                                                                                                   |
| Cleanup                        | Worktrees, root character/user changes preserved                                                                                                                  | Cleanup only after relevant commits are reconciled, merged and qualified                                                                                                                                                                                             |

## Current evidence

- Desktop terminal refresh recovery now conditionally erases only the observed
  encrypted credential revision and stops its selected executor; newer sign-ins
  and temporary failures preserve credentials. Registration stays reconnectable.
  `/tmp/orbyn-desktop-terminal-refresh-all-final2.log`: 348 passed, zero failures/
  skips, terminal exit zero, 5534.425542 ms. Backend/desktop typechecks, CJS syntax,
  formatting and diff checks pass. Installed/live acceptance remains open.

- Native Disconnect retains only a protected verified registration mapping for
  later issued-client reuse. Active credentials are erased, and disconnected
  mappings cannot execute. `/tmp/orbyn-registration-retention-all.log`: 340
  passed, zero failures/skips, terminal exit zero, 7102.076334 ms. Mobile/backend
  typechecks and formatting pass. Installed/live and multi-account acceptance open.

- Confirmed invalid refreshes erase native credentials while retaining only the
  verified client/connection mapping. Reconnect reuses that client; temporary
  failures preserve credentials. Retired sessions cannot execute; Settings keeps
  recovery controls available. Candidate only; installed/live acceptance pending.
- `/tmp/orbyn-invalid-refresh-all-final.log`: 336 passed, zero failures/skips,
  terminal exit zero, 5881.278917 ms. API-client build and mobile/backend/desktop
  typechecks pass; focused 75-test recovery cohort passes.

- Real iOS OrbynChatgpt target build **passes**, terminal exit zero and
  BUILD SUCCEEDED at `/tmp/orbyn-chatgpt-native-module-build.log`.
  Expo prebuild and CocoaPods installation pass; effective module iOS minimum16.4.
- Full Orbyn scheme **fails** (exit70): embedded Watch companion needs the
  missing watchOS26.5 runtime. Temporary phone-only unsigned and simulator-signed
  QA builds both pass (exit zero); neither qualifies the full release scheme.
  Handoff: `/tmp/orbyn-native-build-handoff.json`. Signed app installed and opened;
  signup/sign-in screenshots retained in `evidence/chatgpt-native-startup/`.
  The unsigned keychain startup error disappears after simulator signing. This
  proves startup only; OAuth, protected credential writes, signing and inference
  remain unverified.

- `/tmp/orbyn-native-account-state-all-final.log`: 323 passed, zero failures/skips,
  terminal exit zero, 22326.398875 ms. Includes idle permission-off/corrupt account
  removal, stale UI callbacks, repeated actions and in-flight session replacement.
- `/tmp/orbyn-native-account-state-types-final.log`: mobile/backend/desktop
  typechecks exit zero.
- Expo autolinking discovers the native module on apple and android; JSON evidence
  is `/tmp/orbyn-native-autolink-apple.json` and
  `/tmp/orbyn-native-autolink-android.json`. iOS installed startup evidence is recorded above; Android installed acceptance remains open.
- Disk currently has about 1.1 GiB free; Docker engine is running but the isolated test
  container remains stopped. User was asked to restore it; full rerun is pending.

- `/tmp/orbyn-native-revocation-all-retry.log`: 315 passed, zero failures/skips,
  terminal exit zero, 20750.7235 ms. First attempt exited 7 without final summary;
  only the successful rerun is counted.
- `/tmp/orbyn-native-revocation-focused.log`: 50 passed, zero failures/skips,
  terminal exit zero, 4547.22475 ms. Revocation, rotated tokens and failure cleanup.
- `/tmp/orbyn-native-revocation-types.log`: API-client build and backend,
  desktop and mobile typechecks exit zero.
- `/tmp/orbyn-chatgpt-native-full70.log`: frozen `6f04e8c7` regression **failed**,
  3351 passed / 49 failed / zero skips, exit 1, 713288.637375 ms. PostgreSQL
  connections terminated and Docker became unreachable; a new full run is needed.
- Simulator Computer Use now works with the installed Orbyn QA development
  build. Earlier Expo Go-only and unsigned-startup observations are superseded
  for startup, but not for OAuth/storage/inference acceptance.

- `/tmp/orbyn-native-refresh-coordination-all.log`: 304 passed, zero failures/skips,
  terminal exit zero, 18056.099292 ms. Includes simultaneous catalog/inference,
  live heartbeat during refresh, queued cancellation/session replacement and disconnect.
- `/tmp/orbyn-native-recovery-all-unit.log`: previous recovery cohort, 298 passed,
  zero failures/skips, terminal exit zero, 20081.157709 ms.
- `/tmp/orbyn-native-recovery-focused.log`: 16 passed, zero failures/skips,
  terminal exit zero, 1306.056458 ms.
- `/tmp/orbyn-native-refresh-coordination-types.log`: packages built; backend,
  desktop and mobile typechecks exit zero.
- Earlier simulator Computer Use returned timeout `-10005`; the fresh observation
  above supersedes that availability check, but installed-device behavior remains unverified.

Other area statuses above preserve existing handoff scope; they were not fully
re-audited during this recovery checkpoint. A passing unit/typecheck cohort does
not prove native installation, real OpenAI inference, deployment or ADR completion.

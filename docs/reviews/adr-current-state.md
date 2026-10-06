# ADR implementation tracker

Updated 6 October 2026. Goal resumed at the user's request. This is a concise
status index; [ADR 001](../adr/001-devday-agent-platform.md) and
[task handoff](task.md) retain the full scope and evidence.

| Area                           | Current state                                                                                                                                                     | Remaining acceptance / next implementation                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main                           | `origin/main` verified at `29b74ecd`; user deploys manually                                                                                                       | Candidate integration, qualification and main promotion; production deployment is not confirmed                                                           |
| ChatGPT native                 | Direct local OAuth, protected tokens, model catalog/defaults, signed inference and Settings/foreground activation implemented on `codex/chatgpt-direct-web-oauth` | Installed iOS/Android OAuth/keystore/browser/lifecycle acceptance; account management and truthful plan/usage acceptance                                  |
| Current recovery work          | Failed/cancelled reconnect resumes preserved credentials; catalog refresh runs every two minutes so its five-minute freshness window does not expire              | Candidate only; 304 ChatGPT unit tests and all workspace typechecks pass; same-account refresh is coordinated; no installed-device claim                  |
| ChatGPT hosted web             | No supported direct browser-only implementation established; desktop handoff is not completion                                                                    | Supported authorization and user-controlled runtime; actual popup/callback/provider acceptance without desktop                                            |
| Main integration               | Read-only merge-tree check against fetched `origin/main` detects no conflicts at the pre-recovery candidate head                                                  | Recheck final commit and platform qualification before promotion                                                                                          |
| Docs D1                        | Structured ownership and Markdown/Mermaid foundations exist; owned editor/offline candidates remain in separate worktrees                                         | Normal editor adoption, remaining flat writers/task identity, collaboration, complete import/render/edit/export/privacy matrices and native visual checks |
| Whole-app UI U1                | Existing settings/assistant/responsive checkpoints plus candidate native ChatGPT controls                                                                         | Review every page and interaction on web/desktop/mobile, collapsed/narrow/panel/large-text states; avoid overlaps and duplicate actions                   |
| Providers/plugins/MCP C1–C3/M1 | Separate provider and plugin/backend boundaries remain in scope                                                                                                   | Governing capability/account/budget/usage audit and real host/provider acceptance; keep MCP grants separate                                               |
| Background/Overnight C4–C5     | Separate identities/runtime/reflection foundations recorded in ADR                                                                                                | Collaboration, budgets, maintained/shared/published-page audit and runtime/client acceptance                                                              |
| Channels C6                    | Slack/Teams implementation candidates recorded in ADR                                                                                                             | Real tenant, lifecycle, delivery, exact-question reply and cross-client acceptance                                                                        |
| Cleanup                        | Worktrees, root character/user changes preserved                                                                                                                  | Cleanup only after relevant commits are reconciled, merged and qualified                                                                                  |

## Current evidence

- `/tmp/orbyn-native-refresh-coordination-all.log`: 304 passed, zero failures/skips,
  terminal exit zero, 18056.099292 ms. Includes simultaneous catalog/inference,
  live heartbeat during refresh, queued cancellation/session replacement and disconnect.
- `/tmp/orbyn-native-recovery-all-unit.log`: previous recovery cohort, 298 passed,
  zero failures/skips, terminal exit zero, 20081.157709 ms.
- `/tmp/orbyn-native-recovery-focused.log`: 16 passed, zero failures/skips,
  terminal exit zero, 1306.056458 ms.
- `/tmp/orbyn-native-refresh-coordination-types.log`: packages built; backend,
  desktop and mobile typechecks exit zero.
- Simulator Computer Use returned timeout `-10005`; no simulator was booted when
  checked. Screenshots and installed-device behavior are unverified.

Other area statuses above preserve existing handoff scope; they were not fully
re-audited during this recovery checkpoint. A passing unit/typecheck cohort does
not prove native installation, real OpenAI inference, deployment or ADR completion.

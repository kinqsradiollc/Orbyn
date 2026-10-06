# ADR implementation tracker

Updated 6 October 2026. Goal resumed at the user's request. This is a concise
status index; [ADR 001](../adr/001-devday-agent-platform.md) and
[task handoff](task.md) retain the full scope and evidence.

| Area                           | Current state                                                                                                                                                     | Remaining acceptance / next implementation                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main                           | `origin/main` verified at `7263b45b`; user deploys manually                                                                                                       | Candidate integration, qualification and main promotion; production deployment is not confirmed                                                                                                                                                                                         |
| ChatGPT native                 | Direct local OAuth, protected tokens, model catalog/defaults, signed inference and Settings/foreground activation implemented on `codex/chatgpt-direct-web-oauth` | Installed iOS/Android OAuth/keystore/browser/lifecycle acceptance; account management and truthful plan/usage acceptance                                                                                                                                                                |
| Current recovery work          | Failed/cancelled reconnect resumes preserved credentials; catalog refresh runs every two minutes so its five-minute freshness window does not expire              | Candidate only; 441 ChatGPT unit tests pass; current adapter mobile/backend typechecks pass; refresh coordination, revocation, idle saved-account controls and confirmed invalid-refresh recovery implemented; signed iOS startup inspected; OAuth/storage/inference acceptance pending |
| ChatGPT hosted web             | No supported direct browser-only implementation established; desktop handoff is not completion                                                                    | Supported authorization and user-controlled runtime; actual popup/callback/provider acceptance without desktop                                                                                                                                                                          |
| Main integration               | Read-only merge-tree check detected no conflicts; full DB70 run failed after Docker/database loss                                                                 | Restore disk/database, rerun full regression and qualify installed platforms before promotion                                                                                                                                                                                           |
| Docs D1                        | Structured ownership/Markdown/Mermaid foundations and format-aware capture/reflection, complete-tree merges and nested checklist task mapping implemented on candidate; offline recovery is integrated; normal editor widget activation remains                                         | Normal editor adoption, remaining flat writers/task identity, collaboration, complete import/render/edit/export/privacy matrices and native visual checks                                                                                                                               |
| Whole-app UI U1                | Existing settings/assistant/responsive checkpoints plus candidate native ChatGPT controls                                                                         | Review every page and interaction on web/desktop/mobile, collapsed/narrow/panel/large-text states; avoid overlaps and duplicate actions                                                                                                                                                 |
| Providers/plugins/MCP C1–C3/M1 | Separate provider and plugin/backend boundaries remain in scope                                                                                                   | Governing capability/account/budget/usage audit and real host/provider acceptance; keep MCP grants separate                                                                                                                                                                             |
| Background/Overnight C4–C5     | Separate identities/runtime/reflection foundations recorded in ADR                                                                                                | Collaboration, budgets, maintained/shared/published-page audit and runtime/client acceptance                                                                                                                                                                                            |
| Channels C6                    | Slack/Teams implementation candidates recorded in ADR                                                                                                             | Real tenant, lifecycle, delivery, exact-question reply and cross-client acceptance                                                                                                                                                                                                      |
| Cleanup                        | Worktrees, root character/user changes preserved                                                                                                                  | Cleanup only after relevant commits are reconciled, merged and qualified                                                                                                                                                                                                                |

## Current evidence

## Nested checklist recovery — 6 October 2026

Complete-document revision merging now combines independent nested checkbox ticks
and named-leaf text edits, including native offline replay. Checkbox presence,
owner order and container metadata remain structural; overlapping text and
ambiguous empty-item changes retain conflict review.33 focused controls, operations,
task and offline replay tests pass; shared packages build and backend types pass.
Candidate only. Normal editor adoption/save/collaboration and installed/visual
acceptance remain unfinished. Main stays7263b45b; no deployment is claimed.


## Nested editor control contract — 6 October 2026

Candidate renderers now pass each leaf's exact ownership path to existing widgets.
Nested checkbox controls emit an explicit check-item operation with the rendered
node snapshot; the owner can reject stale events using applyDocContentOperation.
Read-only controls remain disabled, and native checkboxes expose checked/disabled
accessibility state.11 focused renderer/operation tests and desktop/mobile types
pass. This is not normal-editor activation: neither normal editor yet consumes
these renderers or the complete-format save path. Next: authoritative document
state, explicit structural commands, save/reconcile/offline and collaboration
integration on both clients. Visual/installed acceptance remains open.
Main remains7263b45b; no main promotion or production deployment in this step.


- Owned-editor offline checkpoint0ee17ce5 is now integrated into the working
  candidate at6aa74747. Cached/queued edits retain complete trees; native replay
  uses the versioned editor read/save and original tick baseline. Disjoint named
  leaf edits merge; overlapping ownership changes preserve drafts for review.
  Page concatenation helper is now doc-page-merge.ts; three-way revision merging
  uses doc-content-merge.ts.55 focused tests, shared package build and desktop/
  mobile/backend typechecks pass. No unresolved conflicts. Normal editor controls,
  recovery UI, installed visual behavior and runtime qualification remain open.


- Main checkpoint `7263b45b` is pushed: Home counts complete nested goal-plan
  checklists and current linked task status, including reopening. One batched
  task read covers visible plans and scopes shared block IDs by document. Project
  task totals retain precedence; missing/prose-only plans do not invent progress.
  Shared pure task projection and10 relevant main tests pass, as do package builds,
  backend types and formatting. Candidate8 Home tests pass. No database runtime
  or visual acceptance is claimed; broader document write changes stay candidate.
  Main was reconciled into candidate85ce3340; import/export overlap resolved with
  no source change to the tested candidate tree and no outstanding conflicts.


- Nested checklist task creation and versioned read/save synchronization use a
  separate task view, preserving first-paragraph IDs/types and list-item checkbox
  owners. Page write authority is required before task mutation.502 Docs unit
  cases pass; package/backend types/format checks pass. Two DB lifecycle/stale-tick
  cases are added but unrun; current test PostgreSQL55435 probeECONNREFUSED.
  Candidate only. Other task projections, normal-editor controls, extraction,
  moved fragments, agenda generation and complete D1/U1 matrices remain open.


- D1 page merges now preserve complete nested trees across mixed formats, rename
  colliding leaf/container IDs, and use versioned writes for target and inbound
  reference pages.75 unit regressions pass; build/backend types/format pass. Actual
  database merge regression added but not run. Candidate only. Task/checklist
  mapping, partial extraction, moved local fragments, agenda generation and full
  editor/collaboration/render/edit/export/privacy acceptance remain open.


- D1 capture/reflection appends preserve nested owners and identities through the
  versioned writer. Home reads root-owned Reflection with authorized privacy
  projection.63 unit regressions pass; package build/backend types pass. Two DB
  cases added but not run; Docker/database qualification and main promotion remain
  pending. Task extraction/restructuring, agenda regeneration, normal editor,
  collaboration and full D1 matrices remain open.


- Actual native factory now has compound account-switch provenance coverage:
  distinct profile tokens/enrollments, old executor cancellation, preserved slots/
  keys, replacement catalog and signed receipt binding, and ignored late transport
  response. Focused94passed and full ChatGPT441passed/0failed/0skipped,27263.063333ms.
  Test-only candidate checkpoint; no runtime change or main promotion. Server source
  also checks immutable provider choice, captured call binding/hash and expected
  model before new assignments. Real OS/OAuth/UI/DB acceptance remains pending.
  Latest Docker read-only probe did not respond; only that CLI probe was stopped.

- Provider eligibility now follows catalog readiness on both clients: no offered
  provider during loading/saving, offline/stale/unavailable state, absent/removed
  default, missing catalog or absent inference capability. Hint directs users to
  choose a ready device/default. Scoped main checkpoint `9e22e531` pushed; candidate
  reconciled main without conflict. Candidate440unit tests pass, main focused23
  pass, both client types pass with documented main mobile dependency mapping.
  No visual/real provider acceptance is claimed. Full ADR scope remains open.

- Provider save replies must match requested primary/account/device/fallback and
  advance the exact version. Unconfirmed replies/conflicts invalidate the revision
  and fence retained callbacks until reload; valid saves remain usable. Scoped
  main checkpoint `baf9e56c` is pushed. Candidate438unit tests pass; main focused12
  pass, desktop types and mobile types with existing WebView mapping pass. Candidate
  reconciled main without conflict. Real OAuth/OS/UI and full DB remain pending.

- Provider controls now reload after a token change for the same user and serialize
  mutations before a React rerender. Both clients reproduce the two baseline bugs;
  focused8passed and candidate ChatGPT434passed/0failed/0skipped,27480.8195ms.
  Scoped fix pushed to main `7c693b48`; candidate merged main without conflicts.
  Main focused8passed, desktop types and shared package build pass. Main mobile
  types pass with temporary mapping to already installed WebView13.16.1; normal
  main mobile typecheck still lacks that declared local package. Native OAuth
  candidate remains unqualified and unmerged. No deployment is claimed.

- Runtime audit reproduced React Native inference failure:
  `signal.throwIfAborted is not a function`. Shared executor lifecycle, provider
  request/stream reader and native transport now use the existing portable helper.
  Actual native factory tests with React Native AbortController complete mocked
  inference and reject pre-cancelled work without another provider request.
  `/tmp/orbyn-native-abort-all.log`:430passed/0failed/0skipped,28700.67175ms,
  exit0; API package build, mobile/desktop typechecks and diff checks pass.
  No live provider/installed acceptance is implied. Main remains unchanged.

- Native protected reads/writes/erases now sanitize native failures before app
  diagnostics. A failed credential read is `unreadable`, never missing; execution
  and cleanup reject without guessing identity or erasing unknown credentials.
  Recovery after readable storage returns is covered. Final
  `/tmp/orbyn-native-read-fault-all-final.log`:429passed/0failed/0skipped,
  26675.095583ms, exit0; mobile typecheck and formatting/diff checks pass.
  Model/default/provider provenance is next. Real OS/OAuth/UI, full database and
  main promotion remain pending. Test container is still exited; disk1.7GiB.

- Targeted inactive/unavailable account cleanup is wired into service and account
  MoreMenu. Strict copied ID/revision, fresh owner and protected identity checks
  preserve other active credentials/selection and reject stale/substituted targets.
  Full `/tmp/orbyn-native-target-cleanup-all.log`:427passed/0failed/0skipped,
  31658.248708ms, exit0. Mobile/backend types and formatting/diff checks pass.
  Read-fault handling, defaults/provider provenance, real OS/OAuth/UI and full DB/
  main qualification remain open; complete ADR scope is retained.

## Earlier checkpoint evidence

The entries below preserve their original verification scope. Remaining work may
have been superseded by the current state above; none proves whole-goal completion.

- Native Disconnect now retries exact server/key cleanup after credential erasure
  and continues independent cleanup on an erase failure without claiming removal.
  Token-free revocation confirmation is credential-revision bound; unknown provider
  cleanup stays visible across retries. Targeted unavailable-account cleanup and
  read-fault/installed acceptance remain open, along with model/default provenance.
  `/tmp/orbyn-native-cleanup-all-final2.log`:424passed/0failed/0skipped,
  29041.735958ms, exit0. Mobile/backend typechecks and formatting/diff checks pass.

- Native Add and targeted Reconnect are wired into service and Settings. Strict
  copied actions, expected revision, distinct protected slots, verified identity/
  permission and atomic selection preserve existing accounts. Unselected multi-
  account directory stays available after disconnect. Runtime/fixtures pass, not
  real OAuth/OS proof. Remaining multi-account recovery/default/provenance audit,
  installed platform screenshots and full database/main qualification stay open.
  Final `/tmp/orbyn-native-add-all-final2.log`:418passed/0failed/0skipped,
  28937.061916ms, terminal0. Mobile/backend typechecks, Prettier/diff checks pass.

- Native saved-account switch and bounded picker are implemented. Selection is
  explicit and revision-bound, with protected-slot/live-identity/fresh-grant/plan
  permission checks and previous-executor fencing. Captured-owner component tests
  pass. Add-account and targeted unavailable-account reconnect remain to implement;
  cross-account defaults and real device visual/OAuth acceptance are still open.
  Final `/tmp/orbyn-native-picker-all-final2.log`:409passed/0failed/0skipped,
  26543.954292ms, exit0. Mobile/backend typechecks, Prettier and diff checks pass.

- Native slot migration is now wired into Settings Connect and the service's
  exclusive ownership lifetime. The runtime resolves exact selected slots and
  retains signing aliases through refresh/retirement/disconnect/reconnect. Pending
  migration cleanup blocks execution. Actual service/UI tests cover cancellation,
  replacement sessions and signing alias changes. Full multi-account Add/switch/
  picker/catalog/default acceptance remains open; real device acceptance pending.
  `/tmp/orbyn-native-slot-integration-all-final.log`:400passed/0failed/0skipped,
  27014.848583ms, terminal0. Current mobile/backend typechecks and formatting pass.

- Resumable singleton migration composes directory and protected slots; it retains
  the native signing alias and removes the original only after exact directory
  publication. Nine focused cases pass. Final ChatGPT cohort:386 passed/zero
  failures/skips,25715.282458ms, exit0 at `/tmp/orbyn-account-migration-all.log`.
  Mobile/backend typechecks pass. Runtime/Connect activation is recorded above;
  this earlier checkpoint alone did not activate migration. Switching/picker remain.

- Protected account storage adapter implemented with device-only options, owner
  namespaces, shared in-process per-key queues, conditional rollback and UTF-8
  bounds. Thirteen source-module tests pass; mobile/backend types pass. Final ChatGPT
  cohort `/tmp/orbyn-protected-store-all-final.log`: 377 passed, zero failures/
  skips, terminal0, 27124.4235ms. It is
  not yet wired into singleton migration or the native account picker. No real
  keystore/OAuth acceptance or main promotion is claimed.

- Native metadata account-directory foundation is implemented and tested with owner/
  revision/CAS, duplicate identity, retirement and bounded-record checks. It contains
  no credentials and is not wired to SecureStore/Settings yet. Account selection is
  **in progress**: protected adapter wiring/migration/switching/model defaults/UI/runtime gates
  remain. `/tmp/orbyn-native-directory-all-final2.log`: 364 passed, zero failures/
  skips, terminal exit zero, 5854.532208 ms; mobile/backend typechecks pass.

- Desktop disconnect attempts local credentials/key, server and selection cleanup
  independently, including a locked keychain. A bounded optional enum result drives
  truthful notices for incomplete cleanup. `/tmp/orbyn-desktop-disconnect-all.log`:
  353 passed, zero failures/skips, terminal exit zero, 9138.619083 ms. Packages build
  and backend/desktop/mobile typechecks pass. Installed/live/full DB gates remain open.

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
- Disk last observed at about 2.4GiB free. Docker CLI is responding, but the
  isolated orbyn-embedding-test-20261001 container remains Exited255. User recovery
  control is preserved; the fresh full database rerun remains pending.

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

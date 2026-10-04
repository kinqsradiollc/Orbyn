# Current implementation handoff — 3 October 2026

## Current authoritative checkpoint — reflection integration

Main is e0afd266: PR189 Projects library merged after exact71f58c9f passed
2,534/2,534 local tests and all four CI37110461919 jobs. PR188 protected MCP
job resources merged as ee5e3278 after 2,533/2,533 and all CI37110025877 jobs.
Running previews still serve older checkouts; no latest Projects visual claim.

Current codex/overnight-reflection-integration integrates the retained reflection
candidate onto ee5e3278. Migration217 adds transcript/run dependency kinds and
reflection receipts. Source visibility retains current main restrictions. Scanner,
runner and resumed checkpoints apply current principal space restrictions;
mismatched scope owners fail closed. Integration tests caught unused untyped SQL
parameters and missing transcript dependency constraints, both corrected without
relaxing assertions. Final reflection focused tests and all workspace typechecks
passed; full qualification, selected-team tests, build, formatting, CI and newest
main integration remain required before promotion. Reflection is not shipped.

Continue full C1–C6/M1/D1/U1, including whole-app UI and mobile parity. User
deploys main manually. Preserve root user changes, credentials, characters and
all original branches/worktrees; no cleanup or deployment at this checkpoint.

## Scope and boundaries

Complete `docs/adr/001-devday-agent-platform.md` under the full acceptance contract
`docs/reviews/devday-2026-implementation-review.md` C1–C6/M1/D1/U1. Goal active and
incomplete. Every web/desktop feature needs mobile parity. Preserve root user
files and concurrent character work. Qualified main commits/merges/push are
authorized; no deploy/tag/release or cleanup. No subagents. Exclude voice and
computer-use product features and speculative Decisions adapter.

Home: concrete Muse/Dots-inspired workflows, all character presets, distinct
Background and Overnight profiles, honest activity/results/stopping states.
Primary sources: [Muse](https://introducing.muse.ai/) and
[Dots](https://learn.chatgpt.com/docs/dots/tasks-and-memory). Do not claim imported
computer/messaging capabilities or permanent active presence. Reflection and
collaboration remain required, not proven shipped by Home copy.

Web Home visual acceptance is delegated to the user's test server for this
increment. Do not bypass denied localhost web permission through different
ports, Chrome/native access or CDP. Offline private Chrome is only for synthetic
exports. Native Terms acceptance requires the human. Docker stays user-controlled.

## Main and qualification

- Main86ccd4f8: publication renderer PR166 merged after exact2a46a360 full
  local2,318/2,318 and all CI37073694699. Media PR164 merged as43812305 after
  exact88024f64 full2,298/2,298/all CI37071640135. Earlier PDF/image/HTML
  checkpoints remain merged. Root user files preserved; no deployment.
- Home profiles: assistant-runtime-integration/Orbyn, codex/home-agent-profiles,
  exact692cc0f8, draft PR165. Fresh local session70210 and CI37074275504 live.
  Log `/tmp/orbyn-home-profiles-692cc0f8-full-tests.log`.
  Previous64534482 local2,298/2,299 and CI37071883926 failed generated route
  catalog (248 vs249 private exclusions), now regenerated. Current focused32/32
  and all workspace types/build/format pass. Must integrate new main86 after this
  frozen run before final combined qualification. Native human sign-in pending.
- Current character/Orbyn now owns codex/docs-diagram-readability: local565032d3
  plus main86 merge. Larger Gantt bars/text/ticks and repeated-date suppression;
  final scoped16 checks pass with actual PDF font/bounds/spacing assertions.
  Synthetic current screenshot `evidence/gantt-readable.png` inspected. Combined
  focused/full local/CI qualification still pending. Existing media branch retained.
- assistant-work-ownership/Orbyn retains qualified publication-renderer2a46a360;
  clean. No further runtime changes there.

## Native QA state

Home UI source (unchanged by692 catalog/media integration) serves Expo Go at port8087 and test API8027, isolated marked
owned database recorded in `/tmp/orbyn-native-home-64534482-db.txt`. Metro needed
IPv4-first resolution to serve the simulator. Old cached build and old nonexistent
QA database are excluded from evidence. Current source reaches native sign-in.
Disposable test credentials are prepared, but final Sign in says it accepts Terms:
user has been asked to perform that action. Do not accept or inject agreement
state. Session credentials remain in a private temporary file, never in docs/logs.

## Preserved candidates and remaining work

- `codex/docs-source-preview` e7b018db / draft PR153: broad source/editor/UI/models/
  reflection/handoff candidate; extract and qualify scoped changes, no broad merge.
- `codex/docs-rendered-pdf` a039f271 / draft PR160: preserve combined candidate;
  previous CI font-test failure is not qualifying evidence; main PDF fixes are merged.
- `codex/pdf-deployment`501b4c09 and dirty devday plan/executor work preserved.
- model-catalog4f223040 plus two untracked settings previews and plugin-boundary
  a74ad26a remain acceptance candidates.

Finish ChatGPT credential-owning executor model catalog/defaults and separate
plugin integration, all Docs/editor/CommonMark/GFM/math/Mermaid/reference/source
preview/navigation/Word/native sharing/export/publication security acceptance,
whole-app UI parity and real screenshots/interactions, bounded durable Background/
Overnight collaboration and consented reflection. Gantt label presentation remains
known. Types/Expo export or synthetic component tests are not native delivery.

## Next actions

Observe fresh full suites and all current-head CI to terminal. Merge only qualified
exact heads against fresh main; preserve failures. Finish native Home/profile
interactions after human sign-in. Commit and attach a scoped publication-renderer
PR, then full current-head qualification before promotion. Reconcile parent/main
without conflicts. Continue all C1–C6/M1/D1/U1 gates; no premature goal completion
or cleanup. Disk is low: check before large builds, do not reinstall dependencies.

## Home review layout follow-up

`codex/home-agent-review-layout` in `home-agent-editorial/Orbyn` is a scoped
presentation follow-up atop frozen PR165 head5a298544. Research, exact copy/layout
changes and visual limits: `evidence/home-agent-review-layout.md`.
PR165’s matching-head retry completed2344/2344 with zero skips/cancellations,
terminalexit0; CI37077524911 all four jobs passed. Native acceptance remains open.
No main promotion, release, deployment or cleanup in this follow-up.

The new presentation focused checks pass13/13, all workspace types/builds and
full formatting pass. Matching-head full local and CI remain required. This
candidate is stacked on PR165; human native acceptance still outstanding.

## Latest checkpoint — scoped Markdown parity on main1100ca98

- PR167 merged after 2322/2322 local tests and all four exact-head CI jobs passed. Root main fast-forwarded; user mobile/app.json and untracked files preserved.
- Home PR165 current head0d6d307a integrates publication main86; previous692 passed2320/allCI. New head types/build/format/focused pass; full session77462 and CI37075657142 live. Integrate main110 only after observing that frozen run. Native human Sign in/Terms action remains pending; no UI bypass or acceptance claim.
- Current checkout codex/docs-markdown-parity has uncommitted scoped parser/references/six-headings/privacy/index and client context changes extracted from e7. Preserved broad source and publication branches remain available.
- Latest focused31/31 and all workspace types pass. Current build/format session13118 and current regressions session11995 live. Prior130 regressions passed before HTML definition suppression; standalone13 references pass after correction.
- Evidence: docs/reviews/evidence/markdown-parity.md. Latest logs under /tmp/orbyn-markdown-parity-*; external machine-readable handoff /tmp/orbyn-current-qualification-handoff.json.
- Next: inspect same handles, complete current export/API/security/migration qualification; source/preview and embedded-page reference context remain open. Commit a scoped reviewable candidate before full local/CI; merge only when actual required gates pass. Continue whole C1-C6/M1/D1/U1 goal.
- No deployment/release/cleanup. Web Home visual acceptance remains user-owned; native/editor/settings/model/plugin/reflection/collaboration qualification remains open.

Current Markdown build/format session13118 and regressions11995 completed with exit0: all workspace types/build/format, focused31/31 and regression130/130 passed. Candidate is ready for a scoped draft checkpoint; full/CI and editor acceptance remain open.

## Embedded reference follow-up

Current branch codex/docs-reference-embeds depends on Markdown89c3e2f9 (draftPR168; full33571/CI37076851819 live). Source-page privacy projection before section selection and reference map filtering are implemented in API and both clients. Focused41/41, all workspace types/build/format and final backend types pass. First test caught hidden destination context, fixed without changing its assertion. Native/editor visual and full current-head gates remain open. Home0d local2340 passed; CI37075657142 failed a recovery-worker race in the synthetic fixture; actual API-service test repair plus main110 integration are being qualified separately. Preserve native human consent and denied web UI boundaries.

## Latest Docs source/preview work in progress

Current assistant-work-ownership checkout is codex/docs-source-preview-ui on embed79fa1043, with uncommitted source-panel/map/component/menu/Unicode-deep-link work. Mapping/source-view/navigation18/18 passed; last typecheck rerun99447 pending. The inspector panels use current editor state, no second save path; native opening settles draft, panels fenced by doc ID. Ordinary editor fragment/fold navigation and embedded navigation context still require wiring; do not promote before those and actual runtime/UI gates. See evidence/doc-source-preview.md.

Model7f486 PR170 full81981/CI37078484222 still live. Home5a CI37077524911 passed; first local34365 ended exit7 without TAP summary, lsof confirms no writer; fresh marked retry25418 running. Embed79fa local2354 and allCI37077553749 passed. Markdown89c3 local2353/allCI passed. Native human Terms-linked Sign in remains pending. Main110 unchanged, user files preserved.

Disk reached216MiB; 267 closed temporary logs were preserved as gzip after excluding open writers, recovering847MiB. Manifest /tmp/orbyn-closed-log-compression-manifest.json; external handoff log paths updated where applicable. No worktree/branch cleanup, Docker restart, deployment or release.

## Source/preview and current-draft navigation checkpoint

`codex/docs-source-preview-ui` now wires ordinary editor heading/fold navigation
and source-owned embedded contexts in both clients, preserving parent reference
privacy. Current20/20 focused and115/115 combined checks pass; all workspace
types/build/full-format pass. First final typecheck’s wrong event import was
corrected without changing tests. Evidence: `evidence/doc-source-preview.md`.
Stacked on PR169; full matching-head local/CI and native/editor acceptance remain
required. Broader source editing and complete D1/U1 are still open.

## Latest native diagram checkpoint — 3 October 2026

Current dirty branch `codex/native-diagram-parity` is based on PR1722d5605f9.
Ten native synthetic families rendered; source/fit/zoom/actual size/pan and SVG
share-sheet opening were observed. Responsive canvas and tall-fit pan repair
passes16 component/download checks. Prior44 combined checks and types/build/full
format passed; rerun final source, then commit a draft and run fresh marked DB
full suite/CI. See evidence/native-diagram-parity.md. Native fixture Metro8091
current session57684, log/tmp/orbyn-native-diagram-qa-metro-7.log. No product
account/API calls were made by the fixture. Signed-in editor/Android/parent
scrolling and full UI acceptance remain open.

Latest other candidates: models149a91e9 full2350/allCI37080854903 success;
source2d5605f9 full2374/allCI37081138932 success; Home9232cfaa full2344/allCI
37081215076 success. All remain draft. Main1100ca98 unchanged; user files and
character work preserved. Full C1–C6/M1/D1/U1 remains active, no deploy/release/
cleanup. Native Terms human action and web user validation are still open.

## Latest code/metadata checkpoint — 3 October 2026

Current branch `codex/docs-code-metadata-ui` follows PR1732de8f72d. Code copy/
source controls and metadata naming/disclosure implemented on both clients.
Native iOS actual component source/highlight/copy and metadata disclosure
observed with screenshots. Menlo fixes iOS source typography. Focused17 and
regressions64 passed; all workspace types/build/fullformat passed, final targets
being rechecked. Record full frozen-head local/CI before promotion. Native
horizontal scroll attempt returned noWindowsAvailable; editor/Android/web
acceptance remains open. See evidence/code-metadata-controls.md.

PR173 full55274 terminalexit0 passed2402/2402 no skips/cancellations. All four
CI37085698130 jobs succeeded. It remains draft with editor/Android/web gates open.
Main1100ca98 unchanged. Other models/source/Home drafts remain automated-qualified
with runtime/native acceptance open. User-requested local preview5174/API8027
uses the marked native-home test DB; credentials are private in/tmp, not Git.
Keep preview servers running. No deploy/release/cleanup; goal active incomplete.

## Source editing candidate — latest 3 October 2026

Native-diagram-parity checkout now owns `codex/docs-source-editing`, based on
PR1749f5fed31; PR173's frozen branch/head is preserved. Source inputs delegate to
both editors' existing update/save queues in Editing mode only. Anchors remain
stable when retained; duplicates reject before that edit saves. Original parser
line spans map the exact typed source, including blank lines/CRLF/fences.

Initial source tests caught final-line anchor loss, fixed without weakening the
identity assertion. Native rapid typing exposed a caret/echo race: weak own-echo
tracking and one-time imperative caret positioning repaired it. Actual native
fixture typing, rendered preview, duplicate error and restoration were observed.
Screenshots in evidence/source-editing. Interleaved user input interrupted some
CUA actions; software-keyboard/swipe acceptance remains open. No fixture account
or API data is used; no server-save proof is claimed by its edit counter.

PR174 automated qualification: fresh retry8218 full2408/2408, all four
CI37087211471 success; old89842 stopped without TAP summary and is not qualifying.
Source candidate final100/100 regressions, typechecks, build and formatting
passed. Freeze a draft and run fresh full suite/CI. Full source/editor revision and
conflict/native/Android acceptance remain required. Main1100ca98 unchanged.
User delegates web visuals to manual verification while implementation proceeds;
no denied browser bypass. Full C1–C6/M1/D1/U1 remains active. Keep test web5174/
API8027 and private credentials/data alive, preserve user/character files. No
release/deployment/cleanup.

## Current ChatGPT model settings candidate

Checkout codex/chatgpt-model-settings is a scoped extraction on main110, preserving4f/e7 and the two untracked settings previews. Owned executor discovery, shared remote state, settings UI on both clients, and remote default refresh before private inference are implemented. Combined67/67, all workspace types/build and owned formatting pass. Full formatting flags only preserved user preview; not staged/edited. Exact-head full/CI and authenticated executor/native/editor/UI acceptance remain required. Markdown89c3 has local2353/allCI success but native/editor acceptance remains open. Home5a and embed79fa full/CI remain live. Full C1-C6/M1/D1/U1 goal retained; no deploy/release/cleanup.

## Model Settings qualification repair

PR170 prior7f486c06 failed full local2347/2350 and CI37078484222. The command-map
reason and actual native AI connections & models SettingsAnchor are repaired;
89/89 combined checks and all workspace types/builds pass. Requalify the new
commit, preserving original failure evidence and both untracked user previews.
No main promotion or M1/U1 completion yet.

## Combined UI review preview — latest 3 October 2026

`home-agent-editorial/Orbyn` now owns `codex/adr-ui-integration`, combining
Home9232cfaa, Docs3eb805d9 and models149a91e9. Frozen candidate branches retained.
Append-only docs/export conflicts resolved by retaining both; generated catalog
regenerated for combined routes. Focused163/163, all types/build/fullformat pass.
Evidence: evidence/adr-ui-integration.md. Full frozen integration qualification
and all runtime/platform gates remain required. No main promotion yet.

Preview5174/API8027 now serve this integration, existing test admin/data intact.
Marked preview DB migrated without reset. Explicit proxy configuration fixes
8008/8027 mismatch; proxied health/login/me/profiles/connections/executors200.
Private credentials are not in Git. Keep preview alive for manual user review.
Docs PR175 full96898/CI37089037682 remain under observation; never infer completion
from a timeout. Complete all C1–C6/M1/D1/U1; no deployment/release/cleanup.

## Views library discovery candidate — 3 October

`codex/views-library-search` in assistant-work-ownership/Orbyn starts at combined
UI e8dbcd7b; the original code/metadata branch is preserved. Both clients share
saved-view search and distinguish no matches from an empty library. Desktop
library scrolling and long headings are bounded; existing view filters/selection/
CRUD/layouts remain. Focused26/26 passed; types/build and exact-head full/CI still
required. Native keyboard/result/Android and user web visual acceptance remain
open. Evidence: `evidence/views-library-search.md`. Whole C1–C6/M1/D1/U1 remains
incomplete; no cleanup or deployment.

Docker engine has recovered. Its in-memory test databases were cleared; isolated
marked databases and preview admin were recreated. Preview health200; user must
sign in again with the same saved credentials. Fresh full runs for frozen
integration176e8dbcd7b and plugin180bc381226 are live, excluding the previous
ENOSPC run. Resources179 CI37091484961 has completed successfully. Other local
PostgreSQL's empty postmaster.pid restart loop was observed and left untouched.

## Source keyboard layout follow-up — 3 October 2026

PR176 e8dbcd7b has all four CI37089753616 jobs successful. Full local98342
terminated with exit7 after ENOSPC, with no TAP completion and no writable exit
file; it is not qualifying. Preview API logging also hit ENOSPC; API restarted
without growing that log, session1131, but readiness503 reports database
unreachable. Docker remains user-controlled. No main merge.

Native computer use reproduced duplicate-anchor error controls squeezing source
to approximately one visible line with the software keyboard on iPhone SE.
Isolated codex/docs-source-keyboard-layout preserves frozen PR175. Controls now
scroll within a measured share of the sheet's available height, retaining editor
space and keyboard taps. Focused25/25 and mobile typecheck pass. First test run
23/25 failed because adding a hook shifted a test's positional state index; hook
order now preserves the selected-block state index and all assertions pass.
Native updated layout/recovery screenshots still required: reload stalled while
fixture fonts were loading; temporary fixture removes its font-load gate for
layout-only inspection. This does not qualify production typography or saves.
Original reproducer screenshot: /tmp/orbyn-source-keyboard-qa/duplicate-error-keyboard.png.
Web permission still saved-denied; no bypass. Full ADR scope remains incomplete.

Updated native fixture rendered after manual Reload. With duplicate error and
software keyboard open, both source lines and caret are now visible above the
keyboard. Restore activated through accessibility and cleared the error/close
guard. Hint/error controls are bounded and some controls require scroll at this
size; native scroll attempt returned noWindowsAvailable, so touch scrolling is
still unqualified. Layout-only fixture bypassed its font-load gate; server saves
and production typography are not proven. Recovery screenshot remains outside
Git at /tmp/orbyn-source-keyboard-qa/restored-keyboard.png. No main promotion.

Recovery-first follow-up: the Restore control now precedes hints/status inside
bounded controls. Actual iPhone SE keyboard/error screenshot shows Restore,
both source lines and caret above the keyboard; accessibility activation clears
the error. Screenshot: evidence/source-keyboard/recovery-first.png. Focused26/26
and mobile typecheck pass. Touch scroll, Android and real editor saves still open.

## Plugin tool boundary structural limits — 3 October 2026

Isolated codex/plugin-tool-input-bounds follows frozen a74ad26a without editing
its original branch or the preserved node_modules link. Tool-call input now
checks finite JSON, at most 16 nested levels and 4096 values before policy/
capability dispatch. Existing 65,536-byte request limit, independent grant auth,
policy and execution remain active. Extra authority fields remain rejected.
12 focused JSON/resource/principal checks and backend typecheck pass. Initial
focused command failed due root esbuild platform installation; retry explicitly
uses the existing healthy Darwin binary without changing shared dependencies.
HTTP tests now assert excessive graphs400 with no argument echo; local DB gate
is unavailable, so those tests/full runtime are not claimed passed. OAuth host,
launch/resource/CSP/event/provider/tenant gates remain incomplete. No main merge.

## Plugin UI resource adapter — 3 October 2026

Isolated codex/plugin-ui-resources follows f74bb9de. The authenticated plugin
backend adds GET /plugin/resources and POST /plugin/resources/read, with strict
bounded identifiers and no arbitrary URL fetch. It reuses existing Orbyn MCP
cards and CSP declarations, filters resources by current registry tool scope,
and attaches resource metadata to authorized tools only when the existing card
UI opt-in is enabled. No browser session, first-party model default or plan
credential is introduced. Reads re-resolve the connector grant on each request.

9 focused resource/input checks and backend typecheck pass. Service assertions
cover401/403/400/429, UI enable/disable, disabled user, non-echoed host address,
metadata association and no-store; local execution awaits marked DB recovery.
Official source inspected: https://developers.openai.com/plugins/build/chatgpt-ui
(shared resource MIME, resourceUri metadata, CSP and portable tool fallback).
This is the separate HTTP resource adapter, not completed MCP-host launch:
transport/extension entry points, host screenshots, account-switch/provider and
async result/event cursors remain open. No main merge, deployment or cleanup.

## Separate plugin MCP transport — 3 October 2026

Isolated codex/plugin-mcp-transport follows frozen9d852b69. /plugin adds the
SDK's current and legacy stateless exchanges under the existing plugin-only
auth hook. Each request gets a server bound to its freshly resolved connector
principal and authorized catalog. It shares one dispatcher with HTTP calls,
retaining quotas, write revalidation/receipts, maintenance guards and activity.
UI resources remain opt-in and scoped. Discovery/list/read cache hints are
private with zero TTL; HTTP responses remain no-store. Unsupported legacy
session operations return405. Host metadata never chooses user or grant.

27 combined SDK/resource/input/principal/catalog checks pass, no skips. Both
legacy initialization and current2026-07-28 discovery/list/call were exercised
without external requests or DB. Structural input refusals happen before
invocation; unexpected errors are generic. Backend typecheck/build pass, final
service assertions being rechecked. HTTP401/403/400/429 assertions now include
the protocol path; local full/service runtime awaits Docker/marked DB recovery.

PR1776220f1c1 and PR178f74bb9de now have all four respective CI jobs successful
(37090985523/37091077562). PR179 CI37091484961 remains in progress. This transport
is not hosted ChatGPT/Codex launch acceptance: extensions, host screenshots,
actual account/provider/tenant execution and async event cursors remain open.
Full C1–C6/M1/D1/U1 continues; no main merge, deployment or cleanup.

## Plugin async reconnect groundwork — 3 October

codex/plugin-job-cursors preserves frozen plugin180bc381226. Local job-cursor.ts
binds a signed reconnect position to the current plugin principal, client/grant/
owner, plugin resource, job, source revision and effective authority. Expiry and
length/safe-integer bounds apply. Display renames/order do not invalidate equal
authority; scope changes, other accounts/grants/resources/jobs/sources do.
Derived key is domain-separated and must load outside read-only transactions.
Six cursor unit checks and backend typecheck passed terminal0. This is not yet
wired to a durable event store/async job route and is not a delivered C6 flow.
Implement live authentication, job/source revalidation and bounded durable event
retrieval before exposing results; keep current unsafe generic stored task reads
out of the plugin path. Do not promote dead groundwork as plugin completion.

UI qualification has priority: Home1834c6 and combined184509 failed the existing
shared font-scale ratchet (three CSS sizes). Combined recovered full finished
2505/2506 terminal1, no skips. Home repair1c00ed79 uses15/13/15, ratchet unchanged,
focused24/24. Combined newb0037a21 contains repair, no source conflicts, fresh
full42763 and build91303. Settings185d041 remains frozen while full62351 runs;
after terminal observation integrate the same repair, requalify its new head.
No main merge, deployment or cleanup; full ADR remains active.

## Plugin async import transport candidate — latest 3 October

Local codex/plugin-job-cursors now adds migration214, source-checked import job
store, shared fresh read/write grant transaction, bounded start/event routes and
response schemas. Cursor/store/protocol17/17 and actual plugin service13/13
passed terminal0. Actual start/replay and status persistence/duplicate/cursor/
visibility/Trash/shield paths are tested; file conversion completion is seeded.
See evidence/plugin-import-jobs.md for missing producer-grant guard at converter
writes and all remaining C6/ADR acceptance. Do not promote before that guard.
Final types/build/format and exact frozen full/CI remain required. No main merge.

Frozen combined184b0037a21 persistent full2506/2506 and settings1853b18468b
persistent full2512/2512 both completed code0, no skips/failures/cancellations.
All four exact-head CI37096051688/37096227442 jobs succeeded. These automated
results do not complete the remaining runtime/native/manual-web/host gates.
Preview services are detached and survive chat interruption. iPhone17 iOS26.5
now displays the actual Orbyn sign-in; the user-reported runtime startup recovery
cause is unverified. Saved credentials verified API8027 login200/admin, filled
existing password securely; human Sign in remains pending. No credentials in Git.

## Current combined qualification candidate — 3 October

A dedicated managed worktree adr-release-qualification/Orbyn combines
Views181ae6d11e7, native keyboard1776220f1c1 and plugin180bc381226, with main110
already an ancestor. Original candidates remain frozen/preserved. Conflicts only
in appended docs; both sides retained. Focused37/37, build and full formatting
pass. Backend/desktop types pass; mobile retry is live after adding the missing
existing react-native-webview dependency link (no source change). Evidence:
`evidence/adr-release-qualification.md`. Its own exact-head full/CI and runtime
acceptance remain required before main promotion.

Recovered UI176 full2474/2474 and plugin180 full2204/2204 both terminated0, no
failures/skips. Plugin180 CI37092219802 all four jobs passed. Views181 full and
CI37092992563 still live. Test preview now serves Views181 at5174 with API8027;
recreated admin login verified. Credentials stay private outside Git. Preserve
all C1–C6/M1/D1/U1 acceptance and original work. No deployment/release/cleanup.

## User Home/task density feedback — 3 October

User screenshots reject excessive repeated Home copy and the bulky task toolbar,
and explicitly reiterate the full application redesign. Local
codex/home-agent-summary starts from Views181, preserves integration176 and
combined182. It makes signed-in Home a compact header/two agent rows with help
behind disclosure, groups native actions, shortens task empty states and makes
responsive task controls compact without removing actions. Public Home moves
examples/result/pause explanations into expandable guides.

Actual native iPhone SE component fixture has loaded fonts and observed guide
open/close/character expansion screenshots in evidence/home-density. Account and
activity are mocked; lower-gallery scrolling unproven. User owns web visual
acceptance; no browser bypass. See evidence/home-workspace-density.md. Final focused 17/17, workspace/final client types, build and formatting passed
with terminal exit 0. Exact committed-head full/CI and combined integration remain required. Full U1 and
C1–C6/M1/D1 remain active; these changes do not complete the full redesign.

Combined18285b8b227 full local passed2502/2502 with no skips/failures; all four CI37093448880 jobs passed. Frozen Views181 ae6d11e7 full2477/2477/allCI passed. No main
promotion, deployment/release or cleanup.

## Remaining delivery pipeline — user tracking, 3 October

Every checkpoint retains full C1–C6/M1/D1/U1 scope and tracks implementation,
automated qualification, runtime/platform acceptance, commit and main integration
separately. No product voice/computer-use work; no deployment/tag/release.

| Order | Work                                                                                    | Acceptance                                                                                                           |
| ----- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | Current Home/task density correction on both clients and public Home                    | Focused/full tests and CI, native evidence and user web review                                                       |
| 2     | Combine correction with frozen PR182 inputs                                             | Latest main, resolved conflicts, fresh combined full/CI                                                              |
| 3     | Providers, embeddings, ChatGPT models/defaults and credential-owning executors C1/C2/M1 | Actual authenticated calls, switching/revocation and managed/BYO isolation                                           |
| 4     | Shell, profile refresh, onboarding, notices and all Settings U1                         | Persistence, keyboard, responsive and native flows                                                                   |
| 5     | Daily planning surfaces U1                                                              | Home/Agenda/tasks/events/Calendar/planning/focus/time/goals/routines/lists complete flows                            |
| 6     | Workspace surfaces U1                                                                   | Projects/stages/Views/Memory/Agent notes/Study, search/edit/saved state                                              |
| 7     | Docs C4/D1                                                                              | Typing/save/concurrency, source/preview, references/metadata/math/Mermaid/import/export and native flows             |
| 8     | Separate Background/Overnight workspaces and runtimes C3                                | Idle/activity, rules, budgets, approval/resume, reflection and collaboration                                         |
| 9     | Maintained pages/routines/comments, Slack then Teams C5                                 | Human edits and scoped access, deduplication and real delivery                                                       |
| 10    | Teams/permissions/Booking/sharing/publication C5/U1                                     | Access, revocation/expiry and responsive viewers                                                                     |
| 11    | Separate plugin backend completion C6                                                   | Async results/cursors/launch/host UI/OAuth, real host/account and current authorization                              |
| 12    | Security and full ADR acceptance                                                        | All destinations including Admin, every requirement proven across platforms; qualified main checkpoints then cleanup |

These are delivery dependencies, not completion claims or a reduced scope. Native
fixtures do not qualify real account/runtime delivery. User performs permitted
manual web visual review; Android and remaining native gates remain open.

## Settings workspace layout candidate and preview crash recovery — 3 October

`codex/settings-workspace-layout` in assistant-work-ownership starts from frozen
combined509ded3c, preserving Views181 and integration184. Web settings now has a
compact category rail beside bounded content; narrow layouts wrap categories
above content. Ordinary named buttons preserve keyboard activation, expose the
current category and control the labelled content region. Search keeps its
existing section selection/open behavior. Every existing settings destination is
retained. Mobile settings flows remain available; this web layout correction is
not a full Settings or U1 completion claim.

Four navigation/render/action/search/layout unit checks passed. Initial desktop
check caught a removed ShieldCheck import and stale shared package declarations;
restore the still-used icon, build own packages and use checkout-local @orbyn
aliases. Final owned-alias desktop typecheck terminal0. Build/format/exact-head
full/CI and user visual review still required before committing/promoting.

User reported preview crash: all preview listeners were absent. Web5174/API8027
and actual mobile Metro/web localhost8083 were restarted; all HTTP200, mobile
web bundle200 compiled1077 modules. Same-URL browser retry again rejected by saved
Browser Use permission; no alternate-surface workaround. Latest preview still
serves qualified Home candidate4c6e045d, not this settings candidate yet.

Local full processes20546/46406 were missing, no matching live tests, no terminal
TAP or exit files; they are interrupted nonqualifying runs. Frozen combined509ded3c
now runs fresh full tests in separate marked orbyn_adr_home_recovered_20261003_test,
log /tmp/orbyn-home-combined-509ded3c-recovered-full-tests.log, session77757.
CI183/184 backend jobs still observed running; other three jobs each passed.
Keep goal/full C1–C6/M1/D1/U1 scope active and all original work preserved.

## Main checkpoint and user-managed production rollout — 3 October 2026

PR184 b0037a21 merged as51c55e91 and PR1853b18468b merged as83d6aa83.
Local main fast-forwarded; the user's mobile/app.json and untracked files were
preserved. Main's committed tree matches the tested settings candidate3b18468b.
Combined2506/2506 and settings2512/2512 full local suites terminated0, no skips
or cancellations; all four exact-head CI jobs passed. Main CI37099735333 is
running independently. These are production checkpoints, not full ADR completion.

Thirteen superseded PRs were closed only after proving their exact heads are
ancestors of main:183,181,180,179,178,177,176,175,174,173,172,171,169.
Their branches/worktrees are retained. PR186 and broader unabsorbed candidates
160,153,151,148,138,137 remain open for distinct outstanding work/review.
No worktree or branch cleanup occurred.

The user explicitly chose to deploy main themselves. GitHub Deploy secrets and
AUTO_DEPLOY are not configured; no automated or manual production rollout was
started. Keep main merging qualified checkpoints and report the exact commit for
the user to deploy. Preserve full C1–C6/M1/D1/U1 acceptance, including native/
manual-web/real-account/host and remaining implementation gates.

## Plugin producer guard and main integration — latest 3 October

Guard457f2a49 follows frozen157ad6f1. Migrations215/216 follow main214; synchronous
and async plugin starts record immutable grant/client/recipient origin. Current
locked authority protects upload admission, post-stream queueing and converter
document creation. Real Word conversion plus13 denial variants and ciphertext/
key removal are covered. Serial30/30 terminal0, no skips/cancellations; backend
types and formatting passed. Only ADR/task append conflicts occurred when
integrating main947b0c23; both histories retained. Requalify the combined frozen
head before another main checkpoint. Remaining C6 protocol/host/account/provider
and full C1–C6/M1/D1/U1 acceptance stay open. User manages production deployment;
no deployment or worktree/branch cleanup. Native Sign in consent question pending.

## Maintained pages continuation — 4 October

Current mainfdaf13e2 contains merged Settings modal PR193, qualified local2580/2580
and CI37132802593 all four jobs. User deploys main manually. Primary checkout
user changes remain preserved.

Owned branch codex/maintained-pages-contract includes current main and local
A5 migration219, selected-block storage/context plus owner-only CAS management
routes/client methods. Focused28/28 and all workspace types pass; no public UI or
runtime consumes the bindings yet. No new PR/main merge until runnable end-to-end.

Next: persist binding/revision references in scoped jobs; claim schedules once,
respect Background/Overnight lane ownership and budgets; rebuild current context
before provider/resume/apply; document save must preserve human blocks, refuse
stale/moved/deleted ownership and fence linked task writes; baseline advances
only for an authorized successful agent save. Then both client explicit selection,
schedule/consent, pause/status/review; scoped @orbyn comments, edit/delete/retry
dedup and privacy. Finish real concurrency/revocation tests, full local/CI and
web/manual + iOS/Android inspection. Full C1-C6/M1/D1/U1 remains active.

### A5 guarded save follow-up — 4 October

Owned page-binding branch has an internal apply helper plus server-only
selected-block save processing. Current trust/action rules and separately locked
linked-task authority precede all writes; page history and binding baseline
advance atomically. Human blocks and unrelated task ticks remain untouched.
25/25 focused,118/118 broader Docs regressions and all workspace types pass.
No route accepts a client-provided approval flag. No scheduler/model/UI wiring or
production promotion yet. Next durable claims must carry binding and rule
revisions (IDs, not copied source text), preserve them across review/resume, and
use selected-block-only provider context. Preserve all broader acceptance gates.

### A5 scoped job checkpoint — 4 October

Migration220 and internal scoped-run helpers queue references only, bind original
rule/page/binding revisions, claim lane-specific unique leases, stage once, and
carry a unique owner-bound waiting card. Replaced workers cannot write/fail their
successors. Binding edits clear in-flight output; expired work releases ownership.
Final159/159 regressions include Docs/rules/worker lanes/storage/API/core/retention.
No model request or actual scanner/consumer is wired yet, so do not promote or
claim working page automation from these helpers.

Next wire selected-block-only provider execution with staged recovery; respect
current account/default model selection. Integrate the existing Overnight serial
queue, run/reflection slot limits, shared token accounting and morning results
rather than running a second parallel night consumer. Then both client controls,
scoped @orbyn comments and full runtime/native qualification. Main remains
fdaf13e2; user deployment and unrelated primary files stay under their control.

### A5 hosted execution / provider main candidate — latest 4 October

Owned maintained-pages branch has bounded real hosted provider execution,
pre-transmission reservation, staged recovery, immutable account model origin,
current Night window/policy and retained review consent. Explicit owner review
applies a saved patch immediately, including after the night window, without
resuming model work. Live doc/collection notices commit with the page; Study uses
its existing durable queue.209 regressions, all workspace types and build pass.

Compatible provider files were isolated from this unfinished feature:
PR194, branch codex/provider-completion-guards, exact4e0a246f based mainfdaf13e2,
worktree devday-model-catalog/Orbyn. Full persistent local qualification PID25912,
config /tmp/orbyn-persistent-provider-guards-4e0a246f.json; fresh CI pending. Main
merge requires local types/build/full plus exact CI success. No A5 files in PR194.
Provider guards include HTTP200 error-envelope key redaction, validated optional
output caps, and credential-free provider identity/configuration snapshots.

Next A5: connect actual producers/consumer to shared runtime slots; explicit fresh
source selection, account/default execution channel, budget/activity/undo, Night
serial slot/reflection/morning integration, both UI flows and @orbyn comments.
Do not promote the internal helper as completed automation. Full C1-C6/M1/D1/U1,
real-account/host/provider/native gates and user deployment remain unchanged.

### A5 owner review API checkpoint — 4 October 2026 (not promoted)

Owned document-run listing and nonce-bound decisions are available in the development
branch and shared client contract. Progress GETs neither create nor touch assistant
grants; they omit worker leases and hide proposals when current source or authority
changed. Decision transactions retain Night → grant → document → binding → run lock
ordering and reject stale/repeated cards. Successful saves synchronize Study.

Focused HTTP coverage passes15/15 with no skips/cancellations; all workspace types
pass. Evidence: `/tmp/orbyn-page-review-api-focused.log` and
`/tmp/orbyn-page-review-api-final-types.log`. This is not a visible/running feature:
service/shared-slot integration, sources, budget/activity/undo, both client controls
and the broader C1-C6/M1/D1/U1 acceptance remain open.

Main is now ee45ecf0: PR194 merged after corrected934e87d8 passed2582/2582
local tests and all four CI jobs37149341825. User deploys main themselves.

### A5 shared provider capacity checkpoint — 4 October (not promoted)

Chat and maintained-page claims now use the same transaction advisory lock and
count live leases across both queues. Background page work shares the existing
two Background slots; it cannot consume the four interactive slots. The separate
two Overnight slots and eight total slots remain unchanged. Expired leases and
waiting jobs do not occupy execution capacity. Mixed queue regressions prove
both directions, concurrent page claims and released capacity after expiry.

Verified45/45 (runs, owner review API, provider consumer, runtime lanes and runner),
zero skips/cancellations; backend typecheck passes. Evidence:
`/tmp/orbyn-page-shared-slots-verified.log` and
`/tmp/orbyn-page-shared-slots-types.log`. Earlier fixture failures are superseded
by this terminal code0 run; they are not passing evidence.

Still no service producer/consumer or client controls. Before activation, require
shared consumer lifecycle/shutdown recovery, mixed-version worker rollout safety,
Night per-person serial ordering/ten-run/reflection/morning outputs, explicit
source selection, budgets/activity/undo and all broader ADR acceptance gates.

### A5 consumer lifecycle and Night serialization — 4 October (not promoted)

Private Background/Overnight services now claim page work through their existing
lane runner, sharing process capacity, cross-replica leases and shutdown. Queue
preference alternates to avoid starving scoped work behind chat automation.
Interactive workers reject scoped automation. The runner stops each scoped job
once and waits for its cleanup. Uncharged or already staged work is requeued
without another provider charge; unknown charged requests remain held.

Claim guards serialize page and ordinary Overnight work for the same person.
The Night scanner sees queued/running page jobs before selecting or closing work.
Waiting human review does not occupy provider execution capacity. Different
people retain the existing two global Overnight slots.

Verified77/77 tests, no skips/cancellations, terminal code0:
`/tmp/orbyn-page-worker-lifecycle-final-tests.log`. Backend typecheck code0:
`/tmp/orbyn-page-worker-lifecycle-final-types.log`. Tests cover consumer recovery,
uncertain requests, process capacity/shutdown, exact approvals, mixed queue
claims, existing Night scanner behavior and original runner recovery. Source
wiring is present; a full live-service/page scheduling acceptance is still absent.

Next: actual bounded due producer with current source/authority; Night candidate
integration and ten-run/reflection slot accounting/morning results; safe rolling
upgrade activation; explicit sources, budgets/activity/undo; both clients and
complete ADR/local/CI/runtime/native qualification. Do not promote as finished A5.

### A5 bounded Background producer / service delivery — 4 October (not promoted)

The private Background service now scans due bindings once per minute in bounded
round-robin batches. It excludes disabled/suspended/revoked/expired owners,
paused/ended bindings, active jobs, inaccessible/AI-excluded pages and Night-owned
follow-through. Each candidate rebuilds current authority and selected context
inside the canonical transaction lock order. Reviewed deny rules stop queueing;
source/authority conflicts do not advance the schedule. Concurrent replicas queue
a due occurrence once. Selected unavailable models retain the existing defer
semantics without falling back to a different account/provider.

Verified79/79 tests, terminal code0, no skips/cancellations:
`/tmp/orbyn-page-due-service-tests.log`. Backend types pass:
`/tmp/orbyn-page-due-service-types.log`. New actual-service test starts the private
Background Fastify worker, observes its real due producer and hosted HTTP fixture
request, verifies ready200 and selected-block version2 save while preserving the
human block, then closes the worker. This proves local service delivery; it is
not real-provider/account or deployed production acceptance.

Night candidate/ten-run/reflection slot accounting and morning outputs remain
next. Safe rolling upgrade, explicit source selection beyond target blocks,
budget/activity/undo, web/mobile controls and full ADR qualification remain open.
Main is unchanged; this feature is still on the development branch.

### A5 Night plan, shared limits and morning progress — 4 October (not promoted)

Due page bindings participate in the existing Night candidate plan through
follow-through. Current source, page ownership and reviewed rules are checked
before selection and again inside queueing. They use the scoped page queue,
retain original consent/model provenance, and advance the Night cursor/run count
atomically. Queued/running pages serialize with ordinary Night work; the shared
ten-run cap and final reflection slot still apply. No private instruction or
page title is copied into the Night candidate labels.

The Night API now includes optional scoped page progress metadata. Current
assistant authority and page visibility guard it; no proposal words, worker
leases, credentials or hidden titles are exposed there. Page approvals remain
nonce-bound in their document API. Morning digest counts finished/review/settling
page work and links to the document; the existing single morning push also treats
page work as settling. Revoking the current scope hides its page progress.

Verified93/93 tests, no skips/cancellations, terminal code0:
`/tmp/orbyn-page-night-service-final-tests.log`. All workspace types pass in
`/tmp/orbyn-page-night-all-types.log`. New tests cover dedup/run accounting, shared
ten-run cap, reflection slot priority, current visibility and morning metadata.
An actual private Overnight worker test queues from the real scanner, calls the
local HTTP provider fixture once, stages required approval, reads the Night
progress, closes its runtime, then applies an exact owner decision without
resuming inference. Real provider/account/deployment acceptance is still open.

Next both client binding/source/consent/status/review controls and Night page
cards. Still open: explicit source selection beyond target blocks; budgets and
activity/undo; including page outcomes in reflection evidence; safe rolling
worker activation; verified account-default/device inference; broader full
local/CI/web/manual/native acceptance and complete C1-C6/M1/D1/U1. Main unchanged.

### A5 cross-client controls draft — 4 October (visual acceptance pending)

Web/desktop now has a bounded native modal; mobile has our native BottomSheet.
Both document menus flush pending edits and refuse unsaved/offline work before
opening Page updates. One shared portable controller owns fresh page/binding/run
reads, stable missing-block IDs through ordinary CAS document persistence,
selected-block create/edit, pause/resume/remove and exact waiting-card decisions.
Account switches prevent dependent writes and clear old evidence. Disposal and
React effect replay cannot restore an old result or leave the panel busy forever.

Both surfaces show selected blocks/instructions/daily or weekly cadence, saved
schedules behind options, recent status/token estimates and the actual saved
proposal in Markdown source before Apply/Decline. Pausing preserves the original
reviewed page revision; explicit Edit/Save reviews and rebinds current blocks.
The web native dialog owns focus/Escape; repeat buttons remain inside it, avoiding
our Select portal outside the browser's modal top layer. Palette/radius tokens
and native scrolling/keyboard sheet primitives are retained.

Shared controller4/4 unit checks pass, no skips/cancellations:
`/tmp/orbyn-page-controls-delivery-tests.log`. All workspace types code0:
`/tmp/orbyn-page-controls-delivery-types.log`. Production build code0:
`/tmp/orbyn-page-controls-delivery-build.log` (existing large-chunk warning remains).
These prove source/build/controller behavior, not rendered acceptance. The iOS
Simulator was reached with Computer Use, but it is still serving the prior preview
source; its existing planner429 overlay is not evidence for this draft's layout.

Next switch owned API/Metro previews to this branch against the marked preview DB
with migrations219-223, preserve the test admin, inspect/screenshot the new native
sheet, typing/scrolling/schedule/review states and correct layout. Web visual
acceptance remains human review under the explicit blind-redesign authorization;
no saved Browser Use block bypass. Add Night page cards on both clients, explicit
additional sources/budgets, activity/undo/page reflection evidence, rolling worker
activation and account/default device delivery. Full local/CI/native/ADR acceptance
still required before main promotion; full C1-C6/M1/D1/U1 remains active.

### A5 native inspection, schedule layout and Night cards — 4 October (not promoted)

Owned API/web/Metro previews now use this branch; migrations219-223 were applied
only after proving the preview database's `_test` name and server-side test marker.
The existing local admin/session is preserved. Persistent helper backups remain
in `/tmp/*before-maintained-pages`; current preview PIDs are recorded externally.

Actual iPhone17/iOS26.5 Computer Use verified saved page content, menu entry,
selected-block checkbox, instruction typing, weekly schedule creation, Pause,
paused Edit/Resume actions and reopening with retained selection/cadence. The
first run caught a real save guard bug: mobile's focused draft left a reference
`dirty` flag set after successful persistence. The new shared content/title
comparison accepts saved drafts and refuses changed/offline content. It has a
focused regression alongside the shared controller tests.

Both clients now collapse configuration when schedules exist and show schedules
and recent runs first. Add/Edit opens just the configuration section. Native has
an explicit accessible Close; its action was verified to restore the underlying
page without changing saved content. Night page cards on both clients open the
corresponding page; they are excluded from unrelated chat bulk decisions.
Screenshots: `docs/reviews/evidence/maintained-pages-ui/`. Before-layout and edited
form snapshots are labeled separately; compact paused view includes the final
Close control and singular block wording. Native scroll/drag attempts did not
move the earlier long form; this is not scroll acceptance. Software keyboard,
long proposals, Night cards, landscape/dark/large-text/Android and web rendered
acceptance remain open. HMR left an empty native modal once; returning to Expo
Home and reconnecting the owned Metro project restored it. No browser bypass.

98/98 combined store/controller/Night/reflection/page service/API/run tests pass,
zero skips/cancellations, terminal code0:
`/tmp/orbyn-page-native-layout-regressions.log`. All workspace types pass in
`/tmp/orbyn-page-native-acceptance-types.log`; final production build passes in
`/tmp/orbyn-page-native-acceptance-build.log` (existing large-chunk warning).
Rendered acceptance is limited to the interactions above, not the full app.
A new planner GET/items429 was observed after native dismissal; production
refresh/profile429 is explicitly still unresolved, not merely an old overlay.

Next exact proposal/approval native screenshots, Night page cards and manual web
acceptance. Then explicit additional sources and budgets, activity/undo and page
reflection evidence, rolling worker safety, real account/device delivery and
remaining full C1-C6/M1/D1/U1 gates. Main promotion/full goal completion remains
unproven; the disposable native schedule stays paused and production untouched.

### A5 native exact review and receipt follow-up — 4 October (not promoted)

A labeled proposal was staged through internal scoped helpers in the marked
local preview DB only. It is a UI fixture, not provider/inference evidence:
modelCalls0 and synthetic100 estimated tokens. Native UI showed the exact saved
replacement, then Apply changed the owned run to done and removed its waiting
card. The underlying document displayed exactly `UI fixture: a concise disposable
summary.`; authoritative DB check reported version6, done and waiting ID cleared.
The disposable schedule was paused and prior Night preferences restored.

Native Overnight displayed its separate page-result card and Open page action;
current screenshots are in `docs/reviews/evidence/maintained-pages-ui/` with
`fixture` in their filenames. Existing dev LogBox partially covered the review
buttons visually, although the native accessibility action and persisted result
were verified. This is not long-proposal/software-keyboard/Android acceptance.

Inspection also caught stale receipt metadata: external/maintained saves updated
content but left the old Saved time. Both editors now update receipt time on
accepted clean external changes and maintained-page callbacks; callbacks older
than the current page revision cannot regress it. All workspace types pass in
`/tmp/orbyn-page-review-receipt-types.log`. Native re-read displayed the newer
20-minute receipt instead of the old one-hour label. No local draft was overwritten.

Main/PR195 remains a separate compatible session-rate checkpoint. Corrected e4ed6749
passed CI37157146020 all four jobs. Its local full run completed2396 checks without
failures before sessions.test.ts stalled with an identical IPv6 local/peer TCP
endpoint and no registered PostgreSQL connection. That confirmed transport stall
was cancelled and recorded externally, not called passing qualification. A new
fresh marked IPv4 full run is live; merge still waits for complete local evidence.

Next: complete that qualified main checkpoint and bring it into this branch,
then complete explicit extra sources/budgets, activity/undo and page reflection,
rolling worker activation, real account/device execution, remaining native/web
render acceptance and full C1-C6/M1/D1/U1. No A5/main or whole-goal completion claim.

### Session refresh rate-limit candidate — 4 October (qualification pending)

The observed local429 burst contained288-311 requests/minute from web and mobile
sharing loopback; steady traffic was27/minute. A compatible backend-only candidate
counts global authenticated app requests per verified live device session instead
of sharing an IP bucket. Session identifiers come from indexed current DB lookup;
no raw token or client-supplied identity becomes a bucket. No authorization is
cached/skipped. Expired/deleted/disabled/forged sessions fall back to IP, and
route-specific stricter session limits remain IP-based. Existing API-key/MCP
buckets, threshold180, gateway burst limits and authentication behavior remain.
This addresses shared-address interference, not all possible429 causes or
production deployment acceptance.

Focused134/134 regressions pass in `/tmp/orbyn-session-limits-verified-regressions.log`.
Low-limit tests now start a fresh verified session rather than pretending a new
IP resets that device's window. The first helper version imported the DB pool
before test setup finished; it was corrected to dynamic imports after the marked
DB check. That failed run was cancelled after verified connection failures and
is not passing evidence. Workspace types pass in `/tmp/orbyn-session-limits-types.log`.
Build/full fresh DB/CI and controlled runtime qualification are next.

Candidate lives on codex/session-refresh-limits in devday-model-catalog/Orbyn.
No unfinished maintained-page files are included. A5 remains f8780ee6 in its own
branch; all source/budget/activity/undo/reflection/device/native/whole ADR gates
stay open. Main remains ee45ecf0; user handles production deployment.

### Session rate-window qualification follow-up — 4 October

Exact c82b0d22 full local run terminated code1:2568/2587 passed,19 failed,
no skips/cancellations. CI37155960329 passed mobile/Docker/mail and failed
backend-and-web. No merge was attempted. Every local failure traced to fixtures
that reused a device session across unrelated cases or treated a new IP as a
fresh global window. Fresh independent sessions now isolate those windows;
long template/picture suites use an independent device session per case.
The prior authorization-proof time is copied exactly, never refreshed by the
fixture. Lazy backend imports preserve both marked DB selection and each file's
local renderer/environment setup.

148/148 corrected affected regressions pass, no skips/cancellations:
`/tmp/orbyn-session-limit-window-verified-regressions.log`. New checkpoint/fresh
full run and exact CI are required; c82's failed full run is not qualification.
Product thresholds/stricter routes/gateway/API-key/MCP behavior stay unchanged.
A5/native work remains separate and incomplete; main remains ee45ecf0.

### Qualified main checkpoint and workspace layout draft — 4 October

PR195 merged exact e4ed6749 after full fresh IPv4 local2588/2588 code0, no skips
or cancellations, and CI37157146020 all four jobs passed. Main/origin main now
7f253b80; the primary checkout fast-forwarded with user changes preserved. This
addresses authenticated session/IP interference; production deployment remains
with the user and universal production429 resolution is not asserted. Qualified
main was integrated into the maintained-pages branch. Only two documentation
append conflicts occurred; both histories were retained and markers cleared.
The owned preview API restarted with the qualified session bucket implementation.

U1's new signed-in workspace layout draft now spans every web/desktop screen:
compact sidebar/wordmark, header rail toggle, quieter location label, consistent
working-surface padding and cards, unrestricted Docs canvas width, smaller Home
panels and a task toolbar with separate title/progress and search/layout/filter
rows. Desktop/tablet rail geometry uses one224px/72px pair; existing800px mobile
web drawer breakpoint stays aligned, and coarse-pointer controls retain44px
minimum targets. Palette/radius tokens are used and public landing/auth/dialog
surfaces retain their separate styling. Navigation controls now reference the
same accessible sidebar landmark and report expanded state.

Source-contract4/4 checks pass in `/tmp/orbyn-workspace-layout-contract-tests.log`;
final desktop types pass in `/tmp/orbyn-workspace-layout-final-types.log`.
All workspace types/production build pass in
`/tmp/orbyn-workspace-redesign-final-types.log` and
`/tmp/orbyn-workspace-redesign-build.log` before final aria-only control wiring.
These are source/build checks, not overlap or visual acceptance. Browser Use was
retried at the original127.0.0.1:5174/app tab and again denied by saved permission;
no alternate browser/port/CDP/indirect bypass was attempted. User's standing blind
web redesign/manual screenshot review authorization applies. The live preview
serves this draft; rendered web acceptance remains pending.

Next complete remaining whole-app layouts and manual web/desktop acceptance,
retaining native behavior/feature parity. A5 extra source selection, per-binding
budgets, activity/undo/page reflection, rolling worker activation and actual
account/device inference remain open, along with full C1-C6/M1/D1/U1 gates.
No workspace/A5 production promotion or full goal completion is asserted.

## 2026-10-04 — chat layout and contextual suggestion feedback

Scope clarification: character configuration belongs exclusively to Background
and Overnight. Those agents need separate identities and profiles as well as
separate runtimes. Interactive chat uses Orbyn and does not force character setup.
Independent per-agent saved identity/configuration remains open; the legacy
Background/Overnight identity is still shared.

The collapsed-sidebar screenshot revealed competing chat/workspace CSS and an
obsolete 148px character header. The draft now gives chat viewport rules priority,
uses a compact aligned header and centers the empty heading above its bounded
composer. Search fields use one wrapper focus indicator. Connection controls now
expose desktop connection instructions on web/mobile; direct web/mobile ChatGPT
sign-in and verified device inference remain incomplete.

Shared chat actions now request fresh model-generated task suggestions, priorities,
plans and reflections from authorized context. Prompts request evidence/citations,
separate inferred patterns from observed facts, avoid invented commitments and
require review before task creation. The invented personal example task was removed.
These action labels are requests, not already generated recommendations. No extra
background inference or refresh-time AI calls were added.

Home quote selection still draws an excerpt from the person's selected page.
Automatic AI Home task suggestions and context-based quote/excerpt selection are
NOT complete. Next implement a bounded, consented generation pipeline with source
references, freshness/invalidation, account isolation, current visibility checks,
no duplicate tasks and explicit AI-written reflection labels. Reuse Background
outputs where appropriate; preserve separate Overnight execution and review.

Validation: all workspace typechecks passed and focused regression checks 9/9
passed (no skips). iOS was inspected and captured at
`docs/reviews/evidence/interactive-agent-separation/ios-context-actions.png`:
new actions/composer are visible without overlap in the current portrait viewport.
Production web build passed. Source tests are not rendered web acceptance or live model-output validation.
Browser permission remains blocked; user-authorized manual web screenshot review
applies. No main promotion, production deployment or full ADR completion asserted.

## 2026-10-04 — independent automation identities checkpoint

Background and Overnight now have distinct persisted name/persona/character
settings. Migration224 copies each existing legacy identity into two independent
rows once; later saves are owner/lane-bound and compare an expected revision.
Concurrent or stale saves return409. Defaults for new accounts use lane names.
First-party identity routes reject API keys, unknown lanes/bodies/query arguments,
and rate-limit writes. They do not alter grants or make either worker active.

Interactive chat retains Orbyn with no automation persona. Automation context
reads the relevant lane identity. Profile snapshots and both Home companion cards
read the separate identities. The client validates returned lane/revision metadata
and suppresses save broadcasts after an account change. Web/mobile settings have
Background/Overnight selection, a reload action and a compact character preview;
detailed appearance editing opens only when requested. The original shared
`/me/agent` interface remains for legacy integration compatibility and no longer
controls these two runtime identities after migration.

Evidence: API/migration3/3 pass in `/tmp/orbyn-lane-identities-api-final2.log`,
including simultaneous save CAS, account separation,401/403/400/422/429 coverage,
legacy snapshot preservation and owner-delete cascade. Client/profile/runtime
contract8/8 checks pass in `/tmp/orbyn-lane-identities-final-units.log`.
All workspace types and production build passed on the final source checkpoint
(`/tmp/orbyn-lane-identities-final-source-types.log` and
`/tmp/orbyn-lane-identities-final-source-build.log`). Final native spacing adjustment
has its own typecheck in `/tmp/orbyn-lane-identities-final-native-types.log`.

Native iOS was actually operated: switch to Overnight, edit name, save, switch to
Background (unchanged), return to Overnight (saved name persisted), then restore
the fixture name. Screenshot `docs/reviews/evidence/automation-identities/ios-overnight-saved.png`
shows the compact editor. `ios-compact-identity-restored.png` shows the selected
segmented control after fixture restoration (a final10pt gap separates it from
Reload). `ios-restored-fixture.json` records the verified local
test database's independent revisions and restored names. Native drag/scroll APIs
returned noWindowsAvailable; accessibility clicks brought controls into view.
The screenshot still includes the old planner429 LogBox. Broad native layout,
keyboard/landscape/large-text, Android and web rendered acceptance remain open.
Preview test database was marker-verified, migrated and owned API restarted.
No production migration/deployment, main promotion or full ADR completion claimed.

Next qualify a frozen branch head, then isolate qualified production checkpoints.
Continue automatic grounded Home suggestions/reflections, A5 source/budget controls,
activity/undo/page-reflection, actual device inference, external host acceptance
and whole-app C1-C6/M1/D1/U1 requirements. Existing execution lanes remain separate.

### Frozen qualification correction — independent identities / A5 capability mapping

Checkpoint `deffbfc4` is committed and pushed. Its full fresh marked test-database
run was stopped after a confirmed failure in `agent-no-ai.test.ts`: six maintained-
page control routes were classified as hosted inference with no declared twins.
The failed run is not passing evidence. Cancellation and exact head are recorded
in `/tmp/orbyn-lane-identities-deffbfc4-cancelled.json`.

Inspection shows these six routes configure/inspect owner-approved bindings and
review results; they do not expose model execution to outside agents. They now
use the existing `assistant_control` classification, preserving first-party
restriction. The maintained-page feature has an explicit outside-agent equivalent:
`fetch`, `get_history`, `edit_doc` under the connection's existing grant and its
own model/scheduler. It neither enrolls hosted work nor approves hosted output.
A dedicated contract asserts this separation while the existing import-graph
shield still checks all capabilities for provider/hosted-run imports. The old
unused global identity lane helper was removed so it cannot suggest that the two
new persisted profiles still share a settings object.

Focused API/migration/client/import-graph/parity7/7 checks passed in
`/tmp/orbyn-lane-identities-parity-followup.log`. A fresh full run on the corrected
frozen head is still required. Web/manual review, native wide/keyboard/large-text,
Android, automatic Home recommendations/reflections, A5 source/budget/activity,
reflection evidence, verified device inference and external host gates remain
open. No main promotion or deployment is asserted.

### Route inventory qualification follow-up — 4 October 2026

The exact `6974d65c` route-inventory preflight found the new GET/PUT lane identity
routes were not classified. That run was stopped on this confirmed same-head
failure; `/tmp/orbyn-lane-identities-6974d65c-cancelled.json` is not passing evidence.
Both endpoints now explicitly use `assistant_control`; they remain first-party
and cannot be reached by connected agents. The complete route inventory,
model-free import-graph/twin shield and identity API/migration checks now pass
12/12 with no skips in `/tmp/orbyn-identities-inventory-parity-final.log`. The
focused identity schema/runtime/client checks pass4/4 in
`/tmp/orbyn-identities-parity-units.log`. All workspace types pass in
`/tmp/orbyn-identities-parity-final-types.log`. A fresh exact-head full suite remains
required before main promotion; full ADR and visual acceptance remain open.

## 2026-10-04 — SIWC plan/usage priority and narrow-panel feedback

User priority: use the official Sign in with ChatGPT flow; a pre-issued client ID
is not needed for local dynamic registration. The pasted prototype starts with
`dynamic_agent_client`, receives an issued ID and uses granted plan credentials.
Existing desktop OAuth already follows that pattern with persistent installation
host ID, PKCE/state/nonce, bounded loopback callback, retained registration,
verified ID token and protected credentials. Do not add a partner client-ID gate
to this local flow. The official website identity flow is distinct; a local
127.0.0.1 callback reaches the browser's computer, not a hosted API. Direct web
sign-in/connected-device inference is still incomplete and remains highest priority.

Official sources inspected: cookbook article `sign-in-with-chatgpt`, SIWC website,
self-hosted VMs, models-and-inference, token-reference and errors-and-recovery.
OpenAI authentication metadata is opaque. Do not invent Plus/Pro tier claims,
remaining quota or reset times from identity tokens or error codes. Identity,
granted plan permission, live model discovery and completed inference are
separate evidence states. Account and workspace registrations remain separate.

A desktop `verify-plan` metadata command now sends one fixed short test through
the selected account/default model's private runtime. It requires granted plan
access, fresh account model discovery, nonempty output and response.completed.
The receipt is account-bound, records the actual used model, time and only valid
provider-reported input/output/total token counts. Missing/invalid counts stay
unknown. Account switching/closing the runtime drops this receipt. It is a proof
for that completed test request, not a guarantee of future quota or plan tier.
The renderer cannot supply arbitrary test content or credentials. Quota and
eligibility errors remain terminal and do not change billing. Errors preserve
sanitized machine code, HTTP status and request ID; no provider body is echoed.

Desktop settings expose Verify plan access (explicitly describes the small test)
and Manage ChatGPT usage. Web/mobile expose the same official usage-settings link
and remind the person to choose the corresponding ChatGPT account. Remote/native
verification receipts and actual user-chat plan inference remain open; this is
not full cross-client plan verification or remaining-allowance delivery.

The narrow chat drawer uses available chat width via ResizeObserver, a single
History/Upcoming open state, bounded overlay width, scrim, close/Escape/Tab focus
behavior and inert conversation controls. Opening global navigation closes chat
panels; opening a chat panel closes global navigation. Duplicate header controls
are hidden under the overlay. Manual web layout acceptance is still pending.
Home fixtures now use separate lane reads/subscriptions and real functional state
updates. Account changes hide prior identities immediately. Generated MCP docs
were regenerated after inventory changes. The stopped ee0cd5a2 full run had11
failures (ten Home old-fixture dependency failures and the catalog mismatch),
not four; cancellation is recorded and is not passing evidence.

Evidence: plan/UI49/49 focused checks pass in
`/tmp/orbyn-priority-plan-ui-final-tests.log`; inventory/catalog13/13 pass in
`/tmp/orbyn-priority-plan-inventory-tests.log`, all without skips. All workspace
types pass in `/tmp/orbyn-priority-plan-final-types.log`; production build passes
in `/tmp/orbyn-priority-plan-final-build.log`. The owned preview API was restored
and health returned ok after a PostgreSQL connection terminated unexpectedly.

User-requested browser diagnostic: original127.0.0.1:5174/app was explicitly
rejected by saved Block preference. An unrelated example.com page opened via the
same Browser Use surface. Screenshot `evidence/browser-access/example-com-control.png`
is public diagnostic evidence, not Orbyn web acceptance. No alternate port,
Chrome, CDP or indirect blocked-preview inspection was attempted. Full frozen-head
local/CI and actual OpenAI account authorization/inference acceptance remain
required; no main promotion, deployment or whole ADR completion claimed.

## 2026-10-04 — one-button ChatGPT provider authorization follow-up

User clarification: MCP is a separate Orbyn data/tool connection. Provider
settings must offer one Connect to ChatGPT button, start authorization directly,
let the person finish OpenAI sign-in/consent, and return to updated connection
state. Remove Connect on desktop and the intermediate sign-in-settings tutorial.
ChatGPT-primary chat routing and a separately chosen Orbyn-default fallback are
now the immediate next implementation priority. Neither is claimed delivered.

Migration225 adds bounded, ten-minute, session-bound authorization handoffs.
First-party web/mobile start a request; the signed-in credential-owning app for
the same person claims it once and calls the existing dynamic SIWC flow directly.
Web's opaque app link speeds up that handoff; the app also watches explicitly
requested pending handoffs for cross-client initiation. Different accounts,
replay, expired/revoked initiating sessions and other claimant sessions cannot
complete a request. OpenAI codes/tokens are absent from handoff storage and app
links. The user still finishes actual OpenAI consent. No MCP grant is minted or
changed. Original/claiming Orbyn sessions and current verified connection are
rechecked before completion. Hourly sweeping deletes expired handoffs.

Web/mobile now show Connect to ChatGPT and bounded, cancellable status polling;
no sign-in-settings redirect is part of the primary action. The installed,
signed-in credential-owning app is still required for this local OAuth callback
flow. Pure hosted-browser OAuth and native-only local callback ownership have not
been invented or claimed. This limitation must remain visible in qualification.

Focused source/API/client/UI/inventory tests pass70/70 with no skips in
`/tmp/orbyn-one-click-full-focused.log`; all workspace types and production build
pass in `/tmp/orbyn-one-click-final-source-types.log` and
`/tmp/orbyn-one-click-final-source-build.log`. Current native controls were actually
inspected in dark mode and captured at
`evidence/chatgpt-one-click/ios-connect-usage-controls.png`, showing one provider
Connect action, refresh and usage management without overlap. No actual OpenAI
account consent or live plan inference was performed. The test preview was
marker-verified and migrated through225; the helper's fixed console message still
says224 and is not the migration-version authority.

The desktop fixed verification request and measured usage receipt remain in this
candidate; availability, permission and completed inference remain distinct.
Web/mobile can view official usage settings; no account tier, remaining allowance
or reset time is fabricated. Actual composer/job routing through the user's
ChatGPT account, signed execution results and explicit default-provider fallback
remain open before production promotion. Full C1-C6/M1/D1/U1 scope is retained.

### 4905456e full qualification correction — 4 October 2026

The full run was stopped on confirmed failures and is not passing evidence.
Replay/rules failures coincide with PostgreSQL connection termination and recovery
mode57P03. A healthy marked-database rerun of those actual suites passed37/37 in
`/tmp/orbyn-490-replay-rules-recheck.log`; no product assertions were removed.
Model-control fixtures lacked new core/API/session/error imports and used one
state cell for every React hook. They now model separate state/ref slots and
functional state updates. Existing bounded-search, disabled/offline selection
and model/default behavior checks remain. Font styles were moved onto the shared
11/13/15/18/24/36 scale; no checker exception was added. Neatness and model UI19/19
checks passed in `/tmp/orbyn-490-style-ui-followup.log`.

A separate attached model worktree is on `codex/chatgpt-execution` for the actual
inference transport. Its workspace package builds are isolated; preserved preview
files and the former dependency symlink remain intact. Runtime request/receipt
contracts and encrypted request storage are in progress there, not delivered.
Continue ChatGPT-primary routing and explicit Orbyn-default fallback first, while
retaining every C1-C6/M1/D1/U1 requirement. No main or production promotion claimed.

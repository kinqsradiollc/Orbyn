# Current implementation handoff — 3 October 2026

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

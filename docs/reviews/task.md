# Authoritative implementation pipeline — 6 October 2026

Main baseline is `690f6246`, pushed; Slack PR204 merged after all four CI37321894816 jobs passed. User deploys manually; production recovery is not
verified here. The full ADR goal remains active and incomplete.

| Work                        | Confirmed state                                                                                                                                                                                                                                       | Next implementation or acceptance                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ChatGPT and model defaults  | Selected-provider routing, owned `/models`, defaults and web/mobile-to-desktop connection handoff on main                                                                                                                                             | Successful real-account Responses completion, real handoff and truthful whole-account plan/usage acceptance                                                              |
| Scheduled Agenda            | PR199 merged;2938 CI passes plus99 local focused passes. Resumption fixture repair passed18 cases and five independent repeats                                                                                                                        | Native/web controls and positive real-provider acceptance; unsupported hard-limit catalogs remain ineligible                                                             |
| Plugin provider integration | PR203 merged0faf19dc; exactff3c88ef all four CI jobs and full local suite pass:2975 pass/0 fail/1 existing skip                                                                                                                                       | External host/provider delivery and both client/native visual acceptance                                                                                                 |
| Agent channels              | Slack is qualified and merged. Teams identity PR205 passed its previous full local suite (3130/0/1); its CI recovery fixture repair6bda01e9 is being qualified. Transport/lifecycle and both client controls are implemented in a separate candidate. | Finish current full/CI; qualify migration, consent, delivery, retention and client controls; implement Teams current-card replies; real tenant/native/visual acceptance. |
| Docs                        | Source, Mermaid and earlier editor fixes on main; current pure matrix108/108 passes                                                                                                                                                                   | D1 native/editor/preview, PDF/Word/import/export and accessible rendering matrix                                                                                         |
| Whole-app UI                | Settings modal/search, assistant panels and narrow settings grid/theme checkpoints on main;15 grid/settings tests and web build pass                                                                                                                  | Full page-by-page desktop/web/mobile layout and interaction review, including narrow/overlay states                                                                      |
| Agents/pages/publication    | Prior runtime isolation, identity, ownership and maintained-page checkpoints on main                                                                                                                                                                  | Governing collaboration/reflection/publication requirement audit and external/runtime acceptance                                                                         |
| Production and cleanup      | Main checkpoints pushed; root user files and related worktrees preserved                                                                                                                                                                              | User deployment confirmation; final cleanup after all relevant work is integrated and preserved                                                                          |

Plugin automated qualification logs:/tmp/orbyn-plugin-ff3c88ef-full-local.log,
/tmp/orbyn-plugin-integrated-types.log and /tmp/orbyn-plugin-integrated-format.log.
CI37295933770 is terminal success. Earlier failed/cancelled runs do not supersede
this source's passing result. Browser Use still reports a saved Block for5174;
Simulator inspection times out -10005. No current visual/native proof is claimed.

All checkpoint notes below are historical evidence for their named sources;
they do not supersede this authoritative table or close the full ADR goal.

# Current plugin integration — 5 October 2026

Main7504be66 is integrated, including the narrow settings grid/theme repair and
stable Agenda resumption fixture. Only historical/current ADR and handoff text
conflicted; latest current state and both evidence histories are preserved.
All application source integrates without conflict. Full combined local and CI
qualification are required before PR203 promotion. Full ADR remains incomplete.

# Current checkpoint and implementation pipeline — 5 October 2026

| Work                        | Confirmed state                                                                                                                                                                                      | Next implementation or acceptance                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT provider connection | Handoff/status fixes on main; selected-provider routing on main                                                                                                                                      | Real web request to same-account desktop authorization and successful Responses completion; truthful plan/usage checks           |
| Scheduled Agenda            | PR199 merged as8dcc4bb1; all four CI jobs pass,2938 tests pass and one existing skip;99 focused local passes                                                                                         | Cross-client/native controls and real-provider acceptance; keep unsupported hard-limit catalogs ineligible                       |
| Plugin inference            | PR203 broker, consent, private receipts and worker implemented; integrated current main; full local run ended2971 pass/1 timing-sensitive fixture fail/1 existing skip; repair qualification follows | Inspect terminal results, promote qualified source, exercise external host and both client controls                              |
| Settings layout             | Late grid override removed; themed inputs/secrets;15 focused passes, backend/web types and web build pass                                                                                            | Browser/native visual acceptance; whole-app responsive layout audit remains open                                                 |
| Slack/Teams channels        | Slack signed-payload/current-card pure boundary committed separately;7 tests pass                                                                                                                    | Session-bound OAuth installation, encrypted credentials, durable outbox, callback/reply transaction, client controls; then Teams |
| Docs parity                 | Several source/editor/Mermaid/math fixes on main                                                                                                                                                     | Requirement-by-requirement D1 editor, export, import and native visual matrix                                                    |
| Agents and maintained pages | Runtime/identity and prior maintained-page checkpoints on main                                                                                                                                       | Complete governing collaboration/reflection/publication requirements and external/runtime acceptance                             |
| Deployment and cleanup      | User deploys main; root dirt and related worktrees preserved                                                                                                                                         | Confirm production recovery; cleanup only after remaining work is integrated and preserved                                       |

The full ADR goal remains active. Browser review again rejected5174 due to saved
Block, without workaround. Native Simulator review returned timeout -10005.
This table records implementation separately from runtime and visual acceptance.
Earlier checkpoint notes below are retained as history.

# Current integration — 5 October 2026

Main62f5e9a0 is integrated into the scheduled Agenda candidate. The only merge
conflicts were historical ADR/handoff notes; both sets are retained below.
No application source conflicted. CI37286333130 previously failed three cases:
legacy internal catalog shape and two cross-runtime fixed-clock fixtures.
Those repairs retain the original assertions, capacities and lease duration.
Backend typecheck passes. Exact merged-head qualification remains required.
Plugin provider candidatePR203 is separate; its own new broker/controls await CI.
Full ADR remains active; preserve native/visual and real-provider acceptance gaps.

# Agenda CI repair and main integration — 5 October 2026

Main `198e93e4` integrated into the Agenda candidate. Documentation overlaps
were resolved by retaining current main's handoff and preserving prior candidate
notes as history; no source conflict or user-file changes remain. CI37280711360
failed with2,913 passes,11 failures andone existing skip. Repairs: fixture owners
and their live recovery leases are cleaned between tests, remote UI harness
recognizes AgendaPrivateSettings, the model catalog retains its existing strict
response shape, and generated MCP catalog exclusions reflect both new private
routes. Original deadlines/capacities/assertions are unchanged. Focused remote UI
and NOWAIT cases13/13 passed; database/full qualification must run again before
promotion. These fixes are not yet qualified for main. Plugin launch-context
candidate c27a4a03 is separate draft PR201; pure10/10 and backend types passed,
HTTP/database and host acceptance remain unverified.

# Current implementation handoff — 5 October 2026

## Scheduled catalog compatibility repair — current candidate

CI37283750938 at86d850b9 ended2,925pass/2fail/1existingTesseractskip.
The earlier fixture cleanup, UI mocks and generated catalog repairs passed;
remaining failures required capabilities in the internal catalog and scheduled
settings contract. Restore sanitized capability metadata internally and require
explicit `include_capabilities=1` on `/models` to expose it. Ordinary requests
retain the original exact response shape for older strict readers. Both Agenda
settings hooks request the metadata; omission cannot enable bounded scheduling.
Four focused client/schema tests and all workspace typechecks pass. Added HTTP
opt-in and malformed query regressions remain to be run in full CI; local test
PostgreSQL is unavailable and unchanged. Main03c605e2 was integrated without
conflicts. This is a draft candidate, not scheduled feature delivery.

## Current main and active candidates — 5 October 2026

Main2f4108d7 includes Docs source-dialog focus PR202 (exact7f60b352,
CI37285248757 all four jobs passed; 2,862 backend pass, zero fail, one existing
Tesseract skip) and separate plugin launch PR201 (exacte7d629b0,
CI37285386062 all four jobs passed; 2,868 backend pass, zero fail, one existing
skip). User deploys main manually. Live browser/native visual acceptance and
external plugin host launch remain open; these CI results do not prove them.

Scheduled Agenda candidate50a92aa2 is in CI37286333130 after repairing the two
capability compatibility failures. Mail, Docker and mobile passed; backend
suite is still live. Do not promote before inspecting the terminal result.

Plugin managed-provider branch07214863 has a transport boundary, owner/provider-
bound default-off CAS consent, persistent receipt tables, retention and privacy
text. Four consent/schema/client tests plus ten transport/operation tests pass;
all workspace typechecks pass. Migration/HTTP tests are added but not run locally
because test PostgreSQL remains unavailable and user-controlled. Atomic daily
reservation, deduplication/unknown-outcome recovery worker, private status/results,
both client permission controls and runtime qualification remain unfinished. No
inference endpoint is mounted and this feature is not merged to main.

Full C1-C6/M1/D1/U1 remains active. Preserve all user/character files and unmerged
work; no cleanup or production deployment. Next: qualify current candidates and
complete the plugin broker and client controls, then continue retained whole-app
UI/Docs/provider acceptance.

## Docs source dialog focus checkpoint

Source validation no longer closes and reopens the desktop/web source preview
dialog. Escape reads current validation state, so invalid edits still block
dismissal; cleanup restores focus only when the dialog unmounts. The captured
dialog is closed even if React has already cleared its ref. Cross-client source
and preview checks31/31 and desktop typecheck passed. This is component/source
evidence, not visual acceptance; full D1/U1 and native/runtime checks remain open.

## Automatic desktop request watcher checkpoint

The desktop checks pending web/mobile ChatGPT requests on a zero-delay first
pulse once its Orbyn session is ready; subsequent polls keep the existing
15-second interval. Manager regressions now exercise the actual automatic
watcher: same-person claim and completion, other-account isolation, no duplicate
sign-in for completed requests, recovery from a transient poll error, and no
poll from an old timer after logout. All14/14 manager tests passed with no skips
(`/tmp/orbyn-chatgpt-web-watcher-tests.log`). These use synthetic OAuth/catalog
fixtures, not live provider authorization or native visual acceptance.

The request still requires the updated desktop app open on the same Orbyn
account. Browser-only authorization is not added. Full ADR remains incomplete.

## ChatGPT handoff feedback checkpoint

The web/mobile Connect button now distinguishes creating a request, waiting for
Orbyn desktop, and a request claimed by desktop. After 30 seconds unclaimed,
feedback says no desktop app has received the request and asks for the updated
app on the same Orbyn account; it does not assert that the device is offline.
The desktop prerequisite is visible before clicking. Shared feedback tests5/5,
remote UI rendered-component tests9/9 and desktop/mobile typechecks passed.
These are source/component checks, not a live web-to-desktop authorization or
visual acceptance. No automatic custom-scheme navigation was reintroduced.

Official plan authorization uses a local callback, unlike website identity
sign-in: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
and https://developers.openai.com/siwc/website. Browser-only plan authorization
is not provided by this checkpoint. Pending/claimed UI makes the actual handoff
state visible rather than implying a browser authorization has already opened.

Agenda CI37280711360 completed with 2,913 passes, 11 failures and one existing
skip. Candidate remains draft; inspect and repair the exact failed cases before
promotion. Its prior live-CI entry below is historical.

## Main checkpoints and remaining work

Main before this checkpoint is `198e93e4` (handoff feedback; PR200 is `9c5bb744`). User deploys main manually with the
normal deploy script; no production recovery or deployment is claimed here.
Earlier entries below are historical and do not describe current qualification.

| Scope                             | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                | Remaining acceptance                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production migration deadlock     | PR198 merged as `f816675b`; exact candidate `81ffb44e`. Existing `ai_jobs` is locked before pending batch SQL; only rolled-back 40P01 transactions retry, with at most three attempts. CI37279096979 completed successfully in all four jobs: 2,856 backend passes, zero failures, one existing Tesseract skip. Worker/prelock ordering and real deadlock/DDL rollback regressions executed.                                    | User's production deploy and recovery confirmation. Full local attempt failed when test PostgreSQL's tmpfs filled and its container exited; this is not a local full-suite pass.                                                                                    |
| Web ChatGPT connection            | PR200 merged as `9c5bb744`; automatic `orbyn://` navigation removed. The signed-in desktop runtime polls pending connection requests and opens official ChatGPT authorization. User explicitly waived test/CI waiting for this small adjustment.                                                                                                                                                                                | Actual web-to-desktop connection acceptance. Desktop must be running and signed into the same account; this is not browser-only OAuth.                                                                                                                              |
| Selected-provider feature routing | PR196 merged as `e0a432a5`; exact candidate `47541c63` passed 2,842/2,842 fresh local tests. CI37273639006 passed all four jobs, with 2,841 backend passes and one existing Tesseract skip. Docs/Study/project/capture/recording/interactive Agenda and maintained pages are routed through selected-provider contexts.                                                                                                         | Successful real Responses inference and whole-account usage/plan evidence; prior actual inference was refused for sharing quota exhaustion.                                                                                                                         |
| Scheduled private Agenda          | Draft PR199, exact `86d850b9`, includes source fences, durable scheduled runs, transactional Study link reads and NOWAIT target-page locking. CI37283750938 is live after repairs to fixture cleanup, model response compatibility, UI mocks and the generated catalog; mail, Docker and mobile jobs passed, backend tests remain running. Current pure page-lock/client/status checks passed 10/10 and workspace types passed. | Current concurrent-page-edit regression/full suite, complete source-writer matrix, native controls and runtime acceptance. Official SIWC does not expose the required hard inference limit capability, so budgeted scheduling cannot be enabled for those accounts. |
| Plugin boundary                   | Current source implements independent recipient-bound OAuth, live connector authority, protected-resource discovery, bounded UI/protocol adapters and private import-job cursors. See refreshed P1 evidence in the implementation review.                                                                                                                                                                                       | Managed/BYO provider execution, external host/tenant acceptance and deployment configuration. Launch contract is in draft PR201 (`c27a4a03`); CI37283493302 remains live. Plan tokens remain excluded.                                                              |
| Docs and whole-app UI             | Retain the complete D1/U1 contract; source and renderer checkpoints do not prove every viewport or interaction. Simulator is running but both name and bundle-ID inspection returned native tool timeout -10005.                                                                                                                                                                                                                | Full desktop/web/iOS/Android visual and behavior matrix, including narrow layouts, keyboard, overlays, diagrams, editing and exports.                                                                                                                               |

Full C1–C6/M1/D1/U1 remains active and incomplete. Next implementation priorities:
qualify scheduled Agenda without weakening tests; complete real provider execution
and usage acceptance; finish separate plugin managed/BYO execution and host
contracts; then close Docs and whole-app cross-client acceptance gaps.

Preserve root user files, characters and all unmerged candidates. No Docker
restart, database tuning, cleanup, production deployment or release is authorized
by this checkpoint. Docker recovery remains under the user's control. Do not
bypass the saved local Browser Use denial through another browser, port or CDP.

## Historical checkpoint — reflection integration

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

## 2026-10-04 — signed ChatGPT inference broker foundation (not delivered routing)

Execution work is isolated in the attached `devday-model-catalog/Orbyn` worktree
on `codex/chatgpt-execution`, based on current source checkpoint0de9ca3d. Its
workspace package links point to its own builds; preserved preview files are
untouched and the former dependency symlink remains backed up under/tmp.

Migration226 introduces bounded per-job request storage with encrypted prompts
and results, a two-minute expiry and one active request per job. The internal
runner queue captures the current owned account, model, enrollment/lease epochs,
input hash and nonce. No HTTP endpoint accepts arbitrary prompt input. A claim
requires the exact enrolled Orbyn session and current lease/catalog/account.
Publication verifies an Ed25519 signature covering the exact request identity,
nonce, epochs, model and completed/failed result. Replays, forged results, changed
leases, another owner and inactive/unverified-source jobs are rejected. Input is
cleared on completion/cancellation. Runner result reads recheck current job/source
access. These are storage/contract gates; no device polling endpoint, processing
loop, composer integration, fallback choice or live provider result is delivered.

Backend types pass in `/tmp/orbyn-inference-broker-final-types.log`. Broker storage
checks3/3 pass with no skips in `/tmp/orbyn-inference-broker-final-three-tests.log`.
This diagnostic run uses `PGOPTIONS=-c jit=off`; it does not modify PostgreSQL or
production configuration. No OpenAI request is made. Fixture fixes preserve real
JSON encoding, mandatory chat IDs and allowed inactive job states.

Current full checkpoint qualification0de9ca3d actually ended code1, signal:null:
2670/2677 pass, seven failures, no skips. The attempted cancellation happened
after its handle had already disappeared (ESRCH); the cancellation record was
corrected and the exit JSON is authoritative. Logs confirm a PostgreSQL backend
was SIGKILLed while evaluating the replay permission query, with container OOM
state and postmaster recovery. This affected both full and broker test sessions.
JIT-off broker passing is not proof the replay OOM is fixed. Investigate query
planning/memory and complete fresh full/CI qualification; do not restart Docker
Desktop or erase test/primary data as a workaround. Source permission predicates
must stay enforced. Goal remains full C1-C6/M1/D1/U1, with actual ChatGPT-primary
execution and explicit Orbyn-default fallback highest priority.

### Direct Connect interaction — 4 October 2026

User confirmed that Connect to ChatGPT must immediately start authorization,
without opening ChatGPT sign-in settings first. Desktop dispatches `connect`;
web/mobile create an opaque connect request and launch the credential-owning
Orbyn runtime, which claims it and starts OpenAI authorization directly. MCP
configuration remains separate. The local runtime dependency is still present;
this is not standalone hosted-browser OAuth.

Direct entrypoint and manager tests pass13/13 with no skips in
`/tmp/orbyn-direct-connect-recheck.log`. Backend typecheck passes in
`/tmp/orbyn-routing-backend-recheck.log` after restoring fresh default-provider
resolution in the explicit admission-failure fallback. Uncommitted execution,
provider-choice and UI work still needs authorization-fence, integration and
full qualification before promotion to main. No live OpenAI consent or inference
was performed in this check.

### ChatGPT dispatch and provider-choice candidate — 4 October 2026

Active branch: `codex/chatgpt-execution`. Private device polling claims encrypted
runner assignments, checks owner/session/lease/model/hash, invokes the public
Responses transport, signs completed or classified failed results, and publishes
them to the runner. Composer JSON steps use personal provider routing. No renderer
inference IPC or arbitrary-prompt HTTP enqueue endpoint is introduced.

Migration227 stores explicit ChatGPT-primary/default and fallback choices with
CAS. Migration228 captures provider consent revision on each assignment and
cancels legacy active assignments without that evidence. Enqueue, claim, result
publication and read reject provider changes. Web/desktop/mobile controls hide
another account's state, abort stale requests and offer reload after conflict.
MCP and plugin grants remain separate.

Actual marked-database routing tests pass6/6: encrypted once-only assignment,
signed completion, forged/lease/source/session rejection, revision fencing,
runner consumption of the assigned model, and a local default-provider stand-in
called only with explicit fallback and a confirmed admission rejection. Stream
and unknown failures do not retry. Evidence:
`/tmp/orbyn-chatgpt-routing-admission-tests.log`. Endpoint/security, manager,
private processor, routing contract and catalog checks pass27/27 in
`/tmp/orbyn-routing-security-focused.log`. Model UI/neatness checks pass19/19 in
`/tmp/orbyn-routing-ui-recheck.log`; the model-only fixture mocks the separate
provider-choice child and does not prove that child's rendered appearance.

Workspace types and production build pass in
`/tmp/orbyn-routing-complete-types.log` and
`/tmp/orbyn-routing-production-build.log`. These checks do not qualify main:
full-suite PostgreSQL OOM investigation, actual OpenAI consent/inference,
cross-client provider-control visual review, durable user-visible inference
usage/provenance, and broader ADR acceptance remain open. The running preview
still serves the earlier worktree; do not claim it shows this candidate.

Final combined ChatGPT-focused run passes249/249, no skips, exit0, including
new endpoint security, all `chatgpt*.test.ts`, provider choice, route inventory,
catalog and neatness checks. Log:
`/tmp/orbyn-chatgpt-checkpoint-all-focused.log`. PostgreSQL JIT is disabled only
for this diagnostic test process (`PGOPTIONS=-c jit=off`); it is not production
configuration and does not resolve the earlier full-suite OOM qualification.
Final workspace typecheck passes in `/tmp/orbyn-routing-checkpoint-types.log`.

### Replay qualification follow-up — 4 October 2026

Known literal source families now emit their existing predicate directly instead
of the complete dynamic CASE. Dynamic source-kind columns keep every allowlisted
family and the fail-closed default. The source-expression regression compares
each emitted literal predicate with its exact dynamic branch; replay authority
checks pass24/24 using normal PostgreSQL settings, without `PGOPTIONS` overrides.
Evidence: `/tmp/orbyn-replay-static-family-tests.log`.

Read-only EXPLAIN comparison (`/tmp/orbyn-replay-family-plans.json`) shows reduced
SQL bytes for task/doc/record/exam but identical estimated costs and plan nodes in
the synthetic comparison. This is not proof of the earlier OOM cause or a JIT
fix. Full tests are currently running normally in
`/tmp/orbyn-fe0ef346-replayfix-full-tests.log`, session79424; do not restart them
on an observation timeout. Types pass. The standard format command warns only
about the preserved untracked `desktop/src/settings-connection-preview.tsx`;
that file was not edited. Separate tracked-source formatting is checked without
adding checker exceptions. No main promotion is qualified yet.

The normal-settings full run completed with exit0:2701/2701 pass, no skips, in
`/tmp/orbyn-fe0ef346-replayfix-full-tests.log` (session79424 terminal). This covers
the dispatch/provider-choice checkpoint and replay SQL change; do not attribute
it to later capability or legal changes. No PostgreSQL restart or JIT override
was used. Tracked-source format passes in
`/tmp/orbyn-replayfix-tracked-format.log`; standard formatting still warns on the
preserved untracked preview file.

The owned API8027, web5174 and Metro8083 previews were refreshed to the execution
worktree after the marked preview database was migrated. The running API health
is good. Native Expo was reloaded through its developer menu; the current
Provider/default/Connect/Refresh/Usage controls were inspected and captured at
`evidence/chatgpt-provider-routing/ios-settings-provider.png`. Controls fit with
no overlap in this dark-mode empty-account view. This is not verification of
connected accounts, large catalogs, web layout or actual OpenAI consent. The
stale development warning was dismissed only after capturing its presence.

### Rolling-upgrade and privacy follow-up — 4 October 2026

Migration229 adds signed `plan_inference_v1` catalog capability. Omission keeps
legacy canonical signatures and the existing strict catalog response shape;
catalog-only devices remain readable. Primary-provider selection and private
dispatch require an advertised execution processor. Missing/old runtimes cannot
receive input. New catalog metadata advertises capability only when the private
adapter and claim/result client methods exist.

Capability, broker, lease/proof, manager and private runtime checks pass43/43
with normal PostgreSQL settings in `/tmp/orbyn-chatgpt-capability-tests.log`.
Privacy text now describes device/OpenAI routing, encrypted temporary envelopes,
explicit fallback and the limits of revoking already-sent content. Shipped legal
version becomes2026-10-04 using the existing default-text/version workflow.
Legal/provider-route/broker checks pass14/14 in
`/tmp/orbyn-chatgpt-capability-legal-tests.log`. These follow-ups require their
own fresh full/CI qualification;2701 passing is the preceding checkpoint's
evidence. Usage/provenance display, connected-state visual coverage, real-account
acceptance and the remaining full ADR contract are still open.

### Completed ChatGPT usage implementation — 4 October 2026

Migration230 adds owner-only completed-call measurements without conversation
content, identity tokens or provider credentials. Only the transaction accepting
a verified signed completion writes them; replay, failure and rejected receipts
do not. Analytics opt-out prevents recording. Measurements last30 days, survive
temporary request cleanup and cascade on account deletion. The first-party usage
route is excluded from agent/plugin access and returns no-store metadata, exact
decimal totals and at most ten recent records. Missing usage remains null, not
an estimate. It does not measure account-wide allowance, other apps or direct
plan-verification requests that were not accepted through the assistant broker.

Web/desktop/mobile load Usage in Orbyn only on demand. Ownership/token changes
hide prior data before effects and abort old requests. Unit checks exercise both
surfaces, delayed responses, exact large totals and distinct quota wording.
The native panel was opened against the refreshed API and displayed the actual
empty test-account result. Empty-state zeros and irrelevant fallback help were
then removed; the latest compact view still needs its screenshot after agreeing
to the refreshed legal version.

Broker/UI checks17/17 pass in `/tmp/orbyn-chatgpt-usage-focused.log`.
Route/catalog/inventory/neatness checks23/23 pass in
`/tmp/orbyn-usage-contract-routes.log`. Usage/recovery/privacy/sweeper checks22/22
pass in `/tmp/orbyn-usage-recovery-privacy-tests.log`. Final focused ledger/client/
UI checks15/15 pass in `/tmp/orbyn-usage-ledger-final-tests.log`, including exact
database aggregation above Number precision, retention-window exclusion, null
measurement constraints, stale sessions and fresh-client requests. These scoped
counts overlap; do not sum them as a full-suite count. Workspace types and build
pass in `/tmp/orbyn-usage-final-types.log` and
`/tmp/orbyn-usage-production-build.log`; fresh final-source checks remain needed
after the last count conversion and document updates.

An official Electron44.3.0 runtime was downloaded/verified into a task-owned
temporary directory for independent native desktop QA. An isolated profile loads
the built desktop app from its first-party file path and points at test API8027;
it does not load or capture the blocked web URL or change the OS URI association.
Its login is filled from the private disposable-account file, never printed or
stored in repository text. Evidence: `evidence/chatgpt-provider-routing/desktop-qa-signin.png`.
The desktop Sign in action accepts Terms/Privacy and has a pending action-time
Computer Use confirmation. iOS now shows the2026-10-04 agreement gate too. Do not
accept either agreement automatically or treat elapsed time as authorization.

Next routing gate: provider choice is captured in the resolver closure and on
private assignments, but not yet at job enqueue in durable job state. A runner
restart can therefore read a changed primary choice and retarget remaining work;
queued-before-selection changes also need durable fencing. Persist enqueue-time
choice and test recovery before production promotion. Also verify private request
recovery across restart/expiry so accepted or unknown calls cannot be duplicated,
and persist actual fallback/provider provenance for the final result. Fresh
full/CI, real-account acceptance, connected large-catalog visual checks and all
remaining governing ADR gates stay open. The preceding2701 passing result belongs
to01690700 and does not qualify these later changes.

Usage snapshot follow-up: totals and recent records are read by one SQL statement
so concurrent receipts cannot produce contradictory counts/history. The schema
rejects history larger than the completion count. Fallback controls now update
the saved device instead of silently using a different inspected device; controls
identify that distinction and reject retained actions after account replacement.
These two-surface action tests pass8/8 in
`/tmp/orbyn-provider-usage-action-fences.log`.

The final combined normal-settings focused run passes273/273, no skips, exit0,
in `/tmp/orbyn-chatgpt-usage-all-focused.log`. This includes all ChatGPT suites,
provider choice, usage client/UI, legal, sweeper, route inventory, catalog and
neatness. Types and build pass in `/tmp/orbyn-usage-provider-fence-types.log` and
`/tmp/orbyn-usage-checkpoint-build.log`. No full-suite/CI result for this latest
source is claimed. Main stays unchanged until the durable recovery gaps above
are fixed and acceptance is qualified. Native desktop QA process9478 is still
live at the pending login; refreshing/rebuilding its file bundle must keep its
test API8027 configuration before the next visual check.

### Durable provider-choice fencing — 4 October 2026

Migration231 captures the current personal provider choice on every ai_jobs
insert, covering interactive and automation producers. It ignores a supplied
snapshot and rejects later edits to the captured value. Existing rows with no
configured personal choice are backfilled with the known legacy default;
uncertain beta rows remain fail-closed instead of inventing original consent.
Resolver recovery and private queue/claim/publication/read compare this immutable
snapshot with current settings. Managed native/JSON dispatch and plain
completions also recheck authority before any network/device transport call.
Explicit fallback keeps that guard, including after its notice callback.

Snapshot/broker/routing tests13/13 pass in
`/tmp/orbyn-provider-snapshot-focused.log`. Existing assistant runs, protocol and
provider-limit checks61/61 pass in
`/tmp/orbyn-provider-snapshot-protocol-runs.log`. Dispatch guard/limit checks21/21
pass in `/tmp/orbyn-provider-authority-protocol-tests.log`, with zero network or
device calls after rejection. Final snapshot/broker/protocol checks30/30 pass
in `/tmp/orbyn-provider-choice-durable-tests.log`. Types pass in
`/tmp/orbyn-provider-choice-durable-types.log`. Counts overlap and are not full
qualification.

The enqueue/restart retarget gap is addressed by this source. Remaining private
transport recovery needs stable per-call operation IDs and consumed/checkpoint
evidence. The current unique-active-per-job constraint also conflicts with the
lead's real parallel specialist execution (`Promise.all`); it must become an
operation-level constraint, with separate queued work for each specialist.
Do not use payload equality alone as operation identity or replay a charge after
unknown completion/expired envelope cleanup. Actual provider/fallback provenance,
current full/CI, real-account acceptance and connected-layout checks remain open.

### Private operation recovery and parallel dispatch — 4 October 2026

Migration232 replaces per-job active uniqueness with durable per-operation
identity. Each private loop persists a UUID before dispatch, freezes its exact
wire messages, and saves received/parsed replies and its finished result.
Recovery retains the original budget reservation and does not count the pending
lead step again. Finished context hashes match the bounded checkpoint projection;
a new person answer invalidates the finished-loop cache rather than repeating the
same question forever. Separate specialists share an adapter but have distinct
operation IDs and assignments.

The broker serializes creation per operation and returns the original assignment
on replay. Accepted output can recover with the device offline. Expired undisclosed
queued work becomes a known admission failure; claimed/unknown work cannot silently
switch provider. Fallback is marked before its managed call, and a missing result
holds the original operation instead of repeating a possible charge. Received
fallback output is encrypted for recovery. Active request envelopes survive their
dispatch deadline for saved-run recovery; expired inactive envelopes are swept.
Content-free operation tombstones survive envelope deletion and follow job
retention. Existing beta private jobs without operation evidence are held, not
silently retried. Privacy text reflects this retention.

Actual marked-database and child-process tests include SIGKILL after a signed
reply is accepted but before the loop saves it. Recovery, with the device offline,
uses one physical request and one usage record. The same suite exercises parallel
loops reaching separate signed assignments and independently replaying their saved
results. Process/broker checks14/14 pass in
`/tmp/orbyn-private-process-recovery-tests.log`. Loop reservation/cache/context
checks5/5 pass in `/tmp/orbyn-private-budget-tests.log`.

The initial broader run failed74/75: its sixty-poll presence check took over11s,
crossing the real10s grace interval, while asserting the row never changed. No
test assertion or production interval was altered. An isolated normal-settings
rerun passed (684ms for sixty polls;62ms under the runner lock) in
`/tmp/orbyn-private-presence-isolated.log`. The subsequent assistant/broker/loop
rerun passed59/59 in `/tmp/orbyn-private-parallel-final-tests.log`. Final combined
assistant/process recovery/broker/loop/legal/sweeper checks pass83/83, no skips,
in `/tmp/orbyn-private-operation-checkpoint-tests.log`. Final workspace types pass
in `/tmp/orbyn-private-operation-checkpoint-types.log`; production build passes
in `/tmp/orbyn-private-recovery-build.log`. This is focused evidence, not a fresh
full-suite/CI result for this source.

Remaining M1 release gates include actual provider/fallback provenance in the
user-visible result, fresh current full/CI, real-account acceptance and connected
large-catalog visual checks. Native desktop sign-in and the refreshed iOS agreement
remain pending Computer Use confirmations. Full governing ADR scope remains active.

### Provider receipt labels and atomic fallback recovery — 4 October 2026

Both assistant result views now display provider/model receipts from the existing
trace contract. Signed ChatGPT completion records its label in the same transaction
as accepted output and usage. Managed fallback completion records its label in the
same transaction as the encrypted recoverable reply; a crash cannot leave a cached
completed fallback represented only as started. Managed protocol completion also
records the actual model. Duplicate receipt labels are suppressed while distinct
models remain visible. These markers are display metadata, not authorization.

Focused provenance, broker/process recovery and assistant-run checks pass56/56,
no skips, in `/tmp/orbyn-provider-provenance-atomic-tests.log`. Workspace types pass
in `/tmp/orbyn-provider-provenance-atomic-types.log`. A subsequent small change
preserves distinct default models during trace deduplication. Fresh full-source
qualification is running in `/tmp/orbyn-provider-provenance-full-tests.log`;
production build is running in `/tmp/orbyn-provider-provenance-build.log`.
Neither running process is a passing result. Current full/CI, real-account and
connected native/web visual acceptance remain open. Main promotion is not claimed.

### Notice-query qualification repair and connected desktop evidence — 4 October 2026

The latest local full run terminated2678/2687 pass,9fail in
`/tmp/orbyn-provider-provenance-full-tests.log`. Notice-list failures coincided
with database disconnect/recovery and subsequent setup failures. Do not classify
this as a passing local gate or assert a proven PostgreSQL kill cause. GitHub
CI37202016175 passed all backend/web, mobile bundles, Docker image/live smoke and
mail jobs for8bd2e48d. The preceding CI stopped at one indentation-only test
format issue, corrected by8bd2e48d.

The notification list now pages ordinary owner/item-visible notices separately
from assistant chat, proposal and reminder-nudge source checks. Only families
present in a page expand their guard SQL. Hidden source notices do not consume
the100 visible-result limit. Timestamp/ID cursors preserve database microsecond
precision and internal cursor fields never enter client responses. Malformed
chat references and absent sources fail closed. Final planner/deadline/privacy/
pagination checks pass123/123, no skips, in
`/tmp/orbyn-notification-final-focused-tests.log`; workspace types pass in
`/tmp/orbyn-notification-bounds-final-types.log`. No test/JIT/database setting was
weakened. This repair still requires a fresh complete local and CI run.

Native desktop Settings was inspected against the marked local preview database.
Connect opened OpenAI's real account chooser. The UI subsequently displayed a
connected account, granted plan permission and a live selected model. Screenshot:
`docs/reviews/evidence/chatgpt-provider-routing/desktop-connected-models.png`.
Control links now share button styling without browser-default blue/underline.
The native tool stopped responding during plan verification; completed live
inference, refresh/revocation, actual assistant receipts/usage and mobile/web
connected acceptance remain unproven. No production/main promotion is claimed.

### Personal chat admission and visible recovery errors — 5 October 2026

The notice-query checkpointcbbea304 passed2731/2731 full local checks with no
skips in `/tmp/orbyn-notification-guard-full-tests.log`. CI37203144839 passed all
backend/web, mobile, Docker/live smoke and mail jobs. Production build passed
in `/tmp/orbyn-notification-guard-production-build.log`. This qualifies that
source; subsequent changes require fresh qualification.

Live preview inspection exposed a separate admission defect: chat submission
and capabilities still required managed workspace configuration before the
personal resolver could run. Both now consult the owner's selected provider.
A selected ChatGPT binding can enqueue without a managed provider. Missing or
revoked bindings cannot admit through default billing without explicit fallback.
Dispatch still performs current identity/catalog/lease/model/source checks and
captured-choice fencing. No readiness/entitlement is invented at admission.

An HTTP regression proves202 enqueue and captured personal choice with no managed
provider, plus401/403/422/429 shields and idempotent replay. Broker, admission,
plan transport, desktop bridge/store checks pass50/50, no skips, in
`/tmp/orbyn-chatgpt-admission-recovery-final-tests.log`, using the separately marked
`orbyn_admission_cbbea304_test` database. Workspace types pass in
`/tmp/orbyn-chatgpt-admission-action-types.log`.

Fixed safe plan recovery messages now cross desktop IPC; arbitrary provider text,
mutated Error.message and request IDs remain excluded. Routine metadata reload
preserves an action failure for the same owner instead of immediately hiding it.
A new successful action or owner/session change clears it. Actual plan permission
and model discovery remain distinct from a completed verification/inference.

Open routing work includes safe Background deferral when its private runtime is
absent without fallback, actual completed assistant inference/receipts/usage,
non-chat first-party AI features that still use managed adapters, maintained-page
private execution and the remaining full ADR/platform acceptance. Plugin/MCP
calls retain their separate provider and grant boundaries. Main is unchanged.

### Live stream header, checked-out connections and replay planning — 5 October 2026

CI37204783047 passed all four jobs on195f2d22. Its local full run ended2706/2717
pass,11fail in `/tmp/orbyn-chatgpt-admission-current-full-tests.log`, including
recovery57P03 and timing failures. This is not a passing local gate. A focused
replay run reproduced a proposal-family connection loss; its19/25 result includes
recovery/setup failures. No assertion, deadline, JIT or database setting was waived.

The replay query now binds reference IDs as a text array instead of a JSON
recordset. All ownership, grant, membership and source predicates remain intact
in the same query. A synthetic normal-settings EXPLAIN changed reference rows100
to1 and estimated total cost70785.15 to732.43. Both synthetic plans had JIT disabled
by their own cost estimates, not by a configuration change; this is not proof of
a specific PostgreSQL kill cause. Evidence: `/tmp/orbyn-replay-cardinality-plans.json`.
The reproduced proposal read lost its connection after6086ms before the change;
three subsequent reads completed in75,168,72ms. Replay tests24/24 pass in
`/tmp/orbyn-replay-array-cardinality-tests.log`. Combined pool/replay/rules/runner/
assistant/process-recovery checks102/102 pass with no skips in
`/tmp/orbyn-resilience-array-final-tests.log`.

Every primary/replica pool connection now observes transport errors even while
checked out between async transaction queries. Rollback failure cannot replace
the original error; transactions are never retried or reported successful by this
handler. A marked-database test terminates only its own tagged backend, proves one
failed attempt and a healthy later pool query. The preview API remained alive
through a subsequent database recovery.

Live OpenAI diagnostics recorded an actual public Responses request with
stream:true/store:false, HTTP200, a body and no Content-Type header. The client
now allows an absent header and still requires bounded valid SSE plus
response.completed. Declared JSON/HTML and incomplete/malformed streams do not
become successful inference or usage. The live request then correctly reported
subscription-sharing usage exhaustion. It did not complete inference, so no
successful plan-use or remaining-allowance claim is made. Further live inference
checks stopped; the temporary startup verification hook was removed.

Runtime snapshots retain the fixed safe quota message without raw provider
content. Plan/model runtime/manager/bridge/store checks56/56 pass, no skips, in
`/tmp/orbyn-plan-media-runtime-final-tests.log`. Workspace types pass in
`/tmp/orbyn-stream-resilience-final-types.log`. Fresh frozen full/CI qualification,
actual completed inference after availability returns, remaining cross-client
acceptance and full C1-C6/M1/D1/U1 remain open. No main promotion is claimed.

### Main checkpoint delivered — 5 October 2026

PR197 merged as82576dfa after2592/2592 full local tests, workspace types,
production build and all four CI37230581000 jobs passed. Root main was safely
fast-forwarded with mobile/app.json and all user untracked files preserved.
The broader codex/chatgpt-execution branch merged origin/main without conflict;
only the scoped qualification document was new because the code fixes already
matched. Full C1-C6/M1/D1/U1 remains active. Next: Background/private-device
availability deferral, all first-party AI feature routing and remaining pages,
Docs, whole-app layouts and external host/platform acceptance. No more live
plan retries while the connected provider reports usage exhaustion. Cleanup
remains at the end; no production deployment was performed.

### Private automation queue admission — 5 October 2026 (candidate)

Background and Overnight jobs whose captured choice requires ChatGPT without
managed fallback now remain queued while the chosen device has no live matching
session/lease, fresh catalog or signed inference capability. This admission guard
runs before claiming; it does not disclose prompts or reserve a running slot.
Interactive requests retain their immediate failure behavior. Current provider
choice changes, legacy private-run holds, cancellation and disabled owners can
still be claimed for execution-time settlement. Closed unreviewed night work can
also be settled; reviewed work retains its normal provider requirement.

An accepted signed completion or stored fallback reply remains recoverable with
the device offline. The worker still rechecks current source/choice authority
before using it. Tests perform actual broker signing/publication before checking
this recovery path. Queue/runner lifecycle checks14/14 pass, no skips, in
`/tmp/orbyn-private-queue-lifecycle-tests.log`; the preceding broker/run regression
checks69/69 pass in `/tmp/orbyn-private-queue-broker-regression.log`. Workspace
types pass in `/tmp/orbyn-private-queue-types.log`. Counts overlap and do not
replace fresh combined qualification.

This is pre-claim admission, not complete offline deferral. A device/lease can
still disappear after claim and before dispatch; that known admission failure
needs durable requeue handling without repeating unknown or already disclosed
operations. No complete Background deferral or main promotion is claimed.
Remaining first-party feature routing, A5, Docs, UI/platform and plugin/host
acceptance retain the full C1-C6/M1/D1/U1 scope.

### Known post-claim private admission failure — 5 October 2026 (candidate)

An unattended run now distinguishes a rolled-back503 queue admission failure
from an unknown/disclosed model completion. Without authorized managed fallback,
that failure saves the current loop, operation ID, captured model, wire input and
budget reservation, then requeues the same leased job. Queued wait is excluded
from active elapsed time and does not consume a crash-resume attempt. Linked
working tasks return to queued atomically under their owning assistant grant.

The transition locks the live owner's job and rechecks captured consent/source
visibility. Any unfinished private assignment or fallback blocks safe requeue;
unknown charges are not repeated. Private job-live checks hold a share lock so
queued/cancelled state cannot race prompt admission/publication. Cancellation,
lease ownership and current choice remain fenced. Fixed private-provider recovery
messages can appear in run failures without reflecting upstream content.

Actual runner tests prove lease loss before dispatch parks the job with its
operation/model/reservation intact and zero inference envelopes. Broker/run/error
checks64/64 pass, no skips, in `/tmp/orbyn-private-deferral-final-tests.log`;
Night/queue checks20/20 pass in `/tmp/orbyn-private-deferral-night-regression.log`.
A final safe-message check passes in `/tmp/orbyn-private-provider-error-final.log`.
Workspace types pass in `/tmp/orbyn-private-deferral-final-types.log`.

The earlier898b full run ended2740/2745 pass,5fail, including a historical Night
read connection loss/recovery and a deadline timing failure. CI37234445505 passed
all jobs on that earlier head. These are not latest-source qualification. Night
leftover source checks now bind paired kind/UUID arrays instead of a100-row JSON
recordset estimate; all visibility predicates and redacted labels remain intact.
The previously failing historical read passes in the focused Night suite. No
assertion, timer, database or JIT setting was waived. Fresh frozen full/CI and
remaining C1-C6/M1/D1/U1 acceptance remain required before main promotion.

### Deferral state-lock verification — 5 October 2026

A concurrent dispatch blocked on the job's share lock now rejects after another
transaction queues that job; it creates no inference envelope. The queue/broker/
runner concurrency suite passes33/33, no skips, in
`/tmp/orbyn-private-deferral-concurrency-tests.log`.

The42c70383 local full run ended2747/2748 pass,1fail. The remaining failure was a
source-contract assertion requiring resolveUserAi's call and arguments to occupy
one line after Prettier wrapped the new argument. Its updated whitespace-tolerant
pattern still requires that exact resolver and owner/job arguments; no behavior,
authority assertion or deadline was waived. Routing/error checks pass in
`/tmp/orbyn-private-routing-contract-final.log`. Fresh full/CI qualification on
this verification head remains required. Main82576dfa and the broader full ADR
scope remain unchanged.

### Deferral verification updates — 5 October 2026

The queue/broker/runner concurrency suite passes33/33, no skips, including an
actual blocked dispatch rejecting queued state with zero assignments. The
routing-contract check now accepts whitespace formatting while still requiring
resolveUserAi with the owner/job arguments; routing/error checks pass. The
preceding42c70383 full local result remains2747/2748 with that formatting assertion
failure, not a passing qualification. Fresh full/CI must qualify this verification
head before promotion. Main82576dfa and full ADR scope remain unchanged.

## Page budget checkpoint — 5 October 2026

Per-page schedules now expose 1,000–20,000 estimated tokens per update in both
clients. Migration 233 defaults existing bindings to 20,000. Queueing captures
the binding budget on the run; editing cancels outstanding work without changing
the old run's budget. Updates from older clients that omit the field preserve
the saved budget. Pause/resume sends the selected allowance. Shared Overnight
limits remain in force.

Focused budget/binding/run/consumer/route/store checks pass 73/73 with no skips
and all workspace typechecks pass. Native desktop build passes; the actual
page-update dialog was inspected and its invalid 999 / valid 5000 enable state
verified without submitting. Bare frequency buttons were changed to the existing
secondary controls and section paragraph margins corrected. Screenshot:
`evidence/page-budget/native-dialog.png`. Preview API has not yet been aligned
with migration 233; native save, narrow layout and mobile acceptance remain open.
This is a candidate checkpoint, not a main merge or completion of C5/U1. Full
exact-commit qualification and all remaining ADR requirements still apply.

## Exact-commit qualification follow-up — 5 October 2026

The full local suite on e8c10979 completed with 2,774 passes, one failure and
no skips/cancellations. The failure was the newly introduced 20px Docs library
heading, outside the existing six-size type scale. It is corrected to 18px;
the unchanged neatness suite passes 10/10 without skips. All workspace types
and production build passed on e8c10979. CI run 37255077796 is still pending
at this checkpoint, so no green full qualification or main promotion is claimed.
Logs: `/tmp/orbyn-e8c10979-full-tests.log`,
`/tmp/orbyn-doc-heading-scale-tests.log`. Requalify the corrected commit.

## Usage cutoff precision correction — 5 October 2026

Frozen e1866399 full local qualification passed 2,775/2,775 with no skips or
failures. CI 37256031469 failed one usage aggregation assertion (11 rather
than 12), while mail/mobile/docker succeeded. Investigation identified a real
query boundary defect: node-postgres Date conversion loses PostgreSQL
microseconds before the upper/lower bounds are sent back to SQL. The cutoff
query now retains database text timestamps for filtering, preserving full
precision; public timestamps remain ISO dates. A deterministic unit test
requires both exact bounds and exercises the real usage reader with a mocked
checked-out client. Broker plus precision checks pass 16/16, no skips, in
/tmp/orbyn-e186-usage-precision-focused.log. Requalify the corrected commit
before main promotion. The full ADR remains incomplete; no deployment/cleanup.

## Recording provider checkpoint — 5 October 2026 candidate

Text recording summaries now capture explicit provider choice, source page
revision and live recording identity through a durable feature job. Both clients
allow a supplied transcript and show actual completed-provider metadata. Signed
private output cannot be accepted after file removal; page/exclusion/team checks
and explicit fallback remain enforced. Existing audio transcription remains
managed and cannot run while ChatGPT is selected. Target generation guards
prevent late summary/task UI responses from landing on another recording.

Focused checks pass 21/21, neatness 10/10, all workspace typechecks and native
desktop build pass. Recording UI screenshots/native mobile acceptance, actual
completed OpenAI inference and full exact-commit qualification remain open.
The separate corrected e1866399 checkpoint is under full qualification in
`/tmp/orbyn-e1866399-full-tests.log`; its live session is 18479 and types/build
session 33414. CI run 37256031469 targets that exact commit. Earlier e8c10979
CI was cancelled by the newer push; it was not a completed green run. Main
remains 82576dfa. All C1–C6/M1/D1/U1 scope and eventual cleanup remain active.

## Private page transport in progress — 5 October 2026

Uncommitted private maintained-page transport uses a version-3 companion job
linked to its page parent (migration 234), checks the parent lease and captured
provider/model/source authority at broker boundaries, and settles companion
state with its parent. Overnight admission excludes that run's own companion.
This is incomplete: direct signed private-page execution, safe undisclosed
reservation rollback/deferral, recovery, and native/mobile acceptance still
require implementation and tests. Do not merge this work as complete.

Output limits now propagate through the private transport, hashed assignment,
public Responses request, and explicit managed fallback. Migration 235 permits
plan_inference_limits_v1; bounded queue/claim requires that current capability,
while older devices remain eligible for ordinary calls. Unit checks32/32 and
broker/page-consumer checks40/40 passed without skips. The new broker regression
covers pre-dispatch rejection, unchanged queued state on capability downgrade,
limit immutability on replay, and signed completion after capability restoration.
Logs: /tmp/orbyn-private-output-unit-final.log and
/tmp/orbyn-page-private-capability-final.log. These existing page-consumer tests
do not prove direct private-page execution. Latest workspace types passed with terminal exit0 in
/tmp/orbyn-page-private-current-types.log (session19260).

Separate frozen candidate82f5f20e corrects usage cutoff microsecond truncation
following e1866399 local2775/2775 and CI37256031469's usage count failure.
Corrected broker/precision16/16 passes. Full session82103/log
/tmp/orbyn-82f5f20e-full-tests.log and CI37257405383 are live. All workspace types passed with terminal exit0 (session28996). Main82576dfa remains unchanged;
no deployment, cleanup, or full ADR completion is claimed.

## Direct private page execution checkpoint — 5 October 2026

Private maintained-page execution now has direct signed broker coverage. The
consumer sends only selected blocks, carries an output-token limit and applies
one bounded replacement under the parent lease. A genuine unique companion job
tracks that lease and runtime lane; source, provider-choice and preference
revision changes reject late output without recording accepted usage. Parent
cancellation invalidates the transport and preserves the page.

The first direct test exposed a lock inversion: device claim/finish locked the
physical envelope before parent/source authority, while worker polling used the
reverse order. Claim and signed acceptance now check parent/job authority before
locking the envelope. No deadlock retry or relaxed timeout was added. Recovery
also exposed an invalid transport cancellation state; page terminal transitions
use ai_jobs' existing failed state. Migration236 replaces the trigger function
for databases that already exercised the initial234 checkpoint.

Confirmed device loss before enqueue can restore only an undispatched page's
reservation, clear its model key, and requeue without consuming a retry. Any
operation envelope prevents restoration. The companion and durable operation
identity are reused on resume. Overnight direct coverage proves the shared night
reservation returns to zero before transmission, its own queued companion does
not block reclaim, and successful execution charges only the parent once.

Direct private page checks8/8 pass without skips in
/tmp/orbyn-private-page-night-direct.log. Source/provider/model/cancellation,
old-device capability, undispatched resume and already-dispatched reservation
retention are covered. Combined current checks pass81/81 without skips; all-workspace types and production
build pass with terminal exit0. Evidence: /tmp/orbyn-private-page-final-focused.log,
/tmp/orbyn-private-page-checkpoint-types.log and
/tmp/orbyn-private-page-checkpoint-build.log. Native/mobile interaction,
real positive OpenAI inference, full exact-head tests/CI, and remaining ADR
requirements are still open. This checkpoint does not complete the full goal.

## Agenda owner boundary and private review — 5 October 2026

Agenda BriefWriter now receives the actual page owner from contentFor, covering
interactive rewrite and scheduled morning creation. Managed briefs check that
owner and captured provider-choice revision before dispatch and before returning
output, with a 512-token output cap. A selected ChatGPT plan is never silently
sent to the managed provider. Private Agenda dispatch is still incomplete: retain
source identities and revisions across tasks, subscription events, habits, Study
and computed facts; implement durable owner-bound dispatch and distinguish app
session from scheduled authorization. Returning an agenda without a generated
brief is a temporary guard, not completion of that feature.

Actual managed fixture tests prove bounded default requests, zero calls for a
selected ChatGPT plan, no calls for missing/disabled owners, and discarded output
when consent changes in flight. The agenda pipeline verifies the owner passed to
the writer. Direct private page approval now proves stale/foreign waiting cards
are rejected and the saved patch applies with the device offline without another
model call. Combined Agenda/direct private review checks40/40 pass, no skips,
in /tmp/orbyn-agenda-choice-review-final.log. All workspace types pass with
terminal exit0 in /tmp/orbyn-agenda-owner-current-types.log.

Candidate82f5f20e CI37257405383 passed all jobs. Local full qualification ended
2770/2776 pass, six failures, zero skips, during PostgreSQL recovery. Database
logs confirm checkpointer PID20590 was killed by signal9 at03:01:47UTC and
connections were ready again03:01:53UTC. No assertions, timeout, database/JIT or
Docker settings were weakened. The terminal failed run is retained. Fresh marked
orbyn_82f5f20e_qualification_test full qualification is running alone in
/tmp/orbyn-82f5f20e-fresh-full-tests.log, session81660. Do not restart it for an
observation timeout. Main82576dfa remains unchanged, and whole ADR acceptance,
real inference, visual/native checks and eventual cleanup remain open.

## Agenda Study source safety checkpoint — 5 October 2026

The separate AI Study snapshot excludes hidden root decks and original card
sources, revoked team AI consent, lost membership and deleted/foreign pages.
Exam titles require every stored attached deck to remain authorized even when
the human overview already dropped one; readiness uses permitted cards only.
Captured page identities and revisions are rechecked before managed dispatch
and acceptance. Missing original references between reads fail closed; snapshot
failure preserves the ordinary agenda without an unrestricted AI fallback.

Focused checks26/26, zero skips, pass in
/tmp/orbyn-agenda-study-final-regressions.log. All workspace types and production
build pass with terminal exit0 in /tmp/orbyn-agenda-study-final-types.log and
/tmp/orbyn-agenda-study-checkpoint-build.log. No UI/native completion is claimed
for this backend checkpoint. Private Agenda dispatch, source/revision authority
for tasks/calendar/habits/computed facts, scheduled consent, native acceptance,
real positive provider inference and full current-head qualification remain open.

Frozen82f5f20e full session81660 is terminal exit1:2775pass/1fail/0skip.
The unchanged sixty-poll test crossed the10-second presence window in about13s
and observed an additional row revision. Log:
/tmp/orbyn-82f5f20e-fresh-full-tests.log. An unchanged entire assistant-runs
recheck is running as session55232 in
/tmp/orbyn-82f5f20e-presence-recheck.log. No test/timeout/database/interval waiver
or main promotion. Main remains82576dfa; user deploys main manually.

## Combined provider checkpoint — 5 October 2026

Integrated the usage precision correction with recording, bounded private page,
Agenda owner and Study source work. The handoff append conflict retains both
sets of evidence. The unchanged82f5f20e assistant-runs recheck completed41/41
with zero skips:60 polls3018ms, locked fresh read90ms and one row revision.
The earlier full2775/2776 result remains failed, not waived. Requalify this
combined commit with full local tests and CI before main promotion. Full ADR,
real positive inference and desktop/mobile acceptance remain incomplete.

## Agenda fact authority checkpoint — 5 October 2026

Agenda managed briefs reread owned AI facts, filter project/team exclusions in
task/event/block and derived busy queries, and validate an owner/time-bound
snapshot before dispatch and acceptance. Original task/page versions, calendar
and habit identities, event UIDs/occurrences and block revisions are retained.
Internal preferences/placement inputs are hashed without exposing their source
identities in the prompt. Missing revisions fail closed. Excluded busy work
causes omission of affected AI availability, preserving the human calendar and
avoiding a false claim that private occupied time is free.

Final current checks92/92, no skips, pass in
/tmp/orbyn-agenda-retained-sources-tests.log. All workspace types and production
build pass with terminal exit0 in /tmp/orbyn-agenda-retained-sources-types.log
and /tmp/orbyn-agenda-retained-sources-build.log. Provider fixture tests prove
untrusted supplied priorities are not sent, excluded titles remain absent and a
revision changed during the model request rejects its output. Snapshot tests
cover exact owner/time, preferences, task revisions, habit names/placement,
subscription UID replacement/unsubscribe, team AI revocation and human page
preservation. Calendar/planner/habit/visibility suites retain ordinary behavior.

Previous combined f1ecc45b full session78088 completed2811/2811, no skips or
failures, and all four CI37259956426 jobs passed. Main82576dfa remains unchanged.
Do not substitute that previous full result for this newer source checkpoint.
Next: full current-head qualification, durable private Agenda transport with
source context and app/scheduled consent, real inference and native UI acceptance,
then remaining full ADR implementation and eventual cleanup. No deployment.

## Interactive private Agenda and shared result feedback — 5 October 2026

The version4 Agenda job captures its originating app session, current provider
choice/preference and owned AI source/fact snapshot. Dispatch and signed receipt
acceptance use the broker's existing database connection; no nested pool checkout
is required for snapshot reads. Forged facts with a preserved digest, revoked
sessions, changed source revisions/preferences and pre-job provider changes reject
the operation. Calls preserve the512-token cap through an explicitly consented
managed fallback. Stream/unknown failures and missing fallback consent produce
zero managed calls. Completed Agenda jobs retain their actual provider/model.

The API exposes optional briefing outcome metadata, and web/desktop/mobile use
one shared feedback formatter. A calendar rewrite remains available after a failed
summary, with clear failure information rather than generic rewrite success.
API keys remain rejected403 by the existing AI boundary. Provider errors use
fixed recovery text; raw upstream responses never appear in summary feedback.

Current focused Agenda/source/broker checks65/65 pass with no skips in
/tmp/orbyn-private-agenda-feedback-final.log. Route/ordinary Agenda/private-page
checks31/31 pass in /tmp/orbyn-private-agenda-route-final.log. They cover401,
403,400,429, API-key exclusion, revoked app sessions, source/model changes,
bounded signed success and explicit fallback provenance. All workspace types and
production build completed exit0 in /tmp/orbyn-private-agenda-feedback-types.log
and /tmp/orbyn-private-agenda-feedback-build.log. Earlier failed fixture assertions
are retained: compatible providers use max_tokens, and personal API keys are
already forbidden on AI routes; neither production controls nor limits were
weakened. Rate-limit exhaustion runs last so it does not mask auth assertions.

Frozen d602d90e qualification is now terminal:2820/2820 local pass with zero
failures/skips, and CI37261261363 passed. PR196 remains draft and mergeable;
main remains82576dfa. These earlier results do not qualify the newer Agenda
checkpoint. Run full exact-head/CI after committing and integrating this candidate.

Remaining: explicit scheduled plan consent; persistent waiting/recovery and retry
semantics; target/body/source coherence through page application; atomic policy/
source fencing; actual positive OpenAI inference and desktop/mobile visual/native
acceptance. A same-connection snapshot reread is not atomic all-source fencing.
Full C1–C6/M1/D1/U1 stays active. No main merge, deployment or cleanup yet.

## Agent channel signed reply boundary — candidate

A6/C6 remains unfinished. Added an isolated raw-byte Slack signature/parser and
server-owned card-binding resolver. Seven pure cases pass; fresh package build
and backend typecheck pass. It verifies configured app/DM actor, timestamp,
message/delivery identity, connection revision/revocation and exact current
waiting ID. Submitted replies use bounded text/current choices; approvals are
once-only. Duplicate request digests are stable, but durable callback receipts
and installation/outbox consumption are still required. No route, OAuth token
collection or external message is enabled by the helper. Full pipeline and
primary references: evidence/agent-channels.md. Keep real workspace and both
client/native acceptance open; do not treat existing webhooks as A6 delivery.

### 2026-10-05 — Plugin durable inference candidate and qualification repairs

CI37287782196 on f271dd0e failed three tests (2881 pass, one existing Tesseract
skip): two shared-runtime fixtures used leases from a fixed schedule clock,
and the new owner permission endpoints were absent from the route inventory.
The clock fixtures now retain the unchanged production lease duration on the
live chat runner's clock; the owner-only permission routes are classified as
credential management. No shield assertions or runtime limits were removed.

Candidate work adds the separate managed plugin broker/worker, atomic allowance
reservation, grant-owned receipts/events and revocation/provider fencing, plus
matching owner permission controls on desktop/web and mobile. Calls are never
retried after uncertain dispatch. Expired receipt recovery is a separate
statement so it cannot invert grant-before-job locking. Provider errors are
sanitized. Ten new integration cases await CI; local test PostgreSQL remains
unavailable. Pure regressions pass26/26; workspace types pass. Browser retry was
rejected by saved permission; no visual verification claimed. Keep P1 and the
full ADR active until qualification and host/native acceptance are complete.

Owner permission component regressions pass8/8 across desktop/web and mobile
(/tmp/orbyn-plugin-consent-ui-tests.log): no consent from merely opening settings,
reviewed provider snapshot and bounded defaults, explicit revocation, rejection
of invalid output limits, unavailable-provider refusal and sanitized save errors.
These are interaction fixtures, not screenshot or native runtime acceptance.
The initial fixture path error was fixed; its failed log was superseded by the
successful rerun. All workspace typechecks pass in
/tmp/orbyn-plugin-consent-ui-types.log.

### Plugin managed HTTP qualification follow-up

Added an eleventh integration case using the production managed HTTP adapter
against a dedicated mock server: exact model/max_tokens512, expected text,
accepted private result and no second dispatch. It tests more than the injected
send seam. Backend typecheck passes; database execution still awaits CI. The
previous goal turn was progress: committed/pushed broker and owner controls,
34 focused passes, and repaired catalog/lease qualification failures. Current
0f6f222e CI37290712062 is live; PR199 c8403ea1 has no reported checks yet.
Native Simulator inspection again timed out -10005. No visual proof claimed.

### Fresh isolated local plugin qualification — 5 October 2026

A read-only Docker inventory found the already-running embedding test PostgreSQL
healthy on55435 with a persistent volume and ample available space. Created only
a new isolated database orbyn_plugin_20261005_0940_test and its server-side test
marker. No engine/container restart, tuning or application database change.
Initial33-case cohort failed two new fixtures: an impossible duplicate OAuth
client/resource grant and the wrong expected OpenAI cap field. Corrected the
second-grant fixture to a separate client and assert max_completion_tokens512
(and absence of max_tokens), preserving the output cap. Rerun33/33 passes with
zero skips/failures in /tmp/orbyn-plugin-durable-local-integration-fixed.log.
This includes owner consent/CAS, eleven broker/worker cases, actual managed HTTP
transport, plugin service security and complete route inventory. Earlier failed
log remains /tmp/orbyn-plugin-durable-local-integration.log. Exact-head full
local/CI qualification and external host/native visual acceptance remain open.

## Scheduled Agenda authority — in progress, 5 October 2026

The secondary provider worktree now has uncommitted migration237, strict shared
permission schemas, first-party owner-only GET/PUT permission endpoints and
API-client methods. Permission is off by default and independent of morning
emails/recent sessions. Enabling requires the reviewed provider-choice and model
preference versions plus a current inference/output-limit-capable device catalog.
The captured setting includes the explicit fallback choice. Provider/account/
device/model changes, revocation/re-enable and disabled accounts invalidate old
grants. JSONB key ordering is normalized through the shared choice schema before
comparison. Revocation is allowed even after the selected device disappears.
The new routes are excluded from portable MCP/plugin credential capabilities.

Direct database/CAS/catalog and401/403/400/422/429 route plus mocked authority
checks12/12 pass with no skips in /tmp/orbyn-agenda-schedule-permission-final.log.
These include real permission-row JSONB round trips, concurrent writes, model
preference changes and disconnect/revoke/re-enable. All workspace typechecks
passed in /tmp/orbyn-agenda-schedule-permission-types.log; the later backend
recheck also passed. Migration237 was applied only to the marked test database.
Production build passed in /tmp/orbyn-agenda-schedule-permission-build.log.
Pure permission/MCP exclusion/neatness checks17/17 passed with no skips in
/tmp/orbyn-agenda-schedule-pure-final.log; scoped formatting and diff checks pass.
Frozen ce4895a5 full session40694 completed2838/2838, zero failures/skips, in
/tmp/orbyn-ce4895a5-full-tests.log. CI37263198527 remains live on ce4895a5; this
newer work is separate and must not receive the frozen commit's qualification.

This permission foundation does not yet dispatch scheduled summaries or expose a
working scheduling toggle. Next implementation must persist one daily summary
parent with target/date/source/permission/model snapshots and a stable operation
ID. It must defer an undisclosed offline-device request, preserve the same pending
operation, never retry streamed/unknown completion, and recheck permission,
source authority and target revision before applying only the owned summary block.
Human edits/Notes remain intact. Web and mobile need the same truthful pending/
failure/provider/recovery state and explicit permission control, with visual/native
verification. The existing worker's five parallel lanes and morning time window
are not durable recovery or scheduled permission.

## Authoritative qualification and scheduled runtime update — 5 October 2026

CI37263198527 on ce4895a5 is terminal failure: the private Overnight resume test
reported no assignment. Its local full suite passed2838/2838, but that does not
waive CI. A deterministic PostgreSQL-microsecond versus JavaScript-millisecond
retry regression failed on unchanged ce4895a5 (9/10) and passed with the repair.
The scoped repair is458c03a8 on the secondary branch and6be9561c on PR196;
6be9561c is pushed. Exact-head full local session35409 and CI37265979902 are
running. Main remains82576dfa; no new merge/deployment/cleanup occurred.

Scheduled permission foundation5b344d4e is committed and pushed on the secondary
branch. Migration238 and durable daily summary runtime remain uncommitted there.
Current clean marked DB affected suites pass31/31, zero failures/skips. Expanded
scheduled runtime coverage passes7/7 in
/tmp/orbyn-agenda-scheduled-recovery-expanded.log: no implicit grant, daily dedup,
offline same-operation resume, human Note preservation, revoke, edited target,
claimed-operation no-retry after worker expiry, morning expiry and changed model
preference. These are controlled integration tests, not real provider completion.

Next: complete cached/undisclosed recovery and source fencing checks, owner-only
status contracts and matching permission/recovery controls on web and mobile,
then qualify the complete scoped candidate. Real positive OpenAI completion,
plan/limits availability and visual/native acceptance remain open. Retain all
C1–C6/M1/D1/U1 requirements and user/character changes.

Scheduled source-recovery follow-up: a task changed after device assignment
correctly blocked output but exposed an unclassified error. The runtime now maps
known Agenda snapshot changes to a fixed409 conflict without exposing source
details. The unchanged409 assertion and page/usage preservation checks pass;
expanded scheduled suite8/8, zero failures/skips, in
/tmp/orbyn-agenda-scheduled-source-recovery-fixed.log. Earlier7/8 failure is
retained in /tmp/orbyn-agenda-scheduled-source-recovery.log.

## Scheduled Settings/status candidate — 5 October 2026

Owner-only private summary metadata and matching web/desktop/mobile controls are
now uncommitted alongside migration238/runtime. Permission remains explicit,
versioned and independent of digest/email settings. UI operations are fenced to
the current owner/session, cancel on unmount/account change, use reviewed versions
and show current model/fallback plus dated durable status. API refuses keys, foreign
owner query overrides and GET bodies; credential/source snapshots are excluded.
Tests: status/permission7/7, shared status2/2, scheduled runtime8/8, zero skips;
all workspace types passed. Build session25957 is running. Native/visual review,
cached recovery and atomic source fencing remain required before completion.

Exact PR196 head6be9561c local full session35409 encountered PostgreSQL recovery
errors (57P03), including poll-presence checks and fixture cleanup. This full run
cannot qualify promotion even if later tests pass. Retain its log; do not relax
assertions or database settings. CI37265979902 remains independently running.
No new main merge/deployment/cleanup. Goal retains complete ADR scope.

## Cached scheduled recovery and client contracts — 5 October 2026

Controlled cached recovery now passes10/10 in
/tmp/orbyn-agenda-cached-recovery.log. A signed completion survives worker lease
loss with the device offline: one request, one operation and one usage record;
a human edit after completion prevents later application. A queued-envelope
same-request recovery test has been added but awaits execution after full local
qualification; do not count it as passed. Fresh client/status contracts3/3 pass in
/tmp/orbyn-agenda-settings-client-status.log, including no ETag authority cache,
strict response fields and invalid-owner input rejection before dispatch.

The initial6be9561c full local run ended failure after PostgreSQL recovery:
2828 executed,2823 pass,5 fail (not a qualified result). Its log is retained.
A new fresh marked DB full run is confirmed live as session57229, log
/tmp/orbyn-6be9561c-full-tests-recovery.log. CI37265979902 has passed mail/mobile/
Docker, with backend tests still running. No test assertions, polling bounds,
retry intervals or Docker/database settings changed. Build25957 completed exit0.
Simulator control timed out and no native device was booted; native screenshots
and interaction are still required. Full ADR scope remains active.

Qualification update: CI37265979902 is now terminal success on6be9561c;
all four jobs pass. The fresh local full session57229 remains the outstanding
local gate. Log: /tmp/orbyn-6be9561c-ci-backend.log. No main merge yet.
CI backend detail:2838 pass,0 fail,1 existing conditional skip for installed
Tesseract scanned-page OCR. This is not full OCR acceptance; retain local OCR
runtime evidence as a separate gate. The retry regression itself passed in CI.

## Queued recovery and usage-limit follow-up — 5 October 2026

Added an undisclosed queued-envelope recovery test requiring the same request,
job and operation after worker lease loss. Added a signed usage-limit admission
failure test requiring terminal truthful status, zero completed usage and no
fallback operation without consent. Both await execution after serial full local
qualification. Do not count these two new integration cases as passed yet.

Scheduled ProviderError(chatgpt_usage_limit) now maps to fixed usage_limit status;
web/native share recovery text directing the owner to ChatGPT usage management.
The strict public status schema and API docs include this reason, never the raw
provider body. Shared status3/3 and backend types pass. The fresh exact-head full
session57229 remains active with no failure observed so far; CI success is retained.
Atomic all-source fencing and native/visual acceptance remain open.

## Preserved candidate history before main integration

# Production migration recovery and active Agenda candidate — 5 October 2026

PR198 is merged into main as `f816675b`, with the same tree as `81ffb44e`.
Root main safely fast-forwarded; user/character changes remain preserved.
All workspace types/build,13 pure and3 PostgreSQL cases passed locally.
Full CI37279096979 and main CI37279497795 remain live; backend suites have not
been reported terminal yet. The local full attempt failed on full test tmpfs;
`orbyn-postgres-test-1` is now confirmed exited1. Do not restart Docker or claim
local full qualification. No test fixture was removed: the cleanup attempt could
not connect. The user's normal deploy script now receives the hotfix; production
recovery remains unverified.

Agenda candidate `84e88b86` is committed locally; main `f816675b` was integrated
without conflicts as `2b20a074`. The isolated Study repair `06ebbf34` remains in
this candidate. Latest page-lock change adds NOWAIT with a savepoint so a page
edit waiting on the source advisory lock cannot create a cyclic row wait with
final application. This is a candidate, not yet database-verified. Four new pure
cases plus client/status cases pass10/10 in `/tmp/orbyn-agenda-nowait-pure.log`;
backend types24095 pass. A real concurrent human edit/application regression is
written but unexecuted because the test container is stopped. Full integrated
workspace types44252 are in `/tmp/orbyn-agenda-integrated-types.log`.

Prior source-fence/runtime/permission/catalog60/60 and final-application17/17
results are retained below. They qualify the preceding source, not the new NOWAIT
change. Scheduling remains unavailable for production SIWC catalogs without
signed hard-output-limit capability. Real nonempty ChatGPT completion, whole-
account plan/quota/reset data and client/native acceptance remain unverified.
The full C1–C6/M1/D1/U1 ADR scope remains active. No Agenda/main promotion,
worktree cleanup or deployment is claimed.

---

# Current implementation handoff — 5 October 2026

## Latest qualification and top-three work

**Authoritative current checkpoint:** PR #196 merged into main as
`e0a432a542a38b92957816b1e45c57a2aaa2ea43` on 5 October 2026. Merge and frozen
`47541c63` share tree `41df87fa5be668d19dfddb22b5536f2552cf0991`.
Fresh full local61988 exited0: 2,842/2,842 pass, no failures/skips/cancellations,
`/tmp/orbyn-475-full-tests-retry.log`. All four CI37273639006 jobs pass (backend
2,841 pass and one existing Tesseract skip). Root main fast-forwarded safely;
mobile/app.json and untracked user/character files are preserved. No deployment
or cleanup. The historical failures below remain unexplained, not erased by the
successful rerun.

Study overview/review/quiz now resolve links through their supplied transaction.
Baseline3333 failed all three privacy assertions on the original code;
`/tmp/orbyn-study-transaction-links-baseline.log`. Fixed Study/Agenda cohort44983
exited0, 36/36 pass, `/tmp/orbyn-study-agenda-fixed.log`. Backend types pass.
The isolated repair is committed locally as `06ebbf34`; it is not yet pushed or merged.

Migration239 and per-owner source advisory locks are an uncommitted concurrency
candidate. Migration executes successfully; backend types64404 pass. The initial eighteen-table/shared-reader/independent-owner cohort passed21/21
in `/tmp/orbyn-agenda-source-fence-db.log`. Expanded source-fence/runtime/
permission/catalog cohort32853 passed60/60 with no skips, including earlier
writer ordering and inserted-task phantoms, in
`/tmp/orbyn-agenda-source-fence-runtime-db.log`. Actual final-application cohort
52126 passed17/17 with no skips, including a new task blocked until the summary
commits, in `/tmp/orbyn-agenda-apply-concurrency-db.log`. Backend types29217 pass.
Row-lock deadlock behavior, broader writer effects, full candidate qualification
and visual/native acceptance remain open. Do not claim full source acceptance.

## Historical checkpoints (superseded by the current checkpoint above)

CI37273639006 completed successfully on47541c63: all four jobs pass; backend
2841 pass,0 fail,1 existing Tesseract skip (`/tmp/orbyn-475-ci.log`). Two subsequent
original recovery cohorts13/13 each passed; failure-only diagnostics preserved
original count polling/deadline and were removed automatically before a fresh
full retry. Frozen tracked source is clean. Fresh full local61988 is running on
marked `orbyn_47541c63_retry_qualification_test`, log
`/tmp/orbyn-475-full-tests-retry.log`. Do not restart a live handle or treat a
rerun as explaining the earlier intermittent failure. PR body now reflects
current evidence and removes the obsolete pause request. Goal remains active.

Native Simulator Computer Use observation returned timeoutReached (-10005);
no current native Settings screenshot or interaction is claimed. The blocked
browser permission is not bypassed through another browser/port/capture.

Latest terminal results: exact47541c63 full local56612 exited1:2824 tests,
2819 pass,5 fail,0 skips. Four agent-writes cases lost database connectivity;
its following agents test file could not start while PostgreSQL was recovering
(57P03). Original13 process recovery cases and the75-task bulk Review case
passed within their unchanged bounds. This run still cannot qualify promotion.
The prior18/19 extracted lane failure remains unresolved and separately retained.

Scheduled producer/capacity/permission/signed-catalog cohort62231 exited0:
37/37 pass,0 failures/skips, `/tmp/orbyn-agenda-producer-capacity-db.log`.
All three new producer/capacity cases executed successfully. Native inspection,
atomic all-source/phantom fencing and full scheduled-candidate qualification
remain required. No new main merge or deployment has occurred.

Shared web/native scheduling prerequisites now distinguish provider selection,
offline/stale device, unavailable model and unsupported limits. Both signed
inference and hard-limit capabilities are required; a limits-only capability
cannot enable the toggle. Concise copy replaces the misleading blanket claim
that every disconnected/default-provider state lacks limits. All-workspace
checkpoint33189 types pass; eight pure client/catalog/status tests pass with
zero skips/failures in `/tmp/orbyn-agenda-prerequisites-pure.log`. Native/visual
inspection and the three newly written producer/capacity database tests remain
pending. Changes are uncommitted with the scheduled candidate.

Current local full run56612 has encountered PostgreSQL57P03 recovery-mode
errors in agent-writes/agents; it cannot qualify promotion even if later tests
pass. Keep `/tmp/orbyn-475-full-tests.log`. The separate development PostgreSQL
container is repeatedly restarting with an empty postmaster.pid error. No Docker
or database settings have been changed. CI mobile/Docker/mail are successful;
backend/web remains running. These are independently reported states.

Three further scheduled Agenda database regressions are written but unexecuted:
shared Background admission without consuming interactive slots, idempotent
producer recovery for an untouched generated page without inference, and no
scheduled enrollment of a human-edited page. Backend types15845 pass;
seven pure client/catalog/status tests pass in
`/tmp/orbyn-agenda-current-pure.log`. Run the new database cases only after56612
terminates, preserving serial database suites and their original limits.

PR196 is pushed at `47541c631976b098899e237081da70a90cce3386` and remains
unmerged. Root main is `82576dfa`; user and character changes are preserved.
The extracted recovery/night cohort failed 1 of 19 tests: independent runtime
recovery observed only one provider lane before its original deadline. A
same-source diagnostic recovery rerun passed 13/13, zero skips. This is an
unresolved intermittent failure, not proof of a repair. Diagnostics were removed
before the fresh exact-head full suite. Keep both logs:
`/tmp/orbyn-night-bulk-extracted-recovery.log` and
`/tmp/orbyn-475-lanes-diagnostic.log`.

All-workspace typecheck and production build passed on47541c63. Fresh full local
suite session56612 uses marked `orbyn_47541c63_qualification_test`, log
`/tmp/orbyn-475-full-tests.log`. CI37273639006 is still running. These results
must reach terminal state before promotion; earlier green commits do not
qualify this head. Earlier422a5a9b full suite terminated2841 tests,2840 pass,
1 fail,0 skips (75-task bulk Review). The isolated bulk preflight repair retains
75 tasks, the original review threshold, deadlines and no-persisted-items checks.

The secondary scheduled Agenda/capability candidate remains uncommitted. Its
combined recovery/night/scheduled permission/signed catalog cohort passed53/53,
zero failures/skips, `/tmp/orbyn-top3-review-agenda-catalog.log`. Signed catalog
capability assertions therefore ran successfully. The deterministic final-write
expiry regression failed on the old write (`Missing expected rejection`) and
passed on the guarded write; baseline/fixed logs are
`/tmp/orbyn-agenda-final-deadline-baseline.log` and
`/tmp/orbyn-agenda-final-deadline-fixed.log`. It fences lease/window expiry at
page mutation, but does not establish atomic all-source or phantom fencing.
Producer/capacity, native UI and full candidate qualification remain open.

Official SIWC documentation was refreshed: authentication/model discovery do not
prove plan execution; a nonempty completed request does. Account-wide allowances
and app limits are managed in ChatGPT Settings → Usage. Orbyn exposes only
completed-request token usage, explicit permission and observed execution/errors;
it must not fabricate plan tier, allowance percentages or reset times. The
connected account's prior sharing-limit failure remains the latest real inference
evidence; no positive completion has been established. Do not automatically
repeat chargeable probes or use private endpoints. Full ADR scope remains active.

## Resumed top-three priorities — 5 October 2026

Scheduled final-write deadline candidate: applyScheduledAgenda now conditions the
page UPDATE on current parent state, owner/token, lease and morning expiry using
clock_timestamp after the source/page/job locks. Missing RETURNING row fails409
and rolls back page/transport completion. A new deterministic regression expires
the parent immediately before the final page UPDATE on the same transaction,
then requires409 plus unchanged content/version and running parent/child state.
Backend types37053 exited0, /tmp/orbyn-agenda-final-deadline-types.log. Regression
is not yet executed; run it and its old-source baseline after full session18748
terminates, preserving serial DB suites. This does not complete atomic source
fencing or native/real-provider acceptance. Changes remain uncommitted here.

Qualification correction:422a5a9b has passed original372 and378 but failed374,
the75-task Overnight bulk-review recovery test, waiting for terminal state after
Checking the plan before applying. Full session18748 remains live and must be
observed to terminal; this run cannot qualify promotion. Do not increase its
8-second deadline or reduce75 tasks. Inspect the review/check/destination path
and query/process timing. CI37272139189 remains independently live. No new main
merge. This correction does not waive the earlier failures.

Capability follow-up: combined pure catalog client/proof, scheduled client and
summary status cohort9/9 passes,0 failures/skips, terminal0 in
/tmp/orbyn-agenda-catalog-contract-cohort.log. Added signed-publication database
assertions to chatgpt-executor-leases.test.ts: an older catalog exposes no implied
capability; signed inference-only metadata round-trips without claiming limits.
These database assertions are not yet executed: keep DB suites serial until
full local session18748 terminates. Backend types51138 passed exit0, log
/tmp/orbyn-agenda-catalog-backend-types.log. Candidate remains uncommitted.
Fresh422a5a9b full run has passed the previously failed372 and378 recovery cases;
overall full/CI are still live, so no promotion claim. Real positive OpenAI
inference/plan usage and atomic all-source fencing/native acceptance stay open.

User explicitly resumed recovery/merge, ChatGPT verification and scheduled Agenda.
PR196 now422a5a9b, pushed. The independent lane recovery test owned an UPDATE-only
consent fixture created by an earlier test; isolated execution had no settings row
and Overnight failed before inference. Its own upsert/assertion now passes1/1
isolated. Same-source recovery cohort passes13/13; the preceding corrected cohort
still had an invite timing failure, retained without a claimed cause. See
evidence/assistant-recovery-consent-fixture.md. No deadline/assertion was weakened.
Fresh full local session18748 uses orbyn_422a5a9b_qualification_test and log
/tmp/orbyn-422a5a9b-full-tests.log. CI37272139189 is live. Observe these to terminal;
no new main merge yet. Preserve initial515e8959 failures and all source candidates.

Scheduled Agenda web/native enablement now additionally requires the server's
sanitized catalog plan_inference_limits_v1 capability. Catalog omission does not
imply output-limit support; optional typed capability metadata preserves older
catalog compatibility. Current SIWC production runtimes cannot enable the toggle
merely from login/default-model selection. Candidate contracts2/2 and all workspace
types pass, logs /tmp/orbyn-agenda-capability-client.log and
/tmp/orbyn-agenda-capability-types.log. These changes remain uncommitted with the
scheduled runtime; focused backend catalog integration, full qualification,
atomic source fencing and visual/native acceptance remain open. Do not infer
positive real OpenAI completion or account-wide plan usage from fixture tests.

## Current authoritative qualification — hard output budget repair

Pause checkpoint requested by the user: exact515e8959 full local session32803
terminated exit1,2841 tests,2839 pass,2 fail,0 skips. Failures: Overnight dynamic
outside invite staging and independent Background/Overnight process recovery in
assistant-process-recovery.test.ts. Both timed out waiting for terminal state;
do not weaken their8-second bounds or infer a cause from timing alone. Preserve
/tmp/orbyn-515e8959-full-tests.log. CI37268654124 completed success; all four jobs
pass, but CI does not erase these local failures. Build55391 exited0 and scoped
formatting63152 exited0. PR196 remains draft/open/unmerged at515e8959; root main
remains82576dfa with user dirt preserved. No cleanup or production deployment.
Before promotion: reproduce these process cases, repair their cause, then obtain
fresh exact-head full local/CI qualification. No live local test/build remains.

Main remains82576dfa. PR196 is now frozen515e8959, pushed with the isolated
hard output budget repair (source59c16fa8). Its42/42 focused tests and all workspace
typechecks pass. Exact-head full local session32803 uses the fresh marked
orbyn_515e8959_qualification_test database; log /tmp/orbyn-515e8959-full-tests.log.
CI37268654124 is running. Observe these handles to terminal before promotion.
The preceding6be9561c passed2839/2839 fresh local and all four CI jobs, but those
results do not qualify the newer repair. The initial recovery-failed run remains
retained; no test assertions or database settings were weakened.

Official SIWC preview excludes max_output_tokens. The real desktop adapter had
dropped the requested budget while advertising hard-limit capability. The repair
preserves budget preflight and fails before any request; production no longer
advertises limits it cannot enforce. Bounded private SIWC work remains ineligible
until the route can enforce its budget. Managed fallback still requires explicit
consent. Evidence: evidence/chatgpt-hard-output-budget.md.

Scheduled Agenda runtime/Settings/status remain uncommitted here. Latest combined
queued recovery, signed usage-limit, permission/status and route cohort passed
25/25, zero skips/failures, /tmp/orbyn-agenda-queued-usage-runtime.log. Atomic
all-source fencing, native/visual acceptance, producer/capacity qualification,
real positive provider execution and full scoped qualification remain required.
No main merge, production deployment or cleanup. Full C1–C6/M1/D1/U1 remains active.

## Current checkpoint — selected provider features

### 2026-10-05 — Agenda catalog compatibility and shared-clock qualification repair

CI 37286333130 on 50a92aa2 failed three tests (2927 passed, one existing Tesseract skip). Preserve the legacy internal catalog response as well as the HTTP response: capabilities now require an explicit opt-in argument, and capability assertions exercise that opt-in. Preserve both cross-runtime serialization assertions: fixed schedule fixtures now place their claimed page leases on the live chat runner's wall clock using the unchanged PAGE_RUN_LEASE_MS. No production runtime capacity or lease duration changed. Backend typecheck passed (/tmp/orbyn-agenda-catalog-clock-types.log). Database cases await exact-head CI; local test PostgreSQL remains unavailable. ADR remains incomplete.

### 5 October — Agenda main promotion and plugin integration

PR199 merged as8dcc4bb1 after exact a6a65525 CI37291303840 passed all four
jobs (2938 pass, zero failures, one existing Tesseract skip) and99 local focused
passes. Native/visual and positive real-account SIWC acceptance remain open.
Plugin1f594133 full local run passed2902, failed one generated catalog check,
with one existing Tesseract skip. Regenerated the catalog and integrated current
main, preserving both core exports and all historical task evidence. Combined
route catalog is generated from both sets of credential exclusions. No policy,
output cap or test assertion is weakened. Fresh combined qualification follows.

### Scheduled Agenda resumption fixture — 5 October 2026

Combined plugin source4454ea0f full local test completed2971 passes, one failure
and one existing Tesseract skip. The resumption positive fixture committed a
human note while the live worker could acquire a NOWAIT page guard, correctly
causing fail-closed refusal. Commit the unrelated note before resumption instead;
retain operation identity,512 output cap, and exact note-preservation assertions.
The separate actual conflicting-edit/NOWAIT regression remains unchanged.
Production guards, leases, capacities and billing limits are unchanged.

Repaired scheduled-runtime suite18/18 passes without skips, followed by five
independent subprocess repeats of the offline/resumption case, all passing on
the isolated marked Agenda test database. Logs:/tmp/orbyn-agenda-resumption-0.log
through /tmp/orbyn-agenda-resumption-5.log. Docs pure cohort108/108 is recorded in
[evidence](evidence/markdown-parity-current.md). Full combined plugin qualification
must be repeated before its main promotion; visual/native acceptance remains open.

## 5 October — Channel candidate and preview source correction

Channel candidate dc71351c is pushed and integrated with main baseline8b6748c5.
34 focused pure and17 database/inventory checks pass; workspace types/format
pass. The full local run was interrupted to correct public callback inventory;
it is not a passing full-suite result. No channel delivery/native acceptance or
main runtime promotion is claimed. Next: both client installation/review controls,
durable DM delivery with source/connection fences, rotating-token handling and
once-only current-card replies; then Teams.

5174 was running from devday-model-catalog at7f60b352,39 commits behind main.
Its tracked checkout was fast-forwarded to8b6748c5 and packages rebuilt; both
untracked preview files are preserved. The listener remains active. Browser
permission/native limitations still prevent visual acceptance here.

### Slack installation candidate — 5 October 2026

Added migration241, strict shared actor/confirmation/consent contracts and
session-bound installation services. Capture is encrypted and cannot link or
send DM without exact-origin review. Atomic single-use exchange, revision/actor
checks, owner/actor isolation, logout/configuration/expiry refusal, explicit DM
opt-in and credential-clearing unlink are implemented. Ten isolated database
cases pass at DB_POOL_MAX=1;17 pure OAuth/reply and10 logging/gateway cases pass.
Environment, Privacy/version and hourly retention definitions accompany source.

The module remains unmounted and unmerged. Mount HTTP shields/status/callback,
finish both client controls, rotating tokens, durable outbox/current waiting-card
reply consumption, then Teams. External workspace, gateway runtime and native/
visual acceptance remain open. Full ADR remains active. PluginPR203 is now
qualified and merged as0faf19dc, with2975 local/CI passes and one existing skip.

### Durable channel delivery candidate — 5 October 2026

Implemented Slack outbox deduplication, committed claims, live source/owner/
consent fences, independently named Background and single morning Overnight
DMs, bounded provider transport and terminal uncertain-send recovery.96/96
integrated database tests and25/25 pure checks pass; all workspace types and
changed source formatting pass. Cold DB_POOL_MAX=1 process succeeds without
cached encryption keys. Commit-failure-after-acceptance and real source-write
blocking are exercised. Evidence: evidence/agent-channels.md.

Continue both client channel controls, token rotation, durable exact-card
signed reply consumption and Teams. Full local/CI and authorized external,
native/visual acceptance remain required before runtime promotion. Main still
contains qualified prior features; this channel source is unmerged. Full
C1–C6/M1/D1/U1 remains active, with no production deployment or cleanup.

### Slack connection controls and retention review — 5 October 2026

Both client controls and the shared session-bound store are implemented, with
DM permission default off, verified account/workspace/scopes review, fresh CAS
changes and pending UUID-only restoration.23 pure store/Settings cases, all
workspace types, web production build and both native exports pass. Visual/
native interaction and authorized Slack acceptance remain open.

The diagnostic broad run launched atb27eb8ba passed3027, failed zero and skipped
one existing Tesseract case. It overlapped later source edits; no exact-head
full qualification is claimed. Review repaired fixed14-day receipt retention
and bounds stale queue/dispatch records when configuration is disabled.
The final integrated outbox/notice/Agenda/sweeper cohort passes104/104, zero
failures/skips (/tmp/orbyn-channel-fixed-retention-final.log). Controls are committed as4b9c670f and pushed, with current main689a15a4
integrated as54976eeb without conflicts. Continue
continue token rotation, durable signed exact-card replies and Teams. Do not
claim whole ADR, real delivery or production/native acceptance. Root main
user files remain preserved; no cleanup or deployment was performed.

### Fixed retention main checkpoint — 5 October 2026

Main689a15a4 is pushed: fixed retention uses each rule's declared duration,
with7/7 sweeper regression/security/concurrency cases passing. The channel
cohort passes104/104 without failures/skips. Candidate connection controls,
rotation/reply/Teams work and exact-head/native/real acceptance remain separate.
See evidence/agent-channels.md for retained failures and current evidence.
Full C1–C6/M1/D1/U1 remains active; deployment remains user-run.

Current channel checkpoint54976eeb is pushed and tracked-clean. Main689a15a4
rerun passed7/7 using the existing macOS esbuild binary after root dependency
bootstrap failed; no dependency files or user-owned root files were changed.
Next implementation: token rotation, durable signed exact-card replies, Teams;
then exact-head qualification and real/native/visual acceptance. No cleanup.

### Owner-pair Slack rotation candidate — 5 October 2026

Durable one-use refresh claims and state, bounded fixed-endpoint transport,
exact identity/scopes preservation, fail-closed ambiguity and credential erasure,
three bounded rate-limit attempts and version-preserving publication are in
source. Existing queued messages defer rotation without spending send attempts.
Both client token/reconnect states, API/setup docs and Privacy are updated.
31 pure and126 integrated checks pass, as do current workspace types, formatting,
web build and native exports. No real Slack/native/visual acceptance is claimed.

Before promotion, implement canonical workspace-bot credential coordination:
Slack limits active rotated tokens, so independent owner records in one workspace
must not rotate independently. Then durable exact-card reply consumption, Teams,
exact-head full/CI and authorized external/native/visual acceptance. No channel
runtime/UI source is on main. Main429f2de2 all four CI jobs passed in37308099452
(2976 backend passes, zero failures, one existing skip); deployment is user-run.
Full C1–C6/M1/D1/U1 remains active. See evidence/agent-channels.md.

### Teams transport, lifecycle and matching controls — current candidate

Independent bot credentials, bounded fixed Microsoft transport, durable outbox
claims and current owner/source/permission/conversation fences are implemented.
Background transitions and the single morning notice enqueue Teams intents;
accepted-but-uncertain sends never replay. Authenticated personal uninstall
events clear only the current proved route; stale events cannot revoke a later
proof. Migration250 refuses legacy conversation authority without inventing
an authenticated timestamp. Lost linking challenges can be renewed separately
from identity OAuth. DM permission defaults off and requires explicit review.

Both clients use the same session-bound Teams store, persist only a pending
request UUID, and keep linking commands only in memory until expiry/proof.
Expired commands erase locally without network retry loops. Review, personal
chat linking and consent are separate compact controls. Workspace typechecks,
backend/web builds and21 current store/client/gateway cases pass. The preceding
lifecycle/API/source cohort passed56/56; added migration/retention cases still
require execution after the serial identity full suite. Native export is running;
no screenshots or real tenant/native/visual acceptance are claimed.

Identity CI37328563056 failed only the stale recovery test because its live
runner consumed fixtures before the explicit sweep. Repair6bda01e9 stops that
runner for this test and restarts it in cleanup; all41 assertions pass, unchanged.
The immutable repaired full run and CI37332522843 are ongoing. Main690f6246
still contains the qualified Slack checkpoint. Teams source remains unmerged.
Next: qualify and promote checkpoints, exact-card Teams replies, then remaining
whole-app UI, Docs and agent/page requirements. Full ADR remains active.

Current transport/lifecycle/UI cohort now passes112/112; cold installation and
legacy-migration cases pass24/24. All workspace types, whole format, backend/web
builds and iOS/Android exports pass. Identity repair6bda01e9 completed its
immutable full local suite:3130 passes, zero failures and one existing skip; CI
backend remains pending. Delivery/UI full/CI qualification is next.

Latest recovery fixtured926b03c now stops both Background and interactive
recovery sweepers during fixture setup, and restores both for subsequent tests.
Its41-case assistant-runs cohort passes. Earlier6bda full/CI results apply to
that prior test source. The first delivery full run at7bda2185 was deliberately
stopped to incorporate complete fixture isolation; it is not passing full
evidence. Application source integrates without conflicts; the previous merge's
generated catalog conflicts were regenerated to287 exclusions and evidence
notes were combined, preserving both histories. No unresolved merge remains.
Current delivery controls need immutable combined full/CI qualification next.

Teams replies now have a separate unmounted authenticated protocol foundation
oncodex/agent-teams-replies:11 real-RSA cases and focused types pass. Delivery
PR206 remains frozen5bc0bc9d for full/CI; identity PR205 is d926b03c. Simulator
inspection retried and still returns timeout-10005, without screenshot evidence.
Continue receipt/card/transaction implementation after the current serial full
run; do not claim replies, native or visual acceptance from protocol checks.

Teams reply branch continues with complete bounded cards and signed parsers.
16 pure tests and focused TypeScript pass. Still unmounted until nonce/card
receipt persistence and atomic current-question authority checks are complete.
Delivery candidate remains frozen during fresh isolated full qualification;
previous reused-database full result (3171 pass, 9 fail, 1 skip) is retained.
Several failures claimed unrelated queued fixtures left by an interrupted run;
unchanged source is being qualified in a fresh marked test database. No main
promotion or whole ADR completion is claimed from this rerun before it ends.

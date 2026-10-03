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

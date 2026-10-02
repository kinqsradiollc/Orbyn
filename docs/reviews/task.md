# Active implementation handoff — 2 October 2026

## Full user contract

Canonical architectural decision: `docs/adr/001-devday-agent-platform.md`.
Its governing acceptance contract is `devday-2026-implementation-review.md`,
including C1–C6, M1, D1 and U1. The broad goal is active and incomplete. Every
shipped web/desktop feature is required on mobile.
The user authorizes ChatGPT desktop/mobile UI reference inspection and requires
whole-application UI/UX improvement while retaining Orbyn colors/identity. This
explicitly includes Docs reading/typing/editing/saving, every View and layout,
all workflows and all settings/admin surfaces, not only assistant/chat. Background
and Overnight need different worker runtimes and UI workspaces, with bounded,
authorized durable collaboration. Preserve the new main companion feature.

Voice/computer-use product features and the speculative Decisions adapter stay
excluded. Using browser/simulator tools for validation does not add them.
No subagents are authorized. Ready tested checkpoint commits/main integration
and pushes have explicit current authorization. The user requires checking the
combined main state and avoiding conflicts with concurrent work. Main companion
commits were already published by the time of the latest fetch.

## Authoritative repositories

- Main `/Users/anhdang/Documents/Github/Orbyn`: **e1d46af**, pushed. PRs #143,
  #144, #145 and #146 are merged; their exact qualification evidence is recorded below.
  PR #141 independently schedules Overnight. Character changes remain
  published. User-owned `mobile/app.json` and unrelated untracked files remain
  preserved. Root `task.md` belongs to the character task.
- Source `/Users/anhdang/.codex/worktrees/devday-model-catalog/Orbyn`, branch
  `codex/devday-model-catalog`: **209725e** before this documentation update,
  reconciled with current maine1d46af. Retains model,
  Docs, settings, profiles, reflection and handoff work that must not be merged
  wholesale. Two untracked settings preview files remain preserved.
- Scoped backend checkpoint `/Users/anhdang/.codex/worktrees/assistant-work-ownership/Orbyn`,
  now branch `codex/assistant-draft-replay`: **53089fd** frozen against main
  **e1d46af**, draft PR #147, full suite17430/CI37004911014 live. Workspace
  types/build/full formatting95506 terminal zero. PR #146 merged as **c9b6c78**,
  full2,176/2,176 and all CI37003294826 passed. Prior PR #145 is merged as
  **3450e87**, full2,157/2,157 and all CI37000288172 passed. No public rule
  editor enabled; no deployment occurred.
- Plugin `/Users/anhdang/.codex/worktrees/devday-plugin-boundary/Orbyn`:
  **d2da6d8**, draft PR #142, reconciled with main **456e01a**. Full
  2,155/2,155 and types/build/format/all CI passed for this candidate. Actual
  consent/host/gateway/provider/UI resources/events gates remain open.
- Docs candidate **93ad2e2**, draft PR #138, remains in
  `assistant-runtime-integration/Orbyn`, reconciled with current maine1d46af.
  Focused23/23 and all types/build/format passed; full86001/CI37005022002 live.
  Native iOS Contents and inline fragment navigation/fold preservation have
  interaction proof. Android and web/mobile-web remain unverified.
- `devday-2026-plan/Orbyn` retains dirty Docs/executor changes; preserve them.
  Character worktree **e4370a3** is clean and integrated but retained until final
  cleanup. No branches/worktrees deleted.

## Overnight reflection — implementation started

The user requires reflection, not only an agent status card. The ADR acceptance
requirements remain in `devday-2026-implementation-review.md`.

Prerequisite commit `620ed63` prevents generated automation conversations from
entering personal Memory extraction. Both chat completion and the shared enqueue
helper require a persisted, same-owner `person` chat. The extractor rejects old
automation backlog before a provider call and rechecks the source at the write
boundary. Generated answers remain saved. Explicit reviewed memory edits remain
available. This deliberately does not automatically learn even from a person's
later reply inside a chat whose origin is automation.

Memory safeguard PR https://github.com/kinqsradiollc/Orbyn/pull/136 is merged as
`3677d53`. Exact head `0392e92` passed **2,094/2,094** full local tests, zero
failures/skips/cancellations, exit 0, 560653 ms. Log
`/tmp/orbyn-main-memory-0392e92-full-tests.log`; session 18328 is terminal.
Backend types/build and full formatting passed in terminal session 98107,
`/tmp/orbyn-main-memory-0392e92-{types,build,format}.log`.
CI 36973246684 passed all four jobs. Exact head and unchanged base `c1b3ffa`
were checked before merging; local main fast-forward preserved user changes.
Integration worktree `assistant-runtime-integration/Orbyn` now contains the clean
reflection candidate `8535357` on `codex/overnight-reflection`, based on main
`3677d53`. It was cherry-picked without conflicts from source `fccfe8d`. Model branch has main `c1b3ffa` via `880beb5`; integrate
newer main after committing its pending source, without stashing user files.

### Reflection candidate (committed, draft PR; not merged)

Migration 207, reflection evidence/receipt service and scheduler now implement:

- Explicit consent on both clients; old saved preferences default off and old
  client PUTs preserve the saved reflection choice.
- At most 20 fresh source revisions, current permissions and source dependency
  tracking, task/run outcomes and proposal/undo facts. Queued prompts carry only
  identities; provider checkpoints recheck current visibility and revisions.
- Serialized revision receipts, no reflection-of-reflection loops, no provider
  work without new evidence; one bounded reflection slot within the existing
  ten-run/night window/token caps, with at most 30,000 tokens.
- Code-enforced read-only reflection even under full trust. Questions remain in
  the saved morning output. Numbered source links are present in both clients.
- Receipt retention and original transcript/document access propagation.

Workspace types passed after the initial implementation:
`/tmp/orbyn-reflection-types-2.log`, package build
`/tmp/orbyn-reflection-packages-2.log` (session 15787 exit 0). Later test/CSS
additions require a fresh check.

Focused evidence, kept distinct:

- First cohort: 42/43 passed. Empty-evidence final-slot scheduling failed and was
  fixed (`/tmp/orbyn-overnight-reflection-tests.log`).
- Second cohort: 38/39 passed; worker refusal assertion wording was corrected
  (`/tmp/orbyn-overnight-reflection-tests-2.log`).
- Actual controlled Overnight child-process cohort: **6/6 passed**, exit 0,
  `/tmp/orbyn-reflection-worker-tests.log`, session 3964. Includes full-trust
  memory-edit refusal, completed-worker restart without duplicate output/provider
  calls, and permission revocation during a provider response blocking output.
- Latest combined attempt failed before assertions: PostgreSQL 55434 refused
  connections in all five files (`/tmp/orbyn-overnight-reflection-tests-3.log`,
  terminal session 66879). This is not a test pass.
- New final-slot reservation and underlying-document revocation tests are not
  yet executed. Source-button wrapping was improved in CSS, not visually verified.

After recovery, exact isolated-main candidate `8535357` passed **50/50** focused
reflection/night-settings/night-shift/night-safety/night-window/Overnight tests,
zero failures/skips/cancellations, 21796 ms, terminal session 43307. Log
`/tmp/orbyn-reflection-8535357-focused.log`. This includes the new source document,
failed/waiting evidence and final-slot reservation cases. Package build, all three
workspace typechecks and full formatting passed in terminal session 89682:
`/tmp/orbyn-reflection-8535357-{packages,backend-types,desktop-types,mobile-types,format}.log`.

Draft PR https://github.com/kinqsradiollc/Orbyn/pull/137 is pushed and attached.
Candidate `8535357` passed **2,104/2,104** full local tests, zero failures/skips/
cancellations, exit 0, 590066 ms; session 40367 terminal. Fresh marked DB
`orbyn_main_reflection_8535357_test`; log `/tmp/orbyn-main-reflection-8535357-full-tests.log`.
Root production build passed (session 32769 exit 0), `/tmp/orbyn-reflection-8535357-build.log`.
CI 36975244865: mobile, Docker and mail passed; backend/web was still running at
last observation.

Native review found misleading Keep/Undo controls on reflections. Source commit
`7bf5f3a` removes them on both clients, excludes reflection from bulk review in
both API and clients, rejects direct keep/undo with 409, labels completed output
Reflection ready and distinguishes Queued from Working. Web Refresh remains.
Focused review tests **13/13** passed, `/tmp/orbyn-reflection-review-controls-tests.log`;
all source workspace types passed in terminal session 91366.

The follow-up cherry-picked cleanly to integration as **b29f454** and was pushed
on PR 137. Exact candidate is frozen again for a full local suite in session
**15253**, fresh marked DB `orbyn_main_reflection_b29f454_test`, log
`/tmp/orbyn-main-reflection-b29f454-full-tests.log`. Full types/build/format sequence
is session **78370**, logs `/tmp/orbyn-reflection-b29f454-{types,build,format}.log`.
Full types/build/format session 78370 is terminal exit 0: all passed. Full test
session 15253 is terminal exit 0: **2,105/2,105** passed, no failures/skips/
cancellations, 583801 ms. Main is `1768376`; PR 137 remains unmerged.

CI on b29f454 failed one reflection permission test because its same-tick source
fixture could fall after the millisecond JS scan cutoff. Test-only head **061a501**
sets fixture timestamps before the cutoff, requires nonempty evidence before
asserting revocation, and adds a sub-millisecond cutoff regression. Focused tests
passed **10/10**, `/tmp/orbyn-reflection-cutoff-focused.log`. CI **36977493426**
passed all four jobs. Backend results: **2,105 passed, 0 failed, 1 skipped** out of
2,106; the skipped case requires Tesseract, and the prior full local suite ran it.
Log `/tmp/orbyn-reflection-061a501-ci.log`. The fix is copied to model source as
`2208b8b`. No reflection application code changed after b29f454.

Integration checkout is now **codex/docs-navigation**, current head **b3ab641** from
main 1768376 (latest main 324d08e adds documentation only). Reflection branch/head 061a501 and draft PR 137 remain intact.
Do not assume the integration checkout still contains reflection changes.

Still required: focused/full verification on isolated current main, cancellation,
consent/budget cases, pending-run restart coverage, actual web/mobile/native source
navigation. Durable authorized Daytime handoffs and truthful agent profiles remain
separate unfinished work. A saved reflection is not a delivered handoff.

## Runtime isolation — merged checkpoint, 2 October

PR https://github.com/kinqsradiollc/Orbyn/pull/135 merged into main as `c1b3ffa`
on 2 October at 06:21:56 UTC. Main was fast-forwarded locally, preserving the
user's dirty `mobile/app.json` and all unrelated untracked files. Exact PR head
`e6f6376` and unchanged base `bb78cdf` were checked immediately before merge;
GitHub reported MERGEABLE and no conflict occurred. Model branch also merged
current main without conflicts.

Migration 206 adds immutable job lane ownership, with four interactive slots and
separate two-slot Background/Overnight consumers. Dedicated service entry points,
Compose/Kubernetes deployment, private readiness, shared status groups and
notifier fallback rejection are wired. Actual worker-process tests prove one
runtime can be killed/recovered while the other continues; idle loops make no
provider calls. This foundation does not complete profiles, reflection or agent
collaboration.

Qualification:

- Corrected complete suite **2,091/2,091**, zero fail/skip/cancel, exit 0,
  556089.514125 ms. Frozen source `e6f6376`; marked database
  `orbyn_main_runtime_e6f6376_test`; session 57320 terminal.
  `/tmp/orbyn-main-runtime-e6f6376-full-tests.log`.
- Full format check passed (`e6f6376-format.log`, same prefix). Workspace types and
  production build passed on application-identical source `fc4a55c`, logs
  `/tmp/orbyn-main-runtime-fc4a55c-{types,build,format}.log`.
- PR CI run **36972309736**, exact `e6f6376`: backend/web, mobile, Docker live smoke
  and mail all SUCCESS. GitHub run 36971290485 on earlier main 8f2e7b3 also passed.
- Focused runtime/process tests 28/28, automation/task integration 49/49,
  notice/migration 8/8. Logs `/tmp/orbyn-runtime-focused-tests-3.log`,
  `/tmp/orbyn-runtime-automation-tests-2.log`,
  `/tmp/orbyn-runtime-legacy-notice-tests.log`.
- Compose config, Kubernetes render and deploy shell syntax passed.

Historical failed full run `fc4a55c` was 2,083/2,091, all eight failures in fixture
assumptions corrected before the passing final run. Its log remains
`/tmp/orbyn-main-runtime-fc4a55c-full-tests.log`; do not confuse it with acceptance.

Production AUTO_DEPLOY remains disabled. No production deployment, release or tag
was performed. The integration worktree is now reused for the separate Memory
boundary PR 136; do not rerun runtime tests by resetting it to the old branch.

Newest UI requirement is now canonical: each Daytime/Overnight profile must show
truthful Idle/Ready/Scheduled/Working/Waiting/Paused/Unavailable/Failed state,
last actual job activity, next trigger, recent work and outputs using the existing
companion. Heartbeats are service availability, never last user activity. Both
clients and native surfaces are required. No voice/computer-use features added.
Profiles, collaboration handoffs and whole-app UX remain implementation work.
Overnight reflection is also explicitly required: bounded source-grounded review
of work/outcomes/approvals/undo/failures, saved morning output, no duplicate loops,
reviewed proposed memory/rule changes and authorized handoffs to Daytime. This is
recorded in main `bb78cdf`; reflection execution/UI is now a local candidate, with remaining gates above.

## Current qualification

Exact application/asset source `9e0aeb1` passed the complete ordinary backend
`.test.ts` suite: **2,148/2,148**, zero failures/skips/cancellations, terminal exit 0,
521354 ms. Fresh marked DB `orbyn_companion_models_9e0aeb1_test`; log
`/tmp/orbyn-companion-model-9e0aeb1-full-tests.log`; session 80335 is terminal.
Separate pgvector `.integration.ts` fixtures are not implied by this ordinary run.

The first combined main run also passed 2,148/2,148, log
`/tmp/orbyn-companion-model-aa419b8-full-tests.log`. Native startup refreshed the
diagram source digest after the package-lock merge; HTML stayed byte-identical.
`9e0aeb1` records that checksum, and the fresh complete rerun validates the final
committed application/asset state. Companion components and account routes match
main byte-for-byte. Merge conflicts retained newer model discovery/fresh-default
fixes and both relevant main/local evidence. Existing Yjs/lib0/Expo Crypto deps
were linked from main; no install or shared dependency mutation occurred.

Combined workspace types and root production build pass. Logs:
`/tmp/orbyn-companion-model-aa419b8-types.log`,
`/tmp/orbyn-companion-model-aa419b8-build.log`. The portable native abort fix has
a real installed React Native signal regression: 21/23 before, 43/43 after; logs
`/tmp/orbyn-native-abort-before-fix-tests.log`,
`/tmp/orbyn-native-abort-after-fix-tests.log`.

The production image/smoke `orbyn-chatgpt-remote:24419a9` is historical evidence
only and predates the native fix/main merge. Current exact compiled image/smoke,
refreshed Android/iOS exports and remaining actual platform gates are open.

## Actual native evidence

Task-owned iPhone SE/iOS 18.5 simulator
`A166A84A-7389-4FAB-9EA8-8EADAD1D54E3`, Expo Go 57, synthetic account and strictly
marked QA DB `orbyn_mobile_models_24419a9_test`; no real provider calls/credentials.

- Native sign-in and Settings search/ChatGPT destination work. Before the fix,
  discovery returned HTTP 200 but React Native lacked `throwIfAborted`, producing
  the unavailable state. The portable `signal.aborted` check fixes it.
- On `dda31cd`, actual taps verified empty discovery, explicit device choice,
  65-model catalog/50-row limit, search reaching model 65, long-label wrapping,
  save and clear. DB reads proved model-65/version 1, then null/version 2.
  `/tmp/orbyn-native-model-clear-default-20261002.png`.
- Combined main source verified companion onboarding, name/body/glasses/static
  choices, save/reopen and persistence through an actual reload. DB confirmed
  Native Nova/pebble/glasses/static.
  `/tmp/orbyn-native-main-companion-persisted-20261002.png`.
- Combined source model settings still open; stopped fixture heartbeat led to
  offline state and disabled model/default changes. Search still reaches model 65. Dark theme persists after reload.
  `/tmp/orbyn-native-model-offline-dark-20261002.png`.
- Transient CUA observation/window failures occurred. The actual Expo reload
  menu recovered interaction; a failed companion Cancel attempt is not proof.

Large-text/software-keyboard, Android native, live save/clear after the main merge,
real ChatGPT native sign-in/eligibility and inference remain incomplete. Controlled
identity verification is fixture setup, not upstream OAuth evidence.

## Environment and permissions

Disk recovered from 133 MiB to approximately **3.6 GiB**, and Docker became
responsive externally. The agent did not restart Docker Desktop. Only the named
test container `orbyn-postgres-test-1` was started afterwards; its tmpfs databases
were lost, so fresh marked databases were created. Preserve other preview servers
on 8018/8083 and all unrelated containers, volumes, simulators and packages.

Own API 82920/PID 25504 was stopped after checking ownership. Replacement API
4912/8027 exited 1; after Docker recovery API session 61269/8027 is running. Bootstrap `/tmp/orbyn-reflection-native-api.mts`; log
`/tmp/orbyn-reflection-native-api.log`. Metro 70797/8087 was running in CI mode with watching disabled and served stale
source after edits. Its owned PID 25148 was stopped. Replacement 10839/PID 83366
bound IPv6 while Expo requested IPv4 and was stopped. Current Metro session
**65880**, PID 83864, uses NODE_OPTIONS=--dns-result-order=ipv4first, CI=false,
EXPO_PUBLIC_API_URL=http://127.0.0.1:8027, localhost port 8087. Log
`/tmp/orbyn-reflection-native-metro-ipv4.log`. Rebuilt bundle loaded successfully.
The marked QA DB `orbyn_mobile_models_24419a9_test` was migrated through 207 and
seeded using `/tmp/orbyn-reflection-native-fixture.mts`; synthetic IDs saved in
`/tmp/orbyn-reflection-native-fixture.json`. Docker's tmpfs DB may be lost on
recovery. No current API/native interaction success is implied by the seed.
Native observation/clicks initially failed with `failedToCreateImageDestination`
as space ran out. After recovery, the QA database/account was recreated; seeded
consent state is fixture setup, not real consent acceptance. The synthetic account
signed in via UI. Rebuilt native bundle showed Reflection ready, four sections,
numbered sources, and no Keep/Undo controls. Actual source buttons opened the
correct completed task and the original conversation; closing the task restored
Overnight. Conversation screenshot `/tmp/orbyn-reflection-native-source-chat-20261002.png`.
Long second-source label is below the fold: scroll/drag attempts did not move it,
so complete visual wrapping/scroll acceptance remains open. Latest scroll call
reported `noWindowsAvailable`; retry observation before claiming a product fault.
Native token fixture files are private and must never be printed.

IMPORTANT TOOL INCIDENT: Simulator app.paste unexpectedly pasted the user's
existing clipboard (production settings) rather than the provided synthetic email.
It was NOT submitted. The field was cleared using setValue, then a full AX
observation was inspected without emission and verified no production settings
remained and the synthetic address was exact. The UI tool had already emitted
production credentials into tool output. User was informed and advised affected
credentials need rotation. Never copy those values into artifacts/logs/comments;
do not rotate encryption keys blindly or change credentials without authorization.
Do not use clipboard-based native input again; direct setValue worked.

User explicitly authorized reading/updating `.env.production`. Main's ignored
file was updated locally by appending only missing `AI_RUNNER_IN_WORKER=false`,
`ASSISTANT_BACKGROUND_REPLICAS=1`, `ASSISTANT_OVERNIGHT_REPLICAS=1`, and
`DEBUG_ERRORS=false`. Previous contents/values were preserved. Compose config
validation passed with output captured, no secrets printed. This file must not be
committed. No deployment/release/tag occurred; repository auto-deploy is disabled.
Actual deploy.sh requires `.env`; alternate ENV_FILE is allowed only with --check.

Browser Use's saved block for local 127.0.0.1:5174 is unchanged. Do not bypass it
through another URL/port, Chrome/native/headless/CDP. ChatGPT reference access is
authorised separately; actual desktop and 390×844 mobile web shell/composer/Settings
were inspected read-only. No preferences or conversations changed; viewport reset.
The user-owned ChatGPT tab remains open. Responsive web reference is not native
ChatGPT acceptance or evidence about OpenAI runtime architecture.

## Next actions

1. Use the complete ADR as scope. Keep all surface and parity gates explicit.
2. Rebuild exact compiled artifacts when disk permits and finish remaining model
   settings native/web acceptance before promoting pending source checkpoints.
3. Runtime PR 135 and Memory PR 136 are merged and qualified. Finish reflection
   candidate review, commit it separately, and cherry-pick only that checkpoint
   into a branch from fresh main in the integration worktree. A draft PR may run
   CI while local recovery is pending; do not merge before all remaining gates.
4. Implement durable collaboration receipts, permission/source/budget rechecks,
   idempotence and finite handoff depth; prevent concurrent source ownership or
   duplicate changes and unattended per-job pushes.
5. Implement distinct Background/Overnight UI in both clients and the whole-app
   redesign surface ledger, including Docs typing/autosave and all Views.
6. Continue retained agent rules/ownership/activity/budgets, bound/published pages,
   Slack/Teams, complete Markdown parity, native auth/composer/execution and plugin
   host/provider acceptance. Foundations and passing subsets do not complete them.

Main native Docs relative links were a source-inspected gap recorded by 1a26644.
The implementation below is committed in a separate pending checkpoint.

## Latest continuation note

The user replied that they will free disk space; latest available space is about
4.7 GiB. Docker Desktop was recovered externally, and only test PostgreSQL was
started by this task. Local web permission question remains pending: saved Browser
Use denial for 127.0.0.1:5174 must be changed by the user before web inspection.

Native navigation is proven for both source types. Repeated Simulator scroll
commands return noWindowsAvailable or no visible movement, including after
reacquiring the app. Do not count these attempts as scrolling acceptance. A
separate compact synthetic summary was seeded into the same named QA night to
inspect long source-button wrapping independently; the source conversation still
contains the original four-section synthetic reflection. No real user data changed.
Current native app is on the Overnight sheet; avoid app.paste entirely.

Compact native fixture screenshot confirms the complete long task source label
wraps inside its button, both sources and Open chat fit without overlap:
`/tmp/orbyn-reflection-native-source-layout-20261002.png`. This verifies wrapping
independently; long-content scrolling remains unverified due the tool failures.

## Docs navigation checkpoint — 2 October 2026

Source **77b7d5b** on model/Docs branch; cherry-picked without conflicts onto fresh
main 1768376 as **66583c6**, branch **codex/docs-navigation**, in the reused
assistant-runtime-integration checkout. Initial qualification session **96531** failed 52/53: main's HTML exporter
shifted heading levels by one. Follow-up **f96264e** preserves the Markdown level.
Qualification session **39162** is terminal exit 0: **53/53** focused checks,
all workspace types, production build and full formatting passed. Logs
`/tmp/orbyn-main-doc-navigation-{packages,tests,types,build,format}-2.log`.
Current exact candidate is **b3ab641**, which adds the separately verified mobile
root deep-link timing correction below. Draft PR
https://github.com/kinqsradiollc/Orbyn/pull/138 is pushed and attached; its latest
CI must be inspected before promotion.

Shared navigation safely resolves same-origin `/app/...` routes, external relative
resources, Unicode/duplicate heading fragments, stored block IDs and legacy h-N
outline anchors. Both editors keep same-page jumps in their current draft, unfold
only containing sections, and wait for stored folds before initial jumps. Mobile
foldable headings now report outer-row positions; previously the nested text
reported y=0 and the native jump stayed at the top. Editing lines report layout
as well. HTML exports resolve local heading links to their actual h-N targets;
published private resource links remain subject to the existing filter.

Source qualification: **53/53** focused parser/navigation/math-HTML/mobile-download
checks passed, zero failures/skips/cancellations, 971 ms. Logs
`/tmp/orbyn-doc-navigation-tests-2.log`. All workspace types passed (terminal
session 82300), `/tmp/orbyn-doc-navigation-types-2.log`. Root production build and
focused formatting passed (terminal session 27412), logs
`/tmp/orbyn-doc-navigation-{build,format}.log`. These results are scoped to model
source; main candidate qualification is distinct.

Actual narrow native iOS QA on source: a relative app link opened the correct
page inside Orbyn. A nested heading fragment then unfolded its containing
section, scrolled Result into view and preserved the unrelated folded section.
Evidence `/tmp/orbyn-doc-navigation-native-relative-20261002.png` and
`/tmp/orbyn-doc-navigation-native-heading-20261002.png`. Disposable fixture
`/tmp/orbyn-doc-navigation-native-fixture.mts`, IDs
`/tmp/orbyn-doc-navigation-native-fixture.json`. The initial scroll failure was
reproduced and corrected; temporary numeric-only diagnostics were removed.
The test link was moved to a separate synthetic row for semantic activation.

Candidate native preview was moved to the integration branch: only the named
API/Metro preview processes were restarted, Docker was untouched. Current API
session **10091**, `/tmp/orbyn-doc-navigation-candidate-api.log`, port 8027; Metro
session **31081**, `/tmp/orbyn-doc-navigation-candidate-metro.log`, port 8087.
Explicit Expo Reload fetched a fresh candidate iOS bundle (1503 modules).
Relative app navigation and a folded same-page heading jump passed again.
Candidate screenshots `/tmp/orbyn-main-doc-navigation-native-relative-20261002.png`
and `/tmp/orbyn-main-doc-navigation-native-heading-20261002.png`.

Cross-page `/app/doc/<id>#result` then reproduced a transient error: RootScreen
assigned the fragment before awaiting the new document, applying it briefly to
the old page. Candidate **b3ab641** / source **a880a90** awaits the document first,
then applies the page and fragment in the same update. Mobile types and focused
formatting passed (terminal session **59916**), log
`/tmp/orbyn-main-doc-navigation-mobile-types-3.log`. Native retest reached the
Result heading, unfolded only its containing section and showed no error banner.
Evidence `/tmp/orbyn-main-doc-navigation-native-deep-link-20261002.png`;
fixture `/tmp/orbyn-doc-navigation-native-deep-link-fixture.mts`.

Outstanding: web/mobile-web interactions at the authorized preview after its
saved permission is changed and native Android. No Docs navigation code is merged or
deployed yet. This checkpoint does not complete the wider D1 Markdown contract.
Free disk was most recently about 1.6 GiB; the user is recovering more space. Preserve unrelated preview files and
user changes. Do not restart Docker Desktop or use clipboard-based native input.

Latest source audit: main **324d08e** contains only the ADR evidence update after
1768376; Docs navigation and reflection remain draft PRs, not merged application
features. Main user changes are preserved. Candidate Docs head **b3ab641** is
pushed; latest CI run **36979623013** is in progress. Earlier f96264e CI run
36978986389 is superseded. Do not restart or claim either run passed without
checking its handle. Reflection head **061a501**, CI 36977493426 is terminal green.
The main-candidate native API/Metro handles replace the old model preview handles
61269/65880, whose own processes were terminated. Current native screen is the
successful cross-page Result heading, no false error banner. The shared code and
mobile root timing fix are committed; there are no pending application edits.

Native outline qualification on candidate **b3ab641**: opened Info → Contents,
selected Result inside a folded First section, and verified that the editor
unfolded the containing section and scrolled to the highlighted Result heading.
The unrelated Keep this section folded remained collapsed. Evidence:
`/tmp/orbyn-main-doc-navigation-native-outline-20261002.png`. This closes the
native iOS outline gate only; web/mobile-web and Android remain unverified.
Latest live CI snapshot: Docker, mobile and mail passed; backend-and-web is still
in progress on run **36979623013**. Docker Desktop remains under user control.

## Collaboration contract foundation — not delivered runtime behavior

`packages/core/src/assistant-handoffs.ts` now defines strict request and receipt
schemas plus revision-guarded status transitions. Requests cannot assign owner,
producer lane, recipient job, chain depth or authority. Receipts retain producer
job/revision, owner, parent/root, sources, distinct recipient job, result revision
and a bounded failure code. Only background ↔ overnight transfers are supported;
interactive conversations are excluded. Local transitions reject stale changes,
duplicate acceptance, premature completion, terminal reopening and backward
timestamps. Hard limits: depth 3, chain count 20, 3 delivery attempts, 20 sources.
The chain count requires database enforcement; the schema alone cannot enforce
cross-record provenance, ownership, permissions, idempotence or concurrent work.

Focused contract tests passed **10/10**, no failures/skips/cancellations, 406 ms;
log `/tmp/orbyn-handoff-contract-tests.log`. Core package compilation passed.
All workspace typechecks passed, terminal **53125** exited zero; log
`/tmp/orbyn-handoff-contract-types.log`.
This is source-only foundation work, not a merged or production-ready handoff
service. There are no new endpoints, scheduler calls or permission grants.

Next: durable handoff/chain tables with atomic root-count/idempotence guards,
current owner/source/rule/connection/budget rechecks before acceptance and use,
transactional distinct recipient job creation, cross-lane source reservations,
durable completion/failure acknowledgment and retention. Integrate through
`startAssistantAutomation` and runner claims without changing runtime ownership
or passing unattended proposals as approval. Prove with separate worker processes
and current access revocation before exposing controls in either client.

Disk fell to **220 MiB** during qualification despite the user's ongoing recovery.
Avoid further large builds or native image generation until space stabilizes.

## Durable handoff storage foundation

Migration **208_assistant_handoffs.sql** adds receipts and a separate chain counter.
Database guards enforce immutable owner/provenance, distinct runtime/job ownership,
completed producer jobs, queued recipient jobs, revision/status transitions,
bounded delivery attempts, exact result references and acknowledged child ancestry.
The root counter is updated atomically and survives deletion of descendants.
Concurrent duplicate proposals cannot leave extra receipts or chain rows.
The sweeper retains whole chains for 90 days and keeps chains with proposed,
accepted or queued/running/waiting execution work. This is storage foundation only:
no API, dispatch loop, policy grant or automatically scheduled handoff is enabled.

The exact migration ran successfully in an isolated disposable schema on the
marked test PostgreSQL database, with minimal parent tables. **16/16** combined
storage/contract tests passed, zero failures/skips/cancellations, 553 ms; log
`/tmp/orbyn-handoff-storage-tests-2.log`. The storage tests include two concurrent
database clients, malformed ownership/receiving work, stale receipt updates,
finite attempts, incomplete results, child ancestry and persistent chain counts.
Backend typecheck and focused formatting passed; log
`/tmp/orbyn-handoff-storage-types.log`. These are not full migration/application
or separate-worker round-trip qualification. Current source still needs delivery
service authorization/source/revision/connection/budget checks, atomic receiving
job creation, source reservations and actual consumer acknowledgments.

## Docs CI follow-up

CI **36979623013** on b3ab641 is terminal failed: backend 2,096 passed, one failed,
one skipped. The single failure was the old rich-copy assertion expecting h2 for
a stored level-1 heading after f96264e fixed Markdown level preservation.
Updated that assertion and added level 1/2/3 HTML-plus-Markdown clipboard coverage;
the initial added test exposed the existing Markdown trailing newline, which its
expectation now explicitly preserves. Candidate **25e1e6f** is pushed on draft
PR #138. **20/20** focused richer-pages/navigation tests passed, 412 ms; log
`/tmp/orbyn-docs-heading-clipboard-tests-2.log`. New CI **36980902473** is live and
must be inspected by its handle; no merged application feature is claimed.
The new level test is mirrored in the model source. Disk recovered to about
1.6 GiB in the last snapshot but is fluctuating; continue avoiding heavy builds.

## Explicit handoff requests and current evidence

Source **4eaa652** adds `assistant-workspace/handoffs.ts`, with no registered API
or worker dispatch. Producer evidence requires a completed Background/Overnight
job, current owner/container/dependency visibility, checked sources and an enabled
owner account. Its SHA-256 revision includes outcome, apply/review/Undo data and
container/dependency bindings; polling, heartbeat, leases and clock-only Undo
eligibility are excluded. Explicit requests check that exact revision, normalize
UUID identity for concurrent deduplication and reject conflicting instructions.
Follow-ups from receiving jobs preserve the acknowledged parent/root and depth.
They cannot reset ancestry or use an unacknowledged result to continue a chain.

Current qualification: **23/23** combined request/storage/contract tests passed,
zero failures/skips/cancellations, 1,582 ms; log
`/tmp/orbyn-handoff-requests-tests-8.log`. Backend types and focused formatting
passed, log `/tmp/orbyn-handoff-requests-types-5.log`. Full migrations including
208 ran on newly created, server-marked `orbyn_handoff_guard_test`. These tests
simulate receiving work/acknowledgments; no separate-worker collaboration or
provider inference is proved. Expanded tests initially could not bootstrap due
to a PostgreSQL connection reset/refusal. Docker later responded with the owned
test container exited; only `orbyn-postgres-test-1` was started. Docker Desktop
and other containers were untouched. Final verification is green after recovery.

Test PostgreSQL uses tmpfs: its stop/start erased earlier QA databases. The
previous native API/Metro processes may still exist, but their synthetic QA
database/fixtures must be recreated before further live preview claims. Preserve
the screenshots and earlier scoped evidence; do not treat the old preview as
currently functional. Disk subsequently recovered to roughly 6.3 GiB.

ADR-only checkpoint **296a342** was cherry-picked from d80ca5c onto main and
pushed. Main's dirty `mobile/app.json` and all unrelated untracked files remain.
Handoff application code is still unmerged. Docs PR #138 remains at **25e1e6f**;
CI **36980902473** is live, with Docker/mobile/mail green and backend/web pending
in the latest snapshot. Do not restart that run on a polling timeout.

Next required delivery work: receiving-side policy/connection/budget checks,
transactional distinct receiving-job creation and inherited source dependencies,
source ownership reservations, consumption-time revision/access checks, durable
completion/failure acknowledgment, worker recovery tests and both client activity
views. No automatic handoff authority can be inferred from a saved proposal.

## Character changes on main and ownership candidate

Main and origin/main are **e4370a3**, including **7c96f70** (companion wardrobe
and assistant chat redesign) and **e4370a3** (companion editor save visibility).
The user explicitly flagged these changes. Preserve their UI and character
behavior when integrating every candidate; do not overwrite the character task's
worktree or main's dirty `mobile/app.json` and unrelated untracked files.

Ownership source **49fad02** fixes the initial per-owner guard from cf7f9eb:
assigned task/goal/routine identity now serializes across both execution lanes
and across members of a shared task. Migration 209 backfills explicit source
assignments, preserves existing active overlaps on upgrade, prevents identity
changes and blocks new ownership until running/waiting work completes. Lease
expiry alone does not release ownership. The claim query skips busy assignments.
This does not yet wire receiving handoffs or complete collaboration.

The isolated candidate is **b7bd994** on `codex/assistant-work-ownership`, at
`/Users/anhdang/.codex/worktrees/assistant-work-ownership/Orbyn`, pushed on draft
PR **#139**. It changes only migration 209, the runner and ownership tests.
Source combined checks passed **36/36**; candidate focused checks passed **13/13**,
zero failures/skips/cancellations. Candidate workspace types, production build
and full formatting passed. Logs are `/tmp/orbyn-main-work-ownership-focused-2.log`
and `/tmp/orbyn-main-work-ownership-{types,build,format}-2.log`.

Candidate b7bd994 remains frozen on base **296a342** while local full backend
suite **4802** and CI **36983314493** run. Local log:
`/tmp/orbyn-main-work-ownership-b7bd994-full-tests.log`. CI mobile/mail/Docker
passed; backend/web is still running in the latest live check. Do not restart
either on a polling timeout. Once terminal, integrate the latest character main
and qualify the exact combined head before promoting PR #139.

Docs CI **36980902473** on **25e1e6f** is now terminal green: backend **2,098 passed,
zero failed, one known Tesseract-dependent skip**, 2,099 total. Log:
`/tmp/orbyn-docs-25e1e6f-ci.log`. PR #138 is still a draft with web/mobile-web,
Android and other documented UI gates outstanding; green CI is not release or
whole-ADR completion. Its candidate also needs the latest character main before
promotion. The full ADR goal remains active.

## Durable receiving acknowledgment

Source **6fd43f4** adds `acknowledgeCompletedAssistantHandoff`. It locks the
receipt, validates expected revision and accepted status, derives the result
from actual completed receiving work, and rechecks both jobs' owner/source access,
runtime lanes and the producing evidence revision. Concurrent same-transition
retries return the same current result without incrementing twice. Changed
outcomes, stale receipt revisions, incomplete receiving work, revoked sources,
disabled owners and unaccepted/terminal receipts are rejected. It creates no
jobs, endpoints or permission grants. The depth-limit test now uses the actual
acknowledgment service instead of manually completing receipts.

**27/27** combined contract/storage/request tests passed, zero failures/skips/
cancellations, 2,143 ms. Log:
`/tmp/orbyn-handoff-acknowledgment-combined-tests-2.log`. Backend types passed
(`/tmp/orbyn-handoff-acknowledgment-types.log`) and focused formatting passed.
An earlier combined command named a nonexistent contract test path; its 17-pass
result only covered storage/requests. The corrected command explicitly included
`assistant-handoffs.unit.test.ts`, yielding the final 27 checks above.
The code remains source-only/unmerged. Receiving policy, connections/budgets,
atomic receiving-job creation with source inheritance, consumption-time checks,
failure/recovery wiring, separate worker round trips and both activity UIs remain.

Ownership candidate **b7bd994** is still frozen: session **4802** remains live,
with the latest log at test 1,947; CI **36983314493** is also still in progress.
Do not restart either on observation timeout. After terminal results, merge
latest character main into the candidate and requalify that exact head.

Local ownership suite **4802** is now terminal exit zero: **2,101/2,101** passed,
zero failures/skips/cancellations, 519,844 ms. CI **36983314493** remains verified
live with backend/web testing; mobile/mail/Docker passed. PR #139's body records
the completed local result and the current-main integration gate. Main ADR-only
checkpoint **5559758** is pushed, applied as the exact two-document patch from
5c529b4 without installing this source worktree's own handoff on main. Main's
dirty mobile configuration and unrelated files remain preserved. Source branch
`codex/devday-model-catalog` was pushed through **5c529b4**; this is not a PR or
merge for its application code.

Compiled candidate **b7bd994** also passed independent-process ownership proof
on newly created, server-marked `orbyn_work_ownership_process_test`. Two distinct
Node processes imported `backend/dist/.../runner.js` and competed across lanes:
one acquired the shared assigned task, waiting retained ownership, completion
allowed the other lane to claim, and clearing the first checkpoint preserved its
source identity. Synthetic users/jobs were removed afterward. Script/log:
`/tmp/orbyn-work-ownership-process-proof.mts` and
`/tmp/orbyn-work-ownership-process-proof.log`. This proves compiled queue claims,
not provider execution, dispatch, reflection or a complete handoff round trip.
Process **25651** exited zero. CI watch **90866** remains live for run
**36983314493**; do not duplicate/restart the run or edit the frozen candidate.

## Character integration qualification and durable failure outcomes

CI **36983314493** and watch **90866** are terminal failed. Backend reported
2,100 passed, two failed and one known Tesseract skip, 2,103 total. Both failures
were the type-scale ratchets: six sizes introduced by main's character changes
were outside the existing shared scale. CI's checkout log proves it used GitHub
merge commit **07b2853**, combining b7bd994 with character main **e4370a3**;
its `headSha` alone did not identify the tested combined tree. This corrects the
earlier inference that CI tested only the older b7bd994 base. Full log:
`/tmp/orbyn-work-ownership-b7bd994-ci.log`; failure log has the same prefix plus
`-failed.log`. Do not report that run as green.

The ownership candidate merged current main **5559758** without conflicts,
merge **f1dfdef**, preserving the complete character implementation and editor
save fix. Follow-up **51ce91b** changes only six off-scale sizes in web/mobile to
the nearest shared scale values: 12→13, 16→15 and 20→18. No test exemptions or
scale changes were added. Character/style checks passed **17/17**, and all
workspace types, production builds and full formatting passed (pipeline **37675**
terminal zero). Logs: `/tmp/orbyn-work-ownership-character-{focused,types,build,format}.log`.
The candidate is pushed and frozen on **51ce91b**. Full local backend suite
**81622** runs on newly created marked `orbyn_work_ownership_character_test`, log
`/tmp/orbyn-work-ownership-51ce91b-full-tests.log`. New CI **36984587146** is live;
mail/mobile passed, backend/web and Docker still running in the latest check.

Compiled independent-process proof also passed on **51ce91b**; log
`/tmp/orbyn-work-ownership-51ce91b-process-proof.log`. A combined focused command
initially omitted the repository's required `--test-concurrency=1`, allowing one
global-queue test file to claim another file's fixture (12/13 passed). With the
canonical serial invocation, **13/13** passed, zero fail/skip/cancel, 2,731 ms;
log `/tmp/orbyn-work-ownership-51ce91b-focused-2.log`. This was test invocation
interference, not a source guard failure; the full suite uses serial concurrency.

Source **deb93cb** and follow-up **114bb2d** add failure acknowledgment for actual
failed receiving jobs. The service locks receipts, enforces owner/revision and
accepted status, and derives execution/access/revision reasons from current
receiving state and producing evidence. Concurrent retries acknowledge once;
provider error strings and restricted outcomes are never copied to the receipt.
It rejects premature completion, stale requests, unaccepted/cancelled receipts
and disabled/foreign owners. Additional tests cover lost producing access and
unchecked receiving dependencies. **32/32** contract/storage/request checks
passed, zero fail/skip/cancel, 3,083 ms; log `/tmp/orbyn-handoff-failure-tests-2.log`.
Backend types passed (`/tmp/orbyn-handoff-failure-types.log`), focused format and
diff checks passed. No routes, worker dispatch or runtime acknowledgment hooks
are enabled yet. The full collaboration and cross-client goals remain active.

## Ownership merged; Docs integration and native recovery

Local ownership suite **81622** is terminal zero: **2,103/2,103** passed, no
failures/skips/cancellations, 551,423 ms. CI **36984587146** passed all four jobs:
backend 2,102 passed, zero failed and one Tesseract skip. Log:
`/tmp/orbyn-work-ownership-51ce91b-ci.log`. CI merge **a5e314d** and candidate
**51ce91b** share tree `65f2bd0bc2cc50d9a146701b52635ef84d0abed7`. PR #139 was
marked ready and merged with a head-match guard. Main/origin/main **76ec92b** has
that same tested tree, with dirty mobile configuration and unrelated files
preserved. No tag, deployment or release was created.

Docs PR #138 synced main **5559758** via **c8904f3** and font fix **788161e**,
pushed. **37/37** navigation/rich-copy/character/style checks and all workspace
types/build/format passed, pipeline **75428** zero. Logs:
`/tmp/orbyn-docs-788161e-{focused,types,build,format}.log`. CI **36985225329** is
live; mobile/mail/Docker passed, backend/web testing. Freeze **788161e** until
terminal; then integrate main **76ec92b** and the Docs follow-ups below and
requalify. Earlier native proof remains scoped to its earlier source. Current
iOS, web/mobile-web and Android interaction gates remain incomplete.

Fresh native QA uses marked `orbyn_docs_788161e_native_test`. API **76558** serves
8027; Metro **71570** serves 8087 with a fresh bundle. Only old owned Metro PID
**93132** was stopped; user previews and Docker Desktop were untouched. Synthetic
account/docs/folds were recreated. Legal version and analytics opt-out were
seeded fixtures, not real legal consent. Script/logs:
`/tmp/orbyn-docs-788161e-native-fixture.mts`, same-prefix fixture/API/Metro logs.
IDs: `/tmp/orbyn-doc-navigation-native-fixture.json` (mode 600).

Native binding initially selected the user's iPhone 17. Inventory confirmed owned
simulator **A166A84A-7389-4FAB-9EA8-8EADAD1D54E3** still booted; Window menu selected
its exact QA name. No user device was modified. Device→Shake→Expo Reload loaded
the fresh candidate; setValue entered the verified synthetic account without
clipboard use. iOS Save Password hides the accessibility controls; coordinate
input fails with noWindowsAvailable, and Escape/Raise did not dismiss it. Async
request asks the user to tap **Not Now** in the owned QA simulator. Screenshot:
`/tmp/orbyn-docs-788161e-native-password-prompt.png`. No fresh Docs interaction
is claimed while blocked. Browser preview saved denial remains in force; never
bypass it through another browser/address/port or native UI.

Model/settings source merged character main **5559758** without conflicts, plus
font fix **cc04be0**. **62/62** handoff/storage/contracts, ownership/runtime and
character/style checks passed, no fail/skip/cancel, 6,960 ms. Workspace types
passed, **6996** zero. Logs: `/tmp/orbyn-model-character-integration-{focused,types}.log`.
After PR #139, source merged main **76ec92b** as **430490b** without conflicts.

Docs source follow-up **c608f54** preserves Unicode and long heading fragments
through shared/desktop app-link parsers. It bounds fragments and rejects malformed
escapes, controls, spaces and path separators, preserving decomposed Unicode.
**5e1da8d** gives rendered heading links their owning document URL, so modified
or middle-button clicks do not resolve against the shell's stale route. Normal
clicks retain draft-preserving navigation. Actual isolated Inline renderer tests
check URLs and normal/modified handlers. **39/39** navigation/renderer/rich-copy/
mobile-toolbar checks passed, no fail/skip/cancel, 1,759 ms; all workspace types
passed, **33840** zero. Logs: `/tmp/orbyn-doc-fragment-renderer-{tests,types}.log`.
Both follow-ups remain unmerged and require runtime acceptance. Disk about
**2.1 GiB**; avoid unnecessary large builds. Full ADR remains active.

## Latest checkpoint and live Docs handles

ADR-only main checkpoint **f7a3667** is pushed (exact two-document patch from
source **968ad3d**). It records merged ownership **76ec92b**, not deployment.
The main working tree still preserves the user's mobile configuration/untracked
files. PR #139's body now records its merged state and terminal qualification.

Docs CI **36985225329** on **788161e** is terminal green: all jobs passed;
backend 2,100 passed, zero failed and one Tesseract skip, 2,101 total. It checked
merge **47ccffc** with main **5559758**. Log `/tmp/orbyn-docs-788161e-ci.log`.
After terminal results, the Docs candidate merged latest main **f7a3667** without
conflicts and cherry-picked Unicode link source **c608f54** as **c922d34** and
owning-page href source **5e1da8d** as **514679f**. Candidate **514679f** is pushed
and frozen on PR #138. **56/56** renderer/navigation/rich-copy/mobile-toolbar/
character/style checks passed, zero fail/skip/cancel, 2,853 ms;
`/tmp/orbyn-docs-514679f-focused.log`. Remaining types/build/format pipeline
**91141** is live, log prefix `/tmp/orbyn-docs-514679f-`. Full local suite **17106**
is live on newly created marked `orbyn_docs_514679f_test`, log
`/tmp/orbyn-docs-514679f-full-tests.log`. CI **36986507597** is verified live.
Do not modify the candidate source or duplicate runs while qualification runs.

The old owned native API PID **26847** was stopped and restarted from current
candidate as **66033**, 8027; log `/tmp/orbyn-docs-514679f-native-api.log`. Startup
migrates the existing synthetic QA DB to include merged migration 209. Metro
**71570** remains 8087, watching current candidate source. A fresh native reload
is still required before claiming current-head interaction. The iOS Save Password
prompt remains pending the user's **Not Now** dismissal, and the saved browser
preview denial remains unresolved. PR #138 is unmerged; keep its UI gates open.

Pipeline **91141** is now terminal exit zero: all workspace types, production
builds and full formatting passed on **514679f**. Suite **17106** and CI
**36986507597** remain verified live in the final check. No source changes were
made to that frozen candidate. Main remains **f7a3667**.

## Current continuation — activity and related worktree audit

Docs frozen head **514679f** full local suite **17106** is terminal exit zero:
**2,111/2,111**, no failures, skips or cancellations, 516,972 ms. CI
**36986507597** is terminal green in all jobs: backend **2,110 passed**, zero
failed, one Tesseract skip. Logs `/tmp/orbyn-docs-514679f-{full-tests,ci}.log`.
PR #138 remains draft/unmerged because current web/mobile-web/native gates
remain open. No source edits or duplicated runs were made during qualification.

Activity source adds migration **210**, core schemas, private
`GET /me/assistant/activity/:lane`, current source filtering, typed fresh client
replay and the central 90-day sweeper rule. Owner/lane counters survive event
retention; deleted jobs retain no artifact link or copied content. Polling,
heartbeats and checkpoint-only changes do not count as work; queue-only streams
have no last-work timestamp. Imported historical terminal rows create no event.
The fresh marked **orbyn_activity_210_test** applied all migrations. Latest serial
regression **47370** passed **60/60**, no failures/skips/cancellations, 17,866 ms,
covering actual trigger concurrency, source filtering, sweeper retention, cursor
validation, fresh client response binding, 401/403/400/422/429 routes, handoffs,
ownership and runtime lanes. Log `/tmp/orbyn-assistant-activity-regression.log`.
Malformed cursor/page refinements now safely reject without BigInt exceptions.
An intermediate run used old compiled core output and failed the new page guard
check; rebuilding packages before the rerun proved the current guards. Do not
claim the intermediate run as production evidence.

Related worktrees checked by actual status/history/diff: character and ownership
are clean and have no commits beyond main; retain until end-of-goal cleanup.
Plan worktree has retained uncommitted Markdown/Mermaid and executor host work;
model source has unmerged settings, provider/model, Markdown/Mermaid, reflection,
handoff and activity work. Plugin has retained recipient/discovery/consent work.
Reflection branch remains draft PR #137. Git merge-tree checks against main
**f7a3667** found no conflicts for Docs, committed model or reflection; the older
plugin branch has eight file conflicts (package/app, OAuth consent/tokens,
plugin routes/test, HTTP service and review artifact). No actual merge was
started and no conflict markers were installed. Reconcile plugin against current
main deliberately; keep live route/issuer/recipient isolation and all newer main
behavior. Uncommitted plan changes were not represented by those merge previews.
No worktree/branch deleted. Main dirty mobile/app.json and other-task root task.md
remain untouched. No deployment/release occurred. Cleanup comes after required
integration and qualification, including character worktree retirement.

Next: finish activity qualification/checkpoint, build receiving authorization,
budget/dispatch and truthful profiles on both clients; resolve plugin overlaps;
complete actual model executor/settings/Docs D1/U1 behavior. Preserve full ADR
scope. Browser saved preview denial and owned native password prompt still need
the user's existing pending actions; do not bypass them. Docker remains under
user control. Full-format source scan found an existing untracked settings
preview warning; scoped activity formatting passed without altering that file.

Activity qualification **30525** is terminal exit zero: all workspace types
passed on the current source, log `/tmp/orbyn-assistant-activity-all-types.log`.
Current packages build **47370** and scoped formatting passed. The 60-test
regression also includes actual sweeper execution against migration 210. This
source checkpoint is not a qualified main merge or a completed profile UI.

## Runtime profiles and frozen main activity candidate

Reused the clean ownership worktree (its previous branch remains recoverable)
for **codex/assistant-activity**, based on current main **f7a3667**. Initial source
cherry-pick conflicted only on sweeper/core export context and the source handoff.
Resolved by preserving main and adding just activity; excluded unmerged reflection/
handoff sweep rules and the source-only review document. The candidate contains
no profile UI or unfinished model/settings work. PR **#140** is draft and attached.

Candidate **38be150** workspace types/build/full formatting passed (**63117** zero).
Fresh-db full suite **67161** terminal failure: **2,111 passed, one failed**, 2,112
total, no skips/cancellations, 559,950 ms. The sole failure is the generated catalog
route exclusion count. CI **36988277413** terminal failure on the same catalog,
2,110 backend passes, one failure and one Tesseract skip; mobile/Docker/mail green.
Logs `/tmp/orbyn-activity-38be150-{full-tests,ci,types,build,format}.log`.
No candidate edits/restarts occurred while those qualification handles were live.
After terminal status, regenerated only docs/mcp-catalog.json and docs/mcp.md;
actual catalog test passed. Corrected **01b8757** pushed, frozen. Its fresh marked
**orbyn_activity_01b8757_test** full suite is live **13554**, and types/build/format
pipeline **41776** is live. Log prefix `/tmp/orbyn-activity-01b8757-`. New CI is
pending fresh inspection. No main merge or deployment; do not shrink remaining ADR.

Profiles source implements `GET /me/assistant/profiles` with repeatable-read,
primary, private/no-store evidence, enabled-owner/first-party access and 120/min
limits. Core schemas and typed client bind two distinct runtime profiles. A job
needs a future execution lease to count as working; expired/missing leases count
as recovery, queued/waiting stay distinct. Source-inaccessible jobs do not affect
status. Night windows reuse the actual scheduler timezone/DST helper; scheduled
windows are not work, and open windows without jobs remain idle. Owner-specific
per-night estimates/limits never imply billed usage or new reservations. Last
work comes from the same filtered durable events. Refactored the last-work query
to avoid loading replay pages just to display a timestamp.

Both clients implement **Your agents**, reachable in chat history/drawer. Web
uses an accessible native modal dialog with contained scrolling; mobile uses the
existing safe-area scrolling BottomSheet and drawer-dismiss sequencing. Cards
reuse main's Character and show separate runtime states, counts, last work,
night schedule and estimates. Shared **AssistantProfileStore** coalesces reads,
cancels/reset on close, clears failed-refresh evidence and fences stale responses
across generations and session changes. No voice/computer-use product features.
The cards do not yet expose complete reviewed rules/permissions, detailed outputs,
durable budgets or receiving dispatch; visual/native gates remain open.

Latest source qualification: **19/19** actual profile/activity/window tests,
24,382 ms (`/tmp/orbyn-assistant-profiles-current-tests.log`), plus **23/23**
character/style/catalog/shared-store checks, 3,037 ms
(`/tmp/orbyn-agent-profiles-contracts.log`). Includes 401/403/400/429, disabled
owners, current source filtering, lease recovery, separate lanes, DST windows,
per-owner/per-night estimates, fresh client schema rejection, coalescing, closed
and account-change response fencing. **34945** terminal zero: all workspace
types and production builds (`/tmp/orbyn-agent-profiles-current-{types,build}.log`).
Scoped modified-file formatting and diff checks passed. Existing untracked
settings preview files remain untouched. No actual current profile layout or
native interaction is claimed from static checks/builds.

Next: inspect corrected activity CI/live handles; complete and qualify profile
recent outputs/permissions plus UI interaction; wire typed receiving authorization,
reservation/dispatch/recovery, prove separate process round trips; reconcile older
plugin branch overlaps; finish model executor/settings and Docs D1/U1. Native QA
is still waiting for dismissal of the owned simulator's Save Password prompt and
browser saved-deny permission remains unresolved; do not bypass either. Main
character work and other dirty files stay preserved until integration is complete.

Profile source is committed/pushed **d3b4c64**, with only preserved untracked
settings preview files left locally. Latest corrected activity CI
**36989279876** is verified live on **01b8757**; **13554** and **41776** are also
verified live. Source profile regression **97347** is terminal zero. PR #140
body updated to disclose the catalog failure and current corrected qualification.
Keep the exact candidate source frozen until all qualification is terminal.

## Activity merged; profile outputs source checkpoint — 2 October 2026

Activity candidate `01b8757` qualification is terminal: full suite **13554** exit
zero, **2,112/2,112**, no failures/skips/cancellations, 577,679 ms. Pipeline
**41776** exit zero; CI **36989279876** completed success for all four jobs.
The candidate, fetched GitHub merge and resulting main trees match
`f62fdf5209f0dfb77b60ccb5788724c005742d04`. PR #140 merged as **9e7e505**.
Main **2ba1ae2** commits the ADR checkpoint and explicitly retains full scope.
Main dirty mobile/app.json and unrelated untracked files remain untouched.

Current source adds eight recent events and five completed output links per
profile, with current source visibility, owner/lane isolation and deletion
handling. Completion times come from actual transitions, not later result edits
or imported completed jobs. Mobile defers output navigation until sheet dismissal;
existing chat access checks run again when opening. No visual proof is claimed.

Corrected-source regression **85768** passed **19/19**, 29,747 ms, no failures,
skips or cancellations (`/tmp/orbyn-profiles-output-current-tests.log`). An earlier
attempt used DATABASE_URL instead of TEST_DATABASE_URL and was rejected by the
test guard before database tests ran; it is not qualification evidence. The
corrected command uses only the marked owned test database. Character/style/catalog
**85092** passed **21/21**. Corrected types/build **73422** is terminal zero; logs
`/tmp/orbyn-profiles-output-{types,build,style}.log`. Scoped formatting/diff passed.

Next: receiving authorization, typed rules and agent identities, durable budget
reservations, dispatch/recovery and worker acknowledgment; profile permissions
and actual UI interaction. The night scheduler's queued/running busy query still
lacks a runtime lane predicate and needs a scoped regression before correction.
Continue plugin reconciliation, real model executor/settings, full Docs D1/U1 and
whole-app mobile parity. Existing browser denial and native password prompt remain
open gates. Docker stays under user control. Cleanup remains at the end.

## Independent night scheduling candidate — 2 October 2026

Regression reproduced global scheduler coupling: queued/running interactive and
Background jobs each prevented unrelated Overnight work (four failed cases).
Waiting other-lane jobs and queued/running Overnight exclusion passed before the
fix. Source `0ae3d05` limits the busy query to immutable `runtime_lane='overnight'`.
Eight added cases cover three other-lane states and both Overnight blocking
states, without changing provider/presence/pause/window/budget/source gates.
The existing shared-task ownership guard still applies at claims.

Source **64699** terminal zero: **53/53** night-shift/Overnight/runtime/ownership
checks, no failures/skips/cancellations, 13,716 ms. Backend types **69776** and
scoped formatting/diff passed. Logs `/tmp/orbyn-night-lane-{before,current-tests,
source-types}.log`; the before log is intentionally failing reproduction evidence.

Clean isolated candidate **9b87ce3**, branch **codex/overnight-scheduling**, based
on main **2ba1ae2**, retains only these two files. Draft PR **#141** attached:
https://github.com/kinqsradiollc/Orbyn/pull/141. Qualification is frozen/live:
**75320** fresh marked `orbyn_night_9b87ce3_test` full backend suite;
**76016** all workspace types, production builds and full formatting;
CI **36990759723** currently in progress on that exact head. Logs
`/tmp/orbyn-night-9b87ce3-{full-tests,types,build,format}.log`.
Do not edit/restart the candidate while these handles are live. Poll the same
handles; after terminal success inspect current main and the tested merge tree
before merging. No main merge, deployment or goal completion is claimed here.

## Plugin recipient reconciliation — 2 October 2026

Related plugin worktree `/Users/anhdang/.codex/worktrees/devday-plugin-boundary/Orbyn`
is now on **9ce1961**, merged with current main **2ba1ae2**. Resolved all eight
overlaps: package scripts and HTTP service names retain main's separate runtime
services; app mounts retained public plugin discovery; consent/tokens retain
server-selected plugin recipients and recipient-specific grant lookup; plugin
routes retain configured authentication challenges; tests retain discovery cases;
review artifact retains main's historical integration evidence plus current gate.
No unresolved merge entries or conflict markers remain. Root untracked node_modules
link is preserved; backend/desktop/API-client local aliases resolve this checkout's
own packages. Main character and all newer main code are retained.

Combined diff vs main is 14 files, 508 additions/24 deletions, scoped to recipient/
discovery, consent UI/contract, tests and review artifacts. Draft PR **#142**
attached: https://github.com/kinqsradiollc/Orbyn/pull/142. Current **94215** terminal
zero: **62/62** focused connector/OAuth/plugin/service/consent checks, no failures,
skips/cancellations, 21,103 ms. Packages **8673** terminal zero. Older branch
results are historical only and do not qualify the current combination.

Exact candidate frozen while **75235** types/build/full-format pipeline and
**19850** full backend suite run. The full suite uses a separately created fresh
marked **orbyn_plugin_9ce1961_full_test** database, separate from focused checks
and live scheduler qualification. CI **36991179849** verified in progress on
**9ce1961**. Logs `/tmp/orbyn-plugin-9ce1961-{focused,types,build,format,full-tests}.log`.
Poll the same handles; do not restart live runs or edit the plugin candidate.

Scheduler **76016** is now terminal zero: all workspace types, production builds
and full formatting passed. **75320** full suite and CI **36990759723** remain
verified live on **9b87ce3**. Both candidates remain unmerged. Browser/native consent,
host launch, gateway, UI resources/events and actual provider inference remain
open plugin gates. This turn does not wire receiving authorization: typed rules,
agent identities, reservation/dispatch and separate-worker handoff round trips
remain next dependencies. Preserve the entire ADR and mobile parity scope.

## Typed action restrictions source — 2 October 2026

Source **4ec8644** adds migration 211 on the existing stable named-assistant
grant, preserving its identity, Memory, schedules, appearance and trust. Strict
bounded rules bind server-selected interactive/background/overnight lanes,
action classes and all/personal/team scopes. Deny dominates ask and allow in any
order; allow does not raise access or override unattended/source ceilings.
Revision-guarded replacement serializes on the grant; unrelated team scopes are
refused. No public editing route or automated text-to-rule conversion is enabled.

The actual capability write transaction loads current persisted rules under the
grant lock before executing; caller allow snapshots are ignored. Principal and
approval-card revisions fence rule changes before approval and again at apply.
Legacy cards are valid only at initial revision one. A newly collected card
records the revision used for that collection. Declining remains available.
The card's existing waiting ID remains mandatory. Approval grant locks use
FOR UPDATE so saved-scope writes cannot cause shared-lock upgrade deadlocks.

Current **55617** terminal zero: **19/19** rules/night safety/assistant write
regressions, 5,465 ms, no failures/skips/cancellations. **89713** backend types
terminal zero; packages **26205** and scoped formatting/diff passed. An earlier
typecheck caught nullable waiting-state narrowing; corrected before checkpoint.
Fresh marked **orbyn_rules_211_test**, **74514** terminal zero: all migrations
and **7/7** dedicated tests, 2,487 ms. Logs
`/tmp/orbyn-assistant-rules-{current-tests,current-types,fresh-tests,packages}.log`.
Tests exercise actual PostgreSQL blocking of a rule edit by an in-flight write,
not merely a delay, plus persisted deny, stale principal/approval, replacement
race, strict bounds and existing hard stops. Source is committed/pushed only.

Required next work: independent agent ownership records; first-party rule editor
and inspection on both clients; proposal-review provenance and current rule
rechecks (including background lane); read/external-effect enforcement; receiving
handoff checks, connection/budget reservations and dispatch/recovery. Do not
enable rule editing or ship this as complete policy until those paths are wired
and qualified. Budget and permission hard stops must remain independently checked.

Scheduler full suite **75320** is terminal zero: **2,120/2,120**, no failures,
skips/cancellations, 622,944 ms. All types/build/format passed; CI **36990759723**
still verified in progress, backend tests live while mobile/Docker/mail passed.
Plugin pipeline **75235** terminal zero: all types/build/full formatting passed;
full suite **19850** and CI **36991179849** remain verified live on **9ce1961**.
Keep both candidates frozen and poll their same handles; no main merge yet.

## Scheduler merged and proposal rule provenance — 2 October 2026

Scheduler CI **36990759723** is terminal success for all jobs. Fetched its exact
merge commit separately (multi-ref FETCH_HEAD selected main first); candidate,
GitHub merge and resulting main trees match
`3e2d1b8410f139b625c88036679d62a77c08caca`. PR **#141** merged as **7f3894f**;
main **9e1a2c8** commits ADR qualification. Dirty mobile/app.json and unrelated
untracked files remain untouched. PR body records current evidence; no deployment.

Plugin **19850** terminal zero: **2,116/2,116**, no failures/skips/cancellations,
615,740 ms; CI **36991179849** terminal success for all jobs. All types/build/full
format passed. These qualify **9ce1961** on base **2ba1ae2**, not newer main.
PR **#142** remains draft with accurate qualification and interaction gates.
Integrate/requalify current main before merging; browser/native consent, host,
gateway/provider and UI resources/events remain required. Do not restart old runs.

Source **35d186f** adds migration 212 and server-generated proposal guards with
runtime lane, reviewed rule revision and bounded resolved action/space checks.
Domain destinations collect checks; toReview persists them independently of tool
arguments. Creation and approval lock the source grant, validate current owner,
pause/access/team ceilings and rules. Edits invalidate old suggestions; legacy
unbound built-in suggestions are accepted only at untouched initial rules.

Whole-plan review previously reconstructed an assistant as an agent key and
could name a different grant inside its action input. Review now requires the
original connection, ignores action-input assistant identity and derives it from
the server guard. The plan runner rebuilds built-in/plugin principals correctly
with current rules and runtime, without first-party-session authority. Existing
outside-agent review behavior passed regression. These findings/fixes remain
source work, not already delivered main protections.

Current **24996** terminal zero: **36/36** proposal/rules/apply-plan/agent-write
checks, no failures/skips/cancellations, 8,712 ms. **77549** backend types and
**91072** packages terminal zero; scoped formatting/diff passed. Fresh marked
**orbyn_proposal_guard_212_test**, **73180** terminal zero: all migrations and
**7/7** dedicated cases, 2,277 ms. Logs
`/tmp/orbyn-assistant-proposal-guard-{current-tests,current-types,fresh-tests,packages}.log`.

Next: bind/recheck current job/source provenance through all review paths; retain
notification-delivery restrictions, read/external effects, typed agent records,
first-party web/mobile rule editor, budgets/reservations and receiving dispatch.
Run full combined source qualification before any scoped production candidate.
This does not complete A4 or the wider ADR. Current source tree is clean except
the two preserved untracked settings previews; no cleanup/deployment occurred.

## Producing job/source binding and main candidate — 2 October 2026

Source **185a9d7** adds server-only producing job identity to the runner principal
and separately persisted proposal guard. Creation and approval recheck current
owner, immutable runtime lane, checked job dependencies and conversation/project
visibility. Whole-plan review strips action-input producer identity and supplies
only verified server evidence, including nested review proposals. Background and
Overnight proposals without producing work hold; interactive non-job capability
calls remain supported. Cleanup/missing sources hold instead of acquiring session
authority. This checks current access; reviewed source revision snapshots remain
an explicit further requirement.

Source **36273** terminal zero: **43/43**, no failures/skips/cancellations,
9,022 ms, including existing agent-write and whole-plan behavior. First run
**72064** had two test fixture errors referencing nonexistent Docs body; corrected
before rerun. Fresh marked **orbyn_proposal_job_test**, **42887** terminal zero:
all migrations plus **14/14**, 3,277 ms. Types **55367** and packages **31956**
terminal zero. Logs `/tmp/orbyn-proposal-job-{tests-2,fresh,types-2,packages}.log`.

Reused clean merged scheduler worktree to create **codex/assistant-rule-review**
from current **origin/main 9e1a2c8**. Cherry-picks **4ec8644**, **35d186f** and
**185a9d7** applied without conflicts as **5b1704e**, **c8f3b7d**, **6641e52**;
ADR checkpoint **fc82170** is pushed and frozen. Current full candidate tests
**68672** on fresh marked **orbyn_rule_review_full_test** and types/build/format
pipeline **96665** were started and are still pending terminal observation.
Logs `/tmp/orbyn-rule-review-fc82170-{full-tests,types,build,format}.log`.
Re-poll these exact handles; do not restart or mutate the frozen candidate.

No main merge, deployment or cleanup occurred this continuation. Full ADR and
web/mobile parity remain active. Next: finish this combined backend qualification,
then permissions/rule editor and agent records, read/external/notification guards,
source revision evidence, budget reservations and receiving dispatch/recovery;
also finish actual models/executor, plugin, Docs and whole-app UI gates.

## Corrected review candidate and native observation — 2 October 2026

PR **#143** is draft and attached: https://github.com/kinqsradiollc/Orbyn/pull/143.
Initial **fc82170** full **68672** terminal failed: **2,130/2,141 passed**, **11
failed**, no skip/cancel, 555,674 ms. Pipeline **96665** terminal zero, all workspace
types/build/full format. CI **36993742889** terminal failed. All eleven failures
are `assistant-overnight.test.ts` legacy fixtures creating guarded built-in proposals
without producing evidence. Protection was retained; no early cancellation/restart.

Source **d8bf8d5** corrects fixture sequencing: create owned conversation and
actual Overnight job before filing proposal, bind lane/rules/checks/job, then save
its result and night-run reference. Initial new fixture omitted chat's mandatory
id; corrected before rerun. Source **69108** terminal zero: **27/27**, no skip/cancel,
12,116 ms. Scoped cherry-pick **a610406** applied without conflict; **54754** terminal
zero **55/55**, no skip/cancel, 13,165 ms. ADR **e58ed27** pushed on PR #143,
freeze this exact head until all qualification runs terminal.

Current corrected full **74503** runs on fresh marked
**orbyn_rule_review_corrected_test**; pipeline **51246** types/build/full format.
Logs `/tmp/orbyn-rule-review-e58ed27-{full-tests,types,build,format}.log`.
These handles are live now; poll them, never restart solely on observation timeout.
Recheck PR #143 head and current origin/main before promotion. No main merge yet.

Owned native QA window is accessible again; password prompt gone. Skipped optional
synthetic onboarding, used Device→Shake→Expo Reload. Current Metro PID **26907**
port8087 cwd is clean Docs **514679f** worktree, API8027 PID30467 remains owned.
Observed Docs library open, fixture reading, first-section fold/unfold, and relative
app link opening destination page inside Orbyn. Returning via related-page link
reopened QA with its folds intact. Evidence screenshot
`/tmp/orbyn-docs-514679f-native-folded-fixture.png`.

Precise heading-link click still throws `noWindowsAvailable` on coordinates.
AX merges both inline links into one row and semantic click chooses destination;
this does not prove heading navigation. Added empty synthetic block to enter editing;
native editor exposed as a Group, not a settable text field; `setValue` refused.
No clipboard/paste/typing workaround used and no save proof claimed. Simulator stays
on synthetic empty-block editing. Web saved denial remains respected. Actual
heading navigation, typing/saving, mobile-web/web, Android and wider UI remain open.
Full ADR active, no cleanup/deployment, preserved main/character changes untouched.

## Notification/source privacy and deletion regression — 2 October 2026

Corrected main candidate **e58ed27**, PR **#143**, remains frozen and clean.
Full **74503** terminal zero: **2,141/2,141**, no failures/skips/cancellations,
549,434 ms. Pipeline **51246** terminal zero: all workspace types, root production
build and full formatting. Current CI **36995158096** mobile/Docker/mail passed;
backend-and-web job **110800092803** was verified live. Current remote base remains
**9e1a2c8**; tree **a8f0bd5a54f60886e4b261378576f465b6daae70**. PR body updated.
No merge until terminal CI and exact head/base/tree checks; no local run remains live.

Source **866e4c0** applies job source visibility to personal notice enqueue, inbox
and delivery, in addition to conversation access. A job-only dependency did not
previously protect queued pushes or saved inbox text. Real worker regression
revokes project source access after queueing and observes cancellation with zero
network calls; unknown/deleted dependencies hide the saved card.

This exposed real account cascade failure in the history metadata trigger during
test teardown. Source **977288c**, migration **213**, skips recreating history
access when its owner/team parent is being deleted; ordinary target deletion
retains original owner/team metadata. New tests run the former migration-084
function inside a rolled-back transaction and reproduce its foreign-key failure.
The reproducible INSERT path explicitly removes access metadata first, avoiding
foreign-key cascade-order dependence. Tested personal/team account cascades,
team deletion without conversion to Personal history, and ordinary task/page/
record removal. No production data or trigger was touched while reproducing.

Initial notice assertions all eleven passed but **95176** terminal failed its
teardown. First fresh combined run **35056** failed only the nondeterministic old
trigger reproduction; corrected before rerun. Current fresh marked
**orbyn_notice_history_213_test**, **75933** terminal zero: **48/48**, no failure/
skip/cancel, 8,798 ms (all migrations, notices, history, project time machine and
night scheduling). Types **82594** terminal zero and scoped format/diff passed.
Logs `/tmp/orbyn-notice-history-213-{fresh-2,types}.log`.

Source **411935e** adds a shared producing-job visibility predicate for Review
item/inbox/pending badge, agent proposal outcome and its saved in-app notification.
Approval was already fenced, but reads could still expose saved generated summary
when an independent source vanished. Missing producer/evidence, owner mismatch
and runtime mismatch now omit it; unchanged legacy non-job behavior stays covered.
Current **38283** terminal zero: **65/65**, no failure/skip/cancel, 20,959 ms;
Review/rules/notifications/Overnight/muse/project/agent-write regression cohort.
Backend types **59240** terminal zero. Logs
`/tmp/orbyn-proposal-read-sources-{extended,types}.log`. Initial 40-check run used
an absent review.test.ts path; extended run uses actual muse/project/agent files.

All three new source checkpoints committed and pushed; not yet qualified on main.
After #143 merges, extract these changes onto its combined current main and run
fresh full qualification. Do not merge the full model/Docs/settings source branch.
Then continue typed notification/read/external restrictions, per-agent ownership,
first-party web/mobile editor, source revisions, budgets/reservations and handoff
receiving authorization/dispatch/recovery, plus the complete model/plugin/Docs and
whole-app UI gates. No cleanup/deployment or goal completion occurred.

## Current main reconciliation and privacy gate — 2 October 2026

PR #143 is merged as **9c344b8**, with documentation checkpoint **dabb770** on
main/origin. Frozen **e58ed27** passed **2,141/2,141** local tests, workspace
types/build/full formatting and all CI jobs **36995158096**. Exact candidate,
GitHub merge and resulting main trees matched. No deployment occurred.

Source reconciled current main in merge **b05d9bf**, committed and pushed. All
13 overlaps resolved; staged reconciliation changed only the two chronological
ADR/review documents, preserving source implementations and published main code.
All workspace types **96596** terminal zero; no unmerged entries or conflict
markers. Untracked settings previews remain preserved. Main mobile/app.json and
character task artifacts remain untouched. Do not merge this entire source branch.

Scoped draft PR **#144**, frozen **f79c852**, remains on base **dabb770**. Combined
focused **80654** terminal zero: **69/69**, no failures/skips/cancellations,
22,920 ms. Pipeline **87200** terminal zero: all workspace types, root production
build and full formatting. Full fresh marked database suite **74602** remains
live on **orbyn_source_privacy_f79c852_test**; resume the same handle. CI
**36996647235** backend-and-web **110804794360** remains live; mobile, Docker
and mail succeeded. Logs `/tmp/orbyn-source-privacy-f79c852-{full-tests,focused,
types,build,format}.log`. Keep candidate frozen until both runs terminate.

Before promotion verify current head/base and exact merge-tree equivalence, then
merge with exact head protection and fast-forward main preserving its dirty files.
Source privacy is current-access protection, not reviewed source revision
snapshots. Public typed-rule editor, read/external/notification rule enforcement,
agent ownership, budget reservations and receiving collaboration remain open.
Full models/providers/plugin, Docs and whole-app UI/mobile/native acceptance
stays active. Saved web preview denial remains respected. No cleanup, deployment
or goal completion occurred.

## Terminal privacy tests and native Docs persistence — 2 October 2026

Frozen PR #144 **f79c852** full handle **74602** terminal zero: **2,151/2,151**,
no failures/skips/cancellations, 563,046 ms. Fresh database
**orbyn_source_privacy_f79c852_test**. All types/build/full format and 69 focused
checks remain terminal green. Current CI **36996647235** backend still live;
do not restart. Fetched exact CI merge **2f1984a**, parents dabb770/f79c852;
candidate/CI merge tree **a903b6c7158871b05472e3afb54d824290df80fa** matches.
Still draft; no main merge until terminal CI and fresh base/head recheck.

Native Docs **514679f** evidence advanced: clicking the existing empty editor
then a single native `a` key exposed a settable field. Used setValue with synthetic
`Native Docs typing and save QA.`; no clipboard/paste. Back ended editing;
subsequent close flushed save, API request **3cd6fffd-2cce-43c8-90db-96c5b655490c**
PUT /docs returned HTTP 200. Owned synthetic database
**orbyn_docs_788161e_native_test** shows doc f7772b29-d592-47bb-a78c-786f9458b290
version 2 and paragraph persisted. An older mounted/reopened view displayed
184 words; after Device→Shake→Expo Reload and opening the fixture from Home,
UI displays paragraph and 190 words/Saved 4 min ago. This proves typed native
persistence across reload, not every navigation/cache case. Investigate older
mounted view behavior before declaring all editing flows complete.

Screenshot `/tmp/orbyn-docs-514679f-native-persisted-paragraph.png`. Contents
menu opens and visually renders First section, Result and unrelated heading.
AX returns no app contents while this nested sheet is open; coordinate click
on visible Result failed **noWindowsAvailable**. No blind retry, no heading
navigation claim. Simulator remains on Contents. Native iOS Docs typing/save,
fold/unfold and relative in-app page navigation have partial interaction evidence;
exact anchor navigation, wider native/Android/web/mobile-web and full Docs/UI
contract remain open. Saved browser denial remains respected.

Plugin **9ce1961** read-only merge-tree against main dabb770 succeeded without
conflicts (648e672 tree). Reconcile after privacy main checkpoint before fresh
qualification; preserve its untracked node_modules link. No cleanup/deployment
or full-goal completion occurred.

## Privacy merged; current plugin qualification — 2 October 2026

All CI **36996647235** jobs terminal successful on f79c852. PR **#144** promoted
with exact-head guard and merged **eccf338**. Main fast-forwarded preserving
mobile/app.json and unrelated files; tree equals candidate/CI merge
**a903b6c7158871b05472e3afb54d824290df80fa**. Main ADR record **456e01a** pushed.
Source integrated it in **9992899**: one chronological ADR overlap resolved
retaining both entries; no code difference, no unresolved index entries.

Plugin PR **#142** integrated main456e01a without conflicts, frozen
**d2da6d8c3f5c367237ebc273aca3fceb91f84a47**, pushed. Packages **74947** terminal
zero; push **8321** terminal zero. Full fresh marked test database
**orbyn_plugin_d2da6d8_test**, session **1770** runs. Types/build/format pipeline
**30937** runs; CI **36998159447** runs exact head, mail succeeded last observed.
Logs `/tmp/orbyn-plugin-d2da6d8-{packages,full-tests,types,build,format}.log`.
Resume same handles; do not restart or mutate frozen candidate. Nested backend
node_modules/@orbyn/core resolves candidate core (root untracked node_modules
link resolves main, preserved); package core diff only optional recipient type.
Diff against current main is14files508add24delete, recipient/discovery/consent
contracts and tests/docs. Keep draft while actual consent/host/gateway/UI resource/
event/provider acceptance remains open, even if current combined checks pass.

Native fresh reload **514679f** visibly shows saved synthetic paragraph,190words
and saved timing; persisted paragraph proof screenshot recorded above. Contents
is visually rendered, but AX omits native app while nested Contents sheet is
open and coordinate Result tap still fails noWindowsAvailable. No anchor proof
claimed, Simulator remains on Contents. Source models/settings Docs and whole
app/mobile parity, typed agent ownership/editor/read/effect enforcement, reviewed
source revisions, budgets and receiving handoff dispatch remain substantive
unfinished requirements. Goal remains active; no deployment/cleanup.

## Handoff dependency revision fences — 2 October 2026

Source handoff evidence previously hashed dependency IDs only: editing a cited
doc/task or team after a reviewed request did not change its producer revision.
Added current dependency revision digest, alongside existing current visibility.
Versioned rows use optimistic revision; non-versioned rows use SHA-256 row
content, excluding read/poll timestamps. Source rows are held FOR SHARE through
request/acknowledgement transactions to prevent edits between evidence check and
commit. Digest carries no source content or authority. This is current reviewed
handoff evidence, not original provider-read snapshots or complete source closure.

Corrected baseline **53276** terminal failed four actual new regressions with
missing expected rejection: doc/task revision edits, producer source change before
acknowledgement, and non-versioned team change. First baseline/cohort also exposed
a fixture creating receiving work already done; corrected it to queued→accepted→
done before testing acknowledgement. No production invariant was weakened.

After revision fencing **2373** terminal zero36/36. New concurrent edit lock test
**41250** terminal failed before locking; **5574** terminal zero37/37 afterward.
Final transcript test proves source last_used_at touch is stable but transcript
content edit invalidates evidence. **65765** terminal zero38/38, 4,278 ms. Fresh
marked **orbyn_handoff_revisions_test**, all migrations and **71473** terminal
zero38/38,5,407 ms. Backend types **95334** terminal zero; scoped formatting and
diff check passed. Logs `/tmp/orbyn-handoff-source-revisions-{before-corrected,
after-corrected,locked,final,fresh,types-locked}.log`, lock baseline
`/tmp/orbyn-handoff-source-lock-before.log`. No public handoff dispatch/routes
enabled; receiving identity/rules/connection/budget authorization and actual
round trip/recovery remain required. Do not merge whole source to main.

Plugin d2da6d8 remains frozen; all workspace types/build/full format pipeline
**30937** terminal zero. Full fresh suite **1770** confirmed live, last observed
2038 checks; CI **36998159447** backend in progress. Resume same handles. Actual
web/native consent/host/gateway/UI resource acceptance still open; not delivered
from tests alone. Entire full ADR scope, current main456e01a and character files
remain preserved. No deployment/cleanup or goal completion occurred.

## Current terminal plugin local qualification — 2 October 2026

Handoff source revision checkpoint **d69d087** committed/pushed, unmerged.
Fresh38/38 and backend types/format proof recorded above; no receiving authority
or public dispatch enabled. Continue durable receiving ownership/rules/connection
and budget reservations/round trips, original provider-read source snapshots and
complete whole-app/model/Docs/plugin/mobile acceptance.

Frozen plugin **d2da6d8**, PR142: full **1770** terminal zero **2,155/2,155**,
no failures/skips/cancellations,567,742ms. Fresh database
**orbyn_plugin_d2da6d8_test**. Types/build/full-format **30937** terminal zero.
CI **36998159447** backend **110809519299** remains live; mobile/Docker/mail
successful. Poll that CI; do not restart/mutate current candidate. Actual
web/native consent, host launch, gateway/UI resources/events/provider gates open,
so no plugin main merge claimed. Saved local preview denial remains a required
visual-verification dependency; no bypass. Main remains456e01a with preserved
mobile/app.json and character files. Goal active, no deployment/cleanup.

## Current assistant authority checkpoint — 2 October 2026

Source **118f421** committed/pushed. Constructor formerly returned write/all
teams/Personal regardless of stored grant ceilings. Capability reads did not
reload grant status; write check loaded only current rules. New
currentAssistantPrincipal intersects current owned active grant with the caller:
access, Personal/team scopes, current team role/policy, toolsets, trust/approval
exceptions and outside-content restrictions. Paused/disabled/expired authority
stops callbacks. Read contexts use primary and current scopes; writes hold grant
against mutation. Caller lane/job/readonly restrictions remain server-selected.
Typed read-action rules and complete cache/replay authorization remain open.

Valid baseline **77436** terminal failed four actual regressions: constructor
ceilings, paused read, disabled-owner read and narrowed scope/access. Initial
fixtures had a JSON array parameter serialization error and attempted revoking
the non-revocable built-in grant; corrected to JSON.stringify and disabled owner
without weakening production constraints. **62951** terminal zero37/37 in7,441ms;
extended **12909** terminal zero61/61 in10,890ms (rules/trust/Review/handoff).
Backend types **23735** terminal zero and scoped format/diff passed. Logs
`/tmp/orbyn-assistant-live-scope-{before-valid,after,extended,types}.log`.
Additional current team removal/viewer downgrade and caller ceilings covered.

Extracted cleanly onto main456e01a in reused owned clean worktree
**assistant-work-ownership/Orbyn**, branch **codex/assistant-current-authority**.
Code **d2484b5**, frozen docs candidate **04d1ff710e98956e1059ea41619cda23847405fb**.
Draft PR **#145** created/attached;5files353add51delete versus main. No handoff,
model/Docs/settings source changes accidentally included. Packages **26298**
terminal zero; push **72106** terminal zero; PR creation **84275** terminal zero.
Full fresh marked **orbyn_authority_04d1ff7_test**, handle **41477** live. Workspace
types/build/full-format **11930** live. CI **37000288172** live exacthead04d1ff7.
Logs `/tmp/orbyn-authority-04d1ff7-{full-tests,types,build,format}.log`. Freeze
candidate and resume same handles; promote only terminal local/CI proof and
fresh main/head/merge-tree checks. Keep main mobile/app.json/unrelated artifacts.

Plugin d2da6d8 full2,155/2,155/alltypes/build/format and all CI36998159447 now
terminal green. PR142 remains draft due actual consent/host/gateway/UI-resource/
event/provider gates. Source handoff revisions d69d08738/38 remain unmerged.
Read/external/notification typed policy, original source snapshots, full replay
outcome/source authorization, per-agent ownership/editor, durable receiving
budgets and cross-runtime dispatch/recovery remain required. Preserve full
models/providers/embedding/Docs/Mermaid/whole-app/mobile scope and characters.

Asked user asynchronously to clear saved Browser Use denial at127.0.0.1:5174
(required AGENT.md/ADR web visual verification); response pending. Do not treat
elapsed time as permission or bypass using other endpoints/tools. Native Docs
last verified514679f typing/save across reload, not all navigation/Android/web
gates. Goal active, no deployment/cleanup or completion.

## Cached assistant authority/source result checkpoint — 2 October 2026

Previous turn made authoritative progress: corrected stale handoff map and pushed
f7c4108. This turn re-polled full candidate handle41477 to terminal exit zero:
2,157/2,157,0fail/skip/cancel,556,800ms. Workspace pipeline11930 had already
terminated zero. CI37000288172 backend was confirmed live at11:30UTC; other
jobs successful. Frozen04d1ff7/current test mergea94a7c4 have identical tree
94774365fcabd2b7d331d35a3d110880dce5a641; parents456e01a/04d1ff7. No merge yet.

Source replay tests19355 terminal failed four actual authority regressions;
1178 terminal zero44/44 after digest binding. Producing-source baseline61990
terminal failed three regressions (project excluded, source deleted, unknown/
deleted job). After job/container/current-source checks45875 terminal zero70/70.
Final trust/name/order/job/flags cohort3560 terminal zero72/72,12,873ms; backend
types/format/diff89271 terminal zero. Fresh markedorbyn_replay_authority_test
had all migrations applied. Logs /tmp/orbyn-replay-authority-{before,after,final,
types-final}.log and /tmp/orbyn-replay-sources-{before,after}.log.

Cache authority is a content-free effective permission digest, not new rights.
Legacy assistant cache is held rather than rerun; ordinary connector replay stays
unchanged. Job-bound replay rechecks owned container, runtime lane and strict
current recorded dependencies. Remaining: cached target visibility and effective
grant-scoped dependency closure, original provider-read source version binding,
concurrent source fencing and all target-family replay tests. Do not promote this
source as complete replay security. No public rule editor/dispatch enabled.

Network observation for gh run view and PR145 body update currently uses handles
27877 and17892; observation timeouts are not terminal. Resume the same handles.
PR145 current combined full proof is terminal; CI still requires terminal proof
and fresh base/head/tree checks before promotion. Saved web preview denial still
pending user clearance, no bypass. Native partial Docs proof does not satisfy all
UI gates. Full ADR model/provider/plugin/Docs/Mermaid/whole-app/mobile/agent
scope remains active; no cleanup, deployment or completion.

## Current main promotion and source reconciliation — 2 October 2026

PR145 ready/merge50237 terminal zero, MERGED3450e874412dcdaec852610f2a2dd718d9dec0dd.
Every CI37000288172 job terminal successful; backend110816193464 completed11:32:50UTC.
CI log /tmp/orbyn-authority-04d1ff7-ci-backend.log proves checkouta94a7c4 and
2,156 passes/one Tesseract skip/zero failures. Frozen candidate/CI merge/resulting
main tree94774365fcabd2b7d331d35a3d110880dce5a641 identical. Main11263 terminal
zero ff-only preserved mobile/app.json/unrelated files. ADR/review docs7c08aa6
committed and push30109 terminal zero. PR body63565 terminal zero updated delivery.
Earlier gh observation27877 terminated with a network error; separate authoritative
job/run/pull responses confirmed terminal success, so no CI was restarted.

Replay sourcec237cfb push4408 terminal zero. Reconciled main7c08aa6 asbf8a0ab:
resolved source replay import and chronological ADR append conflicts; retained
both evidence histories. Staged merge changed only two docs82 lines; application
code identical to c237cfb. No unresolved index entries or discarded source/character
changes. Requalification20346 focused terminal zero72/72;41356 backend types
terminal zero. Scoped docs formatting/diff check passed. Logs
/tmp/orbyn-replay-bf8a0ab-{focused,types}.log. Source preview untracked files remain preserved.

Next implement complete cached target authorization across supported refs and
effective grant-scoped dependencies, source revision/read snapshots/concurrency
fences. Current legacy cache holds do not replace that work. Keep C1–C6/M1/D1/U1,
full Docs/provider/plugin/whole-app/mobile/agent acceptance active. Plugin142
all automated proof green but actual consent/host/gateway/UI gates remain open;
Docs138/reflection137 require current-main integration and actual interaction.
Saved web denial pending explicit settings clearance; never bypass. Cleanup only
after integration/qualification. Goal remains active, no deployment.

## Current cached target/source-scope checkpoint — 2 October 2026

Prior goal turn made authoritative progress: PR145 merged3450e87, main docs7c08aa6
pushed; replay sourcec237cfb and reconciled source8ad41a9 pushed. No active local
qualification processes remained at the start of this continuation.

New baseline97175 terminal failed two actual regressions: cached task moved into
AI-excluded project, producing dependency moved into newly joined team outside
earlier caller scope. Optional effective scopes now flow through source/chat/job/
proposal visibility helpers; default owner-wide projections remain unchanged.
Cached target/result-link checks cover all32 produced receipt families, including
synthetic timer/settings/instructions, study key/id forms, drafts, inbox, changes,
imports, bookings and Review. References are bounded and parsed only from typed
targets and structured link fields, never prose or step labels.

Initial79141 failed five job-bound checks from an unused SQL parameter after scope
binding; fixed parameter numbering. Corrected65883 terminal zero13/13. First
all-family diagnostic17534 was deliberately stopped after measured combined-CASE
planning cost (one task took3,327ms), not because an observation timeout expired.
After per-family queries35482 terminal zero16/16,8,040ms (all persistent positive/
foreign-owner pairs6556ms combined; task34ms). Latest75473 terminal zero98/98,
21,300ms covering replay/rules/Review/trust/handoff/notices/visibility and three
additional team/restoration/focus-link cases. Types42573 terminal zero before the
latest three tests; rerun current types before extraction. Logs
/tmp/orbyn-replay-target-{scope-before,scope-after,scope-corrected,families,
families-fast,scope-final,families-fast-types}.log. Do not claim stopped diagnostic
as a passing run. All current source tests use markedorbyn_replay_authority_test.

Next extract only replay/scoped-visibility code and its tests onto main7c08aa6
in the owned clean assistant-work-ownership checkout; retain all source settings,
models/Docs/profile/handoff work. Freeze exact candidate for fresh full tests,
all workspace types/build/format and CI. Preserve current main user files and
character work. Original provider-read snapshots/nested closure/source concurrency
and other persistent cached paths remain required, alongside full ADR model/
provider/plugin/Docs/Mermaid/whole-app/mobile/agent scope. No UI completion or
deployment/cleanup claimed. Saved local preview denial remains respected.

## Frozen replay candidate and new native Docs proof — 2 October 2026

Current source types/format/diff34260 terminal zero. Sourceafd8160 committed and
push99333 terminal zero. Extracted only nine replay/scoped-visibility code/test
files onto current main7c08aa6, in reused owned clean assistant-work-ownership
checkout. Reviewed gate doc gives ten-file candidate0033a969c241425612a27ad5a1d015a0e950eb09,
923add28delete. No unmerged models/settings/Docs/profiles/handoffs copied to main.
Packages75307 terminal zero; push61858 terminal zero. PR146 created41891 terminal
zero and attached: https://github.com/kinqsradiollc/Orbyn/pull/146.

Exact candidate workspace types/root build/full format10871 terminal zero.
Fresh markedorbyn_replay_candidate_test full1849 confirmed LIVE after polling;
last143 tests, not a pass. Logs /tmp/orbyn-replay-0033a96-{types,build,format,
full-tests}.log. CI37003294826 backend110825678798 live; mobile110825678856,
Docker110825678815 and mail110825678519 successful. Freeze candidate; resume SAME
full/CI handles until terminal. Main/head/merge-tree equivalence must be rechecked
before promotion. Do not restart for observation timeout. PR body
/tmp/orbyn-assistant-replay-access-pr.md.

Independent native Docs qualification resumed on verified clean514679f in
assistant-runtime-integration/Orbyn, owned Metro26907:8087 and API30467:8027,
synthetic account only. Raising owned simulator enabled coordinate clicks after
previous noWindowsAvailable errors. Contents Result click visibly navigated to
the exact nested heading and expanded its parent. Then explicitly folded both
parent and unrelated section, reopened Contents, selected Result again: fresh
AX/screenshot proved First section expanded, Result content visible and unrelated
section still folded (Unfold Keep this section folded; unrelated text absent).
One ScreenCaptureKit error after fold did not mean action failure: fresh AX
confirmed fold, no duplicate click. No paste/typeText/clipboard or real credentials
used. Screenshot proof /tmp/orbyn-docs-514679f-native-contents-result.png and
/tmp/orbyn-docs-514679f-native-contents-preserves-fold.png. Existing synthetic
typing/save/reload proof retained. Simulator remains at revealed Result with
unrelated section folded; native handleownedSimulatorPreview/evidenceFs retained.

This closes native iOS Contents nested navigation/fold-preservation only, not
inline fragment links, Android, web/mobile-web or complete D1/U1. Docs138 still
needs current-main reconciliation/qualification and remaining interactions;
do not merge from older automated results. Plugin142 similarly retains actual
host/consent/UI gates. Saved web denial remains pending user settings clearance.
Full models/providers/embeddings/plugin/Docs/Mermaid/whole-app/mobile/agent scope,
original source snapshots/concurrency/nested closure/receiving reservations and
other persisted replay paths remain active. No deployment/cleanup/completion.

## Completed document draft replay follow-up — 2 October 2026

Source d415ee9 clarified the canonical ADR path and preserved the full C1–C6,
M1/D1/U1 acceptance contract. Old devday-2026-plan uncommitted files were inspected
read-only: every product/test file has a tracked source counterpart, some identical
and others different. Only temporary .release-check tools are absent. No cleanup
or wholesale commit occurred.

The completed append_doc draft path bypassed current destination checks under a
new client_ref. Three actual regressions failed: excluded destination project,
deleted saved document and restricted Personal scope. Before39122 terminal1,
20/23 passing, /tmp/orbyn-completed-draft-before.log. Source long-docs now invokes
current producing-job/source and saved-target guards before returning a persisted
result or completed-draft error. Corrected initial63938 terminal0,23/23. A later
53-test invocation silently ignored three nonexistent filenames; count only its
actual matched tests, not the requested file list. Correct full seven-file cohort
37852 passed103/103,0fail/skip/cancel,17178ms,
/tmp/orbyn-completed-draft-cohort-final.log. This includes restoring destination
access and unchanged saved replay with exactly one page. Backend types94390
terminal0, /tmp/orbyn-completed-draft-types.log; scoped formatting/diff passed.
This follow-up stays separate from frozen PR1460033a96.

PR146 full1849 confirmed live at1986 tests; CI37003294826 backend live, other
three jobs successful. Resume SAME handles; require terminal evidence and fresh
base/head/tree equivalence before promotion. Main remains7c08aa6. All broader ADR
gates, nested closure/original source revisions/concurrency and other fast paths
remain open. Saved browser denial is respected; no deployment or cleanup.

PR146 local full1849 subsequently terminated with exit zero:2176/2176,
0fail/skip/cancel,556169ms. Frozen0033a96 and GitHub mergecd57b95 have identical
tree0d1f05994b7ed460131fe2e16ba9d3ad4ce59222; merge parents are unchanged
main7c08aa6 and0033a96. CI37003294826 backend110825678798 remains authoritative
IN_PROGRESS, test step began11:53:36UTC. Watch13854 is live,
/tmp/orbyn-replay-0033a96-ci-watch.log. Do not restart or promote before terminal
CI success and a fresh base/head/tree check. PR body updated with local full proof.

Native Docs continuation used the same owned simulator and clean514679f fixture.
Folding First section succeeded and fresh AX confirmed both it and the unrelated
section folded. Scroll and drag controls failed with noWindowsAvailable, including
after exposed Raise action. Inline fragment interaction therefore remains
unverified. Prior Contents/typing/save proofs remain valid; no paste/typeText/
clipboard used. Simulator is now at the folded page, not revealed Result. This
tool issue does not block backend/source progress or authorize browser bypass.

## Qualified replay merge and current Docs qualification — 2 October 2026

All CI37003294826 jobs succeeded. Backend log44519 terminal0 proves checkout
cd57b95,2,175passes/0fail/1Tesseractskip. Candidate0033a96/CI/mainc9b6c78 trees
match0d1f05994b7ed460131fe2e16ba9d3ad4ce59222. Ready/merge88424 terminal0 with
exact --match-head-commit; PR146 MERGED12:06:25UTC. Mainff37436 terminal0 preserved
user files. ADR/review checkpointe1d46af pushed84251 terminal0. PR body33026
terminal0 updated merged state. No deployment/cleanup.

Completed-draft candidate53089fd contains only two backend files and one review
gate on current maine1d46af. Pushed35484 terminal0, draft PR147 created18278
terminal0 and attached. Fresh markedorbyn_draft_candidate_test full17430 confirmed
live; workspace types/build/full-format95506 terminal0. CI37004911014 backend
live, other jobs successful. Logs /tmp/orbyn-draft-53089fd-{full-tests,types,build,
format}.log. Exact candidate frozen; resume same process, no timeout restart.

Model source209725e reconciles maine1d46af. Add/add test conflict retained all
five completed-draft regressions; only one blank line changed. ADR conflict
preserved both chronological source and qualified-main records. No application
implementation was lost. Source push57569 terminal0. Untracked preview files
remain preserved; old plan dirty work remains untouched.

Docs PR138 now clean93ad2e2 on maine1d46af; merge had no conflicts. Push43745
terminal0. Package build,23 focused navigation/fragment/render tests, all workspace
types/root build/full-format82301 terminal0. Logs /tmp/orbyn-docs-93ad2e2-{packages,
focused,types,build,format}.log. Fresh markedorbyn_docs_current_test full86001
started and remains to qualify; CI37005022002 live. No promotion until terminal
combined gates and required browser/native interactions. Do not reuse older
514679f full result to qualify93ad2e2.

Native same-page inline fragment is now proven: Back then visible Docs library
entry reopened at top, both sections folded; screenshot-grounded Jump to result
tap expanded First section, revealed/scrolled to Result and preserved unrelated
fold. Fresh AX and screenshot agree. Owned Metro26907 cwd confirms current Docs
checkout; no paste/typeText/clipboard. Evidence committed under
docs/reviews/evidence/docs-navigation/native-inline-fragment.png. Current simulator
is at revealed Result. This closes that iOS interaction, not web/mobile-web,
Android, cross-page/stale races or all D1/U1. Full ADR remains active.

## Native Mermaid runtime fixes — 2 October 2026

Real native engine output rejected every static diagram because Mermaid emits
two stock CSS keyframes. The renderer removes only exact inert stock bodies;
all unknown at-rules, CSS escapes and external resource requests still fail closed.
Measured viewport width now fits diagrams initially; Fit resets relative zoom.
Native SVG export uses initial-graph Expo dependencies because linked-worktree
deferred imports failed. Corrected before-fix tests reproduced these failures.
Combined runtime/download cohort92583 terminated zero:25/25, no failures/skips;
mobile/backend types passed. Native flowchart, sequence fit/zoom/refit/source
and 23 KB SVG system share-sheet handoff verified on source Metro8088/API8028.
Evidence: docs/reviews/evidence/mermaid-native/. No recipient/save action selected.
Native dismissal failed noWindowsAvailable. Other families/platforms/themes and
full D1/U1 remain open. Preview helpers and old plan dirt preserved.

PR147 merged4bbcfec from53089fd: full2181/2181, types/build/full-format and
CI37004911014 passed, candidate/CI/main treeab575239dd8e10fab7a52d32946a75a1229ab95f.
Docs CI37005022002 now all successful on93ad2e2; local full2184/2184 passed.
Reconcile current main and requalify before Docs promotion; UI gates remain open.

Native controls recovered by rebinding Simulator and invoking exposed Cancel;
share sheet dismissed without choosing a recipient. State fixture exposed missing
24px renderer host padding; before-fix assertion failed, fixed height shows full
final node. ER fixture exposed pale attribute rows in dark mode. Actual Mermaid
unified ER uses rowOdd/rowEven (not legacy attributeBackgroundColor keys);
pinning these to validated Orbyn surfaces fixes visible string/title contrast.
Final combined cohort10310 terminal zero:26/26; mobile/backend types passed.
State/ER screenshots added. Remaining six families, themes/platforms and full
Docs/UI acceptance remain open. Main documentation checkpointc30c5fc pushed.

## Current reconciliation handoff — 2 October 2026

Mainc30c5fc pushed records fully qualified PR147. Source41aa5cb pushed, preserving
only two unrelated untracked settings preview helpers. Mermaid fixesdc5a2c8 and
current-main reconciliation7026041 committed; canonical ADR records actual native
proof and remaining gates. Old plan dirt untouched.

Docs branch nowd4ad16c reconciles orig/mainc30c5fc without conflicts. Exactly16
Docs/navigation/render files differ from main; no unrelated feature code. Focused
cohort passed23/23 (/tmp/orbyn-docs-d4ad16c-focused.log). Workspace typechecks and
subsequent branch push23618 terminated zero; d4ad16c is pushed. Combined full
qualification and required UI checks remain outstanding. Previous93ad2e2 full2184/2184 and
CI37005022002 success do not qualify changed d4ad16c. Native simulator currently
shows corrected ER fixture; controlledsource Metro8088/API8028 continue. Saved
browser denial still unresolved; do not bypass it. Full ADR remains active.

## Mermaid appearance and screenshot gate continuation — 2 October 2026

User reported Mermaid looks bad and requires screenshots for every web/desktop/
mobile redesign, checking overlap and containment. ADR now records this mandatory
gate. All ten iOS fixture families actually rendered; pie/Gantt/journey/mindmap
exposed real visual defects. Shared mermaidThemeVariables/mermaidDiagramCss and
visibleDiagramTicks are consumed by both desktop RichBlocks and mobile renderer.
Native proof shows corrected pie colors/Gantt dates/Morning journey heading.
Mindmap nodes now use palette/outline, but root label alignment and faint links
remain defective; fitted timeline/journey text too small. Do not call Mermaid
visually complete. Screenshots/provenance under evidence/mermaid-native.

Before-fix DOMRect regression failed because geometry getters are non-enumerable;
explicit coordinate reads fixed thinning. Family cohort20472 passed29/29 with
all workspace types. Duplicate mock injection removed afterwards and additional
CSS assertion added; final cohort65938 terminated zero:29/29, all workspace
types and diff check passed. Native preview
currently at mindmap, synthetic owner; unset-provider dev toast dismissed,
composer was not edited/submitted by this work. Browser denial remains unresolved.
Current mainc30c5fc, Docsd4ad16c pushed/types23focused passed but combined full/UI
gates outstanding. No deployment/cleanup. Full ADR active.

## Mindmap centering checkpoint — 2 October 2026

After the user-requested ADR status report, resumed the current Mermaid work.
Measured SVG bounds now center circular mindmap labels in both renderers;
connector styling uses validated palette tokens and narrow mobile canvases are
horizontally centered. Actual native screenshot mindmap-centered.png confirms
contained nodes, readable labels and connectors, and non-overlapping controls.

Pipeline89402 terminated zero: focused cohort30/30 and all workspace types.
These fixes remain source-branch work until checkpoint qualification; no main
merge or deployment is claimed. Whole ADR remains incomplete and active.
Free disk space is approximately747MiB; avoid large builds while constrained.

## Actual-size viewing continuation

Shared diagramDisplayScale supports fitted and natural-size viewing. Mobile now
exposes Actual size; desktop gains Source, zoom, Fit, Actual size and adjusted
SVG export controls with a wrapping toolbar and bounded scrolling viewport.
Native timeline-actual-size.png shows readable natural-size labels;
timeline-fit-restored.png proves Fit restores full diagram containment.
Horizontal pan attempts did not establish movement; this acceptance gate stays
open, alongside desktop/web visual checks. Do not promote this checkpoint yet.
Workspace typechecks completed zero. Final focused cohort passed32/32 with
zero failures, skips or cancellations, including the actual-size/Fit message
handler regression. Full ADR remains incomplete.

## Accessible pan verification — 2 October 2026

Both clients now offer named directional pan controls for actual-size or enlarged
diagrams. The isolated mobile renderer accepts pan only from its trusted host,
for the successfully rendered ID, with finite steps clamped to160px. It does not
re-render the diagram for movement. Desktop uses its bounded canvas scroll API.

Actual iOS interaction revealed October, reversed to September, and reset to
the full contained timeline with Fit; screenshots timeline-pan-october.png,
timeline-pan-reverse.png and timeline-pan-fit-reset.png record those results.
Controls wrap and remain outside the scrollable image. This establishes native
button navigation; it does not establish gesture, Android or browser acceptance.

Pipeline31971 terminated zero:33/33 focused Mermaid/runtime/download tests and
all workspace typechecks. Saved browser denial remains respected. Do not merge
the UI checkpoint until web/desktop visual gates and combined qualification pass.
Main remainsc30c5fc; full ADR remains active and incomplete.

## Plugin current-main qualification continuation — 2 October 2026

Plugin brancha74ad26 reconciles mainc30c5fc without conflicts, pushed to draft
PR142. Added opt-in Compose plugin profile, separate compiled process with
blank recipient and loopback publication default8040. Default Compose excludes
it; synthetic-config validation of the enabled profile succeeds. Focused41/41,
all workspace types/build/full formatting passed. Full suite remains live in
unified session47503, log /tmp/orbyn-plugin-profile-full-tests.log, using
marked orbyn_plugin_current_test. Do not restart or modify the frozen candidate.
CI37012184719: mobile/docker/mail passed; backend-and-web pending last observed.

Independent compiled-process HTTP proof used owned port8030 and separate marked
orbyn_plugin_runtime_test. Health200, public configured discovery/CORS200 with
spoofed host ignored, missing/cookie/invalid auth401 with plugin challenge,
browser/API/MCP paths404. Synthetic read grant connection/catalog/get_context200,
read-only catalog, revocation401. Synthetic owner/client removed; only the owned
node PID95267 received TERM. Evidence: evidence/plugin-profile-runtime.txt.
No OAuth browser consent, external host, gateway exposure or production enablement
is claimed; full ADR and UI gates remain incomplete.

## Plugin gates and native settings continuation — 2 October 2026

Frozen plugina74ad26 pipeline47503 terminated zero:2186/2186 full tests, no
failures/skips/cancellations,558414ms. Types/build/full-format gates also passed.
CI37012184719 backend-and-web still pending; mobile/docker/mail passed. Browser
consent/host/production delivery gates remain open; PR142 is still draft.

Native settings inspection found models below account deletion and API
connections under Planning. Moved these into a dedicated Connections group;
search identity/destinations retained. Actual models search still opens and
scrolls to the intended section with readable wrapped text and no overlapping
controls. Native typecheck56675 passed. Screenshots/provenance in
evidence/settings-native. No real ChatGPT account/catalog/inference is claimed.

User renewed computer-use authorization. Exact web preview5174 attempt was
still rejected by the saved Block/Deny preference; no bypass attempted. Asked
for saved setting change. Follow-up answer did not establish a setting change;
asked whether changed to Allow, pending. Native work continues independently.
Full ADR remains active/incomplete, main remainsc30c5fc, no cleanup/deployment.

## Embedding readiness and permission enforcement — 2 October 2026

Both SemanticSetup clients now describe actual missing prerequisites: database
measurements unavailable, measuring service offline, and select an embedding
provider. Ready-state language is shown only when the corresponding prerequisite
holds. Authorization, consent and activation gating are unchanged.

The regression suite renders the actual web and mobile components. Before the
fix, the two new missing-state cases failed; after the fix, all12 cases passed.
Desktop and mobile typechecks passed. Native Admin AI accessibility inspection
confirms the missing-state text and disabled activation. The card screenshot
remains pending: Simulator capture failed with ScreenCaptureKit audio/video
stream failure after a touch-scroll attempt. Do not infer visual acceptance from
the accessibility tree or component tests.

Plugin CI37012184719 is now completed/success for exact heada74ad26, verified
through GitHub. Its full local2186-test qualification remains recorded above.
Browser consent and external-host routing still need qualification; PR142
remains draft.

The user supplied a settings screenshot showing Always allow for preview5174
and restarted Codex. Binding that exact URL after restart still receives a saved
permission denial. No alternate port, browser, raw CDP or indirect access was
used. Browser screenshots remain pending. Continue independent native/backend
work; the full ADR remains active and incomplete.

## Profile account refresh fence — 2 October 2026

Shared AssistantProfileStore previously coalesced a refresh after account change
with the previous account's pending request. Its response fence eventually
cleared the evidence, but no current-account request began at refresh time.
The store now tracks its session binding and resets before request coalescing
when that binding changes. This immediately clears previous evidence, aborts
the old request and starts the current read. Late old responses remain fenced.
Both clients use this store. This does not replace their session lifecycle reset
or prove immediate UI removal before any refresh/lifecycle event.

A regression reproduced the old promise reuse, then passed after the fix.
Pipeline9925 exited zero: package builds,4/4 profile store/client tests,
desktop/mobile typechecks, focused formatting and diff check. Logs are
/tmp/orbyn-profile-account-before.log and /tmp/orbyn-profile-account-after.log.
Actual cross-client account switching and profile visual acceptance remain open.
The user's renewed request to use native Chrome cannot override the browser
tool's explicit prohibition on alternate surfaces for this blocked preview.
No workaround was attempted. Continue the full ADR; this checkpoint is not a
claim that receiving dispatch, budgets, runtime health or collaboration is done.

## Full source qualification and Home continuation — 3 October 2026

Frozen source b17d4c8 completed full local qualification in session70681:
2329/2329 tests passed, zero failed/skipped/cancelled,612415ms, terminal exit0.
All workspace typechecks and production builds passed. Tracked-file formatting
passed; the broad workspace command flags only the preserved untracked
desktop/src/settings-connection-preview.tsx helper. This qualification applies
to b17d4c8 before the following Home changes, not to later source heads.
New isolated marked database: orbyn_b17d4c8_qualification_test, on the separate
test PostgreSQL container. Logs /tmp/orbyn-b17d4c8-*.log.

Draft PR148 contains the accumulated model/Docs/profile integration candidate,
attached to this chat. Its exact b17d4c8 head was mergeable with GitHub main
c30c5fc. CI mail/mobile/docker passed; backend-and-web was still running last
observed. Full ADR remains incomplete and this PR remains draft.

User now explicitly authorizes code-based web redesign without local browser
inspection, with visual validation on their test server. No browser restriction
is bypassed. The Home addition covers BOTH public landing and signed-in Home:
all eight canonical character presets, responsive landing companion gallery,
distinct Background/Overnight descriptions, accurate delegated-change copy,
and a collapsible read-only gallery on signed-in web and native Home.
Saved appearance/hidden preference is respected; browsing does not save settings.
Character rendering now supports the existing production server prerender.
Mounted galleries subscribe to saved character changes and fence late initial
loads after a newer edit or unmount. Focused tests and current-head qualification
are separate from the b17d4c8 full-suite result above.
Home pipeline80065 exited zero: all workspace typechecks, desktop production
build and generated-HTML assertion for all eight presets and both runtime
sections. Focused Home/character pipeline84863 passed13/13 with no skips.
Logs /tmp/orbyn-home-companions-*.log. This is a first Home increment, not
whole-dashboard redesign, screenshots or completed application-wide acceptance.

Restart stopped previews and cleared the old in-memory test database. Restored
web5174(session35626), synthetic source API8028(session12609), and Metro8088
(session82255, IPv4 loopback; previous IPv6-only owned Metro was terminated).
Native source fixture uses separate marked orbyn_native_recovery_20261002_test.
It is signed into the synthetic native-models account and waits at terms version
2026-10-01. Explicit confirmation request remains pending; do not accept it
without the user's answer. Native visual acceptance remains open.
The old implementation worktree remains preserved: all changed source files
have counterparts in this candidate, but differing files still need individual
reconciliation before cleanup. No cleanup, main merge, deployment or release.

3 October Home follow-up: researched Muse design and official Dots docs; replaced
public agent marketing cards with two editorial responsibility/example rows.
Both signed-in Home clients describe task results and morning review, and expose
the existing real agent profiles via an explicit action. No fabricated activity,
reflection completion or computer/voice product capability is introduced.
Public-only checkpoint worktree assistant-work-ownership is now on
codex/home-landing-checkpoint, based on main c30c5fc. Its independent qualification is in progress;
no main merge or production deployment has occurred at this note’s creation.

Current Home qualification: 17/17 focused Home/character tests pass; all workspace
typechecks, desktop production build/prerender, tracked changed-file formatting
and git diff --check pass. Public-only main-based checkpoint also passes all
workspace types, full production build, seven character tests, and generated
HTML assertions for all eight presets, both agents, labeled examples and unique
SVG/element IDs. No local web screenshots or native acceptance is claimed.

3 October D1 frontmatter checkpoint: closed initial YAML metadata is preserved
as one literal source block, including delimiters, blank lines, BOM, tags and
anchor-like text; it is never evaluated. Both client code views identify it as
YAML frontmatter and use bundled syntax coloring. A moved or malformed edited
block exports as a safe fence. Leading thematic rules serialize unambiguously,
and legacy anchored rules remain rules. Markdown and HTML export regressions
cover source retention and script escaping. This does not complete reference
links, synchronized source/preview, D1 export coverage or whole-app U1. Native
visual acceptance remains pending, with the explicit terms confirmation gate.

Frontmatter focused evidence: five initial tests failed before implementation;
first combined run exposed an existing anchored thematic-rule ambiguity (33/34).
After correction, final Markdown/inline/frontmatter cohort passes 36/36, including
seven frontmatter regressions, HTML script escaping and existing 400 seeded
anchored round-trip fixtures. Final all-workspace typechecks, production build,
changed-file formatting and diff checks pass. Logs /tmp/orbyn-frontmatter-final-*.log.
A separate marked orbyn_frontmatter_20261003_test database is prepared for the
current frozen source full suite. Its result must be recorded separately when
terminal; do not reuse the earlier 2329-test proof for this new head.

## Current follow-up — 3 October, reference links

Source candidate is frozen at 22e5596 on codex/devday-model-catalog. The previous
6a48853 full suite terminated: 2345/2346 passed, one failure in the font-scale
check caused by the Home clamp heading. No skipped/cancelled tests,580004ms.
22e5596 copies the independently tested public Home type-scale correction; its
focused style/Markdown checks passed and full suite session11430 is running.
Log /tmp/orbyn-source-22e5596-full-tests.log, marked test database remains
orbyn_frontmatter_20261003_test. Do not mutate this frozen source during the suite.

Public Home PR149 head caa1979 fixes the same heading with36px wide/24px narrow.
Style/character17/17 and desktop build pass; new CI must pass before merging.
Earlier73087df CI failed only the font-scale check. Main remains c30c5fc at the
last confirmed check. No merge/deployment is claimed.

Reused the clean, already integrated character checkout at
/Users/anhdang/.codex/worktrees/character/Orbyn for codex/docs-reference-links,
based on6a48853 with the same type-scale fix as175d696. Original codex/character
e4370a3 remains preserved. This branch has UNCOMMITTED reference-link work:
core parser/collector/export, actual inline renderer tests, both client contexts
and editor/embedded-page integration. Read-only definitions stay source, safe
full/collapsed/shortcut links resolve in page context, literals/unsafe URLs are
rejected, first duplicate wins, external publication filters are reused.
55 focused style/Markdown/render tests passed, both actual inline renderers
follow reference heading targets. All workspace types/production build passed
before the test-only renderer fixture additions; the local missing WebView
package was restored using the existing dependency symlink, no install/lock edit.
Logs /tmp/orbyn-reference-{combined-tests,final-types,final-build}.log.

DO NOT COMMIT/SHIP REFERENCE WORK YET: the investigation found existing
objectRefsIn/redactLine/redactValue and keepLinkLabels recognize only inline
object links. Document reference definitions can point to orbyn objects, but
references need page-scoped target collection, private label redaction, correct
selection offsets and save restoration without cross-document reference leakage.
Next action is privacy regressions against actual document read/save/publication
paths, then extend these helpers/backend indexes as needed. Preserve full D1
scope; do not replace this with external-only reference support. Native terms
confirmation and visual acceptance remain pending. Full ADR remains incomplete.

## Latest authoritative state — 3 October reference privacy

Public Home PR149 is MERGED as main ad90e4b; all four exact-head caa1979 CI jobs
passed. Local main fast-forward preserved user mobile/app.json/untracked files.
Source full 22e5596 is terminal PASS2346/2346, no fail/skip/cancel,572686ms,
session11430, /tmp/orbyn-source-22e5596-full-tests.log. All four CI jobs on22e5596
also passed. Source reconciled with main as2099f1c: only ADR text had a conflict,
resolved by preserving all sections; git diff22e5596 is empty (identical full tree).
Source remains draft PR148, no broader ADR completion or deployment claimed.

Reference work remains UNCOMMITTED in character checkout oncodex/docs-reference-links.
Private reference definitions/keys/tooltips and display labels are now neutralized
per structured document, and save restoration recovers original reference syntax
without losing unrelated edits. Object target extraction sees reference definitions;
quote-label lookup sees every reference label; comment source/shown offset mapping
shares the exact projection. Line-level proposals take their originating block ID.
Both clients' actual reference-to-heading renderers are tested. Current pure
privacy/link/Markdown cohort33/33; separate range/proposal/renderer cohort20/20.
Real read/export/save/comment integration19/19 passed on isolated marked
orbyn_references_20261003_test, log/tmp/orbyn-reference-privacy-integration-2.log.
Initial integration fixture used text instead of body oncomments and was corrected.
All workspace typechecks passed before the final linear-time span-lookup change;
rerun types/build/focused checks before committing. Do not claim current full suite.

STILL REQUIRED BEFORE REFERENCE CHECKPOINT: current SQL object_links index only
recognizes inline links; add regression/migration or a shared writer path for
reference definitions and actual usage, preserving literal-code/math exclusions
and first-definition semantics. Inspect task conversion and Linked here/unlinked
mentions contexts so original reference labels cannot leak outside document reads.
More precise standalone-string/context projection and publication/search/history
coverage may be needed. Complete real save/revision/concurrent/privacy cases and
qualified main-based checkpoint/fullsuite, then native interaction acceptance.
Native terms confirmation is still pending; do not accept or seed around it.
Whole M1/D1/U1/C1–C6 ADR remains active and incomplete, no cleanup/release/deploy.

Derived reference follow-up: task conversion now resolves authorized display text
from the complete source document and produces Review Private page for a private
reference. The actual read/export/save/comment/task integration cohort passes20/20,
no skipped tests, /tmp/orbyn-reference-derived-integration.log. All workspace types
passed in terminal57676 (/tmp/orbyn-reference-derived-types.log). Linked here now
loads source document definitions per page, redacts before clipping a source block,
and uses its own page context instead of borrowing another page’s reference map.
Final sourceText clipping change still needs typecheck/focused proof. SQL incoming
link indexing still needs a regression and migration/shared projection; source
references remain uncommitted pending that proof and full qualification. No native
acceptance, overall ADR completion or new main merge is claimed for reference work.

Home follow-up: public copy-only checkpoint235444b pushed in PR150. Concrete hero
and agent review destinations replace vague slogans; Muse and Dots primary
sources re-read. Build/prerender, seven character tests, unique anchors and
scoped format passed. Signed-in web/native copy aligned in source29ca729,
pushed to draft PR148; ten actual component tests and both client types pass.
Neither checkpoint establishes visual acceptance or full ADR completion.

Reference index: migration214 initially failed PostgreSQL regex repetition limit
on999; changed unlimited regex matching plus explicit999-character guards.
Actual privacy/index API cohort now21/21 passes, no skips,
/tmp/orbyn-reference-index-integration-2.log. Migration and reference source
remain uncommitted pending SQL parity/security review and full qualification.

Reference historical privacy follow-up: a new real comments API regression
proved private tooltip titles leaked after their definition was removed. Core
collects all three quoted title forms and the backend selects reference
definitions/actual usage from each historical page independently. Initial API
cohort22/23 failed this regression; fixed cohort23/23 passes with no skips in
/tmp/orbyn-reference-history-api-tests.log. Database/parser literal and long-label
parity is included. Focused reference/actual-renderer16/16 passes. Current all
workspace types and production build passed (qualified-types/build logs).
Full suite is confirmed running in session83262,
/tmp/orbyn-reference-full-tests.log; await its terminal result. Scope remains
full ADR, not completed by these cohorts. Reference checkpoint can be committed
as a candidate; main delivery still requires qualified isolation/reconciliation,
CI and the relevant runtime/visual acceptance. No native consent was accepted.

Reference checkpoint23228c3 is committed/pushed. Its baseline full suite remains
live in83262; never claim terminal success from progress. A separate bounded
SQL profile found a valid9.6KB unmatched-backtick line took17754ms in the old
scanner (plain10KB183ms). Character-array scanning in a temporary function
reduced these to146ms and9ms; eleven literal/Unicode/large fixtures match the
old output. Latest migration214 adds that scanner and no-definition/no-bracket
fast exits. Fresh isolated marked database
orbyn_references_optimized_20261003_test applies the migration from scratch and
passes23/23 API privacy/index tests plus two query-budget regressions (no skips).
Logs/tmp/orbyn-reference-optimized-api-tests-2.log and
/tmp/orbyn-reference-performance-tests.log. Initial fresh DB lacked its safety
marker; it was marked only because this task created it explicitly for tests.
The baseline full suite does not qualify this later SQL optimization; exact-head
CI/full qualification remains required. Do not merge the larger inherited ADR
candidate solely because a reference-link cohort passes.

Latest baseline qualification: session83262 is terminalFAIL2364/2366, no skips,
582927ms. Failures: calendar-wiring newly registered token was classified as
invalid API key; estimates three-day horizon did not have enough working time
around the weekend. Reference-specific tests passed, but full success is NOT
claimed. Estimate fixture now uses7 days and focused3/3 passes; committed
13e7e8a on Home PR150, cherry-picked9398f40 on source and5a058be on reference.
PR151 is attached draft stacked on PR148; latest5a058be CI37029825552 is live.

Separate main-based authentication checkpoint2c4e4d4 on
codex/session-token-namespace in the assistant-work-ownership checkout is pushed
as attached PR152. New sessions use os_ plus unchanged48 random bytes so their
leading bytes cannot collide with credential namespaces. Ordinary legacy
unprefixed sessions retain hash authentication; fake API/agent tokens rejected.
Main-based session/calendar/email verification20/20 and API/passkey13/13 pass,
no skips; backend types/format pass. Current PR152 CI is pending before merge.
The original Home branch13e7e8a remains on remote in PR150, fresh CI pending.
Main remainsad90e4b; no merge/release/deployment this turn. No source branches
were discarded; reference/source reconciled without conflict. The overall ADR
remains incomplete. This handoff update is uncommitted while exact-head CI runs.

Source/preview continuation: reused reference checkout on new branch
codex/docs-source-preview at5a058be, preserving the reference branch and its
CI. Uncommitted core doc-source.ts exports exact serializer-based block/source
ranges and caret lookup; handles stable anchors, multiline Mermaid/math, YAML,
Unicode, numbered lists, blank blocks and separators without mutating content.
Three new mapping unit tests and package build pass. Next: integrate desktop
source/rendered layout and native toggle using the same editor revision/save
state; wire caret/block navigation and scroll mapping; add actual component
coverage and screenshot/interaction acceptance. Foundation is NOT D1 completion.
Home13e7e8a CI37029683489 remains live with three successful jobs and backend
full tests pending. Session PR152 also needs the known full-week estimate
fixture cherry-pick so its main-based full CI can qualify deterministically.
Do not forget qualified main checkpoints once CI is green.

Source/preview UI increment: desktop DocSourcePreview uses a focus-contained
native dialog with responsive source/rendered columns, live parent blocks,
read-only source and mapped caret/block selection. Escape closes only this
view and restores the opener. Mobile uses the shared Sheet and a source/preview
toggle; selecting source opens the corresponding rendered block. Opening it
flushes the current native line through existing syncDraft, never a second
save path. This is inspection, not a raw-source editing implementation.
Seven mapping/actual component tests pass; both clients' typechecks and the
production desktop build pass. No web screenshot or native interaction
acceptance is claimed. Full automatic scroll synchronization, source editing
semantics and source/preview external/heading-link interactions still need
qualification; D1 and whole U1 remain incomplete.

Home13e7e8a CI37029683489 failed agent-writes.test.ts's plan_schedule fixture:
its UPDATE planner_prefs affected zero rows for a new user, leaving weekday
capacity in effect. Fixture now INSERTs/UPSERTs the intended all-week hours.
Focused agent-write13/13 passes. Committed03d7cbc on session PR152,
1eebf04 on Home PR150,195db39 on source PR148,5b6d9e9 on reference PR151,
ad658be on preview branch. All source reconciliation was conflict-free.
Remote reference pushes were transiently rejected twice; retry succeeded and
latest remote5b6d9e9 must be inspected for new CI. Earlier5a058be CI also failed;
read its failure log/tmp/orbyn-reference-first-ci-failed.log before concluding
this fixture was its only cause. Main remainsad90e4b. No merge/deploy/cleanup.

3 October source/preview follow-up: added shared fractional line/block mapping,
web bidirectional scroll sync using rendered geometry with reciprocal event
fencing, and native scroll-position preservation on source toggle. Added local
heading/stable-block navigation contexts on both surfaces; same-page links keep
the draft and cross-page links close preview before existing app routing.
Focused source/component cohort passes12/12, no skips. Initial navigation tests
used an unsupported /app/docs relative URL; corrected fixtures use supported
orbyn://doc links. The tests also caught missing null guards for unknown headings;
fixed in both clients, with typechecks catching the same defect. VM transpilation
uses ES2022 so Map iteration matches the app runtime.
Current mobile types and desktop typecheck/build pass; all workspace typecheck
prior handle34956 completed successfully before navigation additions. Logs:
/tmp/orbyn-source-sync-navigation-{tests,types,build}.log. No screenshot or
native geometry/interaction acceptance is claimed. Read-only source remains
inspection, with parent-owned draft/save. Source PR153 stays draft.

Main now63f4a13: Home PR150 and exact-head auth PR152 merged after four CI jobs
passed. Public Home editorial PR154 head4e23899 awaits backend CI; three other
jobs pass. Signed-in Home web/mobile shared copy is committed9f0c398 in PR148.
Reference PR151 head5b6d9e9 and prior preview db94738 have all four CI jobs passing,
but inherit larger unqualified scope and must not merge wholesale to main.
Current primary user's dirty files, preview files and original source branches
remain preserved. No deployment or worktree/branch cleanup.

3 October Mermaid desktop security follow-up: found desktop bypassed native's
prepareMermaidSource bounds and directive ban. RichBlocks now uses bounded
rendering, strict locked config, inert labels, max512 edges and bounded output.
Shared preparation also rejects image/icon packs and CSS resource URLs before
rendering on both clients. Source fallback remains intact. Native asset rebuilt
and digest regression passes. Actual desktop effect harness proves rejected
inputs never reach the engine and oversized engine output fails. Cohort23/23
passes; real engine parses all ten families; desktop build/mobile types pass.
Initial harness lacked React global (corrected); actual-engine check initially
could not resolve jsdom, restored only the missing declared dependency symlink
to existing /private/tmp/orbyn-mermaid-parse-check/node_modules/jsdom. No install
or dependency/lockfile change. Logs /tmp/orbyn-mermaid-web-bounds-*.log.

Export investigation: backend docs/routes.ts's HTML export calls docToHtml with
math only. Core export.ts's code case writes all Mermaid blocks as source.
Standalone SVG export exists in both renderers; whole-page rendered HTML/PDF
parity is still open. Next implement an authorized export-snapshot batch diagram
render pipeline using the strict local renderer on both clients, embedding
self-contained inert images and retaining source/error details. Keep backend
visibility projection authoritative, no re-fetch of raw blocks or external
renderer/network calls. A partial source fallback must not close D1. Desktop
SVG resource sanitation, browser/native export and visual acceptance remain open.

Latest main checkpoint: public Home PR154 exact4e23899 passed all four jobs in
CI37034443999 and merged as4e5a3f6. Local main fast-forwarded while preserving
user changes. Current Docs source reconciles main4e5a3f6, including auth/session
namespace and new public Home shared guide. Two append-only ADR/export-list
conflicts were resolved by retaining both sets of sections and exports; no
feature or acceptance requirement was discarded. Re-run combined checks before
relying on earlier candidate qualification. No deployment or cleanup.

3 October HTML export checkpoint: implemented backend-authorized marked HTML
snapshot enrichment using one strict local engine shared as separately bundled
app assets. Inert SVG images, escaped source fallback, 100-diagram/size limits,
queued bridge requests, unique scope IDs, cancellation and persistent batch
engine on web/native. Source/editor save path unchanged. Types/build pass;
37/37 focused export/hook/engine/Mermaid tests, 17/17 API exports, real parse and
render all ten families pass. Engine JSDOM harness now sets zero-valued missing
padding/border geometry; actual offline Chrome also rendered all ten. Stopped
only the owned completed fixture Chrome process61087 after verifying results.
Evidence: docs/reviews/evidence/diagram-html-export.md. No local app screenshot
or native share acceptance claimed. Next: latest unsaved revision/failure guard,
PDF rendered images, server/publication parity, full D1/U1/external model gates.
Home PR155 is still waiting only backend CI; Docker/mobile/mail pass. Preview's
prior9ae961d all four CI jobs pass; qualification does not cover this new export.
Full goal active. No deployment or cleanup of repository branches/worktrees.

Source8e0db8f CI37040583868 stopped at formatting only: generated desktop
Mermaid JSON lives under desktop/src, unlike mobile/assets, and was checked as
handwritten source. Added a narrow .prettierignore entry for that generated
first-party engine. Bundle equality/digest checks still own its integrity;
no runtime change or test exclusion. Full8e0db8f local suite remains live on
session40820; do not restart. Home PR155 passed all four jobs and merged as
main80dff7a; local main fast-forwarded preserving user changes. Source candidate
is not yet reconciled with that main checkpoint. No deploy/cleanup.

- Added shared Background/Overnight timing and pause details to signed-in web and native Home, alongside the existing descriptions and activity entry.
- Home companion/guide tests: 11/11. Desktop and mobile typechecks pass.
- Public Home is being qualified separately on `codex/home-agent-responsibilities`: agents before the catalog/character gallery, concrete supporting copy, research retained in ADR.
- No runtime capability or character identity changes. Web test-server visual review and native screenshot/interaction acceptance remain open; full ADR stays active.

### Export revision fence foundation — 3 October 2026

- Export route accepts an optional positive safe integer document version. After permission filtering, a mismatch returns409 for every format; inaccessible pages remain404 without exposing revision existence. Invalid versions use the existing schema422 response.
- Shared client can pass the expected revision; raw export does not retry a conflict against a newer snapshot. Existing unversioned callers keep their behavior.
- Candidate export integration17/17 and client1/1 pass; all workspace typechecks pass. Disposable marked database name is in /tmp/orbyn-export-version-test-db.txt, distinct from the frozen Docs full-suite database.
- Initial test used PATCH instead of the established PUT document route, then expected400 instead of existing schema422; corrected the fixtures.
- This is foundation only. Next connect both editors' flush to explicit save success/offline failure, use content equality rather than native array identity, capture the version, and supply it on all file/share paths. Do not claim unsaved export correctness until those paths and concurrent typing/failure tests pass.
- Source-preview checkpoint8e0db8f full suite remains running on its unchanged tree. Preserve preview helper files; no cleanup/deploy.

Qualification update: local frozen8e0db8f suite completed2402/2402, no failures,
skips or cancellations,575064ms; session40820 terminal. Later45f012d changes only
formatting exclusion/handoff and a stronger negative window completion test,
which passes4/4. Main80dff7a reconciled as51e9778; one append-only ADR conflict
retained both sections. Export version foundation4f22304 applied asdb28cb3;
resolved append-only ADR/task history and reconstructed both complete export
regressions from their source commits. No conflict markers remain.
Combined source: focused51/51 plus export API18/18; all workspace types and
production builds pass ondb28cb3. Latest signed-in Home guide/timing/pause parity
from verifiedc7d2114 is now in this candidate; web/mobile types pass. Full2402
result predates API/version/Home additions; do not call it a full current-head
pass. Main-isolated optional version checkpoint is nowcodex/docs-export-version;
qualify and merge only after its exact CI passes. Preview45f012d CI may be
superseded by the upcoming reconcile push. Continue editor save-failure and
version capture integration, then PDF/publication/current-source/export/native
and full U1 gates. Full goal remains active; no deployment/cleanup.

### Home refinement after Muse/Dots research — 3 October 2026

- Public Home: separate example request quotation from review destination and pause conditions.
- Signed-in web/desktop/native: compact Background/Overnight summaries, optional “How agents work” guidance, primary activity action and separate character browsing.
- Research and presentation decisions recorded in ADR; reflection/collaboration remain open acceptance gates.
- Home checks13/13 pass. Web test-server visual review and native screenshot/interaction acceptance remain outstanding.
- Docs export save guards are separate uncommitted work; do not stage them with this Home checkpoint. Full ADR remains active; no deployment or cleanup.

# Active implementation handoff — 2 October 2026

## Full user contract

Canonical ADR: `devday-2026-implementation-review.md`. The broad goal is active
and incomplete. Every shipped web/desktop feature is required on mobile.
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

- Main `/Users/anhdang/Documents/Github/Orbyn`: local and remote `324d08e` (latest ADR evidence checkpoint).
  Companion and whole-app ADR updates are published. Main `f875c8d` passed
  2,083/2,083 ordinary tests (zero fail/skip/cancel), workspace types and production
  build. `495a359` fixes CI's missing per-service backend image tags and ADR
  formatting; `8f2e7b3` adds the user's truthful agent availability/profile scope. Main's user-owned
  `mobile/app.json` and unrelated untracked files remain unchanged. Root `task.md`
  belongs to the companion task; do not overwrite it.
- Model/Docs/settings worktree `/Users/anhdang/.codex/worktrees/devday-model-catalog/Orbyn`,
  branch `codex/devday-model-catalog`: main `0749e6e` merged as `aa419b8`; portable
  native abort fix `dda31cd`; final diagram digest `9e0aeb1`. Later commits change
  only ADR/evidence/handoff docs. Own core/API package outputs are isolated.
  Untracked `desktop/settings-connection-preview.html` and
  `desktop/src/settings-connection-preview.tsx` remain preserved. The untracked
  settings review was byte-identical to main and backed up at
  `/tmp/orbyn-preserved-settings-redesign-20261002.md` before installing its tracked
  main version during merge.
- Plugin worktree `devday-plugin-boundary`: preserved `c6f4b03`; recipient
  OAuth/discovery UI still unmerged. Earlier frozen source `e60fb32` full 1,995
  green is scoped to that source. Main has disabled service/auth foundations.

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

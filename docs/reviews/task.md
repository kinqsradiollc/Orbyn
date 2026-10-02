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

- Main `/Users/anhdang/Documents/Github/Orbyn`: local and remote `3677d53`.
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
session 15253 is still live (358 tests passing at the latest check). Poll the
existing handle before repeating work.
Main remains `3677d53`; nothing from PR 137 is merged or deployed.

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

Main native Docs relative links remain source-inspected gaps: raw `/app/...` and
`#section` go to `Linking.openURL`; origin routing/local outline jumps need their
own implementation and actual taps. Main `1a26644` records this gap only.

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

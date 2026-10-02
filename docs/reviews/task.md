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

- Main `/Users/anhdang/Documents/Github/Orbyn`: local and remote `bb78cdf`.
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

## Current runtime work — 2 October, latest

Runtime foundation `69ff2d6` is committed on the model branch, not yet on main.
Migration 206 adds immutable job lane ownership, with four interactive slots and
separate two-slot Background/Overnight consumers. Dedicated service entry points,
Compose/Kubernetes deployment, private readiness, shared status groups and
notifier fallback rejection are wired. Actual worker-process tests prove one
runtime can be killed/recovered while the other continues; idle loops make no
provider calls. Focused 28/28 passed, log `/tmp/orbyn-runtime-focused-tests-3.log`,
marked DB `orbyn_runtime_lanes_206_retry_test`. Separate shared status tests pass,
workspace types pass, Compose config/Kubernetes render and shell syntax pass.

Earlier focused runs failed from two test-fixture assumptions (old claim-token
prefix, a recovery helper accidentally selecting the wrong lane). Those are
corrected. The second failed run was stopped after its failure contaminated later
checkpoint fixtures; it is not a passing result. No product fallback was added.

Main full test log `/tmp/orbyn-main-f875c8d-release-full-tests.log`; types/build
logs `/tmp/orbyn-main-f875c8d-types.log` and `-build.log`. Main CI `36971290485`
for `8f2e7b3` completed successfully in all four jobs, including backend/web. Production auto-deployment is disabled; pushing main
is not production deployment. Do not claim a release or live production version.

Exact-main integration worktree is now
`/Users/anhdang/.codex/worktrees/assistant-runtime-integration/Orbyn`, branch
`codex/assistant-runtime-isolation`, HEAD `e6f6376`. Runtime `fc4a55c`, historical
migration fixture `e1746d0`, separate automation test consumers `bd79124`, and
main reflection ADR are integrated with no unresolved conflicts. The branch is
pushed; draft PR https://github.com/kinqsradiollc/Orbyn/pull/135 is attached. CI
runs on the PR before promotion. Do not merge it until its required checks and
a complete corrected local suite pass.

Initial full suite session 44256 is terminal exit 1: 2,091 tests, 2,083 pass,
eight failures, no skips/cancellations. Marked DB
`orbyn_main_runtime_fc4a55c_test`; log
`/tmp/orbyn-main-runtime-fc4a55c-full-tests.log`. All eight failures were in the
historical schema clone and old automation fixtures, now fixed as below.

The corrected complete suite is LIVE in session **57320**, frozen source
`e6f6376`, fresh marked DB `orbyn_main_runtime_e6f6376_test`, log
`/tmp/orbyn-main-runtime-e6f6376-full-tests.log`. Poll this exact handle/log before
any rerun. Formatting session **65860** finished exit 0; all files pass. Log:
`/tmp/orbyn-main-runtime-e6f6376-format.log`. The integration worktree is clean;
local dependency links were placed inside ignored node_modules directories.
Its diff from the earlier build/typechecked source `fc4a55c` contains tests and
docs only, with identical application/asset source.

PR 135 head `e6f6376` was MERGEABLE with no unresolved Git conflicts. Its CI has
backend/web, mobile and Docker jobs running and mail passed at the latest read.
Recheck exact head and main before merge; do not infer success from this snapshot.

The fixes pass 8/8 notice/migration tests and 49/49 automation/task tests. Logs:
`/tmp/orbyn-runtime-legacy-notice-tests.log`,
`/tmp/orbyn-runtime-automation-tests-2.log`. A test-only child deadline preserves
the original 2-second idea timeout assertion across the process boundary.
The earlier automation run was 48/49 before that fixture fix. Main-based workspace
types, production build and format check passed on application source `fc4a55c`;
logs `/tmp/orbyn-main-runtime-fc4a55c-{types,build,format}.log`. Kustomize and
Compose validate. Root dependencies link to existing installations, and core/API
outputs resolve inside the integration worktree. Its task-owned dependency links are inside ignored node_modules directories.
No npm install was run.

CI run 36971290485 on main `8f2e7b3` completed successfully in all four jobs:
backend/web, mobile exports, Docker live smoke and mail. `bb78cdf` is a subsequent
ADR-only commit for bounded Overnight reflection, pushed to main. Production
auto-deployment remains disabled and no deployment/release was performed.

Newest UI requirement is now canonical: each Daytime/Overnight profile must show
truthful Idle/Ready/Scheduled/Working/Waiting/Paused/Unavailable/Failed state,
last actual job activity, next trigger, recent work and outputs using the existing
companion. Heartbeats are service availability, never last user activity. Both
clients and native surfaces are required. No voice/computer-use features added.
Profiles, collaboration handoffs and whole-app UX remain implementation work.
Overnight reflection is also explicitly required: bounded source-grounded review
of work/outcomes/approvals/undo/failures, saved morning output, no duplicate loops,
reviewed proposed memory/rule changes and authorized handoffs to Daytime. This is
recorded in main `bb78cdf`; reflection execution/UI is not implemented yet.

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

Own QA API session 82920/8027 and Metro 70797/8087 run from combined source.
Synthetic fixture session 53819 is stopped. Only the named QA DB was migrated.
Preserve companion preview servers on 8018/8083. Disk fell to ~1.1 GiB at the latest check; check before
large builds. Runtime PR Docker builds are running in CI. Local generated outputs
are small; do not delete unverified old packages or shared caches. Docker was externally recovered; the user asked to recover it
themselves, so do not restart Docker. No unrelated containers/volumes were deleted.
Only the older task-owned temporary simulator was deleted after ENOSPC.

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
3. Complete runtime PR 135 qualification described above, then integrate ready
   code to main after a fresh fetch and conflict check. The implementation now
   has independent lanes/processes; current main still uses the old mixed runner
   until that PR is promoted. Existing Overnight views prove review UI only.
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

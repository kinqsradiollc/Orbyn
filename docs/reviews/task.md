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
and pushes have general authorization; preserve concurrent ownership and do not
accidentally publish another task's expressly unpublished companion commits.

## Authoritative repositories

- Main `/Users/anhdang/Documents/Github/Orbyn`: local `f875c8d`, remote last verified
  `1a26644`. Companion `2eb34a5`/`0749e6e` is integrated locally but unpublished.
  ADR additions are local main `454e957`, `d4db69d`, `f875c8d`. Main's user-owned
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
Preserve companion preview servers on 8018/8083. Disk last ~3.3 GiB; check before
large builds. Docker was externally recovered; the user asked to recover it
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
3. Implement shared immutable runtime lane ownership, per-lane bounded claims and
   dedicated background/night service entry points, deployment, health, shutdown
   and recovery. Existing `runner.ts` claims every queued job under one global
   eight-slot budget; AI routes and optional notifier fallback share that loop.
   Night jobs carry kind/night_id/source_kind. Existing Overnight views prove
   review UI only. Test separate real worker processes and upgrade/legacy queues.
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

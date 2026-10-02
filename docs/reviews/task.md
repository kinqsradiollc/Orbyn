# Active implementation handoff — 2 October 2026

## Contract

The governing contract is `devday-2026-implementation-review.md`. The user requires
all shipped web/desktop features on mobile too. The broad ADR goal stays active:
agent rules/ownership/activity/budgets, bound/published pages, Slack/Teams, full
Docs Markdown parity, actual ChatGPT execution/composer and cross-client UI gates
are incomplete. Voice/computer-use/speculative Decisions rows remain excluded.
No subagents are authorized. Tests/ready checkpoint commits, main integration and
pushes are authorized. Preserve user changes and all unrelated files.

## Authoritative state

Main is pushed through `1a26644`. A concurrent companion task has since integrated
`2eb34a5` and `0749e6e` into local main; those commits are not pushed and are
not part of this branch's frozen verification. Preserve their ownership and do
not push them accidentally with an unrelated checkpoint. Frozen code `b6096c8`
passed 2,078/2,078 full
backend tests; Docs/mobile export evidence is recorded in the main artifacts.
`mobile/app.json` and unrelated untracked files remain user-owned/uncommitted.
The current model/Docs worktree contains the new cross-client model-management
checkpoint described in `chatgpt-cross-client-model-checkpoint.md`, plus older
unmerged settings, embedding, Docs and native Mermaid checkpoints. Its 69 focused
checks, types, web build and native exports passed; actual UI and full-suite
acceptance remain open. Plugin work stays on its separate preserved worktree;
recipient OAuth/discovery and host/provider acceptance are still unmerged.

## Next actions

1. Source is committed locally as `acc5c59`, followed by inventory corrections
   in `24419a9`. The first full run was 2,097/2,099, not acceptance. The corrections
   passed 37/37 focused checks. Frozen `24419a9` started the fresh full suite
   on the marked `orbyn_plugin_service_20261001_test` database at 127.0.0.1:55434.
   Do not run another DB suite concurrently against that database or edit source.
   Log: `/tmp/orbyn-chatgpt-remote-24419a9-full-tests.log`; session 97567 ended with
   exit 7 during disk exhaustion before terminal TAP totals. This is not a pass.
   The user chose to recover Docker themselves. After recovery the test container
   was healthy; no agent restart was performed. A fresh database
   `orbyn_models_24419a9_full_test` was created and its marker verified. Frozen
   source `24419a9` rerun finished 2,098/2,099, one failure, no skipped tests:
   the generated MCP route count still said 245 exclusions after the new private
   route made 246. Log `/tmp/orbyn-chatgpt-remote-24419a9-recovered-full-tests.log`.
   Commit `6da9ad5` regenerates only those two catalog lines; the generator's four
   tests pass (`/tmp/orbyn-chatgpt-route-catalog-tests.log`). The `6da9ad5` complete rerun in session 46104 was deliberately interrupted
   before source edits when actual native QA found an abort API incompatibility.
   It has no passing terminal totals. Log:
   `/tmp/orbyn-chatgpt-remote-6da9ad5-full-tests.log`. No other DB suite
   may run on this database. Do not restart Docker or touch unrelated containers.
2. Recheck disk first. Space recovered to 7 GiB, then fresh simulator initialization
   reduced it to about 2.8 GiB. Five completed task-owned logs were losslessly gzip
   archived with verified original bytes and pointer stubs. Preserve other files
   and volumes. Production Docker `orbyn-chatgpt-remote:24419a9` built successfully;
   exact compiled smoke passed schema/exclusion and 401/no-store/400 checks.
   Disk subsequently exhausted. Deleting only the task-created simulator recovered
   about 1.6 GiB; all unrelated simulators and worktrees remain preserved.
3. Preserve native/web build logs/hashes and finish actual interaction gates.
   Browser Use still has a saved block for 127.0.0.1:5174; do not bypass it via
   another URL/port, Chrome/native/headless/CDP or fake visual proof. Retry only
   after a meaningful permission change. Native interaction is separately needed.
   Isolated simulator E809F841-E40A-4170-AB55-EEDFFDFA2AA2 was task-owned and has
   now been deleted to recover disk. Its Expo Go
   57 app uses Metro 8087 and API 8027 with a new marked disposable database
   `orbyn_mobile_models_24419a9_test`. Metro's IPv6 bind versus manifest
   address mismatch was resolved with the native packager's hostname setting.
   The authentication screen rendered, but native sign-in/settings behavior is
   unverified: API session 44808 died with ENOSPC, Metro session 11998 is stopped.
   Preserve the synthetic QA database; no real provider credentials were used.
   Preserve character-worktree servers at 8018/8083; do not stop/reuse them as
   this proof. Space recovered to about 8.1 GiB after external recovery. Avoid
   starting another simulator during the full suite; retry native interaction
   after the run finishes and confirm available disk first. Space then recovered
   to 6.5 GiB; a smaller task-owned iPhone SE/iOS 18.5 simulator was created:
   A166A84A-7389-4FAB-9EA8-8EADAD1D54E3. It booted and Expo Go 57 launched. Own API
   8027 (session 40558) and native Metro 8087 (53990) are running. The prior QA DB
   was absent after external recovery, so only that named marked QA database was
   recreated/migrated, with a fresh synthetic account/session. No unrelated DB was
   changed. Current disk is about 4.7 GiB; monitor and stop only task-owned QA if
   disk approaches exhaustion. Do not claim sign-in/settings acceptance yet.
4. Only promote ready scoped code after exact-main tests/build checks. Main has
   concurrent companion source changes, so integrate/retest that dependency only
   after the frozen local suite completes; do not claim the older 2,078-test result
   validates the newer main. The local shared core/API dist bindings are isolated
   from main's package build outputs. The older
   settings redesign controls the web entry point, so review its dependency rather
   than cherry-picking the UI changes without the required source.
5. Continue the retained ADR requirements. Real eligible-account/native auth,
   signed job protocol and composer wiring are not proved by metadata defaults.
   Reconcile per-feature web/mobile entry and acceptance status before release.
6. A10 security evidence is in main `security-scan-status-2026-10-02.md`. The npm
   workspace audit and GitHub warning have different scopes. GitHub scan access
   returned no accessible analysis plus a missing-scope notice; no scope expansion
   was performed. Confirm advisory/runtime prerequisites before choosing upgrades.

Full main log: `/tmp/orbyn-docs-mobile-main-full-tests.log`.
New local logs are listed in the model-management checkpoint artifact.
The independent `24419a9` unit set passed 48/48 without Docker, no skipped tests;
log `/tmp/orbyn-chatgpt-remote-24419a9-unit-tests.log`. The checkpoint now lists
actual web/mobile entry points and explicit native auth/execution parity gaps.
Docs headings/renderer/inline/dialect/Mermaid/mobile download checks passed 61/61,
and real MathML unit checks passed 12/12, with no skips. Logs:
`/tmp/orbyn-mobile-parity-docs-24419a9-unit-tests.log` and
`/tmp/orbyn-mobile-parity-math-24419a9-unit-tests.log`. These are local-source
behavioral checks; actual previews remain open. Main `1a26644` now records the
native relative-link routing acceptance gap; it ships documentation only.

Prepared (not run) `/tmp/orbyn-native-model-fixture-24419a9.mts` creates a strictly
marked/synthetic QA-owner connection with controlled identity verification and
real signed enrollment/lease/catalog service calls, then heartbeats a 65-model
catalog. It makes no provider calls and stores no real provider credentials. Use
only with its named disposable QA database/session; do not infer OAuth proof.

### Current native correction and next verification

Actual native sign-in, Settings search/entry, empty-device discovery, selected
65-model catalog, model-65 search, long-label wrap, save and clear now pass on
the task-owned SE. Native QA found React Native lacks `signal.throwIfAborted`;
shared controller/picker use a portable `signal.aborted` check. Regression proof:
21/23 before (two failures), 43/43 after; all workspace typechecks pass.
DB reads confirmed model-65/version 1 then null/version 2. This remains a
controlled synthetic fixture, not real ChatGPT OAuth or inference proof.

Own Metro is session 51497, API 40558, synthetic fixture 53819. Fixture makes
no provider calls. Keep unrelated 8018/8083 previews intact. Current disk ~3.4 GiB;
monitor before builds. Do not restart Docker: the user handles recovery.
Screenshot `/tmp/orbyn-native-model-clear-default-20261002.png`; logs
`/tmp/orbyn-native-abort-after-fix-tests.log`,
`/tmp/orbyn-native-abort-typecheck.log`. Commit the portable source correction,
freeze it, run the full suite sequentially on the marked full-test DB, then rebuild
exact artifacts when disk permits. Large text/software keyboard/dark/offline native
checks and web permission gate remain open.

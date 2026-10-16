# ADR 006 Document Consistency and Settings — Tester Qualification

- **Current checkpoint candidate:** `6e67e82bf03fa3fdfe6c62ec75ea2d7367ea0bc9`
- **Candidate parent:** `132e3be922a26cfff858a79411b6eb2d5503c555`
- **Original scope baseline:** `b5ee4dd096595d38e25c6e6c17d06fb3c806c999`
- **Checkout:** `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- **Branch:** `codex/document-sync-settings`
- **Phase:** round-1 checkpoint qualification complete; overall freeze reopened for the owner’s right-panel scope
- **Review history:** This is the same ADR 006 round 1/3 as the initial `a926336a` qualification. Do not increment or reset the round. ADR 005's separate 1/3 history is unchanged.

The evidence below is bounded to checkpoint candidate `6e67e82b`. A later owner refinement adds a resizable, responsive right-side workspace panel with independent tabs and moves Notifications and existing object peeks into it. That feature is outside this candidate and remains unqualified. The active branch has since advanced; no claim is made for later dock commits or working-tree changes.

## Round 1 checkpoint retest on `6e67e82b`

Tester made no product or test-source edits. The focused unit batch ran before the later dock work appeared. Package/backend builds, typechecks, and LaTeX runtime checks also completed before those edits. The desktop production build completed after `737a1b3` added only the ADR/tracker scope note and before dock source edits; its product source therefore matched `6e67e82b`. The guarded OAuth/agent run occurred after frontend dock work started, but its backend implementation and test files were unchanged from the checkpoint. It was limited to those backend suites.

### Builds, typechecks and LaTeX runtime

- `npm run build:packages` passed. Log: [`package build`](/private/tmp/orbyn-adr006-packages-6e67e82.log).
- `npm run build -w backend` passed. Log: [`backend build`](/private/tmp/orbyn-adr006-backend-build-6e67e82.log).
- Backend, desktop and mobile typechecks passed. Logs: [`backend types`](/private/tmp/orbyn-adr006-backend-types-6e67e82.log), [`desktop types`](/private/tmp/orbyn-adr006-desktop-types-6e67e82.log), [`mobile types`](/private/tmp/orbyn-adr006-mobile-types-6e67e82.log).
- `npm run build:latex-html` and `npm run check:latex-html` passed; the latter confirmed runtime source provenance and web/mobile parity. Logs: [`runtime build`](/private/tmp/orbyn-adr006-latex-html-build-6e67e82.log) and [`runtime provenance check`](/private/tmp/orbyn-adr006-latex-html-check-6e67e82.log).
- `npm run build -w desktop` passed. Log: [`desktop production build`](/private/tmp/orbyn-adr006-desktop-build-6e67e82.log). Vite emitted its large-chunk advisory; the build and prerender completed successfully.

The preview-affecting builds are complete. No browser fixture was opened or changed. Visual Check was notified to wait for root’s next frozen-candidate dispatch because the overall freeze has reopened.

### Combined focused unit batch

Executed serially with:

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/agent-profile-draft.unit.test.ts \
  backend/tests/connections-sections.unit.test.ts \
  backend/tests/consent-resource-label.unit.test.ts \
  backend/tests/doc-content-operations.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-selection-ask.unit.test.ts \
  backend/tests/doc-source-edit.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/doc-tex-diagnostics.unit.test.ts \
  backend/tests/doc-tex.unit.test.ts \
  backend/tests/document-download.unit.test.ts \
  backend/tests/document-toolbar.unit.test.ts \
  backend/tests/document-workspace.unit.test.ts \
  backend/tests/editor-input-ownership.unit.test.ts \
  backend/tests/latex-html-runtime.unit.test.ts \
  backend/tests/settings-connection-help.unit.test.ts \
  backend/tests/settings-detail-navigation.unit.test.ts \
  backend/tests/settings-modal.unit.test.ts \
  backend/tests/settings-navigation.unit.test.ts \
  backend/tests/settings-grid-layout.unit.test.ts \
  backend/tests/settings-focus-connection.unit.test.ts \
  backend/tests/assistant-settings-navigation.unit.test.ts \
  backend/tests/sidebar-width.unit.test.ts \
  backend/tests/visual-corrections.unit.test.ts \
  backend/tests/workspace-layout.unit.test.ts
```

**Result:** exit 1; **189/190 passed**, 1 failed, 0 cancelled, 0 skipped (22.45 seconds). Mode-0600 TAP log: [`focused unit batch`](/private/tmp/orbyn-adr006-focused-6e67e82.tap).

The failing case is `both responsive workspace navigation controls expose a Settings return target` in `backend/tests/settings-modal.unit.test.ts`. Its source assertion still expects a Topbar button with class `workspace-rail-toggle`; the checkpoint Topbar renders the `mobile-menu` button marked `data-settings-focus-return`, and no `workspace-rail-toggle`. This is an unresolved suite failure and appears to be a stale source-shape assertion, not demonstrated runtime behavior. Tester did not edit or waive it; Settings focus-return acceptance remains pending until the contract/test is reconciled.

The new normalized profile regressions passed for both web and Expo, including successful server-normalized Save, failed Save retaining the draft, stale/unmounted response ownership, and Cancel. The selection, diagnostics, download, toolbar, sidebar and renderer cases in this batch passed.

### Guarded OAuth and agent database suites

Executed `backend/tests/oauth.test.ts` and `backend/tests/agents.test.ts` serially through the private guard helper. Preflight verified the loopback port-55434 `_test` source, target `adr006_oauth_test`, and `orbyn.environment=test`; the target matched the checkpoint's 227 migrations through `267_personal_activity.sql`. Post-run identity, marker and migration state remained unchanged. Connection values were not printed.

**Result:** exit 0; **56/56 passed**, 0 failed, 0 cancelled, 0 skipped (29.47 seconds). Mode-0600 log: [`OAuth and agents`](/private/tmp/orbyn-adr006-oauth-agents-6e67e82.tap).

The recurring live MCP disconnection remains unresolved. These local OAuth and consent tests do not establish the cause or absence of the intermittent production incident. No provider call, production mutation, Security scan or browser interaction was performed.

## Initial qualification on `a926336a`

The following evidence is retained as the initial round-1 qualification for candidate `a926336a213a70fc4dc0d7378703b8b47fa70225`; it is historical and is not evidence for later candidates. Tester made no product or test-source edits. At that point command suites passed, while Reviewer and changed-flow Visual acceptance remained pending.

## Initial builds, typechecks and LaTeX runtime assets (`a926336a`)

- `npm run build:packages` passed for `@orbyn/core` and `@orbyn/api-client`. Log: [`package builds`](/private/tmp/orbyn-adr006-packages-a926336a.log).
- `npm run build -w backend` and `npm run typecheck -w backend` passed. Logs: [`backend build`](/private/tmp/orbyn-adr006-backend-build-a926336a.log) and [`backend typecheck`](/private/tmp/orbyn-adr006-backend-types-a926336a.log).
- `npm run typecheck -w desktop` and `npm run typecheck -w mobile` passed. Logs: [`desktop typecheck`](/private/tmp/orbyn-adr006-desktop-types-a926336a.log) and [`mobile typecheck`](/private/tmp/orbyn-adr006-mobile-types-a926336a.log).
- `npm run build:latex-html` passed, then `npm run check:latex-html` passed the runtime source-digest and web/mobile parity checks. Build log: [`HTML runtime asset build`](/private/tmp/orbyn-adr006-latex-html-build-a926336a.log).

I did not run `npm run build -w desktop`. The Visual owner was restoring a shared disposable profile and reported a host reload during preview work; the handoff asked to avoid additional preview-affecting build writes until Visual finished. Desktop typecheck and the shared HTML runtime provenance/parity check passed. A standalone desktop production bundle remains unverified by Tester. I did not restart a preview or interact with the browser fixture.

## Initial focused document tests (`a926336a`)

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/doc-tex.unit.test.ts \
  backend/tests/doc-source-view.unit.test.ts \
  backend/tests/doc-latex-note.unit.test.ts \
  backend/tests/doc-content-operations.unit.test.ts \
  backend/tests/latex-html-runtime.unit.test.ts \
  backend/tests/document-workspace.unit.test.ts \
  backend/tests/doc-source-edit.unit.test.ts
```

**Result:** exit 0; 77/77 passed, 0 failed, 0 cancelled, 0 skipped (10.78 seconds). Mode-0600 TAP log: [`document tests`](/private/tmp/orbyn-adr006-doc-focused-a926336a.tap).

## Initial focused Settings tests (`a926336a`)

```sh
node --import=tsx --test --test-concurrency=1 \
  backend/tests/settings-navigation.unit.test.ts \
  backend/tests/connections-sections.unit.test.ts \
  backend/tests/settings-connection-help.unit.test.ts \
  backend/tests/assistant-settings-navigation.unit.test.ts \
  backend/tests/settings-modal.unit.test.ts \
  backend/tests/settings-grid-layout.unit.test.ts \
  backend/tests/settings-focus-connection.unit.test.ts \
  backend/tests/settings-detail-navigation.unit.test.ts
```

**Result:** exit 0; 43/43 passed, 0 failed, 0 cancelled, 0 skipped (6.55 seconds). Mode-0600 TAP log: [`Settings tests`](/private/tmp/orbyn-adr006-settings-focused-a926336a.tap).

The earlier development history remains part of the record: Settings first reported 32/43, then 40/43, before the corrected 43/43 development batch. This independent formal 43/43 result does not erase those attempts. The document development batch was 77/77.

## Initial OAuth and agent database suites (`a926336a`)

The guarded target was `adr006_oauth_test` on the disposable loopback PostgreSQL service at port 55434. A private runner derived its connection from the existing QA environment without printing values. Before tests, it verified the source was a loopback `_test` connection on port 55434, the target database name, `orbyn.environment=test`, and migration parity with the candidate (227 migrations; latest `267_personal_activity.sql`). The test child received only the target test connection and deterministic test-mode settings. A post-run query confirmed the database name, marker and migration state were unchanged. No credential, URL or key value was printed.

Executed serially with `node --import=tsx --test --test-concurrency=1` against:

```text
backend/tests/oauth.test.ts
backend/tests/agents.test.ts
```

**Result:** exit 0; 56/56 passed, 0 failed, 0 cancelled, 0 skipped (21.18 seconds). This includes the consent-expiry recovery case. Mode-0600 successful log: [`OAuth and agents tests`](/private/tmp/orbyn-adr006-oauth-agents-a926336a-retry1.tap).

One preliminary wrapper attempt failed before connecting to PostgreSQL: a helper stored in `/private/tmp` could not resolve the workspace `dotenv` module. I corrected the helper to resolve dependencies from `backend/package.json`; the guarded rerun above passed. The first attempt is retained in the mode-0600 log [`wrapper launch failure`](/private/tmp/orbyn-adr006-oauth-agents-a926336a.tap). It is a harness-launch failure, not a product test failure.

## Initial finding and limits at `a926336a`

The untracked Reviewer report [`document-sync-settings-review.md`](document-sync-settings-review.md) originally recorded **ADR006-R1-01, P2**: after a successful Agent Context profile save, normalized name/persona values were not adopted as the displayed draft, leaving the form falsely dirty. The 6e checkpoint now has passing normalized-save and failed-save-retention regressions for both clients (see above), but independent Reviewer disposition is still pending; Tester does not mark the finding closed. I preserved the Reviewer report without staging it.

Visual checks for whole-document synchronization, Settings detail flows, agent organization/customization and Activity geometry remain with the Visual owner. Tests and typechecks do not establish rendered layout, focus behavior or native-app behavior. The previously recorded read-only live MCP `get_context` establishes reachability at that time only; this Tester pass made no provider/live call and does not establish the cause or absence of intermittent disconnections. No native build, production mutation or Security scan was run.

At the initial `a926336a` report, Git had no product, test or generated-asset changes from that Tester run. During this 6e checkpoint retest, Tester again made no product or test-source edits. Later Builder dock work appeared in the shared checkout and remains outside the tested checkpoint. The unrelated tracked `docs/reviews/c6-production-visual-2026-10-11.md` edit and untracked Reviewer report remain untouched. Only this Tester report is to be committed.

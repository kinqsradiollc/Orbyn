# ADR 006 Document Consistency and Settings — Tester Qualification

- **Candidate:** `a926336a213a70fc4dc0d7378703b8b47fa70225`
- **Parent / baseline:** `b5ee4dd096595d38e25c6e6c17d06fb3c806c999`
- **Checkout:** `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- **Branch:** `codex/document-sync-settings`
- **Phase:** formal command qualification complete; Reviewer/Visual acceptance pending
- **Review history:** ADR 006 starts as a separate scope from ADR 005. The untracked Reviewer report records ADR 006 round 1/3 and one open P2; the scope ledger still says 0/3 and needs reconciliation at closure. ADR 005's separate 1/3 history is unchanged.

All checks below ran against the exact candidate. Tester made no product or test-source edits. Command suites and compile checks passed, but the candidate is **not accepted overall**: Reviewer finding ADR006-R1-01 remains open, and changed-flow Visual evidence is pending.

## Builds, typechecks and LaTeX runtime assets

- `npm run build:packages` passed for `@orbyn/core` and `@orbyn/api-client`. Log: [`package builds`](/private/tmp/orbyn-adr006-packages-a926336a.log).
- `npm run build -w backend` and `npm run typecheck -w backend` passed. Logs: [`backend build`](/private/tmp/orbyn-adr006-backend-build-a926336a.log) and [`backend typecheck`](/private/tmp/orbyn-adr006-backend-types-a926336a.log).
- `npm run typecheck -w desktop` and `npm run typecheck -w mobile` passed. Logs: [`desktop typecheck`](/private/tmp/orbyn-adr006-desktop-types-a926336a.log) and [`mobile typecheck`](/private/tmp/orbyn-adr006-mobile-types-a926336a.log).
- `npm run build:latex-html` passed, then `npm run check:latex-html` passed the runtime source-digest and web/mobile parity checks. Build log: [`HTML runtime asset build`](/private/tmp/orbyn-adr006-latex-html-build-a926336a.log).

I did not run `npm run build -w desktop`. The Visual owner was restoring a shared disposable profile and reported a host reload during preview work; the handoff asked to avoid additional preview-affecting build writes until Visual finished. Desktop typecheck and the shared HTML runtime provenance/parity check passed. A standalone desktop production bundle remains unverified by Tester. I did not restart a preview or interact with the browser fixture.

## Focused document tests

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

## Focused Settings tests

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

## OAuth and agent database suites

The guarded target was `adr006_oauth_test` on the disposable loopback PostgreSQL service at port 55434. A private runner derived its connection from the existing QA environment without printing values. Before tests, it verified the source was a loopback `_test` connection on port 55434, the target database name, `orbyn.environment=test`, and migration parity with the candidate (227 migrations; latest `267_personal_activity.sql`). The test child received only the target test connection and deterministic test-mode settings. A post-run query confirmed the database name, marker and migration state were unchanged. No credential, URL or key value was printed.

Executed serially with `node --import=tsx --test --test-concurrency=1` against:

```text
backend/tests/oauth.test.ts
backend/tests/agents.test.ts
```

**Result:** exit 0; 56/56 passed, 0 failed, 0 cancelled, 0 skipped (21.18 seconds). This includes the consent-expiry recovery case. Mode-0600 successful log: [`OAuth and agents tests`](/private/tmp/orbyn-adr006-oauth-agents-a926336a-retry1.tap).

One preliminary wrapper attempt failed before connecting to PostgreSQL: a helper stored in `/private/tmp` could not resolve the workspace `dotenv` module. I corrected the helper to resolve dependencies from `backend/package.json`; the guarded rerun above passed. The first attempt is retained in the mode-0600 log [`wrapper launch failure`](/private/tmp/orbyn-adr006-oauth-agents-a926336a.tap). It is a harness-launch failure, not a product test failure.

## Open finding and remaining limits

The untracked Reviewer report [`document-sync-settings-review.md`](document-sync-settings-review.md) records **ADR006-R1-01, P2**: after a successful Agent Context profile save, normalized name/persona values are not adopted as the displayed draft, so the form can remain falsely dirty and keep Save enabled. The formal Settings suite passed, but it does not establish this normalized profile-save contract; the finding remains open for Builder correction and a targeted retest. I preserved the Reviewer report without staging it.

Visual checks for whole-document synchronization, Settings detail flows, agent organization/customization and Activity geometry remain with the Visual owner. Tests and typechecks do not establish rendered layout, focus behavior or native-app behavior. The previously recorded read-only live MCP `get_context` establishes reachability at that time only; this Tester pass made no provider/live call and does not establish the cause or absence of intermittent disconnections. No native build, production mutation or Security scan was run.

Final Git state contained no product, test or generated-asset changes from this Tester run. The unrelated tracked `docs/reviews/c6-production-visual-2026-10-11.md` edit and the untracked Reviewer report remain untouched. Only this Tester report is to be committed.

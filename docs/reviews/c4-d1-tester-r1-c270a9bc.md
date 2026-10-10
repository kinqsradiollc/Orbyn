# C4/D1 Tester execution report — c270a9bc

**Disposition: HOLD.** The frozen candidate `c270a9bc3f46d4a3dee2f3996f6d63a0c427d6d1` passed the focused server suite, workspace typecheck, and most interactive ownership checks. History → Restore exposed a native browser confirmation twice. That candidate is superseded by `1b76c6c375c4a42a875c696ea4a65ff02eab7718`, which replaces the confirmations with Orbyn dialogs; its focused interactive retest remains open.

## Candidate and fixture

- Original candidate: `c270a9bc3f46d4a3dee2f3996f6d63a0c427d6d1` on `codex/c4-docs-parity`.
- Current shared-worktree HEAD when this report was written: `1b76c6c375c4a42a875c696ea4a65ff02eab7718` (`Use Orbyn dialogs for structured Docs confirmations`). The candidate changed after the original UI failure; this report does not qualify the new revision.
- Database: disposable Docker container `orbyn-c4-postgres-test`, database `orbyn_test`, mapped to `127.0.0.1:55434`. No production database or external account was used. Synthetic `.example.test` QA accounts and their Docs were removed after testing.
- Tester changed no product or test source. The generated root `tsconfig.json` from the first Expo invocation was removed.

## Automated results

On the frozen `c270a9bc` candidate, with `TEST_DATABASE_URL` directed only at `orbyn_test`, this focused suite passed **115/115, 0 failed, 0 skipped** (3.79 s):

```sh
node --import tsx --test --test-concurrency=1 \
  backend/tests/doc-structured-storage.test.ts \
  backend/tests/doc-editor-store.unit.test.ts \
  backend/tests/doc-content-format.unit.test.ts \
  backend/tests/doc-containers.unit.test.ts \
  backend/tests/doc-container-export.unit.test.ts \
  backend/tests/doc-versioned-source.unit.test.ts \
  backend/tests/markdown-dialect.unit.test.ts \
  backend/tests/mermaid.unit.test.ts \
  backend/tests/mermaid-mobile.unit.test.ts \
  backend/tests/math-html.unit.test.ts
```

`npm run typecheck` also passed on `c270a9bc` for core, API client, backend, desktop, and mobile. After the dialog fix was frozen as `1b76c6c3`, `npm run typecheck -w desktop` and `npm run typecheck -w mobile` both passed.

A supplemental batch reported **124/124 passing** for Docs API, offline replay, task, links/privacy, capture, and comment-layout tests. The batch started while `c270a9bc` was HEAD; the shared editor files were modified during or around that run. Treat it as supplemental evidence only, not an exact-candidate receipt for either revision:

```sh
node --import tsx --test --test-concurrency=1 \
  backend/tests/docs.test.ts \
  backend/tests/doc-content-offline.unit.test.ts \
  backend/tests/doc-offline-replay.unit.test.ts \
  backend/tests/doc-container-tasks.unit.test.ts \
  backend/tests/links.test.ts \
  backend/tests/link-privacy.test.ts \
  backend/tests/link-privacy.unit.test.ts \
  backend/tests/share-capture.test.ts \
  backend/tests/doc-inline-object-privacy.unit.test.ts \
  backend/tests/doc-comment-layout.test.ts
```

Logs retained locally at `/tmp/orbyn-c4-d1-tester-focused.log`, `/tmp/orbyn-c4-d1-tester-typecheck.log`, and `/tmp/orbyn-c4-d1-tester-scope.log`.

## Interactive results on c270a9bc

- Web Docs created and saved a format-2 page with Markdown, a nested checklist/task, inline and display math, and a Mermaid flowchart. Source and Preview showed the expected content. The test DB showed `content_format=2`; the final restored web page was version 6.
- Expo web opened that page, toggled Source/Preview, saved an edit, and the web tab received the update live. A separate mobile-web page was created, saved, and previewed with a checklist and rendered inline math; the DB showed `content_format=2`.
- A web line comment was submitted and displayed. History showed prior revisions. Two attempts to restore a revision each opened the browser-native confirmation with the exact text: **“Restore this version? The current page stays in history.”** The restore completed after confirmation, preserving the current page in history and restoring the selected content. This is the blocking UI defect observed on `c270a9bc` and the trigger for the replacement dialog work.
- Export adapter/storage tests passed in the focused suite; no export download was initiated through the UI. Offline/conflict behavior was covered by tests, not by an interactive network outage.

## Runtime observations and remaining gates

- The first Expo bundling attempt was launched from the monorepo root and failed to resolve `../../App`; restarting Expo from `/mobile` bundled the app successfully. This was a harness working-directory error.
- Expo web logged two `Pressable`/`PressableScale` error traces while rendering `DocsSheet` rows (`mobile/src/motion/Pressable.tsx:27`, `mobile/src/motion/PressableScale.tsx:58`; stacks at `DocsSheet.tsx:2187` and `2261`). The UI remained usable; the cause was not adjudicated.
- Vite blocked a KaTeX font URL under its filesystem allowlist because the dependency resolved through another worktree’s `node_modules` symlink. Math content still appeared. This local dependency setup remains an environment limitation.
- The focused interactive retest of `1b76c6c3` is open. The local sign-in screen explicitly states that signing in agrees to the Terms of Service and Privacy Policy. `AGENT.md` and `docs/agents/coordination.md` give standing permission for local QA login and Orbyn Terms/Privacy acceptance; the computer-use policy still requires fresh confirmation at the agreement step. The synthetic account was not signed in and no agreement was accepted during this retest; that confirmation is pending.
- Per the user’s exclusions, there was no separate desktop-app check, native iOS/Android build, exhaustive retest, routine Visual Check, screenshot-based visual result, or keyboard/assistive-technology audit. No merge, push, or deployment is claimed.

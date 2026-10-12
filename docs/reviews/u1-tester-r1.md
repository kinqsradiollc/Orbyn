# U1 Tester R1

Date: 12 October 2026  
Candidate: `3b488b51332d8cf46d25de913bd89dbe71bce428` (parent `4050e321`)  
Baseline: `9d786412`  
Worktree: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`

## Result

**Targeted functional, type, and desktop web-build checks pass.** The required rendered changed-risk pass remains with Orbyn Visual Check. The signup page at port 8081 renders, but its Terms modal still reports “Couldn't reach Orbyn”; the account and consent were created and verified through the local API instead. Do not treat the browser signup interaction or its legal modal as a pass.

## Evidence

- Focused regressions: `npm exec --no -- tsx --test --test-concurrency=1 tests/app-dialogs.unit.test.ts tests/task-options-ui.unit.test.ts tests/admin-ai-management.unit.test.ts tests/settings-grid-layout.unit.test.ts tests/page-width-layout.unit.test.ts tests/admin-workspace-layout.unit.test.ts tests/assistant-context-layout.unit.test.ts` from `backend/` — **45 passed, 0 failed**, exit 0.
- Workspace types and package build: `npm run typecheck` — core and API-client builds plus backend, desktop, and mobile typechecks all passed, exit 0.
- Desktop web build: `npm run build -w desktop` — passed, exit 0. Vite emitted its existing advisory that the main minified chunk exceeds 500 kB; build and homepage prerender completed.
- Preview availability: desktop Vite `http://localhost:5174/` returned 200; Expo web `http://localhost:8083/` returned 200. The Expo server logged the existing missing `ios.appleTeamId` warning; no native build was attempted.
- Disposable API fixture: API `/health` returned 200. Registration returned 201 and `/me` returned 200 for the same synthetic user with `role=admin` and `email_verified=true`. `orbyn_test` and `orbyn.environment=test` were verified. Accepted local consent version: `2026-10-08-managed-features`.
- Browser signup tab: `http://localhost:8081/` visibly rendered the registration form. Opening Terms showed “Couldn't reach Orbyn” both before and after adding that localhost origin to the temporary API CORS configuration; no request from the tab appeared in the API log. Browser submission and Privacy-policy display remain unverified.
- Fixture IDs, services, and protected credential-file location are recorded in [u1-fixture.md](u1-fixture.md). Credentials are intentionally excluded here.

## Scope and remaining evidence

For initial candidate `3b488b51`, Tester made no product-source or test edits. No database integration suite was run because that candidate's remaining change was UI-only; the database served only for the isolated signup and preview fixture. For supplement candidate `ad1a5dde`, the source and regression changes came from the frozen candidate; Tester made no source/test edits. The later long-title task-fixture update for Visual is recorded in [u1-fixture.md](u1-fixture.md). No native iOS/Android checks, paid-provider calls, production access, or security scan were performed. Visual Check R1 remains incomplete because authenticated states were not reached; see [u1-visual-r1.md](u1-visual-r1.md). C4 browser/hosted-OAuth/live-channel exclusions and the C6 bounded-scope limits remain unverified as recorded in the acceptance map.

## Frozen-candidate supplement: `ad1a5dde`

Date: 12 October 2026  
Candidate: `ad1a5dde6987db74c2cbf994d8d9d5fd39dae8cd` (parent `3b488b51332d8cf46d25de913bd89dbe71bce428`)  
Branch: `codex/c6-file-viewer`

The candidate adds focused regression coverage and changes desktop `SidePeek` dialog focus plus passkey-name cancellation. The mobile source is unchanged from the previous candidate.

- `npm exec --no -- tsx --test --test-concurrency=1 tests/app-dialogs.unit.test.ts` from `backend/` — **6 passed, 0 failed**, exit 0. The mounted narrow-peek case keeps the command dialog in control through narrow/wide resizing and restores peek focus when it closes. The passkey Add callback is exercised with Cancel, an empty name, and a named credential: Cancel does not register or reload, while empty and named values register once and report success.
- `npm run typecheck -w desktop` — passed, exit 0.
- `npm run build -w desktop` — passed, exit 0; Vite retained the advisory about the main chunk exceeding 500 kB, then completed the build and homepage prerender.
- Prior root workspace typecheck, including mobile, remains applicable because this revision does not change mobile or shared package source. Tester made no source/test edits; the later long-title fixture update is documented in [u1-fixture.md](u1-fixture.md).

## Frozen-candidate supplement: `c2cefbe7`

Date: 12 October 2026  
Candidate: `c2cefbe77ab525cfa30db29853ce289a3622a10e` (parent `ad1a5dde6987db74c2cbf994d8d9d5fd39dae8cd`)  
Branch: `codex/c6-file-viewer`

- `npm exec --no -- tsx --test --test-concurrency=1 tests/app-dialogs.unit.test.ts` from `backend/` — **7 passed, 0 failed**, exit 0. The TaskDetail case executes the extracted keyboard effect against mounted DOM shapes to verify Escape/Tab remain with a higher command dialog and Escape does not close the drawer; the mounted SidePeek case verifies focus returns to the stable Search trigger when its original opener is removed.
- `npm run typecheck -w desktop` — passed, exit 0.
- `npm run build -w desktop` — passed, exit 0. Vite emitted the existing main-chunk-over-500-kB advisory; asset build and homepage prerender completed.
- No source, test, fixture, or service changes were made by Tester for this candidate. Existing fixture and previews remain available to Visual Check.

## Frozen-candidate supplement: `e0997ae4`

Date: 12 October 2026  
Candidate: `e0997ae434cb8cee9bb783ce524a8519aede34a7` (parent `c2cefbe77ab525cfa30db29853ce289a3622a10e`)  
Branch: `codex/c6-file-viewer`

- `npm exec --no -- tsx --test --test-concurrency=1 tests/app-dialogs.unit.test.ts` from `backend/` — **7 passed, 0 failed**, exit 0. The suite executes the actual TaskDetail and SidePeek keyboard effects with both retained panels at equal `z-index: 4`; exactly one handles Escape/Tab, and TaskDetail regains ownership when Peek is removed. The existing higher-command precedence and removed-opener focus fallback cases remain covered.
- `npm run typecheck -w desktop` — passed, exit 0.
- `npm run build -w desktop` — passed, exit 0. Vite emitted the existing main-chunk-over-500-kB advisory; asset build and homepage prerender completed.
- No source, test, fixture, or service changes were made by Tester for this candidate. Earlier `c2cefbe7` evidence remains historical in the preceding supplement.

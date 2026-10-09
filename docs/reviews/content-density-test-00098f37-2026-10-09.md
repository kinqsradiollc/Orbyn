# Content-density candidate — Tester qualification

Date: 2026-10-09  
Candidate: `codex/content-density` at `00098f37b4fedfbaca7d1b492396a6a81f8af0e8`  
Base: `c778c25fa469a1f85ddb90421b5e7eb8186008d0`  
Result: **Needs copy corrections and one test expectation update.** Candidate source was not edited.

## Findings

1. **P2 — Email-to-task copy drops the account-holder sender rule on both clients.** [Desktop EmailToTask](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/EmailToTask.tsx:38) and [mobile SettingsScreen](/tmp/orbyn-c2-main-integration/mobile/src/screens/SettingsScreen.tsx:861) now say that emailing the private address creates a task, without saying it must come from the account holder’s address. The inbound route still rejects any sender other than `user.email` ([inbound route](/tmp/orbyn-c2-main-integration/backend/src/modules/inbound/routes.ts:94)), and [sender test](/tmp/orbyn-c2-main-integration/backend/tests/email-to-task.test.ts:95) covers a stranger being ignored. The shorter copy can make the private address look sufficient. Restore the sender condition in both clients.

2. **P2 — Morning-summary copy omits the desktop-online prerequisite on both clients.** The old helper named that requirement; the new helper only says summaries use the ChatGPT plan ([desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/AgendaPrivateSettings.tsx:13), [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/settings/AgendaPrivateSettings.tsx:15)). Keep a concise note that the desktop app must be online so users know when scheduled summaries can run.

3. **P2 — Desktop admin copy drops the ten-run nightly cap.** [Desktop AdminAi](/tmp/orbyn-c2-main-integration/desktop/src/features/admin/AdminAi.tsx:311) now says only that the allowance is shared across night runs. Mobile still says “up to ten runs each night” ([mobile AdminAi](/tmp/orbyn-c2-main-integration/mobile/src/screens/AdminAi.tsx:204)), and the worker stops scheduling at ten ([night-shift worker](/tmp/orbyn-c2-main-integration/backend/src/worker/night-shift.ts:724)). Restore the cap on desktop to keep the limit visible and both clients aligned.

4. **P2 — Local OAuth redirect warning is less specific.** [OAuthConsent](/tmp/orbyn-c2-main-integration/desktop/src/features/auth/OAuthConsent.tsx:149) changes “only if you just started connecting from that app yourself” to “only if you started this connection.” The new sentence drops the freshness and source-app checks. Retain a short warning to continue only when the user just started the connection from the named local app.

5. **P2 — ChatGPT usage test expectation is stale for the new copy.** [usage UI test](/tmp/orbyn-c2-main-integration/backend/tests/chatgpt-usage-ui.unit.test.ts:151) still requires “Account limits stay in ChatGPT”; the desktop and mobile components now render “Orbyn calls only. Plan limits are in ChatGPT.” Both platform cases fail. The base source matched this assertion, so this is a candidate-introduced expectation mismatch, not a pre-existing baseline failure. Update the assertion or preserve wording that keeps the distinction explicit.

6. **P3 — Built-in assistant copy no longer states it cannot be disconnected.** The connected-agent note in [desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/ConnectedAgents.tsx:197) and [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/ConnectedAgents.tsx:180) still says access can be lowered and protected actions need approval, but omits the previous explicit “cannot be disconnected” limit. Since the built-in grant has no disconnect action, retain that limitation in the nearby explanation.

## Verification

- Desktop typecheck: passed with `node_modules/.bin/tsc --noEmit -p desktop/tsconfig.json`.
- Mobile typecheck: passed with `node_modules/.bin/tsc --noEmit -p mobile/tsconfig.json`.
- Focused Home, ChatGPT settings/usage, connection-help and consent unit tests: **82/84 passed**. The two failures are the stale desktop/mobile usage-copy assertions above.
- Focused admin, provider-catalog, embedding and semantic UI tests: **124/124 passed**.
- `git diff --check`: passed.
- The candidate checkout had no installed modules. For checks, root and mobile `node_modules` were temporarily linked to the Tester checkout’s installed dependency tree, then both links were removed. Candidate worktree is clean.
- An initial wider test invocation included `ai-provider-choice.test.ts` and `home-covers.test.ts`; both stop in test setup because `TEST_DATABASE_URL` is unset. They are database-backed and outside this UI-copy change, so they are excluded from the focused UI count. No database or Docker tests were run.
- Visual acceptance, native builds and production behavior remain unverified, as excluded by the handoff.

## Retest receipt — corrected candidate `686eb0a5`

Retested on 2026-10-09 at `686eb0a570cfc974d9bd621a629d92ccc2535eab`, parent `00098f37b4fedfbaca7d1b492396a6a81f8af0e8`.

**PASS for the requested correction scope:** all six findings from the first candidate are addressed in source, and the usage UI assertions pass on both clients.

- Email-to-task instructions now specify sending from the account email on [desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/EmailToTask.tsx:38) and [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/SettingsScreen.tsx:861). The existing inbound handler still enforces the account-email match at [routes.ts](/tmp/orbyn-c2-main-integration/backend/src/modules/inbound/routes.ts:94).
- Both [desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/AgendaPrivateSettings.tsx:14) and [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/settings/AgendaPrivateSettings.tsx:15) now say to keep Orbyn desktop online. This is intentional: the mobile executor does not provide `plan_inference_limits_v1`, which scheduled summaries require.
- [Desktop AdminAi](/tmp/orbyn-c2-main-integration/desktop/src/features/admin/AdminAi.tsx:311) again states the ten-run nightly cap.
- [OAuthConsent](/tmp/orbyn-c2-main-integration/desktop/src/features/auth/OAuthConsent.tsx:149) again requires that the user just started connecting from the local app.
- [ConnectedAgents on desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/ConnectedAgents.tsx:197) and [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/ConnectedAgents.tsx:180) again state that the built-in assistant cannot be disconnected.
- The updated assertion at [chatgpt-usage-ui.unit.test.ts](/tmp/orbyn-c2-main-integration/backend/tests/chatgpt-usage-ui.unit.test.ts:151) matches the current “Plan limits are in ChatGPT” copy.

Focused command: `node --import tsx --test --test-concurrency=1 backend/tests/chatgpt-usage-ui.unit.test.ts backend/tests/consent-resource-label.unit.test.ts` — **6/6 passed**, including desktop and mobile usage flows. No failures.

The changed AdminSystem retention helper was also source-checked; it still states that expired records are swept hourly in batches and that 0 keeps a type forever. No typecheck, database/Docker test, broad suite, visual check, or native build was run for this narrow retest. Temporary dependency links were removed and the candidate checkout is clean.

## Retest receipt — reviewer round-1 corrections `fbcac938`

Retested on 2026-10-09 at `fbcac93820d4d2affd7ef8c5d9f37eca2a5c6483`, parent `686eb0a570cfc974d9bd621a629d92ccc2535eab`.

**PASS for the two requested corrections.**

- Both [desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/AgendaPrivateSettings.tsx:67) and [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/settings/AgendaPrivateSettings.tsx:72) show “Check connection” when permission is off and unavailable, or when loading reports an error. The button calls the hook’s refresh; [the hook](/tmp/orbyn-c2-main-integration/desktop/src/hooks/useAgendaPrivateSettings.ts:121) triggers a fresh read of permission, summary, provider choice and, when selected, catalog state. Existing `agenda-settings-client.unit.test.ts` coverage validates fresh status/permission reads and capability gating. Desktop-only scheduling remains intentional because the mobile executor lacks `plan_inference_limits_v1`.
- The zero-completion branch now says “No completed ChatGPT calls recorded” on [desktop](/tmp/orbyn-c2-main-integration/desktop/src/features/settings/ChatgptUsage.tsx:83) and [mobile](/tmp/orbyn-c2-main-integration/mobile/src/screens/settings/ChatgptUsage.tsx:92), accurately limiting the claim to completed calls.

Focused command: `node --import tsx --test --test-concurrency=1 backend/tests/chatgpt-usage-ui.unit.test.ts backend/tests/agenda-settings-client.unit.test.ts` — **8/8 passed**, with no failures. The existing usage fixtures cover desktop/mobile totals and delayed responses, but not the zero-completion branch; the new empty-state copy was source-checked on both clients. The scheduling suite covers capability and fresh-read behavior, but does not assert the rendered “Check connection” label; the visible-state condition and refresh binding were source-checked on both clients.

No broad suite, typecheck, database/Docker test, visual check, or native build was run. Temporary dependency links were removed and the candidate checkout is clean.

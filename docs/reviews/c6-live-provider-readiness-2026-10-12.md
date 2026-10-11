# C6 live managed/BYO provider readiness — 12 October 2026

## Decision

**Not ready for a live provider request.** This audit did not establish an
isolated QA grant, its separate provider/model/allowance consent, or a usable
test/sandbox provider configuration. No inference was dispatched, and no
provider permission or configuration was changed.

## Scope and provenance

- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- Branch: `codex/c6-file-viewer`
- `HEAD` at the readiness inspection, before the later correction freeze:
  `de83f54bc209d40bd3c17da8fc8306cfd2ca7b15`
- Accepted runtime candidate: `8f99272c66101734f0536405ad5bb68f5122e60b`
- A read-only diff confirmed `backend` and `package-lock.json` are unchanged
  from the accepted candidate; the intervening changes are documentation.
- Reused the [58/58 correction report](c6-unified-mcp-tester-r2-8f99272c-2026-10-11.md)
  and existing [connector](c6-production-tool-evidence-2026-10-12.md),
  [host visual](c6-production-visual-2026-10-12.md), and
  [qualification](c6-qualification.md) records. No suite or security scan was
  rerun as part of the readiness audit; later focused qualification is recorded
  separately below.
- The readiness audit itself used only read-only repository, browser, listener,
  and test-database metadata checks. No credential values, provider keys, or
  endpoint secrets were read into output.

## Readiness findings

| Prerequisite | Result | Evidence |
| --- | --- | --- |
| Isolated authorized QA grant | **No isolated live grant demonstrated.** | At the readiness inspection, the only database container was `orbyn-postgres-test-1`; `orbyn_test` reported `orbyn.environment=test` and had no application tables in `public`. A later focused test run initialized the schema, as recorded in the [widget-launcher Tester report](c6-widget-launcher-tester-2026-10-12.md); it did not create a local signup account or establish a QA grant. Prior host evidence shows an authenticated canonical OAuth connection for the owner's account and a synthetic document in that personal space; it is not an isolated QA account/grant. The legacy `/plugin` connection was preserved. |
| Explicit provider/model/allowance consent | **Missing for an isolated QA grant.** | The existing host record says no provider permission or consent was changed. The C6 boundary requires a separate owner consent that pins a managed/BYO provider, model, consent version, and allowance. `MCP_WORKSPACE_AI_ENABLED` defaults to `false` in [backend configuration](../../backend/src/config/env.ts); the [production test runbook](../plugin-production-test.md) also requires a separate approved provider/model/allowance. No current consent receipt was observed. |
| Test/sandbox provider configuration | **Not demonstrated; live availability remains unknown.** | The accepted local test evidence is mock/inert-adapter evidence, not a live managed/BYO provider call. No backend listener was visible on local ports `18008` or `8081`. The later schema initialization did not inspect or configure provider state. No provider secrets or URLs were inspected. |
| Local signup needed to obtain a QA identity | **Blocked.** | The local signup page rendered at `http://localhost:8081/`. The Privacy Policy loaded, but the Terms of Service panel returned “Couldn't reach Orbyn. Check your connection and try again” on two attempts. No signup fields were submitted, the agreement checkbox was not selected, and no account was created. The Terms version and populated operator/jurisdiction details therefore could not be reviewed. |

The authenticated owner connection and prior synthetic Personal document prove
some canonical host access and API behavior; they do not prove an isolated grant,
workspace-AI authorization, provider spend limit, or live managed/BYO execution.
The test marker confirms the database boundary. The later test-run migration
initialized the app schema, but did not establish an isolated QA identity,
provider consent, or sandbox configuration.

## Exact next prerequisites

1. Start the local QA web/API stack against this `orbyn_test` database and make
   the current Terms document load. The focused test run has since initialized
   its schema; verify the signup service is connected to this database. Keep the
   provider feature disabled while preparing the account.
2. Complete signup as a dedicated synthetic QA identity and establish a fresh
   canonical `/mcp` grant. The browser workflow requires the user to enter the
   new password and complete the final account-submission step; the current
   Terms panel must first load so the user can review the actual agreement.
3. For a live provider check, make a test/sandbox credential/configuration
   available on the backend and record the exact managed or BYO provider, model,
   per-request output cap, and daily allowance. Then obtain that QA owner's
   explicit consent for those exact values and verify the resulting consent
   receipt without exposing credentials.
4. Only after those prerequisites, authorize one bounded synthetic request and
   inspect the receipt/usage result. Avoid a second dispatch for unknown
   outcomes. No paid or live provider request is authorized by this readiness
   audit.

Until then, retain live managed/BYO qualification as **unverified**; do not infer
it from the local 58/58 test batch or the owner's ordinary canonical OAuth
connection.

## Subsequent test-state update

The focused qualification of candidate `29f94942` ran `plugin-service.test.ts`,
whose setup applies migrations. After that run, `orbyn_test` remained marked
`orbyn.environment=test` and reported 188 public base tables. The update is
schema initialization only; the live-provider prerequisites above remain
unverified. No live inference was dispatched.

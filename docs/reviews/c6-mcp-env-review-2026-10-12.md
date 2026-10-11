# C6 canonical MCP environment review — 12 October 2026

Candidate: `b636deb9e17972146280246746d7a26b6e1493ea`, checkout
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`.
Focused documentation/configuration review within existing **round 2/3**.

## Source disposition

**No source-contract correction identified; final integration disposition awaits
the requested Tester receipt.** The commit changes only `.env.example`:
explicit canonical public URL, relocated single inference flag defaulting to
false, and comments describing opt-in, worker startup and per-connection
permission. No runtime implementation changed.

The explicit URL equals `backend/src/config/env.ts`'s existing default.
`scripts/deploy.sh` sets `plugin_on=1` when canonical inference is true,
independently of the legacy recipient, then builds and rolls the integration
worker. `compose.yaml` places this service under profile `plugin`; the MCP
service and worker both inherit the backend `.env`, and the worker additionally
declares the flag explicitly. `backend/src/services/plugin.ts` starts the
worker; the MCP service alone does not. The flag's false default and retained
receipts agree with the inspected source.

The model/allowance comment is shorthand for the separate connection permission
described in the accepted runbook: the permission panel approves the workspace's
selected provider/model and bounded limits. Enabling the server flag alone
does not grant provider authority or prove execution. A blank legacy recipient
does not disable the canonical worker when its flag is enabled.

## Private configuration and evidence boundary

Builder reports a separate primary-checkout `.env.production` flag change to
true, with all other values preserved. That private file is not part of this
candidate's Git diff. Reviewer did not print or independently compare its
contents; sanitized parity and disposable Compose/deploy-check results belong
in `c6-mcp-env-tester-2026-10-12.md`. This report must not be read as independent
verification of every private value or of a production deployment.

At initial inspection that Tester report was not yet present. Reviewer has run
no tests, Compose/deploy checks, browser actions, scans or live inference and
has changed only this review report. Existing concurrent documentation is
preserved. Further visual checks remain stopped; prior host/provider evidence
limits remain unchanged.

## Sanitized Builder parity receipt received

Reviewed [Builder's parity record](c6-mcp-env-builder-2026-10-12.md). It records
comparison of all parsed before/after values, allowing only
`MCP_WORKSPACE_AI_ENABLED` false → true; later comment edits preserved all
parsed values. Canonical/legacy URLs and the existing plugin profile were
preserved, and the four named settings each have one active assignment.
This closes the missing Builder parity-record item. It remains Builder-supplied
evidence, not an independent Reviewer comparison of the private file.

No correction identified in that receipt. Tester configuration results remain
pending; final integration acceptance is unchanged until they arrive. Private
credentials remain outside the report and Git candidate.

## Final environment checkpoint disposition

**Approve `b636deb9e17972146280246746d7a26b6e1493ea` for main integration.**
The focused environment checkpoint is closed within existing **round 2/3**.
No further correction requested. HEAD still matched the frozen candidate and
`.env.example` had no uncommitted diff at final inspection.

Reviewed [Tester's configuration receipt](c6-mcp-env-tester-2026-10-12.md)
together with the source-contract review and sanitized Builder parity record.
Tester reports exit 0 for environment-template coverage (131 backend/Compose
variables and both clients), disposable Compose configuration checks in default
and enabled modes, and both deploy preflights. The default plan leaves integration
auxiliaries disabled; the enabled fixture includes the isolated worker rollout.
The enabled fixture also explicitly sets the plugin profile, so that check alone
does not isolate flag-only activation; the previously inspected deploy-script
branch establishes the latter. Expected template placeholder/optional-secret
warnings are disclosed and do not indicate a candidate regression.

Tester's private-file check independently confirms current redacted invariants:
one true inference-flag assignment, canonical URL matching the example, a
distinct nonempty legacy recipient and enabled plugin profile. Full before/after
value equality remains supported by Builder's comparison, not by Tester's
current-state check. No private configuration is part of the approved Git diff.

This approves documentation/configuration preparation only. Compose validation
and deploy preflight are not running-service or deployment evidence. Main
integration, server rollout, active per-connection provider/model/allowance
consent and live execution remain separate actions/evidence. Earlier C6 host
and provider limits remain unchanged, and further visual checks remain stopped.
Reviewer performed no tests, builds, deployment checks, browser actions, scans
or inference and edited only this report.

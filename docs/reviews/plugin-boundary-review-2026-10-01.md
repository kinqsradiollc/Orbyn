# Separate plugin backend — implementation evidence

Governing requirement: P1 in `devday-2026-implementation-review.md`. The plugin
uses its own authenticated connector principal and backend service boundary.
It must not impersonate browser sessions or receive personal ChatGPT plan keys.

## Worktree and baseline

Implementation is isolated in
`/Users/anhdang/.codex/worktrees/devday-plugin-boundary/Orbyn`, branch
`codex/devday-plugin-boundary`, based on main `4f56b8d`. The model-catalog worktree
remains at its frozen embedding checkpoint while its full suite runs. Dependencies
are read through a symlink to the existing primary dependency installation; no
package installation or dependency mutation was performed here.

## Confirmed existing coupling

- `oauth/consent.ts` validates only `MCP_PUBLIC_URL` and reuses OAuth grants by
  user/client without a resource discriminator.
- `oauth/tokens.ts` mints access and refresh pairs with `MCP_PUBLIC_URL`, even
  though authorization codes already store their resource. Token refresh must
  preserve the token family's recipient instead of choosing the MCP default.
- `mcp-server/auth.ts` accepts opaque MCP tokens, agent keys and transitional
  personal API keys. Its principal builder must be shared at the domain layer,
  while plugin authentication must reject session, legacy-key and MCP recipients.
- Capability `Principal.via` currently has no plugin identity. Existing team
  policies, trust, revisions, activity and receipts must continue to apply when
  that identity is added.

## Local resource-selection foundation

`oauth/resources.ts` defines distinct MCP/plugin recipients. Plugin authorization
is explicit; omitted resource keeps portable MCP defaults, while an already bound
plugin code/refresh token stays bound to the plugin recipient. Historical MCP
origin aliases remain MCP-only. Conflicting recipients, disabled plugin targets,
cross-resource exchanges, credential-bearing URLs, query/fragment resources and
non-loopback plain HTTP are rejected with static diagnostics.

Five unit tests passed. This helper is not yet wired into consent, minting,
refreshing or service authentication. No plugin endpoint is configured or
delivered by this checkpoint.

## Grant discriminator and portable-MCP guard (local)

Migration 204 adds `resource_kind` to grants, preserving every existing grant as
MCP. Live OAuth uniqueness now includes the resource kind. Plugin grants require
OAuth; agent/personal keys cannot be promoted into plugin connections. Existing
MCP consent lookup explicitly selects MCP grants. MCP authentication rejects a
plugin grant even if its token metadata incorrectly names the MCP resource.

Three integration checks passed against the separately marked
`orbyn_plugin_20261001_test` database on port 55434. They cover distinct grants
for the same person/app, duplicate rejection, plugin-key rejection, MCP rejection
of plugin/session credentials, and 401/403/400/429. Combined new-resource/grant
and existing OAuth/MCP regressions passed **50 tests**, zero failed or skipped.
Backend typecheck and build passed.

Plugin consent is still disabled: no plugin resource is configured, and the
existing consent route still validates MCP alone. Resource-aware token minting,
refresh, a plugin principal and the actual service remain unfinished. Do not
enable plugin authorization until all API replicas use the new discriminator;
old consent code cannot safely select among newly created grants for both
services. No plugin host behavior is proven by these database/route checks.

## Code and refresh recipient guards (local)

Token minting now receives the resolved code/refresh recipient and checks it
against the grant's resource kind before inserting a pair. Refresh reads its
stored recipient even when the request omits `resource`; a foreign stored
recipient cannot be silently replaced by the MCP default. Legacy unbound
refresh tokens remain MCP-only. Normalized comparisons retain the configured
MCP recipient string used by existing metadata and authentication.

The combined suite passed **52 tests**, zero failed or skipped. New adversarial
checks prove that foreign-bound refreshes and plugin grants paired with MCP-bound
credentials create no tokens and leave the original refresh unused; a mismatched
authorization code also creates no pair. Plugin authorization remains disabled
because only the configured MCP resource is accepted by the live token path.
This is backend isolation/hardening evidence, not delivery of a plugin service.

## Main checkpoint validation

The resource helper, grant discriminator and token binding guards are integrated
and pushed to main at `7f264a5`. The unchanged checkpoint completed the full
repository suite: **1,975 passed**, zero failures, cancellations or skips. The
run used the marked local `orbyn_plugin_20261001_test` database. A short focused
policy test also used that database during this run; this was not an isolated
database run. No production database or provider credentials were used.

Workspace typecheck and build completed successfully. The backend Docker image
`orbyn-connector-isolation:7f264a5` built successfully; a network-disabled smoke
check of its compiled resource helper preserved plugin bindings and rejected
cross-service recipients. This does not prove a plugin endpoint or host launch.

Evidence: `/tmp/orbyn-plugin-main-full-tests.log`,
`/tmp/orbyn-plugin-main-types.log`, `/tmp/orbyn-plugin-main-build.log`,
`/tmp/orbyn-plugin-main-docker-build.log`, and
`/tmp/orbyn-plugin-main-docker-smoke.log`. These local logs are not repository
artifacts. The settings redesign and embedding feature remain separate local
checkpoints; these results do not validate their browser layout or deployment.

## Principal policy foundation (integrated)

`Principal.via` now has an explicit `plugin` identity. Both policy ceilings and
live reachable-team filtering classify it as an outside agent. A linked system
administrator cannot bypass a team's agent-off/read/suggest policy; viewer roles,
read-only narrowing and personal-space restrictions still apply. Structured
connection context labels this identity as plugin rather than session.

Two new policy unit tests and seven existing visibility checks passed together
(nine passed, zero failed or skipped). Backend typecheck passed. The resolver below now constructs the plugin principal. The service remains
required before plugin authorization is enabled.

## Plugin principal resolver (integrated, validation pending)

A separate plugin resolver now accepts only opaque OAuth access credentials
whose live grant is OAuth/plugin and whose token is bound exactly to the
configured plugin recipient. Session credentials, personal/agent keys, refresh
tokens, unbound credentials and MCP grants are refused. It checks current
expiry, revocation, disabled users, suspended grants, deleted/blocked clients,
allowed hosts and the outside-agent kill switch. It constructs an ordinary
member principal with current grant preferences and reachable team policy.
Host-supplied MCP headers cannot select or broaden plugin permissions.

Grant-row loading and principal construction are shared domain helpers; the
plugin resolver does not invoke MCP authentication or first-party routes. MCP
keeps its existing challenge, key compatibility and narrowing behavior.

The combined resource/grant/OAuth/MCP/plugin regressions passed **59 tests**,
zero failed or skipped. Four mocked resolver tests cover credential and policy
refusals; a database regression proves that changing a grant's access/personal
scope and then revoking it takes effect on the next call. Backend typecheck
and build passed. Logs: /tmp/orbyn-plugin-resolver-final-regressions.log,
/tmp/orbyn-plugin-resolver-final-types.log, /tmp/orbyn-plugin-resolver-build.log.

Main integration at `f14014c` passed the same 59 focused regressions, then the
unchanged checkpoint completed the full repository suite: **1,982 passed**,
zero failed, cancelled or skipped. This run used the marked local plugin test
database; the separate service tests ran against a different marked database.
Workspace typecheck and build completed successfully. Logs:
`/tmp/orbyn-plugin-resolver-main-full-tests.log`,
`/tmp/orbyn-plugin-resolver-main-regressions.log`,
`/tmp/orbyn-plugin-resolver-main-types.log`, and
`/tmp/orbyn-plugin-resolver-main-build.log`.

This is a callable backend resolver foundation. No plugin HTTP service, OAuth
consent enablement, provider inference, host launch or UI delivery is claimed.
The service remains disabled until those contracts and acceptance gates exist.

## Separate HTTP service foundation (local)

The plugin now has a dedicated service entry point and builder. It mounts only
plugin connection and typed capability-catalog routes, plus the shared service
health endpoints. API, assistant, OAuth, model and MCP routes are absent.
PLUGIN_PUBLIC_URL is server-owned and blank by default; blank configuration
returns 404 for plugin routes. Every enabled call uses the plugin resolver and
no-store responses. Tool listing uses the shared registry filtered by the live
plugin principal. Browser session cookies cannot authenticate the service.

The isolated marked orbyn_plugin_service_20261001_test database was used for
three new service tests plus existing service/path checks: ten passed, zero
failed or skipped. Cases include 401, disabled-user 403, malformed catalog
query 400, rate-limit 429 with Retry-After, wrong-recipient tokens, disabled
routes, and absence of first-party/MCP paths. Main integration repeated all ten
tests successfully. Workspace typecheck and build passed there. Logs:
`/tmp/orbyn-plugin-service-main-tests.log`,
`/tmp/orbyn-plugin-service-main-types.log`, and
`/tmp/orbyn-plugin-service-main-build.log`.

The unchanged main checkpoint `e75abcf` completed the full rerun with
**1,985 passed**, zero failures, cancellations or skips. Its earlier process
was interrupted and vanished without a final result; that partial run is not
counted as a pass. The successful run used the marked service test database;
execution work in the other checkout used a different marked database.
Evidence: `/tmp/orbyn-plugin-service-main-full-rerun.log`.

This foundation does not yet expose tool execution, UI resources, launch
contexts or resumable events. OAuth consent remains MCP-only, and plugin
provider execution and deployment/gateway wiring remain unfinished. Do not
configure a production plugin recipient as a delivered integration yet.

## Shared capability execution (local)

POST /plugin/tools/call accepts a strict bounded name/arguments envelope and
calls the shared domain executor with an independently authenticated plugin
principal. It cannot accept host claims of approval or replace the principal.
Reads use the primary and the existing read-only transaction. Writes set the
actor/connector identity, use the shared trust/proposal services and retain
existing client_ref receipts. Connection/token/user/client and membership/team
rows are locked and live permissions compared again before entering the write;
a changed snapshot or revoked connection cannot enter the callback. Concurrent
writes serialize on the grant to avoid lock-upgrade deadlocks and duplicate
receipt effects. Tool calls use per-connection limits and the shared activity
and usage recorder. Maintenance and the outside-agent write switch block writes.

Seventy-four focused plugin/resource/grant/OAuth/MCP/service/path checks passed,
zero failed or skipped. New database checks prove shared get_context reads,
strict input, inaccessible tools, two concurrent requests creating one task and
one durable receipt, stale/revoked write prevention, ask-first review without
creating a task, and read/write maintenance behavior. An initial fixture used
unsupported trust value ask_first and failed its database constraint; the
fixture now uses the real ask value and all checks were rerun. Backend typecheck
and build passed. Evidence: /tmp/orbyn-plugin-execute-regressions.log,
/tmp/orbyn-plugin-execute-final-types.log, /tmp/orbyn-plugin-execute-build.log.

Main integration repeated all 74 checks successfully, and workspace typecheck
and build passed. Evidence: `/tmp/orbyn-plugin-execute-main-regressions.log`,
`/tmp/orbyn-plugin-execute-main-types.log`, and
`/tmp/orbyn-plugin-execute-main-build.log`. Full-suite validation subsequently passed after the calendar fixture correction: 1,991 passed, zero failed, cancelled or skipped. Image orbyn-plugin-execution:dda1804 built
successfully. Its compiled service passed health/disabled-route/first-party
isolation checks and an enabled smoke check of plugin OAuth identity, shared
get_context reads, rejection of session credentials and two concurrent writes
creating one task with a replayed receipt. The enabled check verified the test
marker before seeding fixtures, then removed them. It used a separate marked
database from the full suite. It did not contact a provider or prove OAuth
issuance. Logs: /tmp/orbyn-plugin-execute-docker-build.log,
/tmp/orbyn-plugin-execute-docker-smoke.log, and
/tmp/orbyn-plugin-execute-docker-enabled-smoke.log.

OAuth issuance remains MCP-only. This does not deliver plugin launch/resource
UI, asynchronous events/reconnect cursors, host approval or provider inference.
Those contracts and their security evidence remain open before enabling the
plugin recipient in production. The UI preview permission is still denied by
Browser Use despite the user authorizing a retry; it has not been bypassed.

### Full-suite follow-up: calendar fixture

The first full execution-checkpoint run completed with 1,989 passing tests and
one failure (1,990 total), not a green result. The agenda-days fixture advanced
Melbourne calendar dates by fixed 24-hour durations; a three-day jump from late
evening crossed the daylight-saving change and landed on the next local date.
The fixture now constructs noon on its requested date via zonedInstant. An
explicit late-night DST regression demonstrates the former mismatch; all 13
agenda checks passed after the correction. Agenda production code is unchanged.
Evidence: /tmp/orbyn-plugin-execute-main-full-tests.log and
/tmp/orbyn-agenda-calendar-fixture-final-tests.log. The unchanged corrected checkpoint 8f7836d completed its full rerun with 1,991 passed, zero failed, cancelled or skipped. Evidence: /tmp/orbyn-plugin-execute-main-full-rerun.log.

## Required next work and acceptance

1. Add a configured plugin resource and disabled-by-default service boundary;
   advertise only enabled services. Never derive recipients from host headers.
2. Discriminate consent/grants by recipient; bind codes, access tokens, refresh
   families and connector principals to that same recipient. Legacy unbound
   credentials stay MCP-only. Test wrong-resource and wrong-issuer credentials,
   cross-service refresh, revocation, duplicate callbacks and account switches.
3. Build the plugin principal from live grants/memberships/policies. Share typed
   domain capabilities and their transactions; do not proxy first-party routes.
4. Define launch context, bounded resource/tool inputs, UI resources with CSP,
   asynchronous events/results and reconnect cursors. Host metadata cannot widen
   authorization. Provider calls use authorized managed/BYO providers only.
5. Prove 401/403/400/429, inaccessible tools, tenant separation, event cursors,
   durable write receipts and maintenance controls. Preserve portable MCP tests.
6. Validate actual supported host/plugin surfaces and record external approval
   gates. Unit helper checks are not authorization or host-delivery evidence.

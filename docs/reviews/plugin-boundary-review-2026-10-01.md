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

## Principal policy foundation (local)

`Principal.via` now has an explicit `plugin` identity. Both policy ceilings and
live reachable-team filtering classify it as an outside agent. A linked system
administrator cannot bypass a team's agent-off/read/suggest policy; viewer roles,
read-only narrowing and personal-space restrictions still apply. Structured
connection context labels this identity as plugin rather than session.

Two new policy unit tests and seven existing visibility checks passed together
(nine passed, zero failed or skipped). Backend typecheck passed. This foundation
does not yet authenticate or construct a real plugin principal; that resolver
and the plugin service remain required before plugin authorization is enabled.

The resource/grant/token hardening was integrated into local main as `7f264a5`.
Workspace typechecks/build passed there. Image
`orbyn-connector-isolation:7f264a5` rebuilt successfully and its compiled resource
guards preserved a bound plugin recipient and rejected cross-resource selection
with networking disabled. Main's full suite is still running, and this code
checkpoint has not yet been pushed. Principal-policy changes are separate local
work and are not covered by that main image or running suite.

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

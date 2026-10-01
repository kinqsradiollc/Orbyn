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

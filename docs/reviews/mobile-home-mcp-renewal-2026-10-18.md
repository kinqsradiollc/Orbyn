# Mobile landing and renewable MCP consent — 18 October 2026

Baseline: `62fe9bd5`. Branch: `codex/mobile-home-mcp-renewal`.

## Changes

- Landing-page supporting prose, platform text and preview metadata use neutral
  text tokens; phone header/actions/kicker/metadata wrap at the available width.
- `OAuthCheck.can_stay_connected` advertises a consent capability. The page
  offers an explicit, initially selected Stay connected checkbox and sends
  optional `stay_connected`. Older servers do not receive the new field.
- Consent encodes that choice in the authorization code's existing scope.
  Explicit true permits rotating refresh issuance even if the host omitted
  offline_access; explicit false declines renewal even if requested. Omission
  retains the prior host-requested behavior for older consent clients.
- No token-expiry/replay/revocation checks, grant duration, data permissions,
  environment variables or migrations change. No new token secret storage.

The access-only authorization path is confirmed in source: omitted
`offline_access` previously produced no refresh token. This is a reproducible
cause of a later renewal prompt, not evidence of the owner's specific incident.
A read-only live Orbyn context call succeeded during investigation; this proves
current reachability only. Existing access-only credentials cannot be upgraded
inside a host; one new consent after deployment is required.

## Build/type evidence

All exited 0:

- `npm run build:packages` — `/private/tmp/orbyn-oct18-packages.log`
- `npm run typecheck --workspace backend` — `/private/tmp/orbyn-oct18-backend-types.log`
- `npm run typecheck --workspace desktop` — `/private/tmp/orbyn-oct18-desktop-types.log`
- `npm run typecheck --workspace mobile` — `/private/tmp/orbyn-oct18-mobile-types.log`
- `git diff --check`

No tests were added or run. No Tester, Visual Check or Reviewer assignment,
production operation, host reauthorization or long-duration renewal measurement
ran, preserving the owner's explicit delivery preference. The mobile screenshot
is the supplied evidence; the updated pixels are not claimed verified.

## Protocol references

- MCP refresh-token guidance treats offline_access as optional for clients:
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/basic/authorization/index.mdx#refresh-tokens
- OAuth refresh-token issuance is authorization-server discretion:
  https://www.rfc-editor.org/rfc/rfc6749.html#section-1.5

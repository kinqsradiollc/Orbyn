# OAuth recipient display checkpoint

The authorization check now returns the server-selected recipient. The consent
screen distinguishes portable MCP connections from plugin integrations and shows
the canonical recipient URL as text. Older API responses remain supported.

The initial display checkpoint did not enable plugin OAuth issuance. Subsequent
local work selects the configured recipient in consent and token exchange,
discriminates existing and inserted grants by recipient, and keeps omitted
refresh resources bound to the original recipient. An empty plugin URL still
disables plugin authorization. This work remains local pending the visual and
host acceptance gates; it has not enabled production plugin issuance.

## Evidence

- Workspace `npm run typecheck`: passed, including rebuilding isolated core and
  API-client packages in this worktree.
- OAuth integration suite: 28 passed, including the server-selected recipient
  assertion (`/tmp/orbyn-consent-recipient-tests.log`).
- Recipient label source-control tests: 2 passed
  (`/tmp/orbyn-consent-recipient-label-final-tests.log`). These execute the actual
  component function with JSX stubs; they do not prove browser layout or native
  interaction. An initial test-harness exports binding error was corrected before
  this final run.
- `git diff --check`: passed.

Visual review remains pending because Browser Use reports a saved permission
block for the local preview. Keep this checkpoint local until that review is
available. The prior production checkpoint on main is independently validated;
its full-suite result does not validate these new changes.

## Recipient issuance evidence

- OAuth integration suite: 29/29 passed, including real consent, code issuance,
  wrong-recipient rejection, plugin token issuance, wrong-recipient refresh
  rejection, omitted-resource rotation, and separate MCP/plugin grants for the
  same user and client. Stored plugin token recipients remain the plugin URL.
  Evidence: `/tmp/orbyn-plugin-recipient-oauth-final-tests.log`.
- Backend typecheck and diff checks passed after the final source changes.
- Plugin service, authentication, principal, recipient helper and consent label
  regressions: 21/21 passed. Evidence:
  `/tmp/orbyn-plugin-recipient-service-regressions.log`.
- An initial new test attempted to reuse a code after a failed exchange. The
  existing implementation deliberately consumes codes on failed exchanges;
  the corrected test obtains fresh consent and preserves that security behavior.

## Issued credential service acceptance

The expanded OAuth suite passes 29/29 after testing the issued credentials on
the actual dedicated plugin service. Plugin tokens resolve to the authorizing
account; a second account receives a distinct grant and principal. MCP tokens
and browser sessions receive 401 on the plugin service, and plugin tokens receive
401 on MCP. Revoking the plugin grant blocks both plugin access and refresh while
the independent MCP refresh remains usable. Evidence:
`/tmp/orbyn-plugin-issued-service-final-tests.log` and
`/tmp/orbyn-plugin-issued-service-final-types.log` (backend typecheck passed).
These injected service checks do not prove a host's browser/account-switch UX.

Remaining acceptance includes browser consent review, plugin metadata/host
launch, host account-switch UX, events/resources,
provider credential boundaries, full-suite validation and deployment wiring.

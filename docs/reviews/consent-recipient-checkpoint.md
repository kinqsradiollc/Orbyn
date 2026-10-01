# OAuth recipient display checkpoint

The authorization check now returns the server-selected recipient. The consent
screen distinguishes portable MCP connections from plugin integrations and shows
the canonical recipient URL as text. Older API responses remain supported.

This checkpoint does not enable plugin OAuth issuance: the current authorization
validator still accepts only the MCP recipient. Plugin consent, token issuance,
refresh binding, and host launch acceptance remain pending.

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

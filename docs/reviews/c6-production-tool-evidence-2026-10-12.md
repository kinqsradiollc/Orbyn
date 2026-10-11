# C6 post-deployment connector evidence — 12 October 2026

## Provenance

The owner reports deployment completed and authorizes testing. Expected main
checkpoint is `f81463e2`, containing locally accepted runtime `8f99272c`.
The owner did not supply the deployed hash; neither call below independently
identifies the server image/commit. Keep reported deployment distinct from
verified runtime provenance.

## Read-only connector checks

Builder invoked each already-connected app's `get_context({})` once. No grant,
connection, consent, provider permission or production data was changed.

| Connection | Observed result | Scope proved |
| --- | --- | --- |
| Orbyn | `isError=true`, `error_code=UNAUTHORIZED`; host message: “This app connection requires reauthentication. Reconnect the app and try again.” | Current connection cannot make authenticated calls. This does not establish a server regression or the cause of token invalidation. |
| Orbyn Plugin | `isError=false`; structured connection kind is `plugin` | Existing legacy recipient still serves an authenticated read. This does not qualify canonical `/mcp`, previews, Docs edits or deployed source. |

No account name, private item text, token or personal identifier is copied here.
The connection error itself does not reveal its configured URL. Visual Check
was asked to inspect the canonical entry and reconnect/sign-in step, preserving
Orbyn Plugin. The user must handle any required third-party account consent.

## Remaining gates

Canonical discovery/issuer, fresh authenticated `/mcp` connection, negotiated
previews and portable fallback, synthetic Docs Markdown/Mermaid/edit/conflict/
proposal interaction, supported host files/mentions, account/reconnect/revocation
and live managed/BYO qualification remain open. No new visual, host or full-C6
pass is claimed by these two connector calls. U1 remains unstarted.

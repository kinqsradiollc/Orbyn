# C6 post-deployment connector evidence — 12 October 2026

## Provenance

The owner reports deployment completed and authorizes testing. Expected main
checkpoint is `f81463e2`, containing locally accepted runtime `8f99272c`.
The owner did not supply the deployed hash; neither call below independently
identifies the server image/commit. Keep reported deployment distinct from
verified runtime provenance.

Later on 12 October, the owner supplied server `git rev-parse --short HEAD`
output `de83f54b`. Local ancestry confirms that commit contains accepted source
`8f99272c`; this establishes owner-reported checkout provenance, not independent
container-image or wire-response provenance. At the owner's request, Builder
opened ChatGPT in this session's internal browser to perform reconnect directly.
That browser is signed out, so host testing awaits its account sign-in; the
existing authenticated MCP connector remains separate from this browser session.

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

## Successful retry after owner sign-in

The owner completed sign-in. A subsequent canonical Orbyn `get_context({})`
returned `isError=false` and connection kind `oauth`. The initial unauthorized
result above is retained as history; canonical authenticated access now works.

Builder created one explicitly labelled synthetic Personal fixture:
`doc:07775a91-a645-433c-930a-c79f9a5c68c4`, titled
`[QA] C6 canonical MCP preview — 2026-10-12`. Existing personal documents were
not edited. The fixture includes Markdown emphasis, inline code, a table, a
Mermaid source block, a link and one editable QA line.

| Check | Observed result |
| --- | --- |
| Canonical create and fetch | Success, fixture version 1; complete anchored Markdown returned. |
| Anchored save | Success, version 1 → 2; only the synthetic QA line changed. |
| Exact request replay | Same client reference returned version 2; no duplicate change. |
| Stale write with a new client reference | Rejected; text reports `VERSION_CONFLICT`, structured code is `INVALID_ARGUMENT`. |
| Fetch after stale write | Version 2 and intended QA line retained; stale text absent. |

The connected create/fetch responses expose no `_meta` fields. This observation
does not establish whether the host strips metadata, previews are disabled, or
the deployed runtime differs. Rendered card capability remains a separate check.
Builder handed the fixture writer to Visual Check at version 2 for the actual
host Review → Submit interaction. These API calls do not prove that UI flow.

## Remaining gates

Canonical discovery/issuer, negotiated
previews and portable fallback, synthetic Docs Markdown/Mermaid/edit/conflict/
proposal interaction, supported host files/mentions, account/reconnect/revocation
and live managed/BYO qualification remain open. No new visual, host or full-C6
pass is claimed by the connector and fixture calls. U1 remains unstarted.

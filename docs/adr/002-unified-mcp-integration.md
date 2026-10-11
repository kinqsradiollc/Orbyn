# ADR 002 — One MCP connection with optional previews

Status: local runtime checkpoint accepted in round 2/3 and pushed to main at
`4f9e8e88` (accepted source `8f99272c`); production canonical-host qualification
remains pending.
Owner direction: 11 October 2026.

## Decision

Expose one canonical connection at `MCP_PUBLIC_URL`, normally
`https://mcp.orbyn.dev/mcp`. That connection provides Orbyn tools and supported
interactive previews. Users should not need to choose between “MCP” and “Plugin”.
Plugin registration is a host packaging choice, not a second Orbyn account or
public endpoint. Keep managed/BYO inference execution isolated internally and
subject to separate explicit permission, model selection and allowance.

MCP Apps supports UI resources on ordinary MCP tools. A capable host can render
them; other hosts receive usable text/structured results. See the
[official overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)
and [specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx).

## Preview contract

Every tool result must have a concise, understandable result or error. Provide a
matching UI resource for supported result families; do not require a popup for
every call or manufacture a preview before execution has succeeded.

| Result family           | Presentation                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| Read/search             | Compact list or detail with authorized source links                         |
| Plan/proposal           | Proposed changes and consequences; existing review authority applies        |
| Completed mutation      | Change receipt and available Undo; no duplicate mutation on render          |
| Import/background job   | Current progress, recoverable error and authorized reconnect state          |
| Markdown file           | Host-supported resource editor, writable metadata, ETag/conflict protection |
| Orbyn document          | Authorized document preview, source links and permitted edit/review actions |
| Error/empty/unsupported | Short truthful state and useful next action; structured/text fallback       |

Today opens an empty bootstrap and reads only after the person's explicit action.
Mentions expose authorized titles/links only. Preview rendering must not expand
scope, expose private Memory or trigger inference, writes or notifications.
UI actions recheck the same live grant and source visibility as ordinary calls.
Host extensions are negotiated; an absent extension is not a successful test.

## Docs through the unified connection

Document tools share `/mcp` and the same permission checks as other Orbyn tools.
Render supported Markdown families and Mermaid using shared, bounded rendering
contracts; preserve structured document format and line anchors when editing.
Reuse the existing Docs/export implementation where its dependencies allow it,
without importing an app into shared packages or backend code.

Read-only grants show previews and links. Editing requires the grant's write or
proposal authority, current visibility and revision checks. Show an explicit
change preview/review state where required; do not save merely by rendering.
Proposal authority never becomes direct-write authority; applying a proposal
still follows the existing owner review/approval contract.
Conflicts and failed saves retain drafts. File-resource editing also requires
host writable metadata and ETags; it is distinct from editing an Orbyn document.

Treat document text, HTML, links and diagrams as untrusted content. Sanitize
rendered HTML/SVG, bound diagram/render work, and retain sandbox/CSP protections.
Do not introduce remote scripts or use a document as authority for tool calls.
Unsupported render families and hosts receive a truthful source/text fallback.

## Authentication and compatibility

- New connections use `/mcp` as their exact OAuth resource, with one consent flow.
- Tool access, UI opt-in and managed inference permission remain distinct controls.
  Neither a write grant nor a host capability declaration permits provider calls.
- Preserve immutable token ceilings, audience binding, live revocation, team
  policy, source visibility, rate limits and operation idempotency.
- Keep existing `/plugin` grants and endpoint working during migration. Their
  tokens remain bound to `/plugin`; do not silently reinterpret them as `/mcp`
  credentials or accept a token for the wrong resource.
- A legacy connection moves through an explicit reconnect/consent flow. Retire
  the old route/config only after the owner approves migration and remaining
  connections have a documented recovery path.
- Separate internal inference workers, receipts and provider consent survive the
  public endpoint consolidation. No personal ChatGPT token borrowing or paid
  fallback is introduced.
- Coexistence is an invariant from the first deployable candidate: both existing
  recipients retain discovery/challenges, refresh, active-job reads and reconnect.
  Never redirect bearer requests from `/plugin` to `/mcp`. New grants do not
  inherit old operation IDs, cursors, results, inference consent or reservations.
- Define a compatible rollback image and additive schema strategy before rollout.
  Rollback must stop new unified inference dispatch while preserving accepted and
  uncertain receipts and their reservations; it must not repeat unknown calls.
  Do not assume an older image understands new recipient-bound jobs. Retain the
  legacy route until its explicit retirement is separately approved.

## Environment contract

`MCP_PUBLIC_URL` is the final canonical external setting. During the transition,
`PLUGIN_PUBLIC_URL` and Compose's `plugin` profile still serve the deployed legacy
recipient. Keep their current values. **Do not set both public URLs to `/mcp`:**
the current runtime rejects equal recipients, and changing env alone is not this
migration. No connector URL or server secret belongs in client env files.

After implementation, reconcile schema, Compose/gateway, deploy preflight,
`.env.example`, private `.env.production` and affected local env files together.
Preserve existing secrets and unrelated settings. Keep the single example per
workspace; do not recreate `.env.production.example`.

## C6 implementation order

1. Establish recipient coexistence and rollback invariants above, then consolidate
   tool/UI/resource registration and dispatch behind `/mcp`; preserve
   current portable clients, approved tools, optional extensions and text fallback.
2. Adapt consent/provider permission and internal inference routes for canonical
   MCP grants, with no automatic permission promotion for existing connections.
3. Add the remaining result-family previews and host capability negotiation;
   retain compact content, permission filtering and mutation/recovery guards.
4. Complete explicit reconnect while maintaining recipient coexistence, then align
   environment schema, services, gateway, preflight and all relevant templates.
5. Freeze the complete scope → Tester → Reviewer (maximum three full rounds).
   Preserve the closed C6 round 1/3 and its evidence; this newly requested runtime
   scope needs qualification and does not inherit that approval or reset the count.
   Test audience confusion, unchanged legacy behavior, grant ceilings, revocation,
   model/allowance enforcement, previews/fallback, repeated actions and conflicts.
6. Push the accepted local checkpoint to main; the owner deploys it. Then qualify
   real-host tools/UI, supported file resources and scoped mentions. Route bounded
   visual checks through Orbyn Visual Check. Full C6 acceptance follows actual
   host evidence; legacy retirement requires the owner's separate approval.

This replaces C6's requirement for two permanent public integration endpoints.
It preserves its feature, authority and inference requirements. C6 remains open;
U1 follows its full accepted delivery. Existing `/plugin` production read and
Today evidence proves the legacy path only, not this pending migration.

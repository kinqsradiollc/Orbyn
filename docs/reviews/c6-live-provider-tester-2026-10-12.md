# C6 live Workspace AI Tester supplement — 12 October 2026

**Checkout:** `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`

**Branch:** `codex/c6-file-viewer`

**HEAD:** `f47c242f050a071fd6373e03a1d7412c591f75ff`

**Review cycle:** existing round 2/3; this bounded receipt check does not start a new round.

**Scope:** read the existing Workspace AI receipt and reconcile its evidence limits with retained C6 acceptance.

## Tester observation

I called `get_context({})` first. The current Orbyn connection reports OAuth,
client `Codex`, write access, and the Workspace toolset. I then read the
existing receipt using `get_workspace_ai_status` keyed by the supplied receipt
ID. It returned:

| Field | Observed value |
| --- | --- |
| Receipt | `200f7721-4308-40ce-8ce7-32c635274828` |
| Operation | `01a12d5a-64be-7c5c-8008-1782d0730e57` |
| State | `done` |
| Model / provider ID | `matilda` / `0ffa0d3a-5dbe-4b80-941c-bf04b7522a95` |
| Status events | `queued` at `2026-10-11T23:45:36.113Z` → `running` at `2026-10-11T23:45:37.695Z` → `done` at `2026-10-11T23:45:40.800Z` |
| Returned text | `C6 live provider verified.` |

The receipt's `created_at` is `2026-10-11T23:45:36.100Z`. A status lookup
using the operation ID as the lookup `id` returned `NOT_FOUND`; using the
receipt ID returned the record above. Both were read-only calls. Tester did
not call `request_workspace_ai`, replay the operation, or dispatch another
provider request.

## Evidence disposition

The status read independently confirms one completed provider-backed
Workspace AI operation on the current OAuth Codex connection, with the model,
provider ID and exact synthetic response shown above. Builder's earlier
pre-permission attempt returned `FORBIDDEN` without a receipt; that is retained
as boundary evidence and is not a successful dispatch. The
[Builder's production-tool evidence](c6-production-tool-evidence-2026-10-12.md)
identifies this as the selected canonical MCP connection, records the owner's
permission enablement, and reports that replaying the exact operation and
prompt returned the same receipt ID, original creation time and `done` state.
The replay result is Builder-supplied evidence; Tester did not repeat it.

The status record does not expose the endpoint URL, server/container image
hash, configured daily allowance, token usage, or provider mode. Builder
reports the owner-provided server checkout and container flag separately; this
receipt cannot correlate that deployment metadata to the running response, so
it does not establish that local `HEAD` or `29f94942` served the request. One
successful request is established for this connection, not a full managed/BYO
provider matrix or an isolated QA-account grant.

The current checkout is at `f47c242f`; `29f94942` is its ancestor, and
`git diff --quiet 29f94942..HEAD -- backend` exited 0. This preserves the
accepted [focused launcher correction](c6-widget-launcher-tester-2026-10-12.md)
as the source baseline for this supplement. Its canonical 8/8, legacy 16/16
and backend typecheck remain scoped to that correction. The earlier accepted
[unified-MCP correction batch](c6-unified-mcp-tester-r2-8f99272c-2026-10-11.md)
remains 58/58 for its own exact scope; these receipts are not combined or
re-run here.

## Retained open gates

This receipt updates only the earlier statement that no live provider request
had completed. It does not establish:

- a dedicated synthetic QA account and fresh canonical grant; the prior local
  signup attempt submitted no form because the Terms and Privacy panes could
  not load;
- the exact configured allowance or actual token usage, another provider/mode,
  or live failure, timeout, cancellation and revocation behavior;
- full canonical discovery/issuer and negotiated-preview/fallback behavior;
- the remaining Docs Markdown/Mermaid, conflict/draft-retention and
  denied/proposal interactions. Builder separately observed one host
  Edit → Review → Submit path; it is not retested by this supplement;
- supported host files and mentions, or account switching/reconnect/revocation.

Per the owner's stop instruction, this supplement performs no browser, visual
or native checks. Host uploads remain deferred. The previously accepted focused
local work and the open host/provider requirements remain separate; full C6
canonical-host acceptance is still open, U1 remains unstarted, and Reviewer
disposition for full C6 is pending. No test suite, build, scan, source edit,
production change or deployment was performed by Tester.

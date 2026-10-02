# Docs export save qualification — 3 October 2026

## Frozen source

`7cd75934175324892a22d151f0927adf21685c2b`, branch `codex/docs-source-preview`.
Full local suite on a dedicated database ending `_test` with the server-side
`orbyn.environment=test` marker: **2,437/2,437 passed**, zero failures, skips or
cancellations, exit0,598241ms. Log: `/tmp/orbyn-docs-save-7cd75934-full-tests.log`.
The source was unchanged throughout that run.

Focused save/export/share/scope checks:49/49 in
`/tmp/orbyn-doc-export-current-focused.log`. Combined workspace typechecks and
production build pass in `/tmp/orbyn-home-muse-types.log` and
`/tmp/orbyn-home-muse-build.log`; full formatting passes in
`/tmp/orbyn-doc-export-current-format.log`.

## What these checks prove

- Editable file actions wait for one queued save and compare against a dedicated
  confirmed receipt, rather than a speculative CRDT baseline.
- Both actual editor implementations reject caught/offline save failures and
  newer typing during a pending save, and carry confirmed versions for all formats.
- Native structural equality accepts equivalent content with separate array
  identities and server-assigned block IDs without accepting changed text/known IDs.
- Readers/suggestion mode use the saved page without applying an unapproved draft.
- Old-page save completions cannot replace the current page's export receipt.
- Scope teardown, native byte conversion/share availability and web fallback
  cancellation prevent stale file handoffs at those boundaries.
- Markdown/PDF share menus call the guarded editor action.

Tests exercise actual functions/modules with mocked external/native handoffs.
They do not prove an OS share sheet or real-device UI behavior.

## Remaining acceptance

- Actual native file save/share and screenshot/layout acceptance.
- Rendered PDF math/diagrams; publication and server-direct rendering parity.
- Reconciliation and combined qualification after newer main checkpoints.
- Complete D1/U1 and model/plugin/runtime acceptance in the governing ADR.

A separate main-based candidate `8b48b1de` fixes file exports using stale replica
reads; its local full suite and CI are still running. Do not attribute that fix
or qualification to this frozen source. Public Home PR157 is separately pending
backend/web CI. No broader PR merge, deployment or cleanup is established here.

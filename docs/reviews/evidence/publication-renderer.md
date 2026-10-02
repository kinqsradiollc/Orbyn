# Published Mermaid rendering and current-authority checks

## Scope

Render the ten supported Mermaid families in public Docs pages through the same
private first-party renderer used for HTML export. Only marked, escaped diagram
sources enter the synthetic renderer document. Password forms, app links and live
publication media URLs stay outside its input. Published pages keep their existing
layout, math and navigation. Output consists of inert SVG image data and retained
escaped source; an invalid diagram gets an explicit unavailable result.

The public response keeps a script/frame-denying CSP and no-store headers,
including authority failures. Before returning generated HTML, a primary read-only
repeatable-read transaction checks the current publication, password, team policy,
page version/membership, public link paths, file references and folder navigation.
Revoked access returns no old page body. Changes return an explicit refresh error.
Renderer authentication, shared two-slot admission, deadline/cancellation, replay
protection and output bounds are inherited without weakening their contracts.

## Evidence and acceptance

Actual renderer integration checks cover all ten families, math/source retention,
password/media separation, invalid source and changes during rendering: unpublish,
Trash, document edit, password replacement, linked-page privacy, team policy,
folder movement and sibling navigation edit. Units refuse malformed, reordered,
executable and external-image fragments, and enforce input/count bounds. Existing
publication security checks remain part of qualification.

Initial focused 36/36 passed. The current expanded combined group passes 38/38
with no skipped, cancelled or failed checks. Log:
`/tmp/orbyn-publication-renderer-focused-3.log`.
Full exact-head local suite, workspace types/build/format and CI are still required
before main promotion. No visual web UI acceptance is claimed from these tests.

This addresses publication rendering and authority, not full Docs/editor/native
sharing or C1–C6/M1/D1/U1 completion. No deployment, release or cleanup occurs.

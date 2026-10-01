# Docs inline Markdown checkpoint

## Delivered source

The shared Docs parser isolates code spans, LaTeX and backslash-escaped ASCII
punctuation before applying inline styles. Code uses exactly matching backtick
runs, preserves embedded formatting as literal text, and applies CommonMark's
surrounding-space and newline normalization. Surrounding styles survive embedded
literal spans. Plain and escaped runs retain source offsets used by comments.

Links become actionable only for HTTP, HTTPS, mailto and valid Orbyn object
addresses. Other schemes, control characters, backslashes, malformed Orbyn links
and protocol-relative addresses retain their source without an actionable URL.
Web, mobile and HTML export consume this shared parser. Markdown storage and
round trips retain the original source; normalization changes the rendered code
span only.

## Evidence

On the model/Docs worktree, 105 focused tests passed with no failures or skips:
new inline/security fixtures, Markdown dialect, document editing, links,
source markers, richer pages and page tags. Database cases used only the marked
`orbyn_plugin_service_20261001_test` database, sequentially. Workspace typecheck
passed. Logs: `/tmp/orbyn-doc-inline-tests.log` and
`/tmp/orbyn-doc-inline-types.log`.

The first run was rejected by the database safety gate because its test URL was
missing; it also exposed an incorrect HTML-export fixture signature and a missing
existing event-link kind. Those were corrected, then the complete focused set
was rerun. No evidence from the failed attempt is reported as passing.

## Remaining acceptance

These tests do not prove browser/native layout or complete CommonMark/GFM parity.
Nested emphasis, reference links, balanced link destinations, frontmatter and
preview synchronization remain part of the broader Docs requirement. Mermaid
rendering/interaction, math/export fidelity and UI containment retain their own
gates. Main integration must be checked on its actual source rather than inferred
from the worktree's other unmerged Docs changes.

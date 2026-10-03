# Markdown parity checkpoint — 3 October 2026

Candidate: `codex/docs-markdown-parity`, based on main `1100ca98`.
This is a scoped extraction from preserved `e7b018db`, not promotion of the broad draft.

## Changes under qualification

- Six heading levels through schemas, parsing, outline, clipboard, Word import/export and both clients.
- CommonMark backtick/tilde fences and preserved initial YAML metadata.
- Page-scoped reference links, first-definition rules, offset mapping, private-label redaction and bounded database reference indexing.
- Web/mobile page reference contexts and HTML fragment resolution. HTML suppresses reference definitions while Markdown preserves their source.

## Evidence

- All workspace typechecks, build and format checks passed after the HTML suppression adjustment.
- Current focused parser/reference/index run: 31/31, no failures/skips/cancellations.
- Current Docs/API/link privacy/D4c/Markdown baseline: 130/130, no failures/skips/cancellations.
- HTML reference check initially failed because its source uses `Guide` and the new assertion used lowercase `guide`. Corrected the assertion to the actual source; reference unit rerun 13/13.
- Previous extraction failures retained in `/tmp/orbyn-markdown-parity-focused.log`, `focused-2.log` and `types-4.log`; dependencies were repaired without weakening privacy assertions.

## Outstanding

- Full current-head local/CI qualification, migration repeatability/security checks, rendered/native editor acceptance.
- Definitions outside an embedded section need authorized page-scoped context; section-only reference maps do not establish that parity.
- Definitions remain editable source in the editor; read-mode presentation and friendly metadata naming require completion.
- Source/preview editing and client fragment navigation remain in the broader source candidate.
- This checkpoint does not establish complete CommonMark/GFM or the full D1/UI ADR gate.

Home remains a separate candidate (PR165). Server diagram readability is merged (PR167, main1100ca98; local2322/2322 and all four CI jobs passed). No deployment or cleanup.

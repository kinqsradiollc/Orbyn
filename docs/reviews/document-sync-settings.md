# Document synchronization and Settings corrections

Decision: [ADR006](../adr/006-document-consistency-and-settings.md).
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Branch: `codex/document-sync-settings`. Baseline: `b5ee4dd0`.
Phase: batched correction after initial qualification. Review counter: 1/3. Builder owns source; delegated Builder specialists have disjoint documented file scopes. Root owns QA fixtures.

| Requirement                             | Current state                                                                            | Acceptance evidence                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| One document across Note/Markdown/LaTeX | Implemented; correction qualification pending                                            | Round trip edits, identity/containers and actual UI |
| Starter preview                         | Implemented; correction qualification pending                                            | Actual default input, valid/error/repair            |
| MCP reliability                         | Confirmed OAuth race/client/recovery fixes implemented; owner incident cause unconfirmed | Reproduced lifecycle + recovery/revocation          |
| Activity width                          | Implemented; correction qualification pending                                            | Shared modal sizing and narrow layout               |
| Settings row/detail navigation          | Implemented; correction qualification pending                                            | Back/search/deep links/guards/drafts                |
| Agent categories/customization          | Implemented; correction qualification pending                                            | External vs Orbyn grouping, actual editor flow      |
| Test → Review                           | Initial candidate qualified; correction retest pending                                   | Frozen source, max3 rounds                          |
| Visual web/Expo                         | Initial batch recorded; bounded closure pending                                          | One bounded changed-flow batch                      |
| Main delivery                           | Pending acceptance                                                                       | Verified remote ref                                 |

Keep unrelated dirty `c6-production-visual-2026-10-11.md` unchanged. Existing owned
preview processes5174/8083 and guarded local API8008 may be reused. The saved
Browser denial for the owner's in-app127.0.0.1 origin remains binding; no alternate
surface or indirect route may be used to observe that denied page. Screenshots
supplied by the owner and permitted owned QA fixtures provide scoped evidence.

## Development receipts (not formal acceptance)

- Character implementation `e4cf3ade`; backend recovery `f1eed081`; document
  synchronization `dac26c6d`; Settings behavior tests `04269a9e`.
- Document focused developer tests 77/77; OAuth/agents 55/55 plus one
  consent-expiry case; Settings details 8/8. Shared/client/backend type receipts
  exist, but complete candidate qualification remains pending.
- Read-only live Orbyn MCP `get_context` succeeded on 16 October; OAuth consent
  expires October 2027. No token, workspace content or production mutation was
  exposed. This is present reachability, not intermittent-failure resolution.
- No env/config/service/migration changes are required. Strict rotation remains;
  no replay grace or sender-binding assumption has been introduced.
- Whole-document TeX supports existing plain text/equation edits; structural and
  rich conversions retain unsupported drafts. Standalone TeX remains distinct.

Settings developer regression batch: 43/43 across eight affected files after
updating outdated fixture assumptions (initial 32/43, intermediate 40/43). New
product-level visual checks remain pending. Parent identity Save/Cancel now
protects lane/reload changes while a customization draft exists.

## Round 1 correction batch

Initial product freeze `a926336a`; formal Tester report `b68fdb5d` records
77 document, 43 Settings and 56 OAuth/agents passes plus builds/types/assets.
Visual initial report `082eb0ee` records actual canonical prose/equation
round trips, retained unsupported drafts, Settings navigation/grouping,
customization Cancel and Activity geometry; it preserves unrun cases.
Reviewer found R1-01 (server normalization left profile drafts dirty) and R1-02
(global null-command preprocessing could change nonempty source). Both are
being corrected in this same round. Do not reset the round counter.

Developer regression sequence: 12/15 passed before corrections (two normalized
profile failures plus literal-command case), 14/15 after product fixes (the
remaining renderer assertion assumed unsupported verbatim rendering), then
15/15 with direct actual-preprocessor preservation coverage and the bundled
historical-starter renderer test retained. Logs `/private/tmp/orbyn-adr006-correction-*`.
No verbatim rendering support is claimed. New profile tests exercise actual
callbacks and dirty-state expression; actual UI acceptance remains separate.

The owner's 15:09 screenshot adds a minimal-controls correction: source-pane
Export PDF and routine explanatory content are removed; header Download is the
single export entry. `421f0903` includes guarded canonical/embedded routing and
49/49 scoped developer tests. An extra legacy test attempt passed 53/54 with an
unchanged DocsSheet assertion failure; it is not a pass or a new source defect.

Owner clarified that Codex/ChatGPT prompt for Orbyn reauthorization after a
while, without a captured error. AS metadata correctly advertises refresh and
`offline_access`; MCP protected-resource metadata intentionally omits it per
protocol guidance. No unrequested renewable access is granted. Consent
capability diagnostics distinguish access-only sign-ins from renewable ones;
they do not prove which path caused the owner's production incident.

## Expanded owner corrections (same round 1)

Red line/column diagnostics, removed Help/export duplication, settled selection,
one existing contextual menu, responsive draggable navigation and consistent
collapsible Library are included before the next freeze. Owner rejected the new
Ask/Explain source popup; it has been removed in favor of the existing assistant
icon and retained selected excerpt. Owner also removed the document Back button.

Developer navigation regression receipt: 21/21 across toolbar, sidebar-width,
workspace-layout, editor-input-ownership and visual-corrections tests, recorded in
`/private/tmp/orbyn-adr006-navigation-dev.tap`. Desktop typecheck passed. This is
development evidence, not final rendered acceptance. Earlier DocsSheet fixture
failure was updated to assert the actual flex/min-height editor ownership now
that DocsSheet is part of this correction scope. Final integrated freeze pending.

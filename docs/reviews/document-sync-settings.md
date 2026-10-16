# Document synchronization and Settings corrections

Decision: [ADR006](../adr/006-document-consistency-and-settings.md).
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Branch: `codex/document-sync-settings`. Baseline: `b5ee4dd0`.
Phase: candidate preparation. Review counter0/3. Builder owns source; delegated Builder specialists have disjoint documented file scopes. Root owns QA fixtures.

| Requirement                             | Current state                                                                            | Acceptance evidence                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| One document across Note/Markdown/LaTeX | Investigating                                                                            | Round trip edits, identity/containers and actual UI |
| Starter preview                         | Investigating                                                                            | Actual default input, valid/error/repair            |
| MCP reliability                         | Confirmed OAuth race/client/recovery fixes implemented; owner incident cause unconfirmed | Reproduced lifecycle + recovery/revocation          |
| Activity width                          | Investigating                                                                            | Shared modal sizing and narrow layout               |
| Settings row/detail navigation          | Investigating                                                                            | Back/search/deep links/guards/drafts                |
| Agent categories/customization          | Investigating                                                                            | External vs Orbyn grouping, actual editor flow      |
| Test → Review                           | Pending complete code                                                                    | Frozen source, max3 rounds                          |
| Visual web/Expo                         | After all code                                                                           | One bounded changed-flow batch                      |
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

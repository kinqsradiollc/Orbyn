# C4/D1 delivery record

Started 10 October 2026 from pushed main `6410c65c` on
`codex/c4-docs-parity`. Builder owns implementation until the complete stage
is ready for one frozen Test → Review handoff. Review round: **0/3**.

| Area                      | Current evidence                                                                                           | Remaining work                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Versioned storage and API | Format 1/2 validation, guarded reads/writes and history already on main.                                   | Complete normal editing and all legacy writer paths without flattening ownership.                                 |
| Offline recovery          | Integrated candidate `a4b85392`; 11 focused cases, shared build, backend/mobile types and formatting pass. | Connect complete ownership to both active editors and exercise mounted recovery.                                  |
| Editing and collaboration | Shared `DocContentStore` and container renderers exist; normal editors still keep flat block drafts.       | Full tree load, leaf and structural edits, task identities, source, concurrent saves, comments, history and CRDT. |
| Markdown and export       | Shared parser/source plus several export adapters exist.                                                   | Round-trip matrix for all required syntax and real Word/PDF/HTML/privacy cases.                                   |
| Mermaid and math          | Bundled renderers exist on web and mobile.                                                                 | Required family, malformed, zoom/source and export matrix on accepted candidate.                                  |
| UI                        | Existing source/preview views and nested renderers exist.                                                  | Integrate with one editor draft/revision on both clients; bounded web and Expo-web checks for changed flows.      |

User excludes separate desktop-app, installed iOS/Android and 200% checks.
Production deployment remains user-owned. No C4/D1 acceptance or main merge is
claimed by this record.

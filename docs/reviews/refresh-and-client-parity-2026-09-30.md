# Refresh recovery and client parity release audit

This release work follows C1a (`0fe0a0e`) and takes priority over the remaining
DevDay implementation sequence. The retained ADR requirements remain open.

## Refresh 429

Confirmed locally: overlapping initial loads issue duplicate requests for lists,
tags, planner preferences, planned time and Today. React development replay also
starts overlapping initial effects. The shared client previously sent every read
separately and surfaced HTTP 429 immediately, even when Retry-After explained
when the existing allowance recovered. The API uses an IP bucket for ordinary
sessions; proxy configuration and concurrent tabs may contribute to a production
failure. The exact production failing route/body has been requested and is not yet
available. Do not claim the production cause has been conclusively reproduced.

Implemented in this release batch:

- Coalesce concurrent ordinary JSON GETs by account, path and mutation generation.
  Each reader receives its own parsed object. Completed reads are not cached by
  this mechanism. Fresh reads, custom headers, raw responses and caller signals
  retain independent transports. Failed pending reads are evicted.
- GET 429 waits for a valid Retry-After and retries once, bounded to 60 seconds
  and half the configured request timeout. Missing, invalid or excessive delays
  remain errors. Writes are never retried for 429. Continued 429 remains visible.
- Keep authentication, authorization and server rate limits intact.

Evidence: 13 new regression cases and 12 existing transport/poll/scaling cases
passed together (25 total). The final complete suite passed 1,758/1,758 tests, including the folder
announcement regression; the focused folder route suite also passed 20/20.
All workspace typechecks, production builds and native/web exports passed.
Fresh no-cache backend and desktop Docker images also built successfully.

Live acceptance used a separate marked test database on API port 8009, web 5174
and mobile web 8083. A synthetic GET /folders 429 with Retry-After: 1 recovered
with HTTP 200 about one second later. Mobile web archive/restore propagated to
both desktop and native iOS without manual refresh. A build-driven reload burst
also exhausted the ordinary IP bucket: recovery remained bounded and writes
were not replayed. This does not prove the exact production failure is resolved.
Android bundle export passed; native Android interaction remains unverified.

## Feature parity audit

A source call inventory was used to locate candidates, followed by reading the
actual controls. Differences in method calls alone are not proof of a missing
feature: multiline calls and equivalent flows must be inspected.

| Area                          | Current evidence                                                                                                                             | Delivery status                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Folder archive/restore        | Web supports whole-folder archive/restore. Mobile has page archive but no folder controls, and active folder lists include archived folders. | Delivered controls, active-list filtering and folder refresh; web/mobile web/iOS interaction and cross-client propagation passed. |
| Page/project appearance       | Mobile Look.tsx explicitly renders covers/icons read-only; DocEditor has no appearance mutation. Web has icon/cover selection.               | Confirmed open gap; implement shared behavior and mobile controls.                                                                |
| Save project as template      | Web ProjectDetail calls templateFromProject; mobile ProjectsSheet only consumes existing templates.                                          | Confirmed open gap; add mobile creation and permission/error feedback.                                                            |
| Clipper connection management | Web settings list/create/delete Clipper keys; mobile has no corresponding settings calls.                                                    | Open candidate: inspect expected phone setup flow and connection UI.                                                              |
| Passkeys                      | Web registers and authenticates with passkeys. Mobile uses ordinary auth and has no native passkey calls.                                    | Open delivery gap; native platform configuration and real callbacks are required.                                                 |
| Mermaid                       | Web uses Mermaid; mobile RichBlocks has a custom flowchart parser and source fallback for other diagram families.                            | Confirmed D1 gap; cover all retained families with strict rendering and native proof.                                             |
| Calendar drop placement       | Web supports createBlockOnDay; mobile uses explicit block placement.                                                                         | Interaction candidate, not yet proven missing capability.                                                                         |
| Public links/OAuth callbacks  | Public booking, RSVP, account callbacks and connector consent are web routes, reached by shared links.                                       | Platform boundary; verify phone deep-link handoff before calling these missing.                                                   |
| Developer catalog             | Web DeveloperPage exposes developerCatalog; mobile has no dedicated developer surface.                                                       | Inspect against A11 plugin requirements; backend integration remains separate.                                                    |

Extend this ledger as each affected current surface is inspected. Existing
R1–R10 fixes and exports do not prove every feature is available or correctly
laid out in both clients. Test shared state, stale responses, permissions,
viewport/keyboard behavior and native interaction for every added flow.

## Additional confirmed defects fixed

- Folder archive/restore previously emitted no live event. It now announces the
  owning account or team after commit; rejected writes emit nothing.
- Both presence hooks previously announced only presence after reconnect. They
  now refresh missed changes, while initial connection avoids an extra data load.
- An imported all-day event without DTEND used 24 elapsed hours for its end.
  Melbourne daylight-saving transitions need the next local midnight instead.
  Nominal day/week durations now use calendar days as well. Regression coverage
  includes both 23-hour and 25-hour days and P1D/P2D/P1W durations. See
  [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1).

## Test isolation

An earlier suite shared a database with the preview assistant runner, which
claimed test jobs and caused six failures. Separating the preview database removed
those failures. The remaining DST failure was fixed and the complete suite rerun.
No production account, provider request or production database was used.

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
| Page/project appearance       | Mobile Look.tsx explicitly renders covers/icons read-only; DocEditor has no appearance mutation. Web has icon/cover selection.               | Page/project controls implemented and verified on mobile web/iOS; Home hub appearance still needs audit.                          |
| Save project as template      | Web ProjectDetail calls templateFromProject; mobile ProjectsSheet only consumes existing templates.                                          | Implemented: owner/admin menu action creates the template and opens it for review; mobile web and native iOS passed.              |
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

## Mobile project-template checkpoint — 1 October 2026

The project menu now saves a template and opens that exact saved template in
Templates. Team controls require owner/admin membership; ordinary writes do not
make this action available. Existing server permission checks remain authoritative.
Errors use the existing run/error banner flow; success shows a toast.

Evidence: mobile typecheck passed, the seven template API tests passed, and
web/iOS/Android exports passed. A disposable project with a 30-minute task was
saved through both mobile web and native iOS; each showed the exact template,
task and estimate in the review screen. Native Android interaction remains open.

## Mobile appearance checkpoint — 1 October 2026

Pages and projects now expose Cover and icon through their existing menus. The
shared editor offers the core emoji/icon catalog, custom emoji validation,
authorized account-owned cover selection, removal, and page-backed upload.
Project uploads use its backing page when available, matching the web behavior.
Read-only and suggestion-only page modes cannot mutate appearance.

Page appearance updates stay separate from dirty content and do not replace a
newer document revision. Page/project switches guard stale responses. Existing
menu dismissal runs before opening the next native sheet. Load/save/upload
errors stay visible and failed picture loads have a retry.

Evidence: seven cover/icon API tests passed; all workspace typechecks and
web/iOS/Android exports passed. Mobile web saved project/page icons, uploaded a
disposable PNG, and saved the page cover. Native iOS selected and saved that
account-owned picture as the project cover and saved a catalog icon. API reads
confirmed the page remained revision 1 with its original empty content. An
initial upload failed with 503 because the disposable preview had file storage
disabled; enabling isolated local file storage allowed the UI retry to succeed.
Native layout showed the long title wrapping and the Save footer remaining
available. Native Android interaction and Home hub editing remain open.

## Profile refresh and gateway trust checkpoint — 1 October 2026

The production screenshot showed the sidebar account remaining on Loading after
a reload. Source inspection found `/me` still sequenced after all item pages,
notifications and teams; failure of any preceding read prevented the profile
request entirely. The web/desktop hook now starts profile loading independently
on sign-in, retries every 30 seconds while visible, reports failures, and guards
late responses by session and component lifetime. Account changes clear the
previous identity. Planner reads no longer perform a second profile request.

Four tests execute the actual transpiled hook with controlled React effects:
profile success despite planner failure, expired-session clearing, failed-read
retry, and delayed responses after account switches/unmount. A fresh local
desktop tab displayed the fixture account after a reload; screenshot evidence
is `/tmp/orbyn-profile-refresh.png`. Production latency and deployment remain
unverified.

Integration of main's gateway correction also exposed a client-spoofable
`X-Orbyn-Via: web` exemption. The exemption now requires the API listener on
8080 and an original loopback peer. Remote requests and the external web
listener remain counted even with that header. Six gateway tests passed, the
rendered configuration passed `nginx -t`, and a live nginx probe counted direct
and spoofed requests while exempting the genuine internal web hop.

All workspace typechecks and the production build passed. Mobile editor font
sizes were corrected to the shared scale; all 16 gateway/neatness checks passed.
The first full suite failed the font-scale check and a sweeper fixture; the
sweeper passed a focused rerun without a code change. The complete rerun passed
all 1,768 tests with no failures or skips, including the four profile regressions.

GitHub CI and Deploy for main `69a00a8` did not start. Check-run annotations
report failed account payments or the need to increase the spending limit.
This is an external release blocker, not a successful deployment; local proof
does not establish the revision running on production.

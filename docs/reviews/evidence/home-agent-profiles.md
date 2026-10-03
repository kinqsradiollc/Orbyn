# Signed-in Home and agent profiles candidate

## Change

Promote the signed-in counterpart of public Home from the preserved broad source
onto current main. Web/desktop and mobile share the existing concrete guide:
Background turns chosen notes into a reviewable draft; Overnight works through an
explicit queue within the selected window and budget. Both entry points show all
character presets without changing settings. The subtitle names actual surfaces:
“Background progress and Overnight results.”

Separate profile sections show work state, last authorized activity, recent
activity and outputs. Overnight alone shows its schedule and estimated budget.
Avatar animation, connected devices and refreshes never manufacture work state.
Completed outputs open through the existing assistant only when it can safely
switch chats. The API snapshot is private, primary, read-only and permission
filtered. The shared store coalesces reads and fences stale session/generation
responses; both clients use the same contract and activity labels.

Primary product references: [Muse design](https://introducing.muse.ai/) and
[Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
These inform visible responsibilities, progress and review. No voice, computer,
browser or arbitrary third-party action feature is introduced.

## Qualification

The first full exact-head suite at `22f2e1b8` failed 2,298/2,299: the new private
profile endpoint was missing its route-inventory classification. It is now
classified `people_only`, matching the existing private activity feed. The
first-party route rejects agent/API credentials, validates query input and uses
permission-filtered snapshots; the inventory ratchet and pending maximum are
unchanged. Requalification is required for the corrected head.

- 22/22 focused profile, client, store and Home checks pass, zero skips/cancelled.
  Log `/tmp/orbyn-home-profiles-focused.log`.
- All workspace typechecks pass after adding the omitted shared activity-label
  prerequisite (`/tmp/orbyn-home-profiles-types-2.log`). The first typecheck failure
  is retained in `/tmp/orbyn-home-profiles-types.log`.
- Production builds and full formatting pass:
  `/tmp/orbyn-home-profiles-build.log`, `/tmp/orbyn-home-profiles-format-2.log`.
- Home component checks are synthetic React checks, not browser/native interaction
  or screenshot proof. The user has delegated web visual acceptance to their test
  server for this increment. Native interaction/screenshot acceptance remains
  open, including human Terms acceptance. No saved UI permission was bypassed.

Full exact-head local/all-CI qualification is required before main promotion.
The complete whole-app UI, reflection, collaboration and ADR acceptance contract
remain open. No release, deployment or cleanup.

## Catalog correction after qualification — 3 October 2026

Corrected inventory head `64534482` passed 2,298/2,299 locally and failed
CI37071883926 on the generated MCP catalog route count. The private profile
endpoint increased excluded routes from 248 to 249; the two generated documents
were stale. Regenerated using the repository catalog command, preserving tool
schemas, budgets and tests. Logs retain this failure. CI also skipped the existing
optional Tesseract check because its executable was unavailable; this is not
native or OCR delivery evidence. Integrated qualified media main `43812305`
without conflicts. New exact-head full local and CI qualification are required.

The corrected combined focused run passes 32/32 (catalog, route inventory,
profile integration, client/store and both Home components), with zero failures,
skips or cancellations. Log `/tmp/orbyn-home-profiles-catalog-focused-3.log`.
A preliminary 26-check invocation omitted the inventory filename; it is not the
combined acceptance result. An overlapping repeat was cancelled and excluded;
the final 32-check run used a fresh separate marked disposable database.

Corrected head692cc0f8 full local passed2,320/2,320, zero failed/skipped/cancelled,
exit0, and all four CI37074275504 jobs passed. This qualifies that exact tree,
not a later main combination. Integrated publication main86ccd4f8; one append-only
ADR conflict was resolved by retaining both decisions. No code conflicts or
remaining markers. New combined-head full/CI qualification still required, and
native acceptance remains waiting on the human sign-in action.

## Combined-main qualification and recovery fixture — 3 October 2026

Head0d6d307a passed2340/2340 local tests, zero skips/cancellations (session77462). CI37075657142 failed the unchanged heartbeat/activity assertion: the all-service app started a recovery worker that changed an intentionally incomplete expired fixture mid-read. The profile test now builds the actual API service, retaining all lease/state/activity/permission assertions. Main1100ca98 integrated without conflicts. A new matching-head full/CI run is required; native human sign-in remains pending.

Recovery fixture repair plus main110 integration: current five-file focused group passed18/18, zero skips/cancellations, including real API profile routes and inventory. All workspace types/build/format passed. The narrower API file passed8/8. These qualify the repair checkpoint, not the still-pending full matching-head run or native UI acceptance.

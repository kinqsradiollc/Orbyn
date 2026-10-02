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

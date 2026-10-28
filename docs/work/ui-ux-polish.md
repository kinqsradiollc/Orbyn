# Planner workspace redesign

## Candidate and scope

Local branch `refactor/ui-ux-polish`, based on `d43f1c68`, continues the existing
uncommitted UI changes with the owner's authorization. The earlier spacing-only
pass was rejected; this candidate changes the working layout and uses populated
local data. Shared guidance was refreshed at engineering-library commit `6071f24`.
Review and integration are performed directly in this chat.

The primary task is to see today's commitments, choose work and act without
navigating through dashboard decoration. Preserve Orbyn's palette, type scale,
permission checks, routes, drafts, selection, user width preferences and backend
source ownership. No API/schema/provider or dependency-manifest changes are needed.

## Direction and execution

Three compositions were considered: retain the uniform dashboard cards; replace
Home with one chronological feed; or use a daily agenda with a quieter planning
column. The third keeps timed work visible while retaining upcoming work and
planning actions. Phones use a single task sequence. Portfolio and document
screens retain compositions suited to their content rather than copying Home.

The coupled layout, synthetic data and actual-app checks share one worktree and
preview database, so one writer owns integration. Required role/model/processing
settings cannot all be selected through this host's child-agent schema; permitted
work continues directly. No new chats or providers were created.

| Area               | Implemented change                                                                                                                                                                | Preserved contract                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Home               | Compact summary ribbon; daily agenda and active work in the main column; upcoming/planning in the secondary column; flat agenda rows                                              | Existing open/focus/plan callbacks, empty-planner fallback, saved hub ordering and visibility                  |
| Navigation         | Established 72px default rail; actual-pane width adaptation; aligned alongside/dock headers                                                                                       | Saved widths, resize controls, routes and hover/focus labels                                                   |
| Tasks              | Quiet working list; shorter toolbar; no empty progress bars or repeated time estimates; board columns retain readable width and scroll locally                                    | Search, filters, grouping, checklist progress, completion/reopen, read-only controls and keyboard move actions |
| Projects           | Aligned portfolio grid on wide screens; separated project rows on phones                                                                                                          | Full names/summaries, status/progress and project links                                                        |
| Documents          | Compact phone collection header; deliberate checkbox/open/move/favorite placement; personal/team folder labels; duplicate tag names gain scope labels on both clients             | Stable IDs, folder ownership, search/filter, drafts, Note/Markdown/LaTeX and source/preview behavior           |
| Assistant          | Wrapping starter prompts, bounded multiline composer and shared native text wrapping                                                                                              | Existing conversations, drafts and sending behavior; no live model calls used for checks                       |
| Supporting screens | Responsive calendar; paired Study metrics; compact Teams navigation without an unused phone placeholder; concise empty collection actions; Settings/auth/onboarding/motion polish | Existing forms, permissions, approval/dismissal, errors and recovery paths                                     |

Dark surfaces use the same hierarchy as light surfaces. Phone create controls keep
44px square targets even when the greeting wraps. This is a layout redesign within
the existing visual identity, not a replacement brand system.

## Synthetic local database

`backend/scripts/seed-ui-demo.mjs` adds deterministic fixtures to the verified local
Docker database only. Its guards require all of:

- Root `.env` resolves to `localhost` or `127.0.0.1`, port `5433`, database `orbyn`.
- Database setting `orbyn.ui_fixture` equals `ui-ux-polish`.
- The existing local `admin@example.com` account is present.

The marker was set after checking container `ui-ux-polish-postgres-1`, its local
port binding and volume ownership. A private snapshot was retained outside Git at
`repo/orbyn-artifacts/ui-redesign/database-before-seed.dump` before adding fixtures.
No production configuration was read or changed. No production database is used.

```sh
# Read-only readiness check; does not seed.
node backend/scripts/seed-ui-demo.mjs --date=2026-10-29
# Add fixtures to the already verified and marked local preview database.
node backend/scripts/seed-ui-demo.mjs --apply --date=2026-10-29
```

Fixtures include 6 synthetic teammates, 3 teams, 6 projects and 18 stages, 41 tasks,
14 events, 9 time blocks, scoped lists/tags/folders, 21 documents/notes, 10 study
cards, 4 saved views, 2 goals, 3 habits, 8 notifications, 3 saved assistant chats,
2 review proposals, 3 booking pages and 3 synthetic bookings. Documents include a
long title, multilingual text, nested containers, a table and a mathematical
expression. Prior local records remain present. Approving one proposal during
verification added a further task and left the other proposal pending.

No fixture sends email, invokes a model or posts externally. Dummy addresses use
`ui-demo.example`; dummy accounts have inaccessible random password hashes.
`--repair` narrowly fixes relationships in this seed's own deterministic records
from earlier fixture iterations; it does not reset edited content or review
choices. Normal insertion uses conflict-do-nothing. Repeating the final seed
inserted zero rows. Dates use the core Melbourne timezone helpers.

## Evidence and coverage

Actual applications: web `http://localhost:5174/app`, API
`http://127.0.0.1:8008`, Expo web `http://localhost:8082`. Browser captures use Chrome,
CSS viewports, default zoom and the same local account/database. The API's running
development process includes the Expo origin in CORS; no dotenv file was edited.
Evidence and logs are outside Git under `repo/orbyn-artifacts/ui-redesign/`.

| Surface                     | Evidence                                                                                                                                                               | Boundary                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Web/desktop                 | Populated Home, Tasks, Calendar, Projects, Docs, Assistant, Study, Teams, Views, Booking and Review at 1440px and 390px; dark Home at 320px                            | Browser rendering, not a packaged desktop binary                                   |
| Shared/supplemental screens | Settings at 1440/800/390/320px; Memory, Agent notes, Lists, Admin, auth/onboarding and empty states inspected in the preceding pass; affected shared controls retained | Not every settings integration or permission state                                 |
| Workspace panes             | Alongside + Notifications retains 72px navigation and a bounded 400px dock with no page overflow                                                                       | Not every arbitrary combination of three screens                                   |
| Expo web                    | Today, Tasks, Calendar, Assistant, Workspace; Projects, Docs, Memory, Agent notes, Views, Study, Lists, Teams, Booking, Admin, Settings and Agenda sheets              | Actual React Native components rendered on web; not installed iOS/Android behavior |
| Persistence                 | Complete a synthetic task on web, observe it in Expo web, reopen there, observe it on web; actual API returned 201                                                     | Shared DB and refresh observation; not an offline or background-sync qualification |
| Review                      | Approve a synthetic suggestion through the API, find its task, cancel decline on the remaining suggestion                                                              | No external action or provider call                                                |
| Structured documents        | Rendered nested list/quote/checklist/table/math; opened Note, Markdown and LaTeX; inspected Note and LaTeX pixels                                                      | No PDF compilation or live collaborative-edit qualification                        |
| Scope integrity             | Zero fixture violations across item/list/project/assignee, item/tag, document/folder and document/tag relationships                                                    | Scoped SQL evidence for seeded records                                             |
| Touch/motion                | 44px phone task targets; composer grows/shrinks within four lines; project hover stationary with reduced motion                                                        | Browser geometry/event behavior; no physical keyboard or touch qualification       |
| Automated checks            | 74 focused UI/contract tests passed, both client type checks and desktop production build                                                                              | Source ratchets and component rendering do not replace pixel inspection            |
| Native packaging            | iOS and Android Hermes exports completed                                                                                                                               | Export success is not device, signing or store qualification                       |

### Retained failures and corrections

- Inherited sidebar defaults broke three focused assertions; the established rail
  default and pane width budget were restored.
- Initial Expo login failed CORS; the local process origin allowlist was corrected.
- A seed attempt used an invalid saved-view filter; its transaction rolled back.
- Structured content initially hit the database writer guard. The seed now uses
  the existing format parser, writer capability and authoritative DB projection.
- A real task action returned 422 because early fixtures linked team tasks to
  personal lists. The seed relationships were repaired; API validation remains.
- An initial component-test loader lacked a CSS dependency stub; setup was fixed.
- A focused typography check rejected a new 12px scope label; it now uses the
  established 13px role. Mobile type checking caught omitted optional scope fields
  in its list projection; the projection type now preserves those fields.
- Final source review caught the auth return link inside the hidden phone story
  column. A phone return control now reaches the landing page; exactly one return
  control is visible at that width.
- One browser attempt used the wrong mobile Library button name; the actual
  “All folders” control was used. No product action was bypassed.

## Handoff and limits

Changes remain uncommitted on this branch, with previews running for review.
Private environment files, unrelated worktrees and existing dependency symlinks
are preserved. No commit, push, PR, merge, deployment or hosted CI is claimed.

No installed iOS/Android device run, screen-reader audit, native keyboard/safe-area
qualification, load/performance benchmark, live OAuth renewal or model response
quality test was performed. Those are separate evidence surfaces. This record
covers the implemented redesign and named flows; it does not certify every
possible feature state or claim user acceptance of the visual direction.

## Home alignment follow-up

The owner's screenshot review identified alignment defects in the redesign.
Actual computed styles confirmed the generic workspace heading padding (`14px
18px`) and grid gap (`16px`) were overriding Home's composition. The agenda also
wrapped metadata beside titles while button minimum heights shifted text baselines.

The owning Home rules now align section headers with their content, restore the
32px column gutter, place metadata consistently below titles and keep agenda
title/action columns aligned. The first wide headings differ by only the card's
1px border. Compact layouts remove that wide-only top inset; phone actions align
with titles and retain 44px targets. Unfinished/check-in button groups keep their
own row placement.

Verification: actual Chrome rendering at 1440, 800, 390 and 320px; light/dark
screens inspected; browser geometry assertions cover heading/content edges,
shared title columns, metadata placement, gutter and viewport containment.
34 focused tests and the desktop build pass. The alongside/notification,
checkbox-target, composer and reduced-motion checks also pass. This follow-up
changes web/desktop Home CSS and adds a source regression; no native component or
backend behavior is changed. Before/after captures and receipts are retained in
`repo/orbyn-artifacts/ui-redesign/alignment/`. Changes remain local and uncommitted.

## Full-page controls, project layout and 3D Connections

The owner's six further screenshots showed issues outside Home. This pass follows
Tasks through its entire list, the complete project Home page, Booking, Docs,
Views and Activity in light/dark themes at desktop and phone widths.

- Shared search inputs now inherit a single field surface in dark mode. Task
  search, view/layout/filter actions use aligned 44px outer controls; document and
  saved-view searches retain the same target height. Header command search keeps
  its separate compact navigation role. Search text, filters and focus rings are
  preserved.
- Tasks remove the duplicate visible “All items” heading while retaining its
  accessible heading, and align toolbar, status chips, group headings, checkbox
  rows and separators. Progress has its own line; effort/list/tag facts share a
  consistent baseline beneath it.
- Project Home groups the working sections in a main column and metadata/Brief in
  a secondary column. Connections spans the full page below them, avoiding the
  former small graph at the bottom of a sparse three-column card grid. Sections
  align their content to the top. Only the view tabs or the compact picker is
  visible at the corresponding pane width. Existing edit/open/import callbacks
  and permissions remain in place.
- Activity uses the standard compact 560px editor and viewport bounds. Shared
  editor headers/body now have consistent 16px insets, including when Settings
  has already loaded. The existing regression expecting Activity's old wide
  presentation was updated for this requested design change; viewport-bound and
  standalone stylesheet checks remain.
- Connections now uses shared three-dimensional sphere positions, yaw/pitch
  rotation and perspective projection in `packages/core/src/connections/space.ts`.
  Both clients draw the projected result through their existing SVG stack. Web
  supports pointer orbit, arrow keys, zoom/reset, selection, Preview/Open and a
  larger modal. Native components support horizontal touch orbit and accessible
  orbit/zoom/reset controls. The API still owns visible nodes and edges; depth
  selection, loading/retry, truncation notices and direct list navigation remain.
  Sparse collision-aware captions avoid overlap; selection/list retain full names.
  There is no idle animation loop, new graphics dependency or WebGL requirement.

### Verification and preservation

98 focused tests pass, including shared geometry, label separation, bounds,
existing task behavior and Settings/workspace contracts. Core compilation, both
client type checks, desktop production build and iOS/Android Hermes exports pass.
The existing large-bundle advisory remains; no frame-rate claim is made.

Actual Chrome checks exercised pointer and keyboard orbit, zoom and exact reset,
node selection into the real side preview, two-step graph loading, expanded-modal
focus/Escape, and loaded Activity at desktop/phone widths. Expo web checks opened
the real project graph, checked changes to projected coordinates through orbit
and zoom, and verified reset. Browser-injected touch events also rotated that
scene and preserved reset. These are web runtime observations, not installed
native gesture, assistive-technology or performance qualification.

Complete project captures and task-list top/middle/bottom captures were inspected;
Booking, Docs and Views were also checked in both themes and at 390px. Intermediate
captures taken before data finished loading were retained separately from loaded
captures. Harness attempts initially used a button role for native radio segments,
looked for a peek-local close control after the preview moved into the dock, and
compared the invariant centre endpoint of an edge. Corrected checks use actual
roles/owners and moving endpoints. A source check caught scaled SVG caption units;
native drawing now converts geometry to screen units and retains the 11px role.

Evidence is outside Git in `repo/orbyn-artifacts/ui-redesign/controls/`. Task-local
cached dependencies now resolve the current worktree's `@orbyn` packages rather
than the sibling architecture checkout; third-party caches remain shared. The
original root dependency-link destination is recorded in the ignored artifact
`local-dependency-layout.json`. No sibling checkout or dependency manifest changed.
Private configuration and synthetic DB contents remain intact. Changes are still
uncommitted; no PR, merge, hosted CI, live provider call or deployment is claimed.

### Chrome Home completion-control follow-up

The supplied Chrome crop exposed a remaining Home-specific row owner: its zero
horizontal padding placed completion controls on the blocked-status stripe, and
inherited vertical centring displaced them on rows with several facts. Home's
shared task rows now use a 16px inset and align controls with the first title
line; the mobile adjustment preserves the existing 44px completion target.

Chrome browser measurements covered all 12 Needs attention rows at 1440px and
390px, in light and dark themes. Every row has a 16px control inset and a 2px
centre difference from the first title line; mobile targets remain 44px and
neither viewport has page overflow. Desktop and phone screenshots were inspected.
This is browser evidence for Home, not installed native-client qualification.

### Plan today large-screen height follow-up

Chrome reproduced the oversized Plan today card at 1920px. A legacy global
`min-width: 1500px` rule imposed a 370px minimum height on this single-action
card. Removed that obsolete minimum and its redundant small-screen reset so
normal content sizing owns the height at every width.

Chrome checks at 1920, 1500, 1499, 820 and 390px in both themes measured an 82px
card on larger layouts and 78px on the phone. The phone action retains its 44px
target; the button is actionable and there is no horizontal page overflow.
Desktop and phone screenshots were inspected. All 18 focused Home/layout checks
passed, and `git diff --check` passed. Changes remain local and uncommitted.

## PR preparation checks

The final local candidate passed 100 focused UI/core regression tests, desktop
production build (including TypeScript), mobile TypeScript, changed-file Prettier,
project-document links, source-organization and workspace-boundary checks, and
`git diff --cached --check`. The desktop build retains its chunk-size advisory.
Earlier Expo web interaction and iOS/Android Hermes export evidence remains scoped
as described above; installed native behavior has not been qualified. Dependency
links, private dotenv files and local preview artifacts are excluded from Git.

### PR 243 divider and CI correction

The Coming up buttons inherited the generic button radius while drawing a top
border, producing the rounded partial-card lines in the supplied screenshot.
Rows now explicitly have square corners and only adjacent rows draw a divider;
the first item has no top divider. Chrome checks at 1440px and 390px in both
themes confirmed 0px corner radii and the expected 0px/1px border sequence.

Hosted run `40729406711` failed in backend-and-web with exactly two failing tests
out of 5461. Both reproduced locally: the routine-action size guard rejected the
hard-coded collection-toolbar height, and the project layout assertion still
required the retired two-column row composition. Collection fields, companion
actions and segmented controls now share `--collection-control-h`; compact routine
buttons retain their existing token. The project regression now checks bounded
cards, wrapping names/metadata and separated single-column phone rows. The
routine-action guard was retained, with a separate shared collection-token check.

The expanded 110-test focused set and desktop production build passed. Browser
checks also confirmed all five task-toolbar controls at 44px and project cards
without overflow at desktop and phone widths. Earlier failed run and local
reproduction logs are retained outside Git. Hosted CI must qualify the new commit
separately; no merge is authorized by this correction.

### Explicit appearance switch and consistent action sizing

Public Home had an explicit light-theme subtree and hard-coded white preview
surfaces. It now inherits the saved Light/Dark palette, including the first-paint
background. One binary appearance switch is shared by public navigation, sign-in,
workspace chrome and Settings. It synchronizes mounted controls and other Orbyn
tabs, with a visit-only fallback when storage is blocked. Legacy System choices
resolve once to an explicit theme; there is no ongoing device-theme listener.

Sign-in now renders one Back to Orbyn action in its page header, replacing the two
responsive copies. Coming up hover uses the semantic hover surface and retains
the date tile's borderless treatment rather than inheriting the legacy dark rim.
Desktop public navigation uses equal side columns so adding the switch does not
displace Features/Planning/Agents/FAQ from the page centre.

Shared routine desktop actions now use a 36px minimum, up from 32px. Collection
and public-header companions remain 44px; phone/coarse actions retain 44px. Compact
feature-specific controls and native Button's existing 44pt minimum are retained.
The appearance track was enlarged along with its target; the switch is keyboard
operable and exposes its checked state.

All 63 focused appearance/settings/button/Home/workspace/project tests passed,
as did the desktop production build including prerendering and TypeScript.
Chrome verified saved theme and reload, cross-tab preference updates, explicit
theme stability under a device-theme change, keyboard Space toggling, a single
actionable back link at 1440/390px, no page overflow, dark hover without a date-tile
rim, and the workspace switch. Navigation centres were within 2px at 1024, 1280,
1440 and 1920px; public-header actions all measured 44px. Screenshots of Home,
sign-in, hover and phone workspace were inspected and retained outside Git.
This is browser evidence, not installed native-device qualification.

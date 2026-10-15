# UI/UX redesign delivery

Current decision: [ADR 003](../adr/003-product-ui-ux-redesign.md).
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Baseline: `c7b3bdb7`. Current product/test candidate: `7dfd1b9f`.
Phase: Tester qualification; see [qualification handoff](adr-003-candidate.md).
Full source coverage: [surface inventory](ui-ux-surface-inventory.md). Review rounds: 0/3.

| Area | Current state | Evidence / next gate |
| --- | --- | --- |
| Decision archive, skills and documentation | Implemented candidate | Changed-document qualification pending |
| Shared design foundation | Implemented candidate | Types/build passed; final rendering pending |
| Shell and overlays | Implemented candidate | Interaction test correction/retest in progress |
| Home and Assistant | Implemented candidate | Final behavior/render qualification pending |
| Tasks, Calendar and Focus | Implemented candidate | Activity/runtime and final rendering in progress |
| Projects, Docs and Browse | Implemented candidate | Default TeX/compiler and editor interaction retests pending |
| Settings, Admin and Connections | Implemented candidate | Import/runtime and interaction qualification in progress |
| Auth and public content | Implemented candidate | Final representative rendering pending |
| Mobile parity | Implemented candidate | Expo final behavior/render qualification pending |
| Frozen candidate / Tester / Reviewer | Testing | `7dfd1b9f`; Reviewer 0/3 |
| Final web and Expo Visual Check | Pending | After test/code findings settle |
| Accepted merge and push | Pending | No acceptance or merge claim |

Initial full workspace typecheck and production build passed on `f7899149`.
The first focused batch failed; those failures remain in Tester's evidence.
`7039a77b` updates four interaction harnesses, preserving the product source.
`7dfd1b9f` provisions default T1 fonts and makes the empty TeX starter emit a
blank page after the live compiler exposed that failure. Retests are pending.
Detailed historical entries below retain earlier attempts and source boundaries.

Production deployment remains user-owned. Preserve the unrelated Visual-owned
`c6-production-visual-2026-10-11.md` working change.

## Implementation checkpoint — 12 October 2026

- ADR 001/002 archived with relative links migrated; ADR 003 is the current decision.
- Shared neutral palette with blue accent, consistent dark mode and mobile primary foreground token.
- Compact typography, web phone input sizing, grouped Settings rows and responsive selectors.
- Reduced decorative entrances/stagger/hover movement; useful progress remains.
- Web Admin/Teams/Lists/Calendar now measure remaining pane width.
- Home planning card, Assistant, Docs, Focus, Auth and secondary layouts undergoing source review.
- Builder development checks: shared packages built; desktop and mobile types passed before the most recent edits.
  These are development checks, not the frozen candidate's formal qualification.
- Full surface audit and remaining family corrections are still in progress. No candidate handed off.

## Audit continuation

- Owner requires every layout, style and position reviewed; shared tokens alone are insufficient.
- Added responsive Study/Admin subpanes without containing fixed dialogs; Background columns now fit available width.
- Primary foreground contrast and web field sizing now include secondary editors, searches and selection controls.
- Structured mobile editor styles now follow theme changes; routine project/setup headings are compact.
- Added runtime regression source for pane resizes, press reset/reduced motion and web/native input roles.
- Both skill frontmatter validators passed using an isolated temporary Python environment.
- Development checks exposed stale typography/copy assertions and a missing mobile alert test dependency;
  their corrections are being verified. These are not formal review rounds (counter remains 0/3).
- Full source audit, formatting, frozen candidate verification and final Visual Check remain open.

## Owner screenshot — agent entry block

The supplied 12 October screenshot shows the old agent-row hierarchy with the new
palette. It is an open redesign finding, not accepted visual evidence. Builder has
replaced the default Home character rows with small utility icons and compact
labels on both clients, moved character browsing behind the guide, and removed
the duplicate Activity action. Character identities and profile configuration remain.
Final pixel review is pending the complete candidate. Stage Tracker was notified.

## Current order after owner feedback

1. Finish structural layout assessment: shell/panel ownership, Home and Assistant,
   then Tasks/Calendar/Focus, Projects/Docs/Browse, Settings/Admin/Connections and auth/public.
   Assess corresponding mobile surfaces and shared controls with each family.
2. Finish copy, long-value, empty/error/loading and overlay states; freeze the complete candidate.
3. Tester qualifies it; Reviewer inspects code and evidence (maximum three rounds).
4. Request one final bounded web and Expo web visual batch; fix and recheck affected findings.
5. Integrate accepted code to main; deployment remains owner-owned.

Builder development run: 77/77 focused checks passed in
`/tmp/orbyn-redesign-dev-controls-r4.tap`, before the latest Home ordering/Overview changes.
It covered controls, type/copy ratchets, Settings layout, pane observation, ChatGPT
remote UI and Home identity/disclosure behavior. Formal candidate qualification remains pending.
Agent entries now follow custom Home panels on both clients; daily Overview panels
reflow by measured width. The current preview is unfinished and is not accepted evidence.

### Shared overlays and choices audit

- Browser sheets and confirmations now open without entrance motion. Native sheets
  honor Reduce Motion; action sequencing and dismissal callbacks are preserved.
- Long chip labels wrap instead of hiding the choice; segmented notification badges
  use matched semantic foreground/background roles in both themes.
- Inspected compact actions, empty/error states, mobile date fallback, and web
  popover viewport positioning/focus return. Inventory records this source subset.
- Development checks: 13/13 passing in `/tmp/orbyn-redesign-sheets-check.tap`;
  mobile typecheck passed after sheet changes. These are Builder checks, not formal
  acceptance. No frozen candidate; review remains 0/3 and final visuals remain open.

### Assistant schedules and review surfaces

- Upcoming on web/mobile now separates visible schedule/status from optional
  generated progress and last-run details. Full saved text remains available.
- Shared lightweight mobile detail disclosure avoids introducing nested cards.
- Removed Assistant's remaining ornamental entrances; loading spinner retained.
- Overnight headings/status and imported-page assistant dialog copy/actions are
  compact. Approval details and change-selection consequences remain visible.
- Builder development checks: 27/27 passing, exit 0, in
  `/tmp/orbyn-redesign-assistant-check.tap` (before the final AssistChips edits);
  web/mobile typechecks passed after Upcoming changes.
- Source inventory records the inspected subset and outstanding final assessment.
  Implementation continues; no frozen candidate, review 0/3, final visuals pending.

### Tasks and calendar layout continuation

- Task toolbar now measures its own remaining pane. Detailed filters open through
  Filters at every width; active selection chips and saved view/layout controls remain.
- Task detail metadata, linked titles, status labels and progress header now wrap
  without forcing neighboring controls out of the pane.
- Mobile week strip uses a compact soft selection surface. Reduce Motion also
  bypasses the snap-back transition for a cancelled week swipe.
- Calendar task placement and agenda empty copy are concise; day headings and
  row content shrink within their available width.
- Source edits remain unmerged. These family layout assessments do not establish
  rendered acceptance. Full candidate/Test/Review/final Visual remain pending, 0/3.

Builder checks for this batch: web and mobile typechecks exited 0; 21/21 focused
checks passed, exit 0, in `/tmp/orbyn-redesign-tasks-check.tap`. They cover existing
workspace contracts, pane observation, source style rules and shared controls;
they do not prove calendar or task usability in a rendered browser.

### Projects and Docs layout continuation

- Projects uses measured pane width for single-column row reflow. Removed size
  containment from its root, which also owns fixed New Project/Templates modals.
- Docs now collapses library navigation based on its actual remaining workspace,
  preserving Browse library and remembered hide/show preferences. Toolbar actions
  wrap at all pane widths.
- Mobile project creation actions wrap, and project/library text input roles use
  16px in Expo web while retaining compact native roles. Draft prompts are short.
- Design rules now require checking overlay ownership when adding containment.
- Builder checks: web/mobile typechecks exited 0; 25/25 focused checks exited 0,
  `/tmp/orbyn-redesign-library-check.tap`. They cover existing search/workspace
  contracts and source style checks; final rendered layout acceptance is pending.
- Implementation continues; no frozen candidate or merge, review 0/3.

### Settings and Admin layout continuation

- Mobile AI provider choice now uses shared radio chips and explicit selection
  state rather than repeating “selected” in button text. Save-version/session
  guards, unavailable-device handling and fallback consequences are preserved.
- Admin list tables stack when the actual Admin content pane becomes narrow.
  Model controls and provider actions remain available; table headers retain
  their accessible representation.
- AI model and test status surfaces use theme tokens in light and dark themes.
- Builder mobile typecheck passed. Focused provider-choice checks passed 12/12;
  larger Settings/Admin receipt is `/tmp/orbyn-redesign-settings-admin.tap`.
- Final browser review remains open. No frozen candidate/merge; review 0/3.

### Browse, saved Views and Review continuation

- Browse destinations use compact rows and smaller token-based icon surfaces.
  Saved View toolbar actions wrap; filter labels use sentence case.
- Review changes use separated rows instead of nested cards on both clients.
  Stale-change markers, before/after values, recipients and approval choices remain.
- Mobile saved View galleries measure their remaining pane and use one column
  below 480px. Custom field labels wrap and calendar switches reserve label space.
- Unsaved shared-view copy identifies the owner restriction and offers Reset changes.
- Builder mobile typecheck exited 0; focused checks passed 25/25, exit 0, in
  `/tmp/orbyn-redesign-secondary-check-r2.tap`. These source/runtime checks do not
  establish rendered acceptance. Full family assessment and final Visual remain open.
- No frozen candidate or merge; review remains 0/3.

### Booking and collection forms continuation

- Booking inbox and summary now respond to the measured remaining workspace,
  including an open navigation pane. The editor remains outside size containment.
- Booking status colors use semantic tokens; summary labels wrap and page actions
  can reflow. Viewport fallbacks remain for public/shared styles.
- Mobile booking sections have compact headers, reduced form padding and stable
  label width beside switches. List names wrap; rename controls can stack.
- Removed the repeated Teams access introduction from the collection screen;
  role and sharing decisions remain in their owning team flow.
- Web layout changes no longer animate. Native layout feedback retains its
  existing Reduce Motion guard; runtime checks cover both branches.
- Builder web/mobile typechecks exited 0. Focused checks passed 23/23, exit 0,
  `/tmp/orbyn-redesign-booking-lists-check.tap`. These are development receipts,
  not rendered acceptance or full family qualification. Implementation and
  final candidate/Test/Review/Visual remain open; review 0/3, unmerged.

### Authentication, consent and public booking continuation

- Password recovery and verification headings/actions name their outcome;
  removed duplicate success copy, forced mobile heading breaks and decorative
  shell entrance classes. Sign out is a neutral action, not a destructive warning.
- Consent labels use sentence case and phone actions reflow. Account, app identity,
  connection replacement, deletion/undo, approval thresholds and revocation
  consequences stay visible. Authentication/permission logic is unchanged.
- Public booking columns reflow to available width, and the seven-day strip
  scrolls instead of reducing targets below 44px. Date navigation and selection
  remain reachable; public descriptions and custom booking colors are preserved.
- Builder web/mobile typechecks exited 0. First focused run was 23/24 due to an
  off-scale 20px heading; corrected to the 18px role. Rerun passed 24/24, exit 0,
  `/tmp/orbyn-redesign-auth-public-check-r2.tap`. Rendered acceptance remains open.
- Full source coverage and final candidate/Test/Review/Visual are still incomplete.
  No merge or frozen candidate; review counter 0/3.

### Shared approval and planner review continuation

- Project previews and proposed changes use separated rows rather than nested
  cards. Full task/action names and notes remain readable before approval.
- Planner review removes its motivational helper; row actions reflow with long
  titles. Suggested follow-up controls retain 44px targets.
- Project review metadata is compact. Both clients explicitly show that tasks
  with unscheduled work will still be created; scheduling/dependency/warning
  details remain available. Approval and deadline choices are unchanged.
- Removed proposal action stagger markup. Shared styles preserve status feedback.
- Builder web/mobile typechecks exited 0. Focused checks passed 25/25, exit 0,
  `/tmp/orbyn-redesign-approval-check-r3.tap`. The added two-client render check
  verifies full task notes/titles, creation consequences and duplicate-warning
  suppression. Its first attempt exposed a VM JSX React fixture omission, fixed
  in the harness; it was not a product runtime failure.
- Full inventory assessment and frozen-candidate/Test/Review/final Visual remain
  open. No merge or candidate; review remains 0/3.

### Shared selection and confirmation audit

- Inspected custom selector keyboard navigation, searchable option portal,
  viewport bounds and full option text; closed controls also expose the selected
  label as their default title. Selection/submission contracts remain unchanged.
- Mobile segmented controls keep their compact drawn height while extending
  touch space into track padding; count badges cannot shrink.
- Long action-menu titles belong to scrollable content instead of a clipped
  fixed header. Dismissal/action sequencing and swipe handle remain unchanged.
- Confirmation text flex children can shrink; destructive marks use the shared
  danger surface and radius. Queued confirmations, focus and cancellation remain.
- Builder web/mobile typechecks exited 0. Focused checks passed 27/27, exit 0, in
  `/tmp/orbyn-redesign-selection-check-r2.tap`, including a runtime selection/
  wrapping/target/badge check. Final rendered qualification remains open.
- Full implementation still precedes candidate/Test/Review/final Visual.
  No frozen candidate or merge; review remains 0/3.

### Search and notification hierarchy continuation

- Web/mobile Search keeps long result names readable; filter syntax and advanced
  keyboard actions move to named Search tips. Web pin actions have 44px targets.
  Search, creation, selection and routing handlers remain unchanged.
- Notifications use compact rows, theme colors and flexible action spacing rather
  than fixed narrow-screen offsets. Agent questions use separators, not nested
  cards. Mobile default-choice consequences now include the actual expiry time.
- Removed notification stagger markup and duplicate empty/review explanatory copy.
  User-authored notification titles/bodies and approval choices remain intact.
- Web/mobile typechecks exited 0 before the mobile expiry-label addition; the
  mobile recheck also exited 0. Focused first run passed 24/26: the command
  map lacked the previously introduced Assistant rules entry. Added an explicit
  person-owned authority reason. Rerun passed 26/26, exit 0,
  `/tmp/orbyn-redesign-search-inbox-check-r3.tap` (final explicit-reason revision). These are Builder checks, not
  rendered or whole-product acceptance.
- Owner screenshot shows default agent mascots despite the current HomeCompanions
  utility-icon source. Port 5174 listens from this worktree's desktop directory;
  rendered/source mismatch still needs diagnosis in the final visual batch.
- Full implementation, frozen candidate, Test/Review and final Visual remain open.
  No merge; review counter remains 0/3.

### Focus and Study density continuation

- Focus completion is an inline status beside the task. Removed the web burst
  overlay and mobile spring/slide decoration. Session start/pause/end, log-time
  behavior, cross-device status and read-only guards remain unchanged.
- Focus controls and headers wrap; next-task targets remain 44px. Study routine
  counts use 18px roles and concise empty copy, with approval guidance visible
  at card selection. User-authored task/card/page content remains intact.
- Study statistics/actions and review header reflow. Rating columns adapt to
  available width, page selectors can shrink, and mobile deck titles wrap.
- Builder final web/mobile typechecks exited 0. Focused checks passed 17/17,
  exit 0, `/tmp/orbyn-redesign-focus-study-check-r2.tap`. Includes source checks
  for stable inline completion and retained session/authority controls; it does
  not establish rendered acceptance or full source coverage of Study.
- Full inventory assessment and frozen candidate/Test/Review/final Visual remain
  open. Unmerged; review counter 0/3.

### Sharing and publishing continuation

- Publishing dialogs have bounded widths, wrapping footers/link rows and concise
  access summaries. Password-protected links explicitly say a password is needed.
  Corrected the misleading claim that search-engine exclusion restricts access.
- Scoped-publication block selection retains full source text in a bounded list,
  44px rows and explicit title/block/public-update consequences. Mobile update
  mode and expiry use selected chips with named accessible groups.
- Save-to-Orbyn destinations wrap; pickers use less indentation and 44px targets.
  Permission filtering, publication store/revision fences, consent and revocation
  behavior are unchanged. Shared maintenance rows wrap without fixed containment.
- Builder initial mobile typecheck found missing labels on the two new ChipRows.
  Added Updates and Link expiry group labels; final web/mobile types exited 0.
  Initial existing focused checks passed 26/26. The added access-copy assertion
  then found the intermediate public-link helper still present after formatting;
  corrected both clients. A subsequent assertion needed to tolerate JSX whitespace.
  Final focused checks passed 27/27, exit 0,
  `/tmp/orbyn-redesign-sharing-check-r4.tap`. Source assertions cover full block
  selection/access consequences; store tests cover scope/consent/revision behavior.
  These do not establish rendered acceptance.
- Full delivery audit/candidate/Test/Review/final Visual remain incomplete; no
  merge or frozen candidate; review 0/3.

### Calendar edit forms continuation

- Frame task filters move into named disclosure with active counts and duration
  bounds visible in the summary. No selections means unrestricted categories.
  Web validation opens hidden filter fields when an invalid input needs attention;
  mobile duration errors stay outside the disclosure. Draft fields remain mounted.
- Frame repetition, times, zone, busy/booking consequences and color remain visible.
  Delete confirmations name removal of all occurrences and preservation of tasks.
  Removed frame entrance markup; mobile move forms separate full title/current time.
- Time-block editing disables fields/dismissal/submission during save, preventing
  repeat requests and preserving the current operation. Routing/time conversion
  contracts remain unchanged. Existing modal focus ownership still needs final
  source assessment; this batch does not claim calendar overlay completion.
- Final Builder web/mobile typechecks exited 0; focused checks passed 19/19, exit 0,
  `/tmp/orbyn-redesign-calendar-edit-check.tap`. Added runtime coverage for full
  subject, busy save/dismissal guards and normal save/cancel. Rendered review pending.
- Entire redesign remains incomplete/unmerged, no candidate, review 0/3.

### Editor keyboard ownership continuation

- Added shared web `useModalFocus` for Calendar frame/time-block and folder
  publication overlays. Focus cycles through visible controls, Escape respects
  higher dialogs/pickers, pending operations block dismissal, and cleanup returns
  focus to the connected opener. Floating Select/Popover surfaces declare owner
  identity so date/selection pickers keep their own keyboard interaction.
- Removed competing document Escape listeners in frame/folder editors; no change
  to their save/delete/publication contracts. Updated UX skill guidance for modal
  ownership, mounted optional drafts and hidden-field validation.
- Web typecheck exited 0. First focused modal run passed 21/21. Expanded picker
  run passed 26/34 because its deterministic DOM stub lacked `closest`; added
  that real-DOM method to the fixture. Final focused run passed 34/34, exit 0,
  `/tmp/orbyn-redesign-modal-focus-check-r3.tap`. JSDOM runtime covers focus cycle,
  owned picker, higher modal, busy dismissal and cleanup/opener restoration.
- Browser keyboard/pixel acceptance and remaining overlay/source audits remain
  open. No candidate or merge; full delivery review counter remains 0/3.

### Teams and member management continuation

- Web rename/delete move into the title’s Team options popover, behind the same
  permission checks. Add member is a named disclosure on both clients; mounted
  email/role fields preserve drafts when collapsed. Deletion and self-role/leave
  confirmations keep their consequences in a separate body.
- Team/member identities wrap instead of truncating. Mobile collection roles sit
  beneath name/counts, leaving room for long names; shared radius tokens replace
  local literals. Team collection/member entrance markup removed on web.
- Builder web/mobile final typechecks exited 0. Focused shared-control checks
  passed 14/14, exit 0, `/tmp/orbyn-redesign-teams-check.tap`; the new runtime
  fixture covers full mobile team names, role placement and selection callback.
  This is source/runtime evidence, not rendered acceptance or whole Teams coverage.
- Team planning, capacity, policies and agent subpanels still need the remaining
  source audit. Full implementation/candidate/Test/Review/final Visual remain open;
  uncommitted/unmerged, review counter 0/3.

### Team policy and planning panels continuation

- Shared team permission labels/helpers are shorter while retaining public scope,
  assistant read access and effects of turning publishing/bookings off. Mobile
  permission controls use a flat section rather than another nested card.
- Outside agents retain the chosen policy consequence; named access details hold
  member-access bounds and first-use metadata. Full member/app names wrap; web
  connection rows and policy controls reflow at their available width.
- Meeting budget shows its current value with counting rules behind named help
  on both clients. Capacity cells have 44px targets, full member names and token
  radii; web availability tracks use semantic colors and meeting slots wrap actions.
- Core package build and web/mobile typechecks exited 0. Combined check command
  passed shared-control tests 14/14, but capacity/analytics database suites failed
  setup for missing TEST_DATABASE_URL (14 pass, 2 suite failures, exit 1) at
  `/tmp/orbyn-redesign-team-panels-check.tap`. Those database suites did not run;
  this batch does not claim backend or rendered acceptance.
- Full TeamTime/TeamPlanning interaction audit and remaining screen coverage still
  open. No candidate/merge, review 0/3; final visual batch remains deferred until
  all implementation is complete.

### Team planning flow continuation

- Availability and manager session history are named disclosures; week navigation,
  capacity/workload and at-risk tasks remain in the main planning flow. Meeting
  participant/duration setup expands under Find meeting times on both clients.
  Collapsing these sections retains their mounted selections and draft fields.
- Mobile planning panels are flat rather than a series of nested cards. Full
  member/task names and zone labels wrap, workload badges and meeting-slot actions
  reflow, and progress tracks use shared radius tokens.
- Mobile Review event opens the editor; Save event performs the existing immediate
  save. Short helper preserves that distinction, and Find times is disabled for
  an invalid oversized participant selection. Privacy and focus-disruption warnings
  remain visible in their corresponding expanded flow.
- Builder web/mobile typechecks exited 0 before the final button disabled-expression
  edit. Focused controls/planning source checks passed 15/15, exit 0 at
  `/tmp/orbyn-redesign-team-planning-check.tap`. Source assertions cover disclosure
  destinations, retained at-risk output and distinct review/save callbacks; they
  do not establish browser interaction or rendered acceptance.
- Remaining screen-family/source audit and complete candidate Test/Review/final
  Visual gates remain open. All redesign changes uncommitted/unmerged, review 0/3.

### Teammate selection and Teams connection continuation

- Calendar teammate pickers use one short privacy/selection-limit note. Full names
  wrap, phone selection rows have inner vertical padding and shared radii, and web
  picker/legend actions retain 44px targets. Existing five-person limit, saved
  selection, pinning and busy-only retrieval remain unchanged.
- Teams connection copy is concise and action-oriented; pending identity IDs,
  link command, expiry and messaging opt-in remain visible. Mobile connection
  identity/action rows wrap, with smaller review-panel padding; web long identity
  values wrap. Store ownership, expiry and delivery guards remain unchanged.
- Builder desktop/mobile typechecks exited 0. Focused shared controls and Teams
  connection runtime checks passed 23/23, exit 0 at
  `/tmp/orbyn-redesign-teammates-channel-check.tap`. Connection fixtures cover
  account review, linked messaging permission, delivery/expiry states and callbacks;
  these results do not establish real Teams delivery or rendered acceptance.
- Selected teammate/Teams connection sources assessed; final web/Expo render remains
  pending. Full redesign source coverage, candidate/Test/Review and main integration
  still incomplete; review counter 0/3.

### Admin storage continuation

- Current usage/import queue/uploads stay visible. Import history is a named
  disclosure on both clients; mobile usage tiles reflow at their own width.
  Filenames remain complete, web metadata separates owner/status from expiry,
  and storage action groups wrap instead of squeezing their neighbors.
- Import errors are accessible through disclosure on web and phone, replacing
  hover-only web errors. Upload expiry and administrator delete-only authority
  stay explicit; existing delete confirmation/import cancellation and audit
  behavior remain unchanged.
- Builder desktop/mobile final typechecks exited 0. Initial focused checks passed
  15/16 and exposed a missed mobile error-details insertion; corrected it.
  Final focused source/runtime checks passed 16/16, exit 0 at
  `/tmp/orbyn-redesign-storage-check-r2.tap`. New source assertions cover history,
  complete errors, filenames and retained delete confirmation callbacks; these
  are not rendered or backend storage qualification.
- Admin Database/System were located and partially read, not qualified as fully
  assessed. Remaining family audit and full candidate/Test/Review/final Visual
  still open; uncommitted/unmerged, review counter 0/3.

### Admin database continuation

- Database navigation now measures its own pane. Narrow views use the searchable
  Table selector; wide views retain the table library. Header duplication removed,
  mode controls/pagination/actions wrap, and schema/table identifiers stay complete.
- Web validated row edits use an owned body-portal modal with shared focus handling,
  busy dismissal guard and existing review/save confirmations. Mode/table changes
  are disabled while saving; user/team APIs, redaction and self-demotion warnings
  remain intact. Table detail choices use ordinary pressed buttons rather than an
  incomplete tab interaction contract.
- Long web cell values expand to their complete redacted text without hover. Mobile
  Full row details is available even with five or fewer columns, so long values
  always have an expansion route; field names wrap and editor switches/role/name
  controls respect busy state.
- Initial web typecheck found an HTMLElement/div ref mismatch in the new dialog;
  corrected the semantic wrapper. Final web/mobile typechecks exited 0. Focused
  shared controls/dialog checks passed 25/25, exit 0 at
  `/tmp/orbyn-redesign-database-check.tap`. Added source checks cover navigation,
  ownership, full values and retained warnings; hook runtime fixtures cover generic
  focus/dismissal behavior. Real browser editor interaction remains pending.
- Full source-family audit/candidate/Test/Review/final Visual remain open. Redesign
  remains uncommitted/unmerged; review 0/3. System controls next.

### System settings continuation

- Routine origins/rate/reminder/status settings remain visible. Email configuration
  and test delivery are named disclosures on both clients; mounted fields preserve
  drafts. Web invalid events open the containing disclosure; mobile invalid SMTP
  port state keeps its email disclosure open and the error visible.
- Settings fields respect in-flight saves, including password removal/retention and
  TLS. Web email test controls respect settings saves. Password removal and blank
  host/email-off consequences remain explicit inside the relevant configuration.
- Web form columns reflow at available width using intrinsic grid tracks. Email
  fields use semantic surfaces/accent and System cards no longer request ornamental
  entrance motion. Existing workspace save/reset confirmations remain intact.
- Builder desktop/mobile typechecks exited 0. Focused shared controls/dialog checks
  passed 26/26 (0 failures), receipt `/tmp/orbyn-redesign-system-check.tap`.
  The new checks assert source disclosure/invalid-field/save-guard contracts; they
  do not establish real browser form validation, email delivery or rendered quality.
- Settings structure is source-assessed; maintenance, announcements, retention and
  version panels still need their full audit. Full inventory/candidate/Test/Review/
  final Visual remain open. All redesign work uncommitted/unmerged, review 0/3.

### System operations continuation

- Maintenance keeps its switch/state and member-edit restriction visible; mounted
  notice editing is optional. Web/mobile pending controls guard message/time edits.
  Announcement inputs respect publishing; audience/confirmation remain visible.
- Retention descriptions are optional, while record/count/keep-time/sweep results
  remain visible. Rows reflow through pane container rules below 600px. Integer-day
  validation preserves invalid drafts and blocks saving; sweeping explicitly confirms
  irreversible removal. Existing shortened-retention warning remains intact.
- Version identifiers and full commit messages wrap or disclose without clipping.
  Server update configuration is named optional help; current version/update/deploy
  actions remain accessible. Mobile System currently has no Announcement/Retention
  panels; those independent mobile surfaces require inventory reconciliation.
- Builder web/mobile typechecks exited 0; focused controls/dialog checks passed
  27/27, exit 0 at `/tmp/orbyn-redesign-system-panels-check.tap` before the final
  mobile Home copy-only cleanup. Source checks cover controls/consequences/reflow
  rules, not real browser rendering or operational API qualification.
- Home screenshot provenance: port 5174 listener PID 92672 has cwd in the active
  c6-next desktop checkout. Current Home source uses small Sparkles/Clock icons,
  whereas the owner's screenshot shows mascots; rendered/runtime reconciliation
  remains open. Removed duplicate guide copy and reduced mobile lane heading weight.
- Full redesign/inventory/gates remain open, uncommitted/unmerged, review 0/3.

### Admin accounts, audit and request controls continuation

- Web account role/verification/disable/delete controls now live behind each
  account's options trigger. The current account is resolved from the current rows;
  existing confirmation, self-deletion exclusion, search and pagination stay intact.
  Name/email/state remain visible; ornamental row staggering removed.
- Audit target IDs and event detail are available in named touch-accessible
  disclosures, replacing shortened IDs/hover-only detail. Mobile names/emails and
  audit targets/actors wrap; event JSON is optional full detail.
- Request heading is concise and log filters are a mounted disclosure with active
  indication and Clear filters. Service health, request sampling/retention facts,
  log rows and request drill-down remain visible. Full Requests/Insights assessment
  remains open; this scoped filter/header pass is not whole-family qualification.
- Builder web/mobile typechecks exited 0. Focused controls/dialog checks passed
  28/28, exit 0 at `/tmp/orbyn-redesign-admin-lists-check.tap`. Added assertions cover
  menu action availability/consequences, full audit identifiers/detail and filter
  disclosure. Actual admin browser interactions/rendered assessment remain pending.
- Correction to System discovery: mobile AnnouncementCard and RetentionCard exist
  in `mobile/src/screens/AdminInsights.tsx`, mounted through AdminSheet. They were
  not missing from mobile; their source assessment is next alongside mobile Requests.
- Full source coverage/candidate/Test/Review/final Visual and main integration remain
  open. Changes uncommitted/unmerged; review 0/3.

### Mobile operational panels continuation

- Requests filters are a mounted named disclosure with active indication. Clearing
  filters also clears route; Slow uses checkbox semantics. Full route/person/service
  values wrap. Loading states and sampling/seven-day retention limits remain visible.
- Mobile retention now renders every category, including read-only expiry rules.
  Descriptions/sweep errors are optional detail, counts and last removals remain
  visible. Day drafts are preserved, validated as whole values 0–3650 and locked
  during saving. Immediate sweep asks about irreversible removal through owned
  confirmation; shortened-retention consequence stays explicit.
- Announcement controls lock while publishing. Current stop time is shown where
  configured; audience/dismissal copy is concise. Banner dismissal has a 44pt target.
  Shared stats/retention rows wrap with intrinsic basis; chart corners use tokens.
- Builder mobile typecheck exited 0 before the final banner target styling.
  Initial focused runs each passed 28/29: a new source assertion accidentally
  included legitimate configurable-only draft initialization, rather than rendered
  category selection. First correction did not apply; scoped the assertion to the
  render portion. Final controls/dialog checks passed 29/29, exit 0 at
  `/tmp/orbyn-redesign-mobile-operations-check-r3.tap`. Earlier failed receipts
  remain `/tmp/orbyn-redesign-mobile-operations-check.tap` and `-r2.tap`.
  These source/control checks do not establish API operations or rendered acceptance.
- Mobile Insights Requests/Retention/Announcement source assessed; Account/Analytics
  still pending their complete audit. Full candidate/Test/Review/final Visual remain
  open; all redesign changes uncommitted/unmerged, review 0/3.

### Account detail and analytics continuation

- Account management moved beside identity into web options popover/mobile action
  sheet. Edit/sign-out/reset/export/two-step actions retain existing confirmation,
  self/disabled/busy guards. Generated reset links stay outside the menu with their
  private sharing/expiry consequence. Profile fields lock during requests.
- Full mobile session/key/agent values wrap. Web abbreviated device labels have
  a full user-agent disclosure. Account metadata/actions adapt to available width.
- Analytics defaults to four primary metrics; every remaining metric and activity
  trend is available through named disclosures on both clients. Concise heading,
  units/period/counts-only provenance remain visible. Intrinsic grid sizes prevent
  fixed metric minimums from overflowing narrow content panes.
- Web Bars/mobile MiniBars expose full chart data on demand, providing exact
  touch-accessible values beyond hover tooltips. Existing chart totals/bars remain.
- Final web/mobile typechecks exited 0; focused controls/dialog checks passed 30/30,
  exit 0 at `/tmp/orbyn-redesign-account-analytics-check.tap`. Checks cover source
  menu guards, complete identifiers, metric coverage and chart data accessibility;
  real browser interactions and rendered acceptance remain pending.
- Admin Account/Analytics/Bars source assessment complete for this pass. Remaining
  family inventory/candidate/Test/Review/final Visual/main integration remain open,
  uncommitted/unmerged, review 0/3.

### Legal-policy editing continuation

- Service details are named optional configuration, revealed while required details
  are missing. Web invalid inputs open the disclosure. Fields lock during saves;
  saving/publishing legal text no longer overwrites unrelated service-detail drafts.
- Legal text editing moved to an owned web body-portal modal/mobile Sheet with
  scrolling, close/busy guards and full text. Web keyboard ownership uses shared
  modal focus. Formatting/placeholders are optional help; live-text saving vs.
  publishing renewed agreement remains explicit at the edit decision.
- Restoring starting text asks about replacement of live custom text on both clients.
  Existing publish confirmation/versions/current acceptance counts remain visible.
  Legal cards stop requesting entrance motion and use shared mobile radius.
- Initial formatting exposed missing closing wrappers during editor conversion;
  repaired before typechecks. Desktop/mobile typechecks exited 0 after substantive
  changes. Initial focused controls/dialog check 30/31 exposed missing web invalid-
  disclosure handler; inserted it. Final check 31/31 exit0 at
  `/tmp/orbyn-redesign-legal-check-r2.tap`; failed receipt remains `-check.tap`.
  Type results precede the final invalid-event handler insertion. Source/hook checks
  do not establish actual browser editing/focus/validation or rendered acceptance.
- Legal web/mobile source assessed; remaining full inventory/candidate/Test/Review/
  final Visual/main integration open. All redesign work uncommitted/unmerged0/3.

### Provider setup and semantic controls continuation

- Web provider creation/editing uses a focused body-portal modal with shared keyboard
  ownership, pending dismissal guard and intrinsic form columns. Existing mutation
  confirmation/provider revision flows remain intact. Inputs/kind/cancel lock during
  saves; provider table no longer asks for staggered entrance.
- Key status stays visible without decorative saved-key fragments. Mobile provider/
  model labels no longer clip; fields respect busy/removal state and ornamental press
  scale removed. Existing mobile focused provider form route remains intact.
- Web semantic setup keeps readiness/status and page-text sharing consent visible.
  Technical index configuration is optional detail; labels shortened. Consent locks
  while busy, and model controls flag invalid choices even while collapsed.
- Builder web/mobile typechecks exited 0. Focused controls/dialog/provider management/
  model catalog accessibility checks passed 40/40 exit0 at
  `/tmp/orbyn-redesign-provider-check.tap`. Added source checks cover modal guards,
  complete identifiers/consent; existing provider/catalog cases cover runtime states.
  Real editor interaction/rendered qualification remain pending.
- Web AiModelControls/SemanticSetup source assessed. AdminAi web/mobile provider
  editing/list changes remain partial full-source assessment; mobile semantic/model
  control and agent management families next. Full inventory/candidate/Test/Review/
  final Visual/main integration still open, uncommitted/unmerged, review0/3.

### Mobile semantic search and model controls continuation

- Mobile semantic setup now has concise readiness labels, a visible embedding-model
  label, and optional Index configuration. Page-text sharing consent names the
  selected provider and assistant exclusions; it stays at the enable decision.
- Consent and catalog search lock during pending saves. Validation, generation and
  provider revision guards, failures/retries and forget-measurements action remain.
  Model-control errors are signalled in the collapsed row.
- Mobile typecheck exited 0 after these edits. Source assessment does not establish
  actual mobile-browser interaction or visual acceptance. Agent management and the
  remaining full inventory are next; full candidate/Test/Review/final Visual/main
  integration remain open, all redesign work uncommitted/unmerged, review 0/3.

### Agent administration continuation

- Agent access switches now use concise labels/consequences; ornamental entrances
  removed. Allowed websites and connection limits use mounted named disclosures
  on web and mobile. Empty-allowlist consequence stays beside its field.
- Website and limit inputs lock during saves. Mobile app names, hosts and usage
  identities wrap in full; row labels wrap, and web forms fit remaining width.
  Existing immediate-block confirmations and usage opt-out caveat remain.
- Desktop/mobile typechecks exited 0. This is partial implementation, not rendered
  acceptance. Existing adopt() resets unrelated host/limit drafts after settings
  mutations; assess and correct that before qualifying this family. Full candidate,
  Test/Review/final Visual and main integration remain open, review 0/3.

### Agent settings draft preservation

- Settings responses now adopt only the form explicitly saved. Access switches,
  legacy-key access and app blocking update current settings without resetting
  unrelated website/limit drafts. Initial load/explicit Refresh still reload forms.
- Desktop/mobile typechecks exited 0. Focused controls/dialog checks passed 33/33
  at `/tmp/orbyn-redesign-agent-config-check.tap`. New source assertions cover
  selective adoption, editable guards and complete identities; they do not prove
  real interaction/render acceptance. Full inventory and stable-candidate gates
  remain open, uncommitted/unmerged, review 0/3.

### Agent activity hierarchy

- Agent profile identity now uses 32px artwork and compact labels on both clients.
  Last-work timestamps are optional named details; runtime reporting, queue/recovery
  counts, schedule and token estimates remain visible with their actual evidence.
- Mobile activity/results uses mounted InlineDetails rather than conditional
  teardown, preserving handoff drafts while collapsed. Full titles, timestamps,
  existing handoff actions and after-close navigation remain available. Web activity
  dialog gets narrower-screen padding/height and reachable disclosure targets.
- Desktop/mobile typechecks exited 0. Source assessment does not establish visual
  acceptance or resolve the reported Home preview/source mismatch. The stable
  candidate, Test/Review, final bounded Visual and integration remain pending.
  All redesign edits uncommitted/unmerged, review 0/3.

### Background results and focused handoffs

- Background selects its own lane explicitly instead of relying on profile order,
  and uses compact identity artwork. Runtime counts/recovery and full results remain.
- Web handoff editor is a body-portal native dialog so it remains above the parent
  activity dialog, with shared focus ownership and busy Escape/cancel guards. Mobile
  uses an owned Sheet with scrolling and keyboard reachability. Errors stay inside
  the editor; input locks during sending. Draft state remains in the parent action
  across cancellation. Source revision and recipient lane checks are unchanged.
- Desktop typecheck exited 0. Initial mobile check failed because a nonexistent
  SheetScrollView import was introduced; replaced with React Native ScrollView.
  Final mobile typecheck exited 0. Overlay interaction, focus restoration and
  rendered evidence remain pending for the final candidate qualification.
- Full inventory/Test/Review/final Visual/main integration remain open, all edits
  uncommitted/unmerged, review 0/3.

### Chat change summaries and suggestion cleanup

- Reply change summaries now expand to all changes beyond the first eight on both
  clients; no changes are hidden behind a noninteractive count. Expansion resets
  for another job. Mobile linked titles wrap in full; link/expansion targets are
  reachable. Existing Undo, failure feedback and item navigation remain.
- Main web chat suggestions no longer request staggered entrance. Visible sharing
  notice shortened while retaining question/context/opened-page scope and AI
  provider destination; full AssistantView source assessment remains pending.
- Desktop/mobile typechecks exited 0 for change-summary edits; subsequent desktop
  typecheck covers chat suggestion/notice edits. Final interaction/render evidence
  remains pending. Full candidate/Test/Review/final Visual/main integration still
  open, all redesign edits uncommitted/unmerged, review 0/3.

### Chat history, answer recovery and approval coverage

- Web history titles/metadata wrap fully, selected chat exposes aria-current, and
  search uses shared control text sizing. Existing pane-width ownership, single
  compact panel, keyboard loop and navigation dismissal remain. Chat rename/pin/
  save-as-note lock while their request is pending; rename draft remains on failure.
- Web/mobile question replies no longer clear typed answers before the request.
  Existing waiting-question lifecycle clears them when the question changes; fields
  lock while busy. Approval lists show every proposed step rather than silently
  truncating at 20. Question, consequences, decline/apply and permission choices
  remain visible.
- Desktop/mobile typechecks exited 0 after answer/approval/history changes. Final
  desktop typecheck exited 0 after menu pending guards. This is source/type evidence;
  real failure recovery, keyboard/panel and final visual qualification remain open.
  Mobile AssistantScreen full-source assessment remains partial. Full stable
  candidate/Test/Review/Visual/main integration open, uncommitted/unmerged0/3.

### Mobile chat parity and full schedule review

- Mobile chat removes feature-owned FadeIn entrances and clipped suggestion/progress
  labels. Composer uses a compact shared card radius. Sharing notice matches the
  concise web scope/destination wording. Existing user messages remain selectable.
- Rename sheet guards dismissal/input while saving and reports failures inline,
  preserving the draft. Drawer exposes selected chat state and wraps full titles.
- Limited PlanView previews now expand to every proposed session before Apply;
  moves, risk notes, chosen ticks and authority are unchanged. Full remaining
  mobile family/overlay assessment is still in progress.
- Mobile typecheck exited 0 after chat/drawer changes and after PlanView expansion.
  Real narrow browser layout, rename failure recovery and all-session interaction
  remain pending in final candidate qualification. Full stage uncommitted/unmerged,
  review 0/3; full inventory then Test/Review/final bounded Visual/main integration.

### Booking detail ownership and optional information

- Web booking detail now portals to body and uses shared modal focus ownership,
  including nested picker ownership. Pending action/note saves guard close, backdrop
  and Escape; cancellation reason, host-note and custom-time inputs lock during
  their saves. Escape still returns from an edit step before closing the drawer.
- Private-note editing and history use named mounted disclosure on both clients.
  Booking identity, time, attendee/email, answers and cancellation consequences
  remain available. Mobile removes ornamental layout calls and preserves unrelated
  private-note drafts when other booking actions respond.
- Desktop/mobile typechecks exited 0. Web BookingDrawer source assessment progressed;
  mobile BookingDetailView is partial (remaining source/layout audit pending). Real
  picker/dialog dismissal, save failures and rendering remain unqualified. Full
  stable candidate/Test/Review/final Visual/main integration pending, review 0/3.

### Booking list readability and pending reschedules

- Booking status filters are ordinary pressed buttons with wrapping, rather than
  incomplete ARIA tabs. Attendee names, emails and page labels wrap fully. Inbox
  no longer adds a second portal around the drawer that owns its own portal.
  Load-more/export ignore repeated activation while pending.
- Public management removes entrance motion and guards repeated move/cancel,
  Back/Keep and cancellation-reason edits during saving. Public/host SlotPicker
  controls use a disabled fieldset during rescheduling, keeping selected time stable.
- Mobile booking lists remove feature entrance/layout requests and clipped names/
  metadata; remaining BookingsHome source assessment is partial. Desktop/mobile
  typechecks exited 0, then final desktop typecheck exited 0 after picker guards.
  Full public management source audit, actual interaction/render and stable-candidate
  Test/Review/final Visual/main integration remain pending; review 0/3, unmerged.

### Public profile settings: focused editing

- Web profile settings now show public/off status and the current link, with handle
  and bio edits in an owned native dialog. Shared focus ownership and pending
  dismissal guards apply; saved values refresh and failed edits remain in place.
- Mobile uses a scrolling shared sheet instead of an expanding inline form.
  Cancel/dismiss retains the draft; fields lock while saving. Clearing a handle
  now sends null to turn the page off, with that consequence stated at the field.
  Existing explicit take-down confirmation and booking-page independence remain.
- Both full ProfileCard sources assessed. Desktop/mobile typechecks exited 0 on
  the initial editor changes; subsequent copy/loading/cleanup edits receive the
  final check: both desktop and mobile typechecks exited 0 after those edits.
  Interaction/render acceptance remains pending in the final
  candidate batch; entire redesign remains uncommitted/unmerged, review 0/3.

### Public booking hierarchy and offered-time editor

- Public profile uses a bounded reading column, compact heading and simple booking
  rows. Full names, bios and descriptions wrap; page transitions reset stale data
  and errors. Failed loading offers Retry. Shared public messages drop decorative
  entrance motion; public shell spacing and branding are compact at phone widths.
- Offered times now opens an owned native dialog with shared focus ownership,
  Escape/pending dismissal guards and disabled form controls. Parent-mounted form
  state retains title/windows/location/co-hosts/reminders/expiry on close; success
  resets the completed draft. The large week grid is optional; typed windows stay
  visible, and the complete selected-window list wraps with reachable removal.
- Copy outcome accurately distinguishes copied vs ready link. Existing expiry,
  co-host availability, booking authority and withdrawal consequences remain.
- Desktop typecheck exited 0 after public changes and the initial offered-time
  dialog; the final grid/draft cleanup typecheck also exited 0. These are
  source/type checks; real focus, selectors, pointer interaction and render
  acceptance await the full candidate. Mobile invite parity remains unassessed.
  Entire redesign remains uncommitted/unmerged, review 0/3.

### Mobile offered-time parity

- Full Invites source assessed: concise one-use/immediate-booking consequence, full
  wrapping titles, complete windows available in disclosure and no row/success
  entrance animation. Failed list loading offers Retry.
- Editor keeps required title/duration/windows first; optional meeting details
  use mounted disclosure, revealed for invalid link/expiry after submit. Co-host
  availability/calendar consequences remain beside their choices. Busy text,
  chips, dates, clocks, removals and reminders lock during creation.
- BookingSheet retains the invite editor across Back/close so its draft survives;
  pending creation guards navigation. Back from successful creation resets the
  completed draft. Other page/detail transitions remain partially assessed.
- Shared DateField, RemoveButton and ReminderChips add optional disabled forwarding
  without changing their default behavior. Initial mobile typecheck exited 0;
  final persistent-editor mobile typecheck also exited 0. Interaction/native/browser
  evidence remains pending in the full candidate batch, review 0/3, unmerged.

### Booking-page configuration hierarchy

- Web configuration groups now use native disclosures; details/availability start
  open, other groups collapse. Removed duplicate section-jump controls. Summaries
  retain durations, availability mode, override/question counts and approval mode
  so hidden configuration stays identifiable.
- Invalid native fields reveal ancestor groups; custom validation opens its group
  without smooth scrolling. Saving disables form/close/cancel and guards draft
  setters. Link prefix wraps in full instead of clipping; fields reflow at their
  available width. Shortened group helpers preserve calendar/approval authority.
- Initial desktop typecheck exited 0; final value-summary check pending terminal.
  This is partial PageForm source assessment: scheduling, routing, custom hours,
  question internals and mobile counterpart still need complete review. Keyboard,
  validation and rendering evidence await final candidate qualification. Review
  remains 0/3, uncommitted/unmerged.

### Booking-page editor ownership and nested pickers

- Booking-page edits now open in an owned native dialog, using shared focus
  restoration and busy dismissal guards. BookingView keeps the selected form
  mounted when closed; reopening the same page/new-page form retains its draft.
  Successful save clears the completed form. Switching to another page starts
  that page's draft. Form source assessment is still partial.
- New-page co-host routing choices now resolve names from loaded team members
  instead of displaying every new host as “A co-host”. Existing saved host name
  fallback remains. Custom hours reflow in the dialog at narrow widths; remove/
  reorder controls have reachable targets; legacy white inputs now use theme
  surfaces and shared control sizing.
- Shared Select and Popover portals now remain inside an owning open native
  dialog so the browser's top layer does not hide/inert their menus. Outside
  dialogs they retain the body portal. This affects date/time menus too.
- Desktop typecheck exited 0 after modal edits and after picker placement.
  Focused controls/dialog checks: 33/33, terminal exit 0, receipt
  `/tmp/orbyn-redesign-booking-dialog-check.tap`. These existing checks do not
  establish native top-layer rendering or all booking interactions; those remain
  in the final Visual/Tester batch. Full source inventory/review still open,
  uncommitted/unmerged, review 0/3.

### Mobile booking configuration and nested fields

- Mobile page editor removes ornamental layout calls and animated error scrolling;
  questions summary uses a count while full questions remain in their group.
  Co-host names/emails wrap fully. Color/preview/host controls use shared radii.
- Primary inputs, segmented/chip choices, switches, presets and reminders lock
  while saving. Busy state reaches the owning BookingSheet, guarding Back/close.
  Successful delete explicitly leaves the removed page and refreshes the list.
- Full question, availability and time-zone sources assessed: nested date/clock/
  question/type/options controls forward disabled state. Helpers are shorter;
  time-zone names remain complete and section bodies stay mounted when collapsed
  so nested custom-input drafts survive. Existing approval/required-answer/co-host
  constraints and deletion consequences remain. Full page-editor/navigation draft
  parity remains partially assessed.
- Mobile typechecks exited 0 after primary and nested changes and final delete
  navigation correction. Existing focused controls/dialog/disclosure cohort passed
  34/34, terminal exit 0: `/tmp/orbyn-redesign-mobile-booking-check.tap`. This does
  not qualify all booking interactions or rendered/native layouts. Entire redesign
  remains implementation, uncommitted/unmerged, full review 0/3.

### Mobile page drafts and public booking states

- Mobile BookingSheet keeps the selected page editor mounted across Back/close.
  Reopening that same unsaved target preserves its draft; switching targets or
  starting a new page after successful save starts a fresh form. Successful
  deletion clears the removed editor. Only one page draft is cached. Latest
  mobile typecheck exited 0; navigation/rendered acceptance remains pending.
- Full PublicInvite, PublicBooking and SlotPicker sources assessed. Public forms
  lock native and custom question/time-zone/duration controls while submitting;
  submission handlers guard duplicate/in-flight requests. Route target keys reset
  stale identity state. Availability failures expose Retry without losing typed
  fields; invite timezone changes reset its displayed date/day.
- Shared SlotPicker disables stale day choices during refresh/errors and limits
  its selected day to the displayed week. Available-time list names identify the
  date. Initial invite/page failure has an explicit retry action. Public screens
  remove entrance motion, use compact headings/spacing, wrap host/location values
  and shorten routine copy while keeping approval/expiry/privacy consequences.
  User-defined titles, descriptions, questions and confirmation text remain full.
- Desktop typechecks exited 0 after invite/picker changes and after public page
  changes. These are type/source receipts only; rendered keyboard, time-zone,
  refresh/error, submit and cancel interactions remain in the final candidate
  checks. Whole redesign remains implementation, uncommitted/unmerged, review 0/3.

### Public booking management and reminders

- Full ManageBooking source assessed. Move/cancel now open owned native dialogs
  with shared focus restoration and busy Escape/explicit-close guards. Cancellation
  identifies the booking/time and preserves the host-notification consequence;
  dismissing retains the typed reason. Booking details remain underneath.
- Initial booking load has an alive guard and Retry. Reschedule refresh clears
  stale selections, offers Retry and blocks movement while availability is loading
  or failed. Shortened routine labels; full host/title/time values wrap. Dialog
  actions reflow at narrow widths. These interactions still need rendered checks.
- Full RemindersField source assessed. Explicit disabled state reaches its custom
  Select, add/remove actions and setters from page/invite editor pending state.
  Prevented adding a stale selected preset already present in the value. Labels
  are shorter; reminder limit and change/cancel-link information stay visible.
- Desktop typechecks exited 0 after management dialogs and reminder forwarding.
  No formal/visual acceptance claimed; candidate remains dirty/unmerged, review
  0/3. Remaining surface inventory and whole delivery gates still apply.

### Calendar sets, menus and agenda rows

- Full CalendarSets/CalendarMenus/DayAgenda/AgendaList sources assessed. Calendar
  sets use an owned native dialog with shared focus restoration and busy close/
  Escape/cancel guards. Pending saves disable edits/add/remove and reject duplicate
  submits. Subscription fetch failure is visible with Retry and guarded cleanup.
- Set list/subscription choices use named disclosures with selected counts; list
  “All” semantics remain visible. Shortcut instructions are optional help. Set names
  and choice labels reflow; menu labels preserve recurrence/team/read-only/busy
  authority while shortening routine text and hiding the copy shortcut by default.
- Agenda row entrances/stagger removed. Empty states state the actual date scope.
  Rows use a time/content grid, put task status beneath the content, wrap full title/
  team/location metadata and move Join below the row at narrow actual pane widths.
- Desktop typecheck exited 0 after calendar-set/menu edits; final combined agenda/
  CSS typecheck receipt recorded below. Rendering, selector/focus, long-label and
  saving interactions remain for the whole candidate Test/Review/Visual checks.
  Implementation remains dirty/unmerged, full review 0/3.
- Final combined calendar/agenda desktop typecheck also exited 0.

### Home agent-entry simplification

- Full web/mobile HomeCompanions source assessed. Removed the competing Activity
  header button: the two lane rows now provide the activity entry. Web rows open
  agent profiles; mobile rows retain their lane-specific destination. A compact
  chevron indicates navigation. “How agents work” follows the primary rows.
- Web uses a pane-width responsive row: identity and brief description on wide
  panes; description beneath identity on narrow panes. Default Home uses small
  decorative role icons; character browsing stays behind optional guide/presets.
  Custom names, explicit lane role, idle authority and full guide remain intact.
- Desktop/mobile typechecks exited 0 after primary row changes. Updated the Home
  VM fixture for row actions/decorative chevron; focused check passed 14/14 with
  terminal exit 0, receipt `/tmp/orbyn-redesign-home-rows.tap`. The fixture tests
  identity/account fencing and disclosures; its “native” names refer to mobile
  source rendered with stubs, not native/browser acceptance.
- Owner screenshot discrepancy is unresolved: current source had already removed
  default characters before this batch. Do not claim the supplied runtime view
  fixed until final Visual verifies matching source/runtime. Entire redesign
  remains implementing, uncommitted/unmerged, full review 0/3.

### Notifications, mentions and recent changes

- Full desktop NotificationsView and RecentChanges sources assessed. Agent
  questions expose load failures/Retry and guard overlapping answers. Notice
  writes serialize, display failures beside the initiating row and mark read after
  success, so a failed conflict action remains retryable. Full question detail and
  automatic-default/deadline consequences remain visible.
- Desktop/mobile mentions expose fetch failures with Retry, guard post-unmount
  responses and let people expand the initially shown rows. Web titles/quotes and
  notice values wrap. Mobile mention quotes retain their compact preview with full
  content reachable through the page. Mobile question writes serialize and its
  inbox no longer uses ornamental FadeIn wrappers; full Inbox source assessment
  remains partial beyond the question/mention sections.
- Recent Changes uses an owned native dialog with shared focus restoration; no
  scale entrance. Versioned requests reject old-filter responses and duplicate
  pagination; errors expose Retry. Rows reflow time metadata at actual narrow pane
  widths, preserve author/value text and use shorter empty/paging labels.
- Desktop typechecks exited 0 after both implementation batches. Mobile initially
  failed three missing SmallAction disabled props, then failed two after a partial
  repair; explicit props corrected all three. Final mobile typecheck result is
  recorded below. These receipts are not rendered or full-delivery acceptance.
  Whole redesign remains implementing, dirty/unmerged, review 0/3.
- Final repaired mobile Inbox typecheck exited 0.

### Mobile inbox and recent-change hierarchy

- Full mobile InboxScreen/RecentChanges sources assessed. Inbox questions, mentions,
  asks and pending reviews now sit above the notification list rather than nested
  inside its bordered card. Removed repeated “Tap to…” visual instructions while
  retaining accessible action hints; corrected the page-open hint. Short empty
  state and shared compact 13px row title/body roles reduce competing text.
  Full notice body and automatic-choice consequences remain unchanged.
- Mobile Recent Changes now matches latest-request fencing, cleanup and guarded
  pagination of web. Error has Retry, paging indicates Loading, empty copy is short.
  Complete titles/edit/team metadata wrap without line caps; timestamp sits beneath
  identity/content and deleted items have a visible Deleted label. Sheet ownership
  and native preference storage remain.
- Mobile typecheck exited 0 after both changes. No rendered/native acceptance
  claimed. Final narrow/light/dark, long-value and failure/selection interaction
  checks remain in the whole stable-candidate batch. Implementation dirty/unmerged,
  full review 0/3.

### Days-ahead planning and experiment editors

- Full HorizonLanes/horizon.css sources assessed. Titles/reasons wrap in full; move
  controls reflow beneath content at narrow actual pane widths. Moving instructions
  use named help. Pending/non-live plan moves are guarded, including drag/drop,
  while dependency checks and pin authority remain.
- Full web/mobile PlanExperiments and ExperimentEvidence sources assessed. New
  experiments and result editing use focused owned dialogs/sheets with busy close/
  dismissal/save guards and errors inside the active editor. Input, DateField and
  cancellation controls lock while saving; only one experiment editor is offered
  at a time. Dismissing retains creation fields and the latest same-record result
  draft; successful saves clear those drafts. Switching records replaces the
  cached result draft. Required success/review fields and version guards remain.
- Experiment list keeps title/status/review date and result action visible. Full
  success criteria, recorded outcome and before/during evidence use named detail
  disclosure. Load failures have Retry, failed initial load does not claim an empty
  list, evidence fetches reset on identity/retry and ignore unmounted responses.
  Text and evidence cells wrap; no user-authored experiment content is shortened.
- Desktop typechecks exited 0 after initial editor changes and after dialog error/
  evidence/CSS changes. Mobile typecheck exited 0 after sheet/evidence parity.
  Source/type receipts only: final focus/dismissal/picker/save/error and narrow
  rendered checks remain pending. Entire delivery dirty/unmerged, review 0/3.

### Plan checks, planner hierarchy and scheduling

- Full desktop PlanChecks/SchedulePanel/PlannerPanel sources assessed. What-if uses
  an owned dialog; preview-only consequence is visible, pending choices/fields/
  dismissal lock, changed input invalidates the prior result. Planning-history
  fetches have cleanup and a brief Retry state. Schedule rows preserve full task
  titles and expose optional placing instructions rather than a default paragraph.
- Desktop planner keeps Start/Days/Preview primary, discloses scope/scheduling
  options/tasks considered/keep-free detail and preserves conflict/risk review.
  Pending previews/apply/reschedule/roll-forward serialize and disable close,
  form and plan-card actions. Review load is versioned, exposes failure/Retry and
  avoids “All clear” after an error. Scope summaries reflect actual available teams.
  Nested fieldsets/layout reflow at actual narrow pane widths.
- Mobile what-if uses a focused sheet, full task search instead of a capped
  horizontal list, date fields instead of ten fixed day chips, pending guards and
  result invalidation. PlanSheet prioritizes preview/proposal/apply, moves extra
  planning tools after main actions, discloses scope/options, removes entrance/
  layout motion and clips no task title. Busy reaches its owning Sheet and guards
  local overlapping writes/field changes. Shared TimeField now forwards disabled.
  PlanSheet source assessment remains partial: remaining nested-editor/long-value
  details and HorizonView still need assessment.
- Desktop typechecks exited 0 after plan-check/schedule changes, initial planner
  changes and final planner/CSS correction. A scripted replacement failed before
  writing; corrected after inspecting current formatting. Mobile typechecks exited
  0 after what-if and after primary PlanSheet/TimeField changes. All are source/type
  receipts; interaction/render acceptance awaits full candidate qualification.
  Dirty/unmerged, full review 0/3. Owner asks Builder to continue across small
  batches; do not end delivery or start formal handoffs until full scope ready.

### Mobile planning editors and pane-based calendar layout

- Full HorizonView source assessed. Titles/reasons wrap; moving help is optional.
  Drag termination cancels instead of committing a move; holding without moving
  clears the drag state so scrolling resumes. Responder capture distinguishes a
  claimed move from a held tap. Disabled drag/drop guards and unmount cancellation
  remain; translation resets directly instead of springing. This needs final
  gesture interaction qualification, not inferred from types.
- Mobile PlanSheet move/estimate/keep-free forms use focused nested sheets with
  errors inside the active editor, guarded dismissal and disabled inputs/controls
  while pending. Main ErrorBanner hides while that editor owns its error. Removed
  clipped task titles. Remaining source/render assessment is still explicit.
- Month source assessed; calendar CSS now uses semantic surfaces/text/accent/warn/
  danger values in place of legacy green/light literals. User list/event colors
  remain. Calendar's actual width collapses month/agenda columns; month grid's
  actual width selects compact dots/day agenda rather than squeezed item bars.
  Long event names stay reachable in their day agenda/detail, and accessible
  day/item labels remain. Remaining CalendarGrid source still needs assessment.
- Mobile typechecks exited 0 after drag layout/termination changes and after nested
  planning sheets; final drag-capture correction is source-reviewed and still
  included in final candidate interaction checks. Earlier full desktop typecheck
  passed; later CSS changes require rendered qualification. No visual acceptance
  claimed, whole delivery dirty/unmerged, review 0/3.

## Calendar editors and follow-through continuation — 13 October

- CalendarGrid planned previews now have a keyboard/touch time action that opens
  BlockDialog with full task identity and preview-only scope. Removal is under
  More actions; pointer handlers live on the same action and suppress drag clicks.
  BlockDialog uses the shared focus owner and native body-portal dialog, busy
  dismissal guards, validated duration and editable blank numeric drafts. Calendar
  styles retain user colors and use semantic drag tokens; subscribed URLs wrap.
- Calendar controls fixture: 25/25 exit 0, `/tmp/orbyn-redesign-calendar-controls.tap`
  (earlier source before the latest duration draft refinement). This VM/stub
  evidence does not qualify browser gestures or dialog rendering.
- Both experiment lists ignore superseded/unmounted reads and serialize mutations.
  Both WelcomeBack views retain all updates through Show all, use concise day
  status, preserve full row text and recover failed dismissal.
- Mobile proof creation is a focused sheet with retained drafts, busy controls,
  loading/error/Retry and serialized writes. Removal is in MoreMenu. Meeting
  outcomes distinguish failed reads from empty records, reset by source identity,
  serialize writes and use concise outcome labels with wrapping mobile metadata.
- Both page freshness views serialize writes, keep pending fields/dismissal
  disabled and reset state by document identity. Optional update notes remain;
  success copy preserves the task recipient.
- Desktop typecheck exit 0 before the final freshness/calendar CSS changes; mobile
  typechecks exit 0 at both follow-through transitions. Final qualification remains
  pending. Entire redesign is dirty/unmerged, full review 0/3.

## Document, connections and mobile summary continuation — 13 October

- ConnectionsMap reads reset on identity/depth/revision, expose Retry, preserve
  complete titles in a browse list and use a native owned dialog for expansion.
  The list offers larger touch targets alongside the SVG. No rendered acceptance.
- Alias writes serialize and preserve typed names on failure. Agenda reads ignore
  superseded responses; rewrites/writes block navigation and repeated submissions.
  Rewrite confirmation keeps the replacement boundary and retained notes visible.
- Document menus use short hints, pane-responsive columns and reachable controls.
  Keyboard highlights scroll into view; unmatched slash searches remain visible.
  Read-only checklist boxes are disabled. User document text remains unchanged.
- Developer docs use compact grouped content; error/resource/version references
  disclose on demand, full access levels remain, catalog failure has Retry.
- Mobile Today rows wrap actions and titles, check-ins serialize and expose failure,
  summaries retain full text. Up next removes redundant Open and discloses reasons.
  Sync status wraps; switches default to semantic track colors; toasts use stable
  wrapping layout with reachable actions. Task delegation names Background/Overnight
  and guards pending writes. Final browser/Expo web qualification remains open.
- Connections conversion first failed formatting/types due to a leftover closing
  section; repaired before the next desktop typecheck, which exited 0. A further
  desktop check after document menu changes and mobile check after summary/delegation
  changes both exited 0. Current developer/toast tweaks await final batch checking.
- No source freeze, merge or final Visual handoff. Full review remains 0/3.

## Document panel and request-editor continuation — 13 October

- Page assistant guards keyboard submit and model mutations with the same
  permission/pending boundaries, resets by document and ignores unmounted model
  responses. It retains full replies/source links and short review-scope copy.
- History distinguishes failed loads from no versions, offers Retry, serializes
  preview/restore and separates the short confirmation title from the retained
  history consequence. Document-specific state resets by identity.
- Comment resolve/remove actions move into More actions; draft cancellation and
  mutation paths are pending-guarded. Removal consequence includes replies, backed
  by migration 037's parent-comment ON DELETE CASCADE. Mention loading/error/Retry
  stays visible; composition input does not submit a comment.
- Web/mobile request date and decline editors use focused owned dialog/sheets,
  retain message drafts, guard writes and show errors inside the active editor.
  Ask lists and item boxes ignore superseded reads and expose Retry.
- Outline labels wrap; document source keeps anchor/ownership/revision behavior
  and concise visible guidance, with phone input typography and reachable jump
  controls. Original deletion uses More actions and explicit permanent-file
  consequence, serialized against download. File-storage toggle serializes
  optimistic writes and recovers failed loading.
- Desktop and mobile typechecks exited 0 after request/read/comment batch, before
  the latest original/source copy/style adjustments. No native or rendered pass
  inferred. Whole implementation remains dirty/unmerged, full review 0/3.

### Document controls and link-picker continuation — 13 October

Builder continued implementation without a small-change handoff. Document page toolbar menus are mutually exclusive, close on outside pointer/Escape, and remain open while moving the pointer through their contents. Long action lists scroll within the available viewport. Opening Page assistant closes History/Info; their toolbar controls remain disabled until the assistant is closed through its own pending guard. Comments yield their margin while the assistant is open. The page loader now exposes Retry after a failed fetch. Editing hints and proposal decisions use short, direct copy; full proposal text remains visible. Original-file state is keyed to the page.

Link picker now clears previous query results, distinguishes searching/failure/empty states, supports Retry, and suppresses creation actions while search is pending or failed. Keyboard navigation avoids a negative index, keeps the highlighted result in view, and respects IME composition. Permission-filtered search and heading-anchor contracts are retained.

Desktop typecheck after the first toolbar batch: exit 0 (session 89879). A subsequent typecheck covers the link-picker batch; terminal result to be recorded. These are source/development checks, not final visual acceptance. DocEditor and DocLinks remain partially assessed; the main editor's earlier source ranges and remaining linked-item helpers still require coverage. No candidate freeze, formal Test/Review, merge or push in this batch.

### Mobile document and suggestion continuation — 13 October

Original files and proposed edits now use aligned web/mobile copy. Mobile original deletion moved into More actions, with the permanent deletion consequence visible in confirmation; downloads/deletions and storage toggles serialize their writes. Failed storage reads expose Retry. Today ideas retain full titles and put full summaries behind Details; Review rows wrap and do not animate in. Planner review retains full task/context text, guards latest reads, reports refresh failures, and serializes mutations.

Docs tree source assessed end to end: busy/read-only drag paths now match disabled controls; keyboard Move skips its current location and respects pending/composition state, and complete searchable target lists are retained. Linked-here state is keyed to the object with Retry and guarded link mutations. Full linked title/context wraps instead of ellipsis. Mobile Page assistant is keyed to its document, guards pending close/scope changes and read-only proposals, ignores callbacks after unmount, and uses optional scope disclosure. Sources and proposal contents remain intact; routine explanation is shortened.

Development receipts: desktop 90395 and 42673 exit 0; mobile 14272/39781 exposed a missing SmallAction disabled prop, repaired and mobile 59655 exit 0. Desktop 80796 exposed React keyboard isComposing access, repaired to nativeEvent; subsequent types pending. Mobile Page assistant typecheck 65914 pending. No visual claim or handoff yet.

### Page facts and outline continuation — 13 October

Page info is keyed to the page and no longer asserts “Only you” before location facts load. Info/file reads expose Retry. Source/file deletion serializes confirmation and mutation, checks write permission, and keeps permanent deletion/shared-file consequences visible. Alias failures propagate so the editor preserves the attempted name. Storage housekeeping moved into a named disclosure; file/source metadata wraps. Outline sections retain drag behavior and gain a keyboard/touch Move before picker with complete headings.

Latest terminal development types: mobile 65914 exit 0; desktop 92559 and 83455 exit 0. Outline-inclusive desktop 45015 pending. Source assessment is separate from final rendered/interaction qualification. All changes remain dirty, no frozen candidate or delivery handoff.

### Progress/proof and mobile shell continuation — 13 October

Web proof creation now opens a focused native dialog, retains failed/cancelled drafts, guards read/write identities and permissions, and exposes read Retry instead of claiming no proof after failure. Removal is in More actions. Progress uses the shared focus-owned native dialog, latest/read cleanup, scope labeling, read Retry and visible clipboard failures. Mobile Progress has the same report recovery/current-query behavior, optional scope disclosure, full titles/proof text and visible link/share failures; sharing serializes. The shared mobile shell no longer fades the entire page/header on tab switches or scales its global action buttons. Dates use sentence case, content spacing is compact, and round controls use theme radii. RootScreen remains partially assessed; this does not qualify all of its routing/interaction paths.

Receipts: desktop 45015/93689/81232 exit 0. Mobile 88210 found an incorrect radii import; repaired to the theme module and 62437 exit 0. Mobile Progress 23105 pending. Still no candidate freeze, formal Test/Review, visual batch, merge or push.

### Team meeting time and focus continuation — 13 October

Web/mobile team meeting-time views now use keyed team/week state, latest-read cleanup and Retry, distinguish failure from an empty/no-budget state, and serialize permission-checked budget writes. Mobile member names/time/chart stack within narrow panes; web meter maximum accommodates over-budget readings. Focus continuation preserves an existing session through a transient read failure, guards old/unmounted requests and keeps the updating countdown out of live announcements. Attention warnings' existing debounced/date-scoped read and advisory-only contracts were assessed; no new delivery gate introduced.

Mobile Progress 23105 exit 0. Desktop/team/focus types 70597 and mobile/team types 10599 pending. Prior duplicate scoped receipts remain development-only. Whole redesign still in progress; no freeze/handoff/merge.

### Today hierarchy continuation — 13 October

Today source assessed end to end: planned/due/late rows retain full labels, distinct actions, session check-ins and late-task disclosure. Added actual-card-width container behavior; narrow rows move their actions below task content rather than leaving a near-zero title column beside check-in controls. Empty state has one direct heading. Shared EmptyState supports omission of redundant body text and uses a compact decorative icon. Up next keeps its focus action, removes duplicate Open (the title opens), discloses reasons and protects later reads. Session check-ins serialize responses globally and retain rows with an actionable failure message. Mobile focus continuation now matches request cleanup and full wrapping text with 44-point actions.

Development type receipts: desktop 70597/11271 exit 0; mobile 10599/87392 exit 0. Latest Today CSS/EmptyState changes pending development types. No rendered acceptance or whole-scope completion is claimed.

### Shared compact metadata continuation — 13 October

Mobile status pills and planning metadata retain full labels and wrap within their parent, using the radius tokens. Progress bars now show the actual clamped value immediately without an entrance animation and expose the percentage to assistive technology; non-finite values safely render zero. Slot host/fill ownership and primary tab labels were inspected; they are structural/navigation contracts, with no independent layout to redesign.

Latest desktop development types 13076 exit 0. Progress-bar conversion initially left an obsolete animation cleanup fragment; Prettier/types 5171 failed and the fragment was removed. Mobile follow-up 58387 pending. These repaired development errors are retained in the ledger; none is treated as a passing test receipt.

### Reminder recovery and shared helper continuation — 13 October

Reminder actions and receipts serialize by card identity; a failed action-status read blocks duplicate actions and offers Retry. Move/book editors use focused web dialogs and mobile sheets, retain drafts and show errors in the editor. Booking duration rejects invalid values. Completed experiments retain the compact initial list and expose Show all instead of a silent three-item cap. Shared action execution guards repeated calls and ignores unmounted state updates; web progress clamps non-finite values. Calendar-app setup copy is short while email/personal-key requirements remain visible.

Small source helpers assessed: role/status/progress badges, outcome actions, day picker, concept icons, math rendering, linkification/legal text, mobile brand/linked text, diagram surfaces, reduced-motion/accessibility helpers, RSVP and document container/source styles. User text, renderer origin boundaries and text scaling remain intact. Motion utilities still need the remaining caller assessment; these source reads are not visual acceptance.

Development receipts: desktop 78416/89358 and mobile 97297 exit 0. Mobile Reminder's nullable DateField callback failed in 25703, repaired before 97297. No frozen candidate, formal Test/Review or merge.

### Page controls and template recovery continuation — 13 October

Link preview reads reset by target, reject old responses and distinguish failed reads with Retry. Duplicate completion actions removed; one accessible task checkbox remains. Full preview/title text wraps, actions reach 44 pixels, and mutations serialize. Page tag reads are keyed by page/space and recover failed loading; selection/creation respects permission and pending boundaries. Shared tag creation ignores composition Enter and duplicate submissions.

Merge now uses a focused native dialog, guards pending dismissal and duplicate writes, clears stale search rows and exposes search Retry. Its selected target remains visible in the option list; the action label stays short. Template insertion separates failure from an empty catalog. Create/save-template editors use focused dialogs and pending fieldsets; essential team-sharing and linked-task consequences remain visible, optional placeholder explanation is disclosed. Template catalog/context requests load together, ignore obsolete responses and expose Retry rather than silently hiding unavailable teams/projects/events. Standalone page window resets on identity changes and offers Retry for read failure.

Development receipts: desktop 12638 and 44821 exit 0; latest template/window read changes 99248 pending. Source assessment completed for PageActions, PageTags, PageTemplates, PageWindow and LinkCard; rendered/interaction acceptance is still pending in the final bounded visual batch. Implementation remains dirty and unmerged, review 0/3.

### Page updates, imports and mobile link controls — 13 October

Page-updates dialog is keyed to its page and uses shared keyboard focus ownership, Retry after preparation/read failures and full selected-block text. It keeps configured-model scope, estimated token cost/shared budget, immediate activation and proposal approval visible. Schedule options and metadata reflow and have reachable targets. Shared store session/version/mutation serialization was inspected and retained.

Import polling ignores superseded/unmounted responses, retains jobs through failures and exposes read Retry in Docs. Upload batches and removals reject duplicate submission; failed removals keep the job visible. Upload names/status wrap, the actual upload pane controls row reflow, optional format guidance is disclosed, and permanent original-file retention consequences remain visible. Uploads source assessed end to end; other callers of the shared import hook remain part of their owning screen assessments.

Mobile link cards reset by target, recover failed reads, serialize actions and guard close/Open while pending. One accessible task checkbox replaces duplicate completion buttons; metadata and full preview text wrap. Date choice uses the shared labeled control. Mobile page tags use a focused sheet, permission/pending guards, read Retry and full tag names. Mobile tab selection no longer bounces/scales or shrinks/caps label text; labels reflow with user scaling. Shared Bump is a stable compatibility wrapper. Web completion feedback is a short stable status without confetti; the screen-reader announcement remains.

Receipts: desktop 99248/71343/37239 and mobile 89908/31838 exit 0. Mobile tag changes 77943 pending. This is source/development evidence only. Full implementation continues, dirty/unmerged, no freeze or formal review, 0/3.

### Structured editor and rich blocks continuation — 13 October

Structured editor source assessed end to end, including draft/source ownership, synced scroll, permission/autosave, comments, history/restore and export. Local state resets by page; More closes on outside pointer/Escape; History and Comments share panel space. History reads reject old responses, distinguish failure and expose Retry; version selection/restore serialize and pending close is guarded. No document draft/revision contract changed. Compact headings/actions reflow; narrow source inputs retain 16-pixel text with line mapping based on computed line height.

RichBlocks source assessed end to end: callouts, tables, image/file/audio, code/metadata, bounded diagrams, embedded sections and linked tasks. Table tools stay in their owning block rather than floating over adjacent content; composition Enter is preserved and Shift+Tab can leave the first cell. Full file/embed/image names wrap, image viewing uses native modal focus, downloads serialize and show failure, file/image reads expose Retry and embeds retain previews through refresh failures with recovery. Existing file URL cache/renderer bounds/link authority contracts are retained; no live interaction or native acceptance inferred.

Mobile import source assessed end to end: protected picker/camera calls, latest-read cleanup, failed-removal row retention and read Retry. Full names/status remain visible; duplicate Open removed and optional file-format guidance disclosed. Mobile page updates is keyed to its page with Retry, full selected blocks, compact type and cost input, pending-safe Cancel; scope/cost/immediate activation/approval remain visible. Browser coverage does not establish camera/share-extension behavior.

Receipts: desktop 63695/33559/71517 and mobile 19361 exit 0. Mobile tag typecheck 77943 failed for missing SmallAction disabled; fixed and covered by 19361. Mobile page-updates 50872 pending. These remain development checks; no freeze, formal Test/Review, visual batch or merge, review 0/3.

### Mobile template continuation — 13 October

Mobile project templates source assessed end to end: failed catalog reads offer Retry, initial response cleanup is guarded, writes serialize, and the form returns to All templates. Repeat setup is a named disclosure; deletion moves to More options with the existing project-retention consequence. Read-only template spaces default to personal instead of selecting an unwritable team. Full descriptions/tasks remain accessible and approval stays explicit.

Mobile page templates source assessed end to end: all catalog/context reads commit together with latest-response cleanup/Retry, pending choices/Back/Cancel and writes are guarded, event results are no longer silently capped at twelve. Project/folder pickers disclose their complete current values; team scope remains visible. Save-template moves from the document body into a focused sheet, retains failed drafts, shortens optional placeholder help and preserves sharing consequences. Full template names wrap; header/actions adapt to narrow panes. Existing caller routing and editor contracts remain, with full mobile DocEditor/DocsSheet assessment still outstanding.

Receipts: mobile 88468/21207 exit 0. Minor final guard/status changes pending types. Whole implementation remains in progress; no candidate freeze or delivery handoff.

### Project secondary screens continuation — 13 October

Project notes and history reset by identity and reject obsolete reads, retain data on refresh failure and offer Retry. Mobile history serializes paging and clears the selected snapshot while another loads; its entire read-only historical content remains visible. Project note titles/previews wrap instead of clipping. Desktop and mobile milestones serialize writes, recheck edit permission and preserve failed drafts. Editing moves to a focused native web dialog/mobile sheet with pending dismissal and disabled fields. Task deadlines and removal consequences remain explicit. Task titles stay complete and status chips reflow beneath milestone metadata.

Project timeline full labels are now usable task targets instead of relying on tiny chart ticks. Mobile timeline opens from the whole lane and keeps timestamps in the accessibility label; chart markers stay within the tracks rather than crossing labels. Web chart ticks retain hover timestamps while task labels own interaction. Project records source assessed end to end: catalog/context reads commit together with Retry, mutation guards preserve version contracts, create/outcome editors use focused dialogs and full user text wraps. Read and write authority remains enforced by the backend.

Receipts: desktop 93707 and 56751, mobile 97614 exit 0. Subsequent ProjectRecords changes await development types. Still implementing the entire agreed scope; no frozen candidate, Test/Review handoff, rendered acceptance or merge. Review 0/3.

### Project record/template and side-preview continuation — 13 October

Mobile records now load context together, reject old responses, distinguish failed reads, serialize writes and retain versioned updates. Create/outcome forms are focused sheets; fields, choices and dismissal are guarded while pending. Optional source-note choices are disclosed with the current full title. Owner responses remain separately authorized from general edit permissions. Both promises panels retain failed refresh data, show Retry rather than false empty states, reset by user and guard duplicate mutations.

Web project templates use a native focused dialog, guarded dismissal/writes and retryable catalog reads. Unwritable template teams no longer become the destination by default. Repeat setup and deletion are disclosed; approval and deletion consequences remain visible. Full template titles/tasks wrap; dialog/actions fit narrow viewports. Side-preview source and CSS assessed end to end: read cleanup/recovery, higher-dialog focus ownership and full page/task/project content remain. The side-by-side breakpoint is now 1360 pixels to reserve space for navigation, preview and the main pane; narrower windows use the existing focused overlay. Task status labels no longer collapse every non-completed state to Not done.

Development receipts: desktop 82824 and 36484 exit 0. Mobile 42132 failed because InlineDetails expects title, not label; corrected. Final project additions await the next development check. These are source changes only, with final rendered/interaction acceptance pending. Whole scope remains in implementation; no freeze, handoff or merge, review 0/3.

### Main project screen continuation — 13 October

ProjectDetail source assessed end to end, with its project CSS and import caller. Stage naming and existing-task selection now use focused dialogs, with a full choice list instead of browser prompts and a twenty-task cap. Rename/summary drafts remain open on failure. Project writes serialize, read-only task/stage/deadline controls are guarded and board drag/drop respects permission. More options closes on outside pointer/Escape. Context, planning, sessions, search and history recover failed reads; search no longer displays No matches while pending and respects composition Enter. Alias-save failures propagate so unsuccessful drafts remain editable.

Project navigation uses a view picker in narrow actual panes and the existing full view strip in wider panes. Full task/stage/card/search titles wrap, narrow stages stack the move control, deadlines wrap and repeated actions reach 44 pixels. The project summary is no longer repeated in both header and Brief. Native web editor dialogs retain essential scope/share/destructive consequences. Source assessment does not establish final rendered interaction acceptance.

Receipts: mobile 51942 exit 0 covers repaired InlineDetails title prop and the project/record batch. Desktop 76632 failed because shared Select does not accept autoFocus; removed that unsupported prop. Latest ProjectDetail/CSS changes await the next development check. Full U1 implementation continues; no freeze, formal Test/Review/Visual handoff or merge, review 0/3.

### Overview and public/legal continuation — 13 October

Consent is keyed to account/terms version, guards duplicate acceptance and controls while pending, rejects obsolete document reads and keeps age/version/Terms/Privacy acceptance and optional analytics purpose visible. Public legal reads offer Retry; legal text remains complete with responsive navigation and readable type. Security-page and public demo source assessed without changing policy text. Homepage/source CSS assessed end to end: reduced primary navigation, shorter setup copy, on-demand character styles, compact section hierarchy, stable demos and wrapped actions. Marketing content remains separate from routine app copy.

Overview source/CSS assessed end to end: hub editor moves to a focused native dialog, all matching link candidates remain available through a scrolling picker, full hub/task/routine/brief names wrap and editor actions reflow. Home reads distinguish failure from empty goals/routines and show Retry; reflection writes reject duplicate submission and guard pending input. Existing preference persistence remains optimistic through usePrefs; that shared persistence path still needs its own source assessment before full qualification. Quote reads clear the previous source text while another loads. Agents retain the previously implemented neutral role icons and on-demand character browser.

Receipts: desktop 31400 and 64467 exit 0 cover project/source and homepage/legal development changes respectively. Latest overview changes await development types. Whole U1 remains dirty/in implementation, no freeze, formal Test/Review/Visual batch or merge, review 0/3.

### Recording, approval and shared controls continuation — 13 October

Web recording/presentation, recurrence scope and What's new now use native dialogs with modal keyboard ownership. Recording releases microphone resources when superseded/unmounted, blocks duplicate starts and retains full consent. Summary/task writes serialize and keep pending operations in their owning dialog/sheet. Mobile presentation scrolls full slides and removes overlapping whole-slide navigation targets. Mobile recording protects pending dismissal and uses visible-operation generations; Expo browser evidence will not establish native audio behavior.

Web/mobile approval reads reject obsolete responses, retain refresh data, expose Retry and disable approval while changes are unresolved. Complete before/after, sharing-space, recipient and stale-change consequences remain. RSVP resets by invitation, recovers failed reads and serializes explicit answers. Mobile Overview retains full custom hub links/titles, reports failed reads and guards reflection writes. Shared account preferences queue updates, combine pending view edits with other writes and return save results to retain failed hub drafts; shell preference read recovery still needs reconciliation.

Shared tabs have one management menu with existing keyboard/drag actions. Stars bind cached reads to the current account, recover reads, serialize changes and roll back failures. Notices keep full administrator text and briefly state maintenance consequences. Toast focus/hover retention remains; active focus moving between controls no longer drops its hold. Public status and releases use compact, wrapping hierarchies; all daily history values have a reachable control/disclosure rather than tiny chart-only interaction.

Development receipts: desktop 22922/77667/12019/79260/41086/43163 and mobile 50866/65491/15083 exit 0. Mobile 14161/61115 exposed missing BottomSheet closeDisabled; the shared component now supports it. Latest mobile status receipt 19600 pending. A scripted CSS write reused the previous variable and affected five stylesheets; caught during formatting, restored from complete read receipts and the ordered recorded mutations (including semantic-role migration). Formatting of the restored CSS passed. These are development/source receipts only; final rendered/interaction qualification remains required. No freeze, formal Test/Review/Visual batch or merge, review 0/3.

### Account settings and preference recovery continuation — 13 October

Account settings source assessed for device presence, signed-in sessions, passkeys, reminder channels, work limits, assistant restrictions and webhook delivery. Read failures no longer masquerade as empty/disconnected states. Reads reject obsolete/unmounted responses; Retry remains local. Pending writes protect their inputs and preserve failed drafts. Reload buttons explicitly disclose draft discard. Presence/DM recipient, sharing, estimate-vs-billing and permission consequences remain visible.

Shared preferences expose initial-read readiness and Retry, refuse layout writes until real account preferences load and retain queued write/rollback behavior. Home and account layout editors offer read recovery rather than editing defaults over saved layouts. Quotes retain the complete page picker with failure recovery. Settings section identity uses actual heading text, validates remembered storage and cleans up search scroll scheduling. Settings modal recognizes nested native modal dialogs and cleans up exit-recovery animation frames. Shortcut/connection controls reflow to their actual available pane; normal headings/actions use compact labels without clipping values.

Source follow-up corrected an unintended early return in StarButton's loading function and a stuck pending state after switching its target. Presentation Space does not also consume a focused button's activation. Legal documents remount by document identity; recording-summary task date failures release pending state. Agent context distinguishes unavailable identities from loading and preserves failed instruction drafts. Existing scope and transport authority remain unchanged.

Development receipts: mobile 19600, desktop 85687/39597 and mobile 50382 exited 0. Later settings/source changes await the next development check. No formal delivery tests, browser acceptance or native credential/audio acceptance inferred. Whole U1 remains dirty/in implementation: no frozen candidate, handoff or merge; review 0/3. Stage Tracker notified of the ongoing full-scope batch.

### Mobile Settings and planner controls continuation — 13 October

Mobile Settings now uses a five-category picker rather than one long stack. Search selects the owning category and scrolls relative to the settings root. Folded/category-hidden sections retain drafts. Connected apps has its own Connections entry; initial read failures have local Retry and do not become disconnected, disabled-security or empty-session claims. Planner notices cannot write while their preferences are unknown. Account preference responses cannot update a replacement account. Privacy keeps essential analytics, history/export and irreversible deletion consequences visible.

Mobile Create separates complete action titles from reorder/default/visibility controls with separate 44-point targets. Shared planner headings wrap and no longer overlap the add target; rows are stable rather than entering on every render. Reorder callbacks recheck pending/permission state and release drag ownership on unmount. Recurrence end-date and event reminder inputs respect pending state. Event invitee names/email remain complete and wrap; saving's email consequence remains explicit. Draft notes provide a full-text disclosure, bind saved state to the draft set and reject duplicate writes. Shared useRun now serializes calls with a synchronous guard.

Sessions reads are task-bound/latest-response guarded with Retry; unavailable authority disables planning. Manual session entry is a focused sheet with guarded dismissal/inputs. Failed refresh retains session data; remove controls respect current task/assignment authority. This source assessment still needs formal interaction and rendered qualification.

Development receipts: mobile 70262/52619/35205 exited 0. Receipt 52619 includes Create/DraftNotes/useRun/initial sessions changes; 35205 includes planner/recurrence/session-sheet changes. Latest EventFields changes await the next development check. Earlier desktop 7196/92642/28025/95406 and mobile 33722/39347/64441 exited 0; mobile 76183 failed on a missing ErrorBanner import, corrected before 39347. Whole scope continues dirty/in implementation; no frozen candidate, Test/Review handoff, final Visual batch or merge. Review 0/3.

### Mobile connections continuation — 13 October

Connections catalogs now distinguish loading/failure from empty data, retain refresh data and offer Retry. Secret creation, updates and test results reject obsolete/unmounted commits; fields respect pending state. Optional API restrictions move behind named help while authority and secret handling stay visible. Full key names and webhook URLs wrap. Parent Connections closes only after its own write finishes; child calendar operation ownership still needs caller reconciliation during final interaction qualification.

Slack/Teams rows distinguish unknown/unavailable status from Not connected and report failed authorization-window launches. Slack technical connection IDs/expiry move behind a named disclosure; account/scope review and DM consent remain visible. Calendar feeds distinguish unavailable settings, guard writes and preserve full/private-vs-busy sharing consequences. Subscription creation/settings use focused sheets, rare controls use a row menu, complete names/summary values remain available and swatches have separate 44-point targets. Shared Sheet supports pending close/back/swipe guards while preserving default callers.

Development receipts: mobile 49446/63553/91585 exited 0. Latest focused subscription-settings sheet changes await types. No browser/native acceptance inferred. Whole U1 remains dirty/in implementation with no frozen candidate or handoff, review 0/3.

### Agent family and caller reconciliation — 13 October

Mobile agent catalogs load overview/teams together with latest-response cleanup and Retry. Permission/tool/key editors use focused sheets; remaining rare controls use a menu. Trust, spaces, outside-content controls, protected actions, expiry and one-time secrets remain explicit. Activity has a local failure/Retry state and preserves every returned job/link rather than applying silent five-link/thirty-job caps. Full target names wrap, activity indentation no longer consumes a narrow pane and actions reflow.

Inbox settings/rules load independently from the mutation wrapper, recover failed reads, roll back failed mute changes and protect pending inputs/dismissal. Identity/instructions, reminders and night-shift initial reads are independent, preserving parallel query loading. Context/profile responses reject obsolete/account-switch results; instruction edits use focused sheets and retain failed drafts. Optional style/tool descriptions are disclosed; workspace provider cost, scope, output/call allowance and night-shift approval consequences remain visible.

The attempted shared useRun serialization was narrowed to the Sessions and Connections mutation owners after source reconciliation found other callers start multiple independent reads. Shared useRun retains its prior contract; this avoids skipping those unrelated initial loads. Connections uses a stable guarded action wrapper and protects parent dismissal during calendar and workspace-permission writes. Project history Retry now retries the failed paging/snapshot/catalog request. Project import and visit failures do not commit/report after their owner unmounts.

Development receipts: mobile 11158/5280/7178/18423/91941/67600 exited 0. Latest project cleanup awaits desktop types. This remains source/development evidence; no final rendered acceptance, formal delivery handoff or merge. Full U1 implementation continues, review 0/3. Stage Tracker notified.

Page-maintenance caller follow-up removes the redundant mobile Close button, uses the shared pending dismissal guard and resets new schedules to the disclosed daily/default-budget values on web/mobile. Existing schedules retain their own saved frequency, time zone and token budget. Final rendered interaction remains pending.

Desktop development receipt 24796 exited 0 after the project import/visit cleanup. Subsequent page-maintenance reset/dismissal edits remain pending the next scoped check. Whitespace check on this connection/agent/project batch exited 0. Shared useRun has no working-tree diff after narrowing serialization to its affected owners. Implementation continues with the remaining Pending/Partial ledger entries; no freeze, merge or pause.

## Calendar and planning family continuation — 13 October

Builder continued in one coherent source batch, without a candidate handoff or
visual request per edit. Mobile Planning now uses named summary rows with focused
frame/place sheets. Preferences, frames and places load independently from learning
history, expose Retry on failure and guard pending writes/dismissal. Confirmed
frame/place mutation results update the local catalog directly; a second read can
no longer make a successful creation look failed and invite a duplicate retry.
Frame and place controls remain read-only during their save, rare deletion lives
in More menus, and destructive/default-travel consequences stay visible.

Calendar sets use a focused editor, preserve legacy undefined subscription choices
and expose subscription loading/failure/Retry. Search clears obsolete query results,
keeps full titles and details, and discloses its one-year scope. Task scheduling uses
a focused sheet, full titles, current edit-authority checks, guarded writes and a
reachable full list. Moving/duplicating times has pending input and dismissal guards;
CalendarScreen's broader callback ownership remains a separate open source audit.

Teammate member and availability requests no longer swallow failures as empty data.
Retry is explicit, pending/unavailable busy times are not displayed as free, and
CalendarScreen shows an availability notice. Agenda rows reflow by measured pane
width with full titles/details and separate Join/status actions. Week/month dates
retain reachable touch targets through horizontal scrolling where necessary; text
scaling remains enabled. Month overflow opens the full day view. Decorative agenda
entrances and week selection glides were removed.

Development evidence: mobile types passed on sessions 78292, 58876, 56799 and
99754 after their respective source batches. Earlier 74704 failed on two obsolete
calendar-set variable names; both were corrected before 78292 passed. Desktop
57934 and mobile 54424 also passed for the previous batch. The direct
mutation-result adjustment passed mobile types on session 73628. Formatting passed for the
changed source files. These are development receipts, not formal Test/Review or
rendered acceptance. Review remains 0/3; no merge/push/whole-product completion.

## Settings analytics, tags and two-step verification

Web time analytics distinguishes loading, failed reads with Retry and genuine
empty ranges. New ranges clear old results, full list/tag names remain visible,
and bars use a wrapping two-column value layout with the visual track below.
Tag creation/editing now lives in focused SettingsEditor dialogs with visible
name/space/colour fields, pending guards, current write-authority checks and
retained failed drafts. The existing complete tag catalog and team grouping remain.
Two-step setup and one-time recovery codes use the same owned dialog; pending
input/cancel/dismiss controls and late-result guards protect account operations.
Recovery-code consequences remain visible and leaving requires “I’ve saved them”.
SettingsEditor uses the existing keyboard ownership hook, a native modal portal,
focus restoration and bounded viewport dimensions; rendering/keyboard interaction
remain to be qualified in the final batch. No security scan was run.

Desktop development types passed on 48165 and 39277 for their source states.
Final label/wrapping adjustments passed desktop types on 92147. No formal
Test/Review or Visual handoff yet; implementation continues over the full scope.

## Habits and owner-reported tab defect

Habit edits and weekly session review now use focused owned Settings dialogs.
Failed habit reads expose Retry instead of an empty list; full habit titles,
proposed times/time zone and unscheduled reasons remain reachable. Pending and
mounted-result guards protect editing/planning. Confirmed create/update/delete
results update the local catalog and invalidate old proposals. Window/day
validation stays next to the form and preserves failed drafts. Formatter caught
a scripted JSX assembly error; Builder reconstructed the affected segment, then
types found an optional HabitInput.days assumption. Validation now uses the
required draft days. Both failed receipts (53990, 81938/72724) are retained;
repaired desktop types passed on receipt 73921. A later tab focus lookup now compares restored keys as data values rather than interpolating them into selectors; latest development qualification follows. Zero-session habit plans retain their outcome message.

Owner supplied a 13 October tab screenshot and reports only one tab can open.
Source supports multiple tabs but provided no visible creation control. Builder
added New tab and an “Open another tab here” menu action, retaining the 8-tab
limit, pinning, switching, ordering and history contracts. The new control refuses
to silently evict existing tabs at the limit. Slow document reads now check the
active tab destination before opening a result. This addresses source findings;
the owner's browser defect is not yet reproduced or visually accepted. Include
creation/switching/menu/restore in the final bounded Visual request, not a new
sweep per edit. MainApp and tab integration still need the remaining whole-source
assessment. No freeze, Test/Review, merge or push has occurred.

## Import/export and tab ownership continuation — 13 October

Import tasks/pages now opens focused Settings dialogs. The main section retains
four clear import/export actions. Format instructions are named disclosures;
preview-before-confirmation and skipped/error counts remain visible. File reads,
preview/import results and exports guard unmount; pending fields/pickers and
dismissal prevent changing the source during a request. File selection clears
old input before reading so a failed new file cannot import the previous one.
The shared picker supports controlled names and a clear callback; its Forget
control respects pending state. Existing task partial-import and page error
contracts remain unchanged. Browser file/download behavior is unqualified.

Switching tab destinations clears stale initial document/project/view intents.
Restored tab keys are matched as data values instead of CSS selector fragments.
Desktop development types passed on 45471 before the final picker/intent edits;
subsequent development qualification is recorded separately. No frozen candidate,
formal Test/Review, Visual request, merge/push or pause. Review remains 0/3.

## Web planning and frame-owner continuation — 13 October

Planning preferences now use seven compact summary rows with focused editors:
working hours, planner, notices, learning, daily digest, buffers/travel and extra
zones. Reads offer recovery, learning distinguishes unknown history from zero
samples, and the full list/tag history is retained. Pending writes/digest sends
protect inputs and dismissal. Selected time-zone identifiers remain complete;
chart history also has a text route. Closing an editor cancels its unsaved draft.

Frames/places have independent catalog loading/failure/Retry, focused editors,
mounted-write guards and confirmed-result catalog updates. Delete consequences
remain visible at confirmation. The shared FrameForm propagates pending ownership,
protects fields/cancellation and rejects late save/unskip commits. Its calendar
caller now uses a native modal with pending close ownership and distinguishes a
failed read from a missing frame. Full recurrence, task filters, busy/booking
scope, location matching, travel mode and peak timing remain available.

Desktop development receipts 76862, 90925, 96887, 15419 and 59577 exited 0 for
their respective source states; later content/auth/CSS adjustments await the next
check. This is source/development evidence only. No formal Test/Review or browser
qualification has started for the full candidate. Review counter is 0/3.

## Connected-agent owner continuation — 13 October

Connected-agent reads now distinguish failure from an empty catalog and expose
Retry; team-space loading must resolve before setup opens. Per-grant activity
request generations prevent a closed activity section from reopening after a
late response. Complete unique job links remain reachable. Trust and toolset
writes use returned grants; revocation/restoration update confirmed local state.
Undo success is retained separately from failed activity refreshes.

Connection creation, trust and tools use focused Settings dialogs. Management
moves into one row menu. Pending inputs/dismissal are guarded; a new key stays
visible until explicit saved-key acknowledgment. Failed copy offers manual copy;
secret values remain complete and are not added to logs/reports. Agent tags,
links, job actions and per-space trust reflow without clipping full values.
Inbox and Workspace AI child-owner reconciliation and remaining AgentContext,
Rules/large shell families still require their remaining source assessment.
Development types passed on 27017 before the dialog/menu edits; receipts
62521 and 65670 exited 0 after dialog/menu edits; whitespace also passed. No full-candidate freeze or formal QA/review; 0/3.

Connected-agent child-owner reconciliation now puts Inbox and Workspace AI
permission edits in owned dialogs. Inbox pending and one-time wake secrets guard
parent dismissal; failed clipboard writes offer manual copy. A successful wake
test retains its result even if the following status read fails. Workspace AI
retains provider identity, model, cost and call/output allowances; uncertain save
results require refresh and do not show verified Enabled. Standing rules use
focused Add/Edit dialogs and confirmed returned rules, preserving full authored
text and scope. Desktop types passed 66791 before the standing-rule conversion;
standing-rule conversion passed desktop types and whitespace on 10819. Inbox refresh fields now stay disabled until the read resolves, preventing a response from overwriting newer writes; desktop development types and whitespace passed on 95638. Final rendered/interaction evidence remains open.

Runtime provenance checked: node 92672 listens on 127.0.0.1:5174 with cwd
/Users/anhdang/.codex/worktrees/c6-next/Orbyn/desktop. This establishes the preview
checkout only; no browser interaction or pixel review was performed in this batch.

## Shell/tab integration continuation — 13 October

Shell app-command and workspace-tab shortcuts now yield to native dialogs,
modal owners, popovers and floating selectors, and honor prevented key events.
Public account-flow routes do not install app shortcuts. Restored-tab checks
cancel on session/visibility change and compare the current destination before
closing an inaccessible result; a tab navigated meanwhile is retained. Active
panels have accessible names. Repeated motivational footer copy is removed;
What's new remains reachable. Whole shell assessment is continuing: pending
async page/item intent, account teardown and side-pane ownership remain open.
No browser reproduction/acceptance or full-candidate freeze is claimed.

Shell navigation continuation: page reads from deep links, saved startup pages,
Home, saved views, project notes, calendar references and assistant links now
share a latest-intent/session guard. Task reads cannot reopen a dismissed panel
or replace a newer task; task/focus/peek/navigation entry paths close competing
secondary panels. New-page creation prevents duplicate invocation and does not
steal a newer destination after its write completes. Pinned-view and review-count
reads reject stale session/results. Session changes clear private editor and
screen intents. Tab actions honor Settings dismissal guards, and late background
titles stay bound to their originating session. Desktop Markdown file opening
now previews, asks before importing, catches import errors, and rejects callbacks
from a closed session. This is source/development evidence, not installed desktop
qualification. Desktop types passed on 2864, 30034 and 67505; whitespace passed
on 30034 and 67505. The prior 56085 terminal receipt was unavailable after process
reset and is not claimed as a pass. Shell assessment and final tab interaction
qualification remain open; no complete candidate/Test/Review/Visual/merge/pause.

## Task, sessions and study continuation — 13 October

Task detail source is assessed across its full component. Identity/Close remain
in a compact bounded header; facts and edits scroll in the body. Project/page
management is a named disclosure, with distinct loading/failure/retry states.
Project assignment applies the confirmed returned task and reads context
separately; a read failure does not reclassify the successful write. Checklist
management uses a row menu; failed rename/progress writes retain their values.
Checklist/timeline entrance motion and routine explanatory filler are removed.
Task writes serialize, close guards protect pending writes, initial detail
failure has Retry, stale reads cannot replace a mutation result, and detached
drawer callbacks do not reopen linked pages. The drawer portals outside contained
screen roots, inerts shell/navigation, and restores focus after cleanup. It keeps
its custom layer to preserve the existing sibling item editor; installed/native
qualification is not claimed.

Sessions loading failure is distinct from no sessions and has Retry. Add session
keeps the time draft and owned dialog on failure, locks dismissal while pending,
and closes after confirmed creation. Planner-refresh failure remains separate
from write failure. Board cards remove stagger/entrance motion and hover shadows;
long column names and action rows wrap, touch controls remain reachable, and drag
moves recheck pending/authority/target. Review/quiz distinguishes failed loading
from a finished session, preserves typed answers on grading failure, serializes
rating/grading/explanation, and rejects stale/unmounted responses. Shortcuts yield
to controls and overlays; full authored questions/answers/source/provenance remain.

Shared confirmation now uses a native top-layer dialog so confirmation actions
remain visible over native Settings/Block editors; its opener is captured before
showModal and the existing queue/settlement/consent contract remains. Targeted
final visual/interaction coverage must include task → session editor → confirmation,
Settings → destructive confirmation, long task title and checklist rename recovery.
Desktop development types/whitespace passed 20394, 9675, 75748, 3379, 75414,
58486, 52607 and 44050 at their respective source revisions. No tests or browser
review were executed for this batch. Full redesign freeze/Test/Review/Visual and
integration remain pending; review counter remains 0/3.

Task-context reconciliation attempt 5122 failed desktop types: the returned Item
has attendee summaries, while ItemDetail requires attendee status records. The
merge now retains the detail's attendee records; the task is updated from the
confirmed write without substituting incompatible summary records. 88762 reran
the same pre-repair source and its result is retained separately; no pass is
claimed for either attempt.

Repair attempt 23988 found the same summary/detail mismatch for links. The merge
now retains both attendee and link detail records, including their IDs/status/
positions. Both failures remain failed development receipts, pending the repaired
source's type result.

Repaired task-context source passed desktop types on 30492. Mobile SessionsPanel
was reread in full: Add-session errors now render inside the sheet that owns the
write, pending dismissal checks the synchronous mutation owner, and changing a
deadline cannot use an unknown/failed refresh. Optional layout animation calls
are removed. Browser/native interactions remain pending.

Mobile SessionsPanel passed development types on 41701. Mobile study's Review/quiz
body now matches the web recovery/ownership behavior: explicit failed-load Retry,
retained grading input, serialized grade/rate/explain, stale/unmounted-result
guards, full source titles, shorter finished copy and meaningful swipe translation
without ornamental rotation. Closing Study unmounts the active body; overview and
page-open results are guarded against closing/newer mode intent. Mobile types
passed 41964 and 40401. Remaining Study Home/Picker/Suggest/Plan source assessment
is still open. Calendar tabs additionally keep separate date/view-mode snapshots
for this session and recently closed tabs; session changes clear these snapshots.
Desktop types passed 80308. No rendered/tab acceptance is claimed.

### 13 October — tabs and mobile Study continuation

TabStrip has an explicit New tab control and an Open another tab here menu
entry. App rejects all UI new-tab requests at the existing eight-tab limit,
including shortcut requests, rather than silently evicting an older tab. The
active panel is labelled by its active tab. Calendar date/mode state is retained
per tab for this session and recently closed tabs. Desktop types passed 28852;
rendered multiple-tab acceptance remains pending.

Mobile Study Picker now distinguishes failed requests from empty pages, offers
Retry and Show more beyond the first 60 results, and keeps optional card syntax
help in a named disclosure. Suggest/Plan reject stale read results, expose Retry,
retain edited selections on failed writes, synchronously prevent duplicate saves,
and hold dismissal while the confirmed write is pending. Suggested cards and
revision sessions still require explicit selection/approval before creation.
Home exam pages now use a focused sheet with a retained draft and one Save action;
full page/import names wrap. The daily-habit write retains its confirmation and
pending owner. Parent overview failure offers Retry; new-page creation is guarded
against duplicate writes and dismissed-owner navigation. Ornament-only layout
animation was removed. Mobile types passed 59170, 77776, 45416 and 58955 at their
respective source revisions; failed attempt 9805 omitted SmallAction disabled
props and is retained as failed, subsequently repaired. Whitespace passed after
the final mobile batch. No test execution or browser acceptance is claimed.

Whole-product implementation continues into Views source. No full candidate is
frozen, formal Test/Review/final Visual is pending, review counter remains 0/3,
and no merge/push or pause has occurred.

### 13 October — saved Views source batch

Read the complete web ViewsView, FieldInput, FieldsPanel, ViewFilters,
ViewLayouts, ViewTable, LiveList and Views stylesheet sources. Views now expose
failed library/results recovery and keep create/rename errors and drafts inside
focused dialogs. Definition writes serialize per view; failed saves remain
explicit with Retry. Working definition drafts survive switching library views
within the mounted Views workspace. Narrow panes use one Layout picker, compact
management menus and a dated agenda instead of squeezing a seven-column Calendar.
Long sidebar/list/field names wrap. Destructive sharing/field consequences remain
visible. Field editors validate rather than silently discard choices beyond 30.

Live lists guard each read against newer specs, show Retry, retain a separate
saved-view picker failure, and synchronously own pending task updates. Field
values wait for their returned commit result and retain failed drafts with Retry;
FieldsPanel commits return that result, recheck the active target before applying
callbacks, and expose failed field loads. Add/manage field writes use focused
dialogs. Board/calendar drop handlers additionally check the current writable row.
Filter text debounce merges against current filters, avoiding overwriting a newer
status/tag change with a captured old filter object.

Development types passed 34766, 33448, 76985, 9085, 36746, 67803, 50129, 78637,
22286 and 15546 at the corresponding source revisions. Attempt 42159 had a Python
parse error before any mutation; its later type pass applies to unchanged source
and does not qualify the attempted batch. No tests/browser checks ran. Source
integration still needs ViewTable cell completion/draft recovery, task-action
completion contracts, view management write ownership, debounce/tab-exit draft
handling and mobile Views parity before the full candidate is frozen. Full
Test/Review/Visual/merge/push remain pending, counter0/3.

Mobile Views parity continuation: LiveList clears stale results for a new spec,
offers Retry, owns duplicate/pending writes, preserves the offline outbox and
labels queued changes Waiting to sync instead of celebrating them as completed.
Queued row controls stay disabled until the outbox settles, then results refresh.
Full titles wrap. FieldsSection now guards reads and target ownership, returns
commit success/failure to retained field drafts, offers Retry, and uses focused
Add/Edit sheets with pending dismissal locks. Field choice validation keeps the
full input rather than silently clipping beyond 30; global removal consequences
and permissions remain visible. Mobile types passed 35127, 79185 and 45981 at their
source revisions; attempt35379 failed its editing script before writing any file,
so its type pass only applies to the unchanged pre-attempt source. Desktop filter
integration types passed41226. Latest whitespace check passed. No browser, native,
or formal test acceptance is claimed. Mobile ViewsSheet/ViewBody and web table/
management/draft-exit integration remain open alongside the broader inventory.

### 13 October — account navigation and connection collection refinement

- Owner expanded ADR 003 using supplied Codex account/activity/menu references.
  Activity uses planner events and defined timezone/period semantics; implementing
  real history and mobile parity remains required. No invented tokens/streaks.
- Web Sidebar removes the footer collapse action; Topbar owns collapse/expand.
  A single profile trigger opens existing viewport-bounded Popover account actions.
  Settings and Sign out remain reachable in expanded and icon-rail navigation.
- Connected agents adds name/host/space search and five-result pages; controls
  lock during pending mutations and inline editing to preserve editor ownership.
  No permission, consent or provider/MCP contract changed.
- Development desktop types: session 43948 exited 0 after Sidebar changes.
  Session 13641 exited 0 for connection pagination; session 48826 exited 0
  after editor-lock and obsolete Sidebar prop cleanup. `git diff --check` exited 0. Pixel/focus/mobile acceptance is pending.
- Remaining: Activity data/UI, focused connection detail flows, ChatGPT collections,
  mobile parity, complete remaining surface inventory. No frozen full candidate,
  formal Tester/Reviewer/Visual handoff, merge/push or pause; review remains 0/3.

### 13 October — focused connection activity and mobile collection parity

- Connected-agent activity now opens in SettingsEditor on web and BottomSheet
  on mobile. Existing activity reads, Retry, grouping, source links, review and
  confirmed undo remain. Web source navigation closes the editor; mobile waits
  for sheet dismissal before opening a source/proposal destination.
- Mobile connection collections now search names/hosts/spaces and paginate five
  rows, with edit/pending ownership locks matching web. No item is truncated or
  omitted from the collection; complete results remain reachable via pages.
- Mobile Connect an agent is a single button opening a focused sheet. Key creation
  is a step within that sheet, with local failure/draft recovery, synchronous
  duplicate-write protection and dismissal prevention while saving or holding a
  one-time key. Ornamental layout animations removed from this screen.
- Development types exited 0: desktop 48974/30585; mobile 78317/57138 and final 16108. `git diff --check` exited 0. These are development checks, not rendered
  modal/link/undo acceptance or a formal Tester run.
- Activity data inspection: `focusSummary` uses recorded focus sessions;
  `item_updates` alone does not cover every direct status completion. Personal
  completion totals need authoritative transition history, not inferred counts.
  Personal Activity implementation and remaining full inventory are still open.
- Full redesign remains active in implementation, review 0/3. No frozen candidate,
  Test/Review/Visual handoff, integration or push in this continuation.

### 13 October — personal Activity implementation and data foundation

- Added shared ActivitySummary contract and authenticated GET /me/activity-summary
  in the existing API/focus route group. Bounded 30/90/365 local-calendar-day
  periods, account timezone, current item visibility and account ownership apply.
  The endpoint returns aggregate counts, never titles or document content; it is
  excluded from outside-agent capabilities as private account UI.
- Migration 267 records task non-done → done transitions in the existing mutate
  transaction, including recurring occurrences. No guessed backfill. Recording
  begins with an explicit coverage timestamp; earlier completion-day values are
  null. Active days include a recorded completion or positive focus work minutes.
  Focus minutes are assigned to the session start date. No lifetime/streak claims.
- Completion records follow item/user deletion and item snapshot restoration.
  Personal portable/ZIP planner exports include personal completion history.
  Existing provider usage, billing and permission contracts are unchanged.
- Added ActivityDialog via web account menu and ActivitySheet via mobile Account
  settings. Compact period choices, three totals, daily grid and expandable full
  daily details; latest read ownership, loading, error and Retry are explicit.
  The noninteractive grid has an accessible daily-detail alternative.
- Shared package builds exited 0 in sessions 33257 and 71895. Development types
  desktop 63662, mobile 45660 and backend 87817/61384 exited 0. Whitespace exit 0.
- Local preparation: verified DATABASE_URL targets localhost and an _test DB,
  confirmed orbyn.environment=test, then migration entry point exited 0. Readback
  confirmed 267_personal_activity.sql applied and exactly one coverage row.
  No production migration/deployment or functional/visual pass is claimed.
- Formal acceptance still needs completion/reopen/recurrence/rollback behavior,
  timezone boundaries, permission/account separation, deletion/snapshot recovery,
  export, and Activity/connection rendered interactions on the complete candidate.
  Full screen inventory, Views write/draft integration and remaining layouts are
  still open; no freeze, formal Test/Review/Visual, merge/push or pause, review 0/3.

### 13 October — Views confirmed writes and retained table edits

- Added explicit boolean-result planner actions while retaining the existing void
  action API for other screens. Views task toggle/status/change callbacks now
  await the existing server write and planner refresh instead of returning at
  dispatch. Account ownership guards prevent stale success/celebration/refresh.
- applyEdit now checks row write authority, reports missing task/page revisions,
  rejects unsupported or empty required edits, and awaits task/page/project/field
  saves. Estimates beyond the supported range are rejected instead of silently
  shortened. Backend authority and optimistic task/page versions still apply.
- ViewTable retains failed text/select/date/custom-field drafts and offers Retry
  or Cancel; one table mutation runs at a time. Focus returns after confirmed
  save/cancel. Failed edits are not dismissed by an unconditional refresh.
- Background row refresh retains existing result/editor content when the saved
  view and definition are unchanged. Definition/destination changes still clear
  incompatible results. Result errors retain available content with a Retry.
  Per-row mutation locks and selected-view guards keep late edits from refreshing
  a newly selected destination.
- Desktop development types exited 0: 64801, 45815 and final 21517; whitespace
  check exited 0. No functional, browser, complete-candidate or formal acceptance
  is claimed. Intermediate source corrections were made before candidate freeze.
- Remaining Views work: definition autosave/tab-exit preservation, management
  actions, task-board/calendar pending feedback and complete mobile Views parity.
  Remaining full surface inventory and Activity runtime/visual acceptance still
  apply. Full redesign active, review 0/3; no formal handoff, merge/push or pause.

### 13 October — chat navigation and Codex layout direction

Builder source changes (uncommitted, full candidate not frozen):

- Web chat list includes Background/Overnight, configured names and searchable lane labels.
  Selection shows the existing lane workspace inside chat, retaining ordinary chat navigation
  and opening source conversations through the existing assistant transport.
- Expo drawer includes both agent entries; Background opens the existing lane-filtered
  activity sheet, Overnight keeps the existing scheduled-work sheet. Drawer dismissal
  precedes presenting another sheet. Runtime/approval endpoints remain unchanged.
- Shared web chat keeps its composer at the bottom for empty and populated states,
  reduces reply padding and shows compact wrapping suggestion controls above the composer.
  Header identifies the active chat. Mobile suggestions use wrapping compact controls.
- Desktop/mobile type checks before the latest layout pass exited 0 (22407/9860).
  Final types and bounded rendered acceptance remain separate; no pixel/native pass claimed.
- Views account-scoped autosave queue remains unfinished; do not lose this item when
  continuing the complete surface inventory. No Test/Review handoff or merge yet.

Chat follow-through: configured names retain the visible Background/Overnight lane;
web entries report only server-provided states, and unknown status stays unavailable.
Returning from lane work remeasures retained composer drafts and restores latest-message
scroll. Session changes clear the selected lane. Final source before these small guards
passed desktop/mobile types (15943/60086); no rendered review has run for this pass.

### 13 October — workspace-owned Views save queue

Builder source in `desktop/src/lib/view-drafts.ts`, `desktop/src/app/App.tsx` and
`desktop/src/features/views/ViewsView.tsx` now keeps definition drafts/debounce and
serialized writes in signed-in workspace memory. Leaving Views no longer destroys
the pending debounce. Failed definitions remain available with explicit Retry;
read-only working copies stay local. Token changes stop future queued writes and
ignore old completions; no private browser storage was added. A request already
sent may complete, but cannot publish into the new account or enqueue more writes.
Definition readbacks merge only the definition, preserving renamed/pinned metadata.
Library reads reconcile saves completed during the read. Deleting a view forgets
its queued drafts; old jobs cannot publish against the removed queue entry.
Late management/export results are ignored after leaving the component.

Development checks: desktop types 50876, 7876 and final 58841 exited 0;
chat guards/mobile drawer final desktop/mobile types 14871/76096 exited 0;
`git diff --check` exited 0. No formal runtime or visual claim.
Tester cases when the complete candidate freezes: navigate before debounce, rapid
serialized edits, failed save/retry across remount, external library read race,
account change while pending/in-flight, delete while saving, metadata/save races,
read-only working copy reset and development effect cleanup/restart.

Full source inventory remains in progress, mobile Views and other uncovered
families remain open, Review 0/3. No small-batch formal handoff/merge.

### 13 October — mobile Views confirmed edits and workspace drafts

The save queue was moved from its initial desktop-only helper to the canonical
`packages/api-client/src/view-draft-store.ts` and exported for both clients.
Web imports the shared helper; mobile owns a token-bound instance above OpenView,
so closing/switching a view retains its debounce, editable drafts and read-only
working copies. Save failures expose Retry, and server definition completions
merge without overwriting view metadata. Library reads have latest-request,
visibility and account guards; account changes clear private library state.

`mobile/src/screens/views/edits.ts` now reports `saved` versus `queued`, checks row
write authority, rejects unsupported/missing values and oversized estimates.
Root's Views callbacks await real outbox receipts; queued completion no longer
celebrates as a confirmed server save. CellEditor awaits confirmation, retains
failed text/value drafts, blocks dismissal/double submit while writing and uses
explicit Retry. An empty estimate can be saved as cleared. Queued/in-flight rows
are disabled and the existing outbox remains the owner of offline/conflict recovery.
Queue changes refresh rows after send. Read errors expose Retry; incompatible
results clear on definition change, while same-definition refresh keeps content.
Rename now uses a focused sheet with pending/error/draft retention. New-view
failures are visible in the form and synchronous duplicate creation is blocked.

Development evidence: initial mobile types 72023 failed on the outbox operation
name and a discarded edit return; both corrected before the passing mobile/desktop
checks 18132/61634. Shared package build 73860 exited 0. Mobile iterations
59336, 46174 and 12764 exited 0; final guard pass 60526 pending at this entry.
Whitespace check exited 0. No formal runtime/rendered/native qualification claimed.
Required final cases include outbox queued/sent/conflict states, read retries,
cell/rename recovery, estimate clearing, account changes and queue remount behavior.
Remaining Views work includes full create-form draft/close handling and collection
management locking/confirmation across both clients; other uncovered screen families
still remain. Full candidate is not frozen, Review 0/3, no merge/push.

Final mobile guard typecheck 60526 completed with exit 0. Full-candidate runtime and rendered acceptance remain pending.

### 13 October — Views creation/management and mobile document header continuation

Shared `ViewDraftStore` now retains new-view fields (source/name/preset/sharing)
in private account memory. Both new-view forms initialize and update that draft;
successful creation clears it and token teardown clears it. Mobile creation is
now a focused BottomSheet above the library, with pending dismissal prevention.
Web and mobile pin/star actions wait for server confirmation; management locks
prevent overlapping writes/export/delete with explicit pending feedback. Existing
sharing scope and destructive confirmation remain visible. Mobile account changes
reset UI locks and old operation completions cannot release the new account's lock.

Initial mobile DocEditor header/body audit covered mode/title/cover/tags/feedback
and the owning style roles. Suggest mode now renders the title as read-only instead
of letting title typing silently enter an unsupported save path. Feedback uses a
wrapped notice and named 44-point dismiss button rather than a small clickable text.
The rest of the large editor remains explicitly pending source assessment.

Development evidence: shared build 56941 exit 0; desktop types 99220 exit 0;
mobile management types 49375 and account-guard types 46563 exit 0. Initial document
notice typecheck 91931 failed on a missing Icon import; repaired before the final
check. Final mobile type result to follow. Whitespace check exit 0.
No formal runtime/pixel/native acceptance, full candidate or merge yet; Review 0/3.
Final cases add creation draft reopen/navigation/account clearing, management double
submit/failure/account switching, focused-sheet dismissal and suggest-title behavior.
Next source family: remaining mobile/web document editor ranges, then uncovered
Calendar/task/admin/shell surfaces from the inventory. Do not restart Views merely
because final formal evidence has not yet run.

Final mobile typecheck 97436 exited 0 after the missing notice Icon import was repaired. Final whitespace check exited 0.

### 13 October — Chat layout and document control continuation

Removed the later CSS rule that reinstated the old 38%-height empty conversation.
The web empty thread now fills the available area while the composer stays in its
bottom dock. Chat titles use a bounded two-line header with the full title retained
in the history and accessible text. Header actions cannot shrink into the title.
Web and mobile user messages and composers use neutral surfaces; suggestion hover
no longer introduces a decorative shadow. Earlier lane navigation and approval,
provider and authored message contracts remain in place.

Confirmed both document implementations remain active: the shared mobile wrapper
routes format 2 to StructuredDocEditor and format 1 to LegacyDocEditor. Mobile
opening failures now offer local Retry rather than indefinite “Opening page…”.
Legacy read-only/read mode no longer exposes Add block; its handler also checks
write authority. Page facts now have actual 44-point press targets with wrapped
full values. Structured mobile page actions moved from an inline expansion into
an owned BottomSheet. History, navigation and subsequent page sheets run after
that sheet closes; queued menu actions clear on document change/unmount. Source,
Save and per-block comment/edit actions have usable touch targets. A failed
structured load/save offers explicit refresh recovery with the draft retained by
DocEditorStore, while invalid source and conflicts keep their existing correction
paths. Duplicate opening status text was removed.

Development checks: desktop types 89601 exit 0. Initial mobile types 7141 failed
because Retry omitted the required disabled prop; repaired. Mobile 85232 and 33168
exit 0 after the repairs and sheet/recovery changes. Whitespace check exit 0.
These are development/source checks, not rendered, runtime, native or full-scope
acceptance. No frozen candidate, merge or push; Review remains 0/3. Remaining
editor ranges and uncovered Calendar/task/admin/shell families stay open before
the complete-candidate Tester/Reviewer and bounded Visual Check handoff.

Final recovery read-through found DocEditorStore.refresh requires an existing
session. The explicit mobile Retry/Refresh now calls open when no session exists,
and refresh otherwise, preserving existing drafts. It guards an in-flight read;
menu callbacks also clear on editor teardown. Final mobile types 23712 exit 0;
final whitespace check exit 0.

## 13 October — Chat/Work and bounded composer continuation

Owner clarified that a new conversation centers the composer; active chats keep
the bottom dock. Chat and Work are modes in the same workspace. Removed Work's
Projects-tab redirect. Work selects a permitted project next to the composer and
uses project conversation history. Project details now expose New chat and Chats,
including search and pin controls. Backend chat list filtering adds optional
all/chat/work kinds while retaining visibility and project checks. The existing
sweep schedule and pinned exemption are unchanged. Selection and reads guard
account changes and late responses; changing modes preserves the unsent message.

Both inputs start compact, grow to four lines and scroll internally. Work has no
larger initial textarea. Mobile explicitly bounds content-size growth using the
user's font scale and places suggestions beneath the input. Account changes
invalidate a queued mobile project selection before its sheet closes.

Development evidence: shared build 59975 exit 0; backend types 92253 exit 0;
desktop types 52852 and 86441 exit 0; mobile 85025 exit 0. Subsequent mobile
81102 found a missing input-height state declaration, repaired; final receipt
pending below. These are source/development checks, not visual or full acceptance.

Paired independent tabs are now explicitly in ADR 003 and remain unimplemented.
The current shell has a single screen controller and global page commands, so
paired panes must isolate these before exposing a split action. Framing headers
remain intact. Remaining editor/calendar/task/admin/shell inventory work and the
complete-candidate Test → Review → bounded Visual handoff remain open. Review 0/3;
no frozen full candidate, merge or push.

Final bounded-composer development receipts: mobile types 13278 and 89413 exit 0;
whitespace check exit 0. Rendered qualification remains pending the complete batch.

## 13 October — Paired workspace state preparation

Page commands and document-title watchers now register within a React pane scope.
Editor cleanup removes only its own registration, so an older editor cannot clear
a newer editor's commands. App reads/watches its scope. Tab controllers can start
from an explicit place and use session-local persistence, preventing a secondary
controller from overwriting main device tabs. TabStrip and panel ARIA identifiers
can be unique per pane. Main-pane defaults retain the existing device tabs.

Development desktop types 63649 and 16862 exit 0; whitespace check exit 0.
This is preparation, not a usable split screen: independent pane mounting, event
ownership, focused navigation, draft-safe closure and responsive layout remain
open, as do full delivery checks. No split action exposed yet. Review remains 0/3.

## 13 October — Document tab identity and safe departure

Structured pages now publish their title and supported History/Markdown/PDF
commands to their pane registry, matching legacy page ownership. Both editor
formats expose a departure check: legacy saves queued edits; structured saves
valid changes and retains unresolved source/error/conflict states. Workspace tab
selection/closure/back/forward evaluates that check before replacing the screen.
Late results are discarded after a newer navigation or account change. Browser
history applies multi-step navigation sequentially and returns to the accepted
position when a draft prevents a step. No authored text is discarded.

Development desktop types 57751, 49585 and 17298 exit 0; whitespace exit 0.
The final boolean handoff adjustment is pending its development receipt. Tab
interaction/runtime coverage remains part of the complete candidate; paired
pane mounting and focused global event routing remain unimplemented.

Final departure-handoff receipt: desktop types 95251 exit 0 and whitespace exit 0.
Full redesign remains active, unfrozen and unmerged; Review 0/3.

## 13 October — Independent paired workspace implementation

Open alongside is exposed from a tab menu. App now shares one planner/account
controller across independently mounted working controllers. Each owns its chat,
calendar, page/navigation state, scoped page commands, tab selection and scroll.
Secondary tabs remain session-local; main device tab persistence is unchanged.
Shortcut, app-link, native-file/link, Review-open and new-tab events route to the
focused pane. The primary pane owns browser URL history and page metadata.

Wide layouts render both panes. Narrow layouts switch visible panes without
unmounting either, retaining drafts and scroll. Sidebar, announcements, consent
gates, release notices and celebrations have one primary owner. Chat secondary
panels close when their pane loses focus; Upcoming IDs are instance-specific.
Close second pane checks page saves, pending work and view/edit drafts, asks before
discarding an unsent chat message, and restores focus to the first pane. An account
change tears down the secondary pane and both controllers clear private intents.

Development desktop types 52595, 30542 and 89088 exit 0; whitespace exit 0.
The region/focus and secondary deep-link cleanup refinement has a pending receipt.
This is implemented source, not rendered/interaction acceptance. Full candidate
checks must cover both editor formats, independent pane actions, pending/failed
saves, conversation state, account changes, narrow fallback and focus. Broader
remaining editor/calendar/task/admin inventory and the final Test/Review/Visual
sequence stay open; Review 0/3. No full candidate freeze, merge or push.

Paired workspace focus refinement: desktop types 71739 exit 0; whitespace exit 0.

## 13 October — Admin request recovery and pane-close revalidation

Completed AdminRequests source read across summary cards/charts/routes, filters,
keyboard request rows, detail values and pagination. Added summary/log local Retry
and explicit loading states. Period/filter changes clear obsolete results; reads
check mount, request epoch and account. Pagination serializes reads, disables Show
older while pending and retains the failed page cursor for Retry. Live reads keep
their explicit ten-second opt-in. Service labels describe recorded errors rather
than asserting whole-service health. Full request/detail values remain available.

Paired-pane close now serializes attempts and checks current edit/run/view-draft
state again after async page saving and unsent-message confirmation. A changed
message or account cancels the pending close. No draft is discarded by a stale
closure decision.

Development desktop types 75046 and 57192 exit 0. Cursor Retry refinement pending
its final receipt. The inventory now separates assessed pane infrastructure and
Requests source from remaining shell/render/interaction acceptance. Full U1
still needs the remaining source families and one frozen Test → Review → bounded
Visual batch. Review 0/3; unmerged and unpushed.

Final Requests refinement: desktop types 90913 exit 0; whitespace exit 0.

## 13 October — Calendar time selection and preview recovery

CalendarGrid now exposes a keyboard-focusable day column with full date labels,
visible focus, Up/Down quarter-hour selection and Home/End bounds. Selection scrolls
within the calendar rather than the browser window and announces its date/time.
The existing CalendarView C command remains responsible for event creation.
Date-range changes cancel unfinished pointer gestures, selection previews and
anchored due/planned-session editors. Planned-session callbacks recheck tunability
and current preview identity before mutating the preview.

Desktop development typecheck session 96499 exited 0. No formal tests or rendered
calendar interaction check have run for this change. Calendar/source-family review
and full frozen-candidate acceptance remain open; review 0/3, unmerged and unpushed.

The requested ChatGPT reference inspection was delegated to Orbyn Visual Check.
Its current Chrome attempts fail while loading browser request-header policy,
before tab contents can be read; this does not establish a site Block or provide
reference layout evidence. It is separate from the final Orbyn visual batch.

## 13 October — Calendar pane ownership and request feedback

CalendarView now rechecks the focused-pane callback at key time. Its date/view/
planner/new-event shortcuts wait while a dialog, modal, popover or floating
selector owns interaction. The latest callback snapshot includes calendar-set
selection rather than retaining the registration-time choice callback.
Calendar reads reject stale request, account and unmounted results; range changes
clear the previous range's payload. Added short local loading/error feedback and
Retry. Failed same-range refresh retains existing data with a visible failure.
BlockDialog titles use instance-specific IDs for paired editors. Planned-session
drag completion also rechecks current preview identity and tunability.

Desktop development types 42492 and 90603 exited 0; whitespace check exit 0.
Formal keyboard, recovery and rendered acceptance remains for the full candidate.
CalendarView's remaining mutation/menu and responsive source review is still open.
Visual Check has subsequently reached an internal ChatGPT reference tab and is
collecting observed patterns; no full Orbyn acceptance sweep has started.

## 13 October — Focused calendar choices and retained time drafts

Replaced the deadline-drag backdrop with an owned native dialog and instance-specific
heading. The task title and chosen date appear once; Plan a session and Move deadline
remain separate choices. Keyboard focus, Escape and return use the shared modal
ownership hook. Calendar time editors now serialize saving, stay mounted while
pending, retain entered dates/durations on failure and expose local error feedback.
Successful saves retain the existing late-session warning and refresh behavior.
Delayed item opens reject obsolete selection, unmounted and changed-account results.

Desktop development types 1905 and 30422 exited 0; whitespace exit 0. Formal editor
failure/retry, nested choice/focus and paired-pane interaction checks remain pending.
No native build, full candidate freeze, review, merge or push occurred.

Consumed Visual Check's completed reference report at
`docs/reviews/chatgpt-reference-2026-10-13.md`: centered/docked composers, grouped
history, local Settings navigation and flat connection rows. Added these patterns
and Orbyn's stricter four-line composer preference to the design skill. The reference
provides no mobile, large-catalog or functioning split-pane acceptance. Full U1
source inventory and final frozen Test → Review → Visual sequence remain open.

## 13 October — Calendar layout follows split-pane width

Calendar's side planner/task columns now stack using the observed page width,
including a narrow pane inside a wide browser. Added calendar-container rules for
day task stacking, compact toolbar/view controls, reduced time gutter and short
day headings with the complete date retained for accessibility. Custom calendar
set selectors now obey the existing width bound applied previously only to native
selects. Month grid's existing container layout and full day detail remain intact.

CalendarSets now uses instance-specific title IDs and serial save/account/mount
guards. Subscription Retry retains its current epoch cleanup and account check.
Desktop development typecheck 99441 exited 0; whitespace exit 0. Actual split-pane
and narrow rendered sizing still require the complete-candidate visual batch.

Visual Check's reference follow-up requests the same patterns throughout the full
web/mobile scope. Its 315px observed ChatGPT input cap remains reference evidence,
not Orbyn's cap: the owner's compact equal-height/four-line preference applies.
Full source reconciliation and frozen Test → Review → Visual handoff remain open.

## 13 October — Mobile planning source family

Read PlanSheet's options/scope, timeline and horizon, task-length/include choices,
keep-free editor, applied result, nested-sheet and style paths. Saved planning
settings now have an explicit loading state and account-checked request cleanup;
options wait for that read so it cannot overwrite edits made while loading. Failure
shows that current options are in use with Retry rather than silently pretending
the saved preferences loaded. Only plan mutations prevent closing the parent.

Shortened repeated labels/helpers, tightened option spacing and retained explicit
preview/Apply consequences, assigned-team scope and frame constraints. Nested editors
clear old errors on opening; moving-day input locks while pending. Empty/invalid
keep-free date/time inputs now receive local validation before serialization.
Mobile development types 61596 and 60956 exited 0; whitespace exit 0. Mobile rendered
density, keyboard/sheet ownership, retry and apply acceptance remain pending the full
candidate batch. No native verification or formal test pass is claimed.

## 13 October — Mobile booking co-host recovery

PageEditor no longer treats failed team/member reads as a successful missing-member
result. It waits for the complete membership read, preserves existing host choices,
shows local Loading/Retry and disables host selection until resolved. Unknown
membership cannot mark a saved co-host stale. Changing the host list requires
resolved membership; other page edits retain backend authority checks. Save/delete
are serialized, and saved-page callbacks reject unmounted/changed-account results.

Shortened paused-page, reminder and host-assignment copy while preserving round-robin
and required-host consequences. Development mobile typecheck 95769 exited 0; final
selection-lock refinement is awaiting its receipt. Remaining full PageEditor/PageForm
source families and final interaction/render checks stay open; no candidate freeze.

Final co-host selection refinement: mobile types 31091 exit 0; whitespace exit 0.

## 13 October — Mobile booking editor source completion

Completed PageEditor source review across remaining fields, result/link actions,
co-host roles and styles. Rare deletion is now a Booking page options action beside
the saved link, using the existing after-dismiss menu and owned confirmation.
Optional event-title syntax/insertion chips live in Title placeholders; the resolved
title preview remains visible. Labels for meeting lengths, daily/weekly limits and
rescheduling are shorter. Approval holds, owner/team scope, booking link, host rules
and existing-booking deletion consequences remain visible at their decisions.

Nonempty invalid booking limits no longer silently become unlimited. Mobile types
80826 and 72169 exit 0; whitespace exit 0. This assesses PageEditor source, not its
child availability/question editors or rendered behavior. The final batch still
needs complete/cancel/retry, nested menus, long identities and narrow layout evidence.
Full U1 remains active, unmerged and unpushed; review 0/3.

## 13 October — Web booking editor isolation and disclosure

PageForm now namespaces field/heading/help/question IDs, section validation jumps
and assignment radio groups per mounted editor. The native dialog receives that
instance's heading ID. Delayed successful save callbacks reject changed-account
and unmounted results. Team reads expose Loading/Retry, retain choices and block
host selection until membership resolves; unknown membership cannot mark hosts stale.

Removed the redundant Scheduling introduction. Title placeholders and embedding
code/instructions are named disclosures; resolved event preview remains visible.
Shortened owner, pause, approval and rescheduling copy while keeping their actual
consequences. Meeting-link validation copy on both clients now describes the accepted
http/https formats instead of claiming HTTPS-only validation. Added keyboard/coarse
pointer affordances for the new help disclosures.

Desktop development types 96541 and 50019 exit 0; mobile types 56950 exit 0; whitespace
exit 0. One intermediate help-edit script found no matching source and made no
changes; its 86871 typecheck exited 0. Intermediate session 37563's handle was missing
at receipt polling, so no exit is inferred from it; 50019 verifies the current source.
PageForm's final source reconciliation and all full-candidate rendered/interaction
evidence remain open. No review/freeze/merge/push or native build occurred.

## 13 October — Mobile booking child editors and detail recovery

Questions use divided rows and one management menu for move/remove; answer types
wrap, question IDs/options remain intact, and disabled/boundary callbacks are guarded.
Availability uses divided date exceptions and stacks weekly rows for narrow windows
or enlarged text. Custom-hour drafts and replacement-hour consequences remain intact.

Rescheduling exposes local Retry, rejects changed-account results, wraps week
navigation and disables selection/navigation during mutation. Booking details retain
full answers/history and private notes, expose load Retry, serialize host actions,
and ignore late results after unmount/account/booking changes. Copy still states email,
calendar-removal and offline scheduling consequences. Native Alert calls continue
through the existing owned modal adapter; no browser/native alert was introduced.

Mobile development types 75184 exit 0. First rescheduling receipt 67322 exited 2
because React Native Text does not accept accessibilityRole=status; changed it to
accessibilityLiveRegion=polite, then 93630 exited 0. Detail receipt 84286 exited 0;
current mobile types 53547 exit 0 and whitespace check exit 0. Full candidate tests, rendering,
review and integration remain pending; review counter stays 0/3.

Visual Check completed a bounded reference follow-up in
[ChatGPT reference](chatgpt-reference-2026-10-13.md): both composers bound long drafts;
Work opens a searchable project chooser, with loading/unavailable/dismissal states.
Project selection/history filtering were not established by the reference. These are
reference observations, not acceptance evidence for Orbyn. No full Orbyn sweep started.

## 13 October — Booking list hierarchy and mobile management sheets

Both booking list clients keep Upcoming/To approve visible and disclose historical
activity. Mobile page rows retain titles and concise metadata, with Share/Preview
in a management menu. Web page rows disclose the full link/hosts/window details and
use one Edit/Delete menu. Web tab/panel IDs are instance-scoped for paired workspaces.
Read failures remain failures, with Retry, rather than becoming an empty pages account.
List/stat/page reads reject stale request/account results; mobile pagination retains
its serial guard. CSV export checks account ownership before opening the share surface.

The mobile booking stack resets account-owned state on account changes and blocks
back/close while detail mutations run, alongside existing page/invite guards. Page
drafts remain mounted across local navigation. Full details, answers and histories
remain accessible. Review/render tests must exercise the new menu/disclosure paths.

Sync & devices uses full wrapped names and a device menu for Forget. Optional offline
capabilities sit behind named help. Device/settings reads are guarded and expose Retry;
presence writes are serialized, preserve failed values and show local errors. Conflict
choices and discard consequences stay visible. Tags now use compact full-name rows and
management menus. Create/edit use focused sheets, preserve failed/cancelled drafts,
show errors in the active sheet, and guard pending close/duplicate writes. Shared
Swatches adds an optional disabled prop; existing callers retain their behavior.

Development receipts: mobile 4861/18730/87047/30556/75315/31766 exit 0; desktop
81321 exited 2 because Confirm uses body rather than message, corrected before desktop
9570 exit 0. Latest mobile 7352 exit 0. Whitespace exit 0.
These are source/type checks only: full frozen-candidate Test → Review and final
web/Expo render/interactions remain open. No native build, security scan, freeze,
merge or push occurred. Full ADR 003/U1 scope stays active; review 0/3.

## 13 October — Document references, source workspace and owner refinement

Document slash/mention/link-picker keyboard handlers now respond only to their
owning input and leave composing/modifier/default-prevented events alone. Link
reads ignore changed accounts; resolved identities clear on a changed link set.
Nested task ticks no longer bubble Enter into link navigation. Linked-here/related
collections use named disclosures; full identities/context remain in their rows.
Linked-here reads and mention writes reject obsolete account/unmounted results.
Heading-link async selection remains a source follow-up before the full freeze.

Source preview adopts shared modal focus/layer ownership and keeps invalid edits
under the same guarded buffer. Web Source/Split/Preview controls hide either pane
without deleting draft content; scroll syncing runs only for split mode. Revealing
source from a preview line restores focus after it becomes visible. Expo source
preview now keeps both panes mounted, shows them side by side at wide actual widths,
and provides a compact phone toggle. Invalid source prevents native close as well
as explicit close. Contents wraps full headings, and page comments use concise
labels, live loading/error feedback and an accessible resolved-state disclosure.

Owner explicitly adds two document editing options, a hideable source pane and
assistant support in both. The existing source contract is Markdown plus LaTeX
math. The owner subsequently confirmed all three: normal notes, Markdown/rendered note,
and standalone LaTeX/compiled PDF. This remains required delivery scope.
The ADR now records the added scope. Assistant integration for both requested modes
remains open. Web document comment/edit composer textareas no longer expose manual
resize handles; text scrolls within its field. This source change needs final
rendered/keyboard qualification and does not prove complete editor acceptance.

Development types: desktop 6083/74208/72596/53154 exit 0; mobile 55219 exit 0.
Latest desktop 51324/mobile 27430 both exited 0. Whitespace exit 0.
Full U1 stays active, uncommitted/unfrozen; no Test → Review handoff, final Orbyn
visual sweep, merge/push or native build. Review counter remains 0/3.


## 13 October — Three document editing modes, implementation in progress

Owner resolved the source question as all three modes. Web and Expo note-source
workspaces now expose Note, Markdown and LaTeX choices. Standalone TeX is a named
`latex-document` source block under existing note saves, revisions, comments and
assistant proposals; adding it preserves all existing note blocks. Source/split/
preview controls preserve draft state. TeX retains a 20,000-character saved-source
limit; an over-limit draft remains visible for correction or explicit restore.
Assistant source actions target a saved named block and leave acceptance with the
person. The LaTeX assistant prompt requests valid source rather than Markdown.

Added an authenticated, rate-limited, revision-fenced preview endpoint and private
LaTeX service. API checks write authority and revision before/after compilation.
Signed source requests separate the LaTeX purpose from HTML printing. A fresh
Bubblewrap job mounts only TeX installation paths and that job, clears inherited
environment, denies networking/shell escape and bounds memory/CPU/output/runtime.
No unsandboxed fallback. Docker image, Compose, Kubernetes config and env template
are included. Active checkout has no private `.env.production`; it was not created
or copied from the primary checkout. Private-env integration remains a handoff item.

Shared package build 35728/94087 exited 0. Backend 14932/92793 and desktop 65189
exited 0. Earlier desktop 8406/mobile 30669 and mobile 37665 caught source-action
type errors; corrected mobile source exited 0 in session 73853. Compiler image
build and runtime qualification are pending. Full structured-editor parity,
source-assistant flow/recovery and final rendering require reconciliation before
freeze; full U1 inventory and Test → Review → bounded Visual remain open, 0/3.


Three-mode continuation: added ownership-preserving LaTeX leaf operations for
nested notes and wired the private source view into both structured editors.
This retains surrounding nested owners rather than flattening source to edit TeX.
Expo split threshold now respects actual pane width and text scale. Shared builds
62176/55273 exited 0; final desktop 23131, mobile 54127, backend 69414 exited 0;
whitespace and env-template coverage (132 variables) exited 0. Compiler image build
16293 exited 1 on npm network downloads before service qualification. No successful
PDF/container receipt is claimed. Deployment rollout includes the private compiler
and its own namespace-mount seccomp policy. Two bounded passes update ordinary
cross-references. Complete source-assistant/recovery and structured-editor parity
are still acceptance work, alongside the rest of the full U1 inventory. Tracker
was notified; Tester/Reviewer/Visual have not received a partial candidate.


Final document continuation receipts: desktop 91518/mobile 95801 exited 0.
Compiler responses now fence changed client accounts before displaying PDF/errors;
mobile success guard received a final source correction after those receipts.
Remaining work is not only screenshots: reconcile source assistant/proposal flow
for nested notes, modal/navigation draft ownership and compiler runtime/container
behavior, then continue the rest of the full-product inventory before any freeze.

Mobile 97306 exited 0 after the PDF account-success guard correction.

## 13 October — Saved-source assistant and optional document panes

Normal and nested notes now retain source assistant instructions through provider
failures, fence calls to the exact saved quote and revision, and show raw before/after
proposals without stripping LaTeX or Markdown. Decisions are serialized; bulk web
acceptance no longer launches concurrent writes. Unsaved drafts prevent decisions,
and newer drafts arriving during a decision are reconciled rather than overwritten.
Selected text and proposal diffs use named disclosures and bounded scroll.
Structured note/source actions and LaTeX use a shared retained request. Wide source
panes are optional; Expo split uses actual pane width and text scale. Page navigation
guards retain active source/request work. Web block editing and comments do not expose
manual resize handles. Runtime proposal/draft/focus checks remain required.

Development receipts: backend 9675, desktop 16856/95556/59715, mobile
20529/61648/73378/92149 exited 0 at their respective source revisions. Whitespace
exit 0. Subsequent normal-editor guard edits still require fresh types. No formal
Test → Review or visual qualification is claimed.

Compiler image build 10333 exited 0, image manifest
`58a3d37b85dacbf09c08810828daf344214a5a4eef3d86f638ee14ffdc266854`.
Owned disposable container `orbyn-u1-latex-qa` starts and health returns 200.
Development compile failed because Bubblewrap could not mount a nested proc filesystem.
An isolated namespace setup without proc succeeds. Source removes the unnecessary
proc mount and keeps fresh namespace/network/filesystem restrictions. Rebuild 18353
is running; successful PDF and formal isolation/error/cancellation coverage remain
open. Private QA key is held only in a mode-600 temporary env file. No private
production env was created or overwritten. Full U1 remains active, unfrozen and
unmerged; counter 0/3 and all remaining inventory/gates are preserved.

Compiler continuation: rebuilt image 18353 exited 0, manifest
`ceae3cfe933a207659e3d8c830b228bda19c042e7f292927197e563a643b2f42`.
Restricted container recreated; an initial immediate health probe raced startup
(connection refused). Retried development startup then exited 0: health 200,
13,445-byte `%PDF-` article. This does not qualify the authenticated preview route,
source isolation fixtures, cancellation, failure recovery or rendered editor.
Backend types 74821 exited 0. Comment/mention work adds bounded exact quote details,
full catalog Retry/keyboard paths and guarded serial writes. Mobile page links now
reveal and scroll the actual preview pane instead of scrolling its hidden ancestor.

Admin AI continuation: mobile replaces the model chip wall with a searchable
virtualized picker and keeps provider forms in focused sheets with retained errors.
Web serializes configuration confirmation/write/reload and retains form errors.
Budget refreshes preserve typed values. Provider updates preserve model-control
options and carry timestamp revision fences; field limits match core schema.
Saved-key fragments were removed from mobile. Provider helper mechanisms use named
details; full identities and essential assistant-off consequences remain available.
Remaining Admin System, large editor ranges and other inventory families remain
open. No frozen candidate, formal Test → Review, final Visual, merge or push.

Development type receipts: desktop 77071/1226/11517/18133/38356 exited 0; mobile
81762/43664/33103/39218/53069/2816 exited 0 on their respective snapshots. Mobile
99669 exited 2 because the new optional provider detail used a required-value
Disclosure component; corrected to InlineDetails. Fresh final types pending.
Whitespace and env-template coverage exited 0 (132 backend/Compose variables).

Admin System continuation: source reconciliation completed for web settings,
maintenance, announcements, retention and versions, and mobile settings,
maintenance and version. Web now owns each full confirmation/write sequence and
fences late completions by mounted card/account. Mobile serializes operations,
fences initial/version reads and write completions, removes ornamental entrances,
and keeps email/maintenance detail optional. Mobile field reset is disabled while
there are unsaved settings to prevent a full keyed remount from losing drafts.
Metadata remains readable, reset targets and time choices are reachable, long
fields scroll within a bound. Development desktop 80549/17588 and mobile
59538/73222 exited 0 on their respective snapshots; final desktop 67541 pending.
No formal tests or Visual batch started. Full candidate remains unfrozen,
unmerged and unpushed; review counter remains 0/3.

Booking form continuation: assessed co-host loading, question editing, scheduling,
availability/date overrides, routing, approval, messages and embed actions. Fixed
new-question routing: drafts select stable question keys; save translates them
to generated schema IDs. Incomplete/stale routing remains visible for correction,
instead of silently dropping it; page-owner routing is selectable. Details copy
is shorter, source fields scroll within bounds and removal targets remain
reachable. Shared outcome handling ignores responses from a closed card or old
account, including late authorization failures. Formal routing/draft/keyboard
checks and final rendering remain open. Desktop 67541/18417 exited 0 before the
last routing/owner/CSS adjustment; no final candidate handoff.

Calendar continuation: field-date loading no longer silently removes all page and
project dates on error; a local Retry announces the missing source. Range/account
reads clear stale field dates. Calendar action completions and delayed item opens
are fenced to the mounted account; a fetched drag target is rechecked before its
write, and stale write responses cannot notify a newly signed-in account. Session
delete uses a short title with the actual session subject in its body. Remaining
Calendar CSS/full menu and gesture reconciliation stays pending. Desktop 17459 and
54029 exited 0 on their respective source snapshots. This is development evidence,
not the formal frozen-candidate handoff or final visual review.

Calendar set/layout continuation: sets now have compact named rows with one open
editor, shared search and bounded calendar choice lists. Search reveals matching
optional groups. Read-only session menus no longer expose move/copy/delete.
Toolbar titles wrap within the actual pane while navigation buttons stay usable.
Planning preference reads/writes now fence account ownership and outdated read
responses. Desktop 46622/26651 exited 0 on their respective snapshots. Full
Calendar CSS/gesture qualification remains pending; no visual batch was started.

Views recovery continuation: a separate pane leave guard protects non-document
drafts without registering a view as an open document. Table edits now block tab
exit, layout/filter changes, view selection and item navigation until finished or
cancelled, with a local recovery message. Cancel cannot discard a write in flight.
Management/create paths wait for that guard; late read/write results and errors
are account-fenced. Desktop 75891 exited 0 before the latest ownership adjustment;
91664 pending. Full Views/multi-pane/keyboard/mobile recovery qualification is
still open. Candidate stays unfrozen, unmerged, unpushed; review counter 0/3.

Views guard development receipt: 91664 exited 2 because the ownership helper was
also inserted into the separately scoped NewView form without its account
capture. Added that form's own capture and fenced submit/error completion; 88981
exited 0. Group folding now uses the same draft guard, preventing a collapsed
group from unmounting a failed text-cell draft. Latest desktop types 64103 pending.
No formal verification, final visual batch, freeze or delivery status changed.


### Mobile views and document continuation

- Added a shared searchable ChoicePicker sheet with virtualized choices, full
  labels, current-choice validation and disabled state. Mobile view layout,
  team, grouping, sorting and date fields use compact triggers; sort direction
  remains independently selectable. Creating a view retains its draft and fences
  account ownership. Sharing uses a focused editor with visible access scope
  instead of one menu entry for every team.
- Cell edits retain their attempted value after failure, disable inputs during a
  write and ignore receipts for a changed cell/account. Full table/board/calendar
  interaction qualification remains open.
- Legacy mobile document task conversion is serialized; a newer unsaved draft
  blocks conversion. Document opening, source changes, appearance and assistant
  receipt callbacks gained ownership checks. Mention read failure is distinct
  from an empty result and has Retry. Footnotes use a scrollable owned sheet
  rather than a long transient toast. Remaining legacy editor ranges stay open.
- Settings JSON exports and optional import samples/exclusions use named details;
  import totals and errors remain available. Project, recorder, booking and
  planner text areas use bounded internal scrolling and no manual resize handle.
  Booking control surfaces use theme colors instead of fixed white.
- Mobile development typechecks 21257, 24412, 31297 and 4731 exited 0 on their
  respective snapshots; 53550 also exited 0 after the Settings/footnote changes.
  These are development checks. No formal tests, visual batch, freeze, merge or
  push was performed; full redesign remains in progress, review counter 0/3.


### Web connection settings continuation

- Personal API keys, Clipper keys and webhooks now have search and bounded
  collections; full names and URLs wrap. Webhook event/delivery diagnostics,
  test/delete and timing controls stay inside each row's detail. Creation and
  developer reference are named disclosures instead of permanent large forms.
- Webhook lead time uses an explicit Save, preserves invalid drafts and validates
  whole minutes from 0–120. Deletion owns the complete confirmation/write sequence.
  Essential key scope, webhook recipient and email-address replacement effects
  stay visible at the decision point.
- Added a shared Settings read hook with local failed/loading states, Retry,
  account/mount and latest-request ownership. Email-to-task commits invalidate
  older reads; failures no longer leave the section indefinitely loading.
  Clipper creation/removal/copy share a serial pending state and local outcomes.
- Secret copy failure offers a selectable-key fallback. Replacing/turning off an
  email-to-task address confirms that old-address mail stops creating tasks.
- Remaining CSS manual vertical textarea handles were replaced with bounded
  internal scrolling; this includes Settings, task notes, agent instructions,
  Study and page maintenance. This is source work, not pixel acceptance.
- Development desktop 60134 and 98682 exited 0 on their snapshots. 68874/33982
  exited 2 after a ClipKey import was removed while still used in a parameter;
  restored that type. 36816/36193 exited 2 after lead state changed to string but
  its older numeric change handler remained; corrected the handler. 78775 and
  56333 exited 0 on their respective final TypeScript snapshots.
- Full source reconciliation, complete candidate Test → Review and the final
  bounded web/Expo batch remain open. No freeze, merge or push; review 0/3.


### Authentication, consent and first-run continuation

- Web and Expo sign-in/consent no longer use ornamental entrance wrappers.
  Short consent and setup helpers retain age, Terms/Privacy version, analytics
  scope and the trust/sharing consequences at their decision points.
- Web password recovery/reset and confirmation resend serialize actions, preserve
  failed drafts and fence receipts to the initiating session/link. Reset forms
  remount for a different reset link; verification clears stale link results.
- OAuth checks reset when the request/account changes; local consent choices
  remount for that identity. Allow, Cancel and password/passkey reauthentication
  serialize actions and discard stale receipts. Account switching and permission
  fields lock while pending. Teams have bounded search with selection counts;
  full names and owner restrictions remain available. Grant duration supports
  arrow/Home/End selection. Backend authority remains unchanged.
- Web setup owns modal focus; Escape cannot permanently dismiss it. Expo sheet
  dismissal likewise does not silently write a skip. “Not now” is the explicit
  permanent skip. Both clients preserve drafts, lock pending controls and avoid
  repeating the same calendar subscription after Back. Web purpose/starter
  choices support arrow/Home/End selection and wrapped narrow actions.
- Web and Expo consent requests fence follow-up privacy writes and completion
  to the initiating account/version. Terms and analytics remain separate server
  operations; a privacy failure retains its choice and error for retry.
- Development desktop 33242 and mobile 80753 exited 0 on the first snapshot.
  Desktop 90340 and mobile 70072 exited 0 after account recovery and first-run
  changes. Desktop 60975 exited 0 after team filtering and radio keyboard work.
  These are type checks, not formal interaction or rendered acceptance.
- Full source reconciliation and the complete Test → Review → final bounded
  web/Expo batch remain open. No frozen candidate, merge or push; review 0/3.


### Scheduled assistant work continuation

- Web Upcoming uses focused goal/routine dialogs instead of expanding a form
  inside each list row. Expo Upcoming switches to one focused editor in its
  sheet and returns to the list on Cancel. Controls lock while pending; errors
  retain the draft. Optional progress and automatic-permission lists use named
  disclosures; full goal/routine instructions and permission scope stay available.
- Expo project and plan-note choices now use searchable choice sheets instead
  of an unbounded chip collection. Form actions wrap and instruction boxes have
  bounded internal scrolling. Web list identities wrap within the remaining pane.
- Account/mount and latest-read guards prevent old Upcoming results from replacing
  a newer view. Mutations and the complete delete confirmation serialize. Expo
  also fences a hidden/reopened sheet, queues a refresh after a pending action,
  and clears an acknowledged saved form before it can be submitted again.
- Successful writes close the editor before refreshing. A refresh failure says
  Saved and offers Retry; it does not masquerade as a failed creation. Initial
  read failure does not show a false No goals/routines state. Permission-read
  failure no longer silently becomes an empty permission set.
- Check-in failures and histories beyond the initial bounded batch are identified
  separately; each goal can load or retry its history. Existing routine timezones
  are preserved while editing their local date/time. No scheduling contract changed.
- Development desktop 43407, 60619, 81306 and 37353 exited 0 on their respective
  snapshots. Mobile 89569, 40101, 74727 and 21248 exited 0 on their snapshots.
  No formal tests or rendered qualification started for this batch.
- Full source reconciliation remains in progress. The full candidate must still
  pass Test → Review → the bounded web/Expo visual batch. Review remains 0/3;
  no candidate freeze, merge or push.


### Imported-page suggestions continuation

- Web/Expo summary proposals have a labelled, bounded editable draft before Add
  summary. Generated task titles/dates remain visible; full source text is a named
  disclosure instead of permanent prose or a two-line clipped source. Opening a
  source disclosure does not toggle its task selection. Short footers wrap.
- Web suggestions own modal focus and pending dismissal; Expo uses its sheet's
  pending-close lock. Account/document/action changes remount the owning proposal.
  Delayed reads/writes and callbacks cannot apply to another document/account.
  Failed generation offers Retry; the initial read promise is shared across effect
  setup so a repeated setup does not launch another provider request.
- Summary saves now negotiate complete editor ownership and preserve format-2
  containers/standalone TeX instead of writing the flat content projection. The
  shared summary helper retains all reviewed lines rather than clipping to 12.
  Its new versioned helper prepends summary leaves without changing existing nodes.
- Summary retries retain the exact write/version/key after an uncertain result.
  A definitive content rejection or document-version conflict releases that
  snapshot for a fresh reviewed attempt. Backend still owns concurrency/authority.
- Tasks use stable IDs and per-task idempotency keys. Confirmed tasks are marked
  Added and skipped by later attempts; partial failure retains remaining selections
  and reports the count already added. The existing server replay cache is 24 hours,
  not an unlimited retry guarantee; stable task IDs also prevent a second identity.
- Mobile copy now returns an actual success result. A failed copy keeps the
  summary sheet and draft instead of closing as if copying succeeded. Other copy
  callers remain compatible with its returned Boolean.
- Development core build 43981, mobile 34976, desktop 26385/79796 and mobile
  22458/54227 exited 0 on their source snapshots. Subsequent changes add the 4,000
  character summary field bound and modal CSS containment; formal interaction,
  ownership preservation, partial failure/replay and rendered checks remain open.
- Full source reconciliation is still in progress; no complete candidate handoff,
  review round, freeze, merge or push. The final web/Expo visual batch stays deferred
  until the complete source candidate is ready.


### Lists and focus continuation

- Web lists now use focused New/Edit dialogs, one options menu per list, search,
  bounded navigation and a remaining-pane width switch. Narrow task panes include
  All lists instead of squeezing both columns together. Names wrap completely.
  Colour radios have named labels, one tab stop and arrow/Home/End navigation.
- Expo lists separate the library, selected list, editor and deletion confirmation
  into focused sheet views. Space selection is searchable. Writes serialize and
  guard account/mount/visibility ownership; failed writes retain editor drafts.
  Successful writes close the editor before refreshing, with a distinct saved
  result and Retry refresh if reload fails. Closing is locked while writing.
  The permanent New list form and expansion animations were removed.
- Shared mobile colour targets are 44 px with no overlapping hit slop. Web colour
  targets grow to 44 px for coarse pointers. List section headings use theme
  colours and sentence case.
- Focus now uses the shared modal keyboard owner, including custom number inputs
  and higher-dialog handling. Checklist read failure offers Retry. Completion is
  persistent rather than disappearing on a timer; pending completion disables
  competing visible controls. Narrow focus spacing and ring sizing are bounded.
  The underlying timer/session write lifecycle still needs source reconciliation;
  this is not full FocusMode acceptance.
- Overview removes row stagger animation and shortens its attention hint. Its
  linked cards and full styling remain part of source reconciliation.
- Desktop typecheck 53009 and mobile typecheck 77524 exited 0 for the list snapshot.
  Subsequent focus/overview desktop typecheck 42544 also exited 0. These are
  development source checks; no formal tests or rendered checks ran in this batch.
- Complete redesign source reconciliation remains open. No candidate freeze,
  Test/Review handoff, merge or push; review remains 0/3. The final representative
  web/Expo visual batch waits for the full candidate.


### Focus recovery and admin styling continuation

- Open focus timer writes now serialize and retain one exact session ID/payload
  across uncertain retries. Confirmed time is removed from the unsaved bank before
  refresh; a refresh error cannot restore/re-log confirmed time. Longer sessions
  use bounded records instead of silently dropping time over the per-call cap.
  Existing backend `logFocusSession` deduplicates by ID and increments task time
  only for a fresh record; this was source-inspected, not runtime-tested here.
- Visible completion/checklist/close/switch actions serialize. Account/task owners
  remount the screen; delayed receipts cannot update another owner. Failed open
  timer save keeps the focus screen open instead of closing on a failed write.
  The separate interval hook still needs full ownership/recovery reconciliation.
- Fully read agents-admin, database, storage, insights and changes stylesheets.
  Configuration editors have bounded scrolling, database search has visible focus,
  headers/actions/values reflow, and route identifiers remain complete. Chart axis
  label spacing now follows the measured pane width; Chart data remains available
  with every value. Formal rendering is still pending.
- Desktop development typecheck 30233 exited 0 for focus recovery. Admin styling
  and chart snapshot typecheck 91829 exited 0. No formal
  tests, visual batch, source freeze or Test/Review handoff in this continuation.
- Document library full-source reconciliation has started. Its load/mutation
  ownership, failed ancillary reads and delayed page navigation need correction;
  the current source is not qualified. Full redesign remains active, review 0/3,
  no merge or push.


### Shared mobile controls continuation

- Fully read Field, ScreenIntro, Disclosure, Celebration, FadeIn and
  PressableScale. Intro icon/title now share a row; helpers use compact text.
  Numeric units can wrap; date/time controls retain complete values.
- Date/time pickers close when disabled and late picker callbacks recheck the
  latest disabled state. Expo browser inputs remain labelled and editable only
  while permitted; minimum-date checks and invalid-date guards apply before adoption.
- Disclosure retains mounted child drafts while hiding closed descendants from
  accessibility navigation. The expansion control has the section's own name.
- Confirmed task feedback is one compact Task completed status with an accessible
  task-title announcement. Bursts, vibration, moving entrances and clipped-title
  cards were removed. Existing call sites/host selection remain compatible.
- Press scaling defaults to a stable control; explicit scaleTo callers can opt in.
  Animations stop on cleanup. FadeIn is already an immediate, stable wrapper.
- Mobile development typecheck 31476 exited 0. Final
  interaction/rendered qualification stays open; no formal delivery tests or
  candidate handoff. Complete source reconciliation continues, review 0/3.


### Document library continuation

- Fully read DocsView's library/editor integration. The library heading keeps one
  primary New page action; New note, templates, import and folder management live
  in a named options menu. Memory/agent-note introductions and collection notices
  are shorter. Library navigation remains available beside the editor or in its
  narrow-pane view.
- Library reads settle independently, preserve existing successful data and report
  failed collections with Retry library. Latest-read/account/mount fences prevent
  older responses replacing a newer collection. Archived pages and Trash have
  independent error/Retry states instead of false empty results. Tag/project
  choices distinguish Loading, failure and empty/no matches; project filing is
  offered only for a single eligible imported page.
- Management actions share one pending operation, including permanent-deletion
  confirmation. Favorites update only after confirmation. Successful changes stay
  distinct from subsequent refresh failure. Bulk selection retains skipped page
  IDs; confirmed pages leave the selection. Its Undo uses the same owned operation.
- Tree rename has explicit Save/Cancel, awaits the actual Boolean receipt and keeps
  a failed draft. Metadata rename/project filing use complete editor ownership and
  optimistic versions, preserving nested note/LaTeX content. Rename no longer
  forces the open editor to unmount between two timers.
- Page-opening receipts match their current destination. Library navigation IDs
  and row lookups belong to the current pane, supporting split workspaces. Show in
  library timers cancel on replacement/unmount and recheck destination/owner.
- Development attempts 91691 (temporary extracted-type syntax) and 35365 (bulk
  skipped-result object shape) failed and were repaired. Desktop typechecks 34130,
  29799 and 95356 exited 0 on their respective corrected snapshots. Final pane-ID
  snapshot 7058 also exited 0. These are source checks;
  no formal runtime or rendered acceptance is claimed.
- Docs styling, full editor integration and remaining app/mobile surfaces still
  need source reconciliation before the complete Test → Review → bounded final
  visual batch. No candidate freeze, merge or push; review remains 0/3.

## Composer and split-pane styling continuation

- Fully read assistant.css and workspace.css. Source/history titles now wrap,
  scoped context stays in the chat header on narrow screens, and table/follow-up
  surfaces use theme colors. Routine press scaling was removed from chat controls.
  Coarse-pointer source/history/follow-up actions retain 44 px targets.
- Composer height is still one line at rest and capped at four lines, with internal
  scrolling. Its measurement now follows containing-pane width changes as well as
  browser resize. Split-pane switch height includes coarse-pointer targets without
  extending below its allocated row; pane labels wrap safely.
- Desktop development typecheck session 26804 exited 0. No runtime/render pass,
  frozen candidate, formal handoff, merge or push is claimed. Review remains 0/3.
- Fully read useFocusSession.ts while reconciling focus ownership. Its interval
  records still swallow save failures before advancing, create fresh IDs on each
  attempt and lack account/mount fences on some reads/handoffs. This is outstanding
  source work; the earlier open-timer recovery does not qualify interval recovery.

## Interval focus recovery continuation

- Fully read useFocusSession and reconciled its integration with FocusMode.
  Phase records retain one payload/ID for uncertain retries; confirmed records
  do not increment time again. Phase completion, Skip break and device handover
  advance only after the record succeeds. Failure stays visible with Retry save.
- Automatic retries are paused after failure. Retry retains the specific failed
  transition; pending writes disable competing controls. Paused work must finish
  before choosing a new rhythm, preserving accumulated time.
- Reads, writes and callbacks check mount/account ownership. Initial restoration
  cannot replace a session changed while discovery was pending. Device handover
  checks task and local-state identity before acting. Shared-state writes are
  ordered, and leaving waits for that queue before clearing this device's state.
- Finish propagates save/discovery/clear failures so the owning modal stays open.
  Completed work remains distinct from a subsequent sharing/refresh failure.
- Desktop development typecheck 53052 exited 0 before the final restoration and
  sharing changes; final snapshot 97145 exited 0. Formal interval timing, uncertain
  response/retry, device handover and final rendered checks remain required in the
  complete-candidate Tester handoff. Review 0/3; no freeze, merge or push.

## Study styling and Overview hierarchy continuation

- Fully read study.css (985-line source snapshot) and OverviewView. Study uses
  compact answer/body text, sentence-case auxiliary labels, complete wrapping
  page/source titles and narrow-safe tool/action groups. Coarse-pointer actions
  retain 44 px targets. User-authored card answers remain complete.
- Overview now has direct card children instead of two column wrappers. Due today,
  Up next, attention and task/progress cards follow one DOM order at all widths;
  removed CSS ordering that disagreed with keyboard/read order. Overview section
  headings use per-instance IDs, supporting two independently rendered panes.
- Fully read StudyView (1,190-line snapshot). Deck actions now use the shared,
  viewport-bounded portal Popover instead of a clipped absolute menu inside the
  card. Named action buttons use the shared focus/close behavior. Shortened exam
  attachment helper and renamed the practice section to Needs practice.
- Desktop development typecheck 34326 exited 0 for the Overview/styling snapshot;
  39779 exited 0 after Study menu changes. Formal interaction/render remains
  pending. No frozen candidate, Test/Review handoff, merge or push; review 0/3.
- Study source reconciliation remains open: initial/page-picker failures need
  explicit retry, mutations need serialization/account fences, dialog focus and
  pending-dismiss guards need integration, suggested-card saves must preserve full
  document ownership, and revision-plan reads must reject stale responses. These
  are identified source gaps, not accepted behavior. ReviewSession source is a
  separate outstanding integration assessment.

## Study dialogs and review ownership continuation

- Study library reads retain data on failure and offer Retry. Account-keyed
  ownership and serialized actions guard page opening/creation, review-habit
  creation and exam attachments. Attachment receipts invalidate stale library
  reads. Page picker distinguishes failed/loading/empty/search states, supports
  Show more beyond 60 rows, and moves card syntax into named help.
- Page picker, suggested-card and revision dialogs use the shared modal focus
  mechanism and instance-specific headings. Save operations guard dismissal,
  serialize submissions and keep their inline outcome/draft after failure.
  Revision previews reject stale responses and reset exclusions for new plans.
- Suggested questions/answers use bounded, non-resizable textareas with visible
  labels. Sources are available in a disclosure. Card saves negotiate complete
  document ownership and append without flattening nested content. Stable block
  IDs let a same-dialog retry detect a confirmed earlier append. Edits lock once
  an append is attempted; partial matching receipts require reviewing the page.
- Fully read ReviewSession. Its queue/action receipts now check account, mount and
  generation. Back/source actions lock during pending work. Keyboard ratings are
  owned by the focused split pane, and review-card layouts measure their own pane.
- Desktop development checks 37816, 14315 and 74443 exited 0 for successive Study
  snapshots; 55366 exited 0 after review ownership changes. Runtime/render coverage
  remains pending. No freeze, formal Test/Review, merge or push; review 0/3.
- Remaining Study acceptance work includes uncertain-response handling for revision
  application and card ratings (existing backend calls are not receipt-keyed),
  new-page/habit uncertainty, and testing append recovery against real negotiated
  documents. Do not count a typecheck as proof of those behaviors.

## Settings navigation, accounts and Privacy continuation

- Fully read SettingsView, SettingsNavigation, ChatgptConnections, PrivacySettings
  and settings-modal.css. Search has per-instance IDs, progressive More results,
  visible no-match state, and results within the sidebar scroll flow. Narrow
  layouts use one sidebar scroll area instead of a clipped floating result list.
  Changing category returns its content to the start; a selected search section
  still owns its later scroll-to-section request.
- Notifications replaces Stay in the loop across web/mobile and the shared search
  registry. Removed duplicate What's new/status introductions; push-notification
  help and connection diagnostics are named disclosures. Consent/consequences are
  retained. Shared core build 72015 exited 0 after the registry change.
- AI settings are collapsed on initial arrival unless remembered/search-selected.
  ChatGPT accounts use a bounded list, search above four accounts and a shared
  portal action menu. Sign-in state callbacks check account/mount ownership; the
  component remounts for changed ownership. Existing shared store owns commands.
- Privacy reads have owner/revision fences and explicit Retry; analytics receipts
  invalidate stale reads. Legal reads and account deletion serialize actions.
  Deletion uses the focused SettingsEditor, locks pending inputs/dismissal and
  displays irreversible consequences plus account identity. Failed drafts remain.
  Export reports Download started rather than asserting browser completion.
  Consent history is a bounded disclosure; full legal policy text is preserved.
- Desktop typechecks 72850 and 39907 exited 0 for their respective snapshots;
  mobile 33851 exited 0 after the Notifications label alignment. These are
  development checks. Settings interaction, short viewport/keyboard, nested
  dialogs and final rendered acceptance remain pending. No freeze, Test/Review
  handoff, merge or push; review 0/3.
- Calendar settings and the remaining app/mobile surfaces still need complete
  source reconciliation. SettingsScreen also still contains a Notifications
  Alert.alert path found during label alignment; its full mobile flow is pending.

## Calendar connection settings continuation

- Fully read CalendarSettings (638-line input snapshot). Subscriptions now use
  focused Add/Edit SettingsEditor dialogs instead of permanent/inline forms.
  Each compact row has visibility plus one portal management menu. Search appears
  for longer collections; the list scrolls within a bounded area. Connection URLs,
  fetch details and errors remain accessible in named details.
- Reads distinguish loading, failed and empty, preserve existing data and offer
  Retry. Owner/revision guards reject stale responses. Confirmed add/edit/remove
  receipts update the local list; refresh failure is reported separately. Pending
  fields and controls lock, failed drafts remain, and removal confirmation names
  the calendar and consequence. Calendar-kind radios use roving keyboard focus.
- Feed reads/actions check account and revision. Regeneration confirms that old
  subscriptions lose their link; full/busy sharing consequences stay visible.
  New one-time links require copying or explicit acknowledgement before leaving
  Settings. Copy failure offers manual copying rather than claiming success.
  Feed-use instructions are a named disclosure; include-session semantics remain.
- Desktop development typechecks 16160 and 37666 exited 0 for their respective
  source snapshots; final snapshot 89591 exited 0. These do not prove runtime,
  clipboard, secret-close guard, portal or narrow-layout acceptance. No freeze,
  Test/Review handoff, merge or push; review 0/3.
- Remaining source families include Calendar/task/document styling, mobile main
  screens/editor controls, and app/global integration. Unknown-response handling
  for subscription creation/feed regeneration still needs acceptance evidence;
  do not treat local typechecks as proof of safe retry after a lost receipt.

## Mobile document action recovery continuation

- Read AliasesField and PageActions in full. Alias saves serialize immediately,
  keep the typed draft on failure, show an inline error and clear the draft only
  after confirmation. Adding has an explicit touch action; chips wrap full names
  and removal has a 44-point target without overlapping hit slop.
- Merge locks dismissal and selection while saving, rejects callbacks from a
  closed or replaced sheet, separates failed search from empty results and offers
  Retry. The selected target remains fully readable beside a compact Merge button.
  Templates retain full names and show load failures with Retry, guarded after
  closing. No browser/native interaction acceptance is claimed.
- Mobile development typecheck 6ef498 exited 0 before the final generation guard.
  Final typecheck fe117e exited 0. Formal Test/Review,
  final visual qualification, freeze and merge remain pending; review 0/3.
- All three document modes remain in scope: normal notes, Markdown/rendered notes
  and standalone LaTeX/compiled PDF. This batch does not close editor integration,
  account ownership or uncertain merge-response qualification.

## Task styling and shared mobile presentation continuation

- Read task.css in full and inspected its owning footer, checklist and composer
  selectors in TaskDetail. Removed unused entrance keyframes and the stale green
  focus-ring literal. Metadata, section actions, progress choices and footer labels
  wrap; the footer has a bounded scroll area for short screens. Compact task
  actions retain 44-point coarse-pointer targets. Actual narrow/short render
  qualification remains pending.
- Read Topbar, view definitions, mobile theme index/palette and shared styles in
  full. Existing view identities and navigation contracts remain. Shared mobile
  section headings use a 15-point medium role, empty-state icons use a quieter
  40-point treatment, and inputs reuse the platform font-size token. Both palette
  definitions retain the agreed neutral/blue direction.
- Development evidence: desktop typecheck session 71275 exited 0 in receipt
  781fc5; mobile typecheck 01bab1 exited 0. Scoped diff check 1b7a37 exited 0.
  Updated six inventory rows with the actual source assessment and outstanding
  render/integration limits. No frozen candidate, formal handoff, merge or push;
  full redesign remains active, review 0/3.

## Mobile planning and document controls continuation

- Read ProviderPicker, QuickAdd, PlanView and DocBody in full. Provider values
  wrap and the trigger's accessible name includes the selected provider. Quick
  Add removes preview animation, shortens the placeholder, shows full parsed
  values, serializes immediate submits, locks editing during save and ignores
  receipts after unmount/account change. Link prefills wait until the save settles.
- PlanView measures its own pane. Narrow plans stack time above the full title
  and remove the old 128-point action indent. Notes headers and actions wrap;
  move selection has a real 44-point target rather than overlapping hit slop.
- Document fold/comment/checklist controls have allocated touch targets. Deep
  list indentation is bounded by actual pane width, headings use the quieter UI
  weight and edited inputs use the platform font-size role. All block dispatch
  and full author content remain. Final integration/render acceptance is pending.
- Alias callers in PageInfo and ProjectsSheet previously converted rejected saves
  into success-shaped arrays. Those fallbacks were removed so the field retains
  failed drafts. Fields are keyed to their document/project; late project receipts
  cannot reopen another project and document aliases check the current identity.
  These are scoped caller fixes, not full ProjectsSheet qualification.
- Development mobile typechecks 54b1fa, ec718f and final f6a3a7 exited 0. Six
  inventory rows now state their source assessment and remaining limits. Unknown
  creation/merge responses, complete editor integration, formal verification and
  final visual qualification remain. No candidate freeze, merge or push; review 0/3.

## Mobile Home, task rows and chat navigation continuation

- Read TodayScreen, ItemCard and AssistantDrawer in full. Home uses one compact
  grouped-count panel, quieter 18-point values and no animated stat tiles.
  Removed repeated planning/section explanations; quick links/actions wrap and
  layout uses the measured pane. Optional study receipts are account-owned;
  failed reads offer Retry without presenting an empty state as success.
- Task completion has an allocated target, full titles/team names/metadata wrap,
  nesting respects remaining width and routine press/check-pop motion is removed.
  Subtask controls are siblings of the open action instead of nested buttons.
  Pending rows lock mutations; changing item/busy state closes old menus. Preview
  notes still open into full task detail. Drag and final render remain unverified.
- Chat drawer places New chat above history, separates open/options controls,
  gives options a 44-point target and puts active-job status below the title.
  Agent names wrap. Menus use the current listed chat and disappear when locked,
  removed or closed. Navigation motion is shorter, immediate on web/reduced motion,
  cancellable and without spring bounce. No sweep, pinning or history contract change.
- Mobile typecheck 220188 found a duplicate disabled attribute during the drawer
  edit; it was corrected. Subsequent b75248 and final 3dd11e exited 0. Scoped diff
  check 5f2643 exited 0. Three source inventory rows updated. Final navigation,
  history and home runtime/render evidence is pending. Review remains 0/3;
  no frozen full candidate, formal handoff, merge or push.

## Calendar styling and shared presentation continuation

- Read calendar.css (full 1,967-line input), theme.css and presentation.ts in
  full, plus the theme bootstrap and owning calendar layout/menu excerpts.
  Calendar already selects one/three/seven grid days by measured pane width;
  retained that behavior. Toolbar/review headings and keep-free controls wrap,
  short screens no longer require a 320-pixel grid, and scrolling is immediate.
- Planned blocks use a quiet accent fill instead of stripes. Inline meeting
  links reserve title space on wide pointer grids; short, narrow and touch
  events expose Join through the existing full-identity event menu. Coarse
  calendar/planner controls have 44-pixel targets. Very narrow agendas stack
  their time/title/status. Time-positioned event labels may remain compact;
  the existing event menu exposes full identity and actions.
- Shared calendar/search/in-progress empty states now state the fact and next
  action without motivational filler. Confirmed neutral/blue theme tokens and
  light-subtree palette injection; no rendered contrast claim is made.
- Core development build ccab48 exited 0. Desktop typecheck session 42714
  exited 0 (fd0856), mobile session 55267 exited 0 (bddb16), scoped diff check
  4b70b9 exited 0. Three inventory source assessments updated. These receipts
  do not prove meeting-link layout or calendar interactions. Full remaining
  source integration and final qualification are pending; review 0/3, no freeze,
  formal handoff, merge or push.

## Mobile AI choices and handoff editor continuation

- Read ChatgptModelsSection and AssistantHandoffAction in full. Device and model
  selections now use compact current-value controls with searchable owned sheets,
  instead of placing two long card catalogs inside Settings. All models remain
  selectable (removed the 50-match cutoff). Model names lead; IDs are searchable
  secondary detail and duplicates remain distinguishable. Optional identifiers
  and timestamps are behind Connection details. Account rows remain bounded.
- ChatGPT usage-link failures show inline rather than raising an alert. Device
  and model actions lock during local account operations. Existing authority,
  foreground runtime, plan-use consent and account-management contracts remain.
- Handoff instructions are bounded at 140 points with internal scrolling and no
  browser resize. Submits lock immediately, closing is disabled while pending,
  source/read/write receipts check owner/lifetime, and polling rejects obsolete
  responses and overlapping requests. Failed drafts remain. These guards do not
  establish uncertain-response idempotency or live native acceptance.
- ChoicePicker now supports searchable secondary detail without inflating its
  current-value trigger. Development mobile typechecks 633e32 and 43f6cd exited
  0; scoped diff check 1d1a0c exited 0. The final model-name count optimization
  replaces repeated scans with a linear map. Two inventory rows updated. Formal
  verification, final source integration and visual acceptance remain pending;
  no freeze, merge or push, review 0/3.

## Document workspace styling continuation

- Completed the full docs.css source read (4,687-line input) and inspected the
  owning block/tree markup and source-editor styles. Existing Markdown/source
  and standalone LaTeX/PDF modes remain in scope; compiler and full editor
  integration acceptance are still pending.
- Comment, reply and page-chat fields now share modest height limits with
  internal scrolling and no manual resize. Author names and auxiliary controls
  wrap. Outline/history/chat heights use the dynamic viewport.
- Nested lists preserve a usable text width; deep library indentation is capped.
  Library menus now have a separate column instead of covering page titles.
  Block handles and fold controls adapt to the document pane width, including
  wide-window split panes. Touch controls reserve their actual target space.
  Optional section labels use compact sentence-case type.
- Prettier completed (580ade); scoped diff check 80f16b exited 0. These are
  formatting/source receipts, not rendered acceptance. One inventory assessment
  updated. Remaining source integration, formal Test → Review and the bounded
  final web/Expo web visual batch remain pending; review 0/3, no freeze, merge
  or push.

## Mobile document links continuation

- Read the complete 910-line links.tsx input and inspected its editor/action
  callers. Link choices now preserve full titles and hints, use compact group
  labels, and separate loading, failure/Retry and empty results. Close/link
  controls reserve actual 44-point targets instead of overlapping hit slop.
- Resolver data is fenced by account and current reference set. Picker results
  are fenced by account/query, obsolete heading requests stop before their
  follow-up read, and failed line anchors retain a visible error rather than
  silently linking the whole page. Anchor submits serialize immediately.
- Linked references remount by account/object identity. Reads and failures
  ignore obsolete ownership/lifetime, failed reference reads offer Refresh,
  and mention writes serialize while preserving failure feedback. Full names
  wrap; context previews still open their source.
- Mobile development typechecks 52157 (cbfb7b) and 32949 (52c363) exited 0;
  scoped diff check ce83c3 exited 0. These checks do not prove inline-pill
  touch actions, native navigation, uncertain-write idempotency or related-page
  save receipts (the related callback remains caller-owned). One inventory
  assessment updated. Full remaining integration and formal qualification
  remain pending; review 0/3, no freeze, merge or push.

## Mobile rich documents and conversation continuation — 14 October

- Read the full RichBlocks.tsx and AssistantScreen.tsx inputs, the cover
  renderer, and relevant table-save/history/agent-sheet callers. All three
  document editing modes remain required; this batch does not qualify the
  compiler or the complete document editor.
- File-link cache and in-flight receipts now belong to their signed-in account;
  old receipts cannot populate a replacement cache. Downloads check ownership
  before fetching and before saving. File/image read failures offer Retry instead
  of claiming deletion. Download failures remain beside the control, repeated
  submits serialize, and cover/image-size receipts ignore obsolete ownership.
- Embedded sections remount by account/document/block and accept only the newest
  watch/read response; failed reads clear stale sections and offer Retry. File
  names and section titles wrap. Actual 44-point controls replace overlapping
  hit slop; linked task controls allocate checkbox space. Image headers/tools
  scroll within height limits, size choices wrap and the viewer opens without fade.
- Background and Overnight both open their activity/results and conversations
  from the chat drawer. Deferred agent/drawer selections check account ownership.
  History operations serialize; delete uses a focused owning sheet with retained
  failure state, rename locks closure, and action failures are inline. Project
  choices are searchable/bounded. The composer retains a shared compact baseline,
  modest capped growth and internal scrolling, prohibits browser manual resize,
  resets height on clearing and prevents sending during history restoration.
- The provider-sharing fact stays visible; scope-specific details are under
  What is shared. Essential approval questions/actions remain visible. Shared
  history/sweep contracts are retained, but full hook/RootScreen interactions
  still need final assessment. Table/caption save integration and native file
  handling remain unverified; no native build or Codex Security scan was run.
- Initial mobile typecheck 74459 failed after removing the obsolete Alert import
  before replacing its fallback (c1cbcb); replacement check 44020 exited 0
  (8fb3ee). Checks 55706 (47f8a5) and 91808 (a03397) exited 0. Check 6229 failed
  on the two deferred-chat assignments (61afb5); corrected check 46638 exited 0
  (b3501c). Scoped diff check a7ef06 exited 0. Four inventory assessments updated.
  These are development receipts, not formal acceptance. Full remaining source
  integration → Test → Review → one bounded web/Expo web visual batch is still
  pending; review 0/3, no frozen candidate, merge or push. Goal remains active.

## Shared styling and reported navigation defects — 14 October

- Completed full reads of legacy-dark.css and planning.css; inspected their
  owning chat/plan/command markup. Removed stronger legacy rules that concealed
  checked switch colour, restored obsolete chat fills/focus colour and overrode
  semantic paragraph/navigation styles. Dark planned blocks now retain the quiet
  accent fill. Remaining domain-specific dark tones remain token-based.
- Planning menus, identities, tags, dependency names, keyboard help and controls
  reflow instead of clipping. Proposed schedules respond to their own pane width.
  Removed ornamental command entrance and forced board smooth scrolling, replaced
  residual surface/focus colour literals, and allocated actual coarse targets.
- Addressed the owner-observed 11:59 screenshots in source: Topbar omits the
  repeated location when tabs are visible; tabs size to content, capped at 200px;
  brand text/dot align to the logo within a consistent line box.
- Added a navigation resize edge for expanded wide layouts. Pointer capture and
  Left/Right/Home/End share 200–400px bounds, constrained by the working pane.
  Escape/pointer cancel restore the starting width; double-click resets; chosen
  widths persist without overwriting narrow/rail behavior. Parent shell and
  sidebar share the same width token. Native/system UI behavior is not claimed.
- Desktop development typecheck 74380 exited 0 (bbb62a); scoped diff checks
  69ef69 and 6bb398 exited 0. These source/format receipts do not verify pixels
  or interaction. Updated seven coverage entries and the requested decision
  requirements. Remaining full integration, Test → Review and one bounded final
  Visual Check batch remain open; review 0/3, no freeze, merge or push.

## Mobile task workspace continuation — 14 October

- Read the full TasksScreen.tsx input and shared Chip source. Replaced the
  expanding filter/catalog panels with one focused sheet: layout, current
  values, searchable full choices, sort and pinned sections stay available
  without inflating the task feed. Active filters remain visible/removable.
  Manage Tags/Lists waits for sheet dismissal and checks the account owner.
- Board moves use a focused searchable target sheet with the full task title.
  Busy actions lock, missing tasks cannot be moved, and the operation resolves
  the current item rather than a stale picked object. Invalid move choices
  retain the selection and show feedback. Parent mutation callbacks still own
  server receipt/error handling; this batch does not prove uncertain writes.
- Grouping loads project names for board and list modes. Owned reads are
  cancelled on mode/account changes; ownership/review failures offer Retry
  rather than presenting a confirmed empty inbox. Unknown total/review counts
  display unavailable instead of zero. Source-visible status/permission/group,
  manual-order and pinned-section contracts remain intact.
- Removed local layout/press animation. Shared chips allocate actual 44-point
  targets, preserve wrapping labels and use soft custom-colour selection.
  Updated the contributor/skill reference touch-target rule to reserve space
  rather than overlap neighbouring controls. This narrow reference update
  follows skill-creator guidance; no unrelated skill metadata changed.
- Mobile development typechecks 22429 (6837c2) and 31314 (b03230) exited 0;
  scoped diff check f1266a exited 0. Final feedback placement is a small JSX
  refinement after that check. Two inventory assessments updated. These
  receipts do not establish visual or parent mutation acceptance. Remaining
  full integration → Test → Review → bounded final Visual Check is pending;
  review 0/3, no frozen candidate, merge or push. Goal remains active.

## Settings stylesheet continuation — 14 October

- Completed full source reads of settings.css (1,317-line input), agents.css
  (637), agent-channels.css (96), assistant-rules.css (76) and night-shift.css
  (38). Inspected the owning Settings content/editor and agent-list actions;
  connection management/activity already uses portal overlays.
- Settings content and independent editors now provide named width containers.
  Field grids and appearance choices stack within a narrow pane even in a wide
  browser. Labels use compact readable text; headings, metadata and actions
  wrap. Search results are bounded, and informational hour bars shrink to fit.
- Connected-agent collections have bounded scrolling while search/pagination
  stay outside. Narrow rows retain their client identity instead of hiding it.
  Page/search changes return the list to the start. Full link/host/instruction
  values remain available, and coarse controls reserve 44-pixel targets. Rule,
  budget, channel and night-shift controls keep full values without overflow.
- Prettier/scoped diff check 52c5c7 exited 0. Desktop development typecheck
  46302 exited 0 (3c50a9); scoped diff check dac6b2 exited 0. Five coverage
  assessments updated. These are source/type receipts, not evidence of final
  composed Settings styles, overlay/focus behavior or visual acceptance.
- The remaining full redesign integration, Tester → Reviewer and one bounded
  final web/Expo web visual batch remain required. Review 0/3; no freeze,
  formal handoff, merge or push. Goal remains active.

## Shared controls and team styling continuation — 14 October

- Completed the full 3,865-line global.css source read and both team agent/
  capacity stylesheet reads. Inspected the capacity table's scroll owner and
  shared task checkbox markup. Shared control labels, values and actions now
  wrap; selected model/date values remain readable. Modal labels use the
  small text role, stats avoid clipped values and grid cards fit narrow parents.
- Replaced residual old palette literals with semantic theme tokens, removed
  ornamental progress entrance and physical hover transitions, and disabled
  sidebar/shell transitions that made resizing chase the pointer. Kept meaningful
  progress state, focus indicators and calendar/status tones.
- Touch checkboxes reserve a 44-pixel target with a compact inner mark; adjacent
  link/action hit areas no longer overlap. Light checked state uses a visible
  accent fill; obsolete dark overrides cannot repaint the expanded target.
  Touch task rows keep restrained vertical padding and aligned metadata.
- Date/time popovers stack their panels when the popover is narrow; time choices
  stay bounded and date rows have usable height. The owning shared popover CSS
  supplies its width context. Team connections are bounded, and seven-day
  capacity remains a contained scrolling table with independently operable cells.
- Prettier/scoped diff check 4e5dc7 exited 0; final refinements follow that receipt.
  Three coverage assessments updated. These source checks do not prove contrast,
  focus, target geometry or composed layout in pixels. Remaining full source
  integration, formal Test → Review and one bounded final Visual Check batch
  remain open; review 0/3, no freeze, merge or push. Goal remains active.

## Mobile inline documents and selection continuation — 14 October

Final mention virtualization: mobile typecheck 47364 (e137b9) exited 0.

- Read complete MentionStrip, WordPicker, MathView, Inline and DocViewers
  sources; inspected presence registration and picker callers. Word selection
  is bound to its source, so replacing a line cannot dereference obsolete word
  indexes or submit the old quote. Full words remain selectable in a bounded
  scrolling surface, with separate targets and concise state instructions.
- Mention selection exposes every supplied permission-filtered match rather
  than truncating at eight. A bounded virtualized list keeps full names and
  disambiguates duplicate names by email. Selection checks the current supplied
  list/failure state; this does not replace parent/backend authority checks.
- Presence reads bind to page/account, coalesce bursts, ignore obsolete receipts
  and offer inline Retry instead of retaining old viewers. Cleanup avoids
  clearing a different registered page. Scoped presence still needs full
  editor/hidden-sheet integration assessment. Displayed equations expose their
  contained horizontal scrolling; mathematical source/layout remains unchanged.
- Inline links/footnotes expose appropriate accessible roles. External opening
  serializes, async errors check lifetime/owner/source, and absent parent error
  handling uses inline feedback rather than an alert. Existing destination
  filtering, user text, marks, source references and parent routing remain intact.
- Mobile development typechecks 41073 (a110a7) and 26965 (a81caf) exited 0;
  scoped diff check 93c7da exited 0. Final mention virtualization follows those
  receipts. Five inventory assessments updated. Native text scaling/math,
  keyboard selection and complete editor interactions remain unverified.
  Remaining full integration → Test → Review → bounded final Visual Check
  remains required; review 0/3, no freeze, merge or push. Goal remains active.

## Assistant navigation correction — 14 October

Removed Background and Overnight from primary NAV_GROUPS at the owner's request.
Both lanes remain available in the Orbyn chat workspace; existing view routing,
conversation history and runtime controls are unchanged. Recorded this navigation
decision in ADR 003. Desktop development typecheck 66710 (8ff3d9) exited 0;
scoped diff check exited 0. No visual rerun for this small removal. Complete
redesign integration and the frozen Test → Review → final visual batch remain
open; review 0/3, no merge or push.

## Mobile history and formatting continuation — 14 October

Read complete DocHistory, LineToolbar and DocContainerBody sources. History
now offers read-only previews, a bounded version list, full author wrapping,
failed-list Retry and an Orbyn restore confirmation sheet. Page/account/lifetime
checks reject obsolete receipts; immediate pending locks serialize version reads
and restoration. Latest parent page is used for line restoration, retaining the
existing single conflict reread. Current content remains in server history.
Structured comparisons project their text blocks rather than comparing only the
legacy array; whole-version previews retain nested rendering. Layout-only changes
and structured authorship are not qualified by that text comparison, and individual
line restoration stays disabled across structured formats. Uncertain restore
responses still need backend receipt assessment; no idempotency claim is made.

Formatting uses a bounded kind/insert selector, suppresses it while the bracket
link picker owns the inline surface, and shows horizontal scrolling affordance.
Toolbar, checklist and callout controls reserve 44-point targets in layout rather
than overlapping hit expansion. Deep document nesting and complete editor/keyboard
integration remain open.

Mobile development typechecks 23366 (e2ad14), 61264 (e73343), 93472 (3a6205)
and final 38683 (e91cfb) exited 0. Scoped diff check 837322 exited 0.
Three inventory rows updated. Full integration → frozen Test → Review → one
bounded final Visual Check remains required. Review 0/3; no freeze, merge or push.
The previous goal turn made progress through navigation source changes and a
terminal desktop typecheck. This turn also changed authoritative source and
completed development checks; goal remains active.

## Mobile document editor integration continuation — 14 October

Read all 3,594 input lines of DocEditor across contiguous ranges, plus the complete
SmallAction and relevant shared TableEditor/ActionSheet contracts. Editor ownership
now resets by page/account. Pending queued saves check account and current write
permission before requesting; stale parent receipts are rejected. Presence cleanup
only clears its registered page. The leave guard includes the currently typed line,
not only previously synchronized blocks, and keeps pending requests/proposals owned.
Immediate block naming, comments and task ticks mark unsaved work before requesting.
Failed saves expose retained-edit feedback and Retry; footer reports unsaved state.
Offline-storage failure is also caught; complete outbox/leave recovery remains open.

Creation retains its original line, draft and selection. A changed insertion context
leaves the created object reachable through Open instead of overwriting new text.
Uploads serialize, check owner at each request boundary and resolve the original
line against current content; a removed insertion point appends with explicit feedback.
Table insertion opens the actual inserted block without a delay. Table editing keeps
its original source and rejects changed/removed targets with inline feedback; shared
TableEditor keeps its draft on rejected save. Suggestion submission serializes and
keeps failed/newer typed text available. Permanent Memory removal now uses an Orbyn
sheet; Trash waits for saved drafts and serializes. Undo remains account-bound.

Slash selection no longer drops matches after eight; its scrolling surface is bounded,
with full hints and tags. SmallAction allocates its actual 44-point target and shared
radius. Clipboard copying includes the current draft and reports unavailable writes
instead of falsely reporting success. Existing mathematical/document source,
permissions, server revision guards and source/assistant proposal semantics remain.

Development mobile typecheck 20611 (196f37) exited 0. The intermediate upload/table
patch typecheck 71602 (f973a2) failed because table source lost its union narrowing;
corrected the snapshot to the table block type. Typechecks 55448 (e11849),
20244 (7ec326), and final 98465 (a1a3f7) exited 0. Scoped diff check c6da53 exited 0.
No formal test or pixel pass is claimed. Remaining page-star/archive/read recovery,
external format changes with drafts, owner-sensitive caches, complete panel/native
keyboard integration and compiler qualification remain in the full delivery scope.
Review 0/3; no candidate freeze, merge or push. Previous goal turn and this turn
made source/evidence progress; goal remains active.

## Settings hover and mobile Calendar continuation — 14 October

The owner's Settings screenshot identifies a broad grey disclosure hover fill.
Removed that fill from the shared Settings heading; only its chevron changes
subtly on hover-capable devices. Keyboard focus remains outlined and expansion
remains indicated by chevron orientation. Removed ornamental chevron rotation
animation. Updated the design skill reference and ADR with this preference.
CSS formatting/diff check 17014 (7a21be) exited 0; no pixel qualification claimed.

Read the complete 2,107-line mobile CalendarScreen in contiguous ranges and full
ActionMenu. Three-day mode now measures the remaining pane and text scale.
Calendar tools are Plan plus a focused options menu; set selection uses a
searchable bounded sheet rather than an expanding chip collection. Removed the
repeated multi-day heading, clipped names and ornamental FadeIn/layout calls.
Names, legends, date headers and subscribed entries wrap; controls allocate targets.

Keep-time edits now live in a sheet with inline invalid-time feedback. Failed or
conflicting plan requests keep the entered times instead of treating the parent's
swallowed error as success. Tune/apply operations have immediate locks and check
that their result still belongs to the current account/preview. Nonrepeating item
removal uses an owned confirmation sheet; failed removal retains its target.
Subscribed-calendar details use the existing sheet instead of an alert. Join-link
failures go through parent error handling. Calendar/date reads ignore obsolete
receipts and expose unavailable/retry feedback while identifying saved-item fallback.
ActionMenu deferred callbacks are account/lifetime-bound. Repeat-scope dialogs,
move callbacks, full header identity, availability and timeline interaction require
remaining integration work; these changes are not a blanket native pass.

Mobile development typechecks 68282 (569450), 17679 (bd79bc), 46060 (51b03d),
and final 27958 (22a07c) exited 0. Scoped diff check 2f9505 exited 0.
Two inventory assessments updated. Previous goal turn and this turn made source
and verification-evidence progress. The full redesign remains active: complete
integration → frozen Test → Review → bounded final Visual Check; review 0/3,
no freeze, merge or push.

## Timeline and Macro reference continuation — 14 October

Read all 1,877 input lines of mobile DayTimeline. Fixed-height multi-day all-day
rows now expose a count selector rather than silently hiding later chips; ordinary
all-day names wrap. A full-detail events/sessions sheet exposes complete names,
times and separate options for compact or overlapping blocks without inflating
their duration geometry. Selection hands off after sheet dismissal and checks
account/lifetime. Narrow panes collapse extra time-zone gutter columns while
retaining every visible-hour conversion in a bounded, horizontally scrollable
sheet. Gutter widths and aligned multi-day rows account for text scale. Frame
and kept-free bands now respond to normal activation as well as long-press.
Shared radius tokens replace raw decorative radii. Resize gestures now register
for cleanup, avoiding a page left scroll-locked on removal; ending another block's
drag cannot commit this block. Pointer/keyboard/native and compact-band target
qualification remain required; source checks do not establish those outcomes.

The owner requested a GPT-6.1 Sol low-effort research subagent for local Macro.
Delegated read-only source research; only the new reference report was written,
with no product imports, tests/builds/security scans or rendered/native checks.
Read its complete mechanisms/priorities report and updated ADR 003 and the design
skill with explicit pane ownership, retained content lifetime, measured tool
collapse and repeated-search reuse. Macro's native stack, shrinking minimum-size
solver and pointer-cancel behavior are recorded as limits, not Orbyn requirements.

Started the first pane-ownership refinement in App: invisible narrow panes are
inert, command ownership checks visibility, focus capture ignores hidden panes,
and switching/opening/closing restores a connected visible last-focused child or
a container fallback. Restoration waits for committed panes, cancels stale work
and clears account-owned focus state. Existing shared planner, independent
controllers and close/draft guards remain. Global chrome/portalled dialog ownership,
search reuse and complete shell integration remain open; no blanket focus pass.

Mobile typechecks 10496 (7d967a), 71162 (032f10) exited 0. Combined desktop/mobile
check 88312 (b62e78) exited 0; final desktop 77523 (01aae7) exited 0. Further
scaled-gutter refinements follow these receipts. Scoped diff check 97db94 exited 0.
Two inventory rows updated. Previous and current turns made source/evidence
progress. Goal remains active; full integration → frozen Test → Review → bounded
final Visual Check still required, review 0/3. No freeze, merge or push.

Final scaled-gutter mobile typecheck 40359 (8bf1bd) and scoped diff check 4c32b7
exited 0. The outstanding rendered/native and full-candidate gates above remain.

## Search ownership continuation — 14 October

Applied Macro-inspired search reuse within the existing workspace/CommandBar
boundary. Repeated search opening increments a focus request without toggling
closed or clearing query/results. Explicit search/add links have a separate query
request so their intentional seed is distinct from a focus action; an existing
assistant operation is retained until its mode yields. The open search handles
its configured repeat shortcut while preserving current results/selection.

CommandBar now uses useModalFocus rather than its duplicate Escape/Tab trap,
including connected opener restoration, pending-dismissal guards and higher-dialog
ownership. The modal declares the existing data-modal-focus identifier so Popover
receives its actual owner. Owned pickers keep their keyboard interaction. An inert
or hidden dialog owner yields interaction through dialogLayers; hidden paired panes
cannot run that focus handler. Backdrop dismissal waits during pending work.
Shortened the visible search hint. Existing capabilities and query semantics remain;
full CommandBar async/read recovery, shared-chrome focused-pane routing and actual
layer/focus qualification remain in the complete delivery scope.

Desktop development typechecks 43150 (6727a8), final 25545 (a79757) exited 0;
scoped diff check 0f230a exited 0. One inventory assessment updated as partial,
not a whole-source or rendered pass. Runtime inventory 0f230a/88870d confirms
listeners on API 8008 (PID 92638), web 5174 (92672), Expo web 8083 (92748),
with their cwd in this c6-next backend/desktop/mobile checkout. This proves process
source location, not fixture correctness, endpoint health or visual qualification.

Previous and current goal turns changed source and produced terminal checks.
Full redesign remains active: complete integration → frozen Test → Review → one
bounded final Visual Check. Review 0/3; no freeze, merge or push.

## CommandBar integration continuation — 14 October

Completed the CommandBar source read and applied pane-scoped page commands,
per-instance accessibility IDs, account/lifetime guards and immediate operation
locks. Document reads retain search until the destination is available. Query-keyed
receipts hide stale search/event results; read failures expose Retry. Confirmed
quick-create receipts survive a subsequent planner refresh failure and reopen
the created object instead of repeating that confirmed write. Applied proposals
remain applied after refresh failure. Source and kept-note callbacks are wired.
Long search/create text receives explicit validation rather than silent truncation.
Pending controls and dismissal preserve the operation; keyboard pin access remains.

Picker choices now retain IDs against current project/tag/team datasets. Manual
query changes clear choices whose names no longer match; explicit seeds reset them.
Team metadata reload clears stale members and shows scoped recovery when an @
query needs unavailable teammates. Duplicate human labels still need disambiguation;
unknown network write outcomes, mixed result/pin semantics, global chrome targeting
and final composed interactions remain open. Confirmed receipts do not establish
idempotency for an unknown response.

Corrected an inventory transcription error: the previous repeat-search assessment
had landed on booking.css. That row again states layout/copy assessed with full
source audit pending; CommandBar carries the actual search assessment.

Desktop development typechecks 39016 (94d543), 38763 (c2113b), 35523 (20faed),
49912 (0b8dfb), 83690 (f884dc), 84501 (73a490), 59231 (721505) and final
31926 (5d4842) exited 0. Diff checks 24b6aa, 3149c4, c4a036 and 6a8fa9
exited 0 before the final metadata refinement; final diff receipt follows.
No tests, browser review or native verification ran for this continuation.
Full redesign remains active; whole candidate → Test → Review → bounded final
Visual Check. Review 0/3. No freeze, merge or push.

## Focused-pane shared navigation — 14 October

Previous goal turn changed source and produced successful typechecks (progress).
This continuation adds scoped controller registration for the shared sidebar and
primary header. Navigation, saved views, starred items, notifications and search
now dispatch to the focused visible controller. Shared chrome pointer/focus events
(including SVG icons and the account-menu portal) no longer implicitly select the
first pane. Sidebar view/saved-view selection follows the focused controller.
Local pane content continues to own its direct navigation and shortcuts.

Destination changes await the current pane's leave guards; Settings/task details
remain overlays. Immediate navigation locking prevents double dispatch. A pending
guard cannot navigate after account, navigation, focus or mounted-owner changes.
Registration cleanup is identity checked. Search reuses that controller's existing
query. Header remains the direct shell child, preserving current responsive CSS.
The shared planner and controller/draft lifetime are retained.

Desktop development typechecks 4323 (4524b2), 27368 (abe408), 57502 (8c49ad),
57523 (a45307), final 33384 (edf8c1) exited 0. Diff e7b9f8 exited 0 before
final lifecycle refinement; final diff receipt follows. No formal tests or browser
checks ran. These are source/dev receipts; full shell and dialog integration,
unknown read/write outcomes and final paired/narrow keyboard interactions remain
required. Three inventory rows updated without promoting them to rendered passes.
Review 0/3; goal active. No candidate freeze, merge or push.

## Mobile shell integration — 14 October

Previous goal turn changed shared pane routing and produced typechecks (progress).
Read the full original RootScreen (2300 lines), App, Brand, tabs, pane measurement
and repeat-scope/source contracts. AccountRoot now owns local sheet/back/pending
destinations and assistant state, keyed to the planner sign-in while the shared
planner stays mounted. Root lifecycle/session guards exclude old destination
receipts. Pinned-view reads have request ownership and local Retry.

Task split uses measured root space minus safe-area insets and scales its threshold
and side width with text size. Header groups wrap; the existing 44-point plus
control no longer adds overlapping hitSlop. Reduced-motion preference applies to
Settings section scrolling. Expo-web text fields retain the global keyboard
outline. Brand source was assessed, not changed or visually qualified.

Scoped page/task readers are used for links, recent changes, project notes and
assistant source/kept-note navigation; tab/sheet/destination changes invalidate
their pending receipt. Failed reads use the existing root error handling rather
than unhandled callbacks. Save/delete serialize immediately, recheck account
after occurrence choice, and keep missing team membership from granting write
hints. Native shared-file polling serializes overlapping foreground checks and
checks account/lifetime before subsequent uploads; no native execution occurred.
Unknown write receipts, all remaining direct async routes, nested dismissal/back
semantics, document leave/return guards and root/planner integration remain open.
Interrupted consumed native-share files require separate recovery assessment.

Mobile development typechecks 7446 (d32b6d), 55642 (dfd4e3), 19521 (7c25e7)
exited 0. Check 83808 (77840c) failed because shared.link is not a style export;
fixed Retry to shared.small plus the semantic accent. Repair check 37558 exited 0;
final ownership refinement/type/diff receipts follow. Three coverage rows updated
with explicit remaining limits. No formal tests or rendered/native check ran.
Goal active; whole candidate → Test → Review → bounded final Visual Check;
review 0/3. No freeze, merge or push.

Final mobile shell typecheck 1141 (41694a) and diff check a07d77 exited 0.
Repair check 37558 receipt was ce3a64. Full-candidate gates remain open.

## Search and menu selection integration — 14 October

Previous turn changed mobile shell/source and produced receipts (progress). Read
SearchSheet's original full 617 lines and MoreMenu's full source. Mobile search
now binds rows/errors to the query/filter key, clears them for Retry and prevents
stale account/lifetime receipts. Project metadata distinguishes loading/failure
from no matches. Search words over 200 receive validation; no prefix is sent.
Input preserves longer filter expressions. Async result opening locks immediately,
retains the query on failure and reports that failure inside Search. Root's search
destination callback now returns its actual request and checks navigation/account
before opening. Commands also await returned actions; root focus-start checks
each pending destination and account boundary.

All matching phone commands are shown in the scrolling sheet rather than losing
results to an extra display slice. Result hints wrap. Filter dropdowns use button
semantics and actual 44-point layout targets, with a visible horizontal indicator.
Project/tag/team choices retain IDs; exact duplicate typed names request a choice.
Project/tag rows include their space; explicit Personal stays personal even when
a team is named Personal. Desktop CommandBar received these selection fixes too.
Identical names in the same space still require fuller human disambiguation.

MoreMenu now uses optional stable IDs, actual 44-point trigger space and one
committed selection per opening. Deferred actions capture the opening account;
dismissal/fallback consumption runs once and cleans its timer. New openings and
unmount discard pending old actions. Native dismissal timing and portal/keyboard
behavior remain unverified. Design guidance records the universal selection and
recovery contract. Existing server recent/search limits (15/30 on mobile) remain;
source changes do not prove search completeness or host behavior.

Mobile development checks 48656 (d666e7), 90399 (906124), 24604 (c96fd6),
75723 (e5919e) exited 0. A desktop-parity edit attempt had a Python string syntax
error before any mutation; formatter plus existing desktop/mobile checks 85089
(0f1afd) exited 0. Corrected edit's combined checks 77278 (3a3856) exited 0.
Diff checks 9295ea and f2df0d exited 0. Three coverage rows updated. No tests,
browser, native or security scan ran. Whole integration → frozen Test → Review →
one bounded final Visual Check remains; review 0/3. Goal active, no merge/push.

## Mobile appearance, reminders and motion — 14 October

Previous goal turn changed search/selection and produced typechecks (progress).
Read full Character (209 lines), CharacterEditor (192), LookEditor (298),
ReminderNudge (248), all shared mobile motion modules and the checklist StepRow
plus its styles/call contracts. CharacterEditor measures its actual width and
text scale to stack the preview, removes decorative framing/marketing helpers
and exposes preset scroll position. Shared reduced-motion state now starts true
until the asynchronous system preference resolves. Existing explicit companion
animation and personal static/hidden choices remain. Palette-label consistency
and native visibility are still open.

Appearance separates Emoji/Icons/Custom; one Save validates and previews custom
emoji rather than requiring an extra Use action. The existing-picture catalog is
optional detail with independent read recovery; icon/cover removal moves into
options. Upload/save lock immediately, retain drafts after failure, show accurate
phase and check lifetime/account before subsequent requests/receipts. File metadata
uses the shared input schema and a readable size/type error. Picture-read tickets
prevent an older catalog response replacing a new upload; a fresh catalog read
follows upload confirmation. Parent project-save integration, picker/native focus,
pending-file cleanup and unknown network outcomes remain unqualified.

Reminder actions/Undo/receipt reads are account/lifetime guarded. Date edits survive
a late settings read; settings failure exposes a scoped Retry while allowing an
explicit date. Booking requires 5–1440 whole minutes, with visible validation.
Confirmed action status still governs action availability. Unknown write receipts
and backend/native acceptance are not established by these edits.

Checklist rows remove the ornamental tick pop, reserve real 44-point target space,
retain checked-state feedback and put Rename/Delete in an options menu. Read-only
state disables tick and rename. Only that row/source/style contract was assessed;
the rest of TaskDetail remains explicitly partial. Nine coverage rows updated.

Mobile development checks 95262 (b4ba68), 20442 (b40827), 22950 (c72b01),
54089 (48ec7d), 36872 (f893ff), final 31399 (242ccf) exited 0. Diff checks
6a3f6e, 130229, 16d785 and 573e50 exited 0. No formal tests, visuals, native
execution or security scans ran. Full integration → frozen Test → Review →
bounded final web/Expo Visual Check remains; review 0/3. Goal active, no freeze,
merge or push.

## Shared companion layout parity — 14 October

Previous turn changed mobile appearance/reminders/motion with typecheck receipts
(progress). Read the complete web Character (177 lines), CharacterEditor (166)
and character.css (161), plus the relevant shared catalog/theme mapping. The web
editor now matches the quieter mobile preview: 128px identity, only meaningful
hidden-state help and no repeated wardrobe/save marketing paragraph. Its preview
stacks by the actual editor container, fields use an intrinsic fitting grid,
long names wrap and category actions reserve their target space. All wearables,
presets, surprise/reset, explicit greeting, motion/expression and parent-owned
unsaved form behavior remain. The SVG rig's listeners/RAF cancellation and
explicit static/hidden/reduced-motion behavior were source assessed, not rendered.

Shared palette labels now say Accent/Muted for the existing fern/sage IDs, matching
their semantic blue/neutral theme mapping in both renderers. Persisted IDs and
palette selection values are unchanged. Core was built so previews consume the
new catalog export. Three web coverage rows updated; the mobile palette-label
source issue is resolved, with composed rendering/native visibility still open.

Core build and desktop/mobile development typechecks 57240 (8820e7) exited 0.
No tests, browser review, native build or security scan ran. Complete integration
and source coverage, frozen Test → Review and bounded final web/Expo Visual Check
remain. Review 0/3; goal active; no freeze, merge or push.

## Full mobile task-detail continuation — 14 October

Previous goal turn changed companion layout/catalog with terminal evidence
(progress). Read the entire original TaskDetail (1950 lines, including previously
assessed StepRow), ChoicePicker and the scoped project-assignment contract. Task
status and update status now use compact owned choices; Project and Stage use
searchable current-ID choices rather than every chip on the page. Related Pages
are optional detail. Progress/checklist/subtasks/updates use grouped section lines
instead of repeated card frames. Long crumbs, links, authors and subtask values
wrap. Header/count/percentage rhythm is compact; controls use radius/target roles.

The wide detail panel has one scrolling body with its footer retained, replacing
its nested scrolling wrapper. Task reads distinguish pending/failure and offer
Retry; active/lifetime/account guards and request tickets exclude stale detail/
context receipts. Immediate mutation locks cover detail actions and subtask/page
creation. Missing membership cannot grant write hints. Confirmed project receipts
adopt returned item fields while retaining typed detail relations; related-context
refresh is separate and cannot make that confirmed write look uncommitted.
Explicitly cleared project values stay None rather than falling back to old seed
data. Stale context cannot advertise the previous project/stage as current.

Failed progress saves retain the selected value for Save progress; timers pause
with hidden detail and use current item/version. Offline transport failures retain
the existing outbox action path; queued results say saved on this device and do
not trigger confirmed-completion celebration. Add/update drafts clear only after
success and only when unchanged. Failed checklist rename retains its input.
Task cancellation uses the owned action sheet on every platform. Star status
distinguishes loading/failure, has Retry and serial account/object-owned receipts.
ChoicePicker never displays a missing internal ID and dismisses when disabled.
Expo-web textarea resizing is disabled; custom emoji inputs meet web phone sizing.

Remaining integration gates are concrete: Root's width transition currently
switches task detail between separate tree positions; it must keep the same draft
and pending-action ownership across side-panel/sheet transitions. Task changes
and close/return need full draft guards. Parent/series-note failure recovery, all
nested selectors/dismissals, unknown write outcomes and formal outbox/version
behavior remain open. No blanket task-family/native/rendered acceptance claim.

Development mobile checks 89731 (827b4f), 64667 (61bff8) exited 0. Check 70668
(9cc489) failed on normalized Item attendees versus typed detail attendees; fixed
by retaining detail attendees/links while adopting returned ordinary fields.
Repair 44238 (88dead) exited 0. Check 79214 (4c30e1) failed because SmallAction
requires disabled; supplied current reading guards. Repair 74672 (5a666d),
41523 (8d5046), 9016 (1a5f26), 93930 (cd8f2b), 4466 (4c102d),
5532 (2d9b78), 96923 (70b1f1) and final 11516 exited 0. Diff checks ebb50d,
ffaca2, 41a70d, 5c5ad9 and d14644 exited 0. Incorrect exploratory route/file
paths were corrected to modules/projects/routes.ts; no backend mutation occurred.

Coverage rows updated and ChoicePicker added to the primary inventory. No tests,
visual/native execution or security scans ran. Full candidate → Test → Review →
one bounded final Visual Check remains; review 0/3. Goal active; no freeze, merge
or push. Next integration work includes the root split/sheet continuity above.

## Task controller lifetime and leave guards — 14 October

Previous turn changed task-detail source and produced terminal receipts (progress).
Root now renders task detail in one stable tree position. A zero-size modal anchor
becomes the side panel at sufficient measured width; narrowing an open side task
keeps it visible as a sheet. The installed React Native Web ModalPortal source
confirms modal content attaches to document.body, outside that anchor; this is
source evidence, not a rendered or native pass. Returning between presentations
does not push another task onto the sheet history. Other overlays pause the held
task's activity while its controller remains mounted.

TaskDetail's account controller and presentation-independent content hook retain
update/subtask/checklist/progress drafts, rename submission locks, operation refs
and read receipts through width changes. Item identity resets explicitly, while
the Sheet frame stays mounted across task switches. Old-item receipts check their
captured identity. A transition placeholder hides old content until reset. Scroll
offset restoration is requested once per presentation/activation change; ordinary
content-size changes do not force scrolling. Checkbox rename data now belongs to
the controller rather than a row that remounts with presentation.

Draft/cancel/header menu overlays are stable siblings of the presentation. Close
and target changes use a registered latest task guard: pending writes block
departure; unsent text/status/steps/subtasks/progress require an owned discard
choice. Keep editing retains drafts. The guard pauses debounced progress rather
than committing during confirmation, and locks fields through deferred selection
settlement. Unmount resolves pending guards false. Root uses destination/account/
current-target checks after awaiting, changes tasks in place, and also protects
the Focus return target. Repeated close cannot pop history twice.

ActionSheet reports selected closure separately from plain dismissal; explicit
event wrappers avoid treating native events as selection. Cancel task keeps its
target until the deferred chosen callback. Sheet has an optional guardedClose
contract to disable native swipe dismissal before a draft guard; installed native
Modal declarations support allowSwipeDismissal. Header buttons occupy their own
44-point space and expose disabled state without overlapping hitSlop. These native
contracts are source assessed only; physical dismissal/rotation remains untested.

Mobile typecheck 65698 (030983) exited 0. Checks 68205 (402e9a), 13956
(70bd28) failed on native event handlers receiving the new close-reason type;
fixed by calling onClose through zero-argument wrappers. Repair 19605 (93bc8f),
37977 (9029e5) exited 0. Check 7833 (cf659c) failed because the optional Focus
guard could be null; explicit previous/guard conditions fix it. Repair 64568
(d5aceb), 67729 (0e3305), final 23911 (3fcebf) exited 0. Diff checks 377f43,
dde0b4, d83063 and d770fe exited 0. Coverage rows updated.

Remaining gates include composed browser transitions, field/picker focus, pending
write completion and keep/discard behavior, external/modal handoffs, metadata
failure recovery, repeat-occurrence context and full outbox/runtime integration.
No tests, visuals, native execution or security scan ran. Full redesign remains
active; complete candidate → Test → Review → bounded final Visual Check, review
0/3. No freeze, merge or push.


### Mobile item editor — 14 October

Full original `ItemEditor.tsx` source (1–1481) assessed. Replaced long status,
sharing, list and assignee rows with searchable ID choices; optional tags,
measurements, event details, links and alerts stay behind More details.
Preserved sharing consequences and core scheduling controls. Long link values
wrap; notes scroll within a bounded height; close/remove actions reserve 44pt.

Account/object keyed lifetime and an immediate tag operation guard prevent
late tag results from changing another draft. Confirmed tag attachment precedes
list refresh, with a distinct refresh failure message. Closing through the
header, sheet request or custom swipe uses the same unsaved-change modal;
native swipe dismissal is disabled for the guarded editor. Pending tag work and
parent saves block dismissal. Unfinished links/tags block Save with a specific
message. Estimate input preserves typed text and reports out-of-range values
instead of silently clamping. All-day, clear-time and deadline actions now lock
with the form. Saved links/invitees remain protected while their detail read
loads/fails; people, details, alert defaults and project reads have local Retry.
Project deadline warnings only use a matching current project.

Development evidence: mobile typecheck exited 0 (`58394`/`0ff2a4`,
`22970`/`6e85c0`, `66423`/`e2edde`). Formatting exited 0 (`7c00e6`, `0e5e94`).
Whole diff whitespace check exited 0 (`f91601`). The preceding pre-compaction
check's terminal receipt was unavailable; confirmed no check process remained
before the recorded new run. These are source/type development checks, not
formal Tester qualification or rendered/native acceptance.

Remaining: composed parent save/delete/repeat history and focus, metadata
transport/outbox recovery and unknown mutation outcomes, numeric measurement
intermediate drafts, real narrow/enlarged layout and modal interactions. No
visual batch, tests, native build, scan, freeze or delivery was run here.


### Mobile habits — 14 October

Full original `HabitsSheet.tsx` (485 lines), `useRun.ts` and SmallAction assessed;
inspected habit API result declarations and outbox perform/run wrappers.
Grouped routine rows replace repeated framed cards and ornamental FadeIn/layout
calls. Add habit is an optional disclosure; pending controls lock consistently,
period changes keep cadence within the selected period's accepted bound. Labels
are concise; row expansion is announced; cadence/actions and proposal values
wrap. Zero proposed blocks show the actual summary reasons, not an unsupported
claim that habits are on track. A plan can be dismissed. Delete moved to a menu
and explicit ActionSheet that preserves the future-session consequence.

Account/mount guards and an immediate operation mutex replace overlapping local
useRun actions. Server-confirmed create/update receipts update the local list
before another read can fail; queued entries remain identified and cannot be
sent using temporary IDs. Pending outbox state is visible; scheduling is disabled
while sync is pending. Existing outbox persistence/idempotency paths remain in
use. Habit wrappers now declare their existing Habit/void return contracts.

Development evidence: first mobile typecheck failed (`64567`/`d82c55`) on a
conflicting active identifier, optional HabitInput fields and duplicate disabled
prop. Corrected these with activeCount, a full draft/confirmed Habit receipt,
and a single prop. Subsequent mobile typecheck exited 0 (`97479`/`1a4326`).
Formatting exited 0 (`e563a4`, `37223d`, `f5850b`); diff check exited 0 (`2e045d`).
These are source/type development receipts, not formal tests or UI acceptance.

Remaining: sheet close/draft integration, repeated live outbox recovery and
unknown apply outcomes, narrowed/enlarged layout and actual modal/keyboard flow.
Full redesign remains active, not frozen; review is 0/3. No formal handoff,
visual batch, native build, security scan or merge was performed.


### Mobile overnight review — 14 October

Full original `OvernightSheet.tsx` (534 lines), confirmation helper and relevant
fresh-read/keep/undo/bulk API declarations assessed. Morning review now uses
grouped rows rather than repeated cards. Sources and token estimates are optional
details; approval text, questions, full summaries and review consequences stay
visible. Keep-change, Undo-work and whole-night choices use app-owned ActionSheet
prompts. Rare run Undo sits in its menu. Bulk decisions preserve decision tokens;
restricted/active/undone rows remain excluded as applicable.

Account/night keyed state, mounted/visible checks, immediate mutation lock and
read tickets prevent another account/night or pre-decision poll from replacing
current state. Polling pauses through writes. A confirmed decision followed by
failed reload reports the saved outcome with Refresh, while stale decisions
stay locked until fresh state arrives. Selection keys are filtered against the
current choices; deferred confirmations check the current decision signature.
Answer clearing checks the same question and typed value after a confirmed
response. Error reads expose Retry instead of an endless loader or false empty
state; refresh errors survive generic action-error dismissal.

Development evidence: mobile typecheck exited 0 (`84011`/`f2ebe0`,
`91426`/`9b4b07`); formatting exited 0 (`83a5e4`, `e94dc4`, `bb8733`).
Whitespace check exited 0 (`88c456`). Habits final typecheck also exited 0
(`23938`/`f819f2`) and its diff check exited 0 (`fbb38f`).

Remaining: unknown mutation outcome recovery, composed chat/page/review
handoffs, polling/runtime/native dismissal and final responsive/modal/keyboard
acceptance. No formal tests, visual batch, native build, freeze or merge here.
The full goal stays active and review remains 0/3.


### Editor parent receipt integration — 14 October

Re-read RootScreen editor close/save/delete paths, usePlanner mutation wrapper,
and API/outbox Item result contracts. Parent task state now merges the confirmed
Item (including its new revision), with an account check after the write; queued
writes keep the existing local-draft path. A failed planner refresh after a
confirmed save/delete names that saved/deleted outcome and asks for Refresh.
It no longer presents the refresh error as if the write itself failed.

Overnight final typecheck exited 0 (`11347`/`470598`). Root formatting exited 0
(`85969c`); final mobile typecheck exited 0 (`37621`/`e5f02f`) and diff check
exited 0 (`d261c5`). Composed editor history, repeat occurrence semantics,
unknown write outcomes and rendered interaction remain open. No formal freeze,
Tester/Reviewer handoff or visual batch has started.


### Mobile workspace navigation and focus — 14 October

Full BrowseScreen (361 original lines), TeamList (99), FocusScreen (790),
useFocusSession (321), useRun and relevant focus API/outbox paths read. Workspace
navigation uses compact groups and plain icons instead of repeated framed cards
and FadeIn wrappers. Full starred titles/hints wrap. The first eight starred or
pinned views have an explicit Show all/Show fewer control. Existing arrangement
identities and system permission hints remain intact. Team rows retain full names
and role, with member/item counts accurately named. Destination hints shortened.

Focus keeps notes optional and next-work/checklist grouped. Full task names remain
available, close reserves 44pt, and the timer ring measures available width and
scales with text instead of shrinking timer text. Custom interval fields validate
bounds explicitly. Task metadata has a Retry state; older detail reads cannot
replace a later confirmed checklist/time receipt. Completion queued in outbox is
announced as waiting for sync, not celebrated as confirmed completion.

FocusScreen is account/item keyed; mutation and leave mutexes own pending work.
The open timer retains its failed request, ID and time range until retry succeeds.
Failed interval logs likewise retain their request IDs/ranges. Expired phases
wait for explicit Retry after failure; retained receipts prevent repeating a
confirmed interval. End/leave waits for logging/owned current-focus clearing;
stepping away from an active interval preserves the shared running session.
Cross-device handoff stops local presentation/reminders without clearing the
other device's current session; late reads cannot replace manual rhythm/start.
Backend focus service source confirms IDs use ON CONFLICT DO NOTHING with owner
validation, and spent_minutes only increment for a fresh work receipt. This is
source evidence; no runtime duplicate-log check has been claimed.

Development receipts: Browse/TeamList mobile typecheck exited 0 (`48994`/`9bb14b`).
Initial Focus typecheck failed (`58664`/`655161`) on a local result shadowing the
boolean value; repaired with distinct result identity. Later mobile checks
exited 0 (`83555`/`d24572`, `68945`/`28e42a`, `8758`/`4786df`). Formatting exited 0 (`030f41`, `6c8604`, `b33e22`, `76f0c4`,
`3794f0`). Whitespace check exited 0 (`b4d09c`). No unit/runtime tests, native builds, scan or visual batch ran.

Remaining: composed destination/return focus, transport and shared-current-focus
ordering, mounted/app-kill durability, cross-device overlap and live timer
failure/phase-transition checks, measured/enlarged/narrow rendered interactions.
These source changes do not qualify the full goal; candidate is not frozen and
review remains 0/3.


### Scheduled summary and usage settings — 14 October

Full mobile AgendaPrivateSettings, ChatgptUsage, permission hook, web summary
counterpart and shared core enablement/status helper read. Inspected server
catalog capability/lease prerequisites; no desktop-kind condition is used in
that inspected binding. Replaced desktop-only helper/error wording with the
connected device, preserving actual capability and availability checks. Explicit
ChatGPT-plan use remains visible. Removed repeated model metadata; fallback
remains a separate state. Mobile uses the shared Switch. An immediate permission
write lock prevents rapid overlapping toggles. Recent usage rows are optional
Details while aggregate counts, missing measurements and ChatGPT-plan distinction
remain visible. Account/token and abort guards retained.

Core build exited 0 (`36882`/`91377b`). Mobile, desktop and backend typechecks
exited 0 (`44441`/`4e93c2`, `41753`/`75a4a4`, `64669`/`8f07e0`). Formatting
exited 0 (`6e1ff5`). The first old-copy lookup used a nonexistent backend/test
path (`62a8a7`, exit 2); a corrected scoped source lookup followed, not a test.
Corrected lookup (`2d3005`) found the existing status assertion; updated its
expected wording without adding or running tests. Diff check exited 0 (`ffa8a8`).
This is source/type evidence, not live scheduled availability or native proof.

Remaining: actual permission-version/reconnect/unknown-outcome recovery and
composed Settings density/keyboard/viewport acceptance. Full candidate remains
unfrozen, review 0/3 and no visual batch or delivery has started.


### Mobile page details and connections — 14 October

Full original PageInfo (546 lines), ConnectionsMap (254), PageTags (289) and
OriginalFile (191) read. Supporting BottomSheet, AliasesField, DocNavigationContext,
core connection layout and the relevant document/file API contracts assessed.
Only openObject and downloadFile slices were used from the larger links/RichBlocks
modules; the truncated links read is not a new whole-file coverage claim. Initial
assumed links.ts/ProjectsSheet/DocSheet/doc-navigation.tsx paths were missing;
corrected with rg --files and current owning call sites.

Page details keep Mode, sharing/project scope and Tags visible; aliases, files,
sources, fields, history, freshness and mode help are optional named details.
Facts are account/page/version bound, with local read Retry. Mode choices no
longer repeat their heading. Full file names/source metadata wrap; quoted source
text is revealable in full. File retention is optional help; permanent deletion
and source-removal consequences remain on explicit app-owned confirmation sheets.

Connection failures no longer look like no links. Each query owns its depth and
revision result; Retry is local. The diagram fits measured width and is optional;
real neighbour rows reserve 44pt and reveal all titles. The first eight neighbours
have Show all/Show fewer. Person/date facts no longer advertise an opening action
that does nothing. Connections use the page navigation context when present;
PageInfo destinations/history/contents run after the details sheet closes.

Tag selection now uses searchable checkbox rows rather than a large chip bank.
Account/page/space keys, mounted/request guards and an immediate permission/write
mutex protect results. New-name input survives failure; confirmed additions clear
only the matching typed value before reloading the catalogue. The trigger/input
use actual 44pt targets. File/source/alias/tag/original work contributes to the
parent's immediate pending counter; cleanup releases locks even if a dependent
section disappears. File metadata/read errors remain separate from mutation or
download failures. A confirmed deletion removes its row before quota refresh.
Original downloads check ownership and file identity before save; delayed original
delete confirmations check the same original identity. Import preference uses
account guards and the actual confirmed keep value, with rollback on failure.

Development evidence: mobile typechecks exited 0 (`30543`/`3597e4`,
`67978`/`2c8d22`, `86153`/`a09dae`, `48797`/`519974`, `34804`/`12595d`,
`71417`/`3ce9ae`, `61563`/`d547e9`, `68962`/`ac5e17`).
Formatting exited 0 (`cf809d`, `19cee7`, `657410`, `da503d`, `807840`,
`46f3c6`, `e36420`, `35583e`). Diff whitespace checks exited 0 (`9f800d`,
`919e56`, `1ca0f0`, `07cfe1`). No formal tests, visual batch, native build, scan, freeze,
review handoff or merge was performed.

Remaining: composed page draft/history/fields/freshness lifetimes, nested tag-sheet
modal focus, downloads/native sharing, unknown deletion outcomes, metadata
failure/authority recovery and final narrow/enlarged/long-content rendering.
The full redesign goal remains active and review is 0/3.


### Web item editing and shared choices — 14 October

Full original ItemEditor (997 lines), LinksField (104), WaitsOnPicker (95),
EventFields (305), TagPicker and event-fields stylesheet assessed. Supporting
modal focus, Select, DateField, planning contexts, API return contracts and the
specific App editor-save/delete paths inspected. Large first read output was
truncated; missing ItemEditor ranges were re-read before this coverage claim.
Other App/DateField/ScopeDialog integration is not blanket whole-shell acceptance.

Editor uses an account/item/occurrence key, frozen initial field state, owned
modal keyboard handling and instance IDs. Core timing/sharing remains visible;
optional details remain mounted behind a disclosure. Notes are bounded and
nonresizable, rows reflow against actual modal width, and footer actions stay
reachable. Delete sits behind the item-options control. Closing asks to discard
unsaved fields, including unfinished links/invitees/alerts/tag names. Save names
unfinished entries instead of silently omitting them. Title and whole estimate
values validate; custom alert text reports bounds rather than silently clamping.
Selected links retain full title/address and reject duplicate addresses. Tags,
lists, assignees and dependencies are searchable with current IDs preserved.

Agent/tag/save/delete/confirmation work has immediate ownership/mutation guards;
metadata errors expose Retry, including read-only views. Known edited invitee/link
lists survive metadata refresh. Unknown default alerts display loading or Retry,
not a guessed default as if verified. Confirmed tag creation remains created if
catalog refresh fails. Sharing and immediate assistant assignment consequences
remain visible. Assignment receipts advance the parent item revision without
remounting its unsaved fields. Parent save/delete now return their actual action
promise; a failed separate status write retains the fields and saved revision,
while a failed refresh reports the already-confirmed saved/deleted outcome.

Floating Select and date choices obey disabled surrounding fieldsets and stop
emitting changes after lock. Date month navigation maintains a bounded active day;
time lists expose one Tab stop with arrow/Home/End navigation, and invalid zero
steps cannot create an infinite option loop. No rendered/calendar semantic claim
has been made from this source work.

Development evidence: initial desktop typecheck failed (`77925`/`3db3a4`) on an
unsafe form-event target cast; fixed with actual input/textarea instance checks.
Checks then exited 0 (`63998`/`b06ce8`, `9567`/`166c2c`). Parent integration attempt
failed (`29441`/`0c582c`) on missing session/error helper imports; repaired imports
and added assignment receipt ownership. Subsequent checks exited 0
(`93546`/`a1087a`, `93905`/`0b6473`, `86871`/`db87f1`). Formatting exited 0 (`7d7c19`, `b3a200`, `3a9c88`, `5e38e5`,
`b6b440`, `0480f2`, `2e0e94`). Diff checks exited 0 (`66c7d5`, `e1d7a7`, `1467d2`, `f239d1`).
No formal tests, native build, visual batch, scan, freeze or merge were run.

Remaining: status/occurrence partial and unknown outcomes, full parent editor
lifetime integration, picker grid semantics/min/max time recovery, catalog refresh
failures, and actual modal focus/keyboard/narrow/enlarged/long-content rendering.
Whole redesign goal remains active; review is still 0/3.


### Web task rows, file selection and proposal controls — 14 October

Full original FilePicker (106 lines), DraftNotes (86), ItemRow (236), PlanCard
(277) and tasks-w3 stylesheet read. Inspected scoped assistant/planning/global
CSS, ProposalReview and PlannerPanel call sites, docPreview/API creation and the
server/client idempotency hook registration. The larger Look read was truncated;
its complete editor assessment remains open and is not included in this claim.
An assumed backend http glob/ai.ts path was absent; current docs routes,
idempotency library and services/http.ts supplied the relevant source evidence.

File selection is account/mount and inherited-disabled aware. Multi-file drops
report Choose one file rather than silently dropping the rest. The native input
is named; a controlled filename only advertises Clear when its owner provides
that action. Task rows omit ornamental entrance/tick pop and long note excerpts,
retain full title/scope/timing plus the detail route, and wrap titles/metadata.
Read-only items cannot use manual reorder arrows. Fold/reorder coarse targets
have actual layout room; the existing coarse checkbox is already 44pt.

Proposed schedules have Show all/Show fewer per day rather than counts with no
route to the hidden sessions. Move/risk/unplaced information stays visible;
there is one caret because the stylesheet intentionally hides the native marker.
Apply has an immediate account/plan operation lock and owned outcome state;
calendar navigation uses the applied receipt's first instant. Shared request
controls prevent navigation/tuning through pending Apply.

Draft notes bind receipt/request state to account, proposal and exact draft
content/index. A confirmed creation is kept before navigation; failed creation
and failed opening show distinct local outcomes. Retry reuses an in-mount UUID
Idempotency-Key. Client once captures the key before awaiting and the ordinary
HTTP service registers the write replay hook; this is source evidence, not a
live duplicate-create measurement. Team destination names are read before Keep,
with local Retry on failure. Full text and rationale are optional disclosures;
plain text does not claim rich-format/file rendering. Kept notes without an open
callback show a saved status instead of a dead Open control. Assistant draft
rows use grouped separators rather than repeated filled cards. Added these
unfinished-entry/receipt/full-preview rules to the existing UI skill guide.

Development receipts: desktop typechecks exited 0 (`50246`/`35c093`,
`82699`/`18fb75`). Formatting exited 0 (`ab8619`, `07a86b`). Whole diff whitespace
check exited 0 (`3ef93b`). No formal test, native build, visual batch, scan,
freeze, review handoff or merge was performed. Review remains 0/3.

Remaining: durable kept-note state across remount/reauth, caller Apply versus
refresh failures and unknown write outcomes, mobile parity for the new destination
and receipt behavior, actual rich draft presentation, and finite final
modal/keyboard/long-value/viewport rendering. Full redesign goal remains active.


### Web appearance editor — 14 October

Full original Look.tsx (438 lines) and look.css (159) read, with the specific
DocEditor/ProjectDetail/Home callbacks, modal-layer helper, file schema and
mobile appearance direction inspected. Replaced simultaneous emoji/icon banks
with Emoji, Icons and Custom categories. Stored pictures are a searchable
optional catalogue; full picture/page captions remain readable. Choice grids
reserve 44pt; catalogues scroll within bounded heights. Context names the actual
page/project/hub; header/actions reflow with the modal width. Appearance uses a
native portal dialog above the Hub editor's native dialog, rather than a normal
sibling overlay below its top layer. This is source integration, not a rendered
layering or keyboard acceptance claim.

Cover receipts are bound to file and account before display. The appearance
controller is keyed to account and object, with owned reads, a read ticket and
immediate upload/save/close locks. Local metadata errors have Retry. File schema
checks precede allocation/upload; confirmed uploads set the selected cover and
survive a later catalogue read failure. The UI states that uploaded pictures
remain in the page library. Discard confirms changed appearance. Custom emoji
is validated/included on Save in its category; staged text in another category
must be used or cleared, not silently omitted. Rare removal actions are disclosed
and absent when there is nothing to remove. Failed writes retain choices and
local errors. Project save rejects missing permission or an overlapping change;
page/project callbacks check account/object ownership after the response.

Development receipts: first edit script failed parsing (`b00e51`, exit 1) before
writing files; the subsequent unchanged-source formatting/typecheck passed
(`0f41ae`, `89709`/`7e8679`) and is not evidence for the new editor. The rewritten
editor typecheck exited 0 (`16313`/`b1628f`), then styled/callback version exited 0
(`72201`/`3b984e`). A later conditional removal section missed its closing JSX
brace: formatter failed (`9b099b`, exit 2), and types failed (`92579`/`c14134`,
exit 2). Corrected it; formatting exited 0 (`2791da`), and types exited 0
(`10830`/`d87660`). Native-dialog version types exited 0 (`24778`/`50694d`).
Other formatting exited 0 (`4c4dba`, `d91a5e`, `dac1d8`); diff check exited 0
(`79c24a`, `834bdc`). No formal tests, native build, visual batch, scan, freeze or merge.

Remaining: actual nested Hub/appearance/confirmation focus and cancellation,
external parent handoffs, upload allocation cleanup/unknown outcomes, Undo scope,
peer catalogue/cover rendering, and final narrow/enlarged/long-name acceptance.
Full redesign remains active and unfrozen; review is 0/3.


### Web repeat and shortcut controls — 14 October

Full DayPicker (37 original lines), RepeatPicker (141), ShortcutSheet (169),
command re-export module and isTyping helper read. Inspected repeat draft/
serialization helpers, core interval/count parser bounds and scoped shortcut
styles. The canonical command definition/dispatch is not implied fully assessed
by reading its re-export module. An assumed rrule.ts path was absent; current
recurrence/time modules supplied the parser evidence.

Shortcut help now opens as an owned native dialog with an instance title ID and
modal-layer declaration. Search matches labels, sections and key chords; the
section selector defaults to Anywhere with an explicit All shortcuts route.
Actual customized shortcut keys still come from the canonical command catalogue.
Full labels/chords wrap, and the standard modal focus hook replaces the old trap
that allowed Tab only on Close. Question-mark closing pauses while typing and
when another dialog owns interaction. Concise labels retain all key entries.

Repeat inputs keep their typed values and report whole-number bounds supported
by the current parser, rather than silently replacing a cleared value with 1.
Invalid repeat input blocks ItemEditor Save and participates in the discard
state. The final selected weekly day is visibly disabled instead of silently
ignoring its toggle. Untouched saved rules and their full descriptions are
preserved when unrelated item fields change; edits to complex monthly rule
patterns remain a separate integration concern. DayPicker retains its existing
selection/empty-day semantics with full accessible day names and optional locks.

Development receipts: initial shortcut refactor retained a fragment of its old
cleanup effect; formatter failed (`ea0e3d`, exit 2), and types failed
(`85244`/`d4b61c`, exit 2). Removed that obsolete fragment; formatting exited 0
(`55cf9b`) and types exited 0 (`98929`/`228f83`). Investigation confirmed Select
and Popover already use a native-dialog portal host. An attempted redundant
replacement asserted and made no edit (`2b4f70`, exit 1); unchanged Select
formatting/types exited 0 (`c1cad0`, `24188`/`79b694`). No new Select placement
fix is claimed. Final shortcut modal declaration types exited 0
(`67041`/`e8df71`); saved-rule preservation version types exited 0
(`12399`/`105b2d`). Formatting exited 0 (`404295`, `f77e14`); whole diff check
exited 0 (`a30355`). No formal tests, visual batch, native build, scan or merge.

Remaining: actual native web modal/select focus, configured-key dispatch,
repeat/occurrence/date boundary composition, complex recurrence edits and
narrow/enlarged keyboard/render acceptance. Full redesign remains active;
no frozen candidate or role handoff yet, and review is 0/3.


### Mobile diagrams and theme backbone — 14 October

Read mobile DiagramSurface native/web, MermaidDiagram, ThemeContext and live
semantic styles. Macro's recorded width/priority guidance is already in ADR 003;
no duplicate research assignment or imported reference source. The diagram title
and Source remain visible; zoom/fit/actual-size/export move to a named disclosure.
Targets reserve 44pt, zoom boundaries disable their controls, timeout offers Retry,
and source scrolls within a bounded region in both directions. Renderer request identity
owns preview/export results; export has an immediate duplicate-action lock and
late-result guard. Presentation state persists across source edits. Local renderer isolation/message-source checks are retained.
Theme live tokens need no structural replacement based on this source pass.

Development: first diagram formatting exited 0 (`6c4532`); mobile TypeScript
exited 0 (`534f70`/`fdc4fa`); whole diff check exited 0 (`82fa84`). Final bounded source-scroll formatting/type refinement exited 0 (`4d9b8f`/`c24355`). No unit/runtime
tests or visual checks executed. Remaining: actual nested source scrolling,
iframe/WebView resize/pan/timeout, theme changes, export/share behavior and
long/enlarged labels. These source reads do not establish rendered/native
acceptance. Candidate remains unfrozen; review 0/3; no merge.


### Macro follow-through, source preview and deep links — 14 October

Authorized GPT-6.1 Sol low-effort subagent returned four specific source risks;
its supplemental findings are recorded in the Macro report. ADR 003 now includes
constrained source switching and stable presentation state. The original Macro
architecture investigation was already incorporated; no reference code imported.

Source preview measures its dialog's actual width (including text-size threshold)
and window height. Constrained Split shows Source, retaining requested Split
for wider space; choosing Source/Preview explicitly updates that preference.
Both editing buffers remain mounted. Closing stays in the sticky header;
controls wrap and inner source/preview scrolling is contained. Invalid source
blocks switching editing modes until corrected/restored. Whole source dialog
and its CSS were read. Full short-window scroll/focus composition remains open.

Deep-link block retries now require the active navigation request/account,
ignore hidden/inert/non-rendered matches, and honor reduced-motion scrolling.
The highlight transition respects reduced motion. Concept icons, local font
configuration and PlannedContext were read without unnecessary visual edits.
Mobile diagrams no longer remount by full source text, retaining zoom/disclosure;
all optional pan actions now share Diagram controls. Export errors from older
render requests are ignored. Rendered pan-position retention is not claimed.

Development: original deep-link formatting/types exited 0 (`0c6e6d`/`cdb758`);
first source-preview formatting/types exited 0 (`a0f302`/`bd9c7c`). Responsive
follow-through formatting exited 0 (`70ef94`); desktop types exited 0
(`314530`), mobile types exited 0 (`2c177b`/`e9f2d0`). Whole diff check exited 0
(`8b9a46`). Final export-error reset formatting/types exited 0
(`6d6273`/`9c45a3`); final whole diff check exited 0 (`843603`). No tests/visual
checks/native builds/security scans. Unfrozen, review 0/3, unmerged. Remaining
whole-product integration and acceptance gates retain their existing scope.


### Integrated projects, publishing, tasks and settings — 15 October

Previous turn made source/doc changes and development evidence: progress. This
turn continues the full scope, with no early Visual Check, formal handoff or merge.

Full source read for desktop NewProjectDialog, ProjectsView, PublishDialog,
TasksView, AdminView; mobile PublishSheet, ShareIntoSheet, VerifyGateScreen,
AdminSheet and AiProviderChoice; full desktop focus stylesheet. Settings actions,
notification feedback, imports and passkeys were inspected; remaining Settings
source assessment stays open. No broad completion claim from partial reads.

Project creation now uses the shared modal focus owner, guarded dismissal,
optional stage controls, unfinished-stage validation, pending-field locks and
account/lifetime checks. Same-input retries reuse a request key; confirmed project
receipts remain before navigation. Source inspection of HTTP middleware and
idempotency implementation confirms the header contract; no runtime replay proof.
Project collection reads retain data and report Retry instead of false emptiness;
late project opens cannot replace the latest navigation request.

Folder publishing has owned read recovery, draft discard guards and serialized
actions; fields lock during writes. Unpublish/password removal use owned
confirmation; native/mobile rare management is in Publishing options. Public
access consequences remain visible. Team publishing read failures have local
Retry and toggle writes serialize. Existing page-publication flow is preserved.

Task filters have pane-unique IDs. Grouping/agent-review read failures remain
visible with Retry; unknown review counts display unavailable, not zero. Manual
reordering checks permission, serializes writes and distinguishes confirmed order
from failed refresh. The existing sweep/pins/authority contracts are retained.

Share captures bind to account/shared input, keep stable request IDs and confirmed
receipts before opening destinations, and isolate recent destinations by user ID.
No secret is written as a storage key. Pages/folders/projects have searchable
choices, Show all routes, full space labels and a complete content disclosure.
Search failure differs from empty results; choices/dismissal lock while saving.
Verification content appears immediately without entrance animation; resend has
a local lock and accurate sending feedback.

Admin navigation falls back to an available permitted section. Overview/teams
distinguish loading/error/empty, optional guidance replaces the marketing card,
and list motion is removed. Mobile accounts have owned writes, local Retry and
a path beyond the first 100 results; deletion and passkey removal use app-owned
ActionSheets. Mobile Settings serializes operations at entry and keys lifetime to
the account/session. Push success is inline in Notifications instead of Alert.
Provider controls use the shared Switch with named fallback and distinct load/save.

Development evidence: desktop project/publishing formatting/type receipts
`43aa26`, `f68d6d`/`c28b81`, `125cb4`/`eca933`, `a4d2d6`/`7c99f8`; project list
`85acba`/`405140`; task source `8c265f`/`95ecea`; admin shell `8812c9`/`0ec627`.
Mobile publishing/share/verify receipts: `b2eb73`/`632fe6`, `640207`/`6046a3`,
`a57b87`/`2bd62d`, `ce72fd`/`78ba9a`, `f71a31`/`b397b7`. First mobile publishing
menu rewrite failed before mutation (`fa1652`); unchanged typecheck exited 0
(`caf6fa`), not evidence for that failed attempted edit. Admin rewrite retained
an obsolete cleanup fragment: formatter/type failed (`4c18e4`/`c6df83`, exit 2),
then removal/types exited 0 (`508b1a`/`8d1f0e`). Pagination types exited 0
(`513300`/`d96e3c`). Settings initially duplicated disabled prop, types failed
(`2a544f`/`c80553`, exit 2); corrected receipt follows. These are development
checks, not formal tests or rendered/native acceptance.

Owner reported no apparent changes in 5174. Listener cwd checked: Vite, API and
Expo are in this worktree, not primary. Direct Vite module responses return 200
and include latest project/admin/source changes (`8e215f`, `1e5fb0`, `94ee59`).
This verifies source serving, not the owner's current browser pixels.


### Primary workspace header — 15 October

In response to the owner's preview concern, combined working tabs into the
primary Topbar rather than keeping the duplicate full-width strip below it.
Secondary panes retain their own strip/controller and one shared navigation
owner. Header action labels/date condense from measured header width; search
and notifications stay reachable. Tabs remain bounded and horizontally scroll,
with unchanged IDs, pin/close/split actions and panel relationships. Brand text
and mark use explicit aligned geometry. ADR 003 records this composition.

Formatting/desktop types exited 0 (`8013c3`/`1d0dee`). Direct Vite responses for
Topbar/App/workspace CSS return 200 and contain these changes (`27d4c7`); diff
check in that command exited 0. This is current source/runtime-serving evidence,
not pixels, HMR acceptance or keyboard/focus qualification. Corrected Settings
duplicate-prop types exited 0 (`97c8aa`/`56869a`). Old terminal handles queried
after previously delivered terminal results reported missing; they were not
restarted and no ongoing wait/completion is inferred from those errors.

Remain unfrozen, review 0/3. Required final interaction/render batch includes
primary and secondary headers, retained tab/draft state, constrained actions and
narrow fallback. No formal tests, native builds, security scan or merge.


Follow-through receipts: final desktop publishing formatting/types exited 0
(`ea8325`/`8b1c42`), mobile share/settings/admin types and diff check exited 0
(`aba098`/`1ff661`). Push enable/disable now recheck the initiating session after
permission/token reads and before API/local registration changes; native storage
and permission-flow runtime qualification remains untested. Stage Tracker was
asked to reconcile the full current implementation versus acceptance checklist;
no Visual Check was started. Goal work remains active.


Final push-session guard development types exited 0 (`ddc80f`/`907ddc`);
whole diff check exited 0 (`bdd521`). Stage Tracker confirms the complete
implementation/acceptance gates remain open, with source inventory and pane/editor
integration to finish. The owner's current 5174 discrepancy warrants one bounded
Visual Check diagnostic capture; this is not the final full web/Expo batch, which
remains after complete source freeze. Preserve drafts and existing tool restrictions.


Preview diagnosis follow-up: Visual Check found only ChatGPT in its available
internal-browser session and captured no Orbyn pixels. No current tool rejection
was reported; it was explicitly authorized to open the exact 5174 URL in that
same browser, without changing port/browser or bypassing a current restriction.
This is not a product failure, visual pass or final-batch completion.


### Bounded preview diagnosis result — 15 October

Visual Check opened exact 5174/app in its same internal browser and reported a
Docs route with the current workspace CSS and an integrated working tab in
Topbar. At reported header width 1080px it measured height 56px, horizontal
padding 16px and static TabStrip position; measured-width compact mode was off,
consistent with the 700px source threshold. It reported the Vite dev client and
active workspace/Docs styles, with no observed stale-page/CSS-override symptom.
Screenshot was emitted inline in Visual Check's turn
`01a13ccf-40c7-7443-b20d-703892075ccd`; no local path was returned. Parent did
not personally inspect those pixels. This delegated, bounded evidence verifies
current header/source styling at that route only; it cannot compare an earlier
build or qualify the complete redesign. Final web/Expo batch remains pending.

Based on Macro's remaining scroll-composition finding, source preview now uses
a bounded flex dialog with persistent title/Close, a capped independently
scrollable tool region and one editor region using the remaining height. Compact
Source/Preview switching still preserves requested Split preference, mode and
buffers. Rendering, focus, nested selectors and short-window task-space
qualification remain required. No formal handoff/freeze/merge has occurred.


Source-preview remaining-height layout formatting/types exited 0
(`10f541`/`5b989a`); diff check exited 0 (`4619ee`). Mobile Settings session
collection now searches and exposes Show all beyond six records; six-digit
authenticator input has an explicit exact-code gate. Types exited 0
(`95b920`/`a74e6d`). Further settings density changes remove decorative icon
frames, preserve real 44pt targets and replace expanded search hitSlop with a
separate nonoverlapping target. Reading helpers are brief; scheduled-time
analytics retains minute precision and names scheduled time rather than implied
recorded focus. Source compilation checks are not formal rendered acceptance.
Remaining Settings source/range reconciliation and full redesign gates stay open.


### Mobile project workspace integration — 15 October

Previous goal turn changed source and produced preview/type evidence: progress.
Current worktree/branch revalidated. The mobile project library and creation flow
now use grouped rows, one primary creation action plus an options menu, a focused
New project screen and a searchable project-space choice. Creation does not share
the screen with the whole library. Inputs lock during owned operations; repeated
create attempts for identical input use a stable request key. Confirmed creation
opens its receipt before follow-up list refresh. Failed reads preserve last data
and a reachable Retry instead of hiding the draft or claiming an empty library.

Project shell lifetime is keyed to the account/session. A mounted/visible owner
and immediate operation lock protect entry, departure and response adoption.
Related sessions/pages/records/links have project-owned state, so a new project
view cannot show the previous project's resources while effects settle. Initial
navigation responses yield to later navigation/actions. Search gives loading,
ready and failure/Retry states; failure is not No matches.

Draft-aware Close/Back/Cancel uses an owned Discard sheet, with native dismissal
guarded while edits or writes are pending. Project destructive/sharing prompts
use owned ActionSheet instead of platform alert. Stage/summary drafts clear only
after a matching successful receipt. Added links are retained before refresh;
failed refresh names Link saved. Summary renders once in Brief, and infrequent
timing/space details move to Project details with readable full values. Existing
project chat/history/sweep, permissions and review boundaries remain in scope.

Read creation, library/read/search and stage/link mutation source plus selected
detail regions; the large file's remaining detail ranges still require assessment
and integrated qualification. No full-source or full-render claim. Development
formatting/mobile types exited 0 (`5c29dd`/`73be57`, `28dbfb`/`b21dc8`). Later
resource/draft/query refinement has a pending type receipt. No formal tests,
visual batch, native build, scan, freeze, review round or merge.


Mobile project follow-through: normal links, task opens, planner and project-chat
handoffs participate in the draft departure guard; confirmed write handoffs have
an explicit receipt path. Related reads now distinguish loading/ready/failure
with scoped Retry for planning, sessions, pages/files/links and history. Timeline
empty states wait for an actual read; project search failure keeps its query.
Created pages enter the local resource list before follow-up reads. Brief
creation retains its confirmed page receipt across failed attachment attempts;
normal new-page attempts retire their request key after a confirmed creation.
Ownership checks precede later service calls/response adoption in these flows.
Runtime uncertain-write, attachment and external navigation behavior still needs
formal qualification; none is claimed from source checks.

Development formatting/types exited 0: resource/draft/query source
`8fea7f`/`7d708f`; guarded handoffs `1d4e42`/`98310e`; read-phase source
`8de797`/`e561df`; follow-up response guards `57ee34`/`4b3c77`. Final
brief-receipt source formatting/types exited 0 (`a2d836`/`daff4e`); final whole
diff check exited 0 (`884051`). Diff checking and the skill metadata check are separate
from product acceptance.

Applied skill-creator guidance to a narrow edit in the existing UI skill's UX
reference: guard external editor departures and bind related resources to their
content owner. Python quick_validate failed in both host and bundled Python
because PyYAML is absent (`5d8592`, `6d6443`). No dependency installed. Existing
Node YAML parsing confirmed unchanged frontmatter and the reference additions
(`110398`, exit 0); this is a limited document check, not a claim that the Python
validator ran successfully or that product behavior was qualified.

Complete source coverage, shell/document integration and final Test → Review →
bounded web/Expo acceptance remain open. No freeze, review round, merge or push.


### Mobile document library and departure integration — 15 October

Authoritative source remains the c6-next worktree on codex/c6-file-viewer,
baseline c7b3bdb7 plus accumulated uncommitted redesign. Port 5174 listener
92672 has its cwd in that worktree's desktop; its current Topbar module returns
the workspace header source. This confirms source provenance, not rendered
acceptance of the full redesign.

DocsSheet now keys its body to the current account. Editor departure is serialized
and checks its account, visible owner and page identity after settling edits.
Page opens, agenda-day changes, project handoffs, search pull-down and Show in
library use that guard. Initial agenda reads cannot overwrite a later deliberate
page navigation. Metadata actions have an immediate write mutex. Agenda rewrite
uses an owned ActionSheet, settles edits first, rechecks permission/today, prevents
concurrent departure, and refuses to adopt another day's returned page. Notes
and end-of-day preservation remains explicit at confirmation. Destructive
library confirmations use owned sheets rather than platform alerts.

Library creation has one primary action with New note / Use template / Import
file in a menu. Folders remain reachable through the library browser instead of
a chip for every folder. Document results use grouped separator rows; tree and
agenda controls allocate touch targets without overlapping hitSlop. Wider library
splits account for font scale. Failed refresh retains loaded pages with local
Retry; offline cache/outbox behavior remains in scope.

Read the owning shell/navigation/creation/rewrite/library source and selected
related ranges. This is not a full-source assessment of the large DocsSheet, nor
a rendered or runtime qualification. Remaining source ranges, document-mode
integration, draft/save/uncertain-write behavior and final web/Expo interactions
remain open. No freeze, formal test, review round, security scan, native build,
merge or push in this batch.

Development checks: changed-file Prettier completed with exit 0 (`349f1e`);
`npm run typecheck -w mobile` completed with exit 0 (`a09dbf` / `79067d`).
Whole-diff whitespace check before the report update exited 0 (`f7feb0`).
These are development/source checks, not formal interaction or acceptance evidence.


### Booking readability and calendar state integration — 15 October

Read the complete booking stylesheet and its hours/question markup. Booking
status and helper text no longer uses 11px labels. Guest questions use separator
groups with narrow action reflow; detail labels/values stack on narrow screens.
Choice labels, color controls and help disclosures allocate touch targets. Danger
controls use theme tokens. Page-specific booking accents and full guest content
are preserved. Existing public/editor CSS needs the final rendered batch; source
inspection does not qualify density, contrast or actual input/overlay behavior.

Calendar source and menu/mutation paths were inspected, with a range/account
receipt in useCalendarData and the date-field overlay. Neither exposes another
range's records while its effects settle. The calendar body resets at account
changes. Calendar time/item and frame-skip actions use an immediate serial gate and
visible saving feedback; item completion and entry moves recheck permissions. Undo clicked during the
write refresh waits for the write gate. Confirmed completion versions prevent
old rows offering another completion while refresh settles. Background task
refresh errors remain reported. Date headings wrap, and calendar-set choices
show names without redundant shortcut numbers; keyboard shortcuts remain.

Development edit attempt `67e265` failed JavaScript parsing before writing any
file (Python-style quote delimiter in the edit script). The corrected AST/text
edit completed in `d845e2`; no partial edit from the failed attempt is claimed.
Formatter/typecheck receipts: booking/data `969fb0` / `593332`; calendar
`124a24` / `f5a5eb`, toolbar `6e78f7` / `310905`, Undo `8c9d9c` / `63009a`.
Final completion-receipt source formatting/types exited 0 (`916d4f` / `2f5442`).
Whole-diff whitespace checking exited 0 (`1dfe7f`). These are development
checks, not formal tests.

Calendar planner/dialog concurrency, recurring completion, optimistic-write
recovery, account/range switching, queued Undo and actual narrow guest/editor
layouts remain required in integrated qualification. No final visual batch,
freeze, review round, native build, security scan, merge or push. Full redesign
scope remains active.


### Proposal review and mobile drafted-note parity — 15 October

Both proposal components now reset local choices with proposal/account identity.
Sources use a named count disclosure; approval diffs and destructive effects stay
visible. Notes have complete before/after text behind named disclosure, bounded
scrolling and keyboard reachability. The project deadline switch is disabled
while pending. Mobile session changes include both start and end times; reminder
previews include every configured alert and the legacy single-reminder path.
Mobile reply actions/status/suggestions no longer use entrance or press-scale
motion, and operation/source labels use readable text roles. Summary tables adapt
to measured pane width and font scale rather than a fixed column-count cutoff.

Read the proposal components through bounded ranges and their shared callers,
styles and item schema. Optional item-field parity (beyond existing diffs),
recipient identity and complete integrated proposal/editor qualification remain
open. These source changes do not establish all proposal contracts or rendering.

Mobile DraftNotes was still missing the web component's recovery behavior. Its
body now keys by account/proposal scope. A note's content/destination/row identity
owns its in-mount idempotency key, receipt and local error. It resolves team names
with a scoped Retry before offering a shared write. A confirmed page receipt is
retained before navigation; failed navigation offers Open note. Successful
receipts survive an in-mount draft replacement without opening the wrong draft.
Web receipt adoption received the same late-draft fix. These are in-mount
guarantees; durable recovery after remount is still unproven. Full plain-text
read access remains; no rich-format/native acceptance claim.

The existing UX skill now explicitly keeps approval consequences visible, full
before/after text accessible, bounded scrolling keyboard reachable, pending
choices fixed and receipts retained before navigation. This is a narrow rule
update with no skill metadata or dependency change.

Development format/type receipts: proposal/draft source `1aecc1`, notes/disclosure
`ff8f8b`, client checks `6fcab2` / `bfe887` and `0ce0c2` / `753fc3`. Final
receipt/reminder source checks exited 0 (`b4e3fc` / `a513ea`, `bab375` / `02da51`).
Keyboard access/skill refinement checks exited 0 (`2ed210` / `7ca9ef`,
`7bfff2` / `8ca45a`); whole-diff whitespace check exited 0 (`72098c`).
No formal tests, final visual batch, native builds, security scans, freeze, review
round, merge or push. Full redesign scope remains active.


### Team workspace source reconciliation — 15 October

Read the complete TeamsView/TeamDetail and TeamsSheet/TeamDetailPage source plus
shared modal, member controls, service signatures and relevant styles/callers.
Web and mobile creation now live in focused editors. Their account-owned
creation receipt appears before refresh, and retries keep the in-mount request
key. The receipt is retired after it appears in the refreshed list; terminal
team deletion/leave clears its local fallback. Narrow web detail hides the full
team library above it. Library counts and quiet empty states remove repetition.

Rename uses a focused owned editor and retains failed input. Read failures have
Retry instead of an indefinite loading caption. Mobile destructive/self-role
confirmation uses ActionSheet, with explicit shared-access/destructive effects.
Team reads/writes have account/lifetime/request gates; web delayed confirmation
rechecks its owner. Member-name/email search is available for larger teams,
with a counted Show all route beyond the initial 25 rows. Mobile member/item
entrance and layout animations were removed. Name and member drafts participate
in the Teams/Admin mobile departure path and ordinary item/change handoffs;
inputs/role choices are locked during writes and clear only matching confirmed
member fields. Child feature editors and broader web departure integration still
need reconciliation and integrated qualification.

The member-filter refinement edit `879efc` failed a source marker after writing
the desktop refinement; its mobile edit was not written. Source inspection
`cf79cd` established that boundary; corrected mobile edit `15fa99` completed.
This was an edit-script failure, not a product/test failure.

Development formatting/types exited 0 for initial mobile detail (`7dfeca` /
`90aa44`), terminal/rename fix (`93fe88` / `093192`), Teams/Admin handoff
(`638e2a` / `077640`), web detail (`bfab0e` / `88d50e`), account/narrow
refinement (`732a64` / `8699c8`), member refinement (`d2c0ca` / `1202fb`,
`2260b9` / `199fad`), corrected mobile filter (`15fa99` / `7217ae`,
`6bb8ba` / `f801f9`) and quiet library (`e20270` / `85e448`).
Final matching-field checks exited 0 (`227420` / `846ba1` web and
`6c36bc` / `38774e` mobile). Whole-diff whitespace checking exited 0
(`8a25cf`).

No formal tests, final visual batch, native builds, security scans, freeze, review
round, merge or push. Complete shell/document/remaining caller reconciliation,
then frozen-candidate qualification, remain open. Full redesign goal is active.


### Pane departure and structured document integration — 15 October

Stage Tracker reconciled the finite ADR 003 closeout list: shell/paired workspace;
remaining editor/DocsSheet/ProjectsSheet ranges and callers; Views queue; Settings
action/connection parity; Activity/calendar/booking/runtime integration; final
source coverage, then one frozen Test → Review → bounded web/Expo candidate.
The full scope and native/scan/deployment exclusions remain intact. No partial
qualification or visual sweep was dispatched.

Shell tab transitions now consult the pane's registered draft guards for every
destination, not only PAGE_VIEWS. A declined departure leaves the view in place
without adding an alarm for ordinary cancellation. Web team name/member/creation
drafts register with the existing pane registry; team selection and New team
preparation use it. Invitation fields are controlled and clear only a matching
confirmed receipt. These source changes still need paired-pane/focus/tab proof.

Read the structured mobile editor through bounded ranges and its parent, comment
and persistence callers. Short-window source input no longer has a minimum
height larger than its pane, and repeated inner page padding was removed. Source
links use the editor's save-aware route, and open maintenance/publication editors
prevent outer departure. Fragment callbacks and save adoption check their page
lifetime/account. An offline receipt is applied only to its originating account
and unchanged draft generation after both outbox and cache persistence.

Outbox/cache clears now serialize against storage writes, invalidate old load
generations, and hold new reads until clear completion. Durable cache receipt
returns an explicit success boolean; ordinary cache mutations reject a stale
account/clear generation. This does not prove the entire queue's account teardown
or native storage runtime, and no security scan was run.

A page-owned comment draft registry covers page-level and anchored composers.
Page departure settles the editor, then asks before discarding unsent comments.
Inline thread/selection transitions consult only affected block drafts. Posting
uses an immediate send guard and clears only the matching draft/reply; newer
text survives the receipt. Reply switches preserve unrelated new-comment text.
Discard cancellation/unmount settles blocked navigation. Structural deletion,
history restore, further legacy editor ranges and standalone callers remain
open; no universal comment-draft or full editor qualification is implied.

Development formatting/types exited 0: pane/team guard (`e2944e` / `78882c`),
structured/cache source (`f8506f` / `f2327b`, `cb7382` / `688686`), comment owner
(`142ae8` / `aaa86c`), legacy thread routes (`907507` / `1a05ab`) and scope
namespace (`26c75d` / `8e6332`). Whole-diff whitespace check exited 0 (`659624`).
Final reply-switch refinement formatting/types exited 0 (`fe637e` / `efa6a6`).
Whole-diff check after documentation update exited 0 (`77721d`).

Full redesign remains active, unfrozen and unmerged. No formal tests, final
visual batch, native build, review round, merge or push.


### Mobile Views layouts and save recovery — 15 October

Read the original ViewBody and ViewsSheet source in full bounded ranges. Flattened
list/calendar groups and board columns; board open and completion are sibling
actions. Tables and boards retain named, keyboard reachable horizontal scrolling,
scaled column widths, explicit Rename menus and 44pt completion targets. Calendar
month controls reserve their targets and undated rows remain accessible.

Sharing now awaits its server outcome, keeps failed choices in the sheet and
checks writable team choices against the backend items:write rule. View deletion
uses an owned action sheet naming its scope and confirming that items remain.
Creation retains same-input retry keys for this mounted workspace. Library read
failure offers Retry instead of indefinite loading. Management receipts are
fenced by the mounted account and visible workspace.

Confirmed row saves and settled queued rows remain disabled until a subsequent
results read succeeds. Reads begun before a receipt cannot replace the results
or clear that guard; failed refresh retains the disabled row and Retry results.
This targets repeated completion against an old recurring-task row. Cell close
asks before discarding edited text or a failed attempted value; pending saves
remain protected, and delayed discard checks its originating cell/account.

Development formatting exited 0 (bd8b3e, 53c244); whole-diff whitespace checking
exited 0 (f1f5c0, 53c244). No tests or final visual qualification ran in this
continuation. Earlier mobile type receipts 46dd05/f19799 and 10eea1/2219fd precede
the latest row-refresh/discard guards and do not qualify them. Custom-field local
draft handoffs, full queue/runtime integration, parent departures and rendered
layout acceptance remain open. Candidate is not frozen; review remains 0/3.

Preview restart: web 5174 and combined QA API 8008 were stopped and restarted
from this worktree. Web /app and API /health returned HTTP 200 (580b5f). This is
service readiness evidence, not rendered UI acceptance.

Custom-field cell text/number edits now use an explicit Save action instead of
saving on blur while a discard decision opens. FieldValueInput reports draft
changes to its owning cell sheet; the existing inline field default remains
unchanged. The cell's discard guard includes this draft and disables the field
behind the confirmation. FIELD_TYPES currently contains text, number, date,
select, person and checkbox (88e6de); the two manual text input cases match that
contract. Formatting/whitespace exited 0 (ed2d64/35e982). This closes the source
handoff for that cell sheet, not all FieldsSection parent departure handling.
Final runtime checks remain outstanding.


### Focused document history and comment handoffs — 15 October

Mobile history now opens in a focused Page history sheet rather than expanding
the document footer into a long version list and preview. Version rows are
flat; the sheet owns scrolling. The restore confirmation replaces the history
sheet while open, retains failure/retry and names the selected time and retained
current version. Comparison choices are disabled during operations.

Whole-version and single-line restore call the page owner's handoff: settle
editor saves, resolve unsent comment drafts, recheck account/permission, then
make the editor read-only during the remote replacement. Outer departure and
agenda rewrite consult the shared restoration lock. Operation cleanup releases
that lock on cancellation/failure/success. Legacy page deletion checks all
comment drafts; explicit line deletion checks its anchored draft and rechecks
the original block list, focus and typed text after the decision. These changes
do not cover every structural edit, undo/redo or external collaboration path.

Web history browsing no longer requires write permission. Restore retains its
write requirement and rechecks it after confirmation. Reads/writes/late errors
are bound to the mounted account; callbacks use current props. The web comment
rail still needs its complete draft/departure and history-view handoff; that
source was inspected in bounded relevant ranges, not qualified end-to-end.

Initial history JSX formatting failed with a missing closing parenthesis
(e9c5ce); the edit was corrected, then formatting/whitespace exited 0
(f05e89/c1683a, 2506d7/a23cc5, 3c1c98). No unit/runtime tests or final visual
batch ran. No frozen candidate, review round, commit, push or merge. Full
redesign remains active with the remaining inventory and final acceptance gates.

History version selection now replaces the collection with its chosen preview
and Back to versions, keeping the selected content near the top even with many
versions. The whole-version Restore action stays in the sheet footer. This
source refinement still needs final long-history/short-viewport rendering.


### Web document panel and draft continuity — 15 October

The legacy web comment rail remains mounted while history, Info, reading focus
or document chat hides it. Inline display:none plus hidden prevents the hidden
rail from taking space or exposing its controls. Page/account keys separate
its draft state. A pane departure guard asks before discarding unsent anchored
comments, page comments and replies; cancellation keeps work. Delayed decisions
check the originating account and unchanged draft snapshot. Reply switching and
cancellation use a scoped decision, preserving unrelated comment drafts.

Posting clears only the matching body/parent draft after its receipt. Pending
mutations and draft decisions reject competing actions. Removing a thread names
the additional unsent-reply consequence when applicable, then clears its matching
reply only after confirmed removal. Confirm supports an optional safe-return
button label, with its existing Cancel default retained.

Web version and single-line restoration now consult the pane's registered
comment and editor guards before replacement. The remote restore makes its
editor inert/aria-busy and blocks pane departure until the operation ends.
Single-line restoration uses the settled live block list. Both clients release
a restoration lock only after their own preparation succeeded; a competing
rejected operation cannot release another operation's lock.

These are source changes in the existing preview, not formal acceptance. Source
ranges inspected were bounded around the owning state, callbacks, panel markup
and callers; the complete large editor/structural mutation reconciliation is
still open. New-anchor selection handoff, additional parent and structured
comment paths, final focus/modal/layout and failure/recovery runtime remain
required. Formatting/whitespace exited 0 (65adea/872e1f, 990ccf/0ba635,
4d0c28/a743a2); final Confirm/comment formatting result is recorded in this turn.
No tests, partial visual sweep, frozen candidate, review round, merge or push.


### Selected-text and structured comment continuity — 15 October

Web comment composers expose a scoped anchor-departure guard. Choosing another
line or passage, or cancelling an anchored composer, asks before discarding its
unsent text; unrelated page/reply drafts remain. Decisions recheck draft/account
identity. Legacy anchor changes serialize and recheck current line text/id/page
after waiting; block naming uses the current live block list rather than the
render closure. Structured comment creation checks its account/page after saves
and anchoring.

The structured web comment panel now remains mounted while hidden. Its anchor
changes use the same scoped composer guard. Structured version restoration
settles the pane's non-document drafts, rechecks permission/account and a clean
live store, and rejects stale adoption. Busy history makes the editor inert;
confirmation dialogs use their existing portal. preparePaneDrafts exposes the
existing non-document guard phase without recursively invoking a document's
own restoration lock; preparePageLeave continues through that phase and its
existing document guard.

Source inspection covered these callbacks and panel markup, not the complete
large structured editor or all structural operations. Final keyboard/focus,
anchor drift, failure and concurrency proof remain open for the frozen candidate.
Formatting and whitespace exited 0 (680dd6/7cbb2a, 098e4f/859d1b, c091ed). No
tests, formal visual batch, freeze, review round, commit, push or merge. Goal
remains active with the original full redesign scope.


### Focused mobile chat-delivery setup — 15 October

Settings no longer expands the webhook form by default. Chat delivery shows
its service/state and digest purpose, with Connect opening a focused sheet.
Connected services use a management menu for Send test/Disconnect. Disconnect
names the digest consequence in an owned confirmation. Webhook setup retains
its draft in Settings, uses explicit labelled input and a pending footer action,
and asks before discarding the unsaved URL. Delayed discard is bound to that
URL/account. Read failure provides recovery inside the editor and still allows
dismissal; failure does not clear the submitted URL. No webhook values were
printed or added to reports.

The section owns immediate write exclusion, local error/receipt notices and
mounted account checks while using Settings' existing serialized parent action.
Matching connection receipt clears only its submitted draft. Source/caller
integration replaces the previous inline form, leaving provider and Connected
apps destinations distinct. Desktop chat-delivery parity and the remaining
Settings action/caller source reconciliation still need completion. Final
runtime/render/overlay and failure acceptance remain open. Initial formatting
and whitespace exited 0 (811326); final refinement receipt is in this turn. No
tests, formal visual sweep, freeze, review round, commit, push or merge.


### Web chat-delivery parity — 15 October

Read the previous ChatDelivery component, SettingsEditor, useSettingsRead and
useAction contracts before replacing the inline setup. Web now matches the
mobile task flow: compact service/state plus digest purpose, focused setup
editor and a management popover for Send test/Disconnect. The shared Settings
editor owns focus and pending dismissal. Setup cancellation names the lost
unsaved URL and keeps failed drafts; read recovery remains available inside.
Disconnect confirmation names the service and stopped digest consequence.

The component keys drafts by account, uses owned read epochs/commit, fences late
write receipts, and clears only the matching submitted URL/service. Settings'
existing exit marker protects a pending setup/URL; no URL is placed in the marker
or report. Close decisions reject changed drafts and simultaneous close/submit.
Default outcomes and transient updating status remain near the initiating row.

Both source implementations are complete for this scoped chat-delivery flow;
that is not runtime or rendered parity qualification. Final narrow/light/dark,
setup/menu/confirmation focus, failed save/retry and real delivery exclusions
remain in the complete-candidate check. Formatting/whitespace exited 0
(06c594), with final guard refinement recorded in this turn. No tests or partial
visual sweep were run. The larger Settings reconciliation, full redesign freeze,
Test → Review → final web/Expo Visual and integration remain outstanding.


### Compact email-to-task management — 15 October

Read the complete web EmailToTask source and the mobile Settings caller before
replacing its dense repeated actions. Both clients now keep the full private
address and sender requirement visible, with a direct Copy action. Replacement
and turn-off are management actions; their owned decisions name the consequence
that mail sent to the old/current address stops creating tasks. The subject/title
and body/notes mechanism is in named optional help. Mobile displays a selectable
wrapping address rather than a disabled single-line input.

Mobile's extracted section serializes writes, retains local errors and receipts,
checks mounted account identity and confirms the same address after deferred
selection. Web uses owned reads/commits/actions, an account-keyed component and
a corresponding address recheck after confirmation. Incoming read epochs are
invalidated by mobile inbox/chat receipts before adoption, preventing an older
read from overwriting a just-saved connection state. Copy acts only on the
explicit user action; addresses were not printed or stored in reports.

Source parity is implemented for these operations, not acceptance proof. Final
wide/narrow/full-address, clipboard failure, confirmations/keyboard/focus and
failed write/read recovery remain required. No live inbound-mail delivery or
native coverage is implied. Formatting/whitespace exited 0 (5c7cd1,
1a4f9d); final receipt refinements are recorded this turn. Remaining Settings
source/caller reconciliation and full frozen-candidate qualification remain
open. No tests, visual sweep, freeze, review round, merge or push.


### Focused import/export workspace — 15 October

Mobile Import & export now shows three task entries: Export, Import tasks and
Import pages. Each opens a focused sheet with just that operation's controls;
root-owned draft/file/preview state survives dismissal. Entry labels identify a
retained task draft or selected page file. The sheet rejects pending dismissal,
keeps preview counts/issues and page-import consequences, and shows transfer
errors locally while preserving entered data. Task source input becomes read-only
during operations. Account/mount checks fence file reads, preview adoption,
clearing confirmed drafts and export handoff.

Web already used focused task/page import editors. Export formats now live in
a separate focused editor rather than competing with imports on the default
Settings surface. Local outcome/error feedback stays inside that editor. Its
existing mounted receipt helper now includes the initiating login for delayed
file/preview/download results. No private export/import content was printed.

Read mobile transfer source through bounded ranges and web owning/export helper
ranges; remaining complete importer/source/caller integration is still open.
These edits do not establish exact-preview acceptance, uncertain-write recovery,
file-picker/native behavior or final focus/layout. Formatting/whitespace exited
0 (4e8c4b/1b9585, 0d391d); final account-helper receipt recorded this turn.
No tests, partial visual sweep, frozen candidate, review round, merge or push.
Original full redesign scope remains active.


### Exact-preview importer and file-read recovery — 15 October

Web file selection now retains the current draft/file/preview until the new
file is successfully read and validated. Task/page previews keep their exact
source and format; changing/clearing input invalidates that receipt. Confirmed
imports use the accepted preview input and reject a changed source, on both
clients. Mobile task imports now show the acknowledged created/skipped count;
focused import/export editors show a single processing status. Existing sample,
count, error and exclusion details remain in the review flow.

Inspected API clients and the owning page-import route: previews remain dry runs
and imports preserve the existing POST contracts. No new backend deduplication
or idempotency contract was introduced. Lost-response/uncertain-write recovery
therefore remains an explicit runtime/contract gap to resolve in the candidate
audit; these source guards are not a claim that repeated requests are safe.
Remaining importer handoffs and final rendered focus/short/narrow acceptance
still need completion.

Formatting/whitespace exited 0 (4a9985/d7d76a, d2724e/7a6f95,
04cbee/terminal receipt in this turn). No tests, visual sweep, freeze, review
round, commit, push or merge. Full redesign remains active.


### Import retry identity and atomic receipts — 15 October

Inspected the existing idempotency hook, client.once transport, service
registration, import routes and transaction client type before extending import
recovery. Web/mobile now retain same-input attempt keys through failed requests
in the mounted Settings workspace. Only fingerprints/keys/timestamps are retained
in the attempt maps; full source already belongs to the editor. Confirmed
receipts retire their attempt, allowing an intentional later import. Retry
attempts older than 23 hours are refused rather than silently reused past the
server's one-day window. Keys are not durable across closing/recreating Settings;
this is bounded in-mount retry recovery, not remount recovery proof.

Imports now authenticate before keyed replay, recheck current page target-team
write access, and bind cached receipt paths to the parsed request body's hash.
The task/page import transaction writes its acknowledged result into the existing
idempotency row alongside content. Failure to persist that receipt aborts the
transaction. onSend updates/deletes only incomplete receipts, preserving a
committed result when response delivery/serialization fails. No migration or
configuration variable was introduced; existing idempotency retention applies.
API documentation now names this import contract. No scan was invoked.

Source implementation is not transactional/live acceptance evidence. Require
exact-candidate commit/rollback/response-loss replay, concurrent replay, changed
body, auth/team revocation, expiry/stale in-progress and deliberate repeat cases.
Durable retry after Settings recreation remains a source/contract audit item.
Formatting/whitespace exited 0 (0302e7/8a26b5, 08ffcf/a8d7e0,
6136fc/355ee2, 3ca7eb). No tests, visual sweep, freeze, review round,
commit, merge or push. Original full redesign scope remains active.


### Compilation and finite source closeout — 15 October

Development compilation caught two web importer request variables shadowing
their input refs (79d219/9936c0), and two mobile history list selection checks
in a branch where selection is necessarily null (6f1de3/6891cb). Renamed the
request payloads and removed the obsolete list checks. Core/api-client builds
and backend compilation passed in the initial chain before the web failure.
Corrected desktop compilation exited 0 (52433a/bd4df1); corrected mobile
compilation exited 0 (6c3972/345627). These are development checks, not formal
Tester qualification or rendered acceptance. Retain the initial failures.

Stage Tracker reconciled the finite original scope: shell/modal caller ownership;
remaining document modes/history/comment/project handoffs; Views queue and
departure contracts; Settings action/caller closure, then one frozen candidate
with scoped runtime, Reviewer 0/3 and final bounded web/Expo visual acceptance.
The additional durable-import-storage observation is not an owner requirement:
retain the current mounted-workspace retry boundary and qualify its actual
contract without starting a new persistence project. This corrects the earlier
audit note's scope; it does not change the requested full redesign.

Project custom fields now report dirty values, in-progress saves and open child
editors to their owning project. Outer departure waits for child edits to finish
or cancel; failed unsaved value drafts participate in the existing owned discard
decision. Confirmed page/planner handoffs cannot bypass that boundary. Authorized
discard resets field state and remounts only that project's field controls, so
stale drafts are not resurrected when returning. Child state callbacks check the
current project/account and do not create a new storage/ownership architecture.
Formal field/child-dialog/project navigation interaction still remains required.

Formatting/whitespace exited 0 (6814aa, dfdbd5/1bec3e,
93145c/terminal receipt in this turn). Mobile compilation passed after the initial
field handoff (dfdbd5/1bec3e); final reset compilation is recorded this turn.
No unit/runtime tests, partial visual batch, freeze, review round, commit, push
or merge. The full redesign goal remains active.


### Web field, alternate-name and project departures — 15 October

Read FieldInput and the owning field/project/navigation ranges. Web custom-field
inputs now register their dirty/failed state and immediate pending lock with the
pane. Discard decisions retain drafts on cancellation, recheck source/account,
and suppress blur-save while the decision owns focus. Saving feedback is visible.
FieldsPanel keys ownership by login/target and retains data/open editors across
revision refresh; focused field creation/options reject outer pane departure.
Project Back uses the same pane guard before removing its detail owner.

Project rename/summary/stage/link drafts and pending mutations now participate
in the pane decision. Alternate names protect unsubmitted text/pending writes;
late saves clear only their submitted text and check mounted login ownership.
Page Info becomes lazy on first open, remains mounted while hidden, then reads
fresh metadata only when visible. Its root occupies no hidden pane space, and
account-keyed/fenced metadata prevents late cross-login adoption. Its field/name
controls therefore survive local history/chat/Info presentation changes.

These are actual caller/source closure changes, not rendered proof. Required
final cases include blur-before-navigation, failed save/discard/cancel, child
dialog ownership, revision refresh, hidden-panel focus, permission/account change
and paired-pane routing. Remaining large editor/project ranges remain open.
Formatting/whitespace exited 0 (97f226/94d39b, 54e2ec/8bfbb7,
bc657c); development desktop compilation passed for the field/Info/project
batches. Final aliases/account refinement compilation is recorded this turn.
No tests, visual sweep, freeze, review round, commit, push or merge.


### Views row write and refresh ownership — 15 October

Inspected Views definition-store lifetime: it belongs to the mounted workspace
and login, continues definition saves across screen navigation, retains failed
drafts and stops on teardown/account change. That existing contract does not
require a new persistent definition store or an added flush API.

Web row changes now share a pending/confirmed refresh boundary, including task
board moves that previously called the task updater directly. A row remains
read-only after a confirmed write until a later matching results read succeeds;
a read started before the receipt cannot replace rows or release the guard.
Failed results keep Retry and the guard. Table/list/board/calendar/gallery receive
the same derived write permission; row writes block pane departure.

Mobile row/rename operations report busy state to the owning Views sheet at
the initiating event. Close, Back, creation and view-management handoffs cannot
remove or replace that owner while its write is in progress. Owner-tagged
callbacks cannot release another view's operation. Both clients show one row
operation status: saving, refreshing, or the existing queued/failed-sync state.
Creation/definition drafts retain their existing private workspace lifetime.

These changes still require formal saved/queued/offline/conflict/unknown receipt,
rapid repeated completion, refresh failure/retry, account teardown and navigation
proof on the frozen candidate. Source-serving does not establish those outcomes.
Formatting/whitespace exited 0 (dad8e5/e64e24, 08e319/1982de,
44d010/8364f4); desktop/mobile compilation passed those development batches.
Final status/management refinement receipts are recorded in this turn. No tests,
visual sweep, freeze, review round, commit, push or merge.


### Root/project asynchronous handoff — 15 October

Inspected focused-pane chrome/tab/pane close and mobile root sheet/task/document
entry points. Web chrome/tab transitions already consult scoped leave guards
and recheck account/navigation ownership; task/settings overlays retain work.
The remaining root/project issue was a draft created after a document handoff
was approved but while its data was loading.

ProjectsSheet now exposes its existing owned leave decision through a current
project guard. Root document/task presentation rechecks that exact guard after
asynchronous work and rejects a changed project, account or navigation request.
Cancellation, hide/unmount and failed/stale selections settle the waiting guard;
selected discard resolves only after the existing scoped action succeeds. No
new controller or persistent-state architecture was introduced.

Changing project sections now protects dirty inline fields and pending child
edits. A field-only discard leaves unrelated rename/summary/stage/link drafts
intact; their root-owned state still survives section presentation. Pending
field writes cannot be discarded mid-write. Callback refs and deferred modal
actions remain tied to the original project.

Development mobile compilation passed initial root/project handoff and section
guard (447113/5ad1da, a8ddba/29eb43). Formatting/whitespace passed
(c89df9/terminal receipt); final task-presentation compilation is recorded in
this turn. Required exact-candidate cases remain slow document reads with new
drafts, cancel/close/account change during approval, project replacement, section
changes, stale deferred selections, modal-stack/focus and paired web navigation.
No tests, visual sweep, freeze, review round, commit, push or merge. Full scope
remains active; remaining editor/settings/source and final acceptance rows stay
open.


### Source-mode link departure — 15 October

Inspected normal/structured source-preview callbacks and root app-link dispatch.
Source preview previously closed and dispatched an app link synchronously, before
normal-editor saves or its registered draft handoffs had settled. Both source
previews now support an awaited preflight, keep the editor on cancellation/error,
show local saving/error status, freeze edits/actions during the handoff and
recheck mounted login/source generation before closing. Same-page fragments keep
their existing local navigation. Strict Mode setup restores the lifetime flag.

Normal web/mobile parents settle the current save queue and their existing pane
or comment-draft guards before allowing the link. Source-close ownership refs
update synchronously so an otherwise valid link is not rejected by the old
source-open render closure. Structured LaTeX close uses the same current overlay
ownership in its leave guard; its existing save-aware link callback remains.

This closes source-preview preflight source work, not all root note replacement
acceptance. Normal rendered-note links and final root note presentation after
slow reads remain part of the remaining document/modal caller reconciliation.
Required final cases include invalid/stale source, failed/queued save, cancelled
comment discard, source change during preflight, modal focus/return and all
three editing modes with assistant/history handoffs. No compiler/native/runtime
acceptance is implied. Formatting/whitespace passed (a0c4ff/a9667b,
6c863b/ed8c89, da6397); desktop/mobile compilation receipts are recorded
in this turn. No tests, visual sweep, freeze, review round, commit, push or merge.
Full redesign remains active.


### Rendered-note and root destination handoffs — 15 October

Normal rendered-note links now settle the current web pane or mobile comment/save
owner before dispatch. Same-page fragments remain local. Structured editors share
an awaited link preflight with their LaTeX previews, so cancelled draft decisions
keep the source surface open. Their existing conflict, invalid-source and mobile
queued-save rules remain authoritative.

Mobile DocsSheet exposes its active page departure guard to RootScreen. All three
root document-sheet owners register only while visible. Document adoption after
a slow read and task/link destinations recheck the current guard, request and
account before presentation. OpenDoc settles comment decisions before the final
editor save, covering typing while a decision is pending. Web openPage settles
page departure after its read; replacing deep links use the same departure
contract as sidebar navigation.

Runtime provenance checked: Vite PID65174 cwd is c6-next/Orbyn/desktop and API
PID65269 cwd is c6-next/Orbyn/backend. /app on5174 and /health on8008 returned200.
This is reachability/provenance, not rendered acceptance. Development desktop
and mobile typechecks passed (ec0eeb/966a3a, bce093/eccb7a,
f7d2a1/437bf1); final small desktop deep-link compilation is recorded in the
turn. Formatting and git diff --check passed (d77bda). No formal test/visual
handoff, freeze, review round, commit, push or merge. Required final cases:
failed save, cancelled comment discard, typing during slow reads, source-mode
cancellation, replaced account/page, repeated link clicks and modal return/focus.

Tracker is reconciling historical Partial source-coverage rows against concrete
remaining ADR requirements. Those rows must not manufacture extra capabilities;
implementation inspection coverage and exact-candidate acceptance stay distinct.


### Team child controls and planning result identity — 15 October

Concrete caller inspection found overlapping optimistic TeamPolicies writes and
TeamAgents reads with neither owned recovery nor pending departure protection.
Both now use mounted-account/latest-read ownership, serialize writes, preserve
confirmed values on failed writes and expose loading/error/Retry states. Both
register pending pane guards; TeamDetail Back now prepares the pane's child
guards as well as its own name/member drafts. Parent TeamDetail remains keyed to
login/user/team. The initial child-control compilation passed (2e5b19).

TeamPlanning week-specific availability/workload now carry their requested range
and do not render a prior week under the new heading. Capacity is keyed by team
and week. Meeting-time results carry the exact people/duration/team query and
reject late results after query/account/unmount changes. Final compilation is
recorded in the turn. These are source fixes, not runtime acceptance; remaining
team planning/attention caller inspection and final narrow/permission/async
interaction checks remain. No formal QA, freeze, review, commit or merge.


### Team planning and mobile child parity — 15 October

Continued from the previous source changes (progress, not a wait). Web meeting
budget updates now have mounted-account read ownership, a pending pane guard,
confirmed budget state, local recovery and a week-navigation lock until settlement.
Mobile permission and agent-access writes use TeamDetail's existing serialized
mutation path, including its departure protection; reads are independently owned
and expose Retry instead of disappearing on failure.

Mobile TeamTime now serializes actions, reports pending child work to TeamDetail,
rejects detached/account-changed receipts, and binds meeting slots to the exact
people/duration/team query. The everyone choice checks membership rather than
only equal list lengths. Mobile budget writes report pending through the same
owner and prevent week replacement until settled. Availability/workload failure
states offer Retry in both clients rather than an endless loading label. This
batch retains all existing planner permissions and event/outbox contracts.

Development checks: web budget compile passed0 (0f0bec), mobile policy/access
passed0 (c803b2), mobile query/parent ownership passed0 (37b7c6). The first web
Retry compile failed2 because workload still had the old result type (44aec7);
corrected both result paths, and final web/mobile compilation results are
recorded in this turn. git diff --check passed (38dcbf).

These changes close the identified team child pending-write and result-identity
source defects. They do not establish complete ADR acceptance. Final candidate
must exercise rapid switches, failed reads/writes, saved refresh failures,
account/team changes, meeting-result changes, cancellation and narrow layouts.
No partial formal tests, visual run, freeze, review, commit or merge.


### Settings pending ownership and root note callers — 15 October

SettingsScreen reports its existing write lock to RootScreen. The owning Settings
sheet disables Close/native dismissal during a write; root sheet presentation
and close also check the synchronous lock. Child import/export and connection
operations retain their existing local draft/error behavior. This addresses
pending dismissal, not a new requirement to persist import drafts after closing.

Seven calendar/notice/View/share/onboarding document callers now use the common
owned openDocument path instead of raw getDoc/setNote chains. That loader returns
its operation so notice handlers can await settlement. The initial last-page
read also checks account/destination/lifetime before presentation. Search keeps
its existing throw-to-local-error contract; saved task-note creation and other
root caller reconciliation remain explicit source coverage work.

Development mobile compilation passed after the Settings/caller batch (6d13ae).
Final startup/share caller compilation is recorded in the turn. Whitespace
passed (586da1). No formal test/visual batch, frozen candidate, review, commit,
push or merge. Exact-candidate pending-close, failed-read, late-reply and focus
checks remain required.


### 15 October — final caller and recovery closure

Task-note, Search and Study document adoption now shares RootScreen's owned
showDocument preflight. Search preserves its local error contract; task notes
preserve occurrence selection. Page import commit summaries containing errors
retain the selected input on both clients and no longer announce false success.
Desktop portability state is keyed to the account.

Mobile table cell editors report their open lifetime synchronously to the Views
owner, protecting Back/Close and definition/layout replacement until the editor
closes. Writes also recheck current row editability. Team capacity uses owned
reads with a local Retry state; presence updates reject stale account/lifetime
responses. The existing team/week component key retains range ownership.

Development compilation passed for the prior caller/import batch on desktop
(a9e234) and mobile (b177b7), and for the final Views batch on mobile (690206)
and capacity/account batch on desktop (af7c78). These are compilation checks,
not formal acceptance. Port 5174 PID 65174 resolves to this worktree's desktop
folder. No formal QA, freeze, review, commit or merge in this batch.


### Integrated implementation handoff — 15 October

The finite source audit has reached the complete implementation candidate. The
mapped screen families, states and owner refinements are submitted together for
formal qualification in adr-003-candidate.md. Historical Partial rows describe
earlier inspection snapshots; final acceptance must inspect the integrated source
and reproduce the required behavior. No known source defect is waived by this
transition. Tester findings return to Builder before acceptance.

The last shell correction brings keyboard/command search, project/source opens,
new pages and calendar command destinations through the pane departure contract.
Page opening catches preflight failures and retains block focus after adoption.
Settings is keyed to login. Legacy editor flush now rejects failed saves before
export/archive/delete; archive/delete are serialized, protect comments/departure,
recheck current permission/account, and reject detached receipts. The mobile
archive route likewise saves first, protects pending departure and uses owned Undo.
Desktop queued saves reject account changes before starting or settling writes.

Development compile b70b2d failed on a deferred project-id narrowing; capturing
the id fixed it and a1a2d3 passed. Later document compile ca9005 passed. Final
combined types for archive/delete changes passed (8a9037 desktop, 8e98fe mobile).
The final small queue/permission cleanup is included in the frozen candidate's
formal checks. No formal review round has started; 0/3 remains.

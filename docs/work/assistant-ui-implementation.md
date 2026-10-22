# Assistant UI implementation

Status: implementation complete and qualified locally; PR delivery requested.
The [accepted ADR](adr-assistant-ui-refinement.md) and approved mockup define the
scope. Base: `934df6852105c4f7bd08325ad068044e19b040ad`.
Branch: `feat/assistant-ui-refinement`. Delivery targets a separate UI PR based
on the still-open `feat/unified-assistant-conversation` PR #222. Remote CI results
are tracked on the UI PR. Merge and deployment are outside this delivery request.

## Ownership and workflow

The other session's policy, model and skill edits were preserved. Their 32-file
starting hash snapshot is `/tmp/orbyn-ui-other-session-hashes.json`; subsequent
changes to `AGENTS.md`, `docs/agents/skill-system.md` and the UI skill were made
concurrently by that session and reread where relevant. New social skills and
other policy files were also left with that owner. Formatting and writes in this
work were restricted to application source, its tests, this ADR/record and the
owning API guide. No stash, reset, policy overwrite or new work session was used.

The current delegate tools advertise Priority processing with no Standard
selector. Repository policy requires Standard. Implementation and lead review
therefore stayed with one direct owner; no independent review or delegation is
claimed. Shared contracts were defined before client rendering changes. The
existing React/CSS, React Native/Expo, TypeScript/Zod and API client remain the
stack; no UI framework or orchestration dependency was added.

## Implemented contract

- Chats shows the canonical Orbyn conversation once, then Projects, Pinned and
  Recent groups. Both clients load the authorized conversation list across
  project scopes. Starting a project chat preserves typed text, requires a real
  project before sending and shows one selected scope rather than repeated
  context controls. The Chat/Work header switch is removed.
- Activity owns Background, Overnight and Upcoming navigation. Existing run,
  schedule, pause/mute and approval owners retain their authority. New chat has
  one visible home in Chats. Web Focus closes/reopens Chats without introducing
  another conversation mode. Narrow panes use the existing local panel owner.
- User messages expand/collapse reversibly; Copy returns full text even while
  collapsed. Answers and updates have Copy and one Details surface. Questions
  use Answer, approval requests use Review, and unavailable questions show
  Closed. Stop work is inside Details. Dates group by local calendar day.
- Details reads current source titles and current waiting/execution projections
  from the session-only endpoint documented in [the API guide](../api.md).
  Primary read-only repeatable-read projection keeps authorization, payload and
  titles consistent. It neither acknowledges content nor creates work. Both
  clients reject mismatched identities, cancel stale requests, clear unavailable
  content and refresh details when current question/execution availability changes.
- Web selection offers one Ask Orbyn action after release/keyboard selection
  settles. Mobile Message options opens an accessible selection sheet. Both add
  a removable excerpt to the existing composer, focus it and retain typed text;
  neither sends automatically. Mobile selection is cleared if its source changes;
  oversized mobile selections explain the 2,000-character limit. The shared
  light-Markdown matcher supports
  selected visible words across emphasis/code and whitespace boundaries.
- Excerpt admission names the exact authorized entry, pins its revision and
  persists dependency lineage. Provider/effect boundaries revalidate it.
  Retained user turns keep excerpt retry identity after run checkpoints are
  cleared. A failed send restores a target only through a fresh authorized feed
  read rather than a cached payload. Changed messages, targets or excerpts
  cannot reuse the same turn ID.
- Opening panels preserves drafts and reading state. Only the thread owns
  conversation scrolling; ancestor containers use clipping so focus/selection
  cannot scroll the header away. Wide tables retain their existing local
  horizontal scroll areas. Shared theme tokens and native text scaling remain.

## Qualification

The user explicitly authorized focused regression tests in this goal turn.
Checks used a separately created, marked `assistant_ui_test` database, not the
running preview's fixture database. Provider traffic in route tests is trapped;
the selected run test uses its existing local fixture provider/runtime harness.

| Check                                         | Outcome and receipt                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shared core/API package build                 | Passed; `/tmp/orbyn-assistant-ui-package-build.log`                                                                  |
| Backend, desktop and mobile TypeScript checks | Passed; `/tmp/orbyn-assistant-ui-{backend,desktop,mobile}-types.log`                                                 |
| Focused eight-file suite                      | 68/68 passed; `/tmp/orbyn-assistant-ui-focused-final.log`                                                            |
| Completed-run excerpt retry                   | 1/1 passed; `/tmp/orbyn-assistant-ui-retry.log`                                                                      |
| Final details/excerpt boundary recheck        | 2/2 passed after repeatable-read correction; `/tmp/orbyn-assistant-ui-details-final.log`; overlaps the 68-test suite |
| Presentation/helper ratchets                  | Passed; `/tmp/orbyn-assistant-ui-presentation-final.log`; overlaps the suite                                         |
| Desktop production build                      | Passed after restoring its declared local prerequisite; `/tmp/orbyn-assistant-ui-web-build-final.log`                |
| Expo web production export                    | Passed; `/tmp/orbyn-assistant-ui-expo-build-final.log`; output `/tmp/orbyn-assistant-ui-expo-export`                 |
| Owned-file format and whitespace              | Scoped checks only; other-session formatting remains untouched                                                       |

The suite covers conversation/source revocation, authorization, source renames,
retained-history behavior, store identity/read semantics, client no-store and
identity checks, calendar-day grouping across DST, shared excerpt matching,
legacy chat metadata behavior and the route capability inventory. Counts above
overlap and must not be added together as unique tests.

### Rendered web and Expo web evidence

Both previews use this checkout and one disposable local QA account. Synthetic
long-message, project and table fixtures are isolated to that account; prototype
canned responses were not copied into production. Source/runtime provenance and
actual CSS viewport were checked. CDP screenshot capture was used when the
host's displayed screenshot scaling differed from the emulated CSS viewport.

- Web: Conversation/Focus, Activity, current/closed work actions, Details loading
  and results, exact selection to composer, expansion/collapse and complete Copy.
  A 2,295-character prompt copied exactly while collapsed. Composer height grew
  from 39 to 106 pixels and returned to 39 after shortening its text.
- Web split: at 1440 pixels overall, Assistant panes measured 648 and 719 pixels.
  Chats and Details each opened one local overlay; Details measured 400 pixels
  within its pane. The global rail stayed 72 pixels. Escape restored focus to
  Open chats; the primary draft remained intact. The temporary split was closed.
- Expo web: real mobile renderer at CSS widths 320 and 390, with matching document
  scroll widths. Header/drawer, project choice, Activity, Details, user-message
  expansion/full Copy and keyboard selection to composer were exercised. Opening
  and closing drawers/sheets retained the draft and quote; no message was sent.
- Wide tables: web wrapper 758 pixels with 877-pixel scroll content; mobile wrapper
  288 pixels with 1280-pixel content at a 320-pixel viewport. The page did not
  widen. Incoming fixtures left existing drafts/quotes intact and exposed Latest.
- Light and dark themes were personally inspected on both renderers. Activity
  remained operable with reduced motion emulated, with focus and drafts retained.
  Original Light choices and all viewport/media overrides were restored.
- Screenshots: `/tmp/orbyn-assistant-ui-web.png`,
  `/tmp/orbyn-assistant-ui-web-dark.png`,
  `/tmp/orbyn-assistant-ui-mobile.png`,
  `/tmp/orbyn-assistant-ui-mobile-dark.png`.

### Failures retained and corrected

- Prior PR CI failures: legacy turn parsing ran before stream registration,
  three font expressions were outside the type-scale ratchet, and first-party
  conversation routes were absent from the capability inventory. Corrected in
  the local diff; corresponding focused checks pass. No claim is made that the
  earlier remote PR's failed run changed.
- An initial details test lacked assistant-job provenance; the API correctly
  withheld it. The fixture was corrected rather than weakening authorization.
- Rendered inspection found an overly aggressive Chats breakpoint, a Focus reopen
  handler, ancestor scroll escape, duplicated project controls and a pre-existing
  empty-string child warning on the mobile entry screen. Corrected and rechecked.
- Expo initially served a stale non-watching bundle; it was restarted and current
  source/viewport verified. Preview API restart also required its explicit local
  CORS origins. Failed preview attempts are not counted as passing evidence.
- Desktop prebuild initially failed because local `node_modules` lacked the
  manifest-pinned `latex.js@0.12.6`. It was installed with scripts disabled in an
  isolated temporary prefix and linked only at the missing local package path.
  No dependency manifest or lockfile was changed. The initial receipt remains at
  `/tmp/orbyn-assistant-ui-web-build.log`.

## Limits and delivery

Installed iOS/Android, OS accessibility/keyboard integration, live providers and
OS push were not exercised. Expo web proves the mobile renderer, not native
integration. No security scan, external message, native build, new provider/tool,
merge, deployment or background monitor was performed during qualification. Existing voice,
share/edit/branch/regenerate and orchestration behavior are outside this ADR.

The default-off conversation rollout flag and existing server execution lanes
remain unchanged. Only the 32 owned source/API-guide files and this ADR/record
are included in UI delivery; the other session's work remains local and excluded.
Preview tabs and owned local
preview services remain available for review; test/build cleanup is recorded at
closeout. Approved mockup SHA-256:
`b0340b9ba036c21f314d2efb2c43775ffb1070a57000507ae102a6b064d404e4`.

## Closeout

- Final client/store/helper recheck: 27/27 passed in
  `/tmp/orbyn-assistant-ui-client-final.log` (overlaps the main suite).
- The isolated mobile provider-unavailable send restored its typed draft and
  freshly authorized quote; no live provider request was made. The preview error
  was dismissed after checking recovery.
- Final project-picker consolidation was checked with real project choices on
  both renderers. Desktop TypeScript narrowing corrections are retained in
  `/tmp/orbyn-assistant-ui-web-build-scope-failure.log` and
  `/tmp/orbyn-assistant-ui-web-build-scope-narrowing.log`; the final build passed.
- The isolated `assistant_ui_test` database was dropped after qualification.
  The original disposable preview database/account and review services remain.
- Only the task-created temporary `node_modules/latex.js` link was removed.
  Prebuild-regenerated renderer JSON files were restored to their clean starting
  bytes so this UI diff does not contain unrelated renderer rebuilds. No package
  manifest, lockfile or existing environment file was changed.
- Review images were copied to this chat's visualization directory with names
  `assistant-ui-implemented-web.png`, `assistant-ui-implemented-web-dark.png`,
  `assistant-ui-implemented-mobile.png` and
  `assistant-ui-implemented-mobile-dark.png`.
- Final owned source manifest: 32 files at
  `/tmp/orbyn-assistant-ui-source-manifest.json`, SHA-256
  `e66e9435513a623c7ea2c531e8afa0b73a323ef24af1835fead19bdaf356a8f1`.
  Documentation records are excluded from that digest to avoid
  a self-reference; the owning API guide is included.

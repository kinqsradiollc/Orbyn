# ADR implementation tracker

Updated 7 October 2026. Goal resumed at the user's request. This is a concise
status index; [ADR 001](../adr/001-devday-agent-platform.md) and
[task handoff](task.md) retain the full scope and evidence.

| Area                           | Current state                                                                                                                                                                                                                                   | Remaining acceptance / next implementation                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main                           | `origin/main` verified at `bed5ba7e`; user deploys manually                                                                                                                                                                                     | Candidate integration, qualification and main promotion; production deployment is not confirmed                                                                                                                                                                                         |
| ChatGPT native                 | Direct local OAuth, protected tokens, model catalog/defaults, signed inference and Settings/foreground activation implemented on `codex/chatgpt-direct-web-oauth`                                                                               | Installed iOS/Android OAuth/keystore/browser/lifecycle acceptance; account management and truthful plan/usage acceptance                                                                                                                                                                |
| Current recovery work          | Failed/cancelled reconnect resumes preserved credentials; catalog refresh runs every two minutes so its five-minute freshness window does not expire                                                                                            | Candidate only; 441 ChatGPT unit tests pass; current adapter mobile/backend typechecks pass; refresh coordination, revocation, idle saved-account controls and confirmed invalid-refresh recovery implemented; signed iOS startup inspected; OAuth/storage/inference acceptance pending |
| ChatGPT hosted web             | No supported direct browser-only implementation established; desktop handoff is not completion                                                                                                                                                  | Supported authorization and user-controlled runtime; actual popup/callback/provider acceptance without desktop                                                                                                                                                                          |
| Main integration               | Frozen candidate400ee67e full regression:3939 passed,0 failed,0 skipped; later source-pane changes have focused evidence                                                                                                                              | Full regression of later changes and installed-platform qualification pending                                                                                                                                                                                                                           |
| Docs D1                        | Structured ownership/Markdown/Mermaid foundations and format-aware capture/reflection, complete-tree merges and nested checklist task mapping implemented on candidate; offline recovery is integrated; normal editor widget activation remains | Normal editor adoption, remaining flat writers/task identity, collaboration, complete import/render/edit/export/privacy matrices and native visual checks                                                                                                                               |
| Whole-app UI U1                | Existing settings/assistant/responsive checkpoints plus candidate native ChatGPT controls                                                                                                                                                       | Review every page and interaction on web/desktop/mobile, collapsed/narrow/panel/large-text states; avoid overlaps and duplicate actions                                                                                                                                                 |
| Providers/plugins/MCP C1–C3/M1 | Separate provider and plugin/backend boundaries remain in scope                                                                                                                                                                                 | Governing capability/account/budget/usage audit and real host/provider acceptance; keep MCP grants separate                                                                                                                                                                             |
| Background/Overnight C4–C5     | Separate identities/runtime/reflection foundations recorded in ADR                                                                                                                                                                              | Collaboration, budgets, maintained/shared/published-page audit and runtime/client acceptance                                                                                                                                                                                            |
| Channels C6                    | Slack/Teams implementation candidates recorded in ADR                                                                                                                                                                                           | Real tenant, lifecycle, delivery, exact-question reply and cross-client acceptance                                                                                                                                                                                                      |
| Cleanup                        | Worktrees, root character/user changes preserved                                                                                                                                                                                                | Cleanup only after relevant commits are reconciled, merged and qualified                                                                                                                                                                                                                |

## Current evidence

## Qualified full regression — 7 October 2026

The corrected frozen candidate400ee67e full database run is terminal green:
3939 tests passed, zero failures/skips (882009ms), recorded in
/tmp/orbyn-adr-full-db-catalog-fixed-20261007.log. This supersedes the earlier
failed run as current full-regression evidence without rewriting its history.
Later Source/Preview changes and main source-event reconciliation have separate
51/51 focused checks and client typechecks; they are not covered by that frozen
full run. Normal rich-editor activation and real browser/native acceptance remain
unfinished. Visual review is assigned to the user's separate review session;
implementation and main checkpoints remain in this session.


## Complete Source/Preview ownership contract — 7 October 2026

Both client source panes now accept a complete VersionedDocContent and a matching
owner callback. Owned source uses validated full-tree leaf geometry; nested
previews reuse existing rich widgets inside their quote/list owners and keep
page-wide references and footnotes. Native source remains a TextInput inside a
Sheet; nested layout measurements resolve against the preview root and ignore
retired owners. A flat callback cannot edit owned content. Identical source across
an explicit ownership-format change still adopts the new complete owner.

Delayed own echoes show the newest accepted tree and typed buffer. External
reconciliation fences retained input events, preserves unaccepted typing for
review and never maps unmatched source onto a different preview. Both-platform
component regressions cover complete ownership, readonly callbacks, changed
formats, delayed echoes and stale handlers; shared geometry checks cover exact
leaf order, anchors, CRLF and mismatched source refusal. The source/view/edit/
versioned-source/control cohort passes51/51, zero failures/skips (1293ms); shared
packages and both client typechecks pass. This is candidate only: normal editor
loading/saving and rich structural-command activation remain unfinished. No
browser screenshot or installed-native acceptance is claimed.

## Full regression result and corrected candidate — 7 October 2026

The frozen candidate e6ae3511 full run terminated with3933 tests:3932 passed,
1 failed,0 skipped (895654ms). Its only failure was the stale generated MCP
catalog after the new credential-route classification. The catalog/directory/
route inventory correction passes21/21 independently. The ownership-preserving
leaf-edit checkpoint passes24/24 plus shared package builds/backend types.
Both checkpoints are now fast-forwarded into the primary integration candidate
at08462c19 without conflicts. A fresh full run of that corrected application
checkpoint is required; this previous run remains failed and its evidence is
not relabelled. Main remains64e905f5; native/browser acceptance and the full
C1-C6/M1/D1/U1 scope remain unfinished.

## Browser preview requirement and catalog reconciliation — 7 October 2026

UI acceptance now explicitly requires the web/desktop browser preview and the
mobile browser preview. Keep native mobile controls, accessibility, keyboard and
sheet behavior; browser layout checks do not replace installed OAuth/keystore/
inference acceptance. Capture the relevant narrow/wide, collapsed, multi-panel,
large-text and keyboard states before calling each redesigned surface complete.
Do not substitute simulator screenshots for the requested browser review.

The ownership worktree's Vite5174 and Expo web8083 previews are running and return
HTTP200. A dangling worktree-local Vite cache symlink was replaced with a local
cache directory without changing its former target. Browser Use still explicitly
rejects5174 because of the saved Block, including alternate-port/browser bypasses;
no screenshot or authenticated visual acceptance is claimed. User permission
repair remains pending while implementation continues.

The frozen full regression exposed stale generated MCP route totals after the
credential-route exclusion repair:289 exclusions became290. Regeneration changes
only the totals in mcp-catalog.json and mcp.md; schemas, grants and provider/plugin
boundaries are unchanged. The catalog/directory/route inventory rerun passes21/21,
zero failures/skips (6394ms), on a separate disposable test database. An initial
invocation omitted TEST_DATABASE_URL and was refused by the test harness; only
the correctly configured rerun is counted. The full candidate run remains live;
its catalog failure is recorded, not rewritten as a passing full run.

## Owned leaf-edit checkpoint — 7 October 2026

Explicit replace-leaf and splice-leaf operations now edit an exact rendered path
against the accepted complete-document snapshot. Named leaves retain their first
identity; parsed multiline fragments stay inside the existing child owner. Quote,
list, marker, checkbox and unrelated empty-owner metadata remain intact. Full-tree
validation refuses stale snapshots, duplicate identities, implicit deletion,
malformed/cyclic/oversized trees and excess combined depth. Returned trees do not
retain mutable replacement aliases; legacy documents require an explicit upgrade
before introducing containers.

The focused operations, controls and versioned-source suites pass24/24 with zero
failures/skips (935ms); shared package builds and backend typecheck pass. This is an editor prerequisite,
not normal-editor activation. Existing rich widgets still need complete-document
loading/saving, exact-path leaf and structural commands, source/history/recovery,
task ticks and collaboration integration on web/desktop/mobile. This checkpoint
is on codex/docs-owned-editor-activation; main remains64e905f5. The frozen broader
candidate's full database run remains live and is not a green-suite claim.

## Full regression repair and main reconciliation — 7 October 2026

Main is now64e905f5, pushed:00270b91 fixes complete-tree line naming and64e905f5
isolates recurring maintenance test fixtures. The candidate includes both main
checkpoints; the latest merge completed without conflicts. Its prior full run
finished with3929 passes,2 failures and zero skips (907152ms). Those failures were
a reproducible fixture scheduling leak and an unclassified identity-refresh route.
The corrected candidate focused rerun passes55/55 with backend typecheck/formatting;
main's focused rerun passes48/48. The new full candidate rerun is pending its own
result; neither focused evidence nor main integration proves the full ADR complete.
The temporary anchor qualification worktree is archived after its fix reached main.

## Normal-editor activation audit — 7 October 2026

Desktop `DocsView.openPage` and mobile `DocsSheet` still load with `getDoc`;
both normal `DocEditor` implementations persist/recover with `updateDoc` and
`getDoc`. The negotiated `getDocForEditor` / `updateDocForEditor` contract exists,
but these clients do not consume it. Merely changing the transport would leave
flat structural edits unaware of their owning quote/list item. The nested renderers
already expose exact leaf paths and an expected node snapshot; activation must
reuse the existing editing widgets with those paths and complete-page contexts.

A further prerequisite is `POST /docs/:id/anchor`: it still names an anonymous
leaf by updating only `docs.content`. On structured pages that violates the
structured-content guard. Preserve its existing read-authorized copy-link behavior,
text-match conflict check, idempotence and no-history semantics while naming the
leaf in its full tree and writing a matching projection atomically. Verify nested
anonymous leaves, viewer permissions, stale text, stable IDs and unrelated owners.
Then wire owned loading/saving, leaf/structural commands, task ticks, source editing,
history, recovery and collaboration in both editors; none is complete from helpers.

At application checkpoint38dcc9e3, fresh desktop and mobile typechecks and desktop
production build pass. Full database regression remains live. The same-origin web
preview retry is still rejected by a saved Browser Use block; no bypass attempted.
The booted iOS26.5 simulator displays its home screen, but native input fails with
noWindowsAvailable. Neither observation verifies authenticated Orbyn UI behavior.

Official OpenAI documentation was refreshed on7 October. The
[open-source registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
continues to document initial dynamic registration and reuse of the issued account
client identity without a secret or partner API key. The separate
[website guide](https://developers.openai.com/siwc/website) documents registered
website callbacks and selected-partner access. This does not establish the requested
browser-only plan-usage flow; desktop handoff remains explicitly incomplete.

## Database qualification restored — 7 October 2026

A new disposable PostgreSQL test server on loopback port 55436 restored database
verification without changing existing containers. The first structured-storage
run exposed a real extraction failure: inserting a format-2 destination did not
set the transaction-local structured-writer capability. Extraction now authorizes
that validated insert explicitly. Its regression also uses the documented 201
creation response. Added refusal coverage proves 401/403/400/409/429 requests
preserve source ownership/revision and create no destination page.

The fresh structured-storage, Docs and structured suites pass 63/63 with zero
failures/skips (6154ms). Full candidate database regression is now running;
this is not a passing full-suite claim or main promotion. Complete editor UI,
installed ChatGPT acceptance and the full ADR scope remain open.

## Extraction reference/footnote dependencies — 7 October 2026

Both extracted and retained pages now keep the supporting definitions their text
uses. Missing references and footnotes are copied with fresh identities, and
transitive/cyclic footnote dependencies close once. Literal code does not request
copies. Split duplicate definitions retain the original first reference binding
(including title) and last footnote binding, without removing authored duplicates.
Copied definition links use the existing cross-page relocation pass.47 focused
extraction/merge/reference/title tests pass (zero failures/skips,589ms); packages
build, backend types and formatting pass. The DB extraction regression now checks
a moved reference definition, but remains unrun. Candidate only; broader URL forms,
normal editor/CRDT activation, database/runtime and visual qualification remain
open. Main remains7263b45b; full ADR is not complete and no deployment is claimed.

## Extraction fragment relocation — 7 October 2026

Extraction now receives source/destination identities and relocates local and
explicit source-page block links on both resulting pages. Retained anonymous
headings acquire stable IDs when referenced; original heading slugs/exported
positions are resolved before splitting. Unknown fragments and code examples
remain authored source. Generated IDs cannot collide with stored container/leaf
or navigation-link identities. Destination inserts use the rewritten projection
alongside complete nodes.56 focused extraction/merge/reference/balanced-link tests
pass (zero failures/skips,714ms), packages build/backend types/format checks pass.
The DB extraction regression now checks a retained link following its moved task;
DB acceptance remains unrun. Candidate only. Reference/footnote dependencies across
extraction, wider app-link forms, normal editor activation and visual/runtime
qualification remain open. Main remains7263b45b; full ADR goal stays active.

## Unresolved-reference merge preservation — 7 October 2026

Merges preserve rendered unresolved reference text on both pages by escaping only
references that the other page's definitions would activate. Allocated source
labels also avoid unresolved shortcuts. Dangling footnotes retain their unbound
state; unsafe destination definitions cannot suppress valid moved links under
Markdown's first-definition rule.55 focused merge/reference/title/balanced-link
tests pass (zero failures/skips,709ms); packages build, backend types and scoped
format checks pass. Candidate only. Database merge acceptance, extraction link
relocation, normal editor/CRDT activation and full D1/U1 visual/runtime acceptance
remain open. Main remains7263b45b; no deployment claimed.

## Merged reference/footnote namespaces — 7 October 2026

Page merges now rename conflicting source reference definitions and their full,
collapsed and shortcut uses while retaining visible labels and definition titles.
Identical link definitions may share a label; allocated names avoid both pages.
Source footnote definitions/references receive distinct labels when destination
labels collide. Nested ownership and literal code/examples remain intact. Shared
reference-span detection now supports formatted visible labels without quadratic
lookup over all parsed runs.529 Docs unit tests pass (zero failures/skips,28,766ms),
shared package build/backend types/format checks pass. Candidate only; database
merge acceptance, unresolved-reference binding audit, extraction cross-page
fragments, normal editor and installed/visual acceptance remain open.
Remote main rechecked at7263b45b; no promotion or deployment in this checkpoint.

## Merged-page local link repair — 7 October 2026

Candidate page merging resolves source-local links before concatenation, updates
renamed target IDs and gives referenced headings stable IDs when their slug or
exported h-N position would change. Inline labels/titles and reference definition
source are retained; escaped examples, inline/fenced code and raw HTML stay
literal. Named empty leaves remain present so their anchors are not removed.
Fresh qualification:527 Docs unit tests passed, zero failures/skips (23,352ms),
shared packages built and backend typecheck passed. The database merge regression
now checks a moved local link, but test PostgreSQL55435 still refuses connections.
Reference-label namespace collisions, extraction cross-page fragments, normal
editor integration and installed/visual acceptance remain open. Candidate only;
main remains7263b45b and production deployment is not confirmed.

## Complete-content extraction candidate — 6 October 2026

Move-to-new-page now reads complete source ownership, retains quote/list wrappers
around selected leaves, leaves one link at the first selected position and saves
through the versioned writer. Checklist state follows the original task line;
continuations do not become duplicate tasks. New pages insert matching complete
nodes and leaf projections in the same transaction before comment/task/file
transfers. Stale selections are refused.31 focused extraction/merge/task/offline
tests, shared package build and backend types pass. A database extraction/history
regression is added but unrun while the test database is unavailable. Candidate
only; normal editor activation, link-fragment relocation and full D1 acceptance
remain open. Main remains7263b45b; no deployment or visual acceptance claimed.

## Nested checklist recovery — 6 October 2026

Complete-document revision merging now combines independent nested checkbox ticks
and named-leaf text edits, including native offline replay. Checkbox presence,
owner order and container metadata remain structural; overlapping text and
ambiguous empty-item changes retain conflict review.33 focused controls, operations,
task and offline replay tests pass; shared packages build and backend types pass.
Candidate only. Normal editor adoption/save/collaboration and installed/visual
acceptance remain unfinished. Main stays7263b45b; no deployment is claimed.

## Nested editor control contract — 6 October 2026

Candidate renderers now pass each leaf's exact ownership path to existing widgets.
Nested checkbox controls emit an explicit check-item operation with the rendered
node snapshot; the owner can reject stale events using applyDocContentOperation.
Read-only controls remain disabled, and native checkboxes expose checked/disabled
accessibility state.11 focused renderer/operation tests and desktop/mobile types
pass. This is not normal-editor activation: neither normal editor yet consumes
these renderers or the complete-format save path. Next: authoritative document
state, explicit structural commands, save/reconcile/offline and collaboration
integration on both clients. Visual/installed acceptance remains open.
Main remains7263b45b; no main promotion or production deployment in this step.

- Owned-editor offline checkpoint0ee17ce5 is now integrated into the working
  candidate at6aa74747. Cached/queued edits retain complete trees; native replay
  uses the versioned editor read/save and original tick baseline. Disjoint named
  leaf edits merge; overlapping ownership changes preserve drafts for review.
  Page concatenation helper is now doc-page-merge.ts; three-way revision merging
  uses doc-content-merge.ts.55 focused tests, shared package build and desktop/
  mobile/backend typechecks pass. No unresolved conflicts. Normal editor controls,
  recovery UI, installed visual behavior and runtime qualification remain open.

- Main checkpoint `7263b45b` is pushed: Home counts complete nested goal-plan
  checklists and current linked task status, including reopening. One batched
  task read covers visible plans and scopes shared block IDs by document. Project
  task totals retain precedence; missing/prose-only plans do not invent progress.
  Shared pure task projection and10 relevant main tests pass, as do package builds,
  backend types and formatting. Candidate8 Home tests pass. No database runtime
  or visual acceptance is claimed; broader document write changes stay candidate.
  Main was reconciled into candidate85ce3340; import/export overlap resolved with
  no source change to the tested candidate tree and no outstanding conflicts.

- Nested checklist task creation and versioned read/save synchronization use a
  separate task view, preserving first-paragraph IDs/types and list-item checkbox
  owners. Page write authority is required before task mutation.502 Docs unit
  cases pass; package/backend types/format checks pass. Two DB lifecycle/stale-tick
  cases are added but unrun; current test PostgreSQL55435 probeECONNREFUSED.
  Candidate only. Other task projections, normal-editor controls, extraction,
  moved fragments, agenda generation and complete D1/U1 matrices remain open.

- D1 page merges now preserve complete nested trees across mixed formats, rename
  colliding leaf/container IDs, and use versioned writes for target and inbound
  reference pages.75 unit regressions pass; build/backend types/format pass. Actual
  database merge regression added but not run. Candidate only. Task/checklist
  mapping, partial extraction, moved local fragments, agenda generation and full
  editor/collaboration/render/edit/export/privacy acceptance remain open.

- D1 capture/reflection appends preserve nested owners and identities through the
  versioned writer. Home reads root-owned Reflection with authorized privacy
  projection.63 unit regressions pass; package build/backend types pass. Two DB
  cases added but not run; Docker/database qualification and main promotion remain
  pending. Task extraction/restructuring, agenda regeneration, normal editor,
  collaboration and full D1 matrices remain open.

- Actual native factory now has compound account-switch provenance coverage:
  distinct profile tokens/enrollments, old executor cancellation, preserved slots/
  keys, replacement catalog and signed receipt binding, and ignored late transport
  response. Focused94passed and full ChatGPT441passed/0failed/0skipped,27263.063333ms.
  Test-only candidate checkpoint; no runtime change or main promotion. Server source
  also checks immutable provider choice, captured call binding/hash and expected
  model before new assignments. Real OS/OAuth/UI/DB acceptance remains pending.
  Latest Docker read-only probe did not respond; only that CLI probe was stopped.

- Provider eligibility now follows catalog readiness on both clients: no offered
  provider during loading/saving, offline/stale/unavailable state, absent/removed
  default, missing catalog or absent inference capability. Hint directs users to
  choose a ready device/default. Scoped main checkpoint `9e22e531` pushed; candidate
  reconciled main without conflict. Candidate440unit tests pass, main focused23
  pass, both client types pass with documented main mobile dependency mapping.
  No visual/real provider acceptance is claimed. Full ADR scope remains open.

- Provider save replies must match requested primary/account/device/fallback and
  advance the exact version. Unconfirmed replies/conflicts invalidate the revision
  and fence retained callbacks until reload; valid saves remain usable. Scoped
  main checkpoint `baf9e56c` is pushed. Candidate438unit tests pass; main focused12
  pass, desktop types and mobile types with existing WebView mapping pass. Candidate
  reconciled main without conflict. Real OAuth/OS/UI and full DB remain pending.

- Provider controls now reload after a token change for the same user and serialize
  mutations before a React rerender. Both clients reproduce the two baseline bugs;
  focused8passed and candidate ChatGPT434passed/0failed/0skipped,27480.8195ms.
  Scoped fix pushed to main `7c693b48`; candidate merged main without conflicts.
  Main focused8passed, desktop types and shared package build pass. Main mobile
  types pass with temporary mapping to already installed WebView13.16.1; normal
  main mobile typecheck still lacks that declared local package. Native OAuth
  candidate remains unqualified and unmerged. No deployment is claimed.

- Runtime audit reproduced React Native inference failure:
  `signal.throwIfAborted is not a function`. Shared executor lifecycle, provider
  request/stream reader and native transport now use the existing portable helper.
  Actual native factory tests with React Native AbortController complete mocked
  inference and reject pre-cancelled work without another provider request.
  `/tmp/orbyn-native-abort-all.log`:430passed/0failed/0skipped,28700.67175ms,
  exit0; API package build, mobile/desktop typechecks and diff checks pass.
  No live provider/installed acceptance is implied. Main remains unchanged.

- Native protected reads/writes/erases now sanitize native failures before app
  diagnostics. A failed credential read is `unreadable`, never missing; execution
  and cleanup reject without guessing identity or erasing unknown credentials.
  Recovery after readable storage returns is covered. Final
  `/tmp/orbyn-native-read-fault-all-final.log`:429passed/0failed/0skipped,
  26675.095583ms, exit0; mobile typecheck and formatting/diff checks pass.
  Model/default/provider provenance is next. Real OS/OAuth/UI, full database and
  main promotion remain pending. Test container is still exited; disk1.7GiB.

- Targeted inactive/unavailable account cleanup is wired into service and account
  MoreMenu. Strict copied ID/revision, fresh owner and protected identity checks
  preserve other active credentials/selection and reject stale/substituted targets.
  Full `/tmp/orbyn-native-target-cleanup-all.log`:427passed/0failed/0skipped,
  31658.248708ms, exit0. Mobile/backend types and formatting/diff checks pass.
  Read-fault handling, defaults/provider provenance, real OS/OAuth/UI and full DB/
  main qualification remain open; complete ADR scope is retained.

## Earlier checkpoint evidence

The entries below preserve their original verification scope. Remaining work may
have been superseded by the current state above; none proves whole-goal completion.

- Native Disconnect now retries exact server/key cleanup after credential erasure
  and continues independent cleanup on an erase failure without claiming removal.
  Token-free revocation confirmation is credential-revision bound; unknown provider
  cleanup stays visible across retries. Targeted unavailable-account cleanup and
  read-fault/installed acceptance remain open, along with model/default provenance.
  `/tmp/orbyn-native-cleanup-all-final2.log`:424passed/0failed/0skipped,
  29041.735958ms, exit0. Mobile/backend typechecks and formatting/diff checks pass.

- Native Add and targeted Reconnect are wired into service and Settings. Strict
  copied actions, expected revision, distinct protected slots, verified identity/
  permission and atomic selection preserve existing accounts. Unselected multi-
  account directory stays available after disconnect. Runtime/fixtures pass, not
  real OAuth/OS proof. Remaining multi-account recovery/default/provenance audit,
  installed platform screenshots and full database/main qualification stay open.
  Final `/tmp/orbyn-native-add-all-final2.log`:418passed/0failed/0skipped,
  28937.061916ms, terminal0. Mobile/backend typechecks, Prettier/diff checks pass.

- Native saved-account switch and bounded picker are implemented. Selection is
  explicit and revision-bound, with protected-slot/live-identity/fresh-grant/plan
  permission checks and previous-executor fencing. Captured-owner component tests
  pass. Add-account and targeted unavailable-account reconnect remain to implement;
  cross-account defaults and real device visual/OAuth acceptance are still open.
  Final `/tmp/orbyn-native-picker-all-final2.log`:409passed/0failed/0skipped,
  26543.954292ms, exit0. Mobile/backend typechecks, Prettier and diff checks pass.

- Native slot migration is now wired into Settings Connect and the service's
  exclusive ownership lifetime. The runtime resolves exact selected slots and
  retains signing aliases through refresh/retirement/disconnect/reconnect. Pending
  migration cleanup blocks execution. Actual service/UI tests cover cancellation,
  replacement sessions and signing alias changes. Full multi-account Add/switch/
  picker/catalog/default acceptance remains open; real device acceptance pending.
  `/tmp/orbyn-native-slot-integration-all-final.log`:400passed/0failed/0skipped,
  27014.848583ms, terminal0. Current mobile/backend typechecks and formatting pass.

- Resumable singleton migration composes directory and protected slots; it retains
  the native signing alias and removes the original only after exact directory
  publication. Nine focused cases pass. Final ChatGPT cohort:386 passed/zero
  failures/skips,25715.282458ms, exit0 at `/tmp/orbyn-account-migration-all.log`.
  Mobile/backend typechecks pass. Runtime/Connect activation is recorded above;
  this earlier checkpoint alone did not activate migration. Switching/picker remain.

- Protected account storage adapter implemented with device-only options, owner
  namespaces, shared in-process per-key queues, conditional rollback and UTF-8
  bounds. Thirteen source-module tests pass; mobile/backend types pass. Final ChatGPT
  cohort `/tmp/orbyn-protected-store-all-final.log`: 377 passed, zero failures/
  skips, terminal0, 27124.4235ms. It is
  not yet wired into singleton migration or the native account picker. No real
  keystore/OAuth acceptance or main promotion is claimed.

- Native metadata account-directory foundation is implemented and tested with owner/
  revision/CAS, duplicate identity, retirement and bounded-record checks. It contains
  no credentials and is not wired to SecureStore/Settings yet. Account selection is
  **in progress**: protected adapter wiring/migration/switching/model defaults/UI/runtime gates
  remain. `/tmp/orbyn-native-directory-all-final2.log`: 364 passed, zero failures/
  skips, terminal exit zero, 5854.532208 ms; mobile/backend typechecks pass.

- Desktop disconnect attempts local credentials/key, server and selection cleanup
  independently, including a locked keychain. A bounded optional enum result drives
  truthful notices for incomplete cleanup. `/tmp/orbyn-desktop-disconnect-all.log`:
  353 passed, zero failures/skips, terminal exit zero, 9138.619083 ms. Packages build
  and backend/desktop/mobile typechecks pass. Installed/live/full DB gates remain open.

- Desktop terminal refresh recovery now conditionally erases only the observed
  encrypted credential revision and stops its selected executor; newer sign-ins
  and temporary failures preserve credentials. Registration stays reconnectable.
  `/tmp/orbyn-desktop-terminal-refresh-all-final2.log`: 348 passed, zero failures/
  skips, terminal exit zero, 5534.425542 ms. Backend/desktop typechecks, CJS syntax,
  formatting and diff checks pass. Installed/live acceptance remains open.

- Native Disconnect retains only a protected verified registration mapping for
  later issued-client reuse. Active credentials are erased, and disconnected
  mappings cannot execute. `/tmp/orbyn-registration-retention-all.log`: 340
  passed, zero failures/skips, terminal exit zero, 7102.076334 ms. Mobile/backend
  typechecks and formatting pass. Installed/live and multi-account acceptance open.

- Confirmed invalid refreshes erase native credentials while retaining only the
  verified client/connection mapping. Reconnect reuses that client; temporary
  failures preserve credentials. Retired sessions cannot execute; Settings keeps
  recovery controls available. Candidate only; installed/live acceptance pending.
- `/tmp/orbyn-invalid-refresh-all-final.log`: 336 passed, zero failures/skips,
  terminal exit zero, 5881.278917 ms. API-client build and mobile/backend/desktop
  typechecks pass; focused 75-test recovery cohort passes.

- Real iOS OrbynChatgpt target build **passes**, terminal exit zero and
  BUILD SUCCEEDED at `/tmp/orbyn-chatgpt-native-module-build.log`.
  Expo prebuild and CocoaPods installation pass; effective module iOS minimum16.4.
- Full Orbyn scheme **fails** (exit70): embedded Watch companion needs the
  missing watchOS26.5 runtime. Temporary phone-only unsigned and simulator-signed
  QA builds both pass (exit zero); neither qualifies the full release scheme.
  Handoff: `/tmp/orbyn-native-build-handoff.json`. Signed app installed and opened;
  signup/sign-in screenshots retained in `evidence/chatgpt-native-startup/`.
  The unsigned keychain startup error disappears after simulator signing. This
  proves startup only; OAuth, protected credential writes, signing and inference
  remain unverified.

- `/tmp/orbyn-native-account-state-all-final.log`: 323 passed, zero failures/skips,
  terminal exit zero, 22326.398875 ms. Includes idle permission-off/corrupt account
  removal, stale UI callbacks, repeated actions and in-flight session replacement.
- `/tmp/orbyn-native-account-state-types-final.log`: mobile/backend/desktop
  typechecks exit zero.
- Expo autolinking discovers the native module on apple and android; JSON evidence
  is `/tmp/orbyn-native-autolink-apple.json` and
  `/tmp/orbyn-native-autolink-android.json`. iOS installed startup evidence is recorded above; Android installed acceptance remains open.
- Disk last observed at about 2.4GiB free. Docker CLI is responding, but the
  isolated orbyn-embedding-test-20261001 container remains Exited255. User recovery
  control is preserved; the fresh full database rerun remains pending.

- `/tmp/orbyn-native-revocation-all-retry.log`: 315 passed, zero failures/skips,
  terminal exit zero, 20750.7235 ms. First attempt exited 7 without final summary;
  only the successful rerun is counted.
- `/tmp/orbyn-native-revocation-focused.log`: 50 passed, zero failures/skips,
  terminal exit zero, 4547.22475 ms. Revocation, rotated tokens and failure cleanup.
- `/tmp/orbyn-native-revocation-types.log`: API-client build and backend,
  desktop and mobile typechecks exit zero.
- `/tmp/orbyn-chatgpt-native-full70.log`: frozen `6f04e8c7` regression **failed**,
  3351 passed / 49 failed / zero skips, exit 1, 713288.637375 ms. PostgreSQL
  connections terminated and Docker became unreachable; a new full run is needed.
- Simulator Computer Use now works with the installed Orbyn QA development
  build. Earlier Expo Go-only and unsigned-startup observations are superseded
  for startup, but not for OAuth/storage/inference acceptance.

- `/tmp/orbyn-native-refresh-coordination-all.log`: 304 passed, zero failures/skips,
  terminal exit zero, 18056.099292 ms. Includes simultaneous catalog/inference,
  live heartbeat during refresh, queued cancellation/session replacement and disconnect.
- `/tmp/orbyn-native-recovery-all-unit.log`: previous recovery cohort, 298 passed,
  zero failures/skips, terminal exit zero, 20081.157709 ms.
- `/tmp/orbyn-native-recovery-focused.log`: 16 passed, zero failures/skips,
  terminal exit zero, 1306.056458 ms.
- `/tmp/orbyn-native-refresh-coordination-types.log`: packages built; backend,
  desktop and mobile typechecks exit zero.
- Earlier simulator Computer Use returned timeout `-10005`; the fresh observation
  above supersedes that availability check, but installed-device behavior remains unverified.

Other area statuses above preserve existing handoff scope; they were not fully
re-audited during this recovery checkpoint. A passing unit/typecheck cohort does
not prove native installation, real OpenAI inference, deployment or ADR completion.

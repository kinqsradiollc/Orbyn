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

## Qualified structural/native editor checkpoint — 6 October 2026

Main is now869a8005, fast-forwarded and pushed with the exact fixed DB65 application
source. Full regression passed3,611 tests, zero failures and one existing skip,
terminal0,817364ms. Explicit structural operations and the native complete-page
callback/folding/layout contract are now on main. This does not finish normal
editor widget activation, stable task-item identity, CRDT or visual/native acceptance.

The newer complete-format offline recovery checkpoint0ee17ce5 remains outside
main, with81 focused tests, all workspace types and package/backend/web builds
passing. Its unchanged source is frozen for fresh fullDB66 in the independent
qualification checkout; inspect that terminal result before promotion. Full
C1-C6/M1/D1/U1 stays active. The user deploys main manually; preserve character
and user files and perform no final cleanup yet.

## Complete-format offline recovery candidate — 6 October 2026

Historical checkpoint imported from0ee17ce5. Main and running-session references
below are superseded by the current ADR tracker and task handoff.

Offline page saves can now retain their complete current and base document trees.
Native replay uses the owned normal editor read and atomic metadata/tree save,
including the original task-tick baseline; it never falls back to a flat writer.
Different legacy/full-format queued protocols remain separate entries rather than
throwing away the later edit during coalescing. Cached trees must match their flat
projection, and pending overlays update both representations together.

The shared three-way merge retains unchanged containers while merging disjoint
stable-ID leaf edits. Single-sided structural changes and identical echoes retain
all ownership. Overlapping edits, concurrently changed ownership, unnamed leaves
in two changed copies, mismatched page identities/projections/revisions and title
conflicts refuse for review; complete local/current/base data remain available.
This conservative conflict boundary does not complete CRDT or the recovery UI.
Normal editor widget activation, stable task-item identity and collaboration stay
required; existing legacy page merging continues unchanged.

The combined pure cohort passes81/81, including actual native outbox execution,
network interruption, cache corruption, mixed queues and existing legacy cases.
One interim assertion compared a VM-created options object's prototype with a host
object; the final test checks its exact keys and original ticksFrom value instead.
No application behavior was relaxed. All workspace types and package/backend/production web builds pass. Owned
formatting is checked before commit; fixed-head full regression remains required
before main promotion.
Main staysf7a2e2b6(applicationaea0c50c). Frozen structural/native candidate869a8005
continues fullDB65 independently; do not edit its checkout or start a second DB
suite while session76468 lives. Full C1-C6/M1/D1/U1 stays active, with no deploy,
release, visual/native completion or final cleanup claim.

## Qualified normal editor transport checkpoint — 6 October 2026

Main is now `aea0c50c`, fast-forwarded and pushed with unchanged application source
from the fixed DB64 run. The normal GET/PUT editor contract negotiates full content,
validates exact authorized leaf projection and saves title/metadata plus nested
ownership in one optimistic revision. Legacy writes cannot flatten a nested page.
Full fresh DB64 passed 3,592 tests, zero failures and one existing skip, terminal0,
824134ms. DB61's earlier 13 failures remain recorded; all affected files passed
79 fresh DB62/63 tests before the unchanged full rerun. No assertions or production
code were relaxed to obtain the full passing result. No production deploy or
completed normal-editor UI activation is claimed. The user deploys main manually.

The independent editor integration branch has structural operations committed as
`f21069bb`, 42 focused tests and all workspace typechecks passing. New native
owned-body fixes correctly route edit/task/table/image/accessibility callbacks to
complete-page indexes, retain full-page folding/embed context and accept explicit
cumulative parent layout offsets. Their six actual-component contract cases and
combined 48-case pure cohort pass; all workspace types pass. These follow-ups are
not yet on main. Native Simulator inspection again timed out with tool -10005;
no native screenshot/visual acceptance is claimed. Preserve every existing widget,
comments, undo, task links, offline recovery and collaboration during activation.
All C1-C6/M1/D1/U1 gates stay active; no final cleanup or release.

## Structural editor operations and regression follow-up — 6 October 2026

The normal editor transport candidate `aea0c50c` remains outside main. Its first
full DB61 run finished with 3,579 passes, 13 failures and one existing skip
(6,807,357ms). Rendering timeouts and time-sensitive channel/Study/rate-limit
assertions are preserved in `/tmp/orbyn-channel-normal-editor-aea0c50c-full.log`.
All affected files subsequently passed on fresh DB62/63: 57 plus 22 tests, zero
failures. This does not establish a passing full regression. The unchanged frozen
candidate is running again on fresh DB64 with an awake-only-for-run process;
no application promotion is claimed until its terminal result is inspected.

In the separate activation checkout, explicit tree operations now insert, remove
and move nodes, split list continuations and change task-item check state. They
retain container IDs, callout/list metadata and authored empty owners. Moves
resolve both owners before indexes shift and reject descendant cycles. Invalid
IDs, positions, tree budgets and stored text bounds refuse without mutating the
accepted document. Legacy operations remain format1; nested insertion requires
an explicit upgrade. Shared editor commands also fence page identity, revision
and exact draft ownership, including identical content on another page.

The pure operation/store/source/format cohort passes 42/42. Final workspace
qualification and a scoped commit follow. This is an editor prerequisite, not
normal editor activation, stable task-item identity or collaboration completion.
Next complete the existing editor widgets' owned loading/saving/selection and
structural commands on both clients, then task identity, offline/CRDT and legacy
writers. The full C1-C6/M1/D1/U1 goal remains active; no final cleanup or deploy.

## Atomic normal editor save candidate — 6 October 2026

The normal editor now has a strict shared metadata+complete-document contract and
one transactional save at revision+1. Existing authorization, private-memory rules,
filing/tags/file ACL, task synchronization, comment/suggestion anchors and postcommit
announcements are preserved. Hidden labels are restored before stored validation;
invalid content and lossy downgrades roll back metadata too. Structured saves keep
the complete previous typed revision in history. Flat and typed ownership cannot
be mixed. Shared client checks saved identity, exact projection and next revision.

Nine pure client cases pass. Fresh DB59 mounted/client cohort104/104 passed, then
DB60 repeated104/104 after adding complete structured revision-history assertions
and matching the content API's forced snapshot policy (0 failures/skips,terminal0,
12837ms). All workspace types, production web build and formatting passed before
the final history-only adjustment; affected files were formatted afterward. Full
combined qualification is next, before main promotion. Normal editor activation,
source/visual selection, existing widgets, task-item identity, offline recovery,
CRDT and actual visual/native checks remain required.

Separately, main4ddba094 application is the exact fullDB58 qualified source:
3585 pass,0 fail,1 existing skip,terminal0,872710ms. Documentation78052af4 records
that main checkpoint. Root character/user changes remain untouched. No production
deployment or final cleanup is claimed. Full C1-C6/M1/D1/U1 remains active.

## Normal editor read contract candidate — 6 October 2026

The negotiated normal GET /docs/:id now carries complete typed ownership alongside
ordinary metadata and its authorized flat projection from one current revision.
It uses the primary for capable readers, refuses unsupported/malformed declarations,
and never returns raw stored content_nodes. Private labels and task-state updates
are redistributed into the tree. The shared getDocForEditor validates identity,
revision and exact normalized flat/tree agreement; no second flat read/fallback.
Both container renderers now accept an existing-widget leaf callback with the
complete-page index, preparing reuse of the current editor widgets.

Seven pure client cases pass; all workspace types and production web build pass.
The new mounted read/privacy/security/freshness cases are not run yet: frozen
editor/suggestion fullDB58 session3956 on4ddba094 remains live in its independent
checkout. Fresh DB59 is next only after it terminates. Current normal editor
loading/selection/saves, CRDT, offline recovery, task-item identity and actual
visual/native acceptance remain open; these callbacks are not editor activation.
Main remains0b3cad2e (application93a30807). PR216 CI37377748532 has now completed
successfully across all four jobs. No production deployment or cleanup is claimed.

## Qualified shared editor and suggestion checkpoint — 6 October 2026

Main is now `4ddba094`, fast-forwarded and pushed with application source matching
the fixed full-run source. Fresh DB58 full regression passed3,585 tests,0 failures,
1 existing skip,terminal0,872710ms. This promotes the shared full-format source/
editor owner, paired container renderers and nested suggestion acceptance adapter.
Those foundations preserve ownership; they are not normal editor activation or
visual/native acceptance. Root character/user changes remain untouched.

The separate normal editor read candidate3a6e12d7 and atomic metadata/structured
save work remain outside main. New functionality must preserve every existing
widget, comments, task links, offline recovery, source selection and collaboration.
All C1-C6/M1/D1/U1 and deployment/cleanup gates remain open. The user deploys main
manually; no production delivery is claimed from this source checkpoint.

## Structured suggestion acceptance adapter — 6 October 2026

Suggestion acceptance now writes both the exact flat projection and nested
ownership in one authorized transaction. Existing leaf edits may not insert,
remove, reorder or reidentify leaves; those attempts refuse before enabling the
SQL writer. Complete typed validation precedes the update. The existing permission,
snapshot, task-state, comment/suggestion follow-up and announcement paths remain
in place. Ordinary legacy pages retain their flat format.

Four pure adapter cases passed. Fresh DB56 initially passed87/88; the sole failure
was a history fixture that incorrectly expected a new snapshot within the same
editing sitting. The repaired test starts a new sitting, retaining the existing
coalescing policy. Fresh DB57 passed92/92,0 failures/skips,terminal0,11201ms, covering
real nested suggestion acceptance, complete history/projection, unrelated leaves,
unauthenticated/foreign-account refusal and existing Docs/editing regressions.
This does not finish normal editor/CRDT or task-item adoption. The full current
candidate regression is the next qualification gate before main promotion.

## Structured editor adoption pipeline — 6 October 2026

| Order | Implementation                                                                                  | Current state                                                          | Completion evidence required                                                        |
| ----- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | Negotiate full-format reads in both normal editors; retain page metadata and revision ownership | Shared client/store/renderers implemented; normal editors still legacy | Paired loading, switching, stale-response, failed-read and full-tree assertions     |
| 2     | Connect source/visual selection, leaf saves, comments and suggestion anchors                    | Shared source ranges and stable-leaf replacement implemented           | Each existing block widget and comment/suggestion path retains ownership            |
| 3     | Give list tasks stable item identity and preserve task-state projection                         | Legacy task links remain leaf-based                                    | Checked-item import/edit/save/task-status/undo round trips on both apps             |
| 4     | Adapt legacy writers and collaborative updates                                                  | SQL guard refuses flat writes to structured pages                      | Typed adapters or explicit capability409 before effects; concurrent editors tested  |
| 5     | Complete imports, exported rendering and actual UI acceptance                                   | Export adapters implemented; editor/import/native matrices open        | Real Word/PDF/Mermaid/source round trips and web/native screenshots without overlap |

Writer audit identified existing flat writes in `service.ts` task extraction and
`addToPage`, `comments.ts` suggestion acceptance, `structure.ts` page movement,
`agenda.ts` and `agenda-summary-runs.ts`. The SQL guard protects stored structure,
but these paths still need adapters or clear capability refusals before broad
activation; a database refusal alone is not complete UX. Existing web `useDocYjs`
still seeds and exchanges flat blocks. Do not enable full structured editing with
that transport or replace the current editors with a reduced source-only screen.
These are implementation gates, not completed feature claims.

## Shared structured editor ownership checkpoint — 6 October 2026

The shared API-client `DocContentStore` now owns full-format reads, source and
stable-leaf edits, optimistic saves and remote observations. Accepted nested
content is immutable. Page switches fence delayed reads/saves; typing during a
save keeps its draft against the returned revision. A conflicting refresh retains
local source and exposes the remote revision separately. A failed observation
cannot block an otherwise valid optimistic save. Markdown conversion refusal
retains the complete visual tree; no flat or empty fallback is used.

Qualification: 29 pure store/source/format cases pass, all workspace typechecks
pass. Two initial test fixtures were corrected: a leaf used `kind` instead of the
actual `type` field, and an empty quote was representable rather than a refusal
case. The refusal case now uses tight adjacent paragraphs that cannot round-trip.
Normal web/mobile editor adoption, offline recovery, task-item identity and CRDT
remain pending. This shared controller does not claim UI or runtime acceptance.

Separately, frozen PR216 e9a93e98 has unchanged application source from5511d215.
Full DB53 ended3563/2/1; stronger private export expectations and the generated
catalog count were repaired. Fresh DB54 repaired cohort64/64 passed. Corrected
full DB55 session50150 and CI37377748532 remain running; mobile, Docker and mail
CI have passed. Do not start another DB suite or alter that frozen checkout.

## Paired structured editor contract candidate — 6 October 2026

A separate codex/docs-structured-editor-contract checkout continues from frozen
PR2165511d215 without mutating its full-run source. The shared source map retains
container paths, leaf indexes/IDs and exact CRLF offsets. Mismatched source/preview
ownership or metadata is refused, and source application fences a later document
reconciliation. Privacy-expanded source uses separately bounded projected parsing;
stored validation remains strict. Single-leaf visual edits preserve every parent/
item and reject missing, ambiguous or replaced identities.

75 pure source/format/container/editor cases pass. New web/desktop and native
container renderers reuse existing block widgets and complete-page references/
footnotes, retain legacy leaf numbering, show nested quote/list ownership and allow
callout folding. They are not wired into normal page loading, selection, saves or
CRDT yet. Existing legacy editors remain intact. Component compilation/source
contracts do not establish visual, native, overlap or runtime acceptance.

Next: connect the paired renderers and full-format source contract to revision-aware
loading/editing, task-item identity/status and collaboration; preserve comments,
selection and every existing block widget. PR216 full DB53 session98110 and
CI37376039791 remain independent; no second DB suite while the full run is live.
All C1-C6/M1/D1/U1 and manual visual/runtime/import acceptance stay required.

## Qualified main checkpoint — 6 October 2026

PR216 is merged as `93a30807`. Application source and migration252 match the tested
frozen `e9a93e98` exactly. Corrected fresh DB55 full suite passed:3,565 passes,
0 failures,1 existing skip, terminal0,749289ms. Prior DB53 failures3563/2/1 remain
recorded below; the repaired privacy/catalog cohort passed64/64 on fresh DB54.
CI37377748532 currently has mobile/Docker/mail success; backend/web is still in
progress. This is a qualified local full result, not a claim that all CI or actual
production deployment has completed. The user deploys main manually.

Shared source mapping, paired container renderers and the revision-aware editor
owner are committed/pushed on `codex/docs-structured-editor-contract` (application
checkpoint3a55777a). Its store/source/format cohort passed29/29, all workspace
types and formatting passed. Those changes are not in main or activated in the
normal editors. Both editor integrations, comments/task-item identity, CRDT,
legacy writer adapters, full import/render matrices and actual web/native visual
acceptance remain required. Full C1-C6/M1/D1/U1 stays active; no final cleanup.

Next implementation: full-format normal editor loading and selection on both
apps, then ownership-preserving saves, comments/tasks and collaboration. Existing
block widgets must be preserved; a reduced source-only editor is insufficient.

## Combined Docs full-regression repair — 6 October 2026

Frozen5511d215 full DB53 terminated1:3563 passes,2 failures,1 existing skip,
744869ms. Neither failure showed a new runtime exception: link-privacy's older
export assertion required a clickable private link, while the new exported safe
label deliberately omits its destination; mcp-catalog expected the old287 excluded
routes instead of289 after the new editor-protocol endpoints.

The privacy regression retains title redaction and authorized-owner assertions,
adds private page/task ID absence and preserves visible destinations. The generated
MCP catalog/docs are refreshed by npm run mcp:catalog; its equality test is unchanged.
64 fresh DB54 privacy/content/export/inventory/catalog cases pass,0 failures,
terminal0,23956ms. Original full failure logs are retained.

Current main07a61716 documentation is integrated with both histories preserved.
Application source is unchanged from5511d215 across backend/src, packages, desktop/
mobile source. A corrected frozen full regression and CI are next; no main
application promotion/deployment is claimed. Separate editor candidatebc619297
has75 pure cases/all types/web build/format and paired renderers/source contracts;
normal loading/selection/saving/task/CRDT integration and visual acceptance remain
open. All C1-C6/M1/D1/U1 and original scope stay required.

## Combined structured Docs qualification — 6 October 2026

| Requirement                                 | Current evidence                                                                         | Remaining gate                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| Storage/API/history/private-label saves     | 117 fresh DB52 mounted cases pass,0 fail, terminal0,26059ms                              | Frozen combined full regression               |
| Markdown/HTML/PDF/Word/plain-text ownership | 72 pure cases; mounted Markdown/Word/text routes; existing renderer exports pass         | Full structured render/visual/import matrices |
| Restore and capability inventory            | Current/past structured restore409; explicit editor transport exclusion passes inventory | Typed agent/CRDT/editor adoption              |
| Types/build/format                          | All workspace types, packages/backend/web builds and formatting pass                     | Final frozen head full/CI                     |

Earlier API357b58cd full DB51 terminated1:3554 passes,1 failure,1 existing skip.
The sole failure was unlisted GET/PUT /docs/:id/content in the capability inventory.
These interactive, negotiated editor-protocol routes are now excluded explicitly
as editor_sync; agents keep typed capability calls. The inventory assertions remain
unchanged and pass in the117-case DB52 cohort. This classification does not claim
structured agent-tool support, which remains part of adoption.

Main application stayse7232e11; main documentation516db089 is integrated into this
candidate, with both documentation histories preserved and no application conflict.
No application promotion/deployment, visual/native completion or whole ADR completion
is claimed. Both editors, task-item identities/status, CRDT, complete import/source/
render matrices, ChatGPT real acceptance and remaining C1-C6/M1/D1/U1 remain required.

## Plain-text and Word container exporters — 6 October 2026

The candidate now renders typed containers in plain text and Word, replacing the
previous temporary409 boundary. Quotes, callout headings, ordered starts, checked
items, continuation paragraphs and child code stay in content order. Word list
instances keep separate numbering; depths beyond Word's nine numbering levels
retain explicit text markers. The Word adapter checks exact authorized leaf/tree
projection equality before rendering, and uses the existing page-wide references,
footnotes and hyperlink authorization. Plain text resolves references once, keeps
escaped literal styling and uses global footnote numbers.

72 pure cases pass, including actual Word archive XML/numbering and real HTML/PDF
route inputs with stubbed renderers. All workspace types and backend/web builds
pass. The first backend typecheck caught lost narrowing of a paragraph leaf; an
explicit type guard repaired it. A mistaken pure cohort included export.test.ts;
its setup refused before DB access because TEST_DATABASE_URL was absent. It is
queued for the serial mounted cohort, and is not passing evidence.

Mounted DB52/full combined qualification, actual rendered/native visual checks,
Word import round-trip, complete editor/CRDT/source/import/export matrices and all
remaining C1-C6/M1/D1/U1 stay open. No application promotion or deployment yet.

## Structured export integration candidate — 6 October 2026

The legacy restore guard is committeddd2a06af. Markdown and HTML/PDF route adapters
now redistribute authorized leaves into their full container ownership. Exported
private references lose their destination and definition identifiers; code/math
literals retain authored source.56 pure route/parser/client/export cases pass;
backend types pass. The first VM route cohort failed because its injected scope
omitted the newly used export helper; binding the real helper retained the existing
primary/revision/visibility assertions and repaired the cohort.

Actual mounted Markdown/restore regressions await fresh serial DB52 after the
frozen API full DB51 run terminates. HTML/PDF route evidence uses real container
HTML passed to stubbed renderer boundaries, not a visual or real-render acceptance.
Word/plain-text nested exporters still require implementation; current409 refusal
is a temporary data-preservation boundary, not their final ADR state. Full source/
editor/collaboration/import/export/native/whole-app requirements remain open.

## 6 October — structured content API follow-up

Storage candidate4f45e904 completed fresh full DB49:3548 passes, zero failures,
one existing skip, terminal0,729911ms. CI37372176301 passed Docker; backend/web,
mobile and mail were cancelled. This is not an all-green CI result.

The API follow-up adds authenticated capability-negotiated content GET/PUT and
shared client identity/revision checks. Read projections have separately bounded
text limits; hidden labels are restored before exact stored limits are enforced.
Expanded private references now read/save without relaxing new-text storage limits.
88 fresh DB50 mounted cases and46 pure cases pass. All workspace types, packages,
backend/web builds and full formatting pass. Earlier pure fixture failures are
retained: leaf errors preserve the existing format-error contract; cancellation is
verified by propagated abort/reason rather than signal object identity.

Both editor/CRDT/task-item integrations, imports and export adoption remain open.
Projected HTML/source helpers are not proof of full editor source round-trip:
source switching still rejects trees that exceed stored/source bounds. No web or
native visual acceptance, production deployment, real-account ChatGPT inference,
whole-account quota verification or cleanup is claimed. Full ADR goal remains active.

# Authoritative implementation pipeline — 6 October 2026

Main application checkpoint is `8e792ecb` (PR215), pushed. The combined
quote/footnote candidate `5f5a1833` completed fresh full DB39:3498 passes,
zero failures and one existing skip, terminal0,733948ms. Its application source
matches merged main.131 parser/source/HTML/Word/export/layout cases and29 mounted
import/privacy cases pass; packages, all workspace types, backend/web builds and
full formatting pass. Evidence: `/tmp/orbyn-channel-doc-footnote-main-full.log`,
`/tmp/orbyn-doc-footnote-main-focused.log` and
`/tmp/orbyn-channel-doc-footnote-main-mounted.log`.

Word/reference privacy PR213 is merged `bb9c10f5`, repaired full3460/0/1.
CI37364955550 passed backend/web and Docker; cancelled mail/mobile jobs had no
executed steps. Attempt2 is queued. Views/Review available-width and native
wrapping PR214 merged `773f1441`, with18 focused passes and types/build/format.
CI37366765411 ended with all jobs cancelled; failed jobs were rerun. PR215
CI37366986451 passed mail/mobile/Docker; backend/web was cancelled, and was
rerun. No failing step was reported in these cancellations; no all-green claim.
PR212 attempt2 and PR211 final CI passed all four jobs.

The pushed, unmerged `codex/docs-structured-containers` candidate `20752130` preserves nested
quote/list typed children, IDs/source ranges and whole-page reference/footnote
context.94 focused and11 fresh mounted library-hierarchy cases pass; types and
backend/web builds and full formatting pass. Fresh immutable full DB41 is running
(`/tmp/orbyn-channel-container-20752130-full.log`); keep source frozen.
Storage/API versioning, CRDT and both editors/export
integration remain required. See [container integration gates](docs-container-audit.md#structured-container-candidate--6-october-2026).
This source candidate is not a shipped D1 feature.

Versioned content/source contract `04da502e` is pushed separately on
`codex/docs-container-storage-contract`.108 focused cases, all workspace types,
backend/web builds and whole formatting pass. It rejects unsupported formats,
unknown fields, duplicate/cyclic identity and lossy source/downgrade conversion.
The Docs API, database migration, revisions/history, CRDT and both editors still
need adoption; no new stored format is enabled. The serial full DB41 remains
frozen on20752130; this follow-up has no full combined qualification yet.
A fresh native Simulator selection again timed out -10005. No visual/native
proof or full-goal completion is claimed.

ChatGPT web handoff, feedback and selected-provider routing are already on main.
Web creates an opaque same-account request for desktop official authorization;
it does not launch an unregistered `orbyn://` scheme automatically. Real handoff,
successful eligible inference and whole-account plan/usage acceptance remain open.
Prior actual inference was refused for sharing quota exhaustion. No new chargeable
probe or invented quota was used. Unsupported hard-limit catalogs remain ineligible
for budgeted scheduling.

Browser5174 remains blocked by the tool's saved permission, and Simulator
inspection timed out -10005; no new visual/native acceptance is claimed.
Full C1-C6/M1/D1/U1 remains active and incomplete. Character/user files are
preserved, Docker is unchanged, user deploys manually, and cleanup remains later.

| Order | Work                        | Confirmed state                                                                            | Next implementation or acceptance                                                     |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1     | Docs quote/footnote/privacy | PR213/215 merged; repaired full3460/0/1 and3498/0/1                                        | Inspect rerun CI; actual editor/import/export acceptance                              |
| 2     | Structured Docs D1          | Experimental parser/source/HTML candidate;94+11 tests pass                                 | Stored/API compatibility, privacy adapters, CRDT and both editors; PDF/Word matrices  |
| 3     | Whole-app U1                | Responsive Views/Review, native wrapping and earlier settings/assistant checkpoints merged | Every page, narrow/collapsed/panel/large-text states and actual visual/native review  |
| 4     | Providers/agents C1-C6/M1   | Routing/catalog/plugin/separate runtimes/reflection/channels checkpoints merged            | Governing budget/collaboration/publication audit; real account/tenant/host acceptance |
| 5     | Production and cleanup      | Main checkpoints pushed; user files/worktrees preserved                                    | User deployment confirmation; final relevant integration and cleanup audit            |

## Main checkpoint notes retained during integration

## Updated main handoff retained during integration

## Current combined Docs checkpoint — 6 October 2026

| Work                           | Verified state                                                            | Next gate                                                             |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Structured storage/API/history | PR216 head5511d215, pushed;117 fresh DB52 mounted cases pass              | Full fresh DB53 running, session98110                                 |
| Container exports              | Markdown/HTML/PDF/Word/plain text adapters implemented;72 pure cases pass | Complete structured rendering/import/visual matrices                  |
| Build checks                   | Packages/all workspace types/backend/web builds/full formatting pass      | Frozen combined full regression and CI37376039791                     |
| Earlier API full               | 357b58cd DB51:3554 pass,1 fail,1 skip; terminal1                          | Inventory omission corrected without changing assertions; DB52 passes |
| Main                           | Application e7232e11, docs516db089; user work preserved                   | Promote qualified combined checkpoint                                 |

[PR216](https://github.com/kinqsradiollc/Orbyn/pull/216) remains draft, now contains
storage, capability-negotiated API, private-label limits, legacy restore protection
and ownership-preserving exports. Full log:
`/tmp/orbyn-channel-structured-combined-5511d215-full.log`.
Do not run another DB suite or mutate its frozen checkout while session98110 lives.
CI mail has passed; the other three jobs were in progress at this update.
No full-pass/merge/deployment claim is made.

The previous temporary Word/plain-text409 boundary is replaced by typed adapters.
Word archive checks establish XML/numbering/content order, not a rendered layout or
Word import round-trip. Both editors/CRDT/task mapping/typed agent integration,
complete source/import/render matrices, real ChatGPT authorization/inference and
truthful account plan/usage acceptance, whole-app UI and remaining C1-C6/M1/D1/U1
stay in scope. Character/user files remain preserved; no cleanup yet. Historical
sections retain original point-in-time results.

## Current continuation — 6 October 2026

| Checkpoint             | State                                                                    | Next gate                                                                                       |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Main application       | e7232e11; structured parser/source foundation delivered                  | Full editor adoption remains open                                                               |
| Storage PR216          | Frozen4f45e904 full DB49:3548 pass,0 fail,1 skip, terminal0              | Integrate privacy/API follow-up; CI Docker success, other three cancelled                       |
| Structured API         | Pushed357b58cd;46 pure and88 mounted tests, all types/builds/format pass | Frozen full DB51 running; session81935, log /tmp/orbyn-channel-structured-api-357b58cd-full.log |
| Legacy history restore | Local committeddd2a06af; backend types pass                              | New current/past structured-version refusal regression awaits serial DB52 after DB51            |
| ChatGPT                | Handoff/routing/catalog/defaults on main                                 | Real authorization/inference and truthful account plan/usage acceptance remain open             |

No structured API/storage promotion yet. A legacy restore could flatten a past
structured version after a flat downgrade; dd2a06af refuses both current and past
structured content before tick/history changes. Both editors, collaboration,
task-item mapping, imports/exports, whole-app layout acceptance and remaining
C1-C6/M1/D1/U1 are still required. Preserve character/user work; no deploy/cleanup.
Historical sections below retain their original point-in-time evidence.

# Authoritative implementation pipeline — 6 October 2026

Main application checkpoint is `e7232e11`, pushed: the shared structured
container parser/source/HTML foundation passed frozen fresh full DB41:3521 passes,
zero failures and one existing skip, terminal0,736272ms. Its application source
matches tested20752130.94 focused and11 mounted existing library-hierarchy cases,
all workspace types, packages/backend/web builds and whole formatting pass.
This is an internal foundation checkpoint; nested storage/editing is not enabled.

PR215 quote/footnotes remains merged8e792ecb, full3498/0/1. Its final CI
37366986451 attempt2 passed all four jobs. PR213 Word/privacy full3460/0/1 is
merged; CI37364955550 attempt2 passed backend/web and Docker, but mail/mobile were
cancelled without failing steps. PR214 Views/Review wrapping is merged; attempt2
CI37366765411 passed Docker, while other jobs were cancelled without failing steps.
These cancellations are retained, rather than reported as all-green qualification.

Storage follow-up [draft PR216](https://github.com/kinqsradiollc/Orbyn/pull/216)
is frozen4f45e904 oncodex/docs-container-storage-contract, pushed with current
main application integrated.54 pure and86 mounted storage/Docs/editing/deadlock
cases pass; packages, all workspace types, backend/web builds and formatting pass.
Fresh immutable full DB49 is live:
`/tmp/orbyn-channel-structured-storage-4f45e904-full.log`; CI37372176301 is queued.
Do not mutate this candidate during qualification. Main integration needed only
documentation conflict resolution; application source did not conflict.

The candidate stores ownership separately from the exact flat ACL/search/Study
projection, preserves structured history and blocks legacy content/collaboration
writes on format2 pages. Its internal atomic writer checks current ownership,
permissions, revision, capabilities, private labels, linked-task state and file
ACLs. Real concurrent migration/save locking and401/403/400/422/429 boundaries are
covered. Legacy format1 IDs retain the current contract; format2 requires valid,
unique IDs. Copied unreadable files stay unlinked and return404, matching the
existing ACL contract. Earlier fixture failures remain recorded.

No public structured editing API or normal format2 creation is enabled. Capability
headers, both editors, task-item mapping, CRDT, imports and HTML/PDF/Word export
adoption remain required. See [container storage gates](docs-container-audit.md#backend-storage-adoption-candidate).
All D1/U1 and governing provider/agent/page requirements remain in scope.

ChatGPT handoff/routing/catalog/defaults are already on main. Real web-to-desktop
authorization, successful eligible inference and whole-account plan/usage evidence
remain open; previous inference was refused for sharing quota exhaustion. No new
chargeable probe or invented quota was used. Unsupported hard-limit catalogs remain
ineligible for budgeted private schedules. Plugin/MCP and plan credentials stay separate.

Browser5174 remains blocked by the tool's saved permission; a fresh Simulator
selection again timed out -10005. No visual/native proof or whole-app completion
is claimed. Full C1-C6/M1/D1/U1 remains active and incomplete. Character/user files
are preserved, Docker is unchanged, user deploys manually, cleanup remains later.

| Order | Work                      | Confirmed state                                                                 | Next implementation or acceptance                                                       |
| ----- | ------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1     | Structured Docs backend   | Foundation on main; PR21654 pure+86 mounted pass; full/CI live                  | Inspect terminal qualification and integrate ready source                               |
| 2     | Structured Docs clients   | Versioned storage/source contract and internal writer candidate                 | Public capability API, CRDT and both editors; task-item mapping and all imports/exports |
| 3     | Remaining Docs D1         | Markdown/Mermaid/privacy/Word/footnotes checkpoints merged                      | Media/bookmarks/endnotes and complete render/edit/import/export family matrices         |
| 4     | Whole-app U1              | Settings/assistant and responsive Views/Review checkpoints merged               | Every page, narrow/collapsed/panel/large-text states and actual visual/native review    |
| 5     | Providers/agents C1-C6/M1 | Routing/catalog/plugin/separate runtimes/reflection/channels checkpoints merged | Governing budget/collaboration/publication audit; real account/tenant/host acceptance   |
| 6     | Production and cleanup    | Qualified main checkpoints pushed; user work preserved                          | User deployment confirmation; final integration and relevant cleanup audit              |

# Historical implementation pipeline — earlier 6 October 2026

Main baseline is `690f6246`, pushed; Slack PR204 merged after all four CI37321894816 jobs passed. User deploys manually; production recovery is not
verified here. The full ADR goal remains active and incomplete.

| Work                        | Confirmed state                                                                                                                                                                                                                                       | Next implementation or acceptance                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ChatGPT and model defaults  | Selected-provider routing, owned `/models`, defaults and web/mobile-to-desktop connection handoff on main                                                                                                                                             | Successful real-account Responses completion, real handoff and truthful whole-account plan/usage acceptance                                                              |
| Scheduled Agenda            | PR199 merged;2938 CI passes plus99 local focused passes. Resumption fixture repair passed18 cases and five independent repeats                                                                                                                        | Native/web controls and positive real-provider acceptance; unsupported hard-limit catalogs remain ineligible                                                             |
| Plugin provider integration | PR203 merged0faf19dc; exactff3c88ef all four CI jobs and full local suite pass:2975 pass/0 fail/1 existing skip                                                                                                                                       | External host/provider delivery and both client/native visual acceptance                                                                                                 |
| Agent channels              | Slack is qualified and merged. Teams identity PR205 passed its previous full local suite (3130/0/1); its CI recovery fixture repair6bda01e9 is being qualified. Transport/lifecycle and both client controls are implemented in a separate candidate. | Finish current full/CI; qualify migration, consent, delivery, retention and client controls; implement Teams current-card replies; real tenant/native/visual acceptance. |
| Docs                        | Source, Mermaid and earlier editor fixes on main; current pure matrix108/108 passes                                                                                                                                                                   | D1 native/editor/preview, PDF/Word/import/export and accessible rendering matrix                                                                                         |
| Whole-app UI                | Settings modal/search, assistant panels and narrow settings grid/theme checkpoints on main;15 grid/settings tests and web build pass                                                                                                                  | Full page-by-page desktop/web/mobile layout and interaction review, including narrow/overlay states                                                                      |
| Agents/pages/publication    | Prior runtime isolation, identity, ownership and maintained-page checkpoints on main                                                                                                                                                                  | Governing collaboration/reflection/publication requirement audit and external/runtime acceptance                                                                         |
| Production and cleanup      | Main checkpoints pushed; root user files and related worktrees preserved                                                                                                                                                                              | User deployment confirmation; final cleanup after all relevant work is integrated and preserved                                                                          |

Plugin automated qualification logs:/tmp/orbyn-plugin-ff3c88ef-full-local.log,
/tmp/orbyn-plugin-integrated-types.log and /tmp/orbyn-plugin-integrated-format.log.
CI37295933770 is terminal success. Earlier failed/cancelled runs do not supersede
this source's passing result. Browser Use still reports a saved Block for5174;
Simulator inspection times out -10005. No current visual/native proof is claimed.

All checkpoint notes below are historical evidence for their named sources;
they do not supersede this authoritative table or close the full ADR goal.

# Current plugin integration — 5 October 2026

Main7504be66 is integrated, including the narrow settings grid/theme repair and
stable Agenda resumption fixture. Only historical/current ADR and handoff text
conflicted; latest current state and both evidence histories are preserved.
All application source integrates without conflict. Full combined local and CI
qualification are required before PR203 promotion. Full ADR remains incomplete.

# Current checkpoint and implementation pipeline — 5 October 2026

| Work                        | Confirmed state                                                                                                                                                                                      | Next implementation or acceptance                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT provider connection | Handoff/status fixes on main; selected-provider routing on main                                                                                                                                      | Real web request to same-account desktop authorization and successful Responses completion; truthful plan/usage checks           |
| Scheduled Agenda            | PR199 merged as8dcc4bb1; all four CI jobs pass,2938 tests pass and one existing skip;99 focused local passes                                                                                         | Cross-client/native controls and real-provider acceptance; keep unsupported hard-limit catalogs ineligible                       |
| Plugin inference            | PR203 broker, consent, private receipts and worker implemented; integrated current main; full local run ended2971 pass/1 timing-sensitive fixture fail/1 existing skip; repair qualification follows | Inspect terminal results, promote qualified source, exercise external host and both client controls                              |
| Settings layout             | Late grid override removed; themed inputs/secrets;15 focused passes, backend/web types and web build pass                                                                                            | Browser/native visual acceptance; whole-app responsive layout audit remains open                                                 |
| Slack/Teams channels        | Slack signed-payload/current-card pure boundary committed separately;7 tests pass                                                                                                                    | Session-bound OAuth installation, encrypted credentials, durable outbox, callback/reply transaction, client controls; then Teams |
| Docs parity                 | Several source/editor/Mermaid/math fixes on main                                                                                                                                                     | Requirement-by-requirement D1 editor, export, import and native visual matrix                                                    |
| Agents and maintained pages | Runtime/identity and prior maintained-page checkpoints on main                                                                                                                                       | Complete governing collaboration/reflection/publication requirements and external/runtime acceptance                             |
| Deployment and cleanup      | User deploys main; root dirt and related worktrees preserved                                                                                                                                         | Confirm production recovery; cleanup only after remaining work is integrated and preserved                                       |

The full ADR goal remains active. Browser review again rejected5174 due to saved
Block, without workaround. Native Simulator review returned timeout -10005.
This table records implementation separately from runtime and visual acceptance.
Earlier checkpoint notes below are retained as history.

# Current integration — 5 October 2026

Main62f5e9a0 is integrated into the scheduled Agenda candidate. The only merge
conflicts were historical ADR/handoff notes; both sets are retained below.
No application source conflicted. CI37286333130 previously failed three cases:
legacy internal catalog shape and two cross-runtime fixed-clock fixtures.
Those repairs retain the original assertions, capacities and lease duration.
Backend typecheck passes. Exact merged-head qualification remains required.
Plugin provider candidatePR203 is separate; its own new broker/controls await CI.
Full ADR remains active; preserve native/visual and real-provider acceptance gaps.

# Agenda CI repair and main integration — 5 October 2026

Main `198e93e4` integrated into the Agenda candidate. Documentation overlaps
were resolved by retaining current main's handoff and preserving prior candidate
notes as history; no source conflict or user-file changes remain. CI37280711360
failed with2,913 passes,11 failures andone existing skip. Repairs: fixture owners
and their live recovery leases are cleaned between tests, remote UI harness
recognizes AgendaPrivateSettings, the model catalog retains its existing strict
response shape, and generated MCP catalog exclusions reflect both new private
routes. Original deadlines/capacities/assertions are unchanged. Focused remote UI
and NOWAIT cases13/13 passed; database/full qualification must run again before
promotion. These fixes are not yet qualified for main. Plugin launch-context
candidate c27a4a03 is separate draft PR201; pure10/10 and backend types passed,
HTTP/database and host acceptance remain unverified.

# Current implementation handoff — 5 October 2026

## Scheduled catalog compatibility repair — current candidate

CI37283750938 at86d850b9 ended2,925pass/2fail/1existingTesseractskip.
The earlier fixture cleanup, UI mocks and generated catalog repairs passed;
remaining failures required capabilities in the internal catalog and scheduled
settings contract. Restore sanitized capability metadata internally and require
explicit `include_capabilities=1` on `/models` to expose it. Ordinary requests
retain the original exact response shape for older strict readers. Both Agenda
settings hooks request the metadata; omission cannot enable bounded scheduling.
Four focused client/schema tests and all workspace typechecks pass. Added HTTP
opt-in and malformed query regressions remain to be run in full CI; local test
PostgreSQL is unavailable and unchanged. Main03c605e2 was integrated without
conflicts. This is a draft candidate, not scheduled feature delivery.

## Current main and active candidates — 5 October 2026

Main2f4108d7 includes Docs source-dialog focus PR202 (exact7f60b352,
CI37285248757 all four jobs passed; 2,862 backend pass, zero fail, one existing
Tesseract skip) and separate plugin launch PR201 (exacte7d629b0,
CI37285386062 all four jobs passed; 2,868 backend pass, zero fail, one existing
skip). User deploys main manually. Live browser/native visual acceptance and
external plugin host launch remain open; these CI results do not prove them.

Scheduled Agenda candidate50a92aa2 is in CI37286333130 after repairing the two
capability compatibility failures. Mail, Docker and mobile passed; backend
suite is still live. Do not promote before inspecting the terminal result.

Plugin managed-provider branch07214863 has a transport boundary, owner/provider-
bound default-off CAS consent, persistent receipt tables, retention and privacy
text. Four consent/schema/client tests plus ten transport/operation tests pass;
all workspace typechecks pass. Migration/HTTP tests are added but not run locally
because test PostgreSQL remains unavailable and user-controlled. Atomic daily
reservation, deduplication/unknown-outcome recovery worker, private status/results,
both client permission controls and runtime qualification remain unfinished. No
inference endpoint is mounted and this feature is not merged to main.

Full C1-C6/M1/D1/U1 remains active. Preserve all user/character files and unmerged
work; no cleanup or production deployment. Next: qualify current candidates and
complete the plugin broker and client controls, then continue retained whole-app
UI/Docs/provider acceptance.

## Docs source dialog focus checkpoint

Source validation no longer closes and reopens the desktop/web source preview
dialog. Escape reads current validation state, so invalid edits still block
dismissal; cleanup restores focus only when the dialog unmounts. The captured
dialog is closed even if React has already cleared its ref. Cross-client source
and preview checks31/31 and desktop typecheck passed. This is component/source
evidence, not visual acceptance; full D1/U1 and native/runtime checks remain open.

## Automatic desktop request watcher checkpoint

The desktop checks pending web/mobile ChatGPT requests on a zero-delay first
pulse once its Orbyn session is ready; subsequent polls keep the existing
15-second interval. Manager regressions now exercise the actual automatic
watcher: same-person claim and completion, other-account isolation, no duplicate
sign-in for completed requests, recovery from a transient poll error, and no
poll from an old timer after logout. All14/14 manager tests passed with no skips
(`/tmp/orbyn-chatgpt-web-watcher-tests.log`). These use synthetic OAuth/catalog
fixtures, not live provider authorization or native visual acceptance.

The request still requires the updated desktop app open on the same Orbyn
account. Browser-only authorization is not added. Full ADR remains incomplete.

## ChatGPT handoff feedback checkpoint

The web/mobile Connect button now distinguishes creating a request, waiting for
Orbyn desktop, and a request claimed by desktop. After 30 seconds unclaimed,
feedback says no desktop app has received the request and asks for the updated
app on the same Orbyn account; it does not assert that the device is offline.
The desktop prerequisite is visible before clicking. Shared feedback tests5/5,
remote UI rendered-component tests9/9 and desktop/mobile typechecks passed.
These are source/component checks, not a live web-to-desktop authorization or
visual acceptance. No automatic custom-scheme navigation was reintroduced.

Official plan authorization uses a local callback, unlike website identity
sign-in: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
and https://developers.openai.com/siwc/website. Browser-only plan authorization
is not provided by this checkpoint. Pending/claimed UI makes the actual handoff
state visible rather than implying a browser authorization has already opened.

Agenda CI37280711360 completed with 2,913 passes, 11 failures and one existing
skip. Candidate remains draft; inspect and repair the exact failed cases before
promotion. Its prior live-CI entry below is historical.

## Main checkpoints and remaining work

Main before this checkpoint is `198e93e4` (handoff feedback; PR200 is `9c5bb744`). User deploys main manually with the
normal deploy script; no production recovery or deployment is claimed here.
Earlier entries below are historical and do not describe current qualification.

| Scope                             | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                | Remaining acceptance                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production migration deadlock     | PR198 merged as `f816675b`; exact candidate `81ffb44e`. Existing `ai_jobs` is locked before pending batch SQL; only rolled-back 40P01 transactions retry, with at most three attempts. CI37279096979 completed successfully in all four jobs: 2,856 backend passes, zero failures, one existing Tesseract skip. Worker/prelock ordering and real deadlock/DDL rollback regressions executed.                                    | User's production deploy and recovery confirmation. Full local attempt failed when test PostgreSQL's tmpfs filled and its container exited; this is not a local full-suite pass.                                                                                    |
| Web ChatGPT connection            | PR200 merged as `9c5bb744`; automatic `orbyn://` navigation removed. The signed-in desktop runtime polls pending connection requests and opens official ChatGPT authorization. User explicitly waived test/CI waiting for this small adjustment.                                                                                                                                                                                | Actual web-to-desktop connection acceptance. Desktop must be running and signed into the same account; this is not browser-only OAuth.                                                                                                                              |
| Selected-provider feature routing | PR196 merged as `e0a432a5`; exact candidate `47541c63` passed 2,842/2,842 fresh local tests. CI37273639006 passed all four jobs, with 2,841 backend passes and one existing Tesseract skip. Docs/Study/project/capture/recording/interactive Agenda and maintained pages are routed through selected-provider contexts.                                                                                                         | Successful real Responses inference and whole-account usage/plan evidence; prior actual inference was refused for sharing quota exhaustion.                                                                                                                         |
| Scheduled private Agenda          | Draft PR199, exact `86d850b9`, includes source fences, durable scheduled runs, transactional Study link reads and NOWAIT target-page locking. CI37283750938 is live after repairs to fixture cleanup, model response compatibility, UI mocks and the generated catalog; mail, Docker and mobile jobs passed, backend tests remain running. Current pure page-lock/client/status checks passed 10/10 and workspace types passed. | Current concurrent-page-edit regression/full suite, complete source-writer matrix, native controls and runtime acceptance. Official SIWC does not expose the required hard inference limit capability, so budgeted scheduling cannot be enabled for those accounts. |
| Plugin boundary                   | Current source implements independent recipient-bound OAuth, live connector authority, protected-resource discovery, bounded UI/protocol adapters and private import-job cursors. See refreshed P1 evidence in the implementation review.                                                                                                                                                                                       | Managed/BYO provider execution, external host/tenant acceptance and deployment configuration. Launch contract is in draft PR201 (`c27a4a03`); CI37283493302 remains live. Plan tokens remain excluded.                                                              |
| Docs and whole-app UI             | Retain the complete D1/U1 contract; source and renderer checkpoints do not prove every viewport or interaction. Simulator is running but both name and bundle-ID inspection returned native tool timeout -10005.                                                                                                                                                                                                                | Full desktop/web/iOS/Android visual and behavior matrix, including narrow layouts, keyboard, overlays, diagrams, editing and exports.                                                                                                                               |

Full C1–C6/M1/D1/U1 remains active and incomplete. Next implementation priorities:
qualify scheduled Agenda without weakening tests; complete real provider execution
and usage acceptance; finish separate plugin managed/BYO execution and host
contracts; then close Docs and whole-app cross-client acceptance gaps.

Preserve root user files, characters and all unmerged candidates. No Docker
restart, database tuning, cleanup, production deployment or release is authorized
by this checkpoint. Docker recovery remains under the user's control. Do not
bypass the saved local Browser Use denial through another browser, port or CDP.

## Historical checkpoint — reflection integration

Main is e0afd266: PR189 Projects library merged after exact71f58c9f passed
2,534/2,534 local tests and all four CI37110461919 jobs. PR188 protected MCP
job resources merged as ee5e3278 after 2,533/2,533 and all CI37110025877 jobs.
Running previews still serve older checkouts; no latest Projects visual claim.

Current codex/overnight-reflection-integration integrates the retained reflection
candidate onto ee5e3278. Migration217 adds transcript/run dependency kinds and
reflection receipts. Source visibility retains current main restrictions. Scanner,
runner and resumed checkpoints apply current principal space restrictions;
mismatched scope owners fail closed. Integration tests caught unused untyped SQL
parameters and missing transcript dependency constraints, both corrected without
relaxing assertions. Final reflection focused tests and all workspace typechecks
passed; full qualification, selected-team tests, build, formatting, CI and newest
main integration remain required before promotion. Reflection is not shipped.

Continue full C1–C6/M1/D1/U1, including whole-app UI and mobile parity. User
deploys main manually. Preserve root user changes, credentials, characters and
all original branches/worktrees; no cleanup or deployment at this checkpoint.

## Scope and boundaries

Complete `docs/adr/001-devday-agent-platform.md` under the full acceptance contract
`docs/reviews/devday-2026-implementation-review.md` C1–C6/M1/D1/U1. Goal active and
incomplete. Every web/desktop feature needs mobile parity. Preserve root user
files and concurrent character work. Qualified main commits/merges/push are
authorized; no deploy/tag/release or cleanup. No subagents. Exclude voice and
computer-use product features and speculative Decisions adapter.

Home: concrete Muse/Dots-inspired workflows, all character presets, distinct
Background and Overnight profiles, honest activity/results/stopping states.
Primary sources: [Muse](https://introducing.muse.ai/) and
[Dots](https://learn.chatgpt.com/docs/dots/tasks-and-memory). Do not claim imported
computer/messaging capabilities or permanent active presence. Reflection and
collaboration remain required, not proven shipped by Home copy.

Web Home visual acceptance is delegated to the user's test server for this
increment. Do not bypass denied localhost web permission through different
ports, Chrome/native access or CDP. Offline private Chrome is only for synthetic
exports. Native Terms acceptance requires the human. Docker stays user-controlled.

## Main and qualification

- Main86ccd4f8: publication renderer PR166 merged after exact2a46a360 full
  local2,318/2,318 and all CI37073694699. Media PR164 merged as43812305 after
  exact88024f64 full2,298/2,298/all CI37071640135. Earlier PDF/image/HTML
  checkpoints remain merged. Root user files preserved; no deployment.
- Home profiles: assistant-runtime-integration/Orbyn, codex/home-agent-profiles,
  exact692cc0f8, draft PR165. Fresh local session70210 and CI37074275504 live.
  Log `/tmp/orbyn-home-profiles-692cc0f8-full-tests.log`.
  Previous64534482 local2,298/2,299 and CI37071883926 failed generated route
  catalog (248 vs249 private exclusions), now regenerated. Current focused32/32
  and all workspace types/build/format pass. Must integrate new main86 after this
  frozen run before final combined qualification. Native human sign-in pending.
- Current character/Orbyn now owns codex/docs-diagram-readability: local565032d3
  plus main86 merge. Larger Gantt bars/text/ticks and repeated-date suppression;
  final scoped16 checks pass with actual PDF font/bounds/spacing assertions.
  Synthetic current screenshot `evidence/gantt-readable.png` inspected. Combined
  focused/full local/CI qualification still pending. Existing media branch retained.
- assistant-work-ownership/Orbyn retains qualified publication-renderer2a46a360;
  clean. No further runtime changes there.

## Native QA state

Home UI source (unchanged by692 catalog/media integration) serves Expo Go at port8087 and test API8027, isolated marked
owned database recorded in `/tmp/orbyn-native-home-64534482-db.txt`. Metro needed
IPv4-first resolution to serve the simulator. Old cached build and old nonexistent
QA database are excluded from evidence. Current source reaches native sign-in.
Disposable test credentials are prepared, but final Sign in says it accepts Terms:
user has been asked to perform that action. Do not accept or inject agreement
state. Session credentials remain in a private temporary file, never in docs/logs.

## Preserved candidates and remaining work

- `codex/docs-source-preview` e7b018db / draft PR153: broad source/editor/UI/models/
  reflection/handoff candidate; extract and qualify scoped changes, no broad merge.
- `codex/docs-rendered-pdf` a039f271 / draft PR160: preserve combined candidate;
  previous CI font-test failure is not qualifying evidence; main PDF fixes are merged.
- `codex/pdf-deployment`501b4c09 and dirty devday plan/executor work preserved.
- model-catalog4f223040 plus two untracked settings previews and plugin-boundary
  a74ad26a remain acceptance candidates.

Finish ChatGPT credential-owning executor model catalog/defaults and separate
plugin integration, all Docs/editor/CommonMark/GFM/math/Mermaid/reference/source
preview/navigation/Word/native sharing/export/publication security acceptance,
whole-app UI parity and real screenshots/interactions, bounded durable Background/
Overnight collaboration and consented reflection. Gantt label presentation remains
known. Types/Expo export or synthetic component tests are not native delivery.

## Next actions

Observe fresh full suites and all current-head CI to terminal. Merge only qualified
exact heads against fresh main; preserve failures. Finish native Home/profile
interactions after human sign-in. Commit and attach a scoped publication-renderer
PR, then full current-head qualification before promotion. Reconcile parent/main
without conflicts. Continue all C1–C6/M1/D1/U1 gates; no premature goal completion
or cleanup. Disk is low: check before large builds, do not reinstall dependencies.

## Home review layout follow-up

`codex/home-agent-review-layout` in `home-agent-editorial/Orbyn` is a scoped
presentation follow-up atop frozen PR165 head5a298544. Research, exact copy/layout
changes and visual limits: `evidence/home-agent-review-layout.md`.
PR165’s matching-head retry completed2344/2344 with zero skips/cancellations,
terminalexit0; CI37077524911 all four jobs passed. Native acceptance remains open.
No main promotion, release, deployment or cleanup in this follow-up.

The new presentation focused checks pass13/13, all workspace types/builds and
full formatting pass. Matching-head full local and CI remain required. This
candidate is stacked on PR165; human native acceptance still outstanding.

## Latest checkpoint — scoped Markdown parity on main1100ca98

- PR167 merged after 2322/2322 local tests and all four exact-head CI jobs passed. Root main fast-forwarded; user mobile/app.json and untracked files preserved.
- Home PR165 current head0d6d307a integrates publication main86; previous692 passed2320/allCI. New head types/build/format/focused pass; full session77462 and CI37075657142 live. Integrate main110 only after observing that frozen run. Native human Sign in/Terms action remains pending; no UI bypass or acceptance claim.
- Current checkout codex/docs-markdown-parity has uncommitted scoped parser/references/six-headings/privacy/index and client context changes extracted from e7. Preserved broad source and publication branches remain available.
- Latest focused31/31 and all workspace types pass. Current build/format session13118 and current regressions session11995 live. Prior130 regressions passed before HTML definition suppression; standalone13 references pass after correction.
- Evidence: docs/reviews/evidence/markdown-parity.md. Latest logs under /tmp/orbyn-markdown-parity-*; external machine-readable handoff /tmp/orbyn-current-qualification-handoff.json.
- Next: inspect same handles, complete current export/API/security/migration qualification; source/preview and embedded-page reference context remain open. Commit a scoped reviewable candidate before full local/CI; merge only when actual required gates pass. Continue whole C1-C6/M1/D1/U1 goal.
- No deployment/release/cleanup. Web Home visual acceptance remains user-owned; native/editor/settings/model/plugin/reflection/collaboration qualification remains open.

Current Markdown build/format session13118 and regressions11995 completed with exit0: all workspace types/build/format, focused31/31 and regression130/130 passed. Candidate is ready for a scoped draft checkpoint; full/CI and editor acceptance remain open.

## Embedded reference follow-up

Current branch codex/docs-reference-embeds depends on Markdown89c3e2f9 (draftPR168; full33571/CI37076851819 live). Source-page privacy projection before section selection and reference map filtering are implemented in API and both clients. Focused41/41, all workspace types/build/format and final backend types pass. First test caught hidden destination context, fixed without changing its assertion. Native/editor visual and full current-head gates remain open. Home0d local2340 passed; CI37075657142 failed a recovery-worker race in the synthetic fixture; actual API-service test repair plus main110 integration are being qualified separately. Preserve native human consent and denied web UI boundaries.

## Latest Docs source/preview work in progress

Current assistant-work-ownership checkout is codex/docs-source-preview-ui on embed79fa1043, with uncommitted source-panel/map/component/menu/Unicode-deep-link work. Mapping/source-view/navigation18/18 passed; last typecheck rerun99447 pending. The inspector panels use current editor state, no second save path; native opening settles draft, panels fenced by doc ID. Ordinary editor fragment/fold navigation and embedded navigation context still require wiring; do not promote before those and actual runtime/UI gates. See evidence/doc-source-preview.md.

Model7f486 PR170 full81981/CI37078484222 still live. Home5a CI37077524911 passed; first local34365 ended exit7 without TAP summary, lsof confirms no writer; fresh marked retry25418 running. Embed79fa local2354 and allCI37077553749 passed. Markdown89c3 local2353/allCI passed. Native human Terms-linked Sign in remains pending. Main110 unchanged, user files preserved.

Disk reached216MiB; 267 closed temporary logs were preserved as gzip after excluding open writers, recovering847MiB. Manifest /tmp/orbyn-closed-log-compression-manifest.json; external handoff log paths updated where applicable. No worktree/branch cleanup, Docker restart, deployment or release.

## Source/preview and current-draft navigation checkpoint

`codex/docs-source-preview-ui` now wires ordinary editor heading/fold navigation
and source-owned embedded contexts in both clients, preserving parent reference
privacy. Current20/20 focused and115/115 combined checks pass; all workspace
types/build/full-format pass. First final typecheck’s wrong event import was
corrected without changing tests. Evidence: `evidence/doc-source-preview.md`.
Stacked on PR169; full matching-head local/CI and native/editor acceptance remain
required. Broader source editing and complete D1/U1 are still open.

## Latest native diagram checkpoint — 3 October 2026

Current dirty branch `codex/native-diagram-parity` is based on PR1722d5605f9.
Ten native synthetic families rendered; source/fit/zoom/actual size/pan and SVG
share-sheet opening were observed. Responsive canvas and tall-fit pan repair
passes16 component/download checks. Prior44 combined checks and types/build/full
format passed; rerun final source, then commit a draft and run fresh marked DB
full suite/CI. See evidence/native-diagram-parity.md. Native fixture Metro8091
current session57684, log/tmp/orbyn-native-diagram-qa-metro-7.log. No product
account/API calls were made by the fixture. Signed-in editor/Android/parent
scrolling and full UI acceptance remain open.

Latest other candidates: models149a91e9 full2350/allCI37080854903 success;
source2d5605f9 full2374/allCI37081138932 success; Home9232cfaa full2344/allCI
37081215076 success. All remain draft. Main1100ca98 unchanged; user files and
character work preserved. Full C1–C6/M1/D1/U1 remains active, no deploy/release/
cleanup. Native Terms human action and web user validation are still open.

## Latest code/metadata checkpoint — 3 October 2026

Current branch `codex/docs-code-metadata-ui` follows PR1732de8f72d. Code copy/
source controls and metadata naming/disclosure implemented on both clients.
Native iOS actual component source/highlight/copy and metadata disclosure
observed with screenshots. Menlo fixes iOS source typography. Focused17 and
regressions64 passed; all workspace types/build/fullformat passed, final targets
being rechecked. Record full frozen-head local/CI before promotion. Native
horizontal scroll attempt returned noWindowsAvailable; editor/Android/web
acceptance remains open. See evidence/code-metadata-controls.md.

PR173 full55274 terminalexit0 passed2402/2402 no skips/cancellations. All four
CI37085698130 jobs succeeded. It remains draft with editor/Android/web gates open.
Main1100ca98 unchanged. Other models/source/Home drafts remain automated-qualified
with runtime/native acceptance open. User-requested local preview5174/API8027
uses the marked native-home test DB; credentials are private in/tmp, not Git.
Keep preview servers running. No deploy/release/cleanup; goal active incomplete.

## Source editing candidate — latest 3 October 2026

Native-diagram-parity checkout now owns `codex/docs-source-editing`, based on
PR1749f5fed31; PR173's frozen branch/head is preserved. Source inputs delegate to
both editors' existing update/save queues in Editing mode only. Anchors remain
stable when retained; duplicates reject before that edit saves. Original parser
line spans map the exact typed source, including blank lines/CRLF/fences.

Initial source tests caught final-line anchor loss, fixed without weakening the
identity assertion. Native rapid typing exposed a caret/echo race: weak own-echo
tracking and one-time imperative caret positioning repaired it. Actual native
fixture typing, rendered preview, duplicate error and restoration were observed.
Screenshots in evidence/source-editing. Interleaved user input interrupted some
CUA actions; software-keyboard/swipe acceptance remains open. No fixture account
or API data is used; no server-save proof is claimed by its edit counter.

PR174 automated qualification: fresh retry8218 full2408/2408, all four
CI37087211471 success; old89842 stopped without TAP summary and is not qualifying.
Source candidate final100/100 regressions, typechecks, build and formatting
passed. Freeze a draft and run fresh full suite/CI. Full source/editor revision and
conflict/native/Android acceptance remain required. Main1100ca98 unchanged.
User delegates web visuals to manual verification while implementation proceeds;
no denied browser bypass. Full C1–C6/M1/D1/U1 remains active. Keep test web5174/
API8027 and private credentials/data alive, preserve user/character files. No
release/deployment/cleanup.

## Current ChatGPT model settings candidate

Checkout codex/chatgpt-model-settings is a scoped extraction on main110, preserving4f/e7 and the two untracked settings previews. Owned executor discovery, shared remote state, settings UI on both clients, and remote default refresh before private inference are implemented. Combined67/67, all workspace types/build and owned formatting pass. Full formatting flags only preserved user preview; not staged/edited. Exact-head full/CI and authenticated executor/native/editor/UI acceptance remain required. Markdown89c3 has local2353/allCI success but native/editor acceptance remains open. Home5a and embed79fa full/CI remain live. Full C1-C6/M1/D1/U1 goal retained; no deploy/release/cleanup.

## Model Settings qualification repair

PR170 prior7f486c06 failed full local2347/2350 and CI37078484222. The command-map
reason and actual native AI connections & models SettingsAnchor are repaired;
89/89 combined checks and all workspace types/builds pass. Requalify the new
commit, preserving original failure evidence and both untracked user previews.
No main promotion or M1/U1 completion yet.

## Combined UI review preview — latest 3 October 2026

`home-agent-editorial/Orbyn` now owns `codex/adr-ui-integration`, combining
Home9232cfaa, Docs3eb805d9 and models149a91e9. Frozen candidate branches retained.
Append-only docs/export conflicts resolved by retaining both; generated catalog
regenerated for combined routes. Focused163/163, all types/build/fullformat pass.
Evidence: evidence/adr-ui-integration.md. Full frozen integration qualification
and all runtime/platform gates remain required. No main promotion yet.

Preview5174/API8027 now serve this integration, existing test admin/data intact.
Marked preview DB migrated without reset. Explicit proxy configuration fixes
8008/8027 mismatch; proxied health/login/me/profiles/connections/executors200.
Private credentials are not in Git. Keep preview alive for manual user review.
Docs PR175 full96898/CI37089037682 remain under observation; never infer completion
from a timeout. Complete all C1–C6/M1/D1/U1; no deployment/release/cleanup.

## Views library discovery candidate — 3 October

`codex/views-library-search` in assistant-work-ownership/Orbyn starts at combined
UI e8dbcd7b; the original code/metadata branch is preserved. Both clients share
saved-view search and distinguish no matches from an empty library. Desktop
library scrolling and long headings are bounded; existing view filters/selection/
CRUD/layouts remain. Focused26/26 passed; types/build and exact-head full/CI still
required. Native keyboard/result/Android and user web visual acceptance remain
open. Evidence: `evidence/views-library-search.md`. Whole C1–C6/M1/D1/U1 remains
incomplete; no cleanup or deployment.

Docker engine has recovered. Its in-memory test databases were cleared; isolated
marked databases and preview admin were recreated. Preview health200; user must
sign in again with the same saved credentials. Fresh full runs for frozen
integration176e8dbcd7b and plugin180bc381226 are live, excluding the previous
ENOSPC run. Resources179 CI37091484961 has completed successfully. Other local
PostgreSQL's empty postmaster.pid restart loop was observed and left untouched.

## Source keyboard layout follow-up — 3 October 2026

PR176 e8dbcd7b has all four CI37089753616 jobs successful. Full local98342
terminated with exit7 after ENOSPC, with no TAP completion and no writable exit
file; it is not qualifying. Preview API logging also hit ENOSPC; API restarted
without growing that log, session1131, but readiness503 reports database
unreachable. Docker remains user-controlled. No main merge.

Native computer use reproduced duplicate-anchor error controls squeezing source
to approximately one visible line with the software keyboard on iPhone SE.
Isolated codex/docs-source-keyboard-layout preserves frozen PR175. Controls now
scroll within a measured share of the sheet's available height, retaining editor
space and keyboard taps. Focused25/25 and mobile typecheck pass. First test run
23/25 failed because adding a hook shifted a test's positional state index; hook
order now preserves the selected-block state index and all assertions pass.
Native updated layout/recovery screenshots still required: reload stalled while
fixture fonts were loading; temporary fixture removes its font-load gate for
layout-only inspection. This does not qualify production typography or saves.
Original reproducer screenshot: /tmp/orbyn-source-keyboard-qa/duplicate-error-keyboard.png.
Web permission still saved-denied; no bypass. Full ADR scope remains incomplete.

Updated native fixture rendered after manual Reload. With duplicate error and
software keyboard open, both source lines and caret are now visible above the
keyboard. Restore activated through accessibility and cleared the error/close
guard. Hint/error controls are bounded and some controls require scroll at this
size; native scroll attempt returned noWindowsAvailable, so touch scrolling is
still unqualified. Layout-only fixture bypassed its font-load gate; server saves
and production typography are not proven. Recovery screenshot remains outside
Git at /tmp/orbyn-source-keyboard-qa/restored-keyboard.png. No main promotion.

Recovery-first follow-up: the Restore control now precedes hints/status inside
bounded controls. Actual iPhone SE keyboard/error screenshot shows Restore,
both source lines and caret above the keyboard; accessibility activation clears
the error. Screenshot: evidence/source-keyboard/recovery-first.png. Focused26/26
and mobile typecheck pass. Touch scroll, Android and real editor saves still open.

## Plugin tool boundary structural limits — 3 October 2026

Isolated codex/plugin-tool-input-bounds follows frozen a74ad26a without editing
its original branch or the preserved node_modules link. Tool-call input now
checks finite JSON, at most 16 nested levels and 4096 values before policy/
capability dispatch. Existing 65,536-byte request limit, independent grant auth,
policy and execution remain active. Extra authority fields remain rejected.
12 focused JSON/resource/principal checks and backend typecheck pass. Initial
focused command failed due root esbuild platform installation; retry explicitly
uses the existing healthy Darwin binary without changing shared dependencies.
HTTP tests now assert excessive graphs400 with no argument echo; local DB gate
is unavailable, so those tests/full runtime are not claimed passed. OAuth host,
launch/resource/CSP/event/provider/tenant gates remain incomplete. No main merge.

## Plugin UI resource adapter — 3 October 2026

Isolated codex/plugin-ui-resources follows f74bb9de. The authenticated plugin
backend adds GET /plugin/resources and POST /plugin/resources/read, with strict
bounded identifiers and no arbitrary URL fetch. It reuses existing Orbyn MCP
cards and CSP declarations, filters resources by current registry tool scope,
and attaches resource metadata to authorized tools only when the existing card
UI opt-in is enabled. No browser session, first-party model default or plan
credential is introduced. Reads re-resolve the connector grant on each request.

9 focused resource/input checks and backend typecheck pass. Service assertions
cover401/403/400/429, UI enable/disable, disabled user, non-echoed host address,
metadata association and no-store; local execution awaits marked DB recovery.
Official source inspected: https://developers.openai.com/plugins/build/chatgpt-ui
(shared resource MIME, resourceUri metadata, CSP and portable tool fallback).
This is the separate HTTP resource adapter, not completed MCP-host launch:
transport/extension entry points, host screenshots, account-switch/provider and
async result/event cursors remain open. No main merge, deployment or cleanup.

## Separate plugin MCP transport — 3 October 2026

Isolated codex/plugin-mcp-transport follows frozen9d852b69. /plugin adds the
SDK's current and legacy stateless exchanges under the existing plugin-only
auth hook. Each request gets a server bound to its freshly resolved connector
principal and authorized catalog. It shares one dispatcher with HTTP calls,
retaining quotas, write revalidation/receipts, maintenance guards and activity.
UI resources remain opt-in and scoped. Discovery/list/read cache hints are
private with zero TTL; HTTP responses remain no-store. Unsupported legacy
session operations return405. Host metadata never chooses user or grant.

27 combined SDK/resource/input/principal/catalog checks pass, no skips. Both
legacy initialization and current2026-07-28 discovery/list/call were exercised
without external requests or DB. Structural input refusals happen before
invocation; unexpected errors are generic. Backend typecheck/build pass, final
service assertions being rechecked. HTTP401/403/400/429 assertions now include
the protocol path; local full/service runtime awaits Docker/marked DB recovery.

PR1776220f1c1 and PR178f74bb9de now have all four respective CI jobs successful
(37090985523/37091077562). PR179 CI37091484961 remains in progress. This transport
is not hosted ChatGPT/Codex launch acceptance: extensions, host screenshots,
actual account/provider/tenant execution and async event cursors remain open.
Full C1–C6/M1/D1/U1 continues; no main merge, deployment or cleanup.

## Plugin async reconnect groundwork — 3 October

codex/plugin-job-cursors preserves frozen plugin180bc381226. Local job-cursor.ts
binds a signed reconnect position to the current plugin principal, client/grant/
owner, plugin resource, job, source revision and effective authority. Expiry and
length/safe-integer bounds apply. Display renames/order do not invalidate equal
authority; scope changes, other accounts/grants/resources/jobs/sources do.
Derived key is domain-separated and must load outside read-only transactions.
Six cursor unit checks and backend typecheck passed terminal0. This is not yet
wired to a durable event store/async job route and is not a delivered C6 flow.
Implement live authentication, job/source revalidation and bounded durable event
retrieval before exposing results; keep current unsafe generic stored task reads
out of the plugin path. Do not promote dead groundwork as plugin completion.

UI qualification has priority: Home1834c6 and combined184509 failed the existing
shared font-scale ratchet (three CSS sizes). Combined recovered full finished
2505/2506 terminal1, no skips. Home repair1c00ed79 uses15/13/15, ratchet unchanged,
focused24/24. Combined newb0037a21 contains repair, no source conflicts, fresh
full42763 and build91303. Settings185d041 remains frozen while full62351 runs;
after terminal observation integrate the same repair, requalify its new head.
No main merge, deployment or cleanup; full ADR remains active.

## Plugin async import transport candidate — latest 3 October

Local codex/plugin-job-cursors now adds migration214, source-checked import job
store, shared fresh read/write grant transaction, bounded start/event routes and
response schemas. Cursor/store/protocol17/17 and actual plugin service13/13
passed terminal0. Actual start/replay and status persistence/duplicate/cursor/
visibility/Trash/shield paths are tested; file conversion completion is seeded.
See evidence/plugin-import-jobs.md for missing producer-grant guard at converter
writes and all remaining C6/ADR acceptance. Do not promote before that guard.
Final types/build/format and exact frozen full/CI remain required. No main merge.

Frozen combined184b0037a21 persistent full2506/2506 and settings1853b18468b
persistent full2512/2512 both completed code0, no skips/failures/cancellations.
All four exact-head CI37096051688/37096227442 jobs succeeded. These automated
results do not complete the remaining runtime/native/manual-web/host gates.
Preview services are detached and survive chat interruption. iPhone17 iOS26.5
now displays the actual Orbyn sign-in; the user-reported runtime startup recovery
cause is unverified. Saved credentials verified API8027 login200/admin, filled
existing password securely; human Sign in remains pending. No credentials in Git.

## Current combined qualification candidate — 3 October

A dedicated managed worktree adr-release-qualification/Orbyn combines
Views181ae6d11e7, native keyboard1776220f1c1 and plugin180bc381226, with main110
already an ancestor. Original candidates remain frozen/preserved. Conflicts only
in appended docs; both sides retained. Focused37/37, build and full formatting
pass. Backend/desktop types pass; mobile retry is live after adding the missing
existing react-native-webview dependency link (no source change). Evidence:
`evidence/adr-release-qualification.md`. Its own exact-head full/CI and runtime
acceptance remain required before main promotion.

Recovered UI176 full2474/2474 and plugin180 full2204/2204 both terminated0, no
failures/skips. Plugin180 CI37092219802 all four jobs passed. Views181 full and
CI37092992563 still live. Test preview now serves Views181 at5174 with API8027;
recreated admin login verified. Credentials stay private outside Git. Preserve
all C1–C6/M1/D1/U1 acceptance and original work. No deployment/release/cleanup.

## User Home/task density feedback — 3 October

User screenshots reject excessive repeated Home copy and the bulky task toolbar,
and explicitly reiterate the full application redesign. Local
codex/home-agent-summary starts from Views181, preserves integration176 and
combined182. It makes signed-in Home a compact header/two agent rows with help
behind disclosure, groups native actions, shortens task empty states and makes
responsive task controls compact without removing actions. Public Home moves
examples/result/pause explanations into expandable guides.

Actual native iPhone SE component fixture has loaded fonts and observed guide
open/close/character expansion screenshots in evidence/home-density. Account and
activity are mocked; lower-gallery scrolling unproven. User owns web visual
acceptance; no browser bypass. See evidence/home-workspace-density.md. Final focused 17/17, workspace/final client types, build and formatting passed
with terminal exit 0. Exact committed-head full/CI and combined integration remain required. Full U1 and
C1–C6/M1/D1 remain active; these changes do not complete the full redesign.

Combined18285b8b227 full local passed2502/2502 with no skips/failures; all four CI37093448880 jobs passed. Frozen Views181 ae6d11e7 full2477/2477/allCI passed. No main
promotion, deployment/release or cleanup.

## Remaining delivery pipeline — user tracking, 3 October

Every checkpoint retains full C1–C6/M1/D1/U1 scope and tracks implementation,
automated qualification, runtime/platform acceptance, commit and main integration
separately. No product voice/computer-use work; no deployment/tag/release.

| Order | Work                                                                                    | Acceptance                                                                                                           |
| ----- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | Current Home/task density correction on both clients and public Home                    | Focused/full tests and CI, native evidence and user web review                                                       |
| 2     | Combine correction with frozen PR182 inputs                                             | Latest main, resolved conflicts, fresh combined full/CI                                                              |
| 3     | Providers, embeddings, ChatGPT models/defaults and credential-owning executors C1/C2/M1 | Actual authenticated calls, switching/revocation and managed/BYO isolation                                           |
| 4     | Shell, profile refresh, onboarding, notices and all Settings U1                         | Persistence, keyboard, responsive and native flows                                                                   |
| 5     | Daily planning surfaces U1                                                              | Home/Agenda/tasks/events/Calendar/planning/focus/time/goals/routines/lists complete flows                            |
| 6     | Workspace surfaces U1                                                                   | Projects/stages/Views/Memory/Agent notes/Study, search/edit/saved state                                              |
| 7     | Docs C4/D1                                                                              | Typing/save/concurrency, source/preview, references/metadata/math/Mermaid/import/export and native flows             |
| 8     | Separate Background/Overnight workspaces and runtimes C3                                | Idle/activity, rules, budgets, approval/resume, reflection and collaboration                                         |
| 9     | Maintained pages/routines/comments, Slack then Teams C5                                 | Human edits and scoped access, deduplication and real delivery                                                       |
| 10    | Teams/permissions/Booking/sharing/publication C5/U1                                     | Access, revocation/expiry and responsive viewers                                                                     |
| 11    | Separate plugin backend completion C6                                                   | Async results/cursors/launch/host UI/OAuth, real host/account and current authorization                              |
| 12    | Security and full ADR acceptance                                                        | All destinations including Admin, every requirement proven across platforms; qualified main checkpoints then cleanup |

These are delivery dependencies, not completion claims or a reduced scope. Native
fixtures do not qualify real account/runtime delivery. User performs permitted
manual web visual review; Android and remaining native gates remain open.

## Settings workspace layout candidate and preview crash recovery — 3 October

`codex/settings-workspace-layout` in assistant-work-ownership starts from frozen
combined509ded3c, preserving Views181 and integration184. Web settings now has a
compact category rail beside bounded content; narrow layouts wrap categories
above content. Ordinary named buttons preserve keyboard activation, expose the
current category and control the labelled content region. Search keeps its
existing section selection/open behavior. Every existing settings destination is
retained. Mobile settings flows remain available; this web layout correction is
not a full Settings or U1 completion claim.

Four navigation/render/action/search/layout unit checks passed. Initial desktop
check caught a removed ShieldCheck import and stale shared package declarations;
restore the still-used icon, build own packages and use checkout-local @orbyn
aliases. Final owned-alias desktop typecheck terminal0. Build/format/exact-head
full/CI and user visual review still required before committing/promoting.

User reported preview crash: all preview listeners were absent. Web5174/API8027
and actual mobile Metro/web localhost8083 were restarted; all HTTP200, mobile
web bundle200 compiled1077 modules. Same-URL browser retry again rejected by saved
Browser Use permission; no alternate-surface workaround. Latest preview still
serves qualified Home candidate4c6e045d, not this settings candidate yet.

Local full processes20546/46406 were missing, no matching live tests, no terminal
TAP or exit files; they are interrupted nonqualifying runs. Frozen combined509ded3c
now runs fresh full tests in separate marked orbyn_adr_home_recovered_20261003_test,
log /tmp/orbyn-home-combined-509ded3c-recovered-full-tests.log, session77757.
CI183/184 backend jobs still observed running; other three jobs each passed.
Keep goal/full C1–C6/M1/D1/U1 scope active and all original work preserved.

## Main checkpoint and user-managed production rollout — 3 October 2026

PR184 b0037a21 merged as51c55e91 and PR1853b18468b merged as83d6aa83.
Local main fast-forwarded; the user's mobile/app.json and untracked files were
preserved. Main's committed tree matches the tested settings candidate3b18468b.
Combined2506/2506 and settings2512/2512 full local suites terminated0, no skips
or cancellations; all four exact-head CI jobs passed. Main CI37099735333 is
running independently. These are production checkpoints, not full ADR completion.

Thirteen superseded PRs were closed only after proving their exact heads are
ancestors of main:183,181,180,179,178,177,176,175,174,173,172,171,169.
Their branches/worktrees are retained. PR186 and broader unabsorbed candidates
160,153,151,148,138,137 remain open for distinct outstanding work/review.
No worktree or branch cleanup occurred.

The user explicitly chose to deploy main themselves. GitHub Deploy secrets and
AUTO_DEPLOY are not configured; no automated or manual production rollout was
started. Keep main merging qualified checkpoints and report the exact commit for
the user to deploy. Preserve full C1–C6/M1/D1/U1 acceptance, including native/
manual-web/real-account/host and remaining implementation gates.

## Plugin producer guard and main integration — latest 3 October

Guard457f2a49 follows frozen157ad6f1. Migrations215/216 follow main214; synchronous
and async plugin starts record immutable grant/client/recipient origin. Current
locked authority protects upload admission, post-stream queueing and converter
document creation. Real Word conversion plus13 denial variants and ciphertext/
key removal are covered. Serial30/30 terminal0, no skips/cancellations; backend
types and formatting passed. Only ADR/task append conflicts occurred when
integrating main947b0c23; both histories retained. Requalify the combined frozen
head before another main checkpoint. Remaining C6 protocol/host/account/provider
and full C1–C6/M1/D1/U1 acceptance stay open. User manages production deployment;
no deployment or worktree/branch cleanup. Native Sign in consent question pending.

## Maintained pages continuation — 4 October

Current mainfdaf13e2 contains merged Settings modal PR193, qualified local2580/2580
and CI37132802593 all four jobs. User deploys main manually. Primary checkout
user changes remain preserved.

Owned branch codex/maintained-pages-contract includes current main and local
A5 migration219, selected-block storage/context plus owner-only CAS management
routes/client methods. Focused28/28 and all workspace types pass; no public UI or
runtime consumes the bindings yet. No new PR/main merge until runnable end-to-end.

Next: persist binding/revision references in scoped jobs; claim schedules once,
respect Background/Overnight lane ownership and budgets; rebuild current context
before provider/resume/apply; document save must preserve human blocks, refuse
stale/moved/deleted ownership and fence linked task writes; baseline advances
only for an authorized successful agent save. Then both client explicit selection,
schedule/consent, pause/status/review; scoped @orbyn comments, edit/delete/retry
dedup and privacy. Finish real concurrency/revocation tests, full local/CI and
web/manual + iOS/Android inspection. Full C1-C6/M1/D1/U1 remains active.

### A5 guarded save follow-up — 4 October

Owned page-binding branch has an internal apply helper plus server-only
selected-block save processing. Current trust/action rules and separately locked
linked-task authority precede all writes; page history and binding baseline
advance atomically. Human blocks and unrelated task ticks remain untouched.
25/25 focused,118/118 broader Docs regressions and all workspace types pass.
No route accepts a client-provided approval flag. No scheduler/model/UI wiring or
production promotion yet. Next durable claims must carry binding and rule
revisions (IDs, not copied source text), preserve them across review/resume, and
use selected-block-only provider context. Preserve all broader acceptance gates.

### A5 scoped job checkpoint — 4 October

Migration220 and internal scoped-run helpers queue references only, bind original
rule/page/binding revisions, claim lane-specific unique leases, stage once, and
carry a unique owner-bound waiting card. Replaced workers cannot write/fail their
successors. Binding edits clear in-flight output; expired work releases ownership.
Final159/159 regressions include Docs/rules/worker lanes/storage/API/core/retention.
No model request or actual scanner/consumer is wired yet, so do not promote or
claim working page automation from these helpers.

Next wire selected-block-only provider execution with staged recovery; respect
current account/default model selection. Integrate the existing Overnight serial
queue, run/reflection slot limits, shared token accounting and morning results
rather than running a second parallel night consumer. Then both client controls,
scoped @orbyn comments and full runtime/native qualification. Main remains
fdaf13e2; user deployment and unrelated primary files stay under their control.

### A5 hosted execution / provider main candidate — latest 4 October

Owned maintained-pages branch has bounded real hosted provider execution,
pre-transmission reservation, staged recovery, immutable account model origin,
current Night window/policy and retained review consent. Explicit owner review
applies a saved patch immediately, including after the night window, without
resuming model work. Live doc/collection notices commit with the page; Study uses
its existing durable queue.209 regressions, all workspace types and build pass.

Compatible provider files were isolated from this unfinished feature:
PR194, branch codex/provider-completion-guards, exact4e0a246f based mainfdaf13e2,
worktree devday-model-catalog/Orbyn. Full persistent local qualification PID25912,
config /tmp/orbyn-persistent-provider-guards-4e0a246f.json; fresh CI pending. Main
merge requires local types/build/full plus exact CI success. No A5 files in PR194.
Provider guards include HTTP200 error-envelope key redaction, validated optional
output caps, and credential-free provider identity/configuration snapshots.

Next A5: connect actual producers/consumer to shared runtime slots; explicit fresh
source selection, account/default execution channel, budget/activity/undo, Night
serial slot/reflection/morning integration, both UI flows and @orbyn comments.
Do not promote the internal helper as completed automation. Full C1-C6/M1/D1/U1,
real-account/host/provider/native gates and user deployment remain unchanged.

### A5 owner review API checkpoint — 4 October 2026 (not promoted)

Owned document-run listing and nonce-bound decisions are available in the development
branch and shared client contract. Progress GETs neither create nor touch assistant
grants; they omit worker leases and hide proposals when current source or authority
changed. Decision transactions retain Night → grant → document → binding → run lock
ordering and reject stale/repeated cards. Successful saves synchronize Study.

Focused HTTP coverage passes15/15 with no skips/cancellations; all workspace types
pass. Evidence: `/tmp/orbyn-page-review-api-focused.log` and
`/tmp/orbyn-page-review-api-final-types.log`. This is not a visible/running feature:
service/shared-slot integration, sources, budget/activity/undo, both client controls
and the broader C1-C6/M1/D1/U1 acceptance remain open.

Main is now ee45ecf0: PR194 merged after corrected934e87d8 passed2582/2582
local tests and all four CI jobs37149341825. User deploys main themselves.

### A5 shared provider capacity checkpoint — 4 October (not promoted)

Chat and maintained-page claims now use the same transaction advisory lock and
count live leases across both queues. Background page work shares the existing
two Background slots; it cannot consume the four interactive slots. The separate
two Overnight slots and eight total slots remain unchanged. Expired leases and
waiting jobs do not occupy execution capacity. Mixed queue regressions prove
both directions, concurrent page claims and released capacity after expiry.

Verified45/45 (runs, owner review API, provider consumer, runtime lanes and runner),
zero skips/cancellations; backend typecheck passes. Evidence:
`/tmp/orbyn-page-shared-slots-verified.log` and
`/tmp/orbyn-page-shared-slots-types.log`. Earlier fixture failures are superseded
by this terminal code0 run; they are not passing evidence.

Still no service producer/consumer or client controls. Before activation, require
shared consumer lifecycle/shutdown recovery, mixed-version worker rollout safety,
Night per-person serial ordering/ten-run/reflection/morning outputs, explicit
source selection, budgets/activity/undo and all broader ADR acceptance gates.

### A5 consumer lifecycle and Night serialization — 4 October (not promoted)

Private Background/Overnight services now claim page work through their existing
lane runner, sharing process capacity, cross-replica leases and shutdown. Queue
preference alternates to avoid starving scoped work behind chat automation.
Interactive workers reject scoped automation. The runner stops each scoped job
once and waits for its cleanup. Uncharged or already staged work is requeued
without another provider charge; unknown charged requests remain held.

Claim guards serialize page and ordinary Overnight work for the same person.
The Night scanner sees queued/running page jobs before selecting or closing work.
Waiting human review does not occupy provider execution capacity. Different
people retain the existing two global Overnight slots.

Verified77/77 tests, no skips/cancellations, terminal code0:
`/tmp/orbyn-page-worker-lifecycle-final-tests.log`. Backend typecheck code0:
`/tmp/orbyn-page-worker-lifecycle-final-types.log`. Tests cover consumer recovery,
uncertain requests, process capacity/shutdown, exact approvals, mixed queue
claims, existing Night scanner behavior and original runner recovery. Source
wiring is present; a full live-service/page scheduling acceptance is still absent.

Next: actual bounded due producer with current source/authority; Night candidate
integration and ten-run/reflection slot accounting/morning results; safe rolling
upgrade activation; explicit sources, budgets/activity/undo; both clients and
complete ADR/local/CI/runtime/native qualification. Do not promote as finished A5.

### A5 bounded Background producer / service delivery — 4 October (not promoted)

The private Background service now scans due bindings once per minute in bounded
round-robin batches. It excludes disabled/suspended/revoked/expired owners,
paused/ended bindings, active jobs, inaccessible/AI-excluded pages and Night-owned
follow-through. Each candidate rebuilds current authority and selected context
inside the canonical transaction lock order. Reviewed deny rules stop queueing;
source/authority conflicts do not advance the schedule. Concurrent replicas queue
a due occurrence once. Selected unavailable models retain the existing defer
semantics without falling back to a different account/provider.

Verified79/79 tests, terminal code0, no skips/cancellations:
`/tmp/orbyn-page-due-service-tests.log`. Backend types pass:
`/tmp/orbyn-page-due-service-types.log`. New actual-service test starts the private
Background Fastify worker, observes its real due producer and hosted HTTP fixture
request, verifies ready200 and selected-block version2 save while preserving the
human block, then closes the worker. This proves local service delivery; it is
not real-provider/account or deployed production acceptance.

Night candidate/ten-run/reflection slot accounting and morning outputs remain
next. Safe rolling upgrade, explicit source selection beyond target blocks,
budget/activity/undo, web/mobile controls and full ADR qualification remain open.
Main is unchanged; this feature is still on the development branch.

### A5 Night plan, shared limits and morning progress — 4 October (not promoted)

Due page bindings participate in the existing Night candidate plan through
follow-through. Current source, page ownership and reviewed rules are checked
before selection and again inside queueing. They use the scoped page queue,
retain original consent/model provenance, and advance the Night cursor/run count
atomically. Queued/running pages serialize with ordinary Night work; the shared
ten-run cap and final reflection slot still apply. No private instruction or
page title is copied into the Night candidate labels.

The Night API now includes optional scoped page progress metadata. Current
assistant authority and page visibility guard it; no proposal words, worker
leases, credentials or hidden titles are exposed there. Page approvals remain
nonce-bound in their document API. Morning digest counts finished/review/settling
page work and links to the document; the existing single morning push also treats
page work as settling. Revoking the current scope hides its page progress.

Verified93/93 tests, no skips/cancellations, terminal code0:
`/tmp/orbyn-page-night-service-final-tests.log`. All workspace types pass in
`/tmp/orbyn-page-night-all-types.log`. New tests cover dedup/run accounting, shared
ten-run cap, reflection slot priority, current visibility and morning metadata.
An actual private Overnight worker test queues from the real scanner, calls the
local HTTP provider fixture once, stages required approval, reads the Night
progress, closes its runtime, then applies an exact owner decision without
resuming inference. Real provider/account/deployment acceptance is still open.

Next both client binding/source/consent/status/review controls and Night page
cards. Still open: explicit source selection beyond target blocks; budgets and
activity/undo; including page outcomes in reflection evidence; safe rolling
worker activation; verified account-default/device inference; broader full
local/CI/web/manual/native acceptance and complete C1-C6/M1/D1/U1. Main unchanged.

### A5 cross-client controls draft — 4 October (visual acceptance pending)

Web/desktop now has a bounded native modal; mobile has our native BottomSheet.
Both document menus flush pending edits and refuse unsaved/offline work before
opening Page updates. One shared portable controller owns fresh page/binding/run
reads, stable missing-block IDs through ordinary CAS document persistence,
selected-block create/edit, pause/resume/remove and exact waiting-card decisions.
Account switches prevent dependent writes and clear old evidence. Disposal and
React effect replay cannot restore an old result or leave the panel busy forever.

Both surfaces show selected blocks/instructions/daily or weekly cadence, saved
schedules behind options, recent status/token estimates and the actual saved
proposal in Markdown source before Apply/Decline. Pausing preserves the original
reviewed page revision; explicit Edit/Save reviews and rebinds current blocks.
The web native dialog owns focus/Escape; repeat buttons remain inside it, avoiding
our Select portal outside the browser's modal top layer. Palette/radius tokens
and native scrolling/keyboard sheet primitives are retained.

Shared controller4/4 unit checks pass, no skips/cancellations:
`/tmp/orbyn-page-controls-delivery-tests.log`. All workspace types code0:
`/tmp/orbyn-page-controls-delivery-types.log`. Production build code0:
`/tmp/orbyn-page-controls-delivery-build.log` (existing large-chunk warning remains).
These prove source/build/controller behavior, not rendered acceptance. The iOS
Simulator was reached with Computer Use, but it is still serving the prior preview
source; its existing planner429 overlay is not evidence for this draft's layout.

Next switch owned API/Metro previews to this branch against the marked preview DB
with migrations219-223, preserve the test admin, inspect/screenshot the new native
sheet, typing/scrolling/schedule/review states and correct layout. Web visual
acceptance remains human review under the explicit blind-redesign authorization;
no saved Browser Use block bypass. Add Night page cards on both clients, explicit
additional sources/budgets, activity/undo/page reflection evidence, rolling worker
activation and account/default device delivery. Full local/CI/native/ADR acceptance
still required before main promotion; full C1-C6/M1/D1/U1 remains active.

### A5 native inspection, schedule layout and Night cards — 4 October (not promoted)

Owned API/web/Metro previews now use this branch; migrations219-223 were applied
only after proving the preview database's `_test` name and server-side test marker.
The existing local admin/session is preserved. Persistent helper backups remain
in `/tmp/*before-maintained-pages`; current preview PIDs are recorded externally.

Actual iPhone17/iOS26.5 Computer Use verified saved page content, menu entry,
selected-block checkbox, instruction typing, weekly schedule creation, Pause,
paused Edit/Resume actions and reopening with retained selection/cadence. The
first run caught a real save guard bug: mobile's focused draft left a reference
`dirty` flag set after successful persistence. The new shared content/title
comparison accepts saved drafts and refuses changed/offline content. It has a
focused regression alongside the shared controller tests.

Both clients now collapse configuration when schedules exist and show schedules
and recent runs first. Add/Edit opens just the configuration section. Native has
an explicit accessible Close; its action was verified to restore the underlying
page without changing saved content. Night page cards on both clients open the
corresponding page; they are excluded from unrelated chat bulk decisions.
Screenshots: `docs/reviews/evidence/maintained-pages-ui/`. Before-layout and edited
form snapshots are labeled separately; compact paused view includes the final
Close control and singular block wording. Native scroll/drag attempts did not
move the earlier long form; this is not scroll acceptance. Software keyboard,
long proposals, Night cards, landscape/dark/large-text/Android and web rendered
acceptance remain open. HMR left an empty native modal once; returning to Expo
Home and reconnecting the owned Metro project restored it. No browser bypass.

98/98 combined store/controller/Night/reflection/page service/API/run tests pass,
zero skips/cancellations, terminal code0:
`/tmp/orbyn-page-native-layout-regressions.log`. All workspace types pass in
`/tmp/orbyn-page-native-acceptance-types.log`; final production build passes in
`/tmp/orbyn-page-native-acceptance-build.log` (existing large-chunk warning).
Rendered acceptance is limited to the interactions above, not the full app.
A new planner GET/items429 was observed after native dismissal; production
refresh/profile429 is explicitly still unresolved, not merely an old overlay.

Next exact proposal/approval native screenshots, Night page cards and manual web
acceptance. Then explicit additional sources and budgets, activity/undo and page
reflection evidence, rolling worker safety, real account/device delivery and
remaining full C1-C6/M1/D1/U1 gates. Main promotion/full goal completion remains
unproven; the disposable native schedule stays paused and production untouched.

### A5 native exact review and receipt follow-up — 4 October (not promoted)

A labeled proposal was staged through internal scoped helpers in the marked
local preview DB only. It is a UI fixture, not provider/inference evidence:
modelCalls0 and synthetic100 estimated tokens. Native UI showed the exact saved
replacement, then Apply changed the owned run to done and removed its waiting
card. The underlying document displayed exactly `UI fixture: a concise disposable
summary.`; authoritative DB check reported version6, done and waiting ID cleared.
The disposable schedule was paused and prior Night preferences restored.

Native Overnight displayed its separate page-result card and Open page action;
current screenshots are in `docs/reviews/evidence/maintained-pages-ui/` with
`fixture` in their filenames. Existing dev LogBox partially covered the review
buttons visually, although the native accessibility action and persisted result
were verified. This is not long-proposal/software-keyboard/Android acceptance.

Inspection also caught stale receipt metadata: external/maintained saves updated
content but left the old Saved time. Both editors now update receipt time on
accepted clean external changes and maintained-page callbacks; callbacks older
than the current page revision cannot regress it. All workspace types pass in
`/tmp/orbyn-page-review-receipt-types.log`. Native re-read displayed the newer
20-minute receipt instead of the old one-hour label. No local draft was overwritten.

Main/PR195 remains a separate compatible session-rate checkpoint. Corrected e4ed6749
passed CI37157146020 all four jobs. Its local full run completed2396 checks without
failures before sessions.test.ts stalled with an identical IPv6 local/peer TCP
endpoint and no registered PostgreSQL connection. That confirmed transport stall
was cancelled and recorded externally, not called passing qualification. A new
fresh marked IPv4 full run is live; merge still waits for complete local evidence.

Next: complete that qualified main checkpoint and bring it into this branch,
then complete explicit extra sources/budgets, activity/undo and page reflection,
rolling worker activation, real account/device execution, remaining native/web
render acceptance and full C1-C6/M1/D1/U1. No A5/main or whole-goal completion claim.

### Session refresh rate-limit candidate — 4 October (qualification pending)

The observed local429 burst contained288-311 requests/minute from web and mobile
sharing loopback; steady traffic was27/minute. A compatible backend-only candidate
counts global authenticated app requests per verified live device session instead
of sharing an IP bucket. Session identifiers come from indexed current DB lookup;
no raw token or client-supplied identity becomes a bucket. No authorization is
cached/skipped. Expired/deleted/disabled/forged sessions fall back to IP, and
route-specific stricter session limits remain IP-based. Existing API-key/MCP
buckets, threshold180, gateway burst limits and authentication behavior remain.
This addresses shared-address interference, not all possible429 causes or
production deployment acceptance.

Focused134/134 regressions pass in `/tmp/orbyn-session-limits-verified-regressions.log`.
Low-limit tests now start a fresh verified session rather than pretending a new
IP resets that device's window. The first helper version imported the DB pool
before test setup finished; it was corrected to dynamic imports after the marked
DB check. That failed run was cancelled after verified connection failures and
is not passing evidence. Workspace types pass in `/tmp/orbyn-session-limits-types.log`.
Build/full fresh DB/CI and controlled runtime qualification are next.

Candidate lives on codex/session-refresh-limits in devday-model-catalog/Orbyn.
No unfinished maintained-page files are included. A5 remains f8780ee6 in its own
branch; all source/budget/activity/undo/reflection/device/native/whole ADR gates
stay open. Main remains ee45ecf0; user handles production deployment.

### Session rate-window qualification follow-up — 4 October

Exact c82b0d22 full local run terminated code1:2568/2587 passed,19 failed,
no skips/cancellations. CI37155960329 passed mobile/Docker/mail and failed
backend-and-web. No merge was attempted. Every local failure traced to fixtures
that reused a device session across unrelated cases or treated a new IP as a
fresh global window. Fresh independent sessions now isolate those windows;
long template/picture suites use an independent device session per case.
The prior authorization-proof time is copied exactly, never refreshed by the
fixture. Lazy backend imports preserve both marked DB selection and each file's
local renderer/environment setup.

148/148 corrected affected regressions pass, no skips/cancellations:
`/tmp/orbyn-session-limit-window-verified-regressions.log`. New checkpoint/fresh
full run and exact CI are required; c82's failed full run is not qualification.
Product thresholds/stricter routes/gateway/API-key/MCP behavior stay unchanged.
A5/native work remains separate and incomplete; main remains ee45ecf0.

### Qualified main checkpoint and workspace layout draft — 4 October

PR195 merged exact e4ed6749 after full fresh IPv4 local2588/2588 code0, no skips
or cancellations, and CI37157146020 all four jobs passed. Main/origin main now
7f253b80; the primary checkout fast-forwarded with user changes preserved. This
addresses authenticated session/IP interference; production deployment remains
with the user and universal production429 resolution is not asserted. Qualified
main was integrated into the maintained-pages branch. Only two documentation
append conflicts occurred; both histories were retained and markers cleared.
The owned preview API restarted with the qualified session bucket implementation.

U1's new signed-in workspace layout draft now spans every web/desktop screen:
compact sidebar/wordmark, header rail toggle, quieter location label, consistent
working-surface padding and cards, unrestricted Docs canvas width, smaller Home
panels and a task toolbar with separate title/progress and search/layout/filter
rows. Desktop/tablet rail geometry uses one224px/72px pair; existing800px mobile
web drawer breakpoint stays aligned, and coarse-pointer controls retain44px
minimum targets. Palette/radius tokens are used and public landing/auth/dialog
surfaces retain their separate styling. Navigation controls now reference the
same accessible sidebar landmark and report expanded state.

Source-contract4/4 checks pass in `/tmp/orbyn-workspace-layout-contract-tests.log`;
final desktop types pass in `/tmp/orbyn-workspace-layout-final-types.log`.
All workspace types/production build pass in
`/tmp/orbyn-workspace-redesign-final-types.log` and
`/tmp/orbyn-workspace-redesign-build.log` before final aria-only control wiring.
These are source/build checks, not overlap or visual acceptance. Browser Use was
retried at the original127.0.0.1:5174/app tab and again denied by saved permission;
no alternate browser/port/CDP/indirect bypass was attempted. User's standing blind
web redesign/manual screenshot review authorization applies. The live preview
serves this draft; rendered web acceptance remains pending.

Next complete remaining whole-app layouts and manual web/desktop acceptance,
retaining native behavior/feature parity. A5 extra source selection, per-binding
budgets, activity/undo/page reflection, rolling worker activation and actual
account/device inference remain open, along with full C1-C6/M1/D1/U1 gates.
No workspace/A5 production promotion or full goal completion is asserted.

## 2026-10-04 — chat layout and contextual suggestion feedback

Scope clarification: character configuration belongs exclusively to Background
and Overnight. Those agents need separate identities and profiles as well as
separate runtimes. Interactive chat uses Orbyn and does not force character setup.
Independent per-agent saved identity/configuration remains open; the legacy
Background/Overnight identity is still shared.

The collapsed-sidebar screenshot revealed competing chat/workspace CSS and an
obsolete 148px character header. The draft now gives chat viewport rules priority,
uses a compact aligned header and centers the empty heading above its bounded
composer. Search fields use one wrapper focus indicator. Connection controls now
expose desktop connection instructions on web/mobile; direct web/mobile ChatGPT
sign-in and verified device inference remain incomplete.

Shared chat actions now request fresh model-generated task suggestions, priorities,
plans and reflections from authorized context. Prompts request evidence/citations,
separate inferred patterns from observed facts, avoid invented commitments and
require review before task creation. The invented personal example task was removed.
These action labels are requests, not already generated recommendations. No extra
background inference or refresh-time AI calls were added.

Home quote selection still draws an excerpt from the person's selected page.
Automatic AI Home task suggestions and context-based quote/excerpt selection are
NOT complete. Next implement a bounded, consented generation pipeline with source
references, freshness/invalidation, account isolation, current visibility checks,
no duplicate tasks and explicit AI-written reflection labels. Reuse Background
outputs where appropriate; preserve separate Overnight execution and review.

Validation: all workspace typechecks passed and focused regression checks 9/9
passed (no skips). iOS was inspected and captured at
`docs/reviews/evidence/interactive-agent-separation/ios-context-actions.png`:
new actions/composer are visible without overlap in the current portrait viewport.
Production web build passed. Source tests are not rendered web acceptance or live model-output validation.
Browser permission remains blocked; user-authorized manual web screenshot review
applies. No main promotion, production deployment or full ADR completion asserted.

## 2026-10-04 — independent automation identities checkpoint

Background and Overnight now have distinct persisted name/persona/character
settings. Migration224 copies each existing legacy identity into two independent
rows once; later saves are owner/lane-bound and compare an expected revision.
Concurrent or stale saves return409. Defaults for new accounts use lane names.
First-party identity routes reject API keys, unknown lanes/bodies/query arguments,
and rate-limit writes. They do not alter grants or make either worker active.

Interactive chat retains Orbyn with no automation persona. Automation context
reads the relevant lane identity. Profile snapshots and both Home companion cards
read the separate identities. The client validates returned lane/revision metadata
and suppresses save broadcasts after an account change. Web/mobile settings have
Background/Overnight selection, a reload action and a compact character preview;
detailed appearance editing opens only when requested. The original shared
`/me/agent` interface remains for legacy integration compatibility and no longer
controls these two runtime identities after migration.

Evidence: API/migration3/3 pass in `/tmp/orbyn-lane-identities-api-final2.log`,
including simultaneous save CAS, account separation,401/403/400/422/429 coverage,
legacy snapshot preservation and owner-delete cascade. Client/profile/runtime
contract8/8 checks pass in `/tmp/orbyn-lane-identities-final-units.log`.
All workspace types and production build passed on the final source checkpoint
(`/tmp/orbyn-lane-identities-final-source-types.log` and
`/tmp/orbyn-lane-identities-final-source-build.log`). Final native spacing adjustment
has its own typecheck in `/tmp/orbyn-lane-identities-final-native-types.log`.

Native iOS was actually operated: switch to Overnight, edit name, save, switch to
Background (unchanged), return to Overnight (saved name persisted), then restore
the fixture name. Screenshot `docs/reviews/evidence/automation-identities/ios-overnight-saved.png`
shows the compact editor. `ios-compact-identity-restored.png` shows the selected
segmented control after fixture restoration (a final10pt gap separates it from
Reload). `ios-restored-fixture.json` records the verified local
test database's independent revisions and restored names. Native drag/scroll APIs
returned noWindowsAvailable; accessibility clicks brought controls into view.
The screenshot still includes the old planner429 LogBox. Broad native layout,
keyboard/landscape/large-text, Android and web rendered acceptance remain open.
Preview test database was marker-verified, migrated and owned API restarted.
No production migration/deployment, main promotion or full ADR completion claimed.

Next qualify a frozen branch head, then isolate qualified production checkpoints.
Continue automatic grounded Home suggestions/reflections, A5 source/budget controls,
activity/undo/page-reflection, actual device inference, external host acceptance
and whole-app C1-C6/M1/D1/U1 requirements. Existing execution lanes remain separate.

### Frozen qualification correction — independent identities / A5 capability mapping

Checkpoint `deffbfc4` is committed and pushed. Its full fresh marked test-database
run was stopped after a confirmed failure in `agent-no-ai.test.ts`: six maintained-
page control routes were classified as hosted inference with no declared twins.
The failed run is not passing evidence. Cancellation and exact head are recorded
in `/tmp/orbyn-lane-identities-deffbfc4-cancelled.json`.

Inspection shows these six routes configure/inspect owner-approved bindings and
review results; they do not expose model execution to outside agents. They now
use the existing `assistant_control` classification, preserving first-party
restriction. The maintained-page feature has an explicit outside-agent equivalent:
`fetch`, `get_history`, `edit_doc` under the connection's existing grant and its
own model/scheduler. It neither enrolls hosted work nor approves hosted output.
A dedicated contract asserts this separation while the existing import-graph
shield still checks all capabilities for provider/hosted-run imports. The old
unused global identity lane helper was removed so it cannot suggest that the two
new persisted profiles still share a settings object.

Focused API/migration/client/import-graph/parity7/7 checks passed in
`/tmp/orbyn-lane-identities-parity-followup.log`. A fresh full run on the corrected
frozen head is still required. Web/manual review, native wide/keyboard/large-text,
Android, automatic Home recommendations/reflections, A5 source/budget/activity,
reflection evidence, verified device inference and external host gates remain
open. No main promotion or deployment is asserted.

### Route inventory qualification follow-up — 4 October 2026

The exact `6974d65c` route-inventory preflight found the new GET/PUT lane identity
routes were not classified. That run was stopped on this confirmed same-head
failure; `/tmp/orbyn-lane-identities-6974d65c-cancelled.json` is not passing evidence.
Both endpoints now explicitly use `assistant_control`; they remain first-party
and cannot be reached by connected agents. The complete route inventory,
model-free import-graph/twin shield and identity API/migration checks now pass
12/12 with no skips in `/tmp/orbyn-identities-inventory-parity-final.log`. The
focused identity schema/runtime/client checks pass4/4 in
`/tmp/orbyn-identities-parity-units.log`. All workspace types pass in
`/tmp/orbyn-identities-parity-final-types.log`. A fresh exact-head full suite remains
required before main promotion; full ADR and visual acceptance remain open.

## 2026-10-04 — SIWC plan/usage priority and narrow-panel feedback

User priority: use the official Sign in with ChatGPT flow; a pre-issued client ID
is not needed for local dynamic registration. The pasted prototype starts with
`dynamic_agent_client`, receives an issued ID and uses granted plan credentials.
Existing desktop OAuth already follows that pattern with persistent installation
host ID, PKCE/state/nonce, bounded loopback callback, retained registration,
verified ID token and protected credentials. Do not add a partner client-ID gate
to this local flow. The official website identity flow is distinct; a local
127.0.0.1 callback reaches the browser's computer, not a hosted API. Direct web
sign-in/connected-device inference is still incomplete and remains highest priority.

Official sources inspected: cookbook article `sign-in-with-chatgpt`, SIWC website,
self-hosted VMs, models-and-inference, token-reference and errors-and-recovery.
OpenAI authentication metadata is opaque. Do not invent Plus/Pro tier claims,
remaining quota or reset times from identity tokens or error codes. Identity,
granted plan permission, live model discovery and completed inference are
separate evidence states. Account and workspace registrations remain separate.

A desktop `verify-plan` metadata command now sends one fixed short test through
the selected account/default model's private runtime. It requires granted plan
access, fresh account model discovery, nonempty output and response.completed.
The receipt is account-bound, records the actual used model, time and only valid
provider-reported input/output/total token counts. Missing/invalid counts stay
unknown. Account switching/closing the runtime drops this receipt. It is a proof
for that completed test request, not a guarantee of future quota or plan tier.
The renderer cannot supply arbitrary test content or credentials. Quota and
eligibility errors remain terminal and do not change billing. Errors preserve
sanitized machine code, HTTP status and request ID; no provider body is echoed.

Desktop settings expose Verify plan access (explicitly describes the small test)
and Manage ChatGPT usage. Web/mobile expose the same official usage-settings link
and remind the person to choose the corresponding ChatGPT account. Remote/native
verification receipts and actual user-chat plan inference remain open; this is
not full cross-client plan verification or remaining-allowance delivery.

The narrow chat drawer uses available chat width via ResizeObserver, a single
History/Upcoming open state, bounded overlay width, scrim, close/Escape/Tab focus
behavior and inert conversation controls. Opening global navigation closes chat
panels; opening a chat panel closes global navigation. Duplicate header controls
are hidden under the overlay. Manual web layout acceptance is still pending.
Home fixtures now use separate lane reads/subscriptions and real functional state
updates. Account changes hide prior identities immediately. Generated MCP docs
were regenerated after inventory changes. The stopped ee0cd5a2 full run had11
failures (ten Home old-fixture dependency failures and the catalog mismatch),
not four; cancellation is recorded and is not passing evidence.

Evidence: plan/UI49/49 focused checks pass in
`/tmp/orbyn-priority-plan-ui-final-tests.log`; inventory/catalog13/13 pass in
`/tmp/orbyn-priority-plan-inventory-tests.log`, all without skips. All workspace
types pass in `/tmp/orbyn-priority-plan-final-types.log`; production build passes
in `/tmp/orbyn-priority-plan-final-build.log`. The owned preview API was restored
and health returned ok after a PostgreSQL connection terminated unexpectedly.

User-requested browser diagnostic: original127.0.0.1:5174/app was explicitly
rejected by saved Block preference. An unrelated example.com page opened via the
same Browser Use surface. Screenshot `evidence/browser-access/example-com-control.png`
is public diagnostic evidence, not Orbyn web acceptance. No alternate port,
Chrome, CDP or indirect blocked-preview inspection was attempted. Full frozen-head
local/CI and actual OpenAI account authorization/inference acceptance remain
required; no main promotion, deployment or whole ADR completion claimed.

## 2026-10-04 — one-button ChatGPT provider authorization follow-up

User clarification: MCP is a separate Orbyn data/tool connection. Provider
settings must offer one Connect to ChatGPT button, start authorization directly,
let the person finish OpenAI sign-in/consent, and return to updated connection
state. Remove Connect on desktop and the intermediate sign-in-settings tutorial.
ChatGPT-primary chat routing and a separately chosen Orbyn-default fallback are
now the immediate next implementation priority. Neither is claimed delivered.

Migration225 adds bounded, ten-minute, session-bound authorization handoffs.
First-party web/mobile start a request; the signed-in credential-owning app for
the same person claims it once and calls the existing dynamic SIWC flow directly.
Web's opaque app link speeds up that handoff; the app also watches explicitly
requested pending handoffs for cross-client initiation. Different accounts,
replay, expired/revoked initiating sessions and other claimant sessions cannot
complete a request. OpenAI codes/tokens are absent from handoff storage and app
links. The user still finishes actual OpenAI consent. No MCP grant is minted or
changed. Original/claiming Orbyn sessions and current verified connection are
rechecked before completion. Hourly sweeping deletes expired handoffs.

Web/mobile now show Connect to ChatGPT and bounded, cancellable status polling;
no sign-in-settings redirect is part of the primary action. The installed,
signed-in credential-owning app is still required for this local OAuth callback
flow. Pure hosted-browser OAuth and native-only local callback ownership have not
been invented or claimed. This limitation must remain visible in qualification.

Focused source/API/client/UI/inventory tests pass70/70 with no skips in
`/tmp/orbyn-one-click-full-focused.log`; all workspace types and production build
pass in `/tmp/orbyn-one-click-final-source-types.log` and
`/tmp/orbyn-one-click-final-source-build.log`. Current native controls were actually
inspected in dark mode and captured at
`evidence/chatgpt-one-click/ios-connect-usage-controls.png`, showing one provider
Connect action, refresh and usage management without overlap. No actual OpenAI
account consent or live plan inference was performed. The test preview was
marker-verified and migrated through225; the helper's fixed console message still
says224 and is not the migration-version authority.

The desktop fixed verification request and measured usage receipt remain in this
candidate; availability, permission and completed inference remain distinct.
Web/mobile can view official usage settings; no account tier, remaining allowance
or reset time is fabricated. Actual composer/job routing through the user's
ChatGPT account, signed execution results and explicit default-provider fallback
remain open before production promotion. Full C1-C6/M1/D1/U1 scope is retained.

### 4905456e full qualification correction — 4 October 2026

The full run was stopped on confirmed failures and is not passing evidence.
Replay/rules failures coincide with PostgreSQL connection termination and recovery
mode57P03. A healthy marked-database rerun of those actual suites passed37/37 in
`/tmp/orbyn-490-replay-rules-recheck.log`; no product assertions were removed.
Model-control fixtures lacked new core/API/session/error imports and used one
state cell for every React hook. They now model separate state/ref slots and
functional state updates. Existing bounded-search, disabled/offline selection
and model/default behavior checks remain. Font styles were moved onto the shared
11/13/15/18/24/36 scale; no checker exception was added. Neatness and model UI19/19
checks passed in `/tmp/orbyn-490-style-ui-followup.log`.

A separate attached model worktree is on `codex/chatgpt-execution` for the actual
inference transport. Its workspace package builds are isolated; preserved preview
files and the former dependency symlink remain intact. Runtime request/receipt
contracts and encrypted request storage are in progress there, not delivered.
Continue ChatGPT-primary routing and explicit Orbyn-default fallback first, while
retaining every C1-C6/M1/D1/U1 requirement. No main or production promotion claimed.

## 2026-10-04 — signed ChatGPT inference broker foundation (not delivered routing)

Execution work is isolated in the attached `devday-model-catalog/Orbyn` worktree
on `codex/chatgpt-execution`, based on current source checkpoint0de9ca3d. Its
workspace package links point to its own builds; preserved preview files are
untouched and the former dependency symlink remains backed up under/tmp.

Migration226 introduces bounded per-job request storage with encrypted prompts
and results, a two-minute expiry and one active request per job. The internal
runner queue captures the current owned account, model, enrollment/lease epochs,
input hash and nonce. No HTTP endpoint accepts arbitrary prompt input. A claim
requires the exact enrolled Orbyn session and current lease/catalog/account.
Publication verifies an Ed25519 signature covering the exact request identity,
nonce, epochs, model and completed/failed result. Replays, forged results, changed
leases, another owner and inactive/unverified-source jobs are rejected. Input is
cleared on completion/cancellation. Runner result reads recheck current job/source
access. These are storage/contract gates; no device polling endpoint, processing
loop, composer integration, fallback choice or live provider result is delivered.

Backend types pass in `/tmp/orbyn-inference-broker-final-types.log`. Broker storage
checks3/3 pass with no skips in `/tmp/orbyn-inference-broker-final-three-tests.log`.
This diagnostic run uses `PGOPTIONS=-c jit=off`; it does not modify PostgreSQL or
production configuration. No OpenAI request is made. Fixture fixes preserve real
JSON encoding, mandatory chat IDs and allowed inactive job states.

Current full checkpoint qualification0de9ca3d actually ended code1, signal:null:
2670/2677 pass, seven failures, no skips. The attempted cancellation happened
after its handle had already disappeared (ESRCH); the cancellation record was
corrected and the exit JSON is authoritative. Logs confirm a PostgreSQL backend
was SIGKILLed while evaluating the replay permission query, with container OOM
state and postmaster recovery. This affected both full and broker test sessions.
JIT-off broker passing is not proof the replay OOM is fixed. Investigate query
planning/memory and complete fresh full/CI qualification; do not restart Docker
Desktop or erase test/primary data as a workaround. Source permission predicates
must stay enforced. Goal remains full C1-C6/M1/D1/U1, with actual ChatGPT-primary
execution and explicit Orbyn-default fallback highest priority.

### Direct Connect interaction — 4 October 2026

User confirmed that Connect to ChatGPT must immediately start authorization,
without opening ChatGPT sign-in settings first. Desktop dispatches `connect`;
web/mobile create an opaque connect request and launch the credential-owning
Orbyn runtime, which claims it and starts OpenAI authorization directly. MCP
configuration remains separate. The local runtime dependency is still present;
this is not standalone hosted-browser OAuth.

Direct entrypoint and manager tests pass13/13 with no skips in
`/tmp/orbyn-direct-connect-recheck.log`. Backend typecheck passes in
`/tmp/orbyn-routing-backend-recheck.log` after restoring fresh default-provider
resolution in the explicit admission-failure fallback. Uncommitted execution,
provider-choice and UI work still needs authorization-fence, integration and
full qualification before promotion to main. No live OpenAI consent or inference
was performed in this check.

### ChatGPT dispatch and provider-choice candidate — 4 October 2026

Active branch: `codex/chatgpt-execution`. Private device polling claims encrypted
runner assignments, checks owner/session/lease/model/hash, invokes the public
Responses transport, signs completed or classified failed results, and publishes
them to the runner. Composer JSON steps use personal provider routing. No renderer
inference IPC or arbitrary-prompt HTTP enqueue endpoint is introduced.

Migration227 stores explicit ChatGPT-primary/default and fallback choices with
CAS. Migration228 captures provider consent revision on each assignment and
cancels legacy active assignments without that evidence. Enqueue, claim, result
publication and read reject provider changes. Web/desktop/mobile controls hide
another account's state, abort stale requests and offer reload after conflict.
MCP and plugin grants remain separate.

Actual marked-database routing tests pass6/6: encrypted once-only assignment,
signed completion, forged/lease/source/session rejection, revision fencing,
runner consumption of the assigned model, and a local default-provider stand-in
called only with explicit fallback and a confirmed admission rejection. Stream
and unknown failures do not retry. Evidence:
`/tmp/orbyn-chatgpt-routing-admission-tests.log`. Endpoint/security, manager,
private processor, routing contract and catalog checks pass27/27 in
`/tmp/orbyn-routing-security-focused.log`. Model UI/neatness checks pass19/19 in
`/tmp/orbyn-routing-ui-recheck.log`; the model-only fixture mocks the separate
provider-choice child and does not prove that child's rendered appearance.

Workspace types and production build pass in
`/tmp/orbyn-routing-complete-types.log` and
`/tmp/orbyn-routing-production-build.log`. These checks do not qualify main:
full-suite PostgreSQL OOM investigation, actual OpenAI consent/inference,
cross-client provider-control visual review, durable user-visible inference
usage/provenance, and broader ADR acceptance remain open. The running preview
still serves the earlier worktree; do not claim it shows this candidate.

Final combined ChatGPT-focused run passes249/249, no skips, exit0, including
new endpoint security, all `chatgpt*.test.ts`, provider choice, route inventory,
catalog and neatness checks. Log:
`/tmp/orbyn-chatgpt-checkpoint-all-focused.log`. PostgreSQL JIT is disabled only
for this diagnostic test process (`PGOPTIONS=-c jit=off`); it is not production
configuration and does not resolve the earlier full-suite OOM qualification.
Final workspace typecheck passes in `/tmp/orbyn-routing-checkpoint-types.log`.

### Replay qualification follow-up — 4 October 2026

Known literal source families now emit their existing predicate directly instead
of the complete dynamic CASE. Dynamic source-kind columns keep every allowlisted
family and the fail-closed default. The source-expression regression compares
each emitted literal predicate with its exact dynamic branch; replay authority
checks pass24/24 using normal PostgreSQL settings, without `PGOPTIONS` overrides.
Evidence: `/tmp/orbyn-replay-static-family-tests.log`.

Read-only EXPLAIN comparison (`/tmp/orbyn-replay-family-plans.json`) shows reduced
SQL bytes for task/doc/record/exam but identical estimated costs and plan nodes in
the synthetic comparison. This is not proof of the earlier OOM cause or a JIT
fix. Full tests are currently running normally in
`/tmp/orbyn-fe0ef346-replayfix-full-tests.log`, session79424; do not restart them
on an observation timeout. Types pass. The standard format command warns only
about the preserved untracked `desktop/src/settings-connection-preview.tsx`;
that file was not edited. Separate tracked-source formatting is checked without
adding checker exceptions. No main promotion is qualified yet.

The normal-settings full run completed with exit0:2701/2701 pass, no skips, in
`/tmp/orbyn-fe0ef346-replayfix-full-tests.log` (session79424 terminal). This covers
the dispatch/provider-choice checkpoint and replay SQL change; do not attribute
it to later capability or legal changes. No PostgreSQL restart or JIT override
was used. Tracked-source format passes in
`/tmp/orbyn-replayfix-tracked-format.log`; standard formatting still warns on the
preserved untracked preview file.

The owned API8027, web5174 and Metro8083 previews were refreshed to the execution
worktree after the marked preview database was migrated. The running API health
is good. Native Expo was reloaded through its developer menu; the current
Provider/default/Connect/Refresh/Usage controls were inspected and captured at
`evidence/chatgpt-provider-routing/ios-settings-provider.png`. Controls fit with
no overlap in this dark-mode empty-account view. This is not verification of
connected accounts, large catalogs, web layout or actual OpenAI consent. The
stale development warning was dismissed only after capturing its presence.

### Rolling-upgrade and privacy follow-up — 4 October 2026

Migration229 adds signed `plan_inference_v1` catalog capability. Omission keeps
legacy canonical signatures and the existing strict catalog response shape;
catalog-only devices remain readable. Primary-provider selection and private
dispatch require an advertised execution processor. Missing/old runtimes cannot
receive input. New catalog metadata advertises capability only when the private
adapter and claim/result client methods exist.

Capability, broker, lease/proof, manager and private runtime checks pass43/43
with normal PostgreSQL settings in `/tmp/orbyn-chatgpt-capability-tests.log`.
Privacy text now describes device/OpenAI routing, encrypted temporary envelopes,
explicit fallback and the limits of revoking already-sent content. Shipped legal
version becomes2026-10-04 using the existing default-text/version workflow.
Legal/provider-route/broker checks pass14/14 in
`/tmp/orbyn-chatgpt-capability-legal-tests.log`. These follow-ups require their
own fresh full/CI qualification;2701 passing is the preceding checkpoint's
evidence. Usage/provenance display, connected-state visual coverage, real-account
acceptance and the remaining full ADR contract are still open.

### Completed ChatGPT usage implementation — 4 October 2026

Migration230 adds owner-only completed-call measurements without conversation
content, identity tokens or provider credentials. Only the transaction accepting
a verified signed completion writes them; replay, failure and rejected receipts
do not. Analytics opt-out prevents recording. Measurements last30 days, survive
temporary request cleanup and cascade on account deletion. The first-party usage
route is excluded from agent/plugin access and returns no-store metadata, exact
decimal totals and at most ten recent records. Missing usage remains null, not
an estimate. It does not measure account-wide allowance, other apps or direct
plan-verification requests that were not accepted through the assistant broker.

Web/desktop/mobile load Usage in Orbyn only on demand. Ownership/token changes
hide prior data before effects and abort old requests. Unit checks exercise both
surfaces, delayed responses, exact large totals and distinct quota wording.
The native panel was opened against the refreshed API and displayed the actual
empty test-account result. Empty-state zeros and irrelevant fallback help were
then removed; the latest compact view still needs its screenshot after agreeing
to the refreshed legal version.

Broker/UI checks17/17 pass in `/tmp/orbyn-chatgpt-usage-focused.log`.
Route/catalog/inventory/neatness checks23/23 pass in
`/tmp/orbyn-usage-contract-routes.log`. Usage/recovery/privacy/sweeper checks22/22
pass in `/tmp/orbyn-usage-recovery-privacy-tests.log`. Final focused ledger/client/
UI checks15/15 pass in `/tmp/orbyn-usage-ledger-final-tests.log`, including exact
database aggregation above Number precision, retention-window exclusion, null
measurement constraints, stale sessions and fresh-client requests. These scoped
counts overlap; do not sum them as a full-suite count. Workspace types and build
pass in `/tmp/orbyn-usage-final-types.log` and
`/tmp/orbyn-usage-production-build.log`; fresh final-source checks remain needed
after the last count conversion and document updates.

An official Electron44.3.0 runtime was downloaded/verified into a task-owned
temporary directory for independent native desktop QA. An isolated profile loads
the built desktop app from its first-party file path and points at test API8027;
it does not load or capture the blocked web URL or change the OS URI association.
Its login is filled from the private disposable-account file, never printed or
stored in repository text. Evidence: `evidence/chatgpt-provider-routing/desktop-qa-signin.png`.
The desktop Sign in action accepts Terms/Privacy and has a pending action-time
Computer Use confirmation. iOS now shows the2026-10-04 agreement gate too. Do not
accept either agreement automatically or treat elapsed time as authorization.

Next routing gate: provider choice is captured in the resolver closure and on
private assignments, but not yet at job enqueue in durable job state. A runner
restart can therefore read a changed primary choice and retarget remaining work;
queued-before-selection changes also need durable fencing. Persist enqueue-time
choice and test recovery before production promotion. Also verify private request
recovery across restart/expiry so accepted or unknown calls cannot be duplicated,
and persist actual fallback/provider provenance for the final result. Fresh
full/CI, real-account acceptance, connected large-catalog visual checks and all
remaining governing ADR gates stay open. The preceding2701 passing result belongs
to01690700 and does not qualify these later changes.

Usage snapshot follow-up: totals and recent records are read by one SQL statement
so concurrent receipts cannot produce contradictory counts/history. The schema
rejects history larger than the completion count. Fallback controls now update
the saved device instead of silently using a different inspected device; controls
identify that distinction and reject retained actions after account replacement.
These two-surface action tests pass8/8 in
`/tmp/orbyn-provider-usage-action-fences.log`.

The final combined normal-settings focused run passes273/273, no skips, exit0,
in `/tmp/orbyn-chatgpt-usage-all-focused.log`. This includes all ChatGPT suites,
provider choice, usage client/UI, legal, sweeper, route inventory, catalog and
neatness. Types and build pass in `/tmp/orbyn-usage-provider-fence-types.log` and
`/tmp/orbyn-usage-checkpoint-build.log`. No full-suite/CI result for this latest
source is claimed. Main stays unchanged until the durable recovery gaps above
are fixed and acceptance is qualified. Native desktop QA process9478 is still
live at the pending login; refreshing/rebuilding its file bundle must keep its
test API8027 configuration before the next visual check.

### Durable provider-choice fencing — 4 October 2026

Migration231 captures the current personal provider choice on every ai_jobs
insert, covering interactive and automation producers. It ignores a supplied
snapshot and rejects later edits to the captured value. Existing rows with no
configured personal choice are backfilled with the known legacy default;
uncertain beta rows remain fail-closed instead of inventing original consent.
Resolver recovery and private queue/claim/publication/read compare this immutable
snapshot with current settings. Managed native/JSON dispatch and plain
completions also recheck authority before any network/device transport call.
Explicit fallback keeps that guard, including after its notice callback.

Snapshot/broker/routing tests13/13 pass in
`/tmp/orbyn-provider-snapshot-focused.log`. Existing assistant runs, protocol and
provider-limit checks61/61 pass in
`/tmp/orbyn-provider-snapshot-protocol-runs.log`. Dispatch guard/limit checks21/21
pass in `/tmp/orbyn-provider-authority-protocol-tests.log`, with zero network or
device calls after rejection. Final snapshot/broker/protocol checks30/30 pass
in `/tmp/orbyn-provider-choice-durable-tests.log`. Types pass in
`/tmp/orbyn-provider-choice-durable-types.log`. Counts overlap and are not full
qualification.

The enqueue/restart retarget gap is addressed by this source. Remaining private
transport recovery needs stable per-call operation IDs and consumed/checkpoint
evidence. The current unique-active-per-job constraint also conflicts with the
lead's real parallel specialist execution (`Promise.all`); it must become an
operation-level constraint, with separate queued work for each specialist.
Do not use payload equality alone as operation identity or replay a charge after
unknown completion/expired envelope cleanup. Actual provider/fallback provenance,
current full/CI, real-account acceptance and connected-layout checks remain open.

### Private operation recovery and parallel dispatch — 4 October 2026

Migration232 replaces per-job active uniqueness with durable per-operation
identity. Each private loop persists a UUID before dispatch, freezes its exact
wire messages, and saves received/parsed replies and its finished result.
Recovery retains the original budget reservation and does not count the pending
lead step again. Finished context hashes match the bounded checkpoint projection;
a new person answer invalidates the finished-loop cache rather than repeating the
same question forever. Separate specialists share an adapter but have distinct
operation IDs and assignments.

The broker serializes creation per operation and returns the original assignment
on replay. Accepted output can recover with the device offline. Expired undisclosed
queued work becomes a known admission failure; claimed/unknown work cannot silently
switch provider. Fallback is marked before its managed call, and a missing result
holds the original operation instead of repeating a possible charge. Received
fallback output is encrypted for recovery. Active request envelopes survive their
dispatch deadline for saved-run recovery; expired inactive envelopes are swept.
Content-free operation tombstones survive envelope deletion and follow job
retention. Existing beta private jobs without operation evidence are held, not
silently retried. Privacy text reflects this retention.

Actual marked-database and child-process tests include SIGKILL after a signed
reply is accepted but before the loop saves it. Recovery, with the device offline,
uses one physical request and one usage record. The same suite exercises parallel
loops reaching separate signed assignments and independently replaying their saved
results. Process/broker checks14/14 pass in
`/tmp/orbyn-private-process-recovery-tests.log`. Loop reservation/cache/context
checks5/5 pass in `/tmp/orbyn-private-budget-tests.log`.

The initial broader run failed74/75: its sixty-poll presence check took over11s,
crossing the real10s grace interval, while asserting the row never changed. No
test assertion or production interval was altered. An isolated normal-settings
rerun passed (684ms for sixty polls;62ms under the runner lock) in
`/tmp/orbyn-private-presence-isolated.log`. The subsequent assistant/broker/loop
rerun passed59/59 in `/tmp/orbyn-private-parallel-final-tests.log`. Final combined
assistant/process recovery/broker/loop/legal/sweeper checks pass83/83, no skips,
in `/tmp/orbyn-private-operation-checkpoint-tests.log`. Final workspace types pass
in `/tmp/orbyn-private-operation-checkpoint-types.log`; production build passes
in `/tmp/orbyn-private-recovery-build.log`. This is focused evidence, not a fresh
full-suite/CI result for this source.

Remaining M1 release gates include actual provider/fallback provenance in the
user-visible result, fresh current full/CI, real-account acceptance and connected
large-catalog visual checks. Native desktop sign-in and the refreshed iOS agreement
remain pending Computer Use confirmations. Full governing ADR scope remains active.

### Provider receipt labels and atomic fallback recovery — 4 October 2026

Both assistant result views now display provider/model receipts from the existing
trace contract. Signed ChatGPT completion records its label in the same transaction
as accepted output and usage. Managed fallback completion records its label in the
same transaction as the encrypted recoverable reply; a crash cannot leave a cached
completed fallback represented only as started. Managed protocol completion also
records the actual model. Duplicate receipt labels are suppressed while distinct
models remain visible. These markers are display metadata, not authorization.

Focused provenance, broker/process recovery and assistant-run checks pass56/56,
no skips, in `/tmp/orbyn-provider-provenance-atomic-tests.log`. Workspace types pass
in `/tmp/orbyn-provider-provenance-atomic-types.log`. A subsequent small change
preserves distinct default models during trace deduplication. Fresh full-source
qualification is running in `/tmp/orbyn-provider-provenance-full-tests.log`;
production build is running in `/tmp/orbyn-provider-provenance-build.log`.
Neither running process is a passing result. Current full/CI, real-account and
connected native/web visual acceptance remain open. Main promotion is not claimed.

### Notice-query qualification repair and connected desktop evidence — 4 October 2026

The latest local full run terminated2678/2687 pass,9fail in
`/tmp/orbyn-provider-provenance-full-tests.log`. Notice-list failures coincided
with database disconnect/recovery and subsequent setup failures. Do not classify
this as a passing local gate or assert a proven PostgreSQL kill cause. GitHub
CI37202016175 passed all backend/web, mobile bundles, Docker image/live smoke and
mail jobs for8bd2e48d. The preceding CI stopped at one indentation-only test
format issue, corrected by8bd2e48d.

The notification list now pages ordinary owner/item-visible notices separately
from assistant chat, proposal and reminder-nudge source checks. Only families
present in a page expand their guard SQL. Hidden source notices do not consume
the100 visible-result limit. Timestamp/ID cursors preserve database microsecond
precision and internal cursor fields never enter client responses. Malformed
chat references and absent sources fail closed. Final planner/deadline/privacy/
pagination checks pass123/123, no skips, in
`/tmp/orbyn-notification-final-focused-tests.log`; workspace types pass in
`/tmp/orbyn-notification-bounds-final-types.log`. No test/JIT/database setting was
weakened. This repair still requires a fresh complete local and CI run.

Native desktop Settings was inspected against the marked local preview database.
Connect opened OpenAI's real account chooser. The UI subsequently displayed a
connected account, granted plan permission and a live selected model. Screenshot:
`docs/reviews/evidence/chatgpt-provider-routing/desktop-connected-models.png`.
Control links now share button styling without browser-default blue/underline.
The native tool stopped responding during plan verification; completed live
inference, refresh/revocation, actual assistant receipts/usage and mobile/web
connected acceptance remain unproven. No production/main promotion is claimed.

### Personal chat admission and visible recovery errors — 5 October 2026

The notice-query checkpointcbbea304 passed2731/2731 full local checks with no
skips in `/tmp/orbyn-notification-guard-full-tests.log`. CI37203144839 passed all
backend/web, mobile, Docker/live smoke and mail jobs. Production build passed
in `/tmp/orbyn-notification-guard-production-build.log`. This qualifies that
source; subsequent changes require fresh qualification.

Live preview inspection exposed a separate admission defect: chat submission
and capabilities still required managed workspace configuration before the
personal resolver could run. Both now consult the owner's selected provider.
A selected ChatGPT binding can enqueue without a managed provider. Missing or
revoked bindings cannot admit through default billing without explicit fallback.
Dispatch still performs current identity/catalog/lease/model/source checks and
captured-choice fencing. No readiness/entitlement is invented at admission.

An HTTP regression proves202 enqueue and captured personal choice with no managed
provider, plus401/403/422/429 shields and idempotent replay. Broker, admission,
plan transport, desktop bridge/store checks pass50/50, no skips, in
`/tmp/orbyn-chatgpt-admission-recovery-final-tests.log`, using the separately marked
`orbyn_admission_cbbea304_test` database. Workspace types pass in
`/tmp/orbyn-chatgpt-admission-action-types.log`.

Fixed safe plan recovery messages now cross desktop IPC; arbitrary provider text,
mutated Error.message and request IDs remain excluded. Routine metadata reload
preserves an action failure for the same owner instead of immediately hiding it.
A new successful action or owner/session change clears it. Actual plan permission
and model discovery remain distinct from a completed verification/inference.

Open routing work includes safe Background deferral when its private runtime is
absent without fallback, actual completed assistant inference/receipts/usage,
non-chat first-party AI features that still use managed adapters, maintained-page
private execution and the remaining full ADR/platform acceptance. Plugin/MCP
calls retain their separate provider and grant boundaries. Main is unchanged.

### Live stream header, checked-out connections and replay planning — 5 October 2026

CI37204783047 passed all four jobs on195f2d22. Its local full run ended2706/2717
pass,11fail in `/tmp/orbyn-chatgpt-admission-current-full-tests.log`, including
recovery57P03 and timing failures. This is not a passing local gate. A focused
replay run reproduced a proposal-family connection loss; its19/25 result includes
recovery/setup failures. No assertion, deadline, JIT or database setting was waived.

The replay query now binds reference IDs as a text array instead of a JSON
recordset. All ownership, grant, membership and source predicates remain intact
in the same query. A synthetic normal-settings EXPLAIN changed reference rows100
to1 and estimated total cost70785.15 to732.43. Both synthetic plans had JIT disabled
by their own cost estimates, not by a configuration change; this is not proof of
a specific PostgreSQL kill cause. Evidence: `/tmp/orbyn-replay-cardinality-plans.json`.
The reproduced proposal read lost its connection after6086ms before the change;
three subsequent reads completed in75,168,72ms. Replay tests24/24 pass in
`/tmp/orbyn-replay-array-cardinality-tests.log`. Combined pool/replay/rules/runner/
assistant/process-recovery checks102/102 pass with no skips in
`/tmp/orbyn-resilience-array-final-tests.log`.

Every primary/replica pool connection now observes transport errors even while
checked out between async transaction queries. Rollback failure cannot replace
the original error; transactions are never retried or reported successful by this
handler. A marked-database test terminates only its own tagged backend, proves one
failed attempt and a healthy later pool query. The preview API remained alive
through a subsequent database recovery.

Live OpenAI diagnostics recorded an actual public Responses request with
stream:true/store:false, HTTP200, a body and no Content-Type header. The client
now allows an absent header and still requires bounded valid SSE plus
response.completed. Declared JSON/HTML and incomplete/malformed streams do not
become successful inference or usage. The live request then correctly reported
subscription-sharing usage exhaustion. It did not complete inference, so no
successful plan-use or remaining-allowance claim is made. Further live inference
checks stopped; the temporary startup verification hook was removed.

Runtime snapshots retain the fixed safe quota message without raw provider
content. Plan/model runtime/manager/bridge/store checks56/56 pass, no skips, in
`/tmp/orbyn-plan-media-runtime-final-tests.log`. Workspace types pass in
`/tmp/orbyn-stream-resilience-final-types.log`. Fresh frozen full/CI qualification,
actual completed inference after availability returns, remaining cross-client
acceptance and full C1-C6/M1/D1/U1 remain open. No main promotion is claimed.

### Main checkpoint delivered — 5 October 2026

PR197 merged as82576dfa after2592/2592 full local tests, workspace types,
production build and all four CI37230581000 jobs passed. Root main was safely
fast-forwarded with mobile/app.json and all user untracked files preserved.
The broader codex/chatgpt-execution branch merged origin/main without conflict;
only the scoped qualification document was new because the code fixes already
matched. Full C1-C6/M1/D1/U1 remains active. Next: Background/private-device
availability deferral, all first-party AI feature routing and remaining pages,
Docs, whole-app layouts and external host/platform acceptance. No more live
plan retries while the connected provider reports usage exhaustion. Cleanup
remains at the end; no production deployment was performed.

### Private automation queue admission — 5 October 2026 (candidate)

Background and Overnight jobs whose captured choice requires ChatGPT without
managed fallback now remain queued while the chosen device has no live matching
session/lease, fresh catalog or signed inference capability. This admission guard
runs before claiming; it does not disclose prompts or reserve a running slot.
Interactive requests retain their immediate failure behavior. Current provider
choice changes, legacy private-run holds, cancellation and disabled owners can
still be claimed for execution-time settlement. Closed unreviewed night work can
also be settled; reviewed work retains its normal provider requirement.

An accepted signed completion or stored fallback reply remains recoverable with
the device offline. The worker still rechecks current source/choice authority
before using it. Tests perform actual broker signing/publication before checking
this recovery path. Queue/runner lifecycle checks14/14 pass, no skips, in
`/tmp/orbyn-private-queue-lifecycle-tests.log`; the preceding broker/run regression
checks69/69 pass in `/tmp/orbyn-private-queue-broker-regression.log`. Workspace
types pass in `/tmp/orbyn-private-queue-types.log`. Counts overlap and do not
replace fresh combined qualification.

This is pre-claim admission, not complete offline deferral. A device/lease can
still disappear after claim and before dispatch; that known admission failure
needs durable requeue handling without repeating unknown or already disclosed
operations. No complete Background deferral or main promotion is claimed.
Remaining first-party feature routing, A5, Docs, UI/platform and plugin/host
acceptance retain the full C1-C6/M1/D1/U1 scope.

### Known post-claim private admission failure — 5 October 2026 (candidate)

An unattended run now distinguishes a rolled-back503 queue admission failure
from an unknown/disclosed model completion. Without authorized managed fallback,
that failure saves the current loop, operation ID, captured model, wire input and
budget reservation, then requeues the same leased job. Queued wait is excluded
from active elapsed time and does not consume a crash-resume attempt. Linked
working tasks return to queued atomically under their owning assistant grant.

The transition locks the live owner's job and rechecks captured consent/source
visibility. Any unfinished private assignment or fallback blocks safe requeue;
unknown charges are not repeated. Private job-live checks hold a share lock so
queued/cancelled state cannot race prompt admission/publication. Cancellation,
lease ownership and current choice remain fenced. Fixed private-provider recovery
messages can appear in run failures without reflecting upstream content.

Actual runner tests prove lease loss before dispatch parks the job with its
operation/model/reservation intact and zero inference envelopes. Broker/run/error
checks64/64 pass, no skips, in `/tmp/orbyn-private-deferral-final-tests.log`;
Night/queue checks20/20 pass in `/tmp/orbyn-private-deferral-night-regression.log`.
A final safe-message check passes in `/tmp/orbyn-private-provider-error-final.log`.
Workspace types pass in `/tmp/orbyn-private-deferral-final-types.log`.

The earlier898b full run ended2740/2745 pass,5fail, including a historical Night
read connection loss/recovery and a deadline timing failure. CI37234445505 passed
all jobs on that earlier head. These are not latest-source qualification. Night
leftover source checks now bind paired kind/UUID arrays instead of a100-row JSON
recordset estimate; all visibility predicates and redacted labels remain intact.
The previously failing historical read passes in the focused Night suite. No
assertion, timer, database or JIT setting was waived. Fresh frozen full/CI and
remaining C1-C6/M1/D1/U1 acceptance remain required before main promotion.

### Deferral state-lock verification — 5 October 2026

A concurrent dispatch blocked on the job's share lock now rejects after another
transaction queues that job; it creates no inference envelope. The queue/broker/
runner concurrency suite passes33/33, no skips, in
`/tmp/orbyn-private-deferral-concurrency-tests.log`.

The42c70383 local full run ended2747/2748 pass,1fail. The remaining failure was a
source-contract assertion requiring resolveUserAi's call and arguments to occupy
one line after Prettier wrapped the new argument. Its updated whitespace-tolerant
pattern still requires that exact resolver and owner/job arguments; no behavior,
authority assertion or deadline was waived. Routing/error checks pass in
`/tmp/orbyn-private-routing-contract-final.log`. Fresh full/CI qualification on
this verification head remains required. Main82576dfa and the broader full ADR
scope remain unchanged.

### Deferral verification updates — 5 October 2026

The queue/broker/runner concurrency suite passes33/33, no skips, including an
actual blocked dispatch rejecting queued state with zero assignments. The
routing-contract check now accepts whitespace formatting while still requiring
resolveUserAi with the owner/job arguments; routing/error checks pass. The
preceding42c70383 full local result remains2747/2748 with that formatting assertion
failure, not a passing qualification. Fresh full/CI must qualify this verification
head before promotion. Main82576dfa and full ADR scope remain unchanged.

## Page budget checkpoint — 5 October 2026

Per-page schedules now expose 1,000–20,000 estimated tokens per update in both
clients. Migration 233 defaults existing bindings to 20,000. Queueing captures
the binding budget on the run; editing cancels outstanding work without changing
the old run's budget. Updates from older clients that omit the field preserve
the saved budget. Pause/resume sends the selected allowance. Shared Overnight
limits remain in force.

Focused budget/binding/run/consumer/route/store checks pass 73/73 with no skips
and all workspace typechecks pass. Native desktop build passes; the actual
page-update dialog was inspected and its invalid 999 / valid 5000 enable state
verified without submitting. Bare frequency buttons were changed to the existing
secondary controls and section paragraph margins corrected. Screenshot:
`evidence/page-budget/native-dialog.png`. Preview API has not yet been aligned
with migration 233; native save, narrow layout and mobile acceptance remain open.
This is a candidate checkpoint, not a main merge or completion of C5/U1. Full
exact-commit qualification and all remaining ADR requirements still apply.

## Exact-commit qualification follow-up — 5 October 2026

The full local suite on e8c10979 completed with 2,774 passes, one failure and
no skips/cancellations. The failure was the newly introduced 20px Docs library
heading, outside the existing six-size type scale. It is corrected to 18px;
the unchanged neatness suite passes 10/10 without skips. All workspace types
and production build passed on e8c10979. CI run 37255077796 is still pending
at this checkpoint, so no green full qualification or main promotion is claimed.
Logs: `/tmp/orbyn-e8c10979-full-tests.log`,
`/tmp/orbyn-doc-heading-scale-tests.log`. Requalify the corrected commit.

## Usage cutoff precision correction — 5 October 2026

Frozen e1866399 full local qualification passed 2,775/2,775 with no skips or
failures. CI 37256031469 failed one usage aggregation assertion (11 rather
than 12), while mail/mobile/docker succeeded. Investigation identified a real
query boundary defect: node-postgres Date conversion loses PostgreSQL
microseconds before the upper/lower bounds are sent back to SQL. The cutoff
query now retains database text timestamps for filtering, preserving full
precision; public timestamps remain ISO dates. A deterministic unit test
requires both exact bounds and exercises the real usage reader with a mocked
checked-out client. Broker plus precision checks pass 16/16, no skips, in
/tmp/orbyn-e186-usage-precision-focused.log. Requalify the corrected commit
before main promotion. The full ADR remains incomplete; no deployment/cleanup.

## Recording provider checkpoint — 5 October 2026 candidate

Text recording summaries now capture explicit provider choice, source page
revision and live recording identity through a durable feature job. Both clients
allow a supplied transcript and show actual completed-provider metadata. Signed
private output cannot be accepted after file removal; page/exclusion/team checks
and explicit fallback remain enforced. Existing audio transcription remains
managed and cannot run while ChatGPT is selected. Target generation guards
prevent late summary/task UI responses from landing on another recording.

Focused checks pass 21/21, neatness 10/10, all workspace typechecks and native
desktop build pass. Recording UI screenshots/native mobile acceptance, actual
completed OpenAI inference and full exact-commit qualification remain open.
The separate corrected e1866399 checkpoint is under full qualification in
`/tmp/orbyn-e1866399-full-tests.log`; its live session is 18479 and types/build
session 33414. CI run 37256031469 targets that exact commit. Earlier e8c10979
CI was cancelled by the newer push; it was not a completed green run. Main
remains 82576dfa. All C1–C6/M1/D1/U1 scope and eventual cleanup remain active.

## Private page transport in progress — 5 October 2026

Uncommitted private maintained-page transport uses a version-3 companion job
linked to its page parent (migration 234), checks the parent lease and captured
provider/model/source authority at broker boundaries, and settles companion
state with its parent. Overnight admission excludes that run's own companion.
This is incomplete: direct signed private-page execution, safe undisclosed
reservation rollback/deferral, recovery, and native/mobile acceptance still
require implementation and tests. Do not merge this work as complete.

Output limits now propagate through the private transport, hashed assignment,
public Responses request, and explicit managed fallback. Migration 235 permits
plan_inference_limits_v1; bounded queue/claim requires that current capability,
while older devices remain eligible for ordinary calls. Unit checks32/32 and
broker/page-consumer checks40/40 passed without skips. The new broker regression
covers pre-dispatch rejection, unchanged queued state on capability downgrade,
limit immutability on replay, and signed completion after capability restoration.
Logs: /tmp/orbyn-private-output-unit-final.log and
/tmp/orbyn-page-private-capability-final.log. These existing page-consumer tests
do not prove direct private-page execution. Latest workspace types passed with terminal exit0 in
/tmp/orbyn-page-private-current-types.log (session19260).

Separate frozen candidate82f5f20e corrects usage cutoff microsecond truncation
following e1866399 local2775/2775 and CI37256031469's usage count failure.
Corrected broker/precision16/16 passes. Full session82103/log
/tmp/orbyn-82f5f20e-full-tests.log and CI37257405383 are live. All workspace types passed with terminal exit0 (session28996). Main82576dfa remains unchanged;
no deployment, cleanup, or full ADR completion is claimed.

## Direct private page execution checkpoint — 5 October 2026

Private maintained-page execution now has direct signed broker coverage. The
consumer sends only selected blocks, carries an output-token limit and applies
one bounded replacement under the parent lease. A genuine unique companion job
tracks that lease and runtime lane; source, provider-choice and preference
revision changes reject late output without recording accepted usage. Parent
cancellation invalidates the transport and preserves the page.

The first direct test exposed a lock inversion: device claim/finish locked the
physical envelope before parent/source authority, while worker polling used the
reverse order. Claim and signed acceptance now check parent/job authority before
locking the envelope. No deadlock retry or relaxed timeout was added. Recovery
also exposed an invalid transport cancellation state; page terminal transitions
use ai_jobs' existing failed state. Migration236 replaces the trigger function
for databases that already exercised the initial234 checkpoint.

Confirmed device loss before enqueue can restore only an undispatched page's
reservation, clear its model key, and requeue without consuming a retry. Any
operation envelope prevents restoration. The companion and durable operation
identity are reused on resume. Overnight direct coverage proves the shared night
reservation returns to zero before transmission, its own queued companion does
not block reclaim, and successful execution charges only the parent once.

Direct private page checks8/8 pass without skips in
/tmp/orbyn-private-page-night-direct.log. Source/provider/model/cancellation,
old-device capability, undispatched resume and already-dispatched reservation
retention are covered. Combined current checks pass81/81 without skips; all-workspace types and production
build pass with terminal exit0. Evidence: /tmp/orbyn-private-page-final-focused.log,
/tmp/orbyn-private-page-checkpoint-types.log and
/tmp/orbyn-private-page-checkpoint-build.log. Native/mobile interaction,
real positive OpenAI inference, full exact-head tests/CI, and remaining ADR
requirements are still open. This checkpoint does not complete the full goal.

## Agenda owner boundary and private review — 5 October 2026

Agenda BriefWriter now receives the actual page owner from contentFor, covering
interactive rewrite and scheduled morning creation. Managed briefs check that
owner and captured provider-choice revision before dispatch and before returning
output, with a 512-token output cap. A selected ChatGPT plan is never silently
sent to the managed provider. Private Agenda dispatch is still incomplete: retain
source identities and revisions across tasks, subscription events, habits, Study
and computed facts; implement durable owner-bound dispatch and distinguish app
session from scheduled authorization. Returning an agenda without a generated
brief is a temporary guard, not completion of that feature.

Actual managed fixture tests prove bounded default requests, zero calls for a
selected ChatGPT plan, no calls for missing/disabled owners, and discarded output
when consent changes in flight. The agenda pipeline verifies the owner passed to
the writer. Direct private page approval now proves stale/foreign waiting cards
are rejected and the saved patch applies with the device offline without another
model call. Combined Agenda/direct private review checks40/40 pass, no skips,
in /tmp/orbyn-agenda-choice-review-final.log. All workspace types pass with
terminal exit0 in /tmp/orbyn-agenda-owner-current-types.log.

Candidate82f5f20e CI37257405383 passed all jobs. Local full qualification ended
2770/2776 pass, six failures, zero skips, during PostgreSQL recovery. Database
logs confirm checkpointer PID20590 was killed by signal9 at03:01:47UTC and
connections were ready again03:01:53UTC. No assertions, timeout, database/JIT or
Docker settings were weakened. The terminal failed run is retained. Fresh marked
orbyn_82f5f20e_qualification_test full qualification is running alone in
/tmp/orbyn-82f5f20e-fresh-full-tests.log, session81660. Do not restart it for an
observation timeout. Main82576dfa remains unchanged, and whole ADR acceptance,
real inference, visual/native checks and eventual cleanup remain open.

## Agenda Study source safety checkpoint — 5 October 2026

The separate AI Study snapshot excludes hidden root decks and original card
sources, revoked team AI consent, lost membership and deleted/foreign pages.
Exam titles require every stored attached deck to remain authorized even when
the human overview already dropped one; readiness uses permitted cards only.
Captured page identities and revisions are rechecked before managed dispatch
and acceptance. Missing original references between reads fail closed; snapshot
failure preserves the ordinary agenda without an unrestricted AI fallback.

Focused checks26/26, zero skips, pass in
/tmp/orbyn-agenda-study-final-regressions.log. All workspace types and production
build pass with terminal exit0 in /tmp/orbyn-agenda-study-final-types.log and
/tmp/orbyn-agenda-study-checkpoint-build.log. No UI/native completion is claimed
for this backend checkpoint. Private Agenda dispatch, source/revision authority
for tasks/calendar/habits/computed facts, scheduled consent, native acceptance,
real positive provider inference and full current-head qualification remain open.

Frozen82f5f20e full session81660 is terminal exit1:2775pass/1fail/0skip.
The unchanged sixty-poll test crossed the10-second presence window in about13s
and observed an additional row revision. Log:
/tmp/orbyn-82f5f20e-fresh-full-tests.log. An unchanged entire assistant-runs
recheck is running as session55232 in
/tmp/orbyn-82f5f20e-presence-recheck.log. No test/timeout/database/interval waiver
or main promotion. Main remains82576dfa; user deploys main manually.

## Combined provider checkpoint — 5 October 2026

Integrated the usage precision correction with recording, bounded private page,
Agenda owner and Study source work. The handoff append conflict retains both
sets of evidence. The unchanged82f5f20e assistant-runs recheck completed41/41
with zero skips:60 polls3018ms, locked fresh read90ms and one row revision.
The earlier full2775/2776 result remains failed, not waived. Requalify this
combined commit with full local tests and CI before main promotion. Full ADR,
real positive inference and desktop/mobile acceptance remain incomplete.

## Agenda fact authority checkpoint — 5 October 2026

Agenda managed briefs reread owned AI facts, filter project/team exclusions in
task/event/block and derived busy queries, and validate an owner/time-bound
snapshot before dispatch and acceptance. Original task/page versions, calendar
and habit identities, event UIDs/occurrences and block revisions are retained.
Internal preferences/placement inputs are hashed without exposing their source
identities in the prompt. Missing revisions fail closed. Excluded busy work
causes omission of affected AI availability, preserving the human calendar and
avoiding a false claim that private occupied time is free.

Final current checks92/92, no skips, pass in
/tmp/orbyn-agenda-retained-sources-tests.log. All workspace types and production
build pass with terminal exit0 in /tmp/orbyn-agenda-retained-sources-types.log
and /tmp/orbyn-agenda-retained-sources-build.log. Provider fixture tests prove
untrusted supplied priorities are not sent, excluded titles remain absent and a
revision changed during the model request rejects its output. Snapshot tests
cover exact owner/time, preferences, task revisions, habit names/placement,
subscription UID replacement/unsubscribe, team AI revocation and human page
preservation. Calendar/planner/habit/visibility suites retain ordinary behavior.

Previous combined f1ecc45b full session78088 completed2811/2811, no skips or
failures, and all four CI37259956426 jobs passed. Main82576dfa remains unchanged.
Do not substitute that previous full result for this newer source checkpoint.
Next: full current-head qualification, durable private Agenda transport with
source context and app/scheduled consent, real inference and native UI acceptance,
then remaining full ADR implementation and eventual cleanup. No deployment.

## Interactive private Agenda and shared result feedback — 5 October 2026

The version4 Agenda job captures its originating app session, current provider
choice/preference and owned AI source/fact snapshot. Dispatch and signed receipt
acceptance use the broker's existing database connection; no nested pool checkout
is required for snapshot reads. Forged facts with a preserved digest, revoked
sessions, changed source revisions/preferences and pre-job provider changes reject
the operation. Calls preserve the512-token cap through an explicitly consented
managed fallback. Stream/unknown failures and missing fallback consent produce
zero managed calls. Completed Agenda jobs retain their actual provider/model.

The API exposes optional briefing outcome metadata, and web/desktop/mobile use
one shared feedback formatter. A calendar rewrite remains available after a failed
summary, with clear failure information rather than generic rewrite success.
API keys remain rejected403 by the existing AI boundary. Provider errors use
fixed recovery text; raw upstream responses never appear in summary feedback.

Current focused Agenda/source/broker checks65/65 pass with no skips in
/tmp/orbyn-private-agenda-feedback-final.log. Route/ordinary Agenda/private-page
checks31/31 pass in /tmp/orbyn-private-agenda-route-final.log. They cover401,
403,400,429, API-key exclusion, revoked app sessions, source/model changes,
bounded signed success and explicit fallback provenance. All workspace types and
production build completed exit0 in /tmp/orbyn-private-agenda-feedback-types.log
and /tmp/orbyn-private-agenda-feedback-build.log. Earlier failed fixture assertions
are retained: compatible providers use max_tokens, and personal API keys are
already forbidden on AI routes; neither production controls nor limits were
weakened. Rate-limit exhaustion runs last so it does not mask auth assertions.

Frozen d602d90e qualification is now terminal:2820/2820 local pass with zero
failures/skips, and CI37261261363 passed. PR196 remains draft and mergeable;
main remains82576dfa. These earlier results do not qualify the newer Agenda
checkpoint. Run full exact-head/CI after committing and integrating this candidate.

Remaining: explicit scheduled plan consent; persistent waiting/recovery and retry
semantics; target/body/source coherence through page application; atomic policy/
source fencing; actual positive OpenAI inference and desktop/mobile visual/native
acceptance. A same-connection snapshot reread is not atomic all-source fencing.
Full C1–C6/M1/D1/U1 stays active. No main merge, deployment or cleanup yet.

## Agent channel signed reply boundary — candidate

A6/C6 remains unfinished. Added an isolated raw-byte Slack signature/parser and
server-owned card-binding resolver. Seven pure cases pass; fresh package build
and backend typecheck pass. It verifies configured app/DM actor, timestamp,
message/delivery identity, connection revision/revocation and exact current
waiting ID. Submitted replies use bounded text/current choices; approvals are
once-only. Duplicate request digests are stable, but durable callback receipts
and installation/outbox consumption are still required. No route, OAuth token
collection or external message is enabled by the helper. Full pipeline and
primary references: evidence/agent-channels.md. Keep real workspace and both
client/native acceptance open; do not treat existing webhooks as A6 delivery.

### 2026-10-05 — Plugin durable inference candidate and qualification repairs

CI37287782196 on f271dd0e failed three tests (2881 pass, one existing Tesseract
skip): two shared-runtime fixtures used leases from a fixed schedule clock,
and the new owner permission endpoints were absent from the route inventory.
The clock fixtures now retain the unchanged production lease duration on the
live chat runner's clock; the owner-only permission routes are classified as
credential management. No shield assertions or runtime limits were removed.

Candidate work adds the separate managed plugin broker/worker, atomic allowance
reservation, grant-owned receipts/events and revocation/provider fencing, plus
matching owner permission controls on desktop/web and mobile. Calls are never
retried after uncertain dispatch. Expired receipt recovery is a separate
statement so it cannot invert grant-before-job locking. Provider errors are
sanitized. Ten new integration cases await CI; local test PostgreSQL remains
unavailable. Pure regressions pass26/26; workspace types pass. Browser retry was
rejected by saved permission; no visual verification claimed. Keep P1 and the
full ADR active until qualification and host/native acceptance are complete.

Owner permission component regressions pass8/8 across desktop/web and mobile
(/tmp/orbyn-plugin-consent-ui-tests.log): no consent from merely opening settings,
reviewed provider snapshot and bounded defaults, explicit revocation, rejection
of invalid output limits, unavailable-provider refusal and sanitized save errors.
These are interaction fixtures, not screenshot or native runtime acceptance.
The initial fixture path error was fixed; its failed log was superseded by the
successful rerun. All workspace typechecks pass in
/tmp/orbyn-plugin-consent-ui-types.log.

### Plugin managed HTTP qualification follow-up

Added an eleventh integration case using the production managed HTTP adapter
against a dedicated mock server: exact model/max_tokens512, expected text,
accepted private result and no second dispatch. It tests more than the injected
send seam. Backend typecheck passes; database execution still awaits CI. The
previous goal turn was progress: committed/pushed broker and owner controls,
34 focused passes, and repaired catalog/lease qualification failures. Current
0f6f222e CI37290712062 is live; PR199 c8403ea1 has no reported checks yet.
Native Simulator inspection again timed out -10005. No visual proof claimed.

### Fresh isolated local plugin qualification — 5 October 2026

A read-only Docker inventory found the already-running embedding test PostgreSQL
healthy on55435 with a persistent volume and ample available space. Created only
a new isolated database orbyn_plugin_20261005_0940_test and its server-side test
marker. No engine/container restart, tuning or application database change.
Initial33-case cohort failed two new fixtures: an impossible duplicate OAuth
client/resource grant and the wrong expected OpenAI cap field. Corrected the
second-grant fixture to a separate client and assert max_completion_tokens512
(and absence of max_tokens), preserving the output cap. Rerun33/33 passes with
zero skips/failures in /tmp/orbyn-plugin-durable-local-integration-fixed.log.
This includes owner consent/CAS, eleven broker/worker cases, actual managed HTTP
transport, plugin service security and complete route inventory. Earlier failed
log remains /tmp/orbyn-plugin-durable-local-integration.log. Exact-head full
local/CI qualification and external host/native visual acceptance remain open.

## Scheduled Agenda authority — in progress, 5 October 2026

The secondary provider worktree now has uncommitted migration237, strict shared
permission schemas, first-party owner-only GET/PUT permission endpoints and
API-client methods. Permission is off by default and independent of morning
emails/recent sessions. Enabling requires the reviewed provider-choice and model
preference versions plus a current inference/output-limit-capable device catalog.
The captured setting includes the explicit fallback choice. Provider/account/
device/model changes, revocation/re-enable and disabled accounts invalidate old
grants. JSONB key ordering is normalized through the shared choice schema before
comparison. Revocation is allowed even after the selected device disappears.
The new routes are excluded from portable MCP/plugin credential capabilities.

Direct database/CAS/catalog and401/403/400/422/429 route plus mocked authority
checks12/12 pass with no skips in /tmp/orbyn-agenda-schedule-permission-final.log.
These include real permission-row JSONB round trips, concurrent writes, model
preference changes and disconnect/revoke/re-enable. All workspace typechecks
passed in /tmp/orbyn-agenda-schedule-permission-types.log; the later backend
recheck also passed. Migration237 was applied only to the marked test database.
Production build passed in /tmp/orbyn-agenda-schedule-permission-build.log.
Pure permission/MCP exclusion/neatness checks17/17 passed with no skips in
/tmp/orbyn-agenda-schedule-pure-final.log; scoped formatting and diff checks pass.
Frozen ce4895a5 full session40694 completed2838/2838, zero failures/skips, in
/tmp/orbyn-ce4895a5-full-tests.log. CI37263198527 remains live on ce4895a5; this
newer work is separate and must not receive the frozen commit's qualification.

This permission foundation does not yet dispatch scheduled summaries or expose a
working scheduling toggle. Next implementation must persist one daily summary
parent with target/date/source/permission/model snapshots and a stable operation
ID. It must defer an undisclosed offline-device request, preserve the same pending
operation, never retry streamed/unknown completion, and recheck permission,
source authority and target revision before applying only the owned summary block.
Human edits/Notes remain intact. Web and mobile need the same truthful pending/
failure/provider/recovery state and explicit permission control, with visual/native
verification. The existing worker's five parallel lanes and morning time window
are not durable recovery or scheduled permission.

## Authoritative qualification and scheduled runtime update — 5 October 2026

CI37263198527 on ce4895a5 is terminal failure: the private Overnight resume test
reported no assignment. Its local full suite passed2838/2838, but that does not
waive CI. A deterministic PostgreSQL-microsecond versus JavaScript-millisecond
retry regression failed on unchanged ce4895a5 (9/10) and passed with the repair.
The scoped repair is458c03a8 on the secondary branch and6be9561c on PR196;
6be9561c is pushed. Exact-head full local session35409 and CI37265979902 are
running. Main remains82576dfa; no new merge/deployment/cleanup occurred.

Scheduled permission foundation5b344d4e is committed and pushed on the secondary
branch. Migration238 and durable daily summary runtime remain uncommitted there.
Current clean marked DB affected suites pass31/31, zero failures/skips. Expanded
scheduled runtime coverage passes7/7 in
/tmp/orbyn-agenda-scheduled-recovery-expanded.log: no implicit grant, daily dedup,
offline same-operation resume, human Note preservation, revoke, edited target,
claimed-operation no-retry after worker expiry, morning expiry and changed model
preference. These are controlled integration tests, not real provider completion.

Next: complete cached/undisclosed recovery and source fencing checks, owner-only
status contracts and matching permission/recovery controls on web and mobile,
then qualify the complete scoped candidate. Real positive OpenAI completion,
plan/limits availability and visual/native acceptance remain open. Retain all
C1–C6/M1/D1/U1 requirements and user/character changes.

Scheduled source-recovery follow-up: a task changed after device assignment
correctly blocked output but exposed an unclassified error. The runtime now maps
known Agenda snapshot changes to a fixed409 conflict without exposing source
details. The unchanged409 assertion and page/usage preservation checks pass;
expanded scheduled suite8/8, zero failures/skips, in
/tmp/orbyn-agenda-scheduled-source-recovery-fixed.log. Earlier7/8 failure is
retained in /tmp/orbyn-agenda-scheduled-source-recovery.log.

## Scheduled Settings/status candidate — 5 October 2026

Owner-only private summary metadata and matching web/desktop/mobile controls are
now uncommitted alongside migration238/runtime. Permission remains explicit,
versioned and independent of digest/email settings. UI operations are fenced to
the current owner/session, cancel on unmount/account change, use reviewed versions
and show current model/fallback plus dated durable status. API refuses keys, foreign
owner query overrides and GET bodies; credential/source snapshots are excluded.
Tests: status/permission7/7, shared status2/2, scheduled runtime8/8, zero skips;
all workspace types passed. Build session25957 is running. Native/visual review,
cached recovery and atomic source fencing remain required before completion.

Exact PR196 head6be9561c local full session35409 encountered PostgreSQL recovery
errors (57P03), including poll-presence checks and fixture cleanup. This full run
cannot qualify promotion even if later tests pass. Retain its log; do not relax
assertions or database settings. CI37265979902 remains independently running.
No new main merge/deployment/cleanup. Goal retains complete ADR scope.

## Cached scheduled recovery and client contracts — 5 October 2026

Controlled cached recovery now passes10/10 in
/tmp/orbyn-agenda-cached-recovery.log. A signed completion survives worker lease
loss with the device offline: one request, one operation and one usage record;
a human edit after completion prevents later application. A queued-envelope
same-request recovery test has been added but awaits execution after full local
qualification; do not count it as passed. Fresh client/status contracts3/3 pass in
/tmp/orbyn-agenda-settings-client-status.log, including no ETag authority cache,
strict response fields and invalid-owner input rejection before dispatch.

The initial6be9561c full local run ended failure after PostgreSQL recovery:
2828 executed,2823 pass,5 fail (not a qualified result). Its log is retained.
A new fresh marked DB full run is confirmed live as session57229, log
/tmp/orbyn-6be9561c-full-tests-recovery.log. CI37265979902 has passed mail/mobile/
Docker, with backend tests still running. No test assertions, polling bounds,
retry intervals or Docker/database settings changed. Build25957 completed exit0.
Simulator control timed out and no native device was booted; native screenshots
and interaction are still required. Full ADR scope remains active.

Qualification update: CI37265979902 is now terminal success on6be9561c;
all four jobs pass. The fresh local full session57229 remains the outstanding
local gate. Log: /tmp/orbyn-6be9561c-ci-backend.log. No main merge yet.
CI backend detail:2838 pass,0 fail,1 existing conditional skip for installed
Tesseract scanned-page OCR. This is not full OCR acceptance; retain local OCR
runtime evidence as a separate gate. The retry regression itself passed in CI.

## Queued recovery and usage-limit follow-up — 5 October 2026

Added an undisclosed queued-envelope recovery test requiring the same request,
job and operation after worker lease loss. Added a signed usage-limit admission
failure test requiring terminal truthful status, zero completed usage and no
fallback operation without consent. Both await execution after serial full local
qualification. Do not count these two new integration cases as passed yet.

Scheduled ProviderError(chatgpt_usage_limit) now maps to fixed usage_limit status;
web/native share recovery text directing the owner to ChatGPT usage management.
The strict public status schema and API docs include this reason, never the raw
provider body. Shared status3/3 and backend types pass. The fresh exact-head full
session57229 remains active with no failure observed so far; CI success is retained.
Atomic all-source fencing and native/visual acceptance remain open.

## Preserved candidate history before main integration

# Production migration recovery and active Agenda candidate — 5 October 2026

PR198 is merged into main as `f816675b`, with the same tree as `81ffb44e`.
Root main safely fast-forwarded; user/character changes remain preserved.
All workspace types/build,13 pure and3 PostgreSQL cases passed locally.
Full CI37279096979 and main CI37279497795 remain live; backend suites have not
been reported terminal yet. The local full attempt failed on full test tmpfs;
`orbyn-postgres-test-1` is now confirmed exited1. Do not restart Docker or claim
local full qualification. No test fixture was removed: the cleanup attempt could
not connect. The user's normal deploy script now receives the hotfix; production
recovery remains unverified.

Agenda candidate `84e88b86` is committed locally; main `f816675b` was integrated
without conflicts as `2b20a074`. The isolated Study repair `06ebbf34` remains in
this candidate. Latest page-lock change adds NOWAIT with a savepoint so a page
edit waiting on the source advisory lock cannot create a cyclic row wait with
final application. This is a candidate, not yet database-verified. Four new pure
cases plus client/status cases pass10/10 in `/tmp/orbyn-agenda-nowait-pure.log`;
backend types24095 pass. A real concurrent human edit/application regression is
written but unexecuted because the test container is stopped. Full integrated
workspace types44252 are in `/tmp/orbyn-agenda-integrated-types.log`.

Prior source-fence/runtime/permission/catalog60/60 and final-application17/17
results are retained below. They qualify the preceding source, not the new NOWAIT
change. Scheduling remains unavailable for production SIWC catalogs without
signed hard-output-limit capability. Real nonempty ChatGPT completion, whole-
account plan/quota/reset data and client/native acceptance remain unverified.
The full C1–C6/M1/D1/U1 ADR scope remains active. No Agenda/main promotion,
worktree cleanup or deployment is claimed.

---

# Current implementation handoff — 5 October 2026

## Latest qualification and top-three work

**Authoritative current checkpoint:** PR #196 merged into main as
`e0a432a542a38b92957816b1e45c57a2aaa2ea43` on 5 October 2026. Merge and frozen
`47541c63` share tree `41df87fa5be668d19dfddb22b5536f2552cf0991`.
Fresh full local61988 exited0: 2,842/2,842 pass, no failures/skips/cancellations,
`/tmp/orbyn-475-full-tests-retry.log`. All four CI37273639006 jobs pass (backend
2,841 pass and one existing Tesseract skip). Root main fast-forwarded safely;
mobile/app.json and untracked user/character files are preserved. No deployment
or cleanup. The historical failures below remain unexplained, not erased by the
successful rerun.

Study overview/review/quiz now resolve links through their supplied transaction.
Baseline3333 failed all three privacy assertions on the original code;
`/tmp/orbyn-study-transaction-links-baseline.log`. Fixed Study/Agenda cohort44983
exited0, 36/36 pass, `/tmp/orbyn-study-agenda-fixed.log`. Backend types pass.
The isolated repair is committed locally as `06ebbf34`; it is not yet pushed or merged.

Migration239 and per-owner source advisory locks are an uncommitted concurrency
candidate. Migration executes successfully; backend types64404 pass. The initial eighteen-table/shared-reader/independent-owner cohort passed21/21
in `/tmp/orbyn-agenda-source-fence-db.log`. Expanded source-fence/runtime/
permission/catalog cohort32853 passed60/60 with no skips, including earlier
writer ordering and inserted-task phantoms, in
`/tmp/orbyn-agenda-source-fence-runtime-db.log`. Actual final-application cohort
52126 passed17/17 with no skips, including a new task blocked until the summary
commits, in `/tmp/orbyn-agenda-apply-concurrency-db.log`. Backend types29217 pass.
Row-lock deadlock behavior, broader writer effects, full candidate qualification
and visual/native acceptance remain open. Do not claim full source acceptance.

## Historical checkpoints (superseded by the current checkpoint above)

CI37273639006 completed successfully on47541c63: all four jobs pass; backend
2841 pass,0 fail,1 existing Tesseract skip (`/tmp/orbyn-475-ci.log`). Two subsequent
original recovery cohorts13/13 each passed; failure-only diagnostics preserved
original count polling/deadline and were removed automatically before a fresh
full retry. Frozen tracked source is clean. Fresh full local61988 is running on
marked `orbyn_47541c63_retry_qualification_test`, log
`/tmp/orbyn-475-full-tests-retry.log`. Do not restart a live handle or treat a
rerun as explaining the earlier intermittent failure. PR body now reflects
current evidence and removes the obsolete pause request. Goal remains active.

Native Simulator Computer Use observation returned timeoutReached (-10005);
no current native Settings screenshot or interaction is claimed. The blocked
browser permission is not bypassed through another browser/port/capture.

Latest terminal results: exact47541c63 full local56612 exited1:2824 tests,
2819 pass,5 fail,0 skips. Four agent-writes cases lost database connectivity;
its following agents test file could not start while PostgreSQL was recovering
(57P03). Original13 process recovery cases and the75-task bulk Review case
passed within their unchanged bounds. This run still cannot qualify promotion.
The prior18/19 extracted lane failure remains unresolved and separately retained.

Scheduled producer/capacity/permission/signed-catalog cohort62231 exited0:
37/37 pass,0 failures/skips, `/tmp/orbyn-agenda-producer-capacity-db.log`.
All three new producer/capacity cases executed successfully. Native inspection,
atomic all-source/phantom fencing and full scheduled-candidate qualification
remain required. No new main merge or deployment has occurred.

Shared web/native scheduling prerequisites now distinguish provider selection,
offline/stale device, unavailable model and unsupported limits. Both signed
inference and hard-limit capabilities are required; a limits-only capability
cannot enable the toggle. Concise copy replaces the misleading blanket claim
that every disconnected/default-provider state lacks limits. All-workspace
checkpoint33189 types pass; eight pure client/catalog/status tests pass with
zero skips/failures in `/tmp/orbyn-agenda-prerequisites-pure.log`. Native/visual
inspection and the three newly written producer/capacity database tests remain
pending. Changes are uncommitted with the scheduled candidate.

Current local full run56612 has encountered PostgreSQL57P03 recovery-mode
errors in agent-writes/agents; it cannot qualify promotion even if later tests
pass. Keep `/tmp/orbyn-475-full-tests.log`. The separate development PostgreSQL
container is repeatedly restarting with an empty postmaster.pid error. No Docker
or database settings have been changed. CI mobile/Docker/mail are successful;
backend/web remains running. These are independently reported states.

Three further scheduled Agenda database regressions are written but unexecuted:
shared Background admission without consuming interactive slots, idempotent
producer recovery for an untouched generated page without inference, and no
scheduled enrollment of a human-edited page. Backend types15845 pass;
seven pure client/catalog/status tests pass in
`/tmp/orbyn-agenda-current-pure.log`. Run the new database cases only after56612
terminates, preserving serial database suites and their original limits.

PR196 is pushed at `47541c631976b098899e237081da70a90cce3386` and remains
unmerged. Root main is `82576dfa`; user and character changes are preserved.
The extracted recovery/night cohort failed 1 of 19 tests: independent runtime
recovery observed only one provider lane before its original deadline. A
same-source diagnostic recovery rerun passed 13/13, zero skips. This is an
unresolved intermittent failure, not proof of a repair. Diagnostics were removed
before the fresh exact-head full suite. Keep both logs:
`/tmp/orbyn-night-bulk-extracted-recovery.log` and
`/tmp/orbyn-475-lanes-diagnostic.log`.

All-workspace typecheck and production build passed on47541c63. Fresh full local
suite session56612 uses marked `orbyn_47541c63_qualification_test`, log
`/tmp/orbyn-475-full-tests.log`. CI37273639006 is still running. These results
must reach terminal state before promotion; earlier green commits do not
qualify this head. Earlier422a5a9b full suite terminated2841 tests,2840 pass,
1 fail,0 skips (75-task bulk Review). The isolated bulk preflight repair retains
75 tasks, the original review threshold, deadlines and no-persisted-items checks.

The secondary scheduled Agenda/capability candidate remains uncommitted. Its
combined recovery/night/scheduled permission/signed catalog cohort passed53/53,
zero failures/skips, `/tmp/orbyn-top3-review-agenda-catalog.log`. Signed catalog
capability assertions therefore ran successfully. The deterministic final-write
expiry regression failed on the old write (`Missing expected rejection`) and
passed on the guarded write; baseline/fixed logs are
`/tmp/orbyn-agenda-final-deadline-baseline.log` and
`/tmp/orbyn-agenda-final-deadline-fixed.log`. It fences lease/window expiry at
page mutation, but does not establish atomic all-source or phantom fencing.
Producer/capacity, native UI and full candidate qualification remain open.

Official SIWC documentation was refreshed: authentication/model discovery do not
prove plan execution; a nonempty completed request does. Account-wide allowances
and app limits are managed in ChatGPT Settings → Usage. Orbyn exposes only
completed-request token usage, explicit permission and observed execution/errors;
it must not fabricate plan tier, allowance percentages or reset times. The
connected account's prior sharing-limit failure remains the latest real inference
evidence; no positive completion has been established. Do not automatically
repeat chargeable probes or use private endpoints. Full ADR scope remains active.

## Resumed top-three priorities — 5 October 2026

Scheduled final-write deadline candidate: applyScheduledAgenda now conditions the
page UPDATE on current parent state, owner/token, lease and morning expiry using
clock_timestamp after the source/page/job locks. Missing RETURNING row fails409
and rolls back page/transport completion. A new deterministic regression expires
the parent immediately before the final page UPDATE on the same transaction,
then requires409 plus unchanged content/version and running parent/child state.
Backend types37053 exited0, /tmp/orbyn-agenda-final-deadline-types.log. Regression
is not yet executed; run it and its old-source baseline after full session18748
terminates, preserving serial DB suites. This does not complete atomic source
fencing or native/real-provider acceptance. Changes remain uncommitted here.

Qualification correction:422a5a9b has passed original372 and378 but failed374,
the75-task Overnight bulk-review recovery test, waiting for terminal state after
Checking the plan before applying. Full session18748 remains live and must be
observed to terminal; this run cannot qualify promotion. Do not increase its
8-second deadline or reduce75 tasks. Inspect the review/check/destination path
and query/process timing. CI37272139189 remains independently live. No new main
merge. This correction does not waive the earlier failures.

Capability follow-up: combined pure catalog client/proof, scheduled client and
summary status cohort9/9 passes,0 failures/skips, terminal0 in
/tmp/orbyn-agenda-catalog-contract-cohort.log. Added signed-publication database
assertions to chatgpt-executor-leases.test.ts: an older catalog exposes no implied
capability; signed inference-only metadata round-trips without claiming limits.
These database assertions are not yet executed: keep DB suites serial until
full local session18748 terminates. Backend types51138 passed exit0, log
/tmp/orbyn-agenda-catalog-backend-types.log. Candidate remains uncommitted.
Fresh422a5a9b full run has passed the previously failed372 and378 recovery cases;
overall full/CI are still live, so no promotion claim. Real positive OpenAI
inference/plan usage and atomic all-source fencing/native acceptance stay open.

User explicitly resumed recovery/merge, ChatGPT verification and scheduled Agenda.
PR196 now422a5a9b, pushed. The independent lane recovery test owned an UPDATE-only
consent fixture created by an earlier test; isolated execution had no settings row
and Overnight failed before inference. Its own upsert/assertion now passes1/1
isolated. Same-source recovery cohort passes13/13; the preceding corrected cohort
still had an invite timing failure, retained without a claimed cause. See
evidence/assistant-recovery-consent-fixture.md. No deadline/assertion was weakened.
Fresh full local session18748 uses orbyn_422a5a9b_qualification_test and log
/tmp/orbyn-422a5a9b-full-tests.log. CI37272139189 is live. Observe these to terminal;
no new main merge yet. Preserve initial515e8959 failures and all source candidates.

Scheduled Agenda web/native enablement now additionally requires the server's
sanitized catalog plan_inference_limits_v1 capability. Catalog omission does not
imply output-limit support; optional typed capability metadata preserves older
catalog compatibility. Current SIWC production runtimes cannot enable the toggle
merely from login/default-model selection. Candidate contracts2/2 and all workspace
types pass, logs /tmp/orbyn-agenda-capability-client.log and
/tmp/orbyn-agenda-capability-types.log. These changes remain uncommitted with the
scheduled runtime; focused backend catalog integration, full qualification,
atomic source fencing and visual/native acceptance remain open. Do not infer
positive real OpenAI completion or account-wide plan usage from fixture tests.

## Current authoritative qualification — hard output budget repair

Pause checkpoint requested by the user: exact515e8959 full local session32803
terminated exit1,2841 tests,2839 pass,2 fail,0 skips. Failures: Overnight dynamic
outside invite staging and independent Background/Overnight process recovery in
assistant-process-recovery.test.ts. Both timed out waiting for terminal state;
do not weaken their8-second bounds or infer a cause from timing alone. Preserve
/tmp/orbyn-515e8959-full-tests.log. CI37268654124 completed success; all four jobs
pass, but CI does not erase these local failures. Build55391 exited0 and scoped
formatting63152 exited0. PR196 remains draft/open/unmerged at515e8959; root main
remains82576dfa with user dirt preserved. No cleanup or production deployment.
Before promotion: reproduce these process cases, repair their cause, then obtain
fresh exact-head full local/CI qualification. No live local test/build remains.

Main remains82576dfa. PR196 is now frozen515e8959, pushed with the isolated
hard output budget repair (source59c16fa8). Its42/42 focused tests and all workspace
typechecks pass. Exact-head full local session32803 uses the fresh marked
orbyn_515e8959_qualification_test database; log /tmp/orbyn-515e8959-full-tests.log.
CI37268654124 is running. Observe these handles to terminal before promotion.
The preceding6be9561c passed2839/2839 fresh local and all four CI jobs, but those
results do not qualify the newer repair. The initial recovery-failed run remains
retained; no test assertions or database settings were weakened.

Official SIWC preview excludes max_output_tokens. The real desktop adapter had
dropped the requested budget while advertising hard-limit capability. The repair
preserves budget preflight and fails before any request; production no longer
advertises limits it cannot enforce. Bounded private SIWC work remains ineligible
until the route can enforce its budget. Managed fallback still requires explicit
consent. Evidence: evidence/chatgpt-hard-output-budget.md.

Scheduled Agenda runtime/Settings/status remain uncommitted here. Latest combined
queued recovery, signed usage-limit, permission/status and route cohort passed
25/25, zero skips/failures, /tmp/orbyn-agenda-queued-usage-runtime.log. Atomic
all-source fencing, native/visual acceptance, producer/capacity qualification,
real positive provider execution and full scoped qualification remain required.
No main merge, production deployment or cleanup. Full C1–C6/M1/D1/U1 remains active.

## Current checkpoint — selected provider features

### 2026-10-05 — Agenda catalog compatibility and shared-clock qualification repair

CI 37286333130 on 50a92aa2 failed three tests (2927 passed, one existing Tesseract skip). Preserve the legacy internal catalog response as well as the HTTP response: capabilities now require an explicit opt-in argument, and capability assertions exercise that opt-in. Preserve both cross-runtime serialization assertions: fixed schedule fixtures now place their claimed page leases on the live chat runner's wall clock using the unchanged PAGE_RUN_LEASE_MS. No production runtime capacity or lease duration changed. Backend typecheck passed (/tmp/orbyn-agenda-catalog-clock-types.log). Database cases await exact-head CI; local test PostgreSQL remains unavailable. ADR remains incomplete.

### 5 October — Agenda main promotion and plugin integration

PR199 merged as8dcc4bb1 after exact a6a65525 CI37291303840 passed all four
jobs (2938 pass, zero failures, one existing Tesseract skip) and99 local focused
passes. Native/visual and positive real-account SIWC acceptance remain open.
Plugin1f594133 full local run passed2902, failed one generated catalog check,
with one existing Tesseract skip. Regenerated the catalog and integrated current
main, preserving both core exports and all historical task evidence. Combined
route catalog is generated from both sets of credential exclusions. No policy,
output cap or test assertion is weakened. Fresh combined qualification follows.

### Scheduled Agenda resumption fixture — 5 October 2026

Combined plugin source4454ea0f full local test completed2971 passes, one failure
and one existing Tesseract skip. The resumption positive fixture committed a
human note while the live worker could acquire a NOWAIT page guard, correctly
causing fail-closed refusal. Commit the unrelated note before resumption instead;
retain operation identity,512 output cap, and exact note-preservation assertions.
The separate actual conflicting-edit/NOWAIT regression remains unchanged.
Production guards, leases, capacities and billing limits are unchanged.

Repaired scheduled-runtime suite18/18 passes without skips, followed by five
independent subprocess repeats of the offline/resumption case, all passing on
the isolated marked Agenda test database. Logs:/tmp/orbyn-agenda-resumption-0.log
through /tmp/orbyn-agenda-resumption-5.log. Docs pure cohort108/108 is recorded in
[evidence](evidence/markdown-parity-current.md). Full combined plugin qualification
must be repeated before its main promotion; visual/native acceptance remains open.

## 5 October — Channel candidate and preview source correction

Channel candidate dc71351c is pushed and integrated with main baseline8b6748c5.
34 focused pure and17 database/inventory checks pass; workspace types/format
pass. The full local run was interrupted to correct public callback inventory;
it is not a passing full-suite result. No channel delivery/native acceptance or
main runtime promotion is claimed. Next: both client installation/review controls,
durable DM delivery with source/connection fences, rotating-token handling and
once-only current-card replies; then Teams.

5174 was running from devday-model-catalog at7f60b352,39 commits behind main.
Its tracked checkout was fast-forwarded to8b6748c5 and packages rebuilt; both
untracked preview files are preserved. The listener remains active. Browser
permission/native limitations still prevent visual acceptance here.

### Slack installation candidate — 5 October 2026

Added migration241, strict shared actor/confirmation/consent contracts and
session-bound installation services. Capture is encrypted and cannot link or
send DM without exact-origin review. Atomic single-use exchange, revision/actor
checks, owner/actor isolation, logout/configuration/expiry refusal, explicit DM
opt-in and credential-clearing unlink are implemented. Ten isolated database
cases pass at DB_POOL_MAX=1;17 pure OAuth/reply and10 logging/gateway cases pass.
Environment, Privacy/version and hourly retention definitions accompany source.

The module remains unmounted and unmerged. Mount HTTP shields/status/callback,
finish both client controls, rotating tokens, durable outbox/current waiting-card
reply consumption, then Teams. External workspace, gateway runtime and native/
visual acceptance remain open. Full ADR remains active. PluginPR203 is now
qualified and merged as0faf19dc, with2975 local/CI passes and one existing skip.

### Durable channel delivery candidate — 5 October 2026

Implemented Slack outbox deduplication, committed claims, live source/owner/
consent fences, independently named Background and single morning Overnight
DMs, bounded provider transport and terminal uncertain-send recovery.96/96
integrated database tests and25/25 pure checks pass; all workspace types and
changed source formatting pass. Cold DB_POOL_MAX=1 process succeeds without
cached encryption keys. Commit-failure-after-acceptance and real source-write
blocking are exercised. Evidence: evidence/agent-channels.md.

Continue both client channel controls, token rotation, durable exact-card
signed reply consumption and Teams. Full local/CI and authorized external,
native/visual acceptance remain required before runtime promotion. Main still
contains qualified prior features; this channel source is unmerged. Full
C1–C6/M1/D1/U1 remains active, with no production deployment or cleanup.

### Slack connection controls and retention review — 5 October 2026

Both client controls and the shared session-bound store are implemented, with
DM permission default off, verified account/workspace/scopes review, fresh CAS
changes and pending UUID-only restoration.23 pure store/Settings cases, all
workspace types, web production build and both native exports pass. Visual/
native interaction and authorized Slack acceptance remain open.

The diagnostic broad run launched atb27eb8ba passed3027, failed zero and skipped
one existing Tesseract case. It overlapped later source edits; no exact-head
full qualification is claimed. Review repaired fixed14-day receipt retention
and bounds stale queue/dispatch records when configuration is disabled.
The final integrated outbox/notice/Agenda/sweeper cohort passes104/104, zero
failures/skips (/tmp/orbyn-channel-fixed-retention-final.log). Controls are committed as4b9c670f and pushed, with current main689a15a4
integrated as54976eeb without conflicts. Continue
continue token rotation, durable signed exact-card replies and Teams. Do not
claim whole ADR, real delivery or production/native acceptance. Root main
user files remain preserved; no cleanup or deployment was performed.

### Fixed retention main checkpoint — 5 October 2026

Main689a15a4 is pushed: fixed retention uses each rule's declared duration,
with7/7 sweeper regression/security/concurrency cases passing. The channel
cohort passes104/104 without failures/skips. Candidate connection controls,
rotation/reply/Teams work and exact-head/native/real acceptance remain separate.
See evidence/agent-channels.md for retained failures and current evidence.
Full C1–C6/M1/D1/U1 remains active; deployment remains user-run.

Current channel checkpoint54976eeb is pushed and tracked-clean. Main689a15a4
rerun passed7/7 using the existing macOS esbuild binary after root dependency
bootstrap failed; no dependency files or user-owned root files were changed.
Next implementation: token rotation, durable signed exact-card replies, Teams;
then exact-head qualification and real/native/visual acceptance. No cleanup.

### Owner-pair Slack rotation candidate — 5 October 2026

Durable one-use refresh claims and state, bounded fixed-endpoint transport,
exact identity/scopes preservation, fail-closed ambiguity and credential erasure,
three bounded rate-limit attempts and version-preserving publication are in
source. Existing queued messages defer rotation without spending send attempts.
Both client token/reconnect states, API/setup docs and Privacy are updated.
31 pure and126 integrated checks pass, as do current workspace types, formatting,
web build and native exports. No real Slack/native/visual acceptance is claimed.

Before promotion, implement canonical workspace-bot credential coordination:
Slack limits active rotated tokens, so independent owner records in one workspace
must not rotate independently. Then durable exact-card reply consumption, Teams,
exact-head full/CI and authorized external/native/visual acceptance. No channel
runtime/UI source is on main. Main429f2de2 all four CI jobs passed in37308099452
(2976 backend passes, zero failures, one existing skip); deployment is user-run.
Full C1–C6/M1/D1/U1 remains active. See evidence/agent-channels.md.

### Teams transport, lifecycle and matching controls — current candidate

Independent bot credentials, bounded fixed Microsoft transport, durable outbox
claims and current owner/source/permission/conversation fences are implemented.
Background transitions and the single morning notice enqueue Teams intents;
accepted-but-uncertain sends never replay. Authenticated personal uninstall
events clear only the current proved route; stale events cannot revoke a later
proof. Migration250 refuses legacy conversation authority without inventing
an authenticated timestamp. Lost linking challenges can be renewed separately
from identity OAuth. DM permission defaults off and requires explicit review.

Both clients use the same session-bound Teams store, persist only a pending
request UUID, and keep linking commands only in memory until expiry/proof.
Expired commands erase locally without network retry loops. Review, personal
chat linking and consent are separate compact controls. Workspace typechecks,
backend/web builds and21 current store/client/gateway cases pass. The preceding
lifecycle/API/source cohort passed56/56; added migration/retention cases still
require execution after the serial identity full suite. Native export is running;
no screenshots or real tenant/native/visual acceptance are claimed.

Identity CI37328563056 failed only the stale recovery test because its live
runner consumed fixtures before the explicit sweep. Repair6bda01e9 stops that
runner for this test and restarts it in cleanup; all41 assertions pass, unchanged.
The immutable repaired full run and CI37332522843 are ongoing. Main690f6246
still contains the qualified Slack checkpoint. Teams source remains unmerged.
Next: qualify and promote checkpoints, exact-card Teams replies, then remaining
whole-app UI, Docs and agent/page requirements. Full ADR remains active.

Current transport/lifecycle/UI cohort now passes112/112; cold installation and
legacy-migration cases pass24/24. All workspace types, whole format, backend/web
builds and iOS/Android exports pass. Identity repair6bda01e9 completed its
immutable full local suite:3130 passes, zero failures and one existing skip; CI
backend remains pending. Delivery/UI full/CI qualification is next.

Latest recovery fixtured926b03c now stops both Background and interactive
recovery sweepers during fixture setup, and restores both for subsequent tests.
Its41-case assistant-runs cohort passes. Earlier6bda full/CI results apply to
that prior test source. The first delivery full run at7bda2185 was deliberately
stopped to incorporate complete fixture isolation; it is not passing full
evidence. Application source integrates without conflicts; the previous merge's
generated catalog conflicts were regenerated to287 exclusions and evidence
notes were combined, preserving both histories. No unresolved merge remains.
Current delivery controls need immutable combined full/CI qualification next.

Teams replies now have a separate unmounted authenticated protocol foundation
oncodex/agent-teams-replies:11 real-RSA cases and focused types pass. Delivery
PR206 remains frozen5bc0bc9d for full/CI; identity PR205 is d926b03c. Simulator
inspection retried and still returns timeout-10005, without screenshot evidence.
Continue receipt/card/transaction implementation after the current serial full
run; do not claim replies, native or visual acceptance from protocol checks.

Teams reply branch continues with complete bounded cards and signed parsers.
16 pure tests and focused TypeScript pass. Still unmounted until nonce/card
receipt persistence and atomic current-question authority checks are complete.
Delivery candidate remains frozen during fresh isolated full qualification;
previous reused-database full result (3171 pass, 9 fail, 1 skip) is retained.
Several failures claimed unrelated queued fixtures left by an interrupted run;
unchanged source is being qualified in a fresh marked test database. No main
promotion or whole ADR completion is claimed from this rerun before it ends.

### Current Teams reply candidate — 6 October 2026

Durable cards, signed callback capture, exact-question receipt consumer, expiry
and both-client messaging disclosure are implemented locally on
codex/agent-teams-replies.132 integrated channel checks,20 sweep/reply checks,
9 cold pool1 checks, workspace types/builds/format pass. Migration251 and the
existing sweep connection reuse repair are included. Full immutable suite/CI
remain next; real tenant and native/browser acceptance remain open. Main remains
28059ed1. No production deployment or cleanup is claimed.

### ChatGPT reprioritized — 6 October 2026

User explicitly moved direct ChatGPT connection ahead of Docs. Fresh source and
OpenAI source inspection confirms the current web/mobile controls only queue a
desktop request. Initial OSS registration needs no pre-issued client ID; the
actual browser-only gap is the required local loopback listener and supported
user-controlled credential/runtime mechanism. Terms inspected at the user's
request require persistent SIWC tokens local and under user control. No hosted
credential-storage implementation was retained. See the new ADR connection
correction for exact sources, platform requirements and remaining gates.

Next work: native callback/secure credential/executor implementation independent
of desktop, while investigating an official browser-only transport. Do not
claim that a popup, hosted identity-only OAuth or changed copy resolves the
user's ChatGPT-plan requirement. Main application remains869a8005; this is a
documentation correction only. Full Docs offline candidate0ee17ce5 remains
unpromoted; its specific full-suite session56698 was confirmed live on resumption.

### Native ChatGPT callback candidate — 6 October 2026

Branch `codex/chatgpt-direct-web-oauth` now has an unactivated local Expo module
for both iOS and Android. Swift Network and JVM ServerSocket listeners bind only
127.0.0.1 with an ephemeral port, enforce exact callback path/Host/state,
duplicate-parameter and Origin/body rejection, bounded headers/read lifetime,
one-use delivery, timeout/cancel and attempt-owned cleanup. No provider secrets
are stored or logged. Core native/local authorization and callback contracts use
initial dynamic registration, Orbyn naming, returned issued-client identity,
PKCE/nonce and exact URI; no pre-issued client or workspace API key is required.

Native listener fixtures are real socket checks against the exact Swift and
Kotlin classes, run on this Mac/JVM (not an iPhone/Android app). They cover wrong
state, duplicate parameters, Origin, valid callback, replay, cancellation and
expiry. `node scripts/verify-chatgpt-native-loopback.mjs swift` and `... kotlin`
both pass. Swift additionally typechecks for arm64 iOS simulator SDK.7 core
contract cases and package builds/mobile types pass. Expo module wrappers have
not yet been built into an app or exercised on-device. No UI activation or full
ChatGPT/native completion is claimed.

Next: OS authorization browser lifecycle (including iOS suspension), protected
local token exchange/verification/refresh, native executor/signing, models and
one-button UI integration; native build and real authorization acceptance.
Hosted browser-only connection remains unmet. Do not ship a Connect button that
only establishes identity while provider execution still requires a laptop.

The unchanged offline Docs candidate0ee17ce5 full suite finished successfully:
3622 pass,0 fail,1 existing skip,817079.239ms,terminal exit0. Evidence:
`/tmp/orbyn-channel-offline-editor-full66.log`. It remains unpromoted while the
user's ChatGPT-first priority is active.

Final callback-candidate checks: backend, desktop and mobile typechecks pass;
package builds and owned Prettier/diff checks pass. Expo autolinking resolves
OrbynChatgpt on both apple/android (metadata proof only, not native wrapper build).
Repeated Swift/Kotlin real-socket fixtures pass after tightening raw callback
path validation and one-callback acceptance. No chargeable provider request or
UI sign-in was performed.

### Native ChatGPT sign-in lifecycle candidate — 6 October 2026

The native-only sign-in service now starts its own listener, opens the existing
OS browser adapter, validates the exact callback/issued registration, exchanges
locally and sends only the short-lived ID proof to the existing session-bound
backend verifier. It checks the current Orbyn user with a fresh cancellable
`/me` read, fences session changes and concurrent attempts, and installs the
verified grant in WHEN_UNLOCKED_THIS_DEVICE_ONLY secure storage. A cancelled
secure replacement restores its own previous record without removing another
replacement. Invalid local records are retained and diagnostics exclude their
contents. Initial/reconnect host identity is stable. No browser storage fallback
or desktop queue is used by this service.

Portable exchange/refresh preserve rotating credentials together, honor actual
returned scopes, reject escalation and unknown/invalid token replies, bound
stream reads and request lifetime, cancel late responses even if fetch ignores
abort, and sanitize provider errors. The helper returns an unverified grant;
callers must verify identity before installation/use. Native initial sign-in uses
the existing backend signature/issuer/audience/nonce verifier. Refresh helpers
are not activated in the native runtime yet: changed refreshed identity must be
verified before a stored credential rotation is allowed.

28 focused pure/actual-source VM checks pass across callback contracts, token
transport and native sign-in orchestration. They include wrong/denied callback,
missing plan scopes, altered verified identity, session changes during proof and
secure write, restoration of a previous account, concurrent attempts, corrupted
local records and native browser cancellation. These mocks do not prove a real
OS authorization browser, secure-store installation or provider request.

Still required before settings activation/promotion: native build and actual
browser/callback lifecycle (including suspension/custom-tab return), refreshed
identity verification, disconnect/profile management, private native executor
signing/enrollment/lease/model publication/inference and provider-choice UI.
The service currently retains one selected local registration; multi-profile
management remains incomplete. Web-only direct connection remains unmet. This
candidate has no new endpoint or migration; `/me` gained optional fresh/signal
options while retaining existing default callers.

Final lifecycle-candidate qualification:30 combined checks (including existing
connection-client contracts) pass,0 fail/skip. Backend, desktop and mobile
current-source typechecks all terminate0; package builds, owned formatting and
diff checks pass. Evidence: `/tmp/orbyn-chatgpt-local-sign-in-client-tests.log`.
No full DB suite, installed native app or real provider inference is claimed
for this lifecycle candidate. Main application stays869a8005.

## Native local model discovery checkpoint — 6 October 2026

The native sign-in candidate now reads the selected registration's live OpenAI
`/v1/models` catalog directly with its protected local access token. It requires
an eligible, unexpired grant, a fresh matching Orbyn owner and a still-live exact
server identity. Session, sign-in or protected-registration changes discard
late responses. Only connection metadata and displayable models are returned;
access/refresh tokens remain private. The catalog neither runs inference nor
proves a plan tier or remaining quota. No curated/managed model fallback is
substituted. Expired grants currently require reconnect; refreshed identity
verification and safe rotation remain pending.

The portable model transport shares bounded JSON reads, deadline/cancellation,
no redirects/cookies/cache and sanitized errors with the token transport.
Existing token error semantics are retained; a model endpoint 401 requires
reconnect. The first regression run caught an unintended token 401 classification
change; it was corrected in implementation without changing prior assertions.
Final focused result:39 pass,0 fail/skip,terminal0,1175.4565ms. Evidence:
`/tmp/orbyn-chatgpt-native-models-tests.log`. Package builds and backend/desktop/mobile typechecks
pass (all terminal0). No real provider request, native installed-build acceptance, settings
activation or full DB regression is claimed.

Remaining ChatGPT-first work: refreshed identity/local rotation, disconnect and
multi-profile ownership, native executor signing/enrollment/lease/catalog and
inference, provider choice/fallback UI, actual iOS/Android lifecycle acceptance,
and a supported direct web connection. The native service is not yet wired into
Settings; a catalog foundation is not a completed usable provider. Main is not
changed by this candidate. Full C1-C6/M1/D1/U1 remains active.

## Native disconnect lifecycle checkpoint — 6 October 2026

The selected native registration can now be disconnected through the service.
Disconnect locks out competing sign-ins and model reads, aborts and awaits an
active callback attempt, verifies the current Orbyn owner, erases the exact
protected local record and then revokes its exact server connection. A server
revocation failure reports that local removal succeeded but remote revocation
is unconfirmed. Corrupt records are erasable without guessing a connection ID;
the installation host identity is retained. Session changes during deletion
prevent server calls through the replacement session. In-flight model reads
cannot publish after the local record changes. Fresh `/me` ownership verification
is still required before local deletion: this is not yet an offline disconnect
facility or multi-profile account manager. Future native executor shutdown/key
removal must join this lifecycle before provider activation.

Final focused callback/token/model/sign-in/disconnect/client result:46 pass,
0 fail/skip,terminal0,1462.095667ms. Backend and mobile typechecks terminate0.
Evidence: `/tmp/orbyn-native-chatgpt-disconnect-all.log`. These are actual-source
VM checks with mocked native store/browser/API boundaries; they do not establish
installed OS keychain, browser or executor behavior. No Settings activation,
main merge, production deployment or full ADR completion is claimed.

Next ChatGPT-first work remains refreshed identity/rotation, native executor
cryptography and enrollment/lease/inference, multiple local registrations,
provider choice/fallback, installed-device acceptance, and the unresolved direct
web sign-in path. Existing Ed25519 server proofs must retain their ownership and
fencing guarantees when mobile signing is added. Do not equate native primitive
availability with support on every Android version.

## Native refresh identity and rotation checkpoint — 6 October 2026

Near-expiry native model reads now refresh through OpenAI locally. An unchanged
retained ID token keeps the original verified identity; a replaced ID token must
pass signature/issuer/audience/expiry/age/subject verification against the exact
existing owned registration before any protected rotation. The new first-party
`POST /ai/connections/chatgpt/refresh-identity` accepts only connection ID and ID
proof. It checks live user/session/registration before and after remote signature
verification, makes no writes and cannot create, revive or relink an account.
Access and refresh tokens never reach this endpoint. Strict session-only auth,
input filtering, rate limiting, no-store responses and sanitized errors apply.

Local refresh serializes with sign-in/disconnect and fences protected writes.
Disconnect aborts and awaits pending refresh; late provider responses cannot
reinstall erased credentials. Session changes during secure writes restore only
the prior unchanged record. Reduced plan scopes retain rotating credentials but
cannot authorize model discovery. This service still holds one selected local
registration and requires live Orbyn ownership; multiple accounts and offline
management are not finished. Native executor shutdown/signing/inference and
Settings activation remain required.

Final focused result:63 pass,0 fail/skip,terminal0,1539.659584ms. This includes
real JWT signature/claim tests plus mocked route/DB/native lifecycle boundaries.
Initial qualification caught TypeScript nullable closure errors and a cross-VM
prototype comparison in a new test; immutable narrowing and serialized exact
proof comparison fixed those without changing existing production assertions.
Package builds and backend/desktop/mobile typechecks terminate0. Evidence:
`/tmp/orbyn-native-chatgpt-refresh-qualified.log`. No live PostgreSQL race,
installed native app or real provider inference is established by these mocks.
No migration is added. No main merge or full ADR completion is claimed.

## Native executor key foundation checkpoint — 6 October 2026

The server now accepts canonical P-256 alongside existing Ed25519 public proofs.
P-256 is required for native OS signing support across the project's older
Android range: Android documents Ed25519 only fromAPI33 while ECDSA/SHA256 reaches
older versions. No cryptography dependency or minimum OS increase was introduced.
Source: https://developer.android.com/reference/java/security/Signature .
Only prime256v1/uncompressed canonical SPKI and fixed64-byte P1363 signatures are
accepted; key algorithm is derived by the server. Other curves, private keys,
encoding aliases and DER signatures remain rejected. The existing Ed25519
messages and proofs are retained. Migration253 widens only public-key checks in
executor enrollments/challenges; no identity or lease fences are bypassed.

Native key helpers are implemented: iOS CryptoKit P-256 with protected
WhenUnlockedThisDeviceOnly Keychain persistence and Android non-exportable
AndroidKeyStore P-256. Public metadata, bounded domain-prefixed proof signatures
and exact-key removal are the only bridge methods; private key material never
crosses the bridge. Sign refuses to create a missing/replaced key and requires
the expected public fingerprint. Kotlin's strict ASN.1 conversion changes the
OS ECDSA DER encoding to fixed P1363; it implements no cryptographic primitive.
Future runtime code must still validate exact domain/body/binding/expiry before
calling these methods and join key removal/executor stop to disconnect.

Evidence:70 focused pure/JWT/mock route/native tests pass,0 fail/skip,terminal0,
1827.4845ms; `/tmp/orbyn-chatgpt-native-key-unit.log`. Fresh markedDB67 applied
migration253 and passed23 connection/enrollment tests,0 fail/skip,terminal0,
7939.989417ms; `/tmp/orbyn-chatgpt-native-keys-db67.log`. Swift CryptoKit and Java
P-256 signatures both passed the actual backend verifier via
`node scripts/verify-chatgpt-native-loopback.mjs swift keys` and `kotlin keys`.
Kotlin exercised200 randomized DER→P1363 signatures plus malformed encodings;
Android key helper compiled against cachedSDK36. Swift key helper typechecked
against the iOS15.1 simulator SDK. Both existing loopback socket fixtures still
pass. Package builds and backend/desktop/mobile typechecks terminate0.

These checks do not execute AndroidKeyStore or iOS Keychain persistence, compile
the complete Expo wrappers into an installed app, or validate locked-device,
reinstall, suspension or OS browser behavior. Executor signing orchestration,
enrollment/lease/catalog publication/inference, disconnect/key lifecycle,
multiple account management and provider-choice Settings activation are still
incomplete. Web-only direct sign-in is still unresolved. No main promotion,
production deployment or full ADR completion is claimed by this foundation.

## Native enrollment/lease/catalog lifecycle checkpoint — 6 October 2026

A portable runtime-owned signer validates the exact enrollment and lease domain,
body, host, account, public fingerprint, epochs, nonce and expiry before asking
native keystores for proof. Catalog signatures use the canonical bounded digest.
Live ownership is rechecked after every asynchronous key/proof operation; close
and exact-key revocation permanently stop the signer. No private-key method is
exported to views. The shared lifecycle enrolls the device, validates the returned
registration, claims the expected next lease, serializes monotonic heartbeats and
model publication, verifies receipts and aborts queued/in-flight work on close.
Its timer/listeners are disposed on every operation. It deliberately does not
advertise inference capability before a working inference adapter exists.

The actual native factory wires this lifecycle to protected credentials, native
keys, installation host, fresh exact-account server metadata and live local model
reads. Creating a replacement invalidates older/pending runtimes. Sign-in and
disconnect close owned executors; disconnect removes the local signing key after
erasing credentials and still attempts server revocation on key-removal failure.
A callback-only older installed build cannot claim executor signing support.
The factory is not yet activated in Settings, does not run a background timer,
and currently publishes catalogs only; inference/foreground lifecycle and account
management remain required before it is a usable provider.

Final qualification:79 focused tests pass,0 fail/skip,terminal0,2048.425667ms.
Actual portable P-256 proofs are checked by the backend verifier; native factory
checks run actual TypeScript with mocked OS/provider/API boundaries. Initial tests
returned an extra expiry field outside the strict catalog receipt contract; the
new fixture was corrected to the real contract without loosening validation.
Evidence: `/tmp/orbyn-chatgpt-native-lifecycle-qualified.log`. Package builds,
backend/desktop/mobile typechecks, owned formatting and diff checks terminate0.
No installed OS app, full DB suite or live provider inference is claimed.

New prerequisite for inference: existing `chatgptInferenceReceiptMessage` embeds
the complete result, while `verifyChatgptExecutorProof` limits message input to
2048 characters. A valid4000-character completed receipt produced4597 message
bytes and its otherwise-valid Ed25519 signature was rejected by the actual
verifier. Native signing also intentionally bounds proof messages to2048 bytes.
Implement a versioned canonical digest receipt shared by server/desktop/native,
retaining explicit legacy verification where bounded, before inference activation.
Do not claim native execution complete from enrollment/catalog evidence.

No main promotion or production deployment is claimed. Web-only direct sign-in,
actual installed-device acceptance, multiple accounts, usable provider choice and
fallback UI remain open, as do the rest of full C1-C6/M1/D1/U1.

## Versioned inference result proofs — 6 October 2026

The oversized signed-result defect is corrected in the candidate branch. New
clients publish `proof_format: sha256_v2` and sign a domain-separated SHA-256
digest of the strict canonical receipt. All identity, assignment, epoch, model,
nonce, request hash, result and measured usage fields remain covered. The proof
message stays below 128 bytes even for a one-million-character result. Desktop
and portable native signers use the same contract; native bridge guards accept
its explicit domain. The backend retains exact bounded legacy verification when
no format is supplied, rejects unknown formats, and does not silently downgrade.
Deploy the compatible backend before updated clients. No database migration is
needed for this wire-format change.

Fresh marked DB69 passed all 17 broker tests, zero failures/skips, terminal zero,
11382.407583ms, including large-result publication for Ed25519 and P-256.
Evidence: `/tmp/orbyn-chatgpt-inference-db69.log`. The first DB68 run caught a
wrong provider-version argument in the new test fixture; the fixture was fixed
without relaxing production checks. Sixteen focused proof/signer/lifecycle tests
pass, zero failures/skips, 1348.592458ms; `/tmp/orbyn-inference-v2-unit.log`.
All 280 ChatGPT unit tests pass, zero failures/skips, terminal zero,
19585.486166ms; `/tmp/orbyn-chatgpt-v2-all-unit.log`.
Package builds and backend/desktop/mobile typechecks pass. Existing actual Swift
and Java P-256 proof fixtures pass the backend verifier. This does not verify
installed native keystores, browser sign-in, live provider inference or UI.

Native inference polling/execution and foreground lifecycle are next. Settings
activation, browser-only direct connection, multiple accounts, truthful plan
and usage presentation, fallback controls and full ADR acceptance remain open.
This checkpoint does not establish a working cross-platform provider or a main
promotion; the full goal remains active.

## Native assigned inference checkpoint — 6 October 2026

The portable executor now processes one server-owned assignment at a time while
heartbeat/catalog work stays independent. It checks strict assignment shape,
exact account/executor/enrollment/lease, expiry and a locally computed payload
hash before provider disclosure. Completion has a bounded deadline; close or
cancellation rejects even an uncooperative adapter, and late results cannot
publish. Ownership and lease are rechecked before signing and publication.
Unknown transport outcomes are not retried or converted into confirmed admission
failures. Explicit sanitized provider results use the versioned digest proof.
Catalog-only runtimes still cannot execute and advertise no inference capability.

The actual native factory now supplies this adapter: protected local tokens,
local verified refresh, live entitlement catalog and fixed OpenAI Responses SSE
transport. Tokens never enter result receipts or the shared backend. The existing
provider client also accepts an exact verified OAuth subject binding; native
registrations do not invent workspace identifiers. Model/input, store:false and
stream:true use the existing strict transport; only an observed completed event
succeeds, measured usage is preserved, and unsupported hard budgets remain
rejected. No hard-limit capability is advertised. Native callers can executeNext,
with foreground activation and timers still to be wired into Settings/app state.

Evidence: all289 ChatGPT unit tests pass,0fail/skip,terminal0,19970.117666ms,
`/tmp/orbyn-native-inference-all-unit.log`; the final focused69 tests include
additional real-deadline and explicit-failure coverage,0fail/skip,terminal0,
2661.914125ms, `/tmp/orbyn-native-inference-qualified.log`. Package builds and
backend/desktop/mobile typechecks terminate0. Actual native factory TypeScript
runs against mocked OS/provider/API boundaries and yields a nonempty fixture
answer, measured usage, verified P-256 publication and sanitized quota failure.
These are not live OpenAI inference or installed iOS/Android acceptance evidence.
No new HTTP endpoint, migration, dependency or UI activation is introduced here.

Next: activate and stop the native executor with foreground/session/provider
lifecycle, expose connection/model/provider-choice controls coherently, then
verify the installed app. Browser-only direct sign-in remains unresolved and
must not be presented as a desktop handoff fix. Multiple account management,
truthful plan/usage UI, cross-platform acceptance and the remainder of the full
C1-C6/M1/D1/U1 goal remain open. No main promotion or deployment is claimed.

## Native foreground and Settings activation — 6 October 2026

Native Settings now invokes the local OAuth sign-in service directly rather than
queueing a desktop handoff. It exposes cancellation, runtime status, retry and
local disconnect while keeping account-bound model/default/provider controls.
The mobile-web build explicitly says direct browser connection is unavailable;
it no longer presents the native Connect action as a working hosted connection.
The desktop web handoff remains an unresolved separate path, not a completed fix.

A single app-owned foreground controller survives Settings dismissal. The root
binds it to the verified user/session, legal gate and native AppState. Suspension,
sign-out, owner changes and close abort the executor and remove all scheduled
work. Late asynchronous startup cannot reactivate a replaced owner. Separate
25-second heartbeat and 10-second claim timers avoid starving lease renewal;
terminal errors stop all timers and require retry or a later foreground entry.
No protected registration means no executor or periodic work. Session tokens stay
private to controller ownership checks and are excluded from status snapshots.

Qualification:297 ChatGPT unit tests pass,0fail/skip,terminal0,19897.700959ms;
`/tmp/orbyn-native-foreground-final-unit.log`. Scheduler tests cover startup,
independent timers, suspension/sign-out, stale factory completion, terminal error
and missing registration. The actual Settings render fixture invokes native
Connect and verifies local sign-in/resume without a desktop request. Previous
handoff-only UI fixture assertions were updated to the new intended behavior;
model filtering/offline/save coverage remains. Package builds and all three app
workspace typechecks pass; `/tmp/orbyn-native-foreground-final-typecheck.log`.
Formatting and diff checks pass. No database/schema/HTTP change was introduced.

Computer Use inspection of Simulator returned server timeout -10005. No installed
native build, OS OAuth callback/keystore, screenshot/layout acceptance, real
OpenAI inference or production readiness is claimed. This candidate stays on
codex/chatgpt-direct-web-oauth pending installed-platform acceptance and an
integration/main review. It is not yet on main or deployed.

The user requested pausing after this step. Resume from installed iOS/Android
acceptance and direct browser connection research/implementation. Preserve all
remaining C1-C6/M1/D1/U1 scope: provider/account/usage/fallback acceptance, separate
plugin backend integration and MCP, Background/Overnight collaboration/reflection,
whole-app UI and modal/settings parity, full owned Docs Markdown/Mermaid workflows,
maintained/shared/published pages, Slack/Teams, qualification and final cleanup.

## Resumed native recovery checkpoint — 6 October 2026

The user resumed the goal and requested regular current-state reporting. A concise
tracker now lives in docs/reviews/adr-current-state.md; it preserves all original
C1-C6/M1/D1/U1 requirements and separates candidate, qualification, main and deployment.

Code review found two native activation defects: failed/cancelled reconnect left
preserved credentials without an active executor; and the catalog expired after
five minutes while only the lease was renewed. Settings now resumes the existing
local executor in finally (for the same Orbyn session only), without repeating
OAuth. The foreground scheduler refreshes catalogs every two minutes alongside
independent claim/heartbeat timers; suspension/error/owner changes clear all three.
The architecture introduction now distinguishes managed gateway calls from the
personal device-owned direct-provider path.

Qualification:298 ChatGPT unit tests pass,0fail/skip,terminal0,20081.157709ms,
`/tmp/orbyn-native-recovery-all-unit.log`; focused16 pass,0fail/skip,1306.056458ms,
`/tmp/orbyn-native-recovery-focused.log`. Packages and all workspace typechecks
exit0, `/tmp/orbyn-native-recovery-typecheck.log`. No DB/schema change. Fetched
origin/main remains29b74ecd; read-only merge-tree against the previous candidate
head succeeds without conflicts. Final commit must be rechecked before promotion.

Simulator Computer Use still times out (-10005); simctl showed no booted device.
Only2.9GiB disk space was available, so no large native prebuild/build was started.
Actual installed OAuth/keystore, screenshot and live inference acceptance remain
open. Concurrent catalog/inference renewal also needs review: the native service
currently rejects overlapping current actions conservatively; do not claim seamless
refresh until this is exercised and coordinated.

Official OSS docs rechecked6October still specify dynamic_agent_client without a
pre-issued client secret/partner key and an HTTP127.0.0.1 callback. Website docs
separately describe identity registration and do not establish a hosted dynamic
plan-runtime flow. Hosted web remains unmet; no desktop handoff relabeling or remote
persistent-token storage is added. Sources:
https://developers.openai.com/siwc/token-sharing-open-source/sign-in
https://developers.openai.com/siwc/website
https://openai.com/policies/sign-in-with-chatgpt-terms/

Goal stays active. No main promotion or production deployment is claimed here.

## Native refresh coordination — 6 October 2026

Same-account model reads now serialize local credential renewal and retain their
original Orbyn session/cancellation fence while queued. Parallel catalog/inference
requests cannot rotate the same refresh token twice or overwrite a newer protected
revision. The native action record distinguishes sign-in from verified refresh;
an already-owned executor may keep renewing its lease during refresh only when
the exact protected account key and captured Orbyn session match. New sign-in,
foreign session/account, disconnect, scope reduction and failed identity/CAS
checks remain fenced. No arbitrary current action is allowed through.

Tests execute actual native service/factory TypeScript with mocked OS/provider/API
boundaries. Two catalog reads share one verified rotation; a heartbeat succeeds
while the owned refresh is blocked; simultaneous catalog/inference work completes
with one rotation and a verified signed nonempty result; changed-session and
cancelled queued reads never adopt replacement credentials; disconnect aborts
shared refresh and no queued request restores or uses credentials afterward.

Qualification:304 ChatGPT unit tests pass,0fail/skip,terminal0,18056.099292ms,
`/tmp/orbyn-native-refresh-coordination-all.log`. Initial focused37 tests passed,
0fail/skip,1569.394083ms, `/tmp/orbyn-native-refresh-coordination.log`; final cohort
adds simultaneous inference/catalog and queued-disconnect cases. Package builds
and backend/desktop/mobile typechecks terminate0,
`/tmp/orbyn-native-refresh-coordination-types.log`. No HTTP/schema/dependency or
UI-layout change is introduced. Protected rotation, verified identity, strict
sharing scopes and fixed provider transport remain intact.

This closes the identified current-action concurrency defect in the candidate;
it does not prove installed-device OAuth/keystore/suspension, real OpenAI usage,
multiple accounts, hosted browser-only connection, production readiness or the
full ADR. Main qualification/promotion and all remaining full-scope acceptance
still need work. Keep docs/reviews/adr-current-state.md updated per checkpoint.

### Native OpenAI session revocation checkpoint — 6 October 2026

The native disconnect path previously erased protected tokens and revoked Orbyn
metadata without attempting to end the renewable OpenAI session. It now calls
OpenAI's published revocation endpoint directly from the credential-owning
native device with the exact issued client ID and latest rotating refresh token.
No access/refresh token is sent to Orbyn. The shared transport accepts the empty
HTTP 200 success response, rejects redirects/other statuses, bounds requests to
five seconds by default, and retries network/5xx failures at most three times
with bounded backoff. Cancellation and late/uncooperative fetches are fenced.

Native disconnect stops executors and joins pending OAuth/refresh first. It
attempts provider revocation before erasing the unchanged owned protected
record, then still removes local credentials and attempts key/server removal
when provider revocation fails. Sanitized warnings identify unconfirmed OpenAI
revocation, Orbyn metadata removal and signing-key removal independently. An
OpenAI failure directs the user to ChatGPT Settings → Usage. Desktop already has
its own provider revocation path; this checkpoint fixes the native gap.

Evidence: `/tmp/orbyn-native-revocation-focused.log` has 50 passed, zero failures
or skips, terminal zero, 4547.22475 ms. The complete ChatGPT unit rerun has 315
passed, zero failures/skips, terminal zero, 20750.7235 ms at
`/tmp/orbyn-native-revocation-all-retry.log`. The first cohort attempt exited 7
without a terminal TAP summary and is not counted as passing. API-client build
and backend/desktop/mobile typechecks all exit zero in
`/tmp/orbyn-native-revocation-types.log`.

Full DB70 regression was run against frozen source `6f04e8c7` before this fix.
It ended exit 1: 3351 passed, 49 failed, zero skips, 713288.637375 ms in
`/tmp/orbyn-chatgpt-native-full70.log`. Failures began with PostgreSQL connection
termination, followed by ECONNREFUSED after the Docker daemon became unreachable.
This is failed qualification, not a passing full regression. Disk fell below
250 MiB; only the simulator booted for this turn was shut down. Docker was not
restarted or modified. A fresh full run remains required after disk/database
recovery. The earlier run's terminal state is saved in
`/tmp/orbyn-chatgpt-native70-handoff.json`.

Official source: [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
with the revocation endpoint checked against OpenAI's public OIDC discovery.
The token reference describes opaque authentication metadata, not a documented
subscription-tier or remaining-allowance field. Do not infer a paid tier or
quota from model visibility or granted scopes.

This is a candidate checkpoint. Installed iOS/Android OAuth, keystore, browser
lifecycle and live provider acceptance remain unverified. Browser-only hosted
ChatGPT connection remains unresolved. Main promotion, multiple-account
management, truthful plan/usage acceptance and all C1–C6/M1/D1/U1 scope remain
open; no ADR completion or production deployment is claimed.

### Native saved-account controls and ownership checkpoint — 6 October 2026

Native Settings previously hid Disconnect when the foreground executor was idle,
including after a refresh reduced plan-use permissions. Saved credentials and
executor eligibility now have separate representations. A native-only presence
read verifies the captured Orbyn session/owner, reads the exact protected account
record, and returns only missing/unsupported/unreadable/saved status plus the
plan-use permission flag. It returns no tokens, identity proof or subject. A
corrupt record remains removable without trusting its claimed identity.

Settings keeps Disconnect available for saved or unreadable records even while
the executor is idle. Permission-off state directs users to ChatGPT Settings
before reauthorization. Builds without the callback module disable Connect with
an update explanation. Actions serialize through their live controller, reject
retained callbacks after user/token replacement, scope errors to the originating
owner/session, and do not restart or refresh a replacement account when a late
disconnect finishes. Failed disconnect still reloads local presence and remote
metadata for the same owner, preserving the unconfirmed-revocation warning.

Qualification: all323 ChatGPT unit tests pass, zero failures/skips, terminal
zero, 22326.398875 ms in `/tmp/orbyn-native-account-state-all-final.log`. The
initial focused source run had61 passed/0fail/skip,4421.285166ms; the final cohort
adds in-flight presence/session replacement coverage. Mobile/backend/desktop
typechecks all exit zero in `/tmp/orbyn-native-account-state-types-final.log`.
The redundant old abort call was removed after the new serialization guard made
it unreachable; final tests/typechecks include that correction.

Existing Expo autolinking commands resolve OrbynChatgptModule for apple and
expo.modules.orbynchatgpt.OrbynChatgptModule for android, terminal zero. Evidence
is `/tmp/orbyn-native-autolink-apple.json` and
`/tmp/orbyn-native-autolink-android.json`. This is packaging discovery, not a
native build/install, OS keystore/OAuth acceptance or visual screenshot proof.

Disk recovered to4.7GiB during the turn. Docker engine is running, but the isolated
orbyn-embedding-test-20261001 container is stopped; the user was asked to start it
under their earlier Docker-recovery preference. Full regression remains failed
atDB70 and requires a fresh database run. No production/main promotion is claimed.
Multiple saved native accounts/workspaces, installed device and browser-only
connection acceptance, truthful account allowance UI and the full C1–C6/M1/D1/U1
scope remain open.

### Actual iOS native module build evidence — 6 October 2026

At application source checkpoint a786cd93, existing Expo prebuild completed for
ios with --no-install and preserved react/react-native dependency versions;
package.json was unchanged. CocoaPods resolved the app's existing native graph,
including OrbynChatgpt1.0.0. Expo adjusted its effective minimum iOS deployment
target to16.4, matching ExpoModulesCore. Native OrbynChatgpt compiled successfully
against the real Expo/iOS dependencies: xcodebuild target build exit0 and
BUILD SUCCEEDED in `/tmp/orbyn-chatgpt-native-module-build.log`.
This supersedes fixture-only compilation for module build acceptance, but proves
neither installed OS keychain/OAuth behavior nor Android native compilation.

Full Orbyn app scheme remains unqualified: the initial destination/architecture
argument combination was rejected, and the corrected invocation exited70
because its embedded Watch companion requires the missing watchOS26.5 runtime.
Evidence: `/tmp/orbyn-chatgpt-native-app-build.log`. No runtime was downloaded.
A separate temporary OrbynPhoneQA project/workspace was generated only under the
ignored mobile/ios directory, excluding Watch dependency/embedding for phone UI
verification. Production config/project source was not changed. Its unsigned build subsequently passed (exit0), followed by a simulator
ad-hoc signed build (exit0). Logs: `/tmp/orbyn-chatgpt-native-phone-qa-build.log`
and `/tmp/orbyn-chatgpt-native-phone-qa-signed-build.log`. These phone QA results
do not qualify the full release scheme. Specific live state and next actions are saved
in `/tmp/orbyn-native-build-handoff.json`.

Prebuild generated local watch/widget Assets.xcassets and Info.plist files;
these are unstaged build artifacts, not character source changes. Root user and
character changes remain untouched. Full DB70 regression is still failed;
Docker engine is back but the isolated test container remains stopped. Read-only
inspection of the shared local PostgreSQL restart loop reports an empty
postmaster.pid lock file; it was not modified under the user's Docker-recovery
preference. Native installed UI/screenshots/live provider, full scheme and fresh
database acceptance remain open.

### Installed signed iOS startup evidence — 6 October 2026

The temporary phone QA app at source a786cd93 was installed and opened on the
existing iOS18.5 narrow simulator. The unsigned build initially showed Expo
Notifications KEYCHAIN_ACCESS and Orbyn's session-restore error. Rebuilding with
simulator ad-hoc signing and reinstalling removed both visible startup errors.
The generated simulated entitlement contains the app identifier; no production
team/signing configuration was changed. This is startup acceptance only, not
proof of protected token persistence, native signing, OAuth callback, provider
inference or physical-device acceptance.

Computer Use opened the installed app, captured signup, then opened and captured
sign-in without entering credentials, accepting terms or invoking OpenAI.
Screenshots are retained under `docs/reviews/evidence/chatgpt-native-startup/`.
The narrow sign-in screen shows its fields, primary action, recovery and legal
links without an observed overlapping product control in this state. Signup
requires scrolling; large-text/keyboard and authenticated Settings remain open.
Native Metro8083 is serving the development build against local API127.0.0.1:8008.
It is not a web-preview bypass.

Fresh fetch confirms origin/main still29b74ecd. Docker's isolated test database
container remains Exited255; full DB70 remains failed, and fresh full regression
is pending. Current disk is about1.1GiB free. No new main promotion, live OAuth,
account allowance, Android runtime or full ADR completion is claimed.

### Confirmed invalid-refresh recovery — 6 October 2026

The shared local token transport now distinguishes confirmed refresh failures
(invalid_grant, invalid_refresh_token, token_expired, refresh_token_expired,
refresh_token_invalidated and refresh_token_reused on400/401) from server,
network, rate-limit and invalid-client failures. Authorization-code errors do
not invalidate previously saved credentials. Provider detail/token values are
not exposed through errors.

Native renewal removes access, refresh and ID tokens only after a confirmed
terminal refresh failure and an exact session/record ownership check. A protected
version2 record retains only the verified connection/client mapping and revision;
reconnect reuses that issued client without an erased ID-token hint. Existing
executors close before more work; retired records cannot supply models/inference.
Disconnect can still remove the owned server metadata. Settings displays an
ended-session recovery state and keeps Connect/Disconnect available, refreshing
local presence when foreground runtime state changes. Temporary failures retain
the previous protected record; stale session/replacement writes are fenced.

Evidence: `/tmp/orbyn-invalid-refresh-focused-final.log`75passed/0failed,
3316.155916ms, exit0; final all-ChatGPT suite
`/tmp/orbyn-invalid-refresh-all-final.log`336passed/0failed/0skipped,
5881.278917ms, exit0. API-client build plus mobile/backend/desktop typechecks,
Prettier and diff checks pass. Native source/runtime harness and rendered
Settings tests cover token removal, mapping reuse, executor stop, server cleanup,
replacement/session fencing, temporary preservation and visible recovery controls.
This is candidate implementation acceptance, not live OpenAI or installed-device
OAuth/recovery acceptance. Full database regression remains pending.

Disk fell to573MiB free during qualification. With no xcodebuild process running,
only this task's completed728MiB temporary iOS Intermediates directory was removed.
The installed app, built products, simulated entitlement copy, screenshots and
logs remain; production/native source and shared Docker data were not changed.

### Native disconnected registration retention — 6 October 2026

Native Disconnect now retains a separate protected, token-free mapping keyed by
the exact API base URL and Orbyn user while erasing the active credential record.
Only the verified issuer/subject/issued client/connection and a fresh revision
are retained; access, refresh and ID tokens are excluded. The stable host remains
on this device. A later Connect reuses the issued client and verifies the same
account through a new session-owned challenge; no erased ID-token hint is sent.
A competing mapping change during authorization rejects installation.
Disconnected mappings do not report an active local provider, supply a model
catalog or authorize inference. Corrupt credentials do not create guessed remote
mappings. Mapping-save failure still erases credentials/revokes owned server
metadata and returns a sanitized warning that new registration may be needed.

Evidence: `/tmp/orbyn-registration-retention-all.log`340passed/0failed/0skipped,
7102.076334ms, terminal exit0. Mobile/backend typechecks and Prettier/diff checks
pass. Focused source/runtime tests verify issued-client reuse, token-free mapping,
foreign-owner isolation, concurrent mapping rejection and save-failure cleanup.
Installed/live provider acceptance, multi-account selection and full database
qualification remain open. No production/main promotion is claimed.

### Desktop confirmed terminal-refresh recovery — 6 October 2026

Desktop token renewal now recognizes the same documented terminal grant errors
as native on400/401, including structured error.code replies. Server/rate-limit
and invalid-client errors do not erase credentials. The encrypted singleton
vault gained revokeObserved: removal requires the observed credential revision,
unchanged vault epoch and a live cancellation signal after the keychain read.
A newer reconnect survives an old refresh failure; ordinary explicit revoke
keeps its existing unconditional removal semantics.

The credential resolver clears only the confirmed unusable observed record,
then notifies the selected model/manager lifetime. The manager drops its plan
grant cache/catalog, stops executor/model/signer/timers and leaves the verified
registration visible for reconnect. Other selections/owners are fenced. No
credential or provider error body crosses IPC. Existing reconnect reuses the
issued registration and restores its catalog/defaults after new verification.

Evidence: `/tmp/orbyn-desktop-terminal-refresh-all-final2.log`348passed/0failed/
0skipped,5534.425542ms, exit0. Backend/desktop typechecks, all five modified CJS
syntax checks, Prettier and diff checks pass. Tests include real encrypted-vault
conditional erase/newer-revision preservation, cancellation during keychain read,
terminal-vs-temporary OAuth replies, resolver ownership and composed manager
executor stop/retained registration/reconnect. The initial focused test's wrong
expected vault error-code assertion was repaired; only terminal successful runs
are acceptance evidence. Installed OS/OpenAI acceptance and fresh full database
qualification remain open. No main/production promotion is claimed.

### Desktop independent disconnect cleanup — 6 October 2026

Desktop Disconnect no longer requires successful credential decryption before
unconditional local erasure. Locked/corrupt keychain reads leave OpenAI revocation
unconfirmed but do not stop local cleanup. Credential removal, signing-key removal,
owned server disconnect and selection clearing are attempted independently, with
context checks between awaits. Cleanup retains the verified registration mapping
for later reconnect and drops the in-memory plan grant.

The strict shared disconnect contract now optionally returns a bounded enum-only
cleanup_failures list (credentials/signing_key/server/selection), preserving older
responses without this field. No raw storage/server/provider errors are returned.
The shared desktop store builds a notice from those codes; failed credential erasure
never produces a credentials-removed/disconnected claim. Remaining cleanup and
unconfirmed OpenAI revocation have explicit retry/ChatGPT Settings guidance.

Evidence: `/tmp/orbyn-desktop-disconnect-all.log`353passed/0failed/0skipped,
9138.619083ms, terminal exit0. Packages build and backend/desktop/mobile typechecks,
CJS syntax, Prettier and diff checks pass. Focused manager/store tests:27passed,
0failed,1889.039791ms before the final extra credential-erasure test. Real encrypted
storage tests cover locked keychain cleanup and filesystem signing-key/credential
erasure failures; fake owned server failure proves other cleanup still runs.
Store tests prove truthful notices and older-contract compatibility. No installed
OS/live OpenAI or fresh full database acceptance is claimed; candidate only.

### Native account directory foundation — 6 October 2026

`mobile/src/lib/chatgpt-account-directory.ts` implements the metadata directory
needed for separate saved native registrations. It binds every record to the exact
configured API URL and Orbyn UUID, uses a hashed storage namespace, requires a new
revision and atomic protected-store compare-and-swap, and fences owner changes
before/after awaits. Connected/disconnected/reconnect status, explicit selected
connection, duplicate registration/identity rejection, fresh-revision enforcement,
bounded100-account/262KiB records and sanitized persistence failures are tested.
Snapshots are detached copies. No token, grant, scope or model authority lives in
this directory; account metadata cannot authorize inference. Configured HTTP(S)
API namespaces are accepted without credentials/query/hash; API transport policy
remains the client's responsibility, including local native development.

This is a foundation checkpoint, not shipped multi-account selection. The module
is not wired to native SecureStore or Settings yet. Required continuation:

1. Implement the protected owner queue/CAS adapter and per-registration credential
   slots; migrate the existing active record without losing tokens/host/client IDs.
2. Separate Add account from reconnect. Verify a new grant before preserving the
   previous slot and committing its selected directory revision.
3. Switch only after checking the exact current Orbyn session, selected slot, live
   verified server identity and fresh grant. Stop the previous executor and fence
   old callbacks/refreshes before activation. Never choose a first account silently.
4. Integrate disconnect/terminal-refresh cleanup for the exact slot and directory
   status, preserving other accounts and registration mappings; report incomplete
   erasure. Directory status must never replace credential verification.
5. Add native account selection UI and account-specific catalog/default controls.
   Preserve immutable queued-job provider snapshots and explicit managed fallback;
   an account switch must not retarget existing work.
6. Qualify actual iOS/Android protected storage, OAuth/browser lifecycle, switching,
   persistence/recovery, narrow/large-text UI and default/provider provenance.

Evidence: `/tmp/orbyn-native-directory-all-final2.log`364passed/0failed/0skipped,
5854.532208ms, exit0. Eleven source-module tests cover directory isolation,
selection races, retirement/reconnect metadata, duplicate/substituted bindings,
foreign-owner hash collision, malformed/credential-bearing records, bounded
records, digest/CAS faults and reused revisions. Mobile/backend typechecks and
Prettier/diff checks pass. These use controlled storage adapters and prove no
installed protected-store behavior. Full database and main qualification remain
pending; other C1-C6/M1/D1/U1 requirements are unchanged.

### Native protected account storage adapter — 6 October 2026

`mobile/src/lib/chatgpt-protected-store.ts` adds device-only protected storage
namespaced to the exact API URL and Orbyn user. Reads and compare-and-swap writes
share a per-key queue across adapter instances in this JavaScript runtime. Keys
are restricted to that owner's directory or a UUID registration slot. Native
errors and invalid owner inputs are sanitized; values are bounded by actual
UTF-8 bytes. Exact captured-session checks fence every awaited operation.

A late session change rolls back only the value written by that operation while
holding the queue; an external replacement survives. A native write that commits
before rejecting is also conditionally rolled back. Failed rollback reports
uncertain storage rather than success. This is not a cross-process lock or an
installed-keystore proof, and it is not wired into the native picker yet.

Evidence: 13 actual-source adapter tests pass, zero failures/skips, terminal0,
736.704542ms at `/tmp/orbyn-protected-store-focused-final.log`. Mobile and backend
typechecks pass. Full ChatGPT unit cohort evidence is recorded in the tracker.
Next: per-registration credential migration, explicit Add/reconnect/switch,
executor and refresh fencing, exact-slot retirement and native account UI.
Existing protected singleton credentials remain untouched by this checkpoint.
Full database, installed OAuth/storage/inference and main qualification stay open.

Final adapter checkpoint cohort: `/tmp/orbyn-protected-store-all-final.log`,
377passed/0failed/0skipped,27124.4235ms, exit0. Formatting/diff checks pass.
Read-only merge-tree with fetched main29b74ecd reports no conflicts; this does
not replace the remaining qualification gates.

### Resumable native singleton migration — 6 October 2026

The protected adapter now exposes the exact legacy owner key under its shared
queue. A one-time directory import records the existing connected selection or
an unselected reconnect mapping atomically. `chatgpt-account-migration.ts` parses
the protected record/grant/client binding, preserves tokens and registration,
and stores the existing native signing alias in the new registration slot.
It refuses an unrelated populated directory or a conflicting slot. Original
credentials are removed only after matching directory publication; exact CAS
preserves a competing singleton write. Interrupted publication/erasure can resume
with the same staged slot and directory. Late session changes are fenced.

This migration API is **not activated** in local-sign-in or Settings. Caller must
first stop executors and serialize sign-in/refresh/disconnect. New slot records
carry signingAlias; integration must teach runtime decoding, refresh, retirement
and disconnect to retain/use it before enabling migration. Pending cleanup must
block activation, and an unexpected legacy/slot conflict must remain fail-closed.
A process stop can leave both the old record and its staged protected slot until
cleanup resumes; do not claim credential erasure or allow a separate runtime then.
No new account/first-account auto-selection is introduced.

Evidence: `/tmp/orbyn-account-migration-focused.log`9passed/0failed/0skipped,
1075.01575ms, exit0. `/tmp/orbyn-account-migration-all.log`386passed/0failed/
0skipped,25715.282458ms, exit0. Actual source modules are composed with controlled
protected storage, including interruption at directory publication/legacy erase,
retired mapping, unrelated directory, conflicting/newer credentials, malformed
record and session replacement. Mobile/backend typechecks pass. These are not
OS protected-store, real OAuth or runtime account-picker acceptance. Full main/
database/platform gates and the full ADR scope remain open.

### Native slot runtime integration — 6 October 2026

Protected migration is now callable through the native sign-in service under an
exclusive migration lifetime: fresh Orbyn identity check, exact session/cancellation
fencing, executor stop and serialized sign-in/refresh/disconnect exclusion. Settings
Connect suspends the foreground runtime, migrates a prior singleton before OAuth,
passes its cancellation signal to sign-in, then migrates a newly created singleton
before restarting the executor. Session replacement cannot start old-owner OAuth
or restart an old-owner runtime. This supersedes the previous not-activated note
for this explicit Connect path; it is not a complete account picker.

The service resolves a populated directory's exact selected registration slot,
blocks execution while legacy cleanup is unfinished, and never selects a first
connected account implicitly. A sole unavailable mapping remains addressable for
reconnect/cleanup. Migrated records retain the existing signingAlias through
verified refresh, terminal retirement, disconnect mapping and reconnect. Executor
liveness rejects signing-alias or directory selection replacement; model results
are checked against the selected slot before/after transport. Exact slot cleanup
updates directory status and reports incomplete status writes. Repeated disconnected
cleanup uses the token-free mapping's exact signing alias. Publication ownership
failure rolls back only this attempt's new credentials.

Actual service tests compose the real protected adapter/directory/migration with
controlled native storage: migration to model loading/signing/disconnect/reconnect,
retired migration, migrated terminal-refresh directory status, unfinished cleanup
execution rejection, wrong-owner/cancelled preparation, repeat exact key cleanup,
invalid/replaced signing aliases and session replacement during publication. Actual
Settings component tests cover the preparation order, cancellation signal, migration
failure preventing OAuth and replacement-session fencing. Native service focused
cohort:68passed/0failed/0skipped,4791.332417ms, exit0 at
`/tmp/orbyn-native-slot-final-focused.log`. Earlier combined service/UI cohort85passed,
zero failures/skips,4588.117958ms at `/tmp/orbyn-native-slot-integration-focused.log`.
Final full ChatGPT/typecheck results are recorded in the tracker.

Remaining: explicit Add account vs reconnect, per-registration selection/switching
and fresh-grant/live-identity gates, directory/picker UI, account-bound catalogs and
defaults, multiple-account cleanup/recovery and actual iOS/Android protected-store/
OAuth/lifecycle/screenshots. Immutable queued provider snapshots remain unchanged;
no managed fallback is enabled implicitly. Main/full DB/platform qualification and
all other C1-C6/M1/D1/U1 requirements stay open.

Final slot integration evidence: `/tmp/orbyn-native-slot-integration-all-final.log`
400passed/0failed/0skipped,27014.848583ms, terminal0. Mobile/backend typechecks,
Prettier and diff checks pass. These do not prove real protected-store/OAuth or
full database acceptance. No main promotion or completed multi-account UI claimed.

### Native saved-account switch and picker — 6 October 2026

The native service now exposes owner-verified directory metadata and explicit
selection by connection UUID plus the displayed directory revision. Switching
uses one exclusive cancellable lifetime, stops the prior executor, refuses
unfinished singleton cleanup, validates slot/metadata identity and the live owned
server registration, refreshes an expiring grant under the same parent lifetime,
and requires ChatGPT plan-use permission before CAS selection. Confirmed invalid
refresh retires the target; temporary failures preserve selection/credentials.
Old provider snapshots are not changed and no managed fallback is enabled.

Settings displays a bounded local saved-account list with clear current/reconnect
states, captured revision selection, click serialization, cancellation, errors and
preserved-runtime restart. Its caption explicitly says Accounts on this device;
this does not change the workspace provider preference. Row spacing accounts for
existing control hit slop. Unavailable entries are disabled, not guessed active.
The normal model/default controls remain separately bound to their chosen remote
executor/catalog; full cross-account default acceptance is still required.

Focused actual-source service/component cohort passes95tests/0failed/0skipped,
5179.718583ms at `/tmp/orbyn-native-picker-focused-final.log`. Service tests include
multiple protected fixture slots, previous-slot preservation, live server rows with
verified_at metadata, wrong/stale identity/revision/missing grants, expiring refresh,
terminal retirement, cancelled parent lifetime and plan-use-off target/prior executor
stop. Component tests cover captured selection revision, unavailable entries,
repeated clicks, cancellation state, old-owner completion and owned error recovery.
The first switch test run failed only on an incorrect expected cancellation message;
it now asserts the actual cancellation branch. Terminal final cohort is acceptance.

Computer Use inspected the actual Simulator, still signed out at Sign in; startup
observation/screenshot saved under `/tmp/orbyn-native-picker-evidence/`. Authenticated
picker narrow/large-text/keyboard screenshots are NOT established. No real grant or
credential entry/consent occurred. Android remains unverified. Add another account
and reconnect a specifically chosen unavailable account are not implemented yet;
multiple-account fixtures do not prove those provisioning paths. Next complete those
paths, then qualify model/default provenance, real OS/OAuth and full database/main
acceptance. All other C1-C6/M1/D1/U1 work remains in scope.

Final picker checkpoint: `/tmp/orbyn-native-picker-all-final2.log`,409passed/
0failed/0skipped,26543.954292ms, exit0. Mobile/backend typechecks, Prettier and
diff checks pass. Native UI visual acceptance remains pending; no main promotion.

### Native Add account and targeted reconnect — 6 October 2026

The service now accepts strictly parsed/copied Add or Reconnect actions with the
picker's expected revision. Add uses dynamic registration without an old client
or ID-token hint, rejects an existing slot/registration, saves a distinct protected
slot with a per-registration signing alias and atomically publishes that account
and its explicit selection. Existing credentials remain unchanged. Targeted
Reconnect resolves exactly the requested protected active/retired mapping, verifies
it against directory identity before OAuth and reuses its issued client and signing
alias. A new verified grant must match the expected account. No plan permission,
stale revision, missing/substituted mapping or conflicting publication can silently
replace another account. Failed publication conditionally removes/restores only the
attempted credential record. Caller action mutation cannot change the copied revision.

Settings wires Add and targeted Reconnect separately from selection. The list stays
readable/selectable with no active account after disconnect; it does not implicitly
choose the first remaining profile. Disconnecting one of multiple accounts preserves
other slots and uses only the active account's provider token/key/server ID. The
redundant primary Connect control is hidden for an unselected populated directory;
its rows and Add action remain. Connected selection is local to this device; managed
provider preference and immutable queued-job snapshots are not changed.

Focused actual-source service/UI cohort103passed/0failed/0skipped,5603.173ms,
exit0 at `/tmp/orbyn-native-add-focused-final.log`; final service cohort82passed,
zero failures/skips,5453.417625ms at `/tmp/orbyn-native-add-service-final.log` includes
caller mutation protection. Tests compose verified-grant fixtures with real native
service/directory/adapter code: distinct clients, prior-slot preservation, targeted
retired account behind another active selection, stale/duplicate/mismatched paths,
multi-account disconnect, publication conflict rollback and denied plan use. No
real OpenAI token or OS credential operation is established by controlled fixtures.

Disk recovered to2.4GiB and Docker CLI is now responsive. The isolated test container
orbyn-embedding-test-20261001 is still Exited255, observed read-only; user recovery
control is preserved. Fresh full regression remains pending. Next audit remaining
multi-account persistence/recovery, exact cleanup under failure, catalog/default/
provider provenance, real iOS/Android OAuth/keystore and narrow/large-text screenshots.
Hosted browser-only connection, truthful tier/allowance availability and all other
C1-C6/M1/D1/U1 acceptance remain open. No main or production promotion is claimed.

Final Add/reconnect checkpoint: `/tmp/orbyn-native-add-all-final2.log`,418passed/
0failed/0skipped,28937.061916ms, exit0. Mobile/backend typechecks, Prettier and
diff checks pass. Real OAuth/OS/UI and full regression/main qualification remain open.

### Native independent disconnect retry — 6 October 2026

Recovery audit found that native Disconnect returned early after credentials were
already erased, skipping a retry of failed server cleanup. It now uses the retained
protected registration mapping for repeated exact signing-key/server/directory
cleanup. Each cleanup proceeds independently after ownership checks. Credential
removal failure still attempts key/server cleanup, marks the account unavailable,
and returns disconnect incomplete rather than credentials removed. Retained active
credentials behind an unavailable directory entry produce unreadable Settings
presence, not a healthy saved-account claim.

Token-free reconnect mappings retain OpenAI revocation confirmation and the exact
credential revision. Failed/unknown confirmation remains guidance on retry after
tokens are gone; a later reconnect revision cannot inherit an older confirmation.
A missing refresh token never invents a revocation receipt. Retired grants still
permit local/owned server cleanup without retrying unusable tokens, while showing
unconfirmed OpenAI cleanup guidance. A slot mapping with another connection UUID
cannot be used for that slot's cleanup. No token is added to directory/IPC/logs.

Focused actual-source service cohort88passed/0failed/0skipped,6835.537417ms,
exit0 at `/tmp/orbyn-native-cleanup-focused-final.log`. Tests cover server retry after
erasure, key failure while server cleanup runs, credential erase failure with honest
notice and retry, provider5xx bounded retries with persistent guidance, missing
refresh tokens and confirmation invalidation after reconnect. Existing repeat-cleanup
assertion now checks both exact server ID calls, and retired-grant test expects the
truthful warning. Initial new provider-retry assertion was corrected to the helper's
existing three bounded attempts; final terminal runs are evidence.

Remaining native recovery work: targeted cleanup for an unavailable account while
another/no account is active, mapping/read fault handling, persistence/restart and
real keystore/OAuth acceptance, catalog/default/provider provenance and screenshots.
The full isolated database rerun and main qualification remain pending. Other ADR
scope is unchanged; this is a candidate checkpoint, not production completion.

Final cleanup retry cohort: `/tmp/orbyn-native-cleanup-all-final2.log`,424passed/
0failed/0skipped,29041.735958ms, exit0. Mobile typecheck initially found nullable
mapping access; optional access fixed it and final mobile/backend types pass.
Prettier/diff checks pass. Installed/DB/main qualification remains open.

### Native targeted cleanup — 6 October 2026

Disconnect accepts a strictly copied connection UUID and displayed directory
revision. After fresh owner verification it resolves only that protected slot,
rejects incomplete migration/stale menus/unknown entries and checks active or
retired identity against the displayed registration before erasure. Inactive
cleanup preserves another active account's credentials and selected directory ID.
A matching token-free mapping can recover cleanup of a corrupt record; unknown
identity never authorizes a guessed server connection. Confirmation from an old
mapping is not accepted for an unreadable nonempty credential record.

Settings exposes cleanup/retry through each account's MoreMenu. Rows reserve gap16
and vertical padding8 for the existing control hit areas; rare cleanup adds no
permanent button row. The same owner/action lifetime and runtime recovery apply.
Service/component cohort113passed/0failed/0skipped,6751.285084ms, exit0 at
`/tmp/orbyn-native-target-cleanup-focused.log`. Full ChatGPT cohort427passed,
zero failures/skips,31658.248708ms, exit0 at
`/tmp/orbyn-native-target-cleanup-all.log`. Mobile/backend types and formatting/diff
checks pass. Baseline UI failures were the test harness's missing MoreMenu mock;
the final actual Settings action contract is exercised through its props.

Tests prove inactive-account cleanup and retry preserve active credentials/selection,
stale revision and substituted retired identity reject before erase, and menu
identity/revision reach the service. Real iOS/Android protected-store, authenticated
menu layout/large-text/screenshots and OAuth remain pending. Next finish read-fault
handling and catalog/default/provider provenance; full DB and main promotion gates
remain open. Other C1-C6/M1/D1/U1 requirements are unchanged.

### Native protected read-fault recovery — 6 October 2026

Service direct SecureStore calls now use fixed sanitized read/write/erase errors
without the native cause. This includes host identity, retained registration,
refresh, credential reads and cleanup paths. Native adapter failures were already
sanitized. Settings credential read failure returns unreadable after checking the
captured owner/session, not missing. Execution/reconnect/cleanup cannot treat an
unreadable credential or mapping as null, guess another identity, or claim removal.
Explicit cleanup remains retryable once storage can be read; a destructive erase
without observing the owned record would bypass the existing identity/revision
checks, so it is not attempted on a read fault.

Actual-source tests inject credential and retained-mapping read failures containing
private diagnostic markers. They assert no raw Error.cause/stack disclosure,
no inference/revocation/key erasure or credential loss, truthful unreadable status,
and successful recovery after read permission returns. Focused final92passed,
0failed/0skipped,6538.646333ms exit0 at
`/tmp/orbyn-native-read-fault-focused-final.log`. Full ChatGPT final429passed,
0failed/0skipped,26675.095583ms exit0 at
`/tmp/orbyn-native-read-fault-all-final.log`. Mobile typecheck exit0 at
`/tmp/orbyn-native-read-fault-mobile-types.log`. Formatting and diff checks pass.
The initial focused test compared VM-realm objects; corrected to assert the exact
status scalar. Final checks use the corrected harness.

Read-only Docker check still shows orbyn-embedding-test-20261001 exited255;
disk1.7GiB. Docker remains under user recovery control. No main merge, real OAuth,
paid inference or authenticated native/web UI acceptance is claimed. Next audit
model/catalog/default/provider identity across explicit device-account switching.
Full C1-C6/M1/D1/U1 scope, native OS acceptance, full DB71 and main qualification
remain open; root character/user changes and other worktrees remain preserved.

### Native portable cancellation checkpoint — 6 October 2026

Model/default/provider audit found a concrete runtime gap: shared executor
lifecycle and plan provider transport/SSE reader, plus native provider wrapper,
still invoked AbortSignal.throwIfAborted directly. React Native abort-controller
has no such method. Existing remote model controller already used the portable
helper; this patch applies it across actual native inference paths and exports
that helper through api-client for the app dependency boundary.

Actual native factory test switches global and VM AbortController to the installed
React Native implementation. Baseline reproduced TypeError at lifecycle live57:
`/tmp/orbyn-native-abort-baseline.log`, exit1. Final targeted test completes signed
mocked inference with measured usage, then proves pre-cancelled work publishes/
sends no additional provider request. It restores the global controller in finally.
`/tmp/orbyn-native-abort-focused.log`:1passed/0failed/0skipped,1074.636083ms,exit0.
Full ChatGPT cohort430passed/0failed/0skipped,28700.67175ms,exit0 at
`/tmp/orbyn-native-abort-all.log`. Package build exit0:
`/tmp/orbyn-native-abort-package-build.log`; mobile/desktop typechecks exit0:
`/tmp/orbyn-native-abort-mobile-types.log`,
`/tmp/orbyn-native-abort-desktop-types.log`. Formatting/diff checks pass.
No new dependency or provider call. Installed iOS/Android and real OAuth remain
pending. These lifecycle/native service files do not yet exist on main, so the
checkpoint depends on the broader candidate qualification; no main promotion.
Continue model/default/provider audit, then full database/installed acceptance.
Full ADR scope and preserved root/character/other worktrees remain unchanged.

### Provider session/duplicate-write checkpoint promoted to main — 6 October 2026

Actual-source provider UI tests reproduced on desktop and mobile: same-user token
rotation did not rerun the provider effect, leaving controls unavailable, and
repeated actions before rerender sent two CAS writes. Effect now depends on the
rendered token; a ref holds a single write per owner/lifetime. Effect resets the
lock after aborting prior ownership; old finally only clears its exact controller.
Fallback still mutates the saved provider, not the merely inspected device.

Baseline `/tmp/orbyn-provider-session-baseline.log`:4existing passed,4new failed.
Focused final `/tmp/orbyn-provider-session-focused.log`:8passed,0failed/0skipped,
797.624209ms,exit0. Full candidate `/tmp/orbyn-provider-session-all.log`:
434passed/0failed/0skipped,27480.8195ms,exit0. Candidate mobile/desktop types pass
at `/tmp/orbyn-provider-session-{mobile,desktop}-types.log`.
Three affected files matched main before the patch. Candidate code commitb06bc884
was cherry-picked as main7c693b48, pushed, and origin/main merged into candidate
without conflicts. Root character/mobile/app.json and all other preexisting dirt
remain preserved. No broad native OAuth promotion or production deploy occurred.

Main focused8passed/0failed/0skipped,767.644292ms exit0:
`/tmp/orbyn-provider-main-focused-final.log`. Initial root esbuild binary targeted
another OS; final test used ESBUILD_BINARY_PATH pointing to the existing candidate
Darwin binary, without installing/mutating dependencies. Root shared-package build
repaired stale generated exports: `/tmp/orbyn-provider-main-packages.log`,exit0.
Desktop types final `/tmp/orbyn-provider-main-desktop-types-final.log`,exit0.
Normal main mobile types still fail because declared react-native-webview13.16.1
is missing locally. A /tmp-only tsconfig maps precisely that module to the existing
candidate13.16.1 declarations; main mobile sources then typecheck exit0 at
`/tmp/orbyn-provider-main-mobile-types-mapped.log`. This is type evidence, not
restored native installation, rendered UI or general DB/runtime qualification.

Continue remaining account/catalog/default provenance and installed acceptance;
full database, native candidate promotion and original C1-C6/M1/D1/U1 scope open.

### Exact provider-save receipt and invalidated-version fence — 6 October 2026

Both provider controls previously accepted any structurally valid save reply as
confirmation and retained failed/conflicting CAS versions. They now copy requested
fields before transport and require matching primary, connection, executor,
fallback plus expected_version+1. Unconfirmed/error replies clear owned choice
and preserve the per-lifetime write fence until explicit reload. This prevents
retained pre-render callbacks from reusing a failed version. A confirmed receipt
releases the fence and advances the next write's version normally. Owner/session
and saved-device fallback semantics remain unchanged.

Controlled actual-source tests cover wrong connection/executor/fallback/version/
primary and transport failure, invalidated old handlers before/after rerender,
explicit reload recovery, and valid default→ChatGPT saves using the next version.
Fixture now returns schema-accurate default replies with null account/device and
no request-only expected_version field. Baseline mismatch tests fail on both apps.
Final focused12passed/0failed/0skipped,866.820917ms exit0:
`/tmp/orbyn-provider-receipt-focused-final2.log`. Final candidate ChatGPT438passed,
0failed/0skipped,28197.421208ms,exit0:
`/tmp/orbyn-provider-receipt-all-final2.log`. Mobile/desktop types final exit0 at
`/tmp/orbyn-provider-receipt-{mobile,desktop}-types-final.log`.

Scoped code commit4943bf3e cherry-picked as mainbaf9e56c, pushed; candidate merged
origin/main without conflict. Main focused12passed/0failed/0skipped,935.970083ms,
exit0 at `/tmp/orbyn-provider-receipt-main-focused.log`; test reused existing Darwin
esbuild binary via env, no dependency installation. Main desktop types exit0 at
`/tmp/orbyn-provider-receipt-main-desktop-types.log`. Main mobile types exit0 at
`/tmp/orbyn-provider-receipt-main-mobile-types-mapped.log` using the existing /tmp
mapping to installed same-version WebView declarations; normal local package
installation remains incomplete. No deployment, UI screenshot or general runtime
qualification is claimed. Existing root character/user dirt preserved.

Next finish remaining account/catalog/default provenance and actual installed
acceptance; broader native candidate/full DB/main qualification and complete
C1-C6/M1/D1/U1 ADR scope remain open.

### Ready catalog/default required before provider selection — 6 October 2026

Backend saveAiProviderChoice requires ready live catalog, available selected model
and plan_inference_v1. UI previously passed any inspected selection to Provider
controls even during loading, saving or unavailable model/device states. This
predictably caused a rejected save and invalidated provider UI. Both remote model
surfaces now forward selection only with ready state, no model save in progress,
inference capability, and a default still in catalog. Existing saved-provider
fallback controls remain independent; browsing/switching local accounts does not
retarget workspace provider or queued snapshots. A short hint explains missing
selection without implying browser-only OAuth completion.

Actual-source tests cover ready/loading/saving/offline/stale/unavailable, absent/
removed default, missing inference capability and missing catalog on both clients.
Baseline `/tmp/orbyn-provider-readiness-baseline-final.log` reproduced loading
selection forwarded on both apps. Test fixture now declares inference capability.
Final focused37passed/0failed/0skipped,1311.527458ms,exit0:
`/tmp/orbyn-provider-readiness-focused-final.log`. Full candidate440passed,
0failed/0skipped,29169.215833ms,exit0:
`/tmp/orbyn-provider-readiness-all.log`. Both candidate client types pass at
`/tmp/orbyn-provider-readiness-{mobile,desktop}-types.log`.

Scoped code patch checked/applied cleanly to main; only readiness test additions
were transferred into its existing harness, preserving native candidate-only tests.
Test block placed beside existing catalog tests in both branches to avoid an append
collision with native candidate tests. Main checkpoint9e22e531 committed/pushed;
candidate merged main without conflict. Main focused23passed/0failed/0skipped,
1123.04275ms,exit0 at `/tmp/orbyn-provider-readiness-main-focused-final.log`.
Main desktop types exit0 `/tmp/orbyn-provider-readiness-main-desktop-types.log`;
main mobile types exit0 `/tmp/orbyn-provider-readiness-main-mobile-types-mapped.log`
using documented /tmp WebView13.16.1 mapping. Existing root character/user dirt
preserved. No production deployment, authenticated screenshot, OAuth/provider
request or native runtime qualification is claimed.

Remaining model/default/native switching acceptance, installed platform UI/runtime,
full database/native candidate main promotion and complete C1-C6/M1/D1/U1 scope
remain open. Continue runtime account-switch provenance verification next.

### Compound native account-switch provenance evidence — 6 October 2026

Actual native factory test uses two protected profile slots with distinct OAuth
access tokens, verified connection/client/subject bindings and signing aliases.
The simulated server enrolls the requested owned connection and issues distinct
executor IDs. First inference provider transport is deliberately held without
honouring abort. Switching accounts rejects the old in-flight execution; old
heartbeat/execute cannot run or send a second prompt. Original slot/key remains.
Replacement startup publishes only the target identity's catalog; inference sends
only target token, signs target account/executor receipt, and emits one completion.
Releasing the late old response cannot publish into the replacement profile.

Fixture added optional transport/token hooks and records model/response headers;
no logs contain real credentials, and all tokens/transports are test-only. Existing
94 native service tests pass,0failed/0skipped,6797.027ms,exit0 at
`/tmp/orbyn-native-switch-provenance-focused.log`. Full ChatGPT441passed,
0failed/0skipped,27263.063333ms,exit0 at
`/tmp/orbyn-native-switch-provenance-all.log`. Formatting/diff checks pass. No
runtime change or installed acceptance is claimed; test depends on native candidate
files absent from main and stays on candidate.

Server read-only audit reconfirmed assertJobAiProviderChoice compares immutable
enqueue-time choice to current authority; queueChatgptInference checks expected
model against live catalog and reuses existing operation only after binding/payload/
job hash validation. This is source evidence, not a new DB regression pass.
Latest Docker ps query remained unresponsive after repeated polls of its specific
live handle58636. Its own CLI process19538 was terminated only after confirming
command identity; session ended143. No engine/container changed. Disk1.7GiB.

Unit/runtime composition account-switch provenance is now covered. Remaining
actual OS/OAuth/UI, remote/default cross-device DB acceptance and full database/
native main promotion still open; original C1-C6/M1/D1/U1 scope remains intact.
Next review other unfinished source paths while runtime acceptance is unavailable,
starting with D1 flat writers and normal-editor ownership adoption; do not treat
that review as completion of blocked ChatGPT acceptance.

### D1 structured capture/reflection append checkpoint — 6 October 2026

Added explicit root/section append helpers. Existing quote/callout/list/checklist/
code/Mermaid owners and stable identities remain intact; only a sole empty root
paragraph is replaced. Root sections never infer destinations or boundaries from
nested headings; occupied nested reserved IDs keep their owner, and the new root
section is unnamed. Helpers validate detached trees and reject invalid/colliding
additions without mutating callers.

addToPage dispatches nested pages through saveVersionedDoc under the existing
write lock and exact revision; unsupported flat callbacks fail409. Capture page/
agenda and Home reflection provide explicit structured callbacks. Home GET and
reflection POST use readVersionedDoc under visibility/privacy projection, and
read the root-owned Reflection section. Response content comes from authorized
reread rather than raw write callbacks. Legacy flat append behavior remains.

Shared package build and backend typecheck pass.63 focused unit regressions pass,
0failed/0skipped,2864.591958ms,exit0 at
`/tmp/orbyn-doc-root-append-regression.log`; actual service/route functions execute
with mocked DB/ACL/event transports. Added two actual database regression cases
for complete-tree/history persistence and unsupported/unauthorized nonmutation to
`doc-structured-storage.test.ts`; these are NOT run while Docker remains unavailable.
No runtime database acceptance, client visual acceptance or main promotion claimed.

Still open: makeLineTasks and structure.writeLines flat writers, nested checklist
identity/task mapping, agenda regeneration flat writes, normal-editor adoption,
CRDT/collaboration and full D1 render/edit/export/privacy matrices. Other full ADR
requirements remain open. Candidate checkpoint only until database qualification.

### D1 full-tree page merge checkpoint — 6 October 2026

mergeDocContents merges complete typed documents; mixed formats promote to2,
legacy-only documents remain1. Quote/callout/list/checklist/code/Mermaid ownership
is retained. Source leaf AND container ID collisions rename deterministically;
fresh IDs cannot collide with any existing destination or later source identity.
Only blank root paragraphs are omitted; nested empty owners/blank children remain.
Inputs are detached/validated and invalid content cannot silently flatten.

mergePages keeps sorted locks, space/ACL/exact revision checks, file access,
comment/suggestion/task transfer and trash semantics. Target writes and inbound
link rewrites now use saveVersionedDoc with complete trees/current revisions.
Relinked nested pages retain their owners instead of updating only the projection.
Final target version comes from the saved page even if it was also relinked; its
notification is emitted once at that final version. Existing local fragment links
in moved content still need an ownership-aware remapping audit; do not count
full anchor/reference acceptance complete from collision IDs alone.

75 focused unit tests pass,0failed/0skipped,3764.527166ms,exit0:
`/tmp/orbyn-doc-merge-regression.log`. Includes actual mergePages function with
mock DB/ACL/transfers/saves, all mixed-format combinations, collision generation,
complete nested relink content, 403/409/422 prewrite rejection. Shared package
build/backend types/format/diff checks pass. Added actual database merge regression
for nested source/target/relink trees, renamed reference and complete history to
`doc-structured-storage.test.ts`; NOT run while Docker/database unavailable.
Candidate only; no database/client/main acceptance claimed. origin/main refreshed
and remains9e22e531. Root character/user dirt and native generated targets preserved.

Next D1 steps: nested task/checklist identity plus task-state projection and saves;
partial extraction with explicit ownership/list numbering; moved local-fragment
reference semantics; agenda regeneration; normal editor/collaboration and full
render/edit/export/privacy matrices. Remaining ChatGPT/platform, UI, agents,
plugins/channels and final qualification/cleanup scope remains active.

### D1 nested checklist task mapping checkpoint — 6 October 2026

Shared task view maps a list item's checked metadata and owning first paragraph
onto a synthetic todo view. Nested continuation paragraphs, plain items, quote/
callout/list/code owners and stable IDs remain unchanged. Existing todo leaves are
supported; returned views detach even anonymous shared caller objects into their
separate owners. Reapplying task state rejects changed count/type/existing IDs or
identity assignment to non-task paragraphs, while unnamed task paragraphs may
receive their new stable task identity. Synthetic todos never enter storage.

readVersionedDoc projects current linked task status and authorized private labels
back into checkbox owners. saveVersionedDoc restores labels, synchronizes the task
view using existing ticksFrom/done_version rules, reapplies metadata, then saves
raw paragraph leaves matching the complete tree and SQL projection guard.
makeLineTasks creates only open nonempty/unlinked selected checklists, preserves
or assigns their first-paragraph ID, and saves via the versioned writer. Both route
and service require items:write before item creation; legacy task creation keeps
its flat path under the same write authority.

All Docs unit cohort502passed,0failed/0skipped,16859.431041ms,exit0:
`/tmp/orbyn-doc-tasks-all-unit.log`. Actual service/versioned read/save functions
execute with mocked DB/ACL/item/task/privacy transports. Shared package build,
backend typecheck and formatting/diff checks pass. Two real DB cases added to
`doc-structured-storage.test.ts`: full task lifecycle with untouched owners/raw
projection and stale checklist ticks preserving externally completed task. NOT run:
read-only TCP probe of55435 currentlyECONNREFUSED. No Docker engine/container
altered. No installed UI/main/database acceptance claimed; candidate checkpoint.

Next: audit other task-consuming projections and normal-editor controls, partial
extraction with explicit owner/list numbering semantics, moved local fragments,
agenda regeneration and full Docs editor/collaboration/render/edit/export/privacy
matrices. Full ChatGPT/platform/UI/agents/plugins/channels/integration/cleanup scope
remains active. Root character/user dirt and native target artifacts preserved.

### Home goal progress main checkpoint — 6 October 2026

Home reads complete nested plan nodes for checklist counts and overlays current
linked task status on both legacy and nested plan steps. Status lookup is batched
once for visible plans with named task leaves, keyed by document+block identity.
Project task totals retain priority; unavailable/empty/prose-only plans yield null
progress. Existing plan visibility and assistant exclusions stay in the query path.
The main checkpoint contains the read path and shared pure task helper only; nested
capture/reflection/merge/task-write candidates are not promoted by this checkpoint.

Candidate707a676b committed Home fix;8 Home unit cases pass0failed/0skipped,
909.636375ms,exit0 at `/tmp/orbyn-home-task-progress-tests.log`. Main7263b45b
committed and pushed. Main10 focused tests pass0failed/0skipped,910.487709ms,
exit0 at `/tmp/orbyn-home-task-progress-main-tests.log`; tests use documented
candidate Darwin esbuild binary because root dependency binary targets another OS.
Root shared packages build/backend types/format/diff checks pass. No new dependency,
DB runtime, visual or production deployment acceptance claimed. Main9e22e531→
7263b45b fast-forward push confirmed; root character/user changes preserved.

Candidate merged origin/main as85ce3340. Import/export overlap in Home/core index
was resolved by retaining candidate's already tested superset. Staged merge diff
was empty: candidate source tree unchanged. No unresolved conflicts remain.
Continue other task projections/editor controls, partial extraction/moved fragments,
agenda regeneration and full governing C1-C6/M1/D1/U1/runtime/visual/cleanup scope.

### Owned-editor offline branch integration — 6 October 2026

Inspected all attached Git worktrees and confirmed owned-editor branch contributed
one unintegrated commit0ee17ce5. Main working candidate now includes it via6aa74747.
Resolved filename collision by renaming whole-page merge helper todoc-page-merge.ts
in15bda51a; offline three-way merge retainsdoc-content-merge.ts. Existing barrel
exports preserve both APIs. Merge conflict resolution retained both historical
handoffs and all shared exports; stale imported runtime/main references are marked
historical. No outstanding conflicts remain and no worktree was removed.

Offline cached/current/base documents retain complete ownership and matching flat
projections. Mixed legacy/complete queued protocols remain separate. Native replay
reads current owned document, merges disjoint named leaf edits when ownership is
unchanged, writes complete metadata/tree atomically with original tick baseline,
and preserves complete edits for review on ownership/title conflicts. No silent
flat fallback. Existing legacy replay remains covered. Normal editor source is
still using flat controls; getDocForEditor/updateDocForEditor calls currently appear
in native outbox only. Therefore this is recovery infrastructure, not full normal
editor activation or verified user-facing conflict recovery.

Current integration55tests passed,0failed/0skipped,3104.722167ms,exit0:
`/tmp/orbyn-owned-offline-integration-tests.log` (offline content/replay, d4c,
legacy cache, whole-page merge and task mapping). Shared packages build; desktop,
mobile and backend typechecks and owned formatting/diff checks pass. Source changes
justify rerunning this focused integration cohort; previous fullDB66 evidence is
historical and not claimed as a new combined DB pass. No new dependency, production
release or installed visual/native acceptance. Main remains7263b45b.

Next: activate complete ownership in both normal editors and their save/recovery
flows, including task controls; continue partial extraction, reference movement,
agenda generation and full C1-C6/M1/D1/U1/runtime/visual/cleanup acceptance.

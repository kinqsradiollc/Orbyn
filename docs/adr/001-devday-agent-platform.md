## Structured line-anchor checkpoint — 7 October 2026

`POST /docs/:id/anchor` now names an anonymous nested leaf in its complete tree
and writes the matching leaf projection atomically under the existing page lock.
Read-authorized viewers retain Copy link access without gaining edit authority.
Quote/list/task ownership and unrelated leaves remain unchanged; concurrent calls
return one stable ID and increment the revision once. Naming still adds no history
entry, and legacy pages remain flat. The original route reproduces a23514/500;
the new regression proves nested viewer/concurrent/idempotent/legacy behavior and
401/403/400/409/429 refusals without mutation.

Scoped main qualification: packages build and backend typecheck pass. The first
focused run hit the existing normal-read rate-limit assertion (200 vs429); two
repeat runs pass all58 structured-storage/Docs/structured tests with no failures
or skips (5789ms and5663ms). No rate-limit production behavior or assertion was
weakened. This backend-only checkpoint does not complete normal-editor activation.

The broader application candidate remains separate: its fresh full database run
has3929 passes and2 failures (Background-service request count and unclassified
ChatGPT refresh-identity route),907152ms. Neither full ADR completion nor production
deployment is claimed; the user deploys main manually.

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

## Complete-document offline recovery integrated — 6 October 2026

Working candidate6aa74747 includes owned-editor offline checkpoint0ee17ce5. Native
replay retains complete trees, current/base identity and original task-tick baseline;
conflicting ownership edits remain available for review. Whole-page concatenation
and three-way revision merging now have separate modules.55 focused integration
tests and all workspace typechecks pass; shared package build/formatting pass.
Normal editor controls, recovery UI, installed visual acceptance and combined
runtime qualification remain open. Main remains7263b45b; full ADR remains active.

## Home goal progress checkpoint on main — 6 October 2026

Main `7263b45b` is pushed. Home counts nested plan checklists and reflects current
linked task status, with one batched lookup scoped by document identity. Project
progress keeps precedence.10 relevant main tests, package build/backend types and
format checks pass;8 candidate Home cases pass. This promotes the read path and
shared pure projection. Broader Docs writes, database qualification, normal editor
adoption and full C1-C6/M1/D1/U1 acceptance remain incomplete. Production deployment
is performed by the user. Candidate main reconciliation has no unresolved conflicts.

## Nested checklist task synchronization candidate — 6 October 2026

D1 now has a separate task view for nested list-item checkbox metadata. The owning
first paragraph keeps its stable identity and stored type; task creation and
versioned read/save apply checkbox state back to that owner. Existing todo leaves
remain supported. Complete-tree persistence and history still use the guarded
versioned writer. Task creation requires page write permission before item mutation.

502 Docs unit cases pass; packages/backend types/format checks pass. Two actual
DB cases for create/duplicate prevention/completion/reopening and stale tick
protection are added but unrun: local test PostgreSQL55435 returnsECONNREFUSED.
Candidate only; no main/database/client acceptance claimed. Normal editor controls,
other task-consuming read projections, partial extraction, local-fragment movement,
agenda regeneration, full Docs/UI matrices and all C1-C6/M1/D1/U1 gates remain open.
See [current tracker](../reviews/adr-current-state.md) for current main state.

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

# ADR 001 — Orbyn agent, provider, plugin and document platform

Date: 30 September 2026. Status: **accepted architectural direction; implementation incomplete**.

### Authoritative checkpoint — 6 October 2026

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
integration remain required. See [container integration gates](../reviews/docs-container-audit.md#structured-container-candidate--6-october-2026).
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

# ADR 001 — Orbyn agent, provider, plugin and document platform

Date: 30 September 2026. Status: **accepted architectural direction; implementation incomplete**.

### Authoritative checkpoint — 6 October 2026

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
adoption remain required. See [container storage gates](../reviews/docs-container-audit.md#backend-storage-adoption-candidate).
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

| Area                 | Implemented on main                                                                                                                                                                                                                                                                                                  | Remaining acceptance or implementation                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT / M1         | One-button device authorization handoff, selected-provider routing, owned model catalog and defaults, provider provenance and explicit fallback policy                                                                                                                                                               | Successful eligible real-account inference and handoff; truthful whole-account plan/usage proof. Unsupported hard-limit catalogs stay ineligible for budgeted private scheduling. |
| Plugin / P1          | Separate backend and worker, provider-bound consent, managed/BYO inference receipts and both client controls                                                                                                                                                                                                         | External plugin host/provider and native interaction acceptance; private ChatGPT credentials and MCP remain separate.                                                             |
| Agent channels / C6  | Slack installation, canonical bot vault, rotation, delivery and signed exact-question replies. Teams reviewed account/personal-conversation linking, uninstall/relink handling, bounded Background/morning delivery, sent-card proofs and atomic exact-question reply receipts/consumption, and both client controls | Real Slack/Teams tenant and cross-client visual/native acceptance. Optional unconfigured integrations remain disabled.                                                            |
| Agents / C4–C5       | Independent Background/Overnight runtimes and identities, source ownership, reflection and maintained-page checkpoints                                                                                                                                                                                               | Audit governing collaboration, budgets, shared/public pages and publication requirements against current source; finish unresolved runtime/client acceptance.                     |
| Docs / D1            | Shared Markdown, source/preview, Mermaid and authorized export checkpoints, nested inline formatting and exact delimiter editing                                                                                                                                                                                     | Complete native editor/render/export/import matrix for all required Markdown/diagram families and interaction states.                                                             |
| Whole-app UI / U1    | Settings modal/search, responsive assistant/settings and shared client checkpoints                                                                                                                                                                                                                                   | Page-by-page web/desktop/mobile layout and interaction review, including sidebar collapse, simultaneous panels, narrow widths, large text and stale state.                        |
| Production / cleanup | Qualified checkpoints pushed; user/character files and worktrees preserved                                                                                                                                                                                                                                           | User deployment confirmation, then final relevant-worktree/branch audit and cleanup after integration.                                                                            |

Qualification: PR205 exact `d926b03c`, CI37334932950 all four jobs passed,
3130 backend passes/0 failures/1 existing skip. PR206 exact `5bc0bc9d`,
CI37335334670 all four jobs passed, 3180 backend passes/0 failures/1 existing skip.
The fresh isolated local full suite also passed 3180/0/1 in 707974ms.
The earlier reused-database full result (3171/9/1) is retained: interrupted-run
queued fixtures contaminated later global queue assertions; unchanged source
passed in a fresh marked database. No assertions or runtime limits were weakened.
Workspace types, backend/web builds, formatting and native exports passed for
the delivery candidate. Exports do not prove native interaction or appearance.
Browser5174 remains blocked; Simulator inspection returned timeout -10005.

PR207 exact `c18f405b`: CI37341791063 all four jobs passed; fresh full local
suite 3211 passes/0 failures/1 existing skip in 714527ms. The mounted replies
verify signed actor/conversation, current consent/grant/source and the exact
sent question, then atomically consume an encrypted receipt and answer.
Approvals remain in Orbyn. Cold pool-one sweep/reply coverage also passes.

Next: D1 and U1 matrices and the remaining governing agent/provider acceptance
audit. PR208 is merged: exact `4c9edf00`, all four CI37346372738 jobs passed and
fresh local full suite3383/0/1. Balanced-link PR209 exact `4c3dffb4` is merged after
all four CI37348529721 jobs passed and fresh local full suite3403/0/1, terminal0. Paragraph/break behavior, full Markdown matrices and
visual/native acceptance remain open; see the [paragraph audit](../reviews/docs-paragraph-break-audit.md).
Full C1–C6/M1/D1/U1 remains active and incomplete. See the
[implementation pipeline](../reviews/task.md#authoritative-implementation-pipeline--6-october-2026)
and [Teams evidence](../reviews/evidence/teams-agent-channels.md).

### Historical checkpoint — 5 October 2026

Main baseline `429f2de2` includes selected-provider routing, migration deadlock recovery,
web/mobile-to-desktop ChatGPT connection handoff, separate plugin launch context,
Docs source-dialog focus recovery and scoped scheduled Agenda summaries (PR199).
PR199 exact source `a6a65525` passed all four CI jobs in37291303840:2938 backend
passes, no failures and one existing Tesseract skip.99 focused local cases passed.
Production deployment remains user-run and unverified. Real successful SIWC
inference and truthful whole-account plan/quota acceptance remain open; official
catalogs without hard output limits cannot enable budgeted private scheduling.

Plugin managed/BYO inference is merged in main `0faf19dc` (PR203), with its
independent worker, versioned owner consent, pinned provider/model/allowances,
durable receipts and both client controls. Exact source `ff3c88ef` passed all
four jobs in CI37295933770 and the fresh isolated local full suite:2975 passes,
zero failures and one existing Tesseract skip. Formatting and all workspace
typechecks pass. External plugin host, real provider and native/visual acceptance
remain open. Personal ChatGPT credentials stay excluded; portable MCP remains
independent. This checkpoint does not prove the entire P1 or ADR acceptance.

Slack candidate includes session-bound installation, both client review/DM
controls, durable Background and independently named Overnight morning delivery,
and one canonical encrypted bot vault per app/workspace/bot. Owner-local verified
actors, reviewed scopes and DM permissions remain separate.137 latest-source
integration checks and31 pure checks pass; the full/CI rerun remains required.
Uncertain canonical refresh clears the pair and DM permissions without replay;
unchanged scopes/rotation preserve each consent revision. Last-owner unlink or
account deletion erases the pair without uninstalling the shared workspace app.

Migrations244–246 require explicit reconnect for legacy candidate pairs/pending
exchanges. Stale captured OAuth results cannot overwrite a later canonical
refresh or reviewed reconnect. Signed exact-card replies, Teams, exact-head
full/CI and authorized
workspace/native/visual acceptance remain open. Channel runtime/UI is not on main.
Current source and retained failures: [agent channels](../reviews/evidence/agent-channels.md).

Main429f2de2 passed all four jobs in CI37308099452:2976 backend passes, zero
failures and one existing Tesseract skip. This qualifies the retention/docs
main checkpoint; the user deploys manually. It does not prove channel acceptance.

The settings grid cascade/theme patch removes a late three-column override and
uses existing theme tokens.15 focused tests, backend/desktop typechecks and web
production build pass. Preview inspection still reports a saved browser Block;
Simulator inspection times out -10005. The5174 preview checkout was found39
commits behind main and fast-forwarded to8b6748c5; package builds pass and
untracked preview files remain preserved. This is a process/source correction,
not visual or native acceptance.

Full C1–C6/M1/D1/U1 remains active and incomplete. The current pipeline is in
[implementation handoff](../reviews/task.md). Checkpoints below are historical
evidence for their named source and do not supersede this current state.

### Historical combined candidate verification — 5 October 2026

Exact candidate `ae02bd0e` passed 2,765/2,765 local tests with zero failures,
skips or cancellations, production build, and all four CI jobs in run 37251178079. PR196 remains a draft and is mergeable against main `82576dfa`.
These results qualify that source's automated checks; they do not establish
real-account completed inference or full cross-client visual acceptance.

Docs, Study, project proposals and capture text calls use owned selected-provider
contexts and report actual provider/model provenance. One native desktop Docs
fixture was inspected; remaining narrow/mobile provider labels need inspection.
Real OpenAI authorization and models worked, but the actual inference attempt
returned a subscription-sharing usage limit. Whole-account quota/tier/reset
information is not established by Orbyn's own recorded-call totals.

The next maintained-page change corrects catalog-preference versus provider-choice
selection and captures the consent revision. Private maintained-page execution,
agenda routing, recording capability routing and the rest of C1–C6/M1/D1/U1 remain
unfinished. This ADR is not complete and this candidate is not deployed.

### Qualified main checkpoint — 5 October 2026

PR197 merged as `82576dfa`. Main now contains replay reference-array planning,
checked-out connection error handling and bounded notification source checks.
This checkpoint passed2592/2592 full local tests, all workspace typechecks,
production build and all four CI jobs in run37230581000. Root main was safely
fast-forwarded; user mobile and untracked files remain preserved. The broader
ChatGPT/pages/UI candidate integrated this main checkpoint without conflict.
Its full ADR/runtime/platform acceptance remains open; it is not deployed or
promoted by this backend checkpoint. User deploys main manually.

### Current ChatGPT checkpoint — 4 October 2026

`codex/chatgpt-execution` adds private signed device dispatch, personal provider
choice and explicit default-provider fallback. A queued request captures the
provider consent revision; changing that choice fences claim, publication and
read. Only a known admission rejection can use fallback. Partial or unknown
completion cannot be retried through another billing provider. Connect starts
authorization directly; the local callback flow still requires a running Orbyn
runtime. MCP permissions and plugin calls remain separate.

Focused routing/security checks pass; this candidate is not production-qualified
or merged. Full-suite stability, real-account inference and measured usage display,
cross-client visual acceptance and the full governing C1-C6/M1/D1/U1 contract
remain required. Current evidence and limitations are recorded in
[the task handoff](../reviews/task.md#chatgpt-dispatch-and-provider-choice-candidate--4-october-2026).

The preceding dispatch/replay source passed2701/2701 full local checks with
normal PostgreSQL settings. A subsequent upgrade safeguard requires signed
`plan_inference_v1` capability before selecting or dispatching to a device;
legacy catalog signatures and reader responses remain compatible. Personal
provider data routing and explicit fallback are documented in the Privacy Policy
under the shipped2026-10-04 agreement version. These later changes have focused
coverage and require fresh full/CI qualification before a main checkpoint.

Completed ChatGPT assistant-call usage now has an owner-only 30-day metadata
store and an on-demand view on web/desktop/mobile. Accepted signed completions
are counted once; missing token counts remain unknown, exact aggregate totals
use decimal strings and analytics opt-out prevents recording. This is recorded
Orbyn usage, not an account tier or remaining allowance. Temporary request cleanup
does not remove these measurements; account deletion and central retention do.
Current API, types and focused behavior checks are recorded in the handoff.
Desktop sign-in and refreshed native agreement acceptance require the pending
Computer Use confirmation before completing current connected-layout review.

Provider selection is now captured in immutable job metadata at enqueue for both
interactive and automation work. Recovery and dispatch compare it with current
settings; managed calls and explicit fallback also recheck before sending data.
Focused recovery/authority tests pass. Private calls now have durable per-loop
operation IDs, frozen wire input, cached accepted replies and budget reservations.
Separate specialist loops queue independent assignments. Fallback is marked
before dispatch and cannot repeat after unknown completion. Active encrypted
envelopes retain recovery evidence; operation tombstones follow saved-job
retention. Process-kill and focused recovery checks pass. Current full/CI,
actual provider provenance and live-account/UI acceptance remain required before
main promotion.

## Context and scope

The user authorized implementation of the revised DevDay plan with production checkpoints on main. Voice, computer use and the speculative Decisions API integration are excluded. The existing durable assistant, source visibility, approvals, receipts, Docs and managed connections remain the foundation. The governing acceptance contract is [the revised implementation review](../reviews/devday-2026-implementation-review.md), including M1, D1 and U1. No removed feature is required to finish this ADR's scope.

## Decisions

### 1. Separate Orbyn identity, provider credentials and executor identity

OpenAI identity linking creates an Orbyn account/session after verified issuer, audience, subject and nonce checks. Existing-account linking requires authenticated proof, not matching email alone. First-party sign-in, connector grants and plan-use authorization are separate transactions. SIWC is presented first where an eligible implemented flow exists; managed/BYO providers remain supported. Eligibility gates are visible release constraints.

Plan access/refresh tokens live only in their authorized user-controlled runtime and are never stored in shared Orbyn backend databases or plugin infrastructure. Executor registrations carry user, account/workspace, connection and host identity; leases fence concurrent devices. A device cannot extend its owner's backend rights. Server mutations always run through typed capability policy, durable receipts and revision guards.

### 2. Connection-specific adapters and model defaults

Use a discriminated connection contract for managed, BYO and plan-local routes. Implement plan streaming Responses separately from managed adapters; reject unsupported request fields/tools locally before sending. Preserve cancellation, typed completion/failure and checkpoints through SSE reconnects. A plan request must not silently become a managed billed request.

The credential owner fetches the account's `/v1/models` catalog. Expose the first-party `/models` contract and model selection through an authenticated sanitized snapshot, with explicit freshness/account generation. Only display eligible list entries and preserve provider ordering. Default model is scoped to user + connection + account/workspace. Revalidate on inference, model list refresh, account change and revocation. Never use an arbitrary curated fallback for unavailable entitlements. Managed usage and plan usage remain distinct; estimates are not provider billing guarantees.

### 3. Typed rules extend current assistant ownership

Migrate the current named assistant into the multi-agent owner model while retaining memory, goals, routines and preferences. Text standing instructions are not executable policy. Typed rules bind action class, agent and space; deny wins over ask, ask over allow. Allow cannot override ownership, source restrictions, team policy, hard stops, budgets or stale revisions. Recheck policy at execution, apply and notification delivery.

Persist activity events with authorized replay cursors. Polling remains a recovery mechanism. Use durable work reservations and distinguish estimate, reported usage and billed usage. Background plan jobs defer when the runtime is absent unless the user explicitly permits managed fallback.

### 4. Plugin has its own authenticated backend integration

Create a separately routed integration module/process boundary for plugin launch contexts, UI resources, tool calls and events. It resolves connector principals and resource/audience scopes independently of first-party sessions. Plugin backend calls use approved managed/BYO credentials; they cannot borrow plan tokens or first-party `/models` defaults.

Reuse the capability registry and domain mutation services through an explicit adapter. Do not proxy arbitrary first-party routes, trust host metadata as authorization, or duplicate transaction/receipt code. UI resources use declared schemas, CSP and bounded inputs; callbacks/events are deduplicated and replay-safe. Existing MCP tools remain portable when extension UI is unavailable.

### 5. Markdown remains portable structured content

Extend existing blocks and parser; preserve source syntax, stable block anchors and document revisions. Adopt the explicit D1 matrix for CommonMark/GFM, code, math, footnotes, callouts, reference links/frontmatter, TOC and Mermaid diagram families. Provide source/rendered preview synchronization, contained scrolling and export parity across desktop/web/mobile.

All diagram rendering is strict, bounded and bundled/isolated. Document input cannot relax security, insert script, trigger arbitrary network access or grant file access. Unknown syntax remains source; parse errors are recoverable inline. Mobile diagram parity cannot be declared from its current flowchart-only implementation. Preserve source links and authorization through preview, publication and exports.

### 6. Shared pages and channels retain bounded authority

Assistant-owned blocks identify exact block revisions and writable scope. Human edits are conflict checked. Page mentions launch deduplicated scoped jobs; effective authority is an intersection of actor rights, agent scope and page permissions. Public snapshot/live publication requires explicit consent, revocation and current source checks. Slack/Teams connections require authorized installation and exact waiting-card identity for replies.

### 7. Production checkpoints require current evidence

Develop in the isolated worktree and merge scoped ready commits into main. Documentation acceptance does not imply product completion. Every checkpoint records tests, migrations, clean Docker builds where affected, typechecks and runtime proof. U1 requires desktop/mobile responsive and native interaction checks for affected features, with stale state and overlay races. External account/provider/platform access gates are recorded as incomplete until actually exercised.

## Alternatives rejected

- One shared adapter/token store for plan, managed and plugin: incompatible permissions, billing and request contracts.
- Plugin UI directly calling first-party APIs under the browser session: confuses connector grants and account authority.
- Treating a model slug as globally entitled: catalogs and defaults vary by account/workspace.
- Replacing all existing editor blocks with a new renderer: loses anchors, suggestions and current document contracts.
- Arbitrary VS Code extension parity or executable HTML: unbounded behavior outside D1 and unsafe for shared documents.
- Merging partially verified product code because typechecks pass: does not establish UI/runtime correctness.

## Consequences and migration

New connection/executor, catalog/default, typed rule/agent ownership, activity, block binding and publication records will require versioned schemas and retention rules. Migrations preserve existing managed connections, named-agent settings and document source/anchors. The next implementation checkpoint must inventory exact current schema and affected clients before introducing migrations. Version API contracts in core/API client and include clean image dependency coverage, including the already repaired backend API-client packaging.

## Acceptance and current state

This ADR is complete as an architectural decision. Product implementation remains open in C1–C6, with per-feature acceptance criteria in the governing artifact. No OAuth runtime, new `/models` route, typed rules, mobile Mermaid parity, plugin service or UI repair is claimed by this documentation checkpoint.

### Integration constraint — 2 October 2026

Main now includes companion wardrobe and assistant chat redesign (`7c96f70`) and
companion editor save visibility (`e4370a3`). Preserve those characters, controls
and styling when integrating the broader platform and UI changes. Qualification
on an older main base does not qualify the combined version: integrate current
main and rerun the affected checks before each application checkpoint.

Assigned-source ownership PR #139 is merged as main `76ec92b`, from candidate
`51ce91b`, preserving the current character implementation. Its database guard
serializes Background/Overnight ownership across shared-task members. It also
corrects six off-scale character/assistant font sizes in both clients. Focused
checks, all workspace types, production builds and formatting passed. The full
local suite passed 2,103/2,103; CI passed all jobs with 2,102 backend passes,
zero failures and one Tesseract skip. Separate compiled processes verified the
guard; main has the same tree as the qualified source and CI merge commit.
This is a merged checkpoint, not a deployment or whole-app UI completion.

Handoff acknowledgment source `6fd43f4` derives receiving outcomes from
current completed-job evidence, checks producer revision and both jobs' access,
and serializes idempotent retries. The combined contract/storage/request checks
passed 27/27, with backend types and formatting. It does not enable dispatch,
grant receiving authority or prove separate-worker collaboration. Source
`deb93cb`/`114bb2d` also derives durable failure reasons without copying provider
error text or restricted outcomes; its 32 contract/storage/request checks and
backend types passed. Handoff services remain unmerged and unwired.

Docs PR #138 had green CI on `25e1e6f`; combined character candidate `788161e`
passed 37 focused checks, all types/build/format, with new CI still running.
Its fresh native verification is blocked by an iOS password-save prompt, pending
the user's dismissal. Web/mobile-web and native Android interaction gates remain
open. The governing review and implementation handoff
retain the full remaining scope; these checkpoints do not complete the ADR.

### Activity checkpoint and scope continuity — 2 October 2026

PR #140 is merged as main `9e7e505`, from frozen candidate `01b8757`.
Migration 210 records content-free job transitions in separate owner/runtime
streams with monotonic replay cursors and 90-day event retention. The private
read route and typed client recheck current source visibility. Polling,
heartbeats and checkpoint-only writes do not fabricate work activity.
The fresh marked database suite passed 2,112/2,112, with no failures, skips or
cancellations. Workspace types, production builds and full formatting passed;
all four CI jobs passed. Candidate, CI merge and resulting main trees are
identical (`f62fdf5209f0dfb77b60ccb5788724c005742d04`). No deployment occurred.

The governing revised implementation review remains the full acceptance
contract. This checkpoint does not narrow it to assistant chat or activity:
whole-app layout, Docs editing/rendering/export, views and settings, provider
and embedding options, actual account-specific model execution, separate plugin
integration, typed agent rules, durable budgets and bounded cross-runtime
collaboration remain required. Web/desktop features require mobile parity.
Preserve main's character work and Orbyn's palette. Unverified responsive/native
behavior and external integration gates remain open. Related worktree cleanup
comes after integration and qualification, without discarding retained work.

### Independent Overnight scheduling checkpoint — 2 October 2026

PR #141 is merged as main `7f3894f`, from frozen candidate `9b87ce3`.
The scheduler's per-owner busy check now applies to Overnight jobs; unrelated
queued/running Background or interactive jobs cannot starve its night work.
Own-lane serialization and the shared-task ownership guard remain enforced.
Four new regression cases failed before the correction. Afterward, the focused
night/runtime/ownership suite passed 53/53 and the fresh full local suite passed
2,120/2,120 with no failures, skips or cancellations. All workspace types,
production builds and full formatting passed; every CI job passed. Candidate,
GitHub merge and resulting main trees match
`3e2d1b8410f139b625c88036679d62a77c08caca`. No deployment occurred.

This completes a scheduler checkpoint, not bounded handoff dispatch or full A4.
Typed rules, agent ownership records, durable budgets, receiving authorization
and cross-runtime round trips still require integration. The whole-app D1/U1,
provider/model, plugin and mobile parity deliverables remain in scope.

### Qualified source privacy and parent deletion checkpoint — 2 October 2026

PR **#144** is merged as main **eccf338**, from frozen candidate **f79c852** on
base **dabb770**. Migration 213 prevents account/team cascades from recreating
history-access metadata for a disappearing parent; ordinary target deletion
retains original owner/team history. Personal notice enqueue/inbox/push delivery
checks job-only dependencies; Review summaries, counts, outcomes and saved
notices omit unavailable producing-job sources. No production data was touched
during reproduction. Current access protection does not prove source revisions.

Fresh marked database full local suite passed **2,151/2,151**, no failures/skips/
cancellations (563,046 ms); combined focused suite **69/69** passed. All workspace
types, production builds and full formatting passed. Every CI job
**36996647235** passed. Candidate, GitHub merge **2f1984a** and resulting main
trees match **a903b6c7158871b05472e3afb54d824290df80fa**. No deployment occurred.

The entire revised acceptance contract remains active: account-specific real
model execution/defaults, provider/embedding options, separate plugin backend
and supported host integration, full Docs Markdown/Mermaid parity, whole-app
web/desktop/mobile UX, independent agent profiles and bounded authorized
collaboration, typed ownership/rules/editor, reviewed source revisions and
budget reservations. Public rule editor remains disabled. Preserve character
work, Orbyn palette and mobile parity; cleanup follows complete integration and
qualification. Voice/computer-use product features and speculative Decisions
remain outside scope.

### Qualified current assistant authority checkpoint — 2 October 2026

PR #145 merged as main **3450e87**, from frozen candidate **04d1ff7** on
base **456e01a**. Each capability reloads the current owned active assistant
grant and intersects it with server-selected caller restrictions. Current
Personal/team access, team role/policy, toolsets, trust, approval exceptions and
outside-content restrictions cannot expand earlier authority. Reads use primary;
writes serialize grant changes. Typed rule revision fences remain in place.

Exact candidate full local suite passed **2,157/2,157**, zero failures, skips or
cancellations,556,800ms, on fresh marked **orbyn_authority_04d1ff7_test**. Workspace
types, production builds and full formatting passed. All CI **37000288172** jobs
passed; backend passed2,156 with one Tesseract skip and zero failures. CI checked
merge **a94a7c4**. Candidate, CI merge and resulting main trees are identical
**94774365fcabd2b7d331d35a3d110880dce5a641**. Main fast-forward preserved user
mobile/app.json and unrelated files. No deployment occurred.

Source **c237cfb** additionally binds cached assistant results to effective
authority and rechecks producing-job/container/current sources. Its72 focused
checks and backend types/format passed, but it remains unmerged pending complete
cached-target authorization, grant-scoped dependency closure and source revision/
concurrency proof. Private receiving handoffs/budgets, typed read/effect/notice
policy, agent ownership/editor, full real account models/providers/embeddings,
plugin host acceptance, complete Docs/Mermaid and whole-app web/desktop/mobile
UI gates remain required. Preserve Orbyn palette and characters. Saved web
preview denial remains respected; cleanup follows complete integration and
qualification. Voice/computer-use product features and speculative Decisions
remain outside scope; the full ADR goal remains active.

### Qualified cached assistant result checkpoint — 2 October 2026

PR #146 merged as main **c9b6c78**, from frozen **0033a96** on unchanged base
**7c08aa6**. Assistant cached write results bind to current effective authority
and recheck producing job/container/source access, grant-scoped source visibility
and typed targets/structured links across the32 produced receipt families. A held
result does not repeat the mutation; restoring target access can return the
original answer. Ordinary connector replay remains unchanged.

Exact candidate local full suite passed **2,176/2,176**, zero failures, skips or
cancellations,556,169ms. All workspace types, production builds and full formatting
passed. All CI **37003294826** jobs succeeded; backend passed2,175 with one
Tesseract-dependent skip and zero failures. CI merge **cd57b95**, candidate and
resulting main have identical tree **0d1f05994b7ed460131fe2e16ba9d3ad4ce59222**.
Local main fast-forward preserved user mobile/app.json and unrelated files.

This checkpoint does not complete replay security or the full ADR. Original
provider-read revisions, nested dependency closure, concurrent source fences and
other persisted result paths remain open. Completed document draft replay is a
separate source follow-up, not in this merge. Receiving handoffs/budgets, typed
read/effect/notice policy, owner/editor UX, actual models/defaults/execution,
providers/embeddings, separate plugin host acceptance, complete Docs/Mermaid and
whole-app web/desktop/mobile acceptance remain required. Preserve palette and
characters. No deployment or cleanup occurred; voice/computer-use product
features and the speculative Decisions adapter remain excluded.

### Qualified completed document draft checkpoint — 2 October 2026

PR #147 merged as main **4bbcfec**, from frozen **53089fd** on base
**e1d46af**, at 12:25:15 UTC. Completed append_doc answers replayed under a
new client_ref now recheck producing evidence and destination access before
returning saved titles, identities or links. Restored access returns the saved
answer without another page mutation. Five focused regressions cover unchanged
access, excluded projects, deleted destinations, narrowed personal access and
restored access. Ordinary connector guards remain unchanged.

Exact candidate local full suite passed **2,181/2,181**, zero failures, skips or
cancellations, 590,567 ms, on fresh marked orbyn_draft_candidate_test. All
workspace types, production builds and full formatting passed. All CI
**37004911014** jobs succeeded; backend passed 2,180 with one Tesseract skip.
CI merge **94006ee**, candidate and resulting main have identical tree
**ab575239dd8e10fab7a52d32946a75a1229ab95f**. Local main fast-forward preserved
user mobile/app.json and unrelated files.

This closes the completed-draft fast path only. Original provider-read revisions,
nested dependency closure and concurrent source fences remain open, alongside
models/defaults/execution, providers/embeddings, separate plugin integration,
agent collaboration/reflection and whole-app Docs/UI acceptance. Preserve palette
and characters; voice/computer-use product features remain excluded. No
deployment or cleanup occurred. The full ADR remains active.

### Home agent presentation — 3 October 2026

Apply the user’s Muse/Dots direction to both public and signed-in Home, with native
parity. Research: [Muse design](https://introducing.muse.ai/) emphasizes visible
background activity, meaningful interruptions, and task-shaped outputs;
[official Dots documentation](https://learn.chatgpt.com/docs/dots) describes work
between conversations and separate task activity. These inform the presentation,
not additional Orbyn capabilities or blanket permission to act.

Home should explain a concrete responsibility and where to review its result.
Public examples must be labeled examples, never fabricated live runs. Use two
plain editorial rows for Background and Overnight, with separate timing and
morning review descriptions; keep character customization distinct from work.
Signed-in Home opens real permission-filtered profiles with activity and outputs.
Idle must remain idle when no authorized work exists. Reflection and inter-agent
collaboration remain existing acceptance gates, not advertised completed features.
Preserve Orbyn tokens and character preferences; avoid generic slogans and a
repeated grid of decorative feature cards.

The user owns web visual validation on their test server for this increment.
Code/build checks do not establish visual acceptance. Native screenshot and
interaction acceptance remains required and the disposable account’s terms
confirmation is still pending.

### Home copy follow-up — 3 October 2026

Replace vague first-screen metaphors with tasks, calendar, project notes and
delegated work. Present Background and Overnight as separate work schedules,
with an explicit review destination for each. Label illustrative requests as
examples and keep idle behavior truthful. Muse informs visible activity and
meaningful interruptions; Dots informs work between conversations. Their
capabilities do not establish capabilities in Orbyn. Reflection and collaboration
remain open acceptance gates. This follow-up changes copy only; the user’s web
visual validation and native acceptance remain outstanding.

### Home responsibility and review layout — 3 October 2026

Follow-up research confirms the useful presentation patterns: Muse puts activity
and approved permissions behind the avatar; Dots brings back results and asks
for decisions between conversations. Use the primary sources linked above.
Orbyn adopts visible responsibility, review destinations and pause conditions.
It does not inherit their cloud computers, app access or always-on execution.

Public Home uses a straight, in-flow planner example and two editorial agent rows
with labeled requests, review destinations and stopping conditions. Shared core
copy keeps the web and native signed-in Home descriptions consistent. No status
or output is fabricated. Reflection and collaboration remain open acceptance
gates. All character presets remain available; browsing never changes identity.
Web visual acceptance belongs to the user's test-server review for this increment;
native screenshot and interaction acceptance remains open.

### Home responsibilities before decoration — 3 October 2026

Rechecked primary product references: [Muse's design account](https://introducing.muse.ai/)
puts work status, activity and approved permissions behind the avatar, and describes
notifications for meaningful results or input. [Dots documentation](https://learn.chatgpt.com/docs/dots)
describes ongoing responsibilities between conversations. Use those interaction
patterns to explain Orbyn's existing work; they do not prove Orbyn has the same tools.

Public Home now gives Background and Overnight their own section before the feature
catalog and character gallery. Navigation opens the agents section. Each has a timing,
a labeled example request, a review destination and a stopping condition. Replace
vague supporting slogans with specific task, calendar, project and review copy.
Character presets stay available in their own section. Signed-in web/native Home
must show the same timing and pause details alongside their existing activity entry.
No fake running states, always-on promise or completed reflection claim is introduced.
Code tests establish content and ordering, not screenshot acceptance. The user's
test-server web review and native visual acceptance remain open.

### Saved-revision export API checkpoint — 3 October 2026

Optional expected document versions protect file exports against concurrent
changes. Check visibility first, then return409 for any format at a different
saved revision. Invalid versions use the established422 schema response. Shared
clients carry the revision and never silently retry against a newer one.
Unversioned callers keep their existing behavior. The isolated candidate passes
17 export API checks, one real client check, all workspace types and production
builds. Exact-head CI remains required before merging this checkpoint.

This is API foundation only: both editors still need explicit save-success and
offline/failure handling, revision capture and all share-path integration.
Rendered PDF, publication, native sharing and whole D1/U1 acceptance remain open.

### Primary reads for file actions — 3 October 2026

Export file transport does not carry the ordinary JSON transport's read-after-write
header. Lag-tolerant replica reads could falsely reject a newly saved revision or
return older content/visibility. Both the file export route and its legacy Markdown
route now use the primary for the document and task/link permission enrichment.
This gives file actions current primary state even for existing unversioned callers.
Current-version conflicts and visibility-first404 behavior remain unchanged.
Regression checks execute the actual handlers with distinct primary and replica
dependencies; no export query or helper may use the stale replica. This is a
backend freshness checkpoint; PDF visual rendering and full D1/U1 remain open.

### Public Home request examples — 3 October 2026

[Muse's design account](https://introducing.muse.ai/) describes task-shaped outputs
and meaningful updates. [Dots' profile documentation](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)
exposes activity and task controls. Use those presentation patterns to make
Orbyn's existing responsibilities easier to understand. Public Home now gives
each agent a labeled example quotation, followed by where to review the work
and when it pauses. Preserve all character presets, Orbyn tokens and truthful
idle behavior. This checkpoint changes public presentation only; signed-in/native
Home refinements remain in the larger candidate. Reflection/collaboration and
the full ADR acceptance gates remain open. User test-server visual review is
still outstanding; automated content checks do not prove visual acceptance.

### Home responsibilities and product copy — 3 October 2026

Latest user direction: Background and Overnight should feel like personal agents
with ongoing responsibilities, informed by Muse and Dots. Both public Home and
signed-in Home must explain the product in concrete language and preserve mobile
parity. Avoid invented live status, generic AI slogans and capability claims that
have not passed the governing acceptance contract.

Primary references rechecked:

- [Muse's design account](https://introducing.muse.ai/): task-shaped outputs,
  visible activity and notifications worth interrupting for.
- [Meet dots](https://learn.chatgpt.com/docs/dots): work between conversations,
  continued responsibilities and decisions brought back for human review.
- [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory):
  distinct task context, reviewable outputs and explicit recurring work.

These are product references; Orbyn does not inherit their computer, browser,
voice, messaging, account access or arbitrary action capabilities.

| Surface or behavior               | Decision                                                                                                                                    | Current implementation boundary                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Public Home                       | Show a project-notes-to-checklist request and a night research queue, each with three concrete steps.                                       | Examples are labeled; no fabricated tasks or activity.                                                                            |
| Signed-in web/desktop/mobile Home | Use the same responsibilities and optional step-by-step guide; retain real profile activity behind the existing action.                     | Character browsing does not mutate settings. Status comes from authorized profile evidence, never avatar animation or local time. |
| Background                        | Delegated work has progress, sources, an output and a place for decisions.                                                                  | Existing task/profile behavior; full ongoing-goal and routine qualification remains open.                                         |
| Overnight                         | Explicit queue, chosen window, bounded budget and morning review of completed and unfinished work.                                          | Window/budget constraints remain visible; no promise that every queued task finishes.                                             |
| Reflection                        | With explicit consent, review evidence from prior work and propose lessons with sources.                                                    | Existing reflection candidate remains an acceptance gate. Home must not describe it as shipped.                                   |
| Collaboration                     | Keep separate processes, runs, budgets and activity; exchange bounded, authorized handoffs with acknowledgments and source revision checks. | Complete receiving-worker dispatch and separate-process runtime proof remain open. UI copy cannot substitute for this work.       |
| Notifications                     | Surface meaningful results or decisions; preserve the morning review destination and quiet behavior.                                        | Delivery-policy acceptance remains part of the governing contract.                                                                |

This increment changes Home content and layout, not worker capabilities. The
public workflow collapses to one column at narrow widths; signed-in guide content
wraps and native content grows naturally. Web visual acceptance remains with the
user's test server for this increment. Native screenshot/interaction acceptance
and the complete U1 gates remain open. Retain current character work and palette.

Public Home promotion candidate: based on main9702f19e, includes only shared
copy, the public page's workflow layout, its focused checks and this ADR section.
Signed-in Home/profile and renderer work remain in the larger draft. Local Home
checks3/3, all workspace typechecks/builds and full formatting pass. Web visual
acceptance is still delegated to the user's test server for this increment;
full exact-head local and CI qualification is required before main merge.

### Main-based rendered PDF checkpoint — 3 October 2026

Add a separately authenticated offline document renderer process and required
shared helpers, with a dedicated Chromium image, credential/network isolation,
enabled sandbox and bounded work/cancellation. The API authorizes primary-read
snapshots and rechecks access/version before returning a file. Signed requests
retain replay nonces until signature expiry, including allowed clock skew.
Production rollout starts PDF before API and validates its independent key.

This checkpoint prints math and all ten Mermaid families through the existing
PDF export contract shared by web, desktop and mobile. Standalone HTML gets
escaped source markers; this does not claim complete rendered HTML, publication,
inline image-byte or native sharing acceptance. Root-locked first-party build
dependencies generate only the backend asset; no app module imports are added.
Web/native editor and settings changes remain in their respective candidates.

Qualification requires focused real export tests, full local suite, workspace
types/build/format and exact-head CI including the hardened renderer image.
Main promotion remains conditional on those results. Full C1–C6/M1/D1/U1 scope
remains active; no deployment, release or cleanup is performed.

## Qualification correction — 3 October 2026

- Main21c6c076 full local suite is terminal:2,245/2,246, one old clipboard expectation for `<h2>Plan</h2>` after authored level1 correctly becameh1. Updated that expectation and added exact all-six-level HTML/clipboard regressions; no h7. h4–h6 print at readable body size. [Heading fixture](pdf-heading-levels.png) inspected with no overlap or clipping.
- Combineda039f271 CI37057124805 failed one all-family PDF text assertion despite local2,488/2,488. Reproduced in a hardened offline Linux renderer: “flowchart” prints correctly but pdf.js returns adjacent `fl`/`owchart` font runs. The test inserted a false space. Position-based line reconstruction and normalization now recover all ten exact headings and all six required SVG labels from the Linux file. A regression covers split font runs and ligatures; expected headings are exact line checks.
  -Current57 browser/helper/service/primary/deployment units and63 actual export/rich-page/heading/text checks pass. All workspace types/build/full formatting pass after the fix. Linux diagnostic artifact is `/tmp/orbyn-pdf-linux-api-batch.pdf`; its older image isolates printing/font behavior and is not current-head image qualification.
  -New full exact-head local and CI qualification required after committing this correction. Previous main/combined CI failures are not passing evidence. PR161 stays draft until corrected full local/all CI pass; no main merge/deploy/release/cleanup.

### Authorized picture snapshots for PDF and HTML — 3 October 2026

Candidate follows the qualified PDF checkpoint and uses the same endpoint on all
clients. Export authorized raster bytes as inert data URIs rather than omitting
pictures. Authorize on the primary, fetch only bounded signed first-party paths,
keep credentials/network out of the renderer, and recheck page/file access before
delivery. Missing/revoked pictures must fail explicitly rather than produce a
caption-only partial file. Preserve copied-file reference access when the original
page is removed. Evidence: `docs/reviews/evidence/doc-export-images.md`.

This closes the candidate's PDF/HTML picture-byte gap, subject to full current-head
qualification. It does not close native sharing, complete rendered HTML/publication,
Word/export/editor parity or broader C1–C6/M1/D1/U1 acceptance. Goal remains active.

### Portable rendered HTML candidate — 3 October 2026

Use the private first-party renderer for the existing HTML export endpoint as
well as PDF. Bind internal signatures to output format, share replay/concurrency
limits, render inert SVG images and MathML, retain escaped source, and install
script/frame/network-denying CSP before content. Keep screen styles with bounded
print overrides under media rules. Recheck current page/file authority before
sending the complete file. Evidence: `docs/reviews/evidence/doc-rendered-html.md`.

Candidate is stacked on the image export checkpoint, not yet qualified for main.
Publication, source/editor/Word parity, native interaction and the remaining full
ADR gates still require implementation/acceptance; the objective remains active.

### Signed-in Home/profile promotion candidate — 3 October 2026

Extract the signed-in Home guide and separate agent profiles from the larger
candidate onto current main (`192cb475`), with matching web/desktop and native
entry points. Keep the same shared Background/Overnight requests and workflow
steps as public Home. Replace the generic companion subtitle with “Background
progress and Overnight results.” Browse every character preset without changing
account settings. Profile activity, last work and outputs come from a private,
permission-filtered primary snapshot; refresh and avatar presence are not work.

The profile contract distinguishes idle, queued/recovering, working, waiting and
scheduled states. Overnight alone has a night window and estimated budget. Each
lane keeps its own activity and outputs. Open completed work only when the current
interactive chat can safely switch. User-facing activity labels are shared by
both clients; structured state is validated independently of copy.

Research remains the primary [Muse design account](https://introducing.muse.ai/)
and [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
Their useful presentation patterns inform reviewable responsibilities; this
candidate adds no browser, computer, voice or external messaging capabilities.

Focused profile/store/client/Home checks pass 22/22. The first typecheck exposed
an omitted shared activity-label export; the scoped prerequisite was added and
current qualification continues. Full local/all-CI results, web test-server visual
acceptance and native screenshot/interaction acceptance are separate gates. No
claim of full U1, reflection or collaboration completion follows from this Home
increment.

### Published diagrams and delivery authority — 3 October 2026

Render public-page Mermaid sources in an isolated synthetic batch through the
private HTML renderer, returning inert images and escaped source without sending
publication forms, app links or live media capabilities to Chromium. Keep the
published layout and script/frame-denying policy. Recheck publication/password,
team policy, page revision, public links, files and folder navigation on the
primary after rendering, before returning HTML. Refuse revoked or changed
snapshots explicitly. Evidence: `docs/reviews/evidence/publication-renderer.md`.

This candidate requires complete exact-head qualification before main promotion.
It does not close editor, Word/export, native sharing, whole-app UI or the full
C1–C6/M1/D1/U1 goal.

### Gantt label readability candidate — 3 October 2026

Keep task, section and chronological labels readable in the isolated renderer.
Measure tick spacing and retain one label per displayed date, preserving the
underlying grid, authored format and task times. The current synthetic printed
fixture and real PDF font/bounds checks are recorded in
`docs/reviews/evidence/diagram-readability.md`. Both clients' exports use this
server rendering path. Editor/native preview parity and complete D1/U1 remain
open; candidate needs full exact-head qualification before main promotion.

### Home review information and progressive disclosure — 3 October 2026

Rechecked [Muse’s product design](https://introducing.muse.ai/) and
[Dots’ task/profile controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot).
Muse makes activity and responsibility visible; Dots separates in-progress,
scheduled and completed work. Orbyn should present these as work a person can
inspect and direct. The two agents retain separate runtimes and schedules.

The Home section currently repeats its explanation as a summary, quotation,
three steps and review instructions. Keep the example request, destination and
stopping condition visible; put procedural steps behind a keyboard-accessible
“How … works” disclosure on public Home. Signed-in web and mobile must expose
review destinations and pause conditions before their optional guide is opened.
Use concrete requests naming source notes, requested output and unanswered
questions. Morning copy must distinguish finished work from queued work.
Preserve palette, all character presets and evidence-based idle status.

This is a presentation candidate atop PR165, not a worker or reflection change.
User test-server web review remains outstanding; native interaction/screenshot
acceptance is still required. Complete C1–C6/M1/D1/U1 remains active.

### Scoped Markdown parity qualification — 3 October 2026

Six-level headings and page-scoped references must work across schemas, saved
pages, private read projections, comment positions, Word/clipboard exports and
both clients. Reference definitions remain editable Markdown; HTML does not
show them as page text. The scoped candidate preserves the existing publication
and diagram changes on main1100ca98. See
`docs/reviews/evidence/markdown-parity.md` for evidence and remaining acceptance
gates. This does not close D1 or the wider UI scope.

### Embedded reference context — 3 October 2026

An embedded section resolves references from its authorized source page, even
when the definitions are outside the selected heading. Privacy projection
precedes section selection; inaccessible object destinations are excluded from
the returned context. Both clients isolate embedded reference and footnote
contexts from the containing page. See
`docs/reviews/evidence/reference-embeds.md`; runtime/visual acceptance and full
qualification remain open.

### Current-draft source inspection and fragment navigation — 3 October 2026

Scoped candidate atop PR169: both page menus expose a source/rendered inspector
for current editor blocks; the panel owns no second draft/save. Document identity
fences hide the panel on a page switch. Web selection and scrolling map between
anchored Markdown lines and rendered blocks; mobile offers source/rendered tabs.

Ordinary editors resolve bounded Unicode heading fragments and unfold only
sections covering the target, waiting for saved fold preferences. Embedded
fragments open the source page through their own navigation context. Retain
page-scoped references and current authorization; no parent-page fragment reuse.
Current candidate passes20 focused and115 combined export/rich-page/navigation
checks plus all workspace types/builds/full formatting. Full matching-head local
and CI qualification and actual editor/native screenshot/interaction acceptance
remain required. Source editing, the other D1 Markdown requirements and full U1
remain open; no goal completion, deployment or cleanup is claimed.

### Native and desktop diagram preview candidate — 3 October 2026

Scoped candidate on PR172 replaces mobile flowchart-only rendering with the
bundled strict engine and gives desktop bounded rendering plus source/fit/zoom/
pan/SVG controls. Native canvas adapts to the window and tall fit diagrams expose
pan. All ten native synthetic fixtures rendered; source, fit/zoom and pan were
exercised, and SVG export opened the native share sheet. Evidence and retained
failures: `../reviews/evidence/native-diagram-parity.md`. Full final-head tests,
CI, signed-in editor/parent-scroll/Android/web acceptance remain open. This does
not complete D1/U1 or authorize deployment. All C1–C6/M1/D1/U1 scope remains.

### Docs code and metadata controls candidate — 3 October 2026

Both clients provide code copying, known-language source/highlighting and
readable metadata disclosure while preserving exact literal source. Native
monospace is platform-correct; web overflow stays in the block. Actual native
synthetic controls were exercised and screens recorded. Evidence:
`../reviews/evidence/code-metadata-controls.md`. Final full-suite/CI, signed-in
editor, Android and web visual gates remain open. This candidate does not finish
D1/U1; the complete C1–C6/M1/D1/U1 scope and excluded product features remain.

### Source editing candidate — 3 October 2026

The source/preview pane now delegates Markdown edits to each client's existing
editor update/save queue. Reading and Suggesting modes retain inspection only.
Retained anchors keep block identity; duplicate anchors show an unsaved-source
error and can be restored explicitly. The parser reports original source-line
ranges so blank lines, alternate fences and CRLF do not desynchronize preview
navigation. Typed source echoes are tracked by weak block identity to avoid
rewinding newer native input. Native caret positioning is applied once when
returning from preview rather than controlled during typing.

This candidate follows code/metadata PR174. Native synthetic typing, preview,
validation and restoration were exercised with screenshots. Complete signed-in
revision/conflict/keyboard/swipe/Android acceptance and frozen full local/CI are
still required. The user will manually validate web presentation; blocked
browser access is not bypassed. This does not complete C1–C6/M1/D1/U1 or authorize
deployment/cleanup.

### ChatGPT model settings promotion candidate — 3 October 2026

First-party Settings on web/desktop/mobile expose owned device catalogs and
account-bound defaults. The credential-owning runtime rereads the shared
default before capturing inference; failed, foreign or regressed reads cannot
use a cached model. Device discovery returns credential-free metadata for
current owned registrations and is excluded from agent tools. This is a scoped
candidate; evidence and remaining M1/U1 acceptance gates are recorded in
`docs/reviews/evidence/chatgpt-model-settings.md`.

### Separate plugin UI resource adapter checkpoint — 3 October 2026

The plugin HTTP backend now exposes bounded resource discovery/reads separately
from first-party sessions. Static Orbyn cards reuse the existing portable MCP
renderer, declared MIME and CSP metadata. Resource visibility intersects live
connector tool scope with the explicit card UI setting; unknown addresses are
refused without network fetch. This adapter does not establish host launch or
extension transport acceptance. Host screenshots, grant/account switching,
managed/BYO execution, asynchronous results and reconnect cursors remain open.
See docs/reviews/task.md for exact tests and the unavailable local database gate.
All C1–C6/M1/D1/U1 implementation requirements remain active.

### Plugin protocol adapter checkpoint — 3 October 2026

A per-request MCP SDK server now serves current and legacy stateless exchanges
at the separate plugin boundary. The adapter receives only the independently
resolved plugin principal; HTTP/protocol tool calls share policy, budgets and
domain receipt execution. UI cards intersect current tool scope and the card
UI opt-in. Private zero-TTL protocol metadata supplements no-store HTTP replies.
Protocol tests establish exchange behavior with synthetic authorized callbacks,
not actual account, provider or hosted UI acceptance. Remaining C6 gates and the
full retained implementation scope stay open in docs/reviews/task.md.

### Plugin async import candidate — 3 October 2026

The separate plugin backend now has a local candidate for durable import handles
and bounded status-event replay through its independently authenticated grant.
It reuses domain import/receipt execution, records content-free transitions,
revalidates current project/document scope at retrieval and binds reconnect
positions to current account/grant/client/resource/job authority. See
`docs/reviews/evidence/plugin-import-jobs.md` for actual route/unit evidence and
remaining gates. Converter writes still require originating-grant provenance and
current write-policy checks; protocol async jobs and actual provider/host launch
acceptance also remain open. This candidate does not complete C6 or the full
C1–C6/M1/D1/U1 goal and must not be promoted before the write guard is proven.

### Home/task layout correction from user review — 3 October 2026

User screenshots identify excessive repeated explanatory copy on signed-in Home
and a bulky task toolbar. The full application redesign remains required.
Signed-in Home should be a compact working entry point: identity, short Background
and Overnight rows, actual activity access and an optional guide. Detailed
examples, timing and stopping conditions belong behind disclosure, with collapse
controls above long content. Public Home uses the same short agent descriptions.
Preserve all character choices and existing task actions, with compact responsive
controls and direct empty-state copy. Native screenshot fixture proof is limited
to the inspected component; real account/runtime, Android, all other surfaces and
full C1–C6/M1/D1/U1 acceptance remain open. Web visuals remain delegated to the
user's preview/test-server review under the existing permission restriction.

### Plugin import producer guard follow-up — 3 October 2026

The originating grant/client/recipient is now captured by both synchronous and
async plugin import starts. Upload admission, post-stream commit and converter
page creation recheck live authority; FK deletion retains the origin flag and
never falls back to first-party power. Real uploaded Word conversion,13 denial
variants and mid-stream encrypted-object cleanup are tested. This supersedes
the earlier missing-producer-guard note. Latest-main full/CI qualification and
remaining protocol/host/account/provider gates still apply; full C1–C6/M1/D1/U1
remains incomplete. Legacy in-flight imports require the documented rollout
handling rather than invented identity snapshots.

### Independent embeddings integration — 3 October 2026

The retained independent-embedding implementation is extracted onto current main
with migration218. Legacy workers stay disabled; explicit embedding provider,
model, verified dimensions, revision-bound consent and generation are independent
of generation settings. Both client admin surfaces expose setup and indexing
state. Schema/setup/client checks21/21, stock-provider checks17/17, late-install
backfill1/1 and actual legacy-vector upgrade1/1 pass. Full local/CI and real
provider/platform acceptance remain required. See
`docs/reviews/evidence/independent-embedding-main-integration.md`. This checkpoint
does not complete provider/model administration or whole-app U1.

### Views workspace layout — 3 October 2026

View layout selection remains immediately available. Filtering, grouping and
sorting share a disclosure on web/desktop and mobile, preserving source-specific
options, custom fields and the existing autosave path. Library instructions are
shortened, headers and rail items bounded on narrow screens, and horizontal table
scrolling is keyboard accessible. Current30 focused checks and all workspace
typechecks pass. Source/CSS checks are not rendered geometry acceptance; user web
review and actual native/Android interactions remain required alongside full
local/CI qualification. This increment does not complete whole-app U1 redesign.

### Overnight reflection integration — 3 October 2026

Reflection is an explicit Night Shift opt-in, using bounded source IDs and
revisions rather than copied private text in queued requests. Current principal
Personal/team restrictions are applied during selection, initial execution and
resumed provider checkpoints. Changed evidence, lost membership, project AI
exclusion or mismatched scope owner stops use of the evidence. Reflection
produces reviewable results; inferred memory writes remain prohibited.

Migration217 retains existing source kinds and adds transcript/run dependencies
plus deduplication receipts. Current main visibility rules and activity retention
remain intact. Both clients expose consent and reflection review. Integration
tests caught SQL parameter typing and missing dependency constraints; corrected
without weakening assertions. The current combined reflection/night-settings/
Overnight suite passes28/28, including selected-team changes and membership
revocation. Full local tests, build/format, CI and signed-in native/web acceptance
remain required; this is not a completed C3/U1 claim.

### Settings modality and layout — user requirement, 4 October 2026

Settings opens as a bounded web/desktop modal over the existing workspace, keeping
documents/chats mounted. Native retains its settings sheet. Preserve search and
setting-command entry points, category navigation, keyboard/viewport containment,
focus return and nested dialog ownership. One-time recovery material cannot be
lost by closing or changing category before acknowledgement.

The next layout checkpoint also replaces wrapped Admin tabs with a desktop rail
and compact native selector, bounded scrolling menus and progressive disclosure
for budget/embedding setup. Budget saves must change only the allowance and
reject stale settings snapshots. Latest UI controls21 and real HTTP budget tests3
pass; full/CI and remaining platform acceptance remain required. Web visuals are
user-reviewed under the latest explicit blind-redesign allowance; native screens
are inspected directly. Evidence and limitations:
`docs/reviews/evidence/settings-modal-layout.md`. This does not complete all U1.

### Maintained pages storage and management — 4 October 2026 (not promoted)

A5 now has a local owner/assistant-bound storage and management API candidate.
Exact page/block and binding revisions protect explicit rebinding; current grant,
page and workspace authority is intersected before context/update. Only selected
blocks enter context, and current link/AI visibility removes private derived
labels. Metadata snapshots never copy page text. Shared-page binding instructions
remain private to their owner. Both clients have typed management contracts.

Focused28/28 tests and all workspace types pass. The scheduler, scoped model jobs,
guarded document writes (including linked-task side effects), @orbyn comment
jobs/replies, consent and review UI, native interactions, and full local/CI
qualification remain open. Details: `docs/reviews/evidence/maintained-pages-contract.md`.
No production promotion or A5 completion is asserted.

### Maintained pages guarded application — 4 October 2026 (not promoted)

A5's internal apply path now uses normal document persistence with selected-block
processing, independent linked-task authorization, current trust/action-rule
checks and atomic page/binding revision advancement. Human blocks and unrelated
task ticks are preserved. Stale/moved/paused work, outside-bound patches and task
permission failures cannot advance the baseline. Concurrent receipts save once.

Docs/assistant-Docs/binding/API/core/inventory/catalog regressions118/118 and all
workspace types pass. Scheduler/model staging/review receipts, both client UX,
@orbyn comment jobs/replies, full qualification and native acceptance remain open.
This does not complete A5 or the full C1-C6/M1/D1/U1 contract.

### A5 durable scoped jobs — 4 October 2026 (not promoted)

The maintained-page candidate now queues ID/revision references, claims by
runtime lane with replaceable leases, stages bounded selected-block results and
uses a unique owner-bound approval card. It retains the original assistant rule
revision through review/resume. Binding edits, expired windows and stale source
references invalidate output. Source permissions and write rules are rechecked
before model context is returned and before atomic page/job completion.

Final focused/regression159/159 pass. Producer/provider execution, account model
selection, shared Overnight serialization/budget/ten-run/reflection accounting,
both client selection/consent/status/review UI, scoped @orbyn comments, full
qualification and native acceptance remain open. Details and the next proof
matrix: `docs/reviews/evidence/maintained-pages-contract.md`.
This is not an A5 or whole C1-C6/M1/D1/U1 completion claim.

### A5 hosted consumer and consent/source follow-up — 4 October (not promoted)

The internal consumer now executes bounded hosted HTTP completions on selected
blocks, reserves cost before transmission, stages output and uses guarded atomic
application. Original model provenance survives account removal/switch, with no
hosted fallback from queued account work. Actual connected-device execution is
still unimplemented. Original review consent cannot be weakened after queueing.
Night model work stops at its window while saved patches remain owner/nonce-bound
reviewable in the morning without further inference. Transactional live signals
and durable Study synchronization preserve client re-entry behavior.

209 current regressions, workspace types and production build pass. The four-file
compatible provider guard/key-redaction subset is PR194 on4e0a246f, awaiting full
qualification. Maintained-page service/producer/account/source/UI/undo/Night
integration and native/full gates remain open; see the maintained-pages evidence
matrix. Do not label a target-only paraphrasing consumer a complete maintained
page: explicit authorized fresh source selection and @orbyn workflow are retained.

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

### Per-page work allowance — 5 October 2026 candidate

Maintenance bindings carry a configurable integer token budget between 1,000
and 20,000, defaulting to 20,000 for existing bindings. Each queued run captures
its allowance; changing a binding cancels outstanding work and affects only
fresh runs. Older update payloads preserve the existing allowance. Both clients
expose the setting, and Overnight's aggregate budget remains an additional cap.
Focused tests and native desktop form evidence are recorded in the review
handoff; private page execution, complete platform acceptance and exact-commit
qualification remain required. This does not complete C5 or U1.

### Private maintained-page execution — 5 October 2026 candidate

Candidate e277bcf8 adds a genuine page-owned private inference transport, tied to
its parent lease and captured source/provider/model revisions. It retains separate
Background/Overnight lanes and requires a signed output-limit capability for
budgeted ChatGPT assignments. Confirmed undispatched device loss restores the
reservation and requeues the same durable operation; an existing inference
operation prevents refund/retry. Parent cancellation and stale source/model/choice
reject signed output. Overnight charges only its parent reservation.

Direct private-page checks8/8 and combined checks81/81 pass with no skips;
all workspace types and production build pass. Lock-order and terminal-state
defects discovered by direct tests are corrected, with regressions retained.
This is committed and pushed on the implementation branch, not merged to main.
Full exact-head/CI qualification, real positive OpenAI inference, native/mobile
acceptance and all other C1–C6/M1/D1/U1 requirements remain open. Agenda briefs
still need owner/source-aware routing. No deployment or cleanup is claimed.

### Agenda Study source safety — 5 October 2026 candidate

AI briefs consume a separate Study snapshot. Counts and upcoming exam titles
exclude AI-disabled projects, revoked team consent, inaccessible/deleted pages
and excluded original card sources. Exam readiness is calculated from permitted
cards, and the stored exam association is checked even if the ordinary overview
already omitted a deck. Original page identities/revisions are retained and
rechecked before dispatch and acceptance. A failed snapshot leaves the ordinary
agenda available without substituting its unrestricted Study facts.

Focused Agenda/source/facts checks26/26 pass without skips; all workspace types
and production build pass. This is a candidate checkpoint, not main delivery or
complete private Agenda routing. Tasks, calendar events, habits and computed
facts still need retained current authority, and durable app-session versus
scheduled authorization remains required. Selected ChatGPT Agenda still returns
no AI brief rather than silently invoking a managed provider.

Frozen82f5f20e CI passed all jobs, but fresh full local qualification ended
2775/2776 pass, one failure, zero skips. Its presence test's sixty-poll batch
took about13 seconds and changed the row beyond the10-second grace interval.
The unchanged assistant-run suite is being rechecked; no assertions, timeouts,
database settings or production interval have been relaxed. Do not promote the
candidate on the basis of CI alone. Whole C1–C6/M1/D1/U1 acceptance remains open.

### Agenda fact authority — 5 October 2026 candidate

Briefs reread the actual owner's current AI-visible day rather than accepting
caller-supplied day facts. Task/event/time-block reads and derived busy intervals
honor project exclusions and team AI consent. When excluded busy sources change
available time, omit the AI availability total instead of advertising occupied
time as free; the ordinary calendar retains its full schedule.

The snapshot is bound to the owner and exact capture time. It retains original
task/page revisions, calendar/habit identities, calendar event UIDs/occurrences
and time/habit block revisions. Internal scheduling inputs and preferences are
hashed, never included in the prompt. Rechecking the same captured time before
dispatch and acceptance rejects changes to source access, revisions, feed event
identity/content, habits, placement, Study counts or derived facts. Missing block
revisions fail closed. Task reference checks are batched rather than one query
per task.

Current Agenda/calendar/planner/habit/visibility/neatness checks92/92 pass,
zero skips; all workspace types and production build pass. Prior combined
f1ecc45b qualification completed2811/2811 with zero failures/skips and all four
CI37259956426 jobs passed. This newer source checkpoint still needs exact-head
full/CI qualification. Private Agenda routing remains unfinished: integrate the
captured context with durable transport, app versus scheduled authorization and
visible waiting/recovery behavior. Full provider/native and C1–C6/M1/D1/U1
acceptance remains required. No main merge, deployment or cleanup is claimed.

### Interactive private Agenda checkpoint — 5 October 2026

Interactive Agenda summaries now capture the originating first-party app session,
provider choice, model preference and owned source/fact snapshot in a durable
version4 job. Broker dispatch and receipt acceptance validate that context using
the broker's existing database connection. Modified facts with an unchanged
digest, changed sources/preferences and a revoked app session reject output.
Every request is bounded to512 output tokens. Managed fallback requires explicit
consent and a confirmed admission rejection; stream/unknown failures do not retry.

Accepted jobs retain the actual provider/model, including fallback. The API and
both clients distinguish calendar rewrite success from optional summary failure
and identify the provider of an accepted summary. These messages do not establish
quota or plan-tier information, and Orbyn accepted usage is not whole-account
ChatGPT usage.

Scheduled private Agenda remains unfinished: an interactive app session does not
grant scheduled plan usage. Explicit scheduled permission, persistent waiting and
recovery UI, target/body/source consistency through page application, native visual
acceptance and real positive OpenAI inference remain required. Snapshot rereads
on the same connection do not prove atomic fencing of all source/policy changes.
The complete C1–C6/M1/D1/U1 scope remains active.

### Scheduled private Agenda permission — 5 October 2026

Morning page generation, recent app activity and digest preferences do not imply
permission to use a private ChatGPT plan. A separate first-party setting is off
by default. Granting it requires the current owned connection/device, available
default model, provider-choice/model-preference versions and bounded-inference
capabilities. Permission captures the explicit fallback choice; changing any of
these requires a fresh review. Revocation/re-enable advances permission version
and cannot restore an old job's authority. Portable MCP and plugin capabilities
cannot read or write the setting.

The permission API and capture/revalidation helpers are implemented and have
direct database/CAS/catalog/authorization tests. This does not yet complete
scheduled execution: durable daily parent jobs, stable operation identities,
offline-device deferral, final source/target checks and matching web/mobile
permission/status/recovery controls remain required. Do not expose a scheduling
toggle as working before those runtime paths and native acceptance are verified.

### Scheduled private Agenda controls — candidate, 5 October 2026

Compatibility gate: official SIWC preview excludes max_output_tokens. Production
ChatGPT executors must not advertise bounded inference when that route cannot
enforce the requested hard output budget. Required limits survive adapter
projection and fail before network dispatch; they cannot be silently discarded.
Bounded private scheduling therefore remains ineligible on that route, with
explicitly consented managed fallback separately subject to its own budget.
See ../reviews/evidence/chatgpt-hard-output-budget.md for the scoped repair.

Scheduled ChatGPT use requires explicit versioned permission independent of digest
emails and interactive app requests. A durable daily parent owns the target
summary paragraph, captured sources, provider/model choice, stable operation and
morning deadline. An offline undisclosed operation can wait; a device-claimed or
unknown operation is not replayed. Human Notes remain intact, while changed target
text, source facts, account/model selection or revoked permission stop acceptance.

Web/desktop and mobile Settings now have matching candidate permission/status
controls. GET /ai/agenda/private-summary exposes only the live owner's run
metadata, never captured facts, permission context or credentials, and is excluded
from plugin/MCP credentials. Status includes its local date so yesterday's result
cannot be mistaken for today's. The UI requires a reviewed selected ChatGPT model;
stale permission needs review and revoke remains available when a device is gone.

Controlled runtime8/8, status/permission routes7/7 and shared status2/2 pass with
zero skips; all workspace types pass. The source-change regression retains its409
assertion after correcting the previously generic error. Build, expanded recovery/
atomic source fencing, actual positive provider completion and native/visual
acceptance remain open. This candidate is uncommitted and not on main. Full
C1–C6/M1/D1/U1 remains incomplete.

## Preserved candidate history before main integration

### Historical candidate delivery state — 5 October 2026

This table supersedes historical checkpoint descriptions below; the complete
C1–C6/M1/D1/U1 acceptance contract remains in force.

| Priority                    | Current state                                                                                                                                                                                                                                                                                    | Next acceptance gate                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery and main promotion | PR #196 merged as `e0a432a5`. Migration recovery PR #198 is on main as `f816675b`; its full CI remains pending. Fresh full local suite: 2,842/2,842 pass. CI 37273639006: all four jobs pass; backend 2,841 pass and one existing Tesseract skip. Earlier intermittent failures remain recorded. | Qualify each subsequent candidate before promotion. User deploys main manually.                                                                                       |
| ChatGPT execution and usage | Official connection/catalog, provider choice/fallback and measured completed-call usage are merged. Real inference previously reported a subscription-sharing usage limit.                                                                                                                       | Real nonempty completed inference and client acceptance. Account tier, quota and reset times remain unverified.                                                       |
| Scheduled Agenda            | Separate committed runtime candidate and matching Settings controls, integrated with main without conflict. Producer/capacity/permission/catalog cohort: 37/37. Study transaction repair and Agenda cohort: 36/36. Final-write expiry regression passes.                                         | Final NOWAIT page-lock regression, full candidate qualification and native/visual inspection. Current SIWC cannot enable scheduling that requires hard output limits. |

Both signed inference and hard-limit capabilities are required for scheduled
execution. Authentication or a model list does not establish budget enforcement.
Migration 239's eighteen-table source fencing passed the 60-case combined cohort;
the final application cohort passed 17/17 before the later NOWAIT change. That
change has four pure cases but its new PostgreSQL regression is unexecuted while
the test container is stopped. It must not be treated as qualified yet.
User/character changes and unrelated candidates remain preserved. No deployment
or cleanup occurred. Current evidence is recorded in
[the implementation handoff](../reviews/task.md#latest-qualification-and-top-three-work).

### Qualified October 5 checkpoints and remaining P1 execution

Main2f4108d7 now contains the source-dialog focus fix (PR202) and bounded,
independently authenticated plugin launch context (PR201), each qualified by all
four CI jobs. Their component/HTTP evidence does not establish browser/native
visual acceptance or external host delivery. Main03c605e2 earlier improved the
automatic desktop handoff for web/mobile ChatGPT connection requests.

Managed plugin inference remains a candidate: explicit owner consent must bind
provider revision/model and both allowances; durable receipts retain dispatched
unknown outcomes without retry, and personal ChatGPT credentials/transports remain
excluded. The implemented consent/storage foundation is not an enabled inference
feature. Complete the broker, both client controls and runtime/security acceptance
before promoting it. The full C1-C6/M1/D1/U1 contract remains unchanged and open.

### P1 managed plugin inference candidate — 5 October 2026

Committed bdefc9cf (PR203) implements the separate plugin worker and provider
broker, default-off owner consent, provider/model revision pinning, per-call
output and UTC daily limits, durable operation receipts, private reconnect events,
and matching web/desktop/mobile permission controls. Personal ChatGPT transports
and first-party runtime slots are excluded. Unknown/interrupted provider outcomes
retain their allowance reservation and never replay; queued revocation is recorded
as known undispatched. Current OAuth audience, owner/client/token/team authority,
consent and provider revision are fenced at dispatch and result acceptance.

Policy/consent/launch/cursor checks26/26 and component interactions8/8 pass;
workspace types pass. Ten new database broker cases await exact-head CI.
The preceding f271dd0e CI failed on two fixed-clock runtime fixtures and missing
route inventory entries; repairs preserve all capacity/shield assertions.
Browser inspection remains rejected by the saved site permission; native visual
acceptance and external host delivery remain outstanding. This is candidate
implementation, not P1 or full ADR completion. Merge only after qualification.

### Fixed retention main checkpoint — 5 October 2026

Main689a15a4 is pushed: fixed retention uses each rule's declared duration,
with7/7 sweeper regression/security/concurrency cases passing. The channel
cohort passes104/104 without failures/skips. Candidate connection controls,
rotation/reply/Teams work and exact-head/native/real acceptance remain separate.
See evidence/agent-channels.md for retained failures and current evidence.
Full C1–C6/M1/D1/U1 remains active; deployment remains user-run.

### Canonical Slack bot ownership — implemented candidate, 6 October 2026

A Slack bot credential belongs to its app/workspace/bot installation. Orbyn
owner mappings bind a verified Slack actor and independently reviewed scope/DM
permission to that credential; the credential must not be rotated independently
for each actor. This does not give one Orbyn owner access to another owner's
mapping, source data or replies.

Implementation order:

1. Introduce a server-only encrypted bot vault keyed by app/workspace/bot, with
   one durable refresh claim and token pair. Preserve verified installer
   provenance separately from the DM recipient actor.
2. Bind owner mappings to that vault through an exact namespace reference and
   reviewed scope revision. OAuth confirmation remains same-session and exact
   actor/scopes/version; connecting another owner cannot change existing DM
   permission or expand an existing owner's reviewed scope.
3. Read/send with the live owner mapping and canonical credential under both
   consent/source and credential guards. Recipient actor comes only from the
   owner's verified mapping; it is never the vault's original installer actor.
4. Rotate only the canonical pair. Concurrent workers/owners redeem once;
   unknown completion is not replayed. Publication cannot resurrect revoked
   mappings or DM consent. Scope drift requires renewed per-owner review.
5. Unlink only the requesting owner. Other explicitly linked owners retain
   their installation. Erase the vault credential when no authorized mapping
   remains; do not uninstall the shared provider app.
6. Upgrade existing candidate mappings without guessing through uncertain
   refresh claims. Preserve pending/unknown evidence, and require explicit
   reconnect where the credential/mapping cannot be proven live.
7. Qualify three owners in one workspace, concurrent rotation/delivery,
   disconnect during send/refresh, scope/actor change, last-owner cleanup,
   cross-owner metadata/refusals and cold pool1 operation. Then implement
   durable exact-card signed replies and Teams using the same authority model.

Steps1–6 are now implemented in the canonical-vault candidate. Step7 has
137 latest-source integrated passing checks; full/CI qualification and external/native/visual acceptance remains open. Continue durable
exact-card signed replies and Teams. This checkpoint does not complete A6 or
the full ADR; prior owner-pair evidence remains historical only.

### Signed question replies — candidate, 6 October 2026

Canonical vault checkpoint d9225450 completed its immutable full local suite:
3064 passes, zero failures, one existing Tesseract skip. It is pushed separately;
no channel source is promoted to main yet.

Slack question cards bind all displayed question/choice contents, the exact sent
message and waiting ID, reviewed owner/connection revision and a 15-minute expiry.
Options use signed button callbacks; free text uses the exact message thread and
requires reviewed im:history scope. Unsupported message input blocks are not used.
Unrelated/bot/edited/deleted/unthreaded messages cannot answer a question. Approvals
continue through the full owned Orbyn review; this is not standing permission.

A bounded provider acknowledgement follows encrypted durable receipt capture.
The notifier rechecks current source/grant/owner/consent/configuration and commits
the answer, chat history and accepted receipt together. Lost claim recovery cannot
replay a committed answer. Consumed/refused answer content is cleared; expired
pending content is swept even with Slack disabled, and terminal receipts last14days.

Focused qualification passes26 database/outbox cases and27 protocol cases; the
new HTTP fixture initially omitted createService's module list (2 failures), then
passed2/2 after repair without weakening assertions. Earlier DB diagnostics tried
to revoke the nonrevocable assistant grant and hung on an incompatible pool mock;
these were replaced with legal suspension and an actual test-DB rollback trigger.
Combined qualification, CI, real workspace callbacks, native/visual controls,
Teams and the full C1–C6/M1/D1/U1 contract remain open. Deployment remains user-run.

Latest combined focused qualification passes64/64 integrated database cases,
12/12 single-connection reply cases, and41/41 protocol/HTTP/gateway/privacy cases.
All workspace types, backend build and whole format check pass. Full/CI and
external/native/visual acceptance still precede production promotion; earlier
diagnostic failures are retained in evidence/agent-channels.md. The complete
ADR goal remains active.

Immutable signed-reply checkpoint3d163bcd now has a terminal full local suite:
3089passes, zero failures, one existing Tesseract skip (3090total). Application,
migration and test source stayed unchanged during qualification. CI and external/
client acceptance remain distinct gates; Teams and the full ADR remain open.

### Teams provider authentication foundation — candidate, 6 October 2026

The separate Teams adapter now has a tested Bot Connector JWT boundary: exact
bot audience/issuer/RS256/time, Teams key endorsement, recipient and signed service
URL matching, fixed bounded Microsoft key discovery and restricted credential
destinations. Eleven pure tests and backend types pass. No Teams public route,
user OAuth mapping, installed conversation, DM delivery or client controls are
mounted yet. Service JWT authentication never authorizes an Orbyn owner link.
See evidence/teams-agent-channels.md for primary contracts, retained diagnostics
and the full installation/delivery/reply/client/retention acceptance pipeline.
The Slack3d163bcd source remains immutable during full-suite qualification.
All A6 and broader C1–C6/M1/D1/U1 requirements remain active.

### Teams identity capture and review — candidate, 6 October 2026

Session-bound organizational OAuth and encrypted ten-minute capture now have
strict verified tenant/object identity, one-redemption claims, original-session
review, revision/configuration fencing and cross-owner uniqueness. Review creates
a one-use personal-conversation challenge and leaves DMs off. Fixed sweeps and
Privacy text cover the new temporary identity data. Pure protocol cases21/21,
integrated database cases37/37 and latest cold-pool account cases12/12 pass.
No public route, conversation binding, bot credential transport, Teams delivery
or client controls are mounted. The complete implementation and external/native
acceptance pipeline remains in evidence/teams-agent-channels.md. SlackPR204 is
merged on main690f6246 after all four CI jobs passed; deployment is user-run.
All C1–C6/M1/D1/U1 requirements remain active and the full goal is incomplete.

### Teams personal conversation proof — candidate, 6 October 2026

A Connector-authenticated personal message can now consume the reviewed
tenant/user's one-use linking challenge. Encrypted conversation storage and
revision advancement are atomic; current owner/configuration/expiry/disconnect
checks refuse stale or wrong recipients. Linking leaves DMs off. Sixteen cold-pool
database cases pass, including real signed activities and concurrent replay.
This service remains unmounted; transport, delivery, replies, client controls and
external/native/visual acceptance remain open. Full ADR goal remains active.

### Teams HTTP identity controls — candidate, 6 October 2026

Optional API status, session-bound OAuth review and disconnect are mounted, with
strict typed contracts available to both clients. Provider codes/state are hidden
from gateway/request logs and proxy retries disabled. Disconnect destroys pending
identity and stored personal-conversation authority. Fifty-eight integrated cases
and17 cold-pool account cases pass. Delivery remains explicitly unavailable; no
Teams DM permission/activity endpoint or client UI is mounted. Transport, exact
question replies, both client controls and external/native/visual gates remain
open. This checkpoint does not complete A6 or C1–C6/M1/D1/U1.

### Teams bot transport — candidate, 6 October 2026

A distinct bot-application transport now uses fixed Microsoft token endpoints,
validated public-cloud Connector destinations, bounded plain messages and
process-local credential caches. Unknown send results cannot be replayed;429
returns a bounded scheduling delay. Thirty-one protocol cases pass, including
OAuth and incoming Connector authentication. The transport is unconfigured and
unwired pending durable outbox, authority/race/restart qualification and both
client controls. Real/native/visual acceptance and full C1–C6/M1/D1/U1 remain open.

### Teams durable delivery — candidate, 6 October 2026

A separate revision-bound Teams outbox now rechecks current owner/source/grant
authority through dispatch and preserves unknown outcomes without replay.
Background-only transitions and one generic morning Overnight result stay
separate; fixed receipt retention is defined. Seven cold-pool database cases pass.
Transition/worker hooks, explicit DM opt-in, lifecycle events, commit/race gates,
question replies and client controls remain unmounted. Complete A6 and broader
C1–C6/M1/D1/U1 acceptance remains open.

### Teams lifecycle, delivery and cross-client controls — candidate, 6 October 2026

Transport credentials are independent of Microsoft identity OAuth, ChatGPT and
MCP. Public Connector authentication precedes bounded activity parsing; only the
reviewed tenant/user's personal linking message can prove a conversation. Explicit
DM consent, immutable queued revision, current source/owner/grant visibility and
bot configuration are checked through dispatch. Unknown accepted sends never
replay. Provider uninstall revokes only the current route, with authenticated
message timestamps protecting later personal proof from old removal events.

Web/desktop/mobile share account review, personal linking, expiring in-memory
commands, lost-command recovery, default-off DM controls and disconnect. UUID
restoration alone cannot recover a private command or change ownership. Linking
or reconnecting immediately clears prior messaging permission, including local
UI state if the subsequent status fetch fails. Current pure cases21/21 and
workspace types/backend/web builds pass; prior56 integrated cases pass. Updated
migration/retention, full/CI and real tenant/native/visual qualification remain
required. Teams current-card replies remain unimplemented. Identity PR205's
CI fixture repair is being qualified; this delivery/UI candidate is not on main.
The complete C1–C6/M1/D1/U1 scope remains open and deployment remains user-run.

### Durable Teams question replies — candidate, 6 October 2026

Exact-card replies now have a sent-card nonce/digest/expiry, encrypted durable
capture, independently rechecked current authority, and an atomic answer/chat/
receipt consumer on the candidate branch. Automatic or unrelated activity does
not answer; approval remains in Orbyn. Fixed expiry is independent of transport
configuration. Cold testing also repairs the sweeper to reuse its held advisory
lock connection instead of requiring a second pool checkout. Current focused
channel/sweep/cold cases pass; full immutable qualification, CI and promotion
remain required. See [Teams evidence](../reviews/evidence/teams-agent-channels.md).
This does not close C6, D1, U1 or the full ADR scope.

### ChatGPT connection correction — 6 October 2026

**User requirement:** one-button ChatGPT-plan authorization from web, desktop,
iOS and Android; web/mobile must not silently wait for an open desktop app.
No pre-issued client ID, client secret or workspace API key is required for
initial OSS dynamic registration. This supersedes the earlier claim that a
website client ID is the prerequisite for the user's requested OSS flow.

The current web/mobile implementation is a desktop handoff, not direct sign-in:
`ChatgptRemoteModels` and `ChatgptModelsSection` create a connect-request and poll
until the desktop runtime claims it. Neither opens provider authorization itself.
Changing its label or opening an unbacked popup does not fulfill this requirement.

Authoritative sources inspected on 6 October 2026:

- [OSS registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): initial `dynamic_agent_client`, a stable `ext_agent_host_id`, fresh state/nonce/PKCE, a listening HTTP callback on `127.0.0.1`, then the issued client ID for exchange and future authorization.
- [SIWC Terms, 29 September 2026](https://openai.com/policies/sign-in-with-chatgpt-terms/): persistent authentication tokens must remain local and under the user's control; requests originate from the user's local runtime or a remote runtime only that user controls.
- [Quickstart](https://developers.openai.com/siwc/quickstart) and [website identity flow](https://developers.openai.com/siwc/website): registered website identity sign-in is a separate flow and does not itself prove ChatGPT-plan authorization.
- [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms): the browser's loopback callback reaches its local device, not the remote server. This is not a documented direct browser OAuth callback.
- [SDK cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt): its React button invokes the local main-process SDK; the example does not demonstrate browser-only dynamic registration.

| Surface                             | Required implementation                                                                                                                                                                                                           | Completion evidence still needed                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop                             | Keep direct OSS authorization, local protected credentials, returned issued-client binding and user-plan inference.                                                                                                               | Real completed eligible inference; existing quota failures are not success or plan-tier evidence.                                                                                          |
| Native iOS/Android                  | Own local callback listener, system authorization browser, protected local credential lifecycle and native executor. Do not require a laptop or reuse its registration implicitly.                                                | Built native modules, callback/cancel/restart tests, secure storage, ownership and real device/simulator end-to-end acceptance. Expo Go alone cannot prove a custom native listener works. |
| Hosted web/mobile web               | Find a supported direct authorization/runtime mechanism that fulfills the user's no-desktop requirement. Browser JavaScript cannot bind an HTTP listening socket, so a popup alone cannot implement the documented loopback flow. | Official supported browser mechanism, callback completion and user-controlled token/runtime proof. This remains unmet; do not substitute a desktop queue and call it complete.             |
| User-controlled self-hosted runtime | May be investigated as an additional option using the documented VM procedure.                                                                                                                                                    | Explicit runtime ownership and credential handling; it does not automatically close the hosted-web requirement.                                                                            |

Implementation order: direct native runtime and common authorization lifecycle;
resolve hosted-browser transport against official supported mechanisms; unify
one-button feedback, models/defaults, explicit fallback and usage controls; then
real cross-platform acceptance. Keep MCP/plugin grants separate. Preserve the
original complete ADR scope. No server-side persistent SIWC token store, account
pooling, invented provider approval flag, blind custom-scheme launch or false
"Connected" state is an acceptable shortcut.

This correction records an implementation gap, not a shipped fix. No code or
real-account acceptance was completed by the documentation change.

#### Native callback implementation candidate

A device-local iOS/Android Expo callback module and shared OSS authorization/
callback contracts are implemented on `codex/chatgpt-direct-web-oauth`. Real
loopback socket fixtures pass on macOS/JVM, and Swift compiles against the iOS
simulator SDK. This proves the callback primitives only. Native OS browser
lifecycle, protected token lifecycle, provider executor and settings integration,
installed native builds and real-account acceptance remain incomplete. The
hosted web requirement remains open; no desktop handoff is relabeled direct.

#### Native sign-in and local-token lifecycle candidate

The candidate native service now runs its own callback/browser/exchange path,
verifies first-party ownership and the backend's exact nonce-bound ID proof,
and installs credentials only in device-protected storage. Portable token
exchange/refresh and cancellation tests pass; a returned scope is permission,
not plan-tier or account-wide quota evidence. Settings remain unactivated until
native build/browser acceptance, renewable verified credentials, native executor
and model/provider integration are complete. Candidate tests/mock secure storage
are not a claim of installed native or full cross-platform completion.

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

### Native targeted account cleanup checkpoint — 6 October 2026

Specific saved-account cleanup is now revision-bound and exposed through the
account MoreMenu. Fresh owner/slot/active-or-retired identity checks reject stale
or substituted targets. Inactive cleanup/retry preserves active credentials and
selection. Full ChatGPT unit cohort427passed/0failed/0skipped,31658.248708ms,
terminal0; mobile/backend types and formatting/diff checks pass. Detailed cases
and logs are in `docs/reviews/task.md`, Native targeted cleanup. This is a candidate
checkpoint; real OS/OAuth, authenticated UI screenshots, read-fault/default/provider
acceptance, fresh full DB and main qualification remain open. Full scope unchanged.

### Native protected read-fault checkpoint — 6 October 2026

Protected storage failures are sanitized before diagnostics. Failed credential
reads remain unreadable rather than missing; execution and cleanup reject without
inventing identity or removal. Retry after storage becomes readable is covered.
Final ChatGPT unit cohort429passed/0failed/0skipped,26675.095583ms, exit0;
mobile typecheck and formatting/diff checks pass. See task handoff for exact tests
and logs. Candidate only: model/default/provider provenance, real OS/OAuth/UI,
full database and main promotion remain open. Full ADR scope is unchanged.

### Native inference cancellation compatibility — 6 October 2026

Runtime audit reproduced a React Native TypeError in ChatGPT executor startup:
AbortSignal.throwIfAborted is absent. The existing portable helper now guards
shared executor, provider request/stream and native transport cancellation.
Actual native factory with React Native signals completes mocked inference and
rejects pre-cancelled work without a second provider request. Full ChatGPT unit
cohort430passed/0failed/0skipped,28700.67175ms,exit0; package build and mobile/
desktop types pass. See task handoff for baseline/final logs. Candidate only;
real OAuth/installed acceptance, full database/main qualification and complete
model/default/provider audit remain pending. Original full scope is retained.

### Provider settings recovery promoted to main — 6 October 2026

Web/desktop and mobile provider controls now reload on same-user session changes
and serialize rapid writes before rerender. Existing saved-device/fallback semantics
are preserved. Baseline tests reproduce both faults on both clients; candidate
ChatGPT434passed/0failed/0skipped and both client types pass. Scoped main checkpoint
7c693b48 is pushed; candidate reconciled main without conflicts. Main focused tests,
shared package build and desktop types pass; mobile types pass with temporary
same-version WebView declaration mapping, while normal local installation remains
incomplete. No production deployment or native OAuth qualification is claimed.
Detailed logs and limitations are in task handoff; full ADR scope remains open.

### Provider-save confirmation checkpoint on main — 6 October 2026

Provider controls now verify reply identity/device/primary/fallback and exact next
version, invalidate failed/conflicting revisions and fence retained callbacks until
reload. Both apps test mismatched receipts, recovery and valid sequential saves.
Scoped checkpointbaf9e56c pushed to main; candidate reconciled main without conflict.
Candidate ChatGPT438unit tests pass; main focused12pass, desktop types and mobile
types with documented existing WebView mapping pass. Detailed baseline/final logs
and qualification limits are in task handoff. Full native OAuth/OS/UI, database and
remaining ADR acceptance stay open; no production deployment is claimed.

### Catalog readiness and provider-choice UX on main — 6 October 2026

Web/desktop and mobile only offer a provider selection when its catalog is ready,
not saving, has plan inference capability, and retains an available default model.
Loading/offline/stale/unavailable/no-default states remain inspectable without
sending a predictably invalid provider save. Concise guidance explains the next
selection. Main checkpoint9e22e531 pushed and candidate reconciled without conflict.
Candidate440ChatGPTunit tests pass; main23focused pass and client types pass with
documented main mobile WebView mapping. Evidence and limits are in task handoff;
visual/real OAuth/native/full database and complete ADR acceptance remain open.

### Native compound account-switch provenance acceptance test — 6 October 2026

Actual service/executor composition now tests distinct account tokens/enrollments,
old in-flight cancellation, preserved credential slots/signing aliases, replacement
catalog and signed receipt binding, and late old response exclusion. Focused94 and
full ChatGPT441unit tests pass,zero failures/skips. Candidate test-only evidence;
no real OAuth/OS/DB qualification or broad native main promotion. Source audit
reconfirmed immutable provider-choice and durable request/model authority guards.
Full ADR scope remains open; detailed evidence and runtime blockers are in handoff.

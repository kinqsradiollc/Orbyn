# Web client rebuild

A new web client in `web/`, written from scratch to replace `desktop/`. No code is
copied from `desktop/`, which stays the behavior reference until cutover. Shared
`@orbyn/core` and `@orbyn/api-client` stay. This work is in progress and unfinished. The local preview uses
`http://localhost:5175`; deployment and packaged-client cutover remain out of scope.

The rebuild has no copied presentation: every screen is new markup and CSS on the kit
in `web/src/ui`. Macro was a design reference only. It is AGPL-3.0 and Orbyn is MIT, so
no Macro code, tokens or assets are used.

## State

Built: Today, Work, Lists, Projects, Views, Notifications, Calendar with the 3D Planner,
sign-in, terms and email gates, landing, legal, security, status, changelog, recovery.

Built with the scoped interaction checks recorded below: Library with its editors,
Daily brief and Study. The consolidated runtime checks and all seven required checkpoint source gates
have passed. Final all-route visual sweeps and the
explicit remaining permission/provider limits are separate from this checkpoint.

Agents implementation and scoped qualification are complete: Assistant, Background,
Overnight and Review now use the shared conversation, decision, character and
settings components. Scoped runtime evidence is recorded below, including the rollout-off chat fallback.
All seven required checkpoint source/build gates passed. This group is committed
locally as `abc3cdd7`. Settings scoped qualification is complete, as recorded below.

Teams, Booking, OAuth consent and public booking pages have completed their scoped
Stage 5 interaction checks and all seven required checkpoint gates, as recorded
below. Real local Booking evidence covers queued mail and the confirmation,
approval and cancellation lifecycle, with no SMTP delivery. Admin/Developers and
Settings have their scoped qualification and local checkpoint commits. Settings
includes its modal and all six categories, ChatGPT and legacy aliases. Stage 6
retained shell integration has completed its scoped qualification and checkpoint
checks. Stage 7 parity closure, external delivery/provider limits and the final
whole-client checks remain open.

## How to run

    docker compose up -d postgres mailpit
    npm run migrate
    APP_URL=http://localhost:5175 PORT=8008 npm run dev:api
    API_PROXY_URL=http://127.0.0.1:8008 npm run dev -w web -- --host 127.0.0.1 --port 5175 --strictPort

## Parity gaps

Every capability of `desktop/` must exist in `web/` before cutover. This inventory
includes implemented but unverified flows and historical items still awaiting
receipt reconciliation; each remains open until its current evidence is recorded.

From Work and Lists:

- Task transfer is implemented. Native Work-to-page, Work/Lists-to-Calendar and
  Work-to-3D timed/day drops pass with real API readback and cleanup. Native Board
  column moves and manual arrows/drag/reload also pass. Keyboard Schedule and
  adverse transfer variants remain to qualify.
- Task completion uses the confirmation toast with Undo. The user explicitly
  approved this replacement for the celebration effect on 1 November 2026.
- Focus: custom rhythms, sound and notifications, and picking up a session running on another device.
- Rich block Peek is implemented. Native heading/code/table/math/diagram/nested
  rendering has been observed; complete read-only controls, files and recovery
  qualification remain in progress.
- Shared exact task filters and planned Today are implemented with SQL/API
  coverage. Native blocked/high/no-estimate Save, View reload and CSV membership
  are verified; the other dimensions, consumers and recovery cases remain open.
- Quick line loads team members on first mention intent. Native ambiguity,
  account changes and complete real-API retry coverage still need reconciliation.
- Native Board status/priority changes and bulk Done/Undo pass bounded real-API
  checks. Repeating-task scope Cancel, This and later Following title edits also
  pass, as do native This/Following deletions and deletion Cancel. Other bulk
  mutations, team-only flows and adverse recurrence recovery remain to qualify.
  Focus, Peek and Save as view have bounded
  evidence below; their unexercised variants remain open.

Cross-screen wiring:

- Calendar reads ?plan=<itemId> and ?date=YYYY-MM-DD.
- Assistant reads ?task=<id>.
- Library honours #blockId on /app/doc/:id.
- Command-bar keyboard/modified-click Peek and full-text results pass native
  draft/URL/tab/focus checks; explicit background-tab opening remains separate.
  Object-link callers still need their final compatibility reconciliation.

From Calendar, built but not exercised:

- Plan: pin by dragging a proposal, estimate editing, What if, experiments, roll forward, stale banner.
- Alt-drag copy, dropping a task from the rail, touch drag on a phone.
- Rollback for an event move.
- Manage tabs: create, edit, delete for sets, subscriptions, feeds, frames, habits.
- Teammates overlay with people selected. Focus handover between devices. Find time with a task that needs time.
- Week starts Monday in every mode. The user confirmed this rule on 1 November 2026.

Shell parity:

- Tabs, splits, dock hide/show, independent scrolling, sidebar resizing and grouped
  phone navigation have scoped Stage 6 runtime evidence below. Retained drafts,
  cancelled departures and account gates are included. Final route and viewport
  compatibility remain part of whole-client acceptance.
- Page commands, pins/filters, sidebar slots, update feedback, shortcut sheet and
  custom shortcuts are implemented. Command search and workspace keyboard actions
  have native checks; preference uncertainty and shortcut collision/Reset have
  controlled checks. Remaining combinations need final receipt reconciliation.
- Sidebar arrangement/rail mode, live reconnect, Activity, the update banner and
  announcement/maintenance/email gate combinations retain their final parity
  reconciliation requirement.
- Global FirstRun, What's new and pinned notifications are mounted. Presence of
  those owners does not establish fresh-account onboarding or every overlay flow.

From Today, Projects, Views, Notifications:

- Character and CharacterEditor are implemented. Identity save/restoration and
  still previews have scoped Stage 2 evidence; final Today/Browse entry paths
  remain to reconcile.
- Shared ProposalReview is implemented and has controlled stale, partial and
  unknown-result checks. Project entry and real proposal application remain
  separately unqualified; provider execution is outside the configured local stack.
  The former AssistantAgents dialog-to-links replacement still needs its final
  capability comparison.
- Project link drafts register the shared departure guard. Cross-route and
  unknown-write project recovery still need their final acceptance receipts.
- Shared view refinements now reach authoritative definitions, bounded filtering and CSV. Remaining dimensions, consumers, permissions and recovery need their final qualification; private pins must not be silently promoted.
- First run: final step unverified on a fresh account; preset application unverified.
- Mock-only: Notifications actions, 409 move retry, session check-ins. Not exercised: project assistant drafting, file import, cover upload, claiming, promises, asks, agent questions, welcome back, 3D relation map node open.
- Global shell owners are implemented as recorded above; final unread-badge,
  pinned-view and overlay combinations still need receipt reconciliation.
- Assistant must read ?chat= ?project= ?ask= ?panel=upcoming ?conversation=&entry= ; Booking ?open= ; Teams ?team=.
- Project page makes 29 requests on load; rate limiter trips under rapid navigation.

## Cutover

Not started. Before removing `desktop/`: move the behavior covered by the backend tests
that import `desktop/src`, point Electron and the web image at `web/`, and restore the
homepage prerender and the desktop config output.

## Continuation — 1 November 2026

Resumed from clean `feat/web-rebuild` at `b5299bec09ced73ed59df1b42ec018fc638ba9c2`.
The requested end state remains complete desktop capability parity in a newly
authored `web/`, with all route families exercised in light, dark and phone.
No push, PR, merge, deployment, desktop removal or cutover is authorized.

The lead owns shared components, shell integration, Library and the sole local
browser/API verification session. A separate worker owns Brief and Study fixes;
another is preparing a read-only Agents capability inventory. Shared files and
database/browser activity are serialized. Step 1 is still being verified; earlier
rendered or mocked checks do not qualify unexercised flows.

Week-start decision: Monday in Flat, List and 3D is explicitly approved. The local
empty/new demo accounts may accept the current terms for onboarding verification;
this does not authorize account creation or consent in production.

### Library, Brief and Study verification in progress

Local consent was completed through the real terms gate for `empty@orbyn.local`
and `new@orbyn.local`, as explicitly approved. Both current terms versions and
unchanged analytics preferences were read back from the local API. This verifies
consent only; the remaining fresh-account onboarding flow is still pending.

The Library CRUD run passed 13/13 checks, and the rich-page run passed 20/20:
folder filing, search, favorites, archive/restore, Trash/restore, block deep links,
math/diagram/code/table rendering, selection comments, publication create/revoke,
templates, presenter, page-update/merge dialogs and icon saving. Dialog presence
and an export invocation do not qualify their full mutation/export contracts.
The rich-page screenshot was inspected. Anonymous publication contents, advanced
link authoring, files, recovery and all theme/phone variants remain separate gates.

Implemented repairs include queued Library refreshes that coalesce a write with
its live notification, explicit heading links/section embeds, keyboard callout
folding, linked-object details/actions, independently retryable metadata failures,
retained maintenance drafts with valid future schedules, recording resource and
upload recovery, and safer Study/Brief lifetimes. Session generations fence editor
saves across account changes, including a batched sign-out/return; recovery now
retains invalid raw Markdown source as well as parsed document drafts. These
source changes are not a claim that every adverse runtime case has passed yet.

Study's real local API checks have exercised manual cards, Again requeueing and
failed-rating retention followed by a successful Good retry. Quiz typing/reveal
was exercised without submitting a model request. Those screenshots were inspected.
Earlier harness failures, rate-limit responses and a development hot-reload failure
are retained privately; they are not counted as passing full Brief/Study runs.
The sole browser run is now serialized after package builds, which restart the
local development API and can invalidate an already-open Vite module graph.

The local file store and converter are now enabled with task-private generated
keys and task-owned directories, so actual attachment/import paths can be tested.
No AI provider has been configured or called. Physical microphone, provider-backed
summaries and production behavior remain unqualified.

Additional real local checks now passed:

- Account/editor recovery: a paced account run exercised late sign-in receipts,
  retry, same-token refresh, batched sign-out/return, authoritative denial and
  member-only draft persistence. The final raw-source UI defect was then fixed
  and its isolated 13/13 round-trip checks passed. A separate 40/40 adverse run
  verified fresh authority for a pending same-account return, blocked recovery
  after a remote change, retained failed merges and exact downloadable copies.
- Terms-gate lifetime: 7/7 checks with explicitly synthetic held receipts showed
  that an old consent form cannot change the next account's analytics preference.
  Both approved accounts' real consent and privacy values remained unchanged.
- Editor writing: 25/25 checks passed across structured and legacy formats,
  paragraph split/merge, slash blocks, styling, links, paste, nesting, manual
  suggestion acceptance, comments, history restore, Markdown edits and resizing.
- Heading/date authoring passed its first 11 checks. A later section-embed test
  exposed a delayed caret reset; applying selection with controlled text before
  paint fixed it. The isolated embed/callout run passed 10/10, including immediate
  typing, real section references and keyboard folding with correct block paths.
- Linked-object details passed 16/16 checks after fixing focus return: actual task
  opening, completion, failed deadline retention/retry with preserved clock,
  clearing a deadline and opening/creating meeting notes. No visible viewer-team
  fixture was found among the sampled tasks, so read-only Details remains an
  explicit later permission check.
- Study/Brief core checks exercised manual cards, Again, failed rating/retry,
  quiz reveal, immediate Brief navigation/save, embedded Trash and Undo. The
  separate import-list failure/pending-upload/cancel run passed 3/3 with a real
  pending row and bytes intentionally held by the harness. A prior combined run's
  final import assertion failed because its interceptor matched the wrong path;
  that failed evidence is retained and is not presented as a passing whole run.
- Image/file attachment persistence passed 3/3. The initially unavailable PDF/HTML
  renderer was subsequently configured locally. Actual API exports for Markdown,
  Word, PDF and portable HTML all returned 200; ZIP/XML and PDF text were checked
  and the PDF page was visually inspected. Math, Unicode and the diagram rendered.
  The existing sandboxed LaTeX Docker target was built and run with its original
  isolation/resource guards; real compilation returned a PDF with expected text.

The local PDF renderer launches Chrome, so its artifact requests are serialized
outside the sole headless UI browser. The LaTeX service uses the Linux sandboxed
compiler and does not launch a browser. These are local development qualifications,
not production deployment or provider execution. Compiled LaTeX UI lifecycle,
maintenance, recording, deeper sharing and remaining permission/phone/theme checks
are still being exercised. Unapplied LaTeX source now blocks format replacement
and offers a source-copy/discard path; global pane departure and account-switch
recovery of an unapplied source are still part of the later shell audit.

Further local findings and checks:

- The Library refresh scheduler passed a clean 6/6 real SSE burst run: three
  remote writes converged with one seven-resource graph per five-second window
  and one bounded follow-up. Explicit refresh passed 11/11 delayed-response
  checks: it bypasses the passive cooldown, rejects a pre-write snapshot and
  settles both waiting callers only after the fresh graph. Earlier false failures
  from a stale Vite hot-reload module instance are retained separately.
- Source review found late favorite/folder and other collection mutation receipts
  could publish or navigate after the opening account ended. A shared Library
  mounted/account-generation guard now fences those continuations, including the
  merge dialog's awaited version and attachment decoding/upload steps. A local
  favorite receipt also invalidates older reads before publishing its patch.
  The focused lifetime run passed 18/18: real member favorite and folder writes
  with held receipts could not affect the admin store or navigation; an actual
  MergeDialog with a synthetic deferred version callback issued no merge after
  the account changed. Real source/target versions stayed unchanged. All exact
  fixtures were removed. Route-independent Undo/Open toast actions retain their
  opening account generation without requiring the original view to stay mounted.
- The first interactive LaTeX preview run exposed a real source/result mismatch:
  the selected embedded note's source was shown beside a whole-page placeholder.
  The preview is now fed the selected source, including pending raw input, rather
  than whole-page TeX. The rerun passed 21/21 behavioral assertions: actual math,
  malformed-source last-good recovery, rapid edits, theme/font-scale changes,
  phone Preview, frame/nonce/ticket guards, sanitization, local-only CSP denial
  and same-token session-generation replacement. Desktop and phone images were
  inspected. The final rerun passed 21/21 with no unexpected console errors; exact
  local CSP denials remain recorded as deliberate probe evidence.
  An upstream image macro without dimensions throws before sanitization; the
  supported explicit-dimensions fixture qualified active-resource removal. Real
  sandboxed PDF compilation remains separately verified.

The final compiled-LaTeX UI run passed 21/21 with no unexpected console errors:
keyboard save/readback, synthetic compiler failure and real retry/download,
duplicate export prevention, exact oversized-source copy/cancel/discard, and
suppression of a held old-account download all passed. The downloaded PDF's text
was extracted and matched the authored equation. The account-refresh run passed
13/13, including immediate privacy reset, rejected old waiters, same-token setter
and storage-event lifetimes, distinct generic requests and final convergence.

The metadata/file acceptance run passed 40/40 against the local member account:
independent file/quota failures and explicit Retry, quota values, retained alias
input and one persisted retry, real comments, manual suggestion review/application,
file download bytes, owner-versus-reference deletion rules and delete cancellation.
Citation metadata/removal used a clearly synthetic UI fixture; it does not qualify
source creation/persistence. Screenshots of the metadata errors and citation panel
were inspected. All recorded owned pages/files were cleaned.

Page publication passed 16/16 checks for selected snapshots, live updates, omitted
content and revoked anonymous access. Folder publication then passed 26/26:
failed-save retention and retry, actual anonymous child content, noindex headers,
changed address, wrong/correct password, cancelled unpublish and final revocation.
The saved password-controls screenshot was inspected in the light theme. All
exact owned folders, pages and publication fixtures were removed.

Recording passed 21/21 lifecycle checks using synthetic capture with valid silent
WebM bytes: late permission cleanup, denial, recorder construction failure, real
upload, retained bytes after failure, download and a single retried audio block.
Manual transcript persistence was real. Summary generation used an explicitly
mocked response to check one real dated task, duplicate prevention and conflicting
append retention. This does not qualify physical microphone capture or a provider.
The two pages, two files and one task created by that run were removed exactly.

The broader generation pass now covers publication, metadata, linked objects,
comments, maintained-page stores, Brief, link authoring and import continuations.
Import creation that loses its owner leaves the waiting row with that account;
it cannot upload or delete it through the next account. Both delayed global toast
actions and ordinary component callbacks retain their appropriate lifetimes.
These source repairs passed web types; final targeted recovery/live-edit/Brief
reruns are still pending.

The latest required source gates passed: repository formatting, workspace types,
source organization, current-doc links, all 31 GitHub helper tests, web production
build and all 11 week-scene tests. The build retains its large-chunk and ineffective
dynamic-import warnings. This is local source evidence, not completion of the
remaining screen families, full backend suite, publication or deployment.

The default backend suite has since been qualified in two disjoint, serialized
batches against the guarded local `orbyn_test` database and its persisted test
marker: 608 ordinary files passed 5,615 assertions, and 20 renderer files passed
164 assertions. The manifest covers all 628 default `tests/*.test.ts` files at
their recorded hashes, for 5,779 passing assertions. The initial canonical command
was interrupted to separate browser-owning renderer tests; this is complete
default-file coverage, not an uninterrupted `npm test` exit. The first renderer
batch exposed stale generated Mermaid source metadata. Regenerating the backend
and mobile JSON metadata repaired that check without changing the runtime HTML;
the clean renderer rerun passed. Failed/interrupted logs and the final coverage
receipt remain in private local evidence. The disposable test database is stopped.
This does not qualify excluded integration files, a model provider or deployment.

A subsequent bounded source review found that two tabs could overwrite the same
ordinary local recovery key. The repair being qualified gives each editor fresh
immutable snapshots under a versioned, per-editor namespace, while retaining the
existing backup payload and legacy reader. New writers never overwrite or delete
the legacy key. Older clients may keep writing it concurrently; a captured-value
SHA-256 acknowledgement hides only the exact legacy value explicitly handled by
the person. Changed legacy bytes are offered again. A new snapshot is committed
with one storage write before the editor removes only its own older snapshots;
another editor's snapshots are never automatic cleanup targets. Explicit recovery
must establish a durable owned copy or a matching server receipt before retiring
the selected immutable offer. Failed storage leaves the offered original intact.
There is no backfill, conversion or old-writer retirement. An older client can
still read its unchanged legacy record, and new immutable copies remain available
to the new client after a rollback. No deployed-writer adoption or production
cutover is inferred from this local compatibility change.

The repaired source/ordinary decision flow passed 8/8 checks, and source handoff
passed 5/5 with both backup storage and save initially failing: the raw source
remained until a real matching server save completed. A native-storage two-page
run passed its 11 ownership/legacy checks, including failed writes and cleanup,
unchanged foreign bytes, additive acknowledgement, newer legacy bytes and a
delayed SHA-256 result rejected after the session generation changed. Its final UI
case timed out with the editor in a background tab. The corrected isolated UI
run passed 4/4, retaining an offered title and exact backup when the current source
was invalid; the real server document stayed unchanged. The invalid fixture uses
duplicate block anchors verified against the actual projected-source parser.
An intervening browser-startup timeout happened before any fixture creation.
Failed attempts are retained, and exact recorded pages were cleaned. These checks
use synthetic legacy writers and storage faults; no deployed old binary was run.
The multi-copy recovery picker passed 12/12 on a dark 375×812 phone viewport:
selecting the second offer persisted its title and text through the real API;
native storage tracing confirmed the owned handoff preceded retiring that offer.
The other copy stayed byte-for-byte intact until explicit discard, and cancelling
discard preserved it. Reload after saving and discarding offered no stale copies.
The inspected screenshot and measured controls show 44px targets, 16px field text,
15px action text and no outer horizontal overflow. The first phone run's font
assertion mistakenly required 16px action text; the correction follows the agreed
product roles and changed no product code.

The consolidated live-edit rerun passed 36/36 with no unexpected errors. Mounted
structured, legacy and LaTeX inputs adopted newer same-leaf remote revisions;
the next keyboard edit preserved the adopted content. Nonoverlapping updates
merged, while overlapping updates after synthetic save failures preserved the
exact local input and exposed a locked conflict instead of overwriting server
content. All six exact fixture pages were removed.

Ordinary save/reload recovery passed 22/22: typing through a failed save, offline
retention and reconnection, remote adoption and nonoverlapping merge, locked
overlap conflicts, a real new-page draft copy preserving structured format and
block IDs, and recovery after reload followed by real persistence. Its four exact
fixture pages were moved to Trash. Maintenance passed 25/25: future start and
timezone retention, failed-save recovery, dirty-form cancellation and reconciliation
after a real committed schedule's response was synthetically lost. Retry found
exactly one matching binding without issuing another create. Every schedule stayed
paused and future-dated; no provider execution was requested. The exact bindings
and owned page were cleaned.

Brief/Study generation checks passed 13/13. The harness forwarded real UI create
bodies once and delayed only delivery of their committed receipts across a batched
sign-out/return. The Study receipt could not navigate the new session, and the
future Brief receipt could not replace its current day. Exact API readbacks retained
the Study note identity and future agenda date. Both owned pages and their history
were removed. These deterministic lifecycle checks requested no model execution.
The consolidated runtime queue and all seven required source gates passed on the
recorded frozen candidate. Final source review then identified a separate risk:
a remote Trash event clears an unsaved editor's own backup before closing its
store, and unmount cleanup treats a missing session as saved. A targeted real-event
regression is being checked before sealing the checkpoint; no commit has been made.
Its first real-event run failed earlier than the frontend branch: the backend's
live visibility guard excludes a page immediately after Trash, closing the stream
before its terminal notice can reach the editor. This establishes a real need for
a narrow backend repair, reported before implementation. Initial admission must
still reject trashed pages, and live session/membership revocation must still stop
all parcels. The guarded failing-before tests reproduced missing terminal delivery,
a CRDT guard arriving first, and stale Trash after restoration; the existing and
new revoked-reader checks passed. The earlier full backend qualification predates
this repair and will need requalification before the entire rebuild is called done.

The stream repair now passes 8/8 focused checks. It is deliberately opt-in through
`terminal=preserve-drafts-v1`: the new web client advertises page/source draft
recovery through its existing streaming transport extension. Default and unknown
values retain legacy visibility checks and closure, because the old desktop/mobile
legacy editors discard in-memory drafts on Trash. Their source is unchanged.
Current Trash emits one minimal terminal notice only to a fresh authorized reader;
revoked readers receive neither that metadata nor CRDT data, and a stale hint after
restoration is ignored in the opted-in mode. Initial admission still rejects Trash.
The API guide records the optional request contract; no shared package or schema
changed. An older server ignores the opt-in and retains its existing behavior;
an older client does not opt in. No rollout, cutover or deployment was performed.

With the server fixed, the next browser run reproduced actual frontend draft loss.
The hook now captures the current session and raw Markdown before closing, keeps
its immutable backup, preserves LaTeX buffers and stops the terminal page watcher.
Unmount cleanup requires a real matching clean session; a closed store cannot
stand in for a save receipt. The real browser rerun passed 11/11, including restored
page reload, an explicit recovery offer and exact API readback. A subsequent
opted-in rerun also passed 11/11 with no failed stream reconnect.

The Gone-state storage failure run passed 21/21. After a newer edit could not be
backed up, a completed native Markdown download contained that exact memory-only
edit. Failed local retry kept it reachable; successful retry persisted it locally.
Neither copy nor retry issued a document PUT. Restoration and explicit recovery
then saved it through the API. The inspected desktop Gone views expose copy/retry
without promising that a failed write is durable. The embedded Brief now defers
its parent Trash callback while copies remain at risk, and asks before leaving;
its dark-phone runtime check is still being consolidated before the checkpoint.

The embedded Brief check then exposed a distinct rich-document recovery defect:
its generated structure cannot round-trip through Markdown. Copy now falls back
to an account/page-bound structured draft file when Markdown would lose structure.
“Open structured draft…” stages a separately persisted review offer; it does not
apply the file or send a document update. Oversized, invalid and mismatched copies
are refused while the external file stays untouched. The editor store now exposes
a validated whole-tree replacement so explicit recovery preserves IDs and metadata
without converting through Markdown. This real package need was reported before
implementation. Its 16 focused store tests pass, including stale ownership,
format/validation refusals and edits arriving during an in-flight save. The dark-phone native
Brief download/reopen check passed 29/29 with no browser errors: import alone
sent no document PUT and preserved the server baseline, then explicit Restore
saved the exact tree, title, IDs, metadata and agenda date. The original downloaded
file remained unchanged; the exact owned fixture was removed after readback.
The Gone, review-offer and restored-page screenshots were inspected.

### Agents foundation in progress

Library, Brief and Study were checkpointed locally in `dd50114d`. The seven
required source gates passed, with the final evidence-only document update checked
again for formatting and local links. This is a local commit; it was not pushed,
submitted for review or deployed. The shared editor/stream changes still require
a new full guarded backend qualification before the whole rebuild is complete.

Stage 2 now owns the existing shared Agents components before route integration.
Account ownership uses session generations, stream reconnects trigger catch-up,
and live/foreground refresh bursts are coalesced. Ready characters and previews
remain still, with bounded greetings/completion motion and no hidden-tab frames.
Identity, budget and schedule forms retain failed drafts and confirm dirty close
or reload; outcome and routine controls are being integrated against their existing
revision and request-identity contracts. These are implementation changes in
progress, not browser or model-execution qualification. No provider was configured.

The initial Review route check passed 28/28 with no browser errors. The named
member's inbox was read from the real API; intercepted exact-ID proposals then
qualified full before/after content, partial selection excluding stale changes,
all-mode stale refusal, decline confirmation/Cancel, a lost committed receipt,
failed-refresh retention and access-revocation clearing. It inspected light desktop
and dark phone layouts, including long multilingual content and 44px decision
controls. The synthetic writes never reached the server. Real proposal application
is not qualified by that receipt.

Source integration also caught unsupported generic idempotency keys on assistant
endpoints before runtime qualification. Existing backend policy allows keys only
on its explicit route list. Handoff now sends its initial request without such a
key; an ambiguous result can only read and match the saved handoff's source
revision, instruction, title and lanes. No blind resend is offered. Night and
Assistant owners are applying their existing domain receipt/revision contracts;
no backend idempotency policy was expanded.

The shared settings check passed 20/20. A real named-member identity write and UI
restoration preserved the original persona and complete appearance; final API
readback confirmed restoration. A synthetically refused save retained its draft,
dirty-close cancellation kept the editor open, invalid timezone input sent no
schedule write, and the ready character preview scheduled no idle frames. Phone
controls and layout were inspected. The local server has conversation rollout off;
notification preferences are now capability-gated so the independent pause controls
remain usable. No rollout flag or provider configuration was changed.

Night controls passed 87/87 against exact synthetic fixtures, with real named-member,
profile and latest-night reads recorded separately. Coverage includes selected
keep/undo, bulk decision tokens, question/free-answer/approval identities, stale
preflight refusal, unknown-result read-only checks, exact page-cancellation
reconciliation, post-save refresh failure, revocation, full evidence and history
expansion. Long dark-phone results remained contained and visible controls met
44px targets. Synthetic decisions never reached the server; model/worker execution
remains unqualified.

Real paused-goal CRUD passed 18/18: UI create, API readback, retained fields after a
refused conditional edit, successful edit, deletion cancellation, exact deletion
and final absence verification. The fresh personal goal stayed paused with no
project or plan-page association. Existing goals remained present. The exact
owned test record was removed; no execution was started.

All four Agents route families and their shared components passed combined web
no-emit typechecking before the next runtime correction. Real-server inspection
then identified the personal/saved-chat controller's assumption that conversation
rollout is enabled. The legacy chat API fallback is implemented and verified below; canonical
conversation links report their unavailable capability honestly when rollout is off.

The paused-routine UI check reproduced a backend revision defect. Native setup
saved the routine, wrote its run limits (advancing the row revision), then returned
the earlier snapshot. Setup now rereads the final owner-scoped row within the
same transaction after all writes and receipt insertion; an unexpectedly missing
row fails the transaction. This narrow backend need was reported before editing.
The owning nine-test suite passes, including current response/list revision,
conditional follow-on update, atomic permission behavior and request replay. The
first paused test routine was verified unchanged and removed. The successful fresh UI rerun is recorded below. No schema, provider
configuration or rollout flag changed.

The clean paused-routine rerun passed 68/68 with zero browser errors. It covered
native setup with exact current revision, a retained draft after confirmed edit
failure, successful edit, saved timezone/future occurrence/pause preservation,
history/policy reads and exact UI deletion. New checks reproduced then verified
fixes for a policy callback render loop and nested Escape propagation. Stable,
idempotent dirty callbacks stop the loop; the shared dialog keeps cancellation
local. Both policy editors now offer confirmed local discard without sending a
write or clearing uncertain saves. Cancelled discard and dirty Escape preserve
the panel, explicit discard restores the baseline, and saved policies remain
unchanged. The exact owned routine was removed; no grants or work were started.
The owning backend setup suite remains 9/9.

Assistant's seven-part runtime run passed 322/323 with zero browser errors, no
forwarded model/work mutations and unchanged source throughout. It covers legacy
personal/task/project/saved chat when conversation rollout is off, all six deep-link
forms, independent drafts, waiting decisions, visible-only acknowledgment, account
switch ownership and unknown-result recovery. Failed sends retain the original
prompt and new typing without clipping; uncertain goal/project creation cannot
blindly retry. Canonical conversation APIs were not called in the rollout-off
cases. Real account/capability reads are recorded separately from synthetic work.

The sole initial failure measured the reading anchor before the browser scrolled
the Earlier messages button into view. The corrected focused history check passed
22/22, measuring immediately before the actual pointer action with the unchanged
three-pixel tolerance: the same entry stayed at a 93px offset after prepend. No
public scrolling source changed to satisfy that correction. These are an assembled
full-run and focused receipt, not a claimed clean rerun of all seven parts. All seven frozen-candidate checkpoint gates passed: formatting, workspace types,
code organization, project docs, GitHub helper tests, web build and week-scene tests.
External model/worker execution remains unqualified and provider configuration is unchanged.

### Settings — implementation and scoped verification

Stage 3 started from `abc3cdd7`. Root owns the Settings modal, catalog search and
route entries, registered exit ownership, Tags, Privacy, ChatGPT and integration.
Account and Planning have disjoint screen owners; existing Calendar frame/habit
editors are reused with optional state reports and stronger lifetime guards.
Connections and automation settings are being implemented separately. This is
unfinished work; no Settings checkpoint or whole-client qualification is claimed.

A shared browser probe passed 17/17 without API writes. Registered navigation
checks preserve the current entry before asking about Back/Forward, refuse a
cancelled exit, and fence older approvals behind newer navigation. Device theme
controls now share one external-store owner, propagate explicit cross-tab changes
and suppress transitions while the palette commits. The original ready preview
still has no idle motion.

An account preference queue probe passed 5/5 on the actual browser modules with
synthetic transport only. A held old save receipt cannot overwrite a new account
generation; a queued write is never dispatched after A→signed out→A. The probe
initially imported a separate Vite timestamped session module; its corrected run
resolves the exact session URL consumed by the preferences module. Failed harness
attempts are retained separately and are not product failures or passing evidence.

Real named-member Tags CRUD passed 18/18 with zero browser errors: fresh personal
tag creation, exact API readback, retained draft after a synthetic 422 refusal,
cancelled discard, successful edit preserving scope/color, cancelled delete, exact
delete and final absence with prior tags retained. Phone controls/layout and the
real consent/data controls in Privacy were inspected. No privacy mutations,
provider calls, work starts or unrelated writes were forwarded. The exact test tag
was removed. Subsequent visual refinements add saved tag colors and place Privacy
feedback beside its initiating action; they still need the next rendered check.

Two interim combined web no-emit checks passed. The latter includes the final
Account security exit corrections and Calendar habit timezone/retry-age guards.
The final seven checkpoint gates, security/planning flows, dark rendering and
remaining Settings categories are outstanding. No additional group is committed.

All six Settings categories now have implementations. Account includes real
browser capability handling, one-time recovery material acknowledgment and
session/device controls. Planning reuses the Calendar frame/habit owners and
adds preferences, places and learning evidence. Automation reuses the agent
identity/limits/schedule dialogs with optional exit reports; their successful
receipts are checked and uncertain writes require authoritative readback before
adoption. Connections includes grants/access/activity/rules/channels, personal
and clipper keys, webhooks, calendar feeds/subscriptions, delivery, portability
and developer/CalDAV references. These are implementation claims; their full
mutation and failure qualification is outstanding.

The browser ChatGPT owner uses the existing remote catalog store with a numeric
session-generation adapter. Provider fallback remains explicit, recorded usage
is on demand, and morning-summary permission is independently bound to provider
and model revisions. Configuration changes refresh the summary permission; an
older permission receipt cannot replace a newer configuration read. Source
review found and corrected a lost-selection recovery dead end after discovery
failure and an expired-catalog no-dispatch case incorrectly treated as an
uncertain write. Those corrections still need dedicated runtime fixtures.

The complete Settings read-through passed 34/35 with zero browser errors and no
domain mutations: all categories in light desktop and dark phone, catalog search,
Signing in targeting, and both legacy aliases. The failure was an instruction
button repeating a long team name. The corrected focused dark375 check passed
3/3 with content clientWidth=scrollWidth=359, zero overflowing elements and exact
space identity retained in the accessible action label. The phone screenshot was
inspected. This is assembled broad and focused evidence, not a claimed clean
35-check rerun. Shared navigation/theme verification now passes 20/20, including
preserving the original feature return path across Settings aliases.

CalDAV inspection found missing preview routing. The new web Vite server now
proxies /dav and exact /.well-known/caldav to the existing API without rewriting
its DAV hrefs. Unauthenticated PROPFIND checks returned 401 with the Orbyn Basic
realm at /dav/ and 301 to /dav/ at discovery, rather than frontend HTML. No records
or credentials were used. The production web proxy still needs that routing when
the new client is deliberately cut over; production configuration/deployment was
not changed. A fourth interim combined web typecheck passed after the final
recovery and proxy changes. A fifth interim combined typecheck also passed after the navigation and copy
changes. All Settings changes remain local and uncommitted.

The full Settings ChatGPT fixture flow now passes 27/27 with zero browser errors
and a frozen manifest including untracked source. All model, provider-choice and
summary-permission writes were synthetic; real account reads are separate and
no provider/configuration write reached the server. Coverage includes empty
discovery, deliberate exact-device selection, a lost committed model receipt,
failed discovery followed by exact-device recovery without replay, expired
catalog no-dispatch, retained model draft, explicit default saving, explicit
fallback and preserving its draft when reselecting the same provider, consent
bound to current provider/model versions, and renewed review after model change.

The fixture run reproduced a stale success notice after a model change: the
permission correctly became inactive but its earlier success copy remained.
The notice now clears on configuration changes; the failing receipt and passing
rerun are retained. The final phone model controls were scrolled into view and
visually inspected. Earlier harness failures selected the account's unrelated
Refresh devices action or allowed the transport's normal GET retry to heal a
single simulated discovery failure. The corrected fixture scopes actions to the
ChatGPT section and holds discovery unavailable through all transport retries.
Those harness corrections do not change product guards or passing tolerances.

Outstanding stage-3 qualification includes Account security/recovery/device flows,
full Planning CRUD/preferences/preview and unknown-state cases, Automation rules/
instructions/settings recovery, and Connections grants/keys/channels/import/export/
calendar/delivery failure and permission cases. Requalify the shared agent dialogs
and Calendar consumers affected by these changes. The final seven checkpoint
gates and local commit remain pending. Admin/Developers, Teams/Booking/public
flows, shell parity and the final whole-client audit remain subsequent stages.

The latest sixth combined web no-emit check passes after the consent-notice and
fallback-draft fixes. Project-doc links, source organization and diff whitespace
checks also pass. The seven final checkpoint gates remain pending.

### Settings qualification — security, privacy and planner records

The personal-key and CalDAV flow passes 19/19. A fresh local member key was
created, used for authenticated PROPFIND through the preview proxy (207),
acknowledged and revoked; the revoked key then returned 401. Copy refusal and
one-time-material exit guards were exercised. Temporary keys from both attempts
were revoked. No key material was persisted in the evidence. The first run's final
revoked request stalled on the browser's Basic-auth challenge; the corrected final
check uses a bounded protocol read after the actual key lifecycle.

Account security fixtures pass 90/90 on localhost, including nested draft-close
confirmation and browser Back, recovery-code acknowledgment/copy failure, session
and device receipt recovery, virtual passkey ceremony and account-generation
fencing. All server security mutations were intercepted. Registration on an IP
address is now unavailable with domain-name guidance; the separate IP control is
pending. Browser Back previously replaced a nested confirmation and stranded its
promise; pending confirmation state now participates in the exit guard. These
checks do not qualify a real authenticator or backend registration.

Privacy passes 17/17. The actual local account archive downloaded successfully,
passed ZIP CRC verification and contained the expected data sections and current
consent metadata. Analytics and account-deletion refusal/uncertain-state checks
were synthetic; no real privacy mutation or account deletion was forwarded. The
real account identity remained present. No provider calls occurred.

Actual Places create/edit/delete passed in the broader Planning run. Its Habit
edit initially stopped on an icon-action selector; a focused rerun then exposed a
helper assumption that a controlled numeric input could remain empty. Both were
private harness issues. With native selection replacement and exact final-value
verification, the inactive Habit flow passes 8/8: create, edit, full-field readback
and delete. All temporary Places/Habits from these runs were removed. No habit
was activated. Frame qualification and the remaining Planning/Automation/Connections
recovery cases are still in progress; the final seven Settings gates remain pending.

The focused real Frame flow passes 23/23. It first created and proved a fresh
personal list empty across all current item kinds/statuses, then created a
busy:false Frame filtered exclusively to that list. Editing changed only its
name/color; complete readback preserved all other fields and filters. The Frame
was deleted before its exact unchanged empty list. No planning/apply/session,
provider, worker or delivery command was forwarded. The first attempt stopped
before Frame creation when the native filter click did not stick; the corrected
helper centers the input, proves its pointer hit target and awaits checked state.
Both runs cleaned their owned lists. The saved success screenshot shows lower
Planning sections, so it is not counted as Frame-specific visual acceptance.

Planning preference recovery passes 8/8 with synthetic lost receipts: an old
nonmatching snapshot cannot unlock the draft, the exact submitted patch resolves
without replay. Place/Frame uncertain create/update/delete recovery passes 32/32: a
pre-existing matching ID cannot settle creation, exact-ID updates require matching
fields, and deletion requires absence. These are intercepted UI-recovery checks,
separate from the real local CRUD receipts above. One initial browser launch timed
out before scenarios began; the next run used a longer launch timeout, retaining
all interaction assertions. Habit retry-age and preview/apply cases remain pending.

Habit same-attempt retry checks pass 14/14 with synthetic responses: normal
retries preserve the exact body/key, while the 23-hour boundary and a backwards
clock dispatch no further request and retain the unknown state. Preview/apply and
digest recovery are still pending.

The Automation instruction probe reproduced an old-readback recovery defect
(3/5): a lost save followed by the previous instruction text still enabled saved
context adoption. Context and Assistant rules now capture immutable submitted
attempts, validate successful receipts and require matching space/text or an
advanced CAS revision before unknown-state adoption. Profile creation retains a
validated receipt document ID; even a definitive follow-up read failure keeps
creation uncertain. Confirmations recheck the current attempt, observation and
account owner. These two local source corrections passed a web-only no-emit
TypeScript check and diff whitespace; their runtime requalification is underway.

### Settings qualification — Automation and Connected agents

The corrected instruction unknown-state flow passes 9/9 and the context-page
receipt/follow-up-read flow passes 10/10: a confirmed create followed by a 403
read remains uncertain, a different document ID cannot be adopted, and the exact
known ID resolves without another create. A combined Automation run completed
75 passing checks before a private wait matched “receipt” in the draft rather
than waiting for the response state. Its screenshot showed the product correctly
blocked. The corrected focused receipt/owner run passes 12/12. These are assembled
scoped receipts, not a clean rerun of the entire combined batch.

Reminders now also captures and validates its immutable six-field submission; an
old nonmatching snapshot cannot resolve an unknown write. The supplemental run
completed 67 passing checks covering normal/refused/unknown/mismatched reminder
saves and direct Background/Overnight identity and limits dialog Cancel/Escape,
pending and unknown receipts. It stopped when its Schedule helper queried before
the async control mounted. The corrected focused Schedule/owner run is pending.
Broader direct-agent Sidebar/Back navigation is still a separate shell/route
qualification target; these dialog checks do not establish that behavior.

The first Connected agents batch completed 49/51: grant/activity/undo checks
passed, but an immediate React-state inspection and numeric-input selection
assumption stopped the remaining flow. The corrected permission run passes
17/17, including the real parent dirty-edit refusal, held browser Back, trust
and toolset bodies and phone containment. Plugin permission now validates the
exact grant, expected next revision and provider/limits before accepting a PUT
receipt. Matching authoritative reconciliation also clears the saved draft. Its
focused run passes 29/29, including a well-shaped wrong-grant response, no replay,
clean category exit and revoked permission removing enabling controls.

All server Automation, grant, undo and provider-permission mutations in these
fixtures were intercepted; none qualifies provider execution or external delivery.
Web-only no-emit checks 7–9 passed as the Context/Rules, Reminders and Plugin
corrections landed. Full checkpoint gates remain pending, along with remaining
Connections/import/calendar/channel flows and the separate real-local WebAuthn
check. No further local group commit, push, PR, merge or deployment occurred.

The focused Automation supplement tail passes 20/20, completing Overnight
schedule Cancel/Escape/pending/unknown recovery and the stronger direct-consumer
account switch. A new owner dialog was opened and typed before releasing the old
receipt; its draft and dialog survived, with session generation advancing twice.
This supplements the prior 67 passing checks; it is not an entire clean rerun.

Real local WebAuthn now passes 11/11. After verifying the persisted development
database marker, the private preview APP_URL was set to localhost:5175 and only
the owned API/preview processes restarted. Chrome's virtual authenticator created
a real attestation through the new Settings UI; actual backend verification
returned 201, the fresh credential was read back, and its exact deletion returned
204 with the original passkey baseline preserved. No security-bypass flags,
physical authenticator, sign-in/session mutation or simulated verification was
used. Raw credential/challenge/attestation material was kept only in memory.
The run recipe above now states the required canonical origin and strict port.
The initial preview restart hit npm argument forwarding and served the wrong
port; that owned process was stopped and the direct workspace command corrected
before any security write. These are local setup changes, not a deployment.

The corrected real Markdown import run passes 22/22 with process exit0: native
file selection, real preview, one keyed apply, exact personal page/folder content
and ownership, and conditional cleanup. Existing library IDs and folder snapshots
were preserved. The initial run completed all 21 functional/cleanup checks but
exited1 solely because two aborted Google Fonts CSS requests were counted as
violations. The private classifier now labels those expected blocked assets while
still aborting every external request and failing unexpected origins/methods.

Real native CSV task import passes 15/15 with exit0. The imported due-less personal
task was verified against its committed receipt, fresh ID, complete fields and
owner, then removed through the version/session guard; existing task IDs remained.
Zero active member webhooks was verified before import and deletion. No planner
preferences were changed; source confirms a task without due date or sessions
cannot become a scheduler/nudge delivery candidate. Ordinary audit/tombstone data
was retained. These real happy paths supplement the pending synthetic portability
failure/replay checks; they do not qualify Notion parsing or external conversion.

### Settings qualification — final connections, portability and layout

Calendar feeds/subscriptions and the shared Manage bridge pass 61/61 scoped
checks. They cover explicit permissions, stale/refused/unknown receipts, draft
preservation and phone containment. The shared colour/day controls now use the
36px/44px control token; segmented actions retain that height, and tall Manage
forms no longer collapse the tab strip. Connection secrets, webhook delivery/rules
and wake controls pass 89/89 synthetic checks; no external delivery occurred.

Slack/Teams store outcomes now distinguish failed reads, definitive mutation
refusals and uncertain writes. This additive SDK metadata was necessary because
the earlier generic error trapped known refusals behind the unknown-write lock.
The store regression batch failed four new assertions before the change and
passes 24/24 afterward. The full channel UI fixture passes 42/42, including an
explicit retry after each provider's 422 and read-only reconciliation that never
unlocks or repeats an uncertain write. An earlier Teams refusal fixture used the
wrong heading, stopped before dispatch and was corrected. External OAuth, personal
chat delivery and provider execution remain unqualified.

Synthetic portability checks completed 86 checks before a private download
filename collision stopped the combined run. The corrected actual export tail
passes 12/12 with separate download directories and inspected JSON/ZIP containers.
Those receipts supplement the real Markdown/task imports recorded above; they
are not a clean rerun of the entire combined batch.

Final read-only Settings navigation passes 61/61 across all six categories,
light desktop and dark phone, catalog search and legacy aliases. Viewport captures
and hit testing exposed and then verified a modal scrolling correction: only the
content pane scrolls; the Settings title and Close remain visible. The focused
Frame phone flow passes 7/7, including native colour selection and 44px colour/day
targets. Earlier element captures and beyond-viewport screenshots are not used as
whole-modal visual evidence. Screenshots of current phone Planning and Frame
states were inspected directly. All fixture mutations were intercepted; real
security/import happy paths are identified separately above.

All seven frozen-candidate checkpoint gates passed: repository formatting,
workspace types, code organization, project docs, GitHub helper tests, web build
and all 11 week-scene tests. The final-document candidate passed the same seven
gates and was committed locally as `f3830ad1`. Staged Admin/Developers/Teams/Booking/OAuth drafts remain private
preparation, with integration and runtime qualification still outstanding. Shell
parity and the final guarded backend suite remain open. No push, PR, merge,
deployment or packaged-client cutover has occurred.

## Stage 4 — Admin and Developers integration

Entry checkpoint: `f3830ad1`, with a clean working tree before integration.
Developers is now integrated and passes a web-only no-emit typecheck plus 114/114
scoped browser checks. Real anonymous public catalog reads supplied all published
metadata, nonlegacy tools and all six core setup variants. Synthetic fixtures
covered first-load and refresh failures, filters, direct tool hashes, clipboard
lifetimes, retained newer choices and disabled/empty states. No auth, provider,
MCP execution or mutation was forwarded. Desktop/light, phone/dark and synthetic
long-content screenshots were inspected; full-client visual qualification remains
separate. The fixture records all nine catalog reads and unchanged source hashes.

Admin has been integrated from its separate draft for compilation and review.
The first web-only typecheck found two callback-narrowing errors and an omitted
publishing draft ID binding. Those were corrected; the combined candidate now
passes web-only no-emit checking. Review also found stale
reconciliation proofs shared across unrelated profile/reset-link and
save/suggestion operations. The corrected draft binds recovery to the specific
admitted action and clears successful proofs. Targeted failing-before and corrected browser receipts are recorded below;
neither source review nor the Developers receipt qualifies the remaining Admin
flows. System/provider/publishing effects will remain fenced
synthetic fixtures. No production/configuration/provider action is authorized.

Stage 4 is a local implementation checkpoint. Teams/Booking/OAuth, shell parity,
remaining cross-screen flows and the final guarded backend suite remain open. No push, PR,
merge, deployment or packaged-client cutover occurred.

### Admin qualification — reads, operation ownership and recovery

The read-only batch passes 36/36: actual overview/accounts/teams/audit/usage/request
and database-table metadata, mobile selector navigation, light/dark layouts and
all 13 direct Admin routes denied for the real demo member without an Admin read.
Only explicitly allowlisted database reads were forwarded. Earlier runs stopped
in private helpers: transformed module discovery used the bounded Performance
buffer, then restoring Admin while still on the denied Legal route triggered a
correctly refused out-of-scope read. Both were corrected without broadening the
read allowlist. Desktop Accounts and phone Accounts/Requests captures were inspected.

Two targeted regressions failed before correction at their intended assertions:
profile-then-reset 12/13, and save-then-suggestion 14/15. Neither sent a second
operation. The combined corrected batch passes 24/24. The original Publisher also
adopted its older Editor snapshot after a successful save; the identity-before
fixture separately repaired that and its missing ID binding to reach the second
bug. Distinct original, compile-only and monotonic-before source manifests are
preserved privately, rather than claiming these are the same baseline.

Publisher now validates exact draft ID, next revision, submitted content and
requested outcome. Its immediate publish receipt is correctly scheduled, as the
backend transaction specifies. JSON object key order is immaterial while array
order remains significant. Newer authoritative snapshots wait for pending work;
older snapshots cannot replace a confirmed save, and dirty/unknown buffers stay
owned. The current candidate passes another web-only no-emit check. Broader
publishing/action/image cases remain to be exercised.

The main synthetic management batch passes 91/91: profile save/refusal/unknown
reconciliation, role/session guards, one-time reset acknowledgment and clipboard
failure, malformed receipts, changed-field runtime/SMTP forms, nested discard and
pending confirmation races, stale model-control revisions and account-generation
isolation. A held response from A→signed-out→A cannot repopulate an old selection.
All mutations and effectful GETs were intercepted; this is not real SMTP/provider
or management-effect qualification. The first combined run completed 39 checks
before a native number-input helper stopped before dispatch; its synthetic
post-acknowledgment overview reads also needed explicit fixtures. Corrected native
selection replacement and those exact synthetic responses produced the clean run;
no guard or body assertion was weakened.

The remaining publishing/image/action, legal/retention/storage, team-management
and table-detail batches have now passed, as recorded below. Stage 4 still needs
all seven checkpoint gates and its local group commit. Stage 5 source drafts and Stage 6 shell
foundation remain private preparation. The final whole-client audit/backend suite
and all previously recorded parity gaps remain open. No publication or deployment.

The scoped one-time receipt follow-up passes 23/23 after adding explicit Copied
feedback. An explicit retry clears the prior clipboard error, successful copy
retains the receipt, and acknowledgment remains disabled while copying. Feedback
is bound to the current value/mounted account owner; dispatch rechecks that owner
before touching the clipboard. The clipboard responses are synthetic, not an OS
clipboard permission qualification. Web-only typecheck 6 passed on the formatted source including the dispatch-owner
check; the final seven-check gate remains pending for this group.

### Admin qualification — publishing, infrastructure and teams

The complete publishing fixture passes 174/174: content saves, explicit suggestion
adoption, scheduling/cancellation, release/unrelease, deletion/reset, stale
revisions, exact receipt identity/content, unknown outcomes and newer readback
races. A failing-before image check exposed an enabled release action while a
crop was unapplied; release now stays disabled until that crop is applied or
cancelled. The focused native image follow-up passes 37/37 with local PNG input,
canvas crop/zoom/pan/rotation, download, invalid-file handling and accurate phone
captures. Dark crop controls, dark image controls and the light image preview
were inspected directly. These fixtures never publish or contact a provider.

A failing-before operator test found that a second save resent a field already
saved because its comparison baseline never advanced. Legal receipts now update
the canonical read and each clean form baseline, while dirty, pending and unknown
buffers stay owned. The focused corrected operator batch passes 13/13; the full
operator/documents/retention/storage batch passes 56/56. It covers changed-only
writes, refusal/retry, uncertain receipts without replay, full legal-source
review, save versus explicit version publication, restoring shipped text,
retention zero/changed/fixed policies, cancelled and confirmed sweeps, stored-file
search and exact removal/readback. All management effects are intercepted.

Team/database qualification passes 65/65: rename, refused changes, existing-account
member addition, roles, last-owner refusal, removal, dirty navigation cancellation,
exact team deletion, unknown outcomes and account-generation isolation. Database
rows now use a dedicated renderer: every schema column remains identifiable,
server masks stay visible, unexpected credential/object values remain masked,
null differs from missing and record labels include the page offset. The separate
database follow-up passes 24/24, including failed-page retry, backward paging and
management links. No database row is edited by this screen.

Earlier helper failures are retained privately: email SelectAll ran before a
closed dialog released focus; a legal checkbox clicked beneath the sticky Search
header; numeric and effective-disabled checks also needed native control handling.
The corrected helpers verify current focus, exact resulting values and hit targets
before dispatch, without weakening request/body/effect guards. Legal, Storage and
expanded masked-row phone captures were inspected after proving their intended
content is visible and contained at 375px. The earlier cropped/unrelated captures
are not used as acceptance evidence. All seven frozen-candidate checkpoint checks passed: repository formatting,
workspace types, code organization, project docs, GitHub helper tests, the web
build and all 11 week-scene tests. This is a local checkpoint; the final whole-client
qualification remains separate.

Stage 5 full Teams/Booking/OAuth source and qualification tools remain private
preparation. Stage 6 shell and Stage 7 parity work, all-route/theme/phone audit and
the guarded full backend suite remain open. No source has been pushed, merged,
deployed or cut over from desktop.

## Stage 5 — Teams, Booking and OAuth integration

Entry checkpoint: local commit `fc41a7e6`, whose Admin/Developers candidate passed
all seven required checks. Thirty-six newly authored Stage 5 files now replace the
Teams, Booking, public booking and OAuth placeholders. The initial combined web
no-emit check passes. The shared auth-return integration also passes web no-emit:
one local destination policy retains app and exact OAuth request URLs through
sign-in links and completion. Signed-in OAuth requests use the existing email and
Terms gates at the original URL, with no automatic acceptance or grant.

This group is uncommitted and its interaction qualification is beginning. Planned
fixtures intercept all booking, membership, authentication and consent effects;
real local happy paths need separately guarded fixtures and readback. No model
provider, external delivery or production operation is part of this qualification.

The existing forgot-password API takes only email and sends a reset URL without a
return destination. URL-only continuation preserves an incoming reset URL already
carrying `next`; it cannot add that parameter to an existing generated email.
The original OAuth tab retains its request URL. This cross-email continuation
boundary remains open for parity review; no second stored return owner or backend
contract extension has been added.

Additional final-audit gap: the current HTML loads an external Google Fonts
stylesheet. Qualification blocks that request and uses local fallback fonts.
Resolve font delivery before final acceptance; the blocked stylesheet is not
visual proof of the externally loaded font.

The first Booking fixture passes 15/15: a focused deep link independent of filtered
inbox rows, complete answers including removed questions, newer-query ownership,
dirty Close cancellation, and denied-refresh privacy with authored-draft retention.
The wide recovery capture was inspected. The private Booking journal holds these
checks; the common bootstrap summary contains no checks and is not their receipt.
All booking reads/effects in this batch are synthetic; only named local identity
and legal bootstrap reads reached the API.

Source review then corrected exact team identity before authority/reconciliation,
revoked member-role fallback, fresh create/member receipt IDs, and a duplicate
TaskHost mount. The existing Shell remains the single task-dialog owner. Booking
heading sizes now use the agreed 24/18 roles. Combined web no-emit checks 1–3 pass.
These source corrections still require their targeted runtime qualification.

The first host replay fixture stopped because it admitted only one keyed 503,
while the existing API transport correctly retries that response once. The
corrected fixture admits exactly two identical body/key failures before testing
an explicit replay. The failed fixture and its refused extra request are retained;
no backend/transport guard was changed and no booking write was forwarded.

The corrected host replay batch passes 12/12: two transport-level lost 503
responses and the explicit replay all use the original body/key, with the
independent reason preserved. The separate clock-rollback/expired-window batch
passes 17/17 and admits no additional mutation after either unsafe window.

A focused initial-detail identity regression failed before correction at its
intended assertion: a wrong booking ID was displayed for the requested deep link.
The corrected read rejects it and offers explicit refresh; the follow-up passes
10/10 including exact-ID recovery without a mutation. Booking co-host reads also
validate each requested team ID before returning its people/role data. Numeric
and coercible-array receipt IDs are refused by explicit string guards. Latest
combined web no-emit check 4 passes; co-host identity and additional malformed
receipt runtime cases remain to be exercised.

The combined auth-return batch passes 119/119 with fully synthetic accounts,
authentication, legal metadata and consent effects; no API request was forwarded.
It exercises the actual safe-next helper, exact encoded OAuth URLs through native
links and already-signed-in entry, password/TOTP refusal and success, unchecked
signup, passkey failure before a ceremony, supplied reset/verify URLs, stale
route/account callbacks, double-submit fencing, and email then explicit Terms
before returning to the same OAuth request. No callback, popup or OAuth Allow is
admitted. The returned consent-choice capture was inspected directly.

Registration Terms-read failure now has an in-place retry that preserves authored
name/email/password fields and requires a loaded version before accepting or
submitting. The focused before fixture failed on the absent retry; the combined
corrected batch verifies retry and no automatic registration/acceptance. Web
no-emit check 6 passes. Earlier auth runs stopped in helpers around full-page
navigation, wrapped inline-link hit regions and lazy/recovery container mounting;
those failed receipts remain separate from the clean 119-check run. Successful
native passkey ceremonies, actual auth/reset delivery, generated-email next and
final phone/theme qualification remain unclaimed.

The focused Teams identity batch passes 36/36: wrong-ID initial detail and
management preflight, unknown rename reconciliation, membership revoked between
two fresh reads, array/number/null member-ID receipts and readbacks, wrong-team
member reconciliation, creation-baseline failure without POST, preexisting-ID
creation receipts and same-key replay, and one global task-dialog owner. All team
mutations are synthetic; only verified named identity/legal GETs are real.

Earlier Teams runs stopped on helper assumptions: bootstrap Terms needed an exact
synthetic document response; a refusal fixture used the wrong error DTO property;
and the shared create dialog is titled New item. One unchanged helper run was
started after a failed patch assertion, then stopped by SIGINT to its verified
owned driver; Puppeteer owns that browser shutdown. The clean combined run uses
correct native controls, exact request/owner/key guards and unchanged source
hashes. These focused checks do not qualify the remaining full team/planning,
booking editor/public, OAuth decision, real metadata or phone/theme cases.

The broader Teams batch passes 65/65: explicit route and query handling,
owner/admin/member/viewer controls, nonmember system-administrator privacy,
creation/refusal/refresh recovery, rename/member unknown outcomes, role changes,
all team policy/access modes, revoked-authority preflight, availability/pinning,
capacity privacy, budgets, meeting search and draft-only event selection, plus
SPA and account-generation fences. An additional planning capture batch passes
17/17 after correcting the synthetic busy date to the displayed week. Both
current phone themes were inspected: no sideways overflow, 16px fields, 44px tab
controls and the intended heading visible below the fixed header. Earlier helper
failures around field-loading waits, initial disabled membership controls, the
team access enum and capture positioning remain recorded separately.

The focused auth ownership batch additionally passes 21/21 with two actual
pointer clicks. The installed browser driver's count option performs repeated
clicks; its clickCount option alone did not establish that evidence. Stale
route/account/ABA receipts still cannot authenticate or navigate another owner.

Stage 5 remains uncommitted. The safe real-local paused-page/empty-team metadata
runner is prepared only and requires fresh binding/marker/source/identity proof
before execution. Full Booking editors/public flows, OAuth consent decisions,
remaining caller-specific adverse cases and the final family visual audit still
need qualification. The required seven checkpoint checks have not yet run for
Stage 5. Shell, remaining parity work and the final guarded backend suite remain
open; no publication, deployment or cutover has occurred.

### Stage 5 — departures, Booking and local metadata qualification

The Teams departure batch passes 36/36 for confirmation cancellation, Delete and
Leave success/refusal/unknown results, member removal, self-role changes and fresh
identity/role checks. The initial native probe reproduced a self-block: the
Workspace marked its confirmation pending before asking its own exit guard.
The corrected order checks exit first, then rechecks the live mutex and command
state before opening confirmation. No authority or uncertain-result guard was
removed. All effects in that batch are synthetic.

A separate native keyboard regression reproduced Cancel returning focus to the
page body rather than the original Delete/Leave button. The shared confirmation
now captures the opener before the caller disables it. Dialog cleanup first tries
its normal return, then permits one deferred return after the caller re-enables
the trigger. That callback requires the same URL, a connected enabled non-inert
opener, body focus and no newer open dialog. The follow-up native Teams batch
passes 11/11 without forcing focus in the driver. An initial correction still
failed: native tracing showed Cancel retained focus during cleanup until its DOM
was removed. The corrected scheduling retains that failed receipt separately.
Additional primitive guards and affected-caller coverage remain in progress.

Booking editor/public batches now pass: page fields and sharing 33/33; profile
conflicts and uncertain saves 25/25; one-time invite authoring/withdrawal 24/24;
public confirmation and explicit legacy cancellation 15/15; private manage-link
recovery 22/22; one-use invite states 20/20; RSVP 14/14; public profile 12/12;
public slot contention 18/18; and unknown public submission 17/17. Each dedicated
Booking result records zero unexpected effects/errors and unchanged source for
its own run. These are deterministic synthetic Booking operations, not actual
meeting, email, invitation or RSVP delivery.

The page clipboard run uses native clipboard access and verifies exact copied
text; its manual fallback is separately simulated. The first run's permission
and focus setup was corrected without changing application copy behavior. The
invite failure fixture now keeps both automatic read attempts failing until an
explicit refresh; its first version cleared the injected error too early.
Segmented date/time inputs are DOM-event fixtures, not physical picker evidence.
Selected phone captures were inspected, including pending/unknown public booking,
RSVP, profile, page sharing and invite controls. This is not the final family
light/dark/phone sweep. Inspection also exposed technical endpoint/replay prose in
the public unknown state; its copy now describes retained details, paused changes
and checking email/contacting the host. The safety behavior is unchanged. Combined
web no-emit check 9 passes for the latest shared focus and copy corrections.

Separate real local metadata checks pass 17/17 for a fresh paused personal booking
page and 14/14 for a fresh owner-only empty team. Both use actual native create,
edit and delete controls, actual 201/200/204 receipts and independent primary
readbacks. All original page/team configurations remain identical, and only the
two exact newly created resources were deleted. The page never accepted bookings;
no actual booking, invitation, email, calendar event, provider or authorization
operation was performed.

Their fresh one-use local proofs verify the running API/UI owners, canonical
localhost origin and proxy, actual loopback database binding, persisted development
marker, database owner, absent replica/production settings and the accepted verified
member identity. Seven existing metadata trigger bodies were compared with their
canonical migrations and traced: local grant/reference/proposal pruning, Study
queueing for pages in the affected team and advisory source fences. The new empty
team had no pages or dependent work; no custom or network-delivery trigger was
admitted. Exact receipts, baseline fingerprints and source equality remain private.
No database marker, fixture account, existing configuration or unrelated resource
was changed for these checks.

Stage 5 is still uncommitted. OAuth decision/reauthentication qualification,
remaining Booking host actions and Teams caller-specific cases, final visual
coverage and the seven checkpoint gates remain open. Stages 6–7 and final guarded
backend qualification remain part of the full objective.

### Stage 5 — host actions and OAuth issuer boundary

The Booking host-action batch passes 130/130 with exact synthetic action/body/key
checks: approve/decline/cancel, no-show true/false and timing, offered/custom moves,
409 slot refresh, dirty-note guards, known failures, wrong/malformed receipts,
terminal readback and supported replay. No host action reached the real API.
Custom segmented datetime remains a DOM-event fixture, not a physical picker test.
The captured phone host detail was inspected; the final family visual sweep is
still separate.

OAuth choice qualification initially stopped on an invalid fixture expectation:
the UI offers the shared 30/90/365-day presets within the server cap plus that cap,
so seven days was not an available option under a 14-day maximum. The corrected
fixture exercises a 45-day cap and selects its supported 30-day option. Its
controlled-select event and actual expiry helper are checked separately from
native radio/checkbox input; native popup keyboard selection remains unclaimed.
Lazy sign-in mounting and synthetic public Terms metadata were also corrected in
the private driver without broadening its write permissions.

A pure probe of the actual OAuth helper reproduced three accepted malformed
receipts: wrong issuer, whitespace issuer and whitespace-only code. The server
issuer can differ from the browser origin, so the correction reads the existing
API-owned authorization-server discovery document fresh and anonymously before
Allow or Decline. Its unknown metadata is validated, each completion retains the
request/account lifetime fence, and the callback must match that exact issuer.
Blank codes are refused without imposing a new opaque-code format. Native and
loopback callbacks and the backend's current fixed-query handling remain intact;
no backend/core/API-client contract was changed.

The corrected actual-helper matrix passes 31 callback cases and 36 metadata-parser
cases, with no API or callback navigation. The native issuer batch passes 16/16,
including failed/malformed discovery before a grant, rejected receipts remaining
unknown, and late discovery after an A-out-A account lifetime. The integrated
OAuth batch then passes 71/71 across parsing, auth links, permission choices,
approval/decline outcomes, request/account fences, reauthentication uncertainty and
issuer recovery. All grant/reauth/check responses and callbacks in those batches
are synthetic; actual forwarded traffic is limited to named identity/legal reads.
The valid synthetic callback is captured and aborted before dispatch.

An additional anonymous real GET through the current local Vite proxy returns
200 for the existing discovery endpoint and the canonical localhost development
issuer. It performs no grant, token exchange or callback. Combined web no-emit
checks 10 and 11 pass. Native app launches, physical authenticators, actual OAuth
grants/token exchange, external providers and mail delivery remain unqualified.
Shared dialog primitive qualification also passes 30/30, including refusing stale
focus restoration after newer focus/modal/navigation or opener removal.

The remaining Stage 5 work includes Teams pin/Capacity/policy/activity recovery
batches, other caller/date boundary cases, final family visuals, additional guarded
real Booking lifecycle coverage and the seven checkpoint gates. No new group is
committed. Stages 6–7 and the full guarded backend suite remain open.

### Stage 5 — recovery completion and real local Booking lifecycle

Teams planning recovery passes 22/22, covering pin conflicts and uncertain outcomes,
Capacity drafts and timezone handling, and refusal of mismatched identities or
permissions. Policy and Activity recovery passes 33/33, including retained drafts,
access uncertainty, cursor/filter changes, retry and object-link wiring. These use
controlled effects; the Activity link check does not qualify the full task editor.
The corrected public Booking recovery copy passes 17/17. OAuth phone layout checks
pass 30/30, followed by 16/16 for the final connection-replacement copy. Selected
light/dark phone captures were inspected; this is not the final all-route sweep.

Review before the real Booking test found that request logging retained private
confirmation, management, invite and RSVP capability paths. The existing serializer
now redacts these tokens and their query tails, including API-prefixed and encoded
separator forms. Two focused regressions failed before the correction; all eight
serializer tests now pass, including actual Fastify log serialization. This changes
logging only, with no API or persistence contract change.

The real local Booking lifecycle passes 15/15 against the existing development
member and primary database. Native controls create one fresh personal paused page,
activate it with a 48-hour minimum notice and host approval, and anonymously request
an actual offered slot. Confirmation consumes the exact new booking's capability;
host approval creates one matching personal calendar event, and host cancellation
removes that event before page cleanup. The exact page, booking and queued outbox
rows are then removed. All eight writes have validated receipts; original pages
retain their configuration fingerprints. There are no unexpected boundary requests,
browser errors or source changes during the run.

This qualifies **queued mail, not delivered mail**. The confirmation entry is a
fixture link recovered only in memory from the exact newly encrypted outbox payload;
no SMTP sender, notifier, mailbox, provider or agent worker is invoked. One fresh
in-app booking notice and the event's sync tombstone remain intentionally. There
are no retained source markers. Actual email delivery, external calendars and
provider execution remain unqualified.

Fresh read-only admission verifies the running local API/UI/database binding,
development marker, effective loopback Mailpit settings, empty initial outbox,
absent owner webhooks and zero agent grants eligible for this personal booking
notice. Fourteen direct trigger rows and their two secondary functions match the
reviewed definitions; those hashes and grant eligibility are checked again before
each write. Existing connections, keys and configuration are unchanged.

Two earlier pilot attempts remain recorded. The first stopped before any write
because the driver expected an empty list to have a visible rectangle. The second
created and activated only its fresh page, then stopped on an inline SVG favicon
outside the driver's allowlist. Independent guarded recovery paused and removed
that exact empty page; its first DELETE was rejected for an empty JSON content type,
then the corrected bodyless request succeeded after fresh readback. No booking or
event was created by either failed attempt. The final pilot uses corrected list
mounting and inline-image handling without widening network or mutation scope.

Stage 5 remains uncommitted pending its final visual review and all seven required
checkpoint checks. The full objective still includes Stage 6 shell integration,
Stage 7 parity closure and guarded full backend qualification.

### Stage 5 checkpoint

The final read-only family layout pass visits Teams and all four Booking tabs in
light/dark at 1440px and 375px: 20 combinations, zero placeholder/overflow checks,
zero browser exceptions and no unexpected writes. Representative captures were
inspected alongside the public Booking, OAuth and populated Teams fixtures above.
Inspection reproduced a desktop tab-switch layout shift: auto horizontal margins
let the Booking workspace shrink to each tab's content. Giving that workspace its
available width fixes the shift; repeated measurements now prove equal positions
and widths across all four tabs for every tested theme/viewport. This CSS-only
change follows the real Booking lifecycle run; it does not alter its API behavior.

All seven required checks passed again after the layout correction:
`npm run format:check`, `npm run typecheck`,
`python3 scripts/check-code-organization.py`,
`python3 scripts/check-project-docs.py`,
`python3 -m unittest discover -s .github/tests` (31 tests),
`npm run build -w web`, and the backend's
`npx tsx --test tests/week-scene.test.ts` (11 tests).
The build retains warnings about large chunks, an ineffective Library dynamic
import and Vite's future native-config import-extension rule; it exits successfully.
No Docker build, CI, publication, deployment or full backend-suite result is claimed.

This closes the scoped Stage 5 checkpoint. It does not close the full rebuild:
Stage 6 shell work and Stage 7 remaining parity, font delivery, final all-route
light/dark/phone qualification and the guarded full backend suite remain required.

### Stage 6 — destination and controller qualification started

The shared tab model now has an optional bounded destination that preserves
query-string and anchor history. Legacy records without it retain their existing
identity; malformed present destinations are refused during restore. Three new
regressions fail against the old model (12/15 pass) and all 15 pass after the
additive correction and core build. These two source/test files are not yet part
of a Stage 6 checkpoint commit.

The private shell controller remains unapplied. Root source review reproduced a
separate title-persistence defect: normal title changes updated mounted frames but
not tab history or durable restore. Its new regression fails before correction;
the corrected private candidate passes six focused pure-controller tests, including
query-history/pane/dock title isolation and the existing asynchronous departure
races. This is private state-model evidence, not integrated tab/pane or browser
qualification. Full shell integration and its remaining owners are still required.

The routing/context/controller foundation is now applied with App and Shell
retention still unchanged. Web no-emit passes. The actual-target tab/controller
suite passes 29/29, including missing/refusing owners, modal parking, account
changes during preparation, hidden/retired callbacks, same-object query guards,
orphaned dock origins, all-owner reload preparation and storage failure. An isolated
browser-history fixture passes 12/12 against the target router: guarded Back
restoration/refusal, accepted Back/Forward and hash changes, failed replay commit,
retired navigation owners, Settings return preservation and throwing guards. It
uses no account/API and does not qualify an actual retained editor.

Font delivery is now local: the existing DM Sans and Manrope families use eight
unmodified WOFF2 subsets with complete original OFL notices and source hashes in
`web/public/fonts`. The runtime Google stylesheet is removed; Latin faces preload
and other script subsets load on demand. The four-case browser check passes 39/39
on actual anonymous sign-in/member Teams, desktop light and phone dark: all eight
local subsets load, native rendered-glyph inspection identifies both custom fonts,
and there are no external requests, overflow, browser exceptions or unexpected
writes. All four captures were inspected. Earlier helpers stopped on an absent
paragraph selector and variable fonts' internal instance names; those receipts
remain separate. No application behavior was changed to satisfy those assumptions.
Final all-route visual qualification must now use these real fonts.

Shell integration remains in progress. Review of the private candidate found
dock hiding unmounted retained editors, tab Close hid the whole dock, and task
replacement could retain its lock or publish a late rejection after account
retirement. Corrections are being prepared before applying that candidate. Calendar
also has a competing Focus consumer that must move to the single global owner
before retention is enabled. These findings are not claims of corrected or
qualified integrated behavior.

The corrected private shell overlay now passes web no-emit after its navigation
helper and Writer binding corrections. Controlled-dependency tests of the actual
task-layer source reproduce four failures in the earlier candidate; the corrected
source passes 7/7, including detach during preparation, late account rejection,
hidden input ownership and stale Focus close. The private controller's five
global-exit tests pass, including a resource mutation while another frame settles
and a permit becoming stale immediately before teardown. The consolidated Focus
candidate also passes private web no-emit; its native UI/API behavior is not yet
qualified. Settings overlay, generic feature preparation and full shell controls
remain unfinished, so retention is still not enabled.

The separate private Stage 7 saved-view candidate passes its core/API-client
builds, backend no-emit and 24 pure filter/draft-store contracts. Four extended
filter regressions fail against the old core while its 12 existing cases pass.
The agent adapter now obtains real tag ownership metadata for grouping instead
of inventing ownership from the task's team. These shared changes are not applied
to the target; SQL admission, permissions, shared-result identity and real UI
qualification remain required. The target web build succeeds with all eight exact
font files and the local stylesheet present in its output.

The reviewed shell candidate is now applied to the local worktree, with retention
admission still disabled. Its exact frozen source chain and previous file bytes
are retained privately. Actual-target web no-emit passes; the subsequent web
production build also passes after the input-owner and Focus corrections. The
actual-target tab/controller suite now passes 34/34, including five global-exit
regressions for refusal, mutation during another frame's preparation, revocable
permits, account retirement and save-induced title changes.

Further source review found that an accepted new-task-to-Focus transition left
the prepared create dialog mounted. Controlled-dependency checks of the actual
frozen host owner reproduce that failure (7/8 pass before, 8/8 after). Cancellation
preserves the exact create presentation, and the remaining cases cover hidden
engines, replacement reasons, missing timer owners, exit revocation and account
retirement. These are state-owner checks, not native dialog or timer API proof.
Focus switching now uses the host's single preparation path rather than finishing
the same session twice. Hidden Assistant panes also refuse focused-entry scrolling
and focus until their input owner becomes active. Settings return coordination,
generic retained-frame preparation, full shell controls and native qualification
remain in progress; no Stage 6 checkpoint commit or full-parity claim is made.

Scoped native Focus qualification now passes 82 checks across five serialized
browser parts. The fixture imports the actual TaskHost, Focus, timer, Calendar,
account and kit components, with synthetic identity/server responses and controlled
clock/audio/notification effects. It covers Start/Pause/Resume, a hidden running
engine, phase logging, same-engine return, explicit End, a single switch flush,
unknown PUT readback without blind replay, account ABA/late finish refusal,
revocable global-exit permits and two Calendar callers sharing one timer. Every
API request is intercepted; this is not real persistence, actual Shell/tab UI or
physical notification/audio delivery evidence. All terminal runs report no
unexpected browser errors, authority violations or application-source drift.
Earlier fixture failures are retained: an unlisted favicon, independent Vite
timestamped module instances and an omitted Calendar check-ins read. These were
fixture repairs, not application changes made to satisfy the checks.

The Settings coordinator and scoped portal ownership are now applied locally,
with retention still disabled. Settings captures the opening working pane, keeps
its own guard/input epoch, and uses one prepared browser/topology commit when a
link changes a secondary destination. Dialogs and menus register their actual
origin rather than globally blocking unrelated panes. A regression reproduces an
old coordinator publishing Settings after its dock's working origin closed
(9/10 pass before); the corrected coordinator passes 10/10. Three additional portal
contracts bring the private source-owner checks to 13/13. They cover late own
portals blocking changed/removed/parked candidates, unrelated-pane independence
and stale/idempotent cleanup. Private and actual-target web no-emit pass; the
actual-target tab/controller suite remains 34/34. These state/fixture checks do
not qualify native Settings focus or the remaining full-route/control work.

Stage 7 shared-view qualification has now reached the marked disposable database.
The private candidate passes the 13 existing/extended saved-view tests after a
test-only correction from zero to NULL estimates; the database constraint was
retained. Two additional SQL contracts pass 252 comparisons against the core
filter across source/viewer zones, DST, all-day dates, explicit spans and timestamp
precision, plus bounded metadata/space narrowing. The MCP suite initially exposed
a priority-group contract regression and a stale test expecting custom fields to
be ignored. The corrected adapter preserves raw priority/status groups, and the
stronger fixture uses real custom-field values with exact app/query IDs and
fetch/CSV membership/order checks. All 11 MCP tests pass with outbound network
trapped. These backend/core/client changes remain private and unapplied.

The QuickLine recovery slice is applied locally and passes web no-emit. It retains
one task ID/body/key across an unknown create, protects newer input, and clears a
manual handoff only after task-host admission. Team-member discovery now starts
on first mention input instead of every ordinary Work arrival; this is a source
change, not a measured route-performance claim. A guarded API-inject check using
the actual helper confirms real create receipts, exact keyed replay, one row and
refusal to resurrect a deleted result, bringing the private saved-view/API suite
to 16/16. Native QuickLine input/recovery and its final theme/phone checks remain
unperformed.

A shared legacy departure helper now checks the global task owner and all route
guards with the same forced-disposal signal as the retained controller. Captured
input, guard, account, navigation and global-resource changes revoke its permit.
An isolated browser run passes the existing 12 router/history checks plus eight
departure-permit cases. Shell sign-out now calls this helper and captures authored
input; the final permission check still runs immediately before sign-out. Reload
caller integration remains with the controls slice. The fixture alone does not
qualify either complete UI action.
Source review confirms the existing tabs preference keeps its state owner mounted,
so the rebuilt controls will hide/inactivate tab chrome without destroying drafts.

A further MCP regression reproduced overdue saved-view pagination rejecting its
own next cursor because the trusted binding included a moving request clock
(11/12 pass before). The private correction binds the semantic overdue constraint,
while retaining version/day/zone fields; all 12 MCP tests now pass. Results remain
live between pages, not a cross-request database snapshot. Additional changed-view
and timezone cursor qualification remains open. The actual web build succeeds
with the QuickLine and legacy sign-out changes; all Stage 6 controls and final
whole-client qualification are still required before its checkpoint commit.

### Stage 6 combined shell integration — 2 November 2026

Applied the reviewed generic route lifecycle, corrected authoring handoffs, full
shell controls, per-tab Library state, singleton overlays/pinned notifications,
page commands and admitted Library creation handoff to the actual worktree.
Exact pre-apply source hashes and prior bytes are retained privately. The newer
QuickLine, router and local fonts were preserved. Workspace retention admission
remains disabled in source pending complete integrated qualification.

Corrections retain an unknown Project request body/key, guard Study's local Back,
serialize known-saved dialog navigation, use the Calendar account time zone for
date commands/search results, restore the original sidebar width on cancellation,
and require an observable input revision before a Library launch. Preference
reconciliation now uses a fresh primary read; shortcut assignment includes hidden
catalog conflicts and Reset; command feedback handles synchronous refusals; tab
filters stay reachable after the tab count falls.

Actual target production web build, scoped formatting and source-organization
check passed. Focused pure workspace/tab/shell contracts pass 48/48. Separately,
controlled coordinator contracts pass 13/13 (12/13 before the input-revision fix),
and actual SidebarSize callbacks pass 4/4 (2/4 before the cancellation fix). These
controlled tests do not establish native mounting, geometry or API behavior.

The integrated Chrome smoke test uses the actual local member and real demo API
reads, with a browser-only retention-flag override. Seven scoped checks pass:
Work render, global Import admission into the actual Library dialog without an
upload, new tab, split admission, native resize cancellation, command search, and
single-pane phone presentation without document overflow. It reports zero script
errors, unexpected writes or source drift. The app's automatic timezone POST was
deliberately blocked; login was the only permitted write. Chrome's first Escape
clears a nonempty search field and the second closes the command dialog.

Visual review found Today still applies viewport breakpoints inside a narrow
split pane, squeezing its task column; the phone workspace toolbar also consumes
too much vertical space. Both require correction and a native recheck. Full-page
captures also contain blank offscreen task areas; content-visibility capture
behavior must be distinguished from an actual scrolling defect before changing
that optimization. The earlier failed smoke and subsequent successful receipts
are retained. These checks do not close Stage 6: retained editor/tab/account,
dock, Settings, preference uncertainty and complete shortcut flows, all seven
checkpoint gates and the local commit remain outstanding. Stage 7 and final
whole-client acceptance are still required. No push, PR, merge or deployment.

#### Integrated shell visual follow-up

Applied and checked Today container breakpoints, task-list-width wrapping and a
compact workspace toolbar. In the native split view, both content grids measure
536px with a single column; task title space measures at least 426px. The shared
narrow-row rules follow the existing task-list container while TaskPanel viewport
rules and content-visibility optimization remain unchanged. The toolbar retains
Back, Forward and New tab, with secondary actions in the existing scoped menu.
On the phone it measures 60px high and 375px wide without outer overflow.

The extended actual Chrome smoke passes 11 scoped checks, including global Import
handoff without an upload, four-to-three-tab filtering and clearing without
changing selection, actual-width task/title layout, and keyboard menu traversal,
Escape dismissal and focus return. The last run has no script errors, unexpected
writes or source drift. Retention is still enabled only by a browser-test override.
Actual scrolling verifies all 17 task rows visible (maximum height 125px); the
Continue work viewport capture shows the rows. Blank offscreen full-page captures
do not justify removing the rendering optimization. Both themes and representative
phone/desktop images were inspected. The final source web build and full repository
format check passed after these changes. Existing large-chunk and static/dynamic
Notifications import build warnings remain.

These are scoped shell checks, not completion of retained draft, dock, account,
preference failure/reconciliation or whole-client acceptance. No Stage 6 checkpoint
commit has been made; all seven checkpoint gates and remaining interaction
qualification are still required before that commit.

#### Integrated retained workspace and admission follow-up

Retention is now enabled in the actual source. The earlier statements about a
browser-only flag override describe historical runs, not the current candidate.
The input controller advances authority revisions synchronously but defers its
subscriber notification until after the complete native input event. This fixes
React restoring the old controlled value between capture and bubble. Its owned
notification is coalesced and cancelled on destruction. Page settlement now uses
stable flush/pending dependencies, so a saved editor can authorize sign-out
without an unrelated render changing the registered settlement identity. Account
menu teardown occurs before global sign-out preparation.

The real local demo API retained-editor run passes 10/10 checks with zero flag
overrides: paragraph save/readback, failed-save parking, refused tab close and
sign-out, same mounted page/writer and exact pending text on return, explicit
retry with the original request body, dock hide/show and successful sign-out.
The one owned page was deleted and its subsequent read returned 404. Paragraph
blur intentionally closes its line editor; this evidence does not claim textarea
selection survives that operation. Synthetic save failures were never forwarded.
Presence/recents writes were suppressed and the automatic timezone write blocked.

Planner polling now belongs to generation-labelled mounted consumers. Token
changes retire timers/listeners without starting reads for an unadmitted account;
resources are installed before dispatch so reentrant retirement also cleans them.
Preferences similarly wait for a current-generation admitted consumer. Controlled
planner contracts pass 8/8. Actual App email/Terms gates make no planner or
Preferences reads; restoring the accepted local member restarts normal freshness.
The synthetic gated identities do not accept terms or modify real accounts.

Actual Preferences and transport with synthetic API/session responses pass 21/21:
unknown-save reconciliation requires an explicit fresh primary no-store read,
older matching receipts cannot resolve it, checking never replays a PUT, retired
owners cannot publish, and shortcut collision/Cancel/confirmed Reset preserve
unrelated overrides. These are component/transport checks, not backend CAS or
replica qualification. Pure workspace/tab/shell contracts pass 54/54.

The default sidebar now composes Today, Work, Calendar, Library and Agents with
role-filtered More utilities. Nonempty custom order/hidden choices preserve the
expanded arrangement; Reset adopts the new defaults. Starred and Pinned are real
ordered slots. Pane content owns bounded independent scrolling and restores the
same retained tab's offset. The phone drawer is immediately hidden from pointer
and keyboard interaction while closed; this fixes a reproduced viewport-change
race where its closing transform intercepted the menu button.

The latest actual Chrome shell run passes 17/17 with source retention enabled,
zero flag overrides, script errors, unexpected writes or source drift. It covers
Settings over a preserved Work draft, cancelled cross-route creation, actual
Library import dialog admission without upload, tab/filter/split actions,
independent scrolling, pane-width layout, resize cancellation, command search,
grouped phone navigation, keyboard workspace actions and account gates. The long
frame measures 815px inside a 1000px viewport with 4707px scrollable content.
Desktop light and phone light/dark captures were inspected. Full-page offscreen
capture blanks remain distinct from the verified visible scrolling behavior.

All seven final checkpoint gates and the Stage 6 local commit remain pending.
Stage 7 shared/UI candidates are private preparation, requiring integration over
these newer ownership fixes, native interaction/API qualification, the final
all-route/theme/phone audit and guarded full backend suite. No push, PR, merge,
provider configuration, deployment or desktop cutover has occurred.

#### Final automatic-read continuation correction

Final source review found a same-generation retirement gap despite all seven
initial checkpoint gates passing: a held automatic team read could dispatch its
next batch after the last admitted consumer unmounted. Controlled regressions
reproduced both that follow-on dispatch and stale planner metadata publication.
An internal automatic-owner predicate now fences each continuation; public
explicit refresh remains independent. The shared PlannerItemStore accepts the
same optional predicate (default true for existing callers), checking it before
network dispatch, fallback, subsequent delta pages and snapshot publication.
This is needed because its own asynchronous continuations outlive the outer
refresh await. Desktop/mobile calling conventions remain valid.

The automatic-admission controlled module checks pass 11/11 (9/11 before), and
actual shared item-store tests pass 15/15 (13/15 before), including held snapshot,
legacy fallback, next delta page and newer explicit refresh preservation. Earlier
source-only review does not cover this newer root package correction. The final
checkpoint gates must be refreshed for this candidate before its local commit.

### Stage 6 checkpoint

The corrected retained shell candidate passed all seven required checkpoint
checks: repository formatting, full workspace types, source organization,
project-document checks, GitHub helper tests, production web build and all
week-scene tests. Source hashes were unchanged throughout that run. The final
actual Chrome shell run then passed 17/17 again with zero source drift, errors,
unexpected writes or retention overrides. The documentation-only checkpoint
receipt was checked separately after those source/build checks.

This closes the scoped Stage 6 implementation group for a local commit. It does
not close Stage 7 or whole-client acceptance. Remaining work includes the prepared
native task-transfer and rich Peek changes, exact shared saved-view filters and
recovery across all consumers, the other recorded unexercised feature flows,
all-route light/dark/phone coverage and the guarded full backend suite. No push,
PR, merge, provider configuration, deployment or desktop cutover is part of this
checkpoint.

### Stage 6 local commits and Stage 7 integration started

The retained shell group is committed locally as `ef12f98d`, followed by
`ac2c909d` preserving the exact upstream font licence bytes. The first staging
verification caught Git normalizing the DM Sans licence despite its recorded
source hash; the commit command was mistakenly allowed to continue. The separate
follow-up preserves history and corrects that sole licence. All committed font
and licence bytes now match the provenance manifest. A font-local attributes
file preserves those upstream notices and their intentional whitespace; product
source still matches the passing checkpoint checks. The worktree was verified
clean before Stage 7 integration. Nothing was pushed.

The reviewed Stage 7 shared core/API/backend source and reconciled web UI are now
applied, uncommitted. They add task-transfer formats and keyboard alternatives,
read-only negotiated block Peek, exact shared task filters and bounded planned
membership, shared saved-view readers and revision-aware save/recovery. The
newer Stage 6 controller, page settlement, sidebar, automatic-owner permits and
shared item-store validity guards were preserved. Each planned batch checks its
captured owner before dispatch and after await; scoped Writer drops require an
explicit safe nonnegative input epoch rather than treating a missing epoch as
zero. Source/type checks do not qualify their complete interaction matrix.

A new actual test-database regression reproduced a redundant saved-project
status override returning different membership from the stored definition. The
saved-view adapter now uses canonical active/done shared status semantics; the
separately established ad-hoc capability query semantics remain unchanged. The
same focused test passes after correction, and the complete MCP links/views
suite passes 13/13. Actual target saved-view SQL/API tests pass 15/15, including
bounded preselection, session ownership, CAS/old-writer protection and 252
SQL/core comparisons over source/viewer zones and DST/date cases. The pure
saved-view/draft/item-store group passes 39/39. Web and backend no-emit checks
pass, and package builds pass. These are local guarded test-DB/API-inject checks,
not live provider, production or whole-backend-suite evidence.

Controlled actual planner-module checks pass 14/14 after integration: last-owner
retirement stops held planned reads from launching later batches or publishing a
partial feed; complete 401-item membership uses 200/200/1 explicit batches;
explicit refresh requires no automatic consumer; failure clears completeness
instead of presenting stale Today membership. Dependencies/session/timers are
controlled, so this does not establish native request timing or server behavior.

The first actual Chrome Work-to-Writer task drop passes using native mouse input
and trusted dragstart/drop events in two retained panes. Exactly one page PUT
inserts the typed task link after the original paragraph, with real API readback.
The task matches its pre-drag detail snapshot; the page and task were deleted and
both subsequent reads returned 404. Dark desktop capture was inspected. Earlier
failed attempts remain recorded: the driver first expected a wide-only Note
control instead of the narrow menu, then compared a create DTO against a richer
GET DTO. Neither establishes a product defect. Both failed-run fixtures were
removed only after matching their original journalled create-body hashes and
verifying their exact owned content. The corrected run has no browser errors,
unexpected writes or source drift. Ancillary presence/recents writes were
suppressed; timezone writes refused; no provider or external request was allowed.

Stage 7 remains unfinished and uncommitted. Native Calendar timed/day/3D and List
transfers, Board/manual order, keyboard/touch/refused clipboard alternatives,
late-target/permission/account failures, rich read-only Peek, real saved-view UI
and all consumers/recovery cases still need qualification. Other recorded
unexercised feature flows, the final all-route light/dark/phone audit and guarded
full backend suite remain part of the original end state. No PR, merge,
deployment, provider configuration or desktop cutover is claimed.

#### Stage 7 native transfer, command Peek and pane sizing follow-up

Native Work-to-Calendar timed placement and whole-day placement each passed using
trusted mouse drag events, one exact session POST, primary `/planned` and `/blocks`
readback, unchanged task/preferences and revision-conditional session-first
cleanup. Visual review then reproduced a real pane-sizing problem: at a 1600px
viewport the retained Calendar was 672px wide, but its main surface was only
340px beside a 296px rail. The read-only layout probe failed that exact condition.

Calendar now observes its own content width, retains its last valid measurement
while hidden and disconnects its observer on retirement. Named container queries
style descendants; measured root classes stack the side rail below narrow panes.
Week remains Monday–Sunday at every width, replacing the previous adaptive one-
or three-day Week range. Day and Agenda remain explicit alternatives. Narrow
headers stack weekday/date with 44px height and view controls retain 44px targets;
font roles and viewport-only portal/inspector/global Focus rules are preserved.
The corrected native layout probe passes five checks across retained desktop,
375px phone and a wide hide/return sequence, including same DOM, selected week,
header bounds, theme controls and no horizontal document overflow. All ordinary
columns fit this fixture; no positive horizontal-scroll travel is claimed where
there was no overflow. Desktop dark and phone light captures were inspected.
The combined timed/day transfer run then passed both cases again on the corrected
source, deleting both owned sessions and tasks with verified absence/readback.

Source inspection and a native failing-before run also found that modified Enter
in the command palette did not open the requested Peek. Submit events do not carry
keyboard modifier ownership; the correction handles Cmd/Ctrl+Enter on the input,
attaches typed object targets to both ordinary and full-text results and separates
Peek from the explicit background-tab action. Five native checks now pass:
keyboard Peek, close/focus restoration, modified pointer Peek, full-text Peek and
explicit background tab creation. The unsent Work input remains the same node
with the same text, URL and working tab count when peeking. No domain writes,
script errors or source drift occurred. Earlier fixture loading/focus assumptions
remain recorded separately from the product defect. Web no-emit checks pass for
both source corrections.

The saved-view native flow used four fresh tasks: one blocked/high/no-estimate
match and three exclusions. Native status, priority and size selection, one exact
keyed create201, toast Open, View reload and primary run-by-ID preserve the exact
shared definition and sole matching task. Native CSV downloading also succeeded;
the driver then incorrectly expected a Title header rather than the core Name
label. A separate root check verified the actual downloaded header and exact one
row, excluded all three other tasks, repeated primary definition/membership reads
and matched existing preferences/favourites/views to their initial fingerprints.
The owned View and four tasks were then removed, with the View library restored
and each task returning404. This is three checks in the original runner plus the
separate recorded CSV/cleanup verification, not an uninterrupted four-check pass.

The native select driver was corrected using a read-only actual input-event
probe: on this headless Mac Chrome, Home/arrow input did not change the select,
while native typeahead produced trusted input/change events and selected High.
No application change was needed. Earlier failed-run tasks were removed only
after original create-body hashes, unchanged version1 and canonical fields
matched. The final reused cohort was similarly verified and removed; no QA tasks
or Views from those saved-view attempts remain. Source/driver failures and all
recovery receipts are retained.

Rich Peek's first native attempt opened the exact format2 fixture from a preserved
Work draft and visibly rendered its heading, emphasis, code, table, inline/display
math, Mermaid, nested ordered/checklist content and task link. The run stopped
before full acceptance because its read boundary incorrectly rejected ordinary
empty search, Calendar search and the LiveList parser's default layout. No browser
mutation was forwarded. Its exact owned task/page remain preserved for guarded
reuse. The linked-object Details read-only correction is still a private candidate;
its failing-before native proof and subsequent qualification remain outstanding.
No Stage 7 checkpoint commit, final route audit or full backend-suite completion
is claimed by these focused results.

#### Stage 7 read-only Details and native List transfer

The corrected rich Peek driver reused the exact previously preserved task/page,
requiring the original create-body hashes, fixed member ownership, version1 and
unchanged authored content. The native before run passed its first three checks
and reproduced enabled Mark done and Change deadline in linked-task Details. No
mutation was clicked or forwarded. LinkedObject now consumes the existing page
read-only context, hides task editing, refuses its common write boundary and
disables new meeting-note creation while preserving metadata and Open. Normal
pages retain the default editable context; their follow-up regression is pending.
The after run passes six checks with zero errors, boundary violations or source
drift. Exact retained fixtures were removed with verified absence.

Screenshot review found an unbroken page title clipping in the 375px preview.
The Peek heading now wraps within its own width without altering the text role.
A fresh six-check native run passes an additional title-width assertion in dark
and light desktop and dark phone, with unchanged page/task data and verified
cleanup. The phone capture was inspected. These runs do not cover every file,
media, permission or recovery variant of Peek. Web no-emit checks pass.

Native Lists-to-Calendar timed and whole-day transfers both pass on the current
source. Trusted drag events from the selected List's own row produce exactly one
expected session each; primary planned/blocks reads agree, task snapshots and
planner preferences remain unchanged. Cleanup deletes both sessions using their
revisions, then both version1 tasks, then only the new personal list after exact
metadata and an all-kind/all-status empty-list read. No errors, unexpected writes
or source drift occurred. The screenshot was inspected and exposed a separate
layout issue: the List catalog occupies too much of a narrow retained pane. A
pane-width correction is being prepared. 3D and adverse transfer variants remain
open. These focused results do not close Stage 7 or authorize a commit yet.

#### Stage 7 normal-page regression and Lists own-width layout

Normal-page linked task Details retains editing after the read-only Peek fix. A
fresh native run passes three checks: enabled completion/deadline controls, one
exact completion POST with201 and primary readback showing done/100%, next
version and exactly one owned timeline record, then explicit close with the page
unchanged. No page save, errors, unexpected requests or source drift occurred.
The completed-state capture was inspected. Deadline mutation and event-note
variants remain separate. An earlier run passed these same functional assertions
but refused ordinary document-presence/import GETs because the driver's read
allowlist was incomplete. Its failure was retained; exact original factory hashes
and the confirmed completed-task fingerprint were checked before separate
cleanup. Neither completion was replayed. Both runs' pages/tasks are absent.

The read-only Lists layout probe reproduced the fixed300px catalog squeezing a
selected list inside a672px retained pane. Lists now has its own inline-size
container: narrow panes show the selected detail at full width and All lists
returns to catalog/search. Wide panes retain both columns. Initial automatic
selection uses observed pane width; manual selection or All lists establishes
explicit intent and resizing preserves it. The observer ignores hidden zero
widths and disconnects on retirement. Full titles and actions wrap independently
at existing text roles; narrow buttons retain44px targets.

The after probe passes four checks: detail width/title/actions, All lists staying
unselected, phone retained DOM/44px actions, and catalog search/selection surviving
a wide return. Native theme control and dark desktop/light phone screenshots
were inspected; source and existing list records remain unchanged. The probe
uses an existing authorized team list, because all temporary personal lists had
already been cleaned up. Its first attempt stopped before browser creation when
no personal list existed; two earlier module-resolution errors had no runtime
effects. Web no-emit checks pass.

The timed/day native Lists-to-Calendar pair then passes again after the layout
change, including exact session requests, planned/blocks readback, unchanged
tasks/preferences and revision-aware session-first cleanup. Both tasks and the
fresh empty personal list were also removed and their absence verified. Nine
controlled tests of the actual shared drag module pass for board-format
preservation, task/event references, malformed inputs, account/ABA fencing and
single consumption across nested handlers. Their DataTransfer/session objects are
synthetic; native touch and permission recovery are still unqualified. Stage7
remains uncommitted and incomplete.

#### Stage 7 native 3D Calendar task transfer

Work-to-3D Calendar timed floor and upright day-sign drops pass using actual
projected DOM geometry, browser hit-testing and trusted native mouse drag
events. The selected narrow-pane Day chip reveals the intended lane without
changing camera state through test hooks. Timed placement is exactly10:00; day
placement follows the existing free-slot policy. Each creates exactly one manual
30-minute session, agrees with primary planned/blocks readback and leaves the
task and planner preferences unchanged. Both dark captures were inspected.
The complete two-case run has zero errors, unexpected requests, unknown outcomes
or source drift. Both revision-bound sessions and version-bound tasks were
removed, with absence verified. This proves this local projected floor/sign
interaction, not phone/touch, arbitrary camera poses or dense occlusion.

The first timed attempt passed its functional assertion but stopped at the final
request boundary because the driver's read allowlist omitted the ordinary
authenticated `/events` stream. Its failure is preserved. A separate receipt-
bound cleanup matched the original task factory/body hash, canonical task
fingerprint, session identity/revision/times and primary feeds before deleting
that exact pair; no gesture or uncertain mutation was replayed. The endpoint was
verified in the realtime source, the read allowlist corrected and the fresh
timed/day pair above then passed. No application source change was needed.

#### Stage 7 Writer ownership and shared task mutation correction

The actual Writer component passes23 controlled drop cases: six invalid entry
epochs dispatch no item read/edit; valid zero/positive epochs insert one typed
link; held reads followed by epoch, visibility, activation, path, account, page,
store, permission or document changes cannot insert stale content. The actual
React, route/session, client transport and core edit implementation run against
synthetic Page/state/responses and scripted untrusted drop events. No API request
is forwarded. This is lifecycle evidence; native drag and persistence remain
separate. The first fixture lacked Vite's React preamble; adding that normal
fixture setup allowed the complete run without changing application source.

The Work audit identified an unguarded continuation between bulk batches and
shared task mutation helpers that could resume under a replacement account.
Controlled actual-store regressions reproduced new-account settlement reads, a
handoff's second write, queued delete dispatch, old Undo, old delete failure
publication and old optimistic failures clearing newer state. Shared helpers now
capture the numeric session generation before effects, fence later dispatch and
settlement, and bind each optimistic change to its own layer. Clearing an older
layer preserves a newer pending edit. Queued delete/Undo and late delete receipts
retain their opening generation. Ordinary completion and Undo still work in the
controlled positive case. No backend contract was changed.

The expanded matching harness passes only one of nine cases on the preserved
before source and all nine on the correction. A further synchronous account
change during optimistic publication reproduced one more pre-dispatch hole; the
additional dispatch check closes it. The final actual-store controlled run passes
10/10, and the separate planner admission/continuation suite still passes14/14.
One intermediate timer fixture incorrectly retained a fired timer; its correction
and failed attempt are retained. Web no-emit checks pass. Real native Work
completion/Undo requalification and the separate BulkBar owner correction are
still pending; these tests do not qualify the full batch UI or real-account UI.

#### Stage 7 Copy fallback, Board transfer admission and bulk caller ownership

The Copy task link fallback passes three checks on an existing owned task without
forwarding domain writes: keyboard menu activation and exact selectable read-only
URL,375px pointer equivalent, and a held clipboard rejection after same-member
account-generation replacement. Draft, tab, URL, close-focus and primary task
fingerprints are preserved. The phone capture was inspected. Clipboard denial
and the held promise are synthetic; no physical touch or host clipboard write is
claimed. On headless Mac, the modifier chord alone did not emit a copy event, so
the driver invokes Chrome's native Copy editing command and observes a trusted
copy event whose default is prevented. The initial failed chord check is retained.
An earlier attempt stopped before browser creation because API/Vite had stopped;
only the task's local servers were restarted as tracked processes.

Board's custom card drop previously bypassed the shared transfer's account stamp
and single-consumption check. Controlled actual Board-handler tests reproduced
old-account/ABA admission, signed-out admission, duplicate dispatch and mismatched
card/reference identities. Board now consumes the shared typed reference and
requires its identity to match the card payload. The same seven-case harness
passes2/7 before and7/7 after, retaining valid current and unstamped legacy
references. The JSX/hooks and direct handler calls are controlled: this does not
prove native Board column changes or the Work move owner's pending gate. Web
no-emit checks pass.

The actual BulkBar baseline then reproduced a fifth task dispatch under a
replacement account generation and stale success/selection clearing. The guarded
component captures one synchronous operation before awaits, revalidates its
mounted account, visible scope/path/activation and selection before each dispatch
and after each batch, and checks current permissions. Old results cannot release
a newer busy operation or clear replacement selection. Admission requires focus;
continuation deliberately survives focus moving to another visible pane. Undo
has generation-only authority so it remains usable after legitimate route leave,
but cannot use a replacement account or replay a second click.

All22 controlled actual-component cases pass, including owner changes, selection
ABA, partial failures, permission revocation, same-turn admission, field batches,
confirmation Cancel and Undo. The actual React/kit/routes/session component is
rendered against in-memory planning/write/delete services; zero API requests are
forwarded, with no errors, unexpected requests or source drift. Web types pass.
Real-API bulk and native completion/Undo checks remain separate. A status-only
Undo follows the existing backend contract: it reopens status while preserving
current progress; it is not a claim to restore every pre-completion field.

#### Stage 7 Work move owner and native completion/Undo

The actual Work/Board baseline reproduced two overlapping pending column writes
for both status and priority. Work now shares one synchronous move owner between
column changes and manual ordering. Its visible saving state disables move
controls; account, mount, scope/path/activation and visibility fence late errors
and unlocks. Focus is required at admission but moving focus to another visible
pane does not cancel the admitted operation. A failed current move reports its
error without automatic replay; a later explicit intent can retry. All18
controlled actual Work/Board/TaskRow cases pass, including replacement ownership,
permissions, same-turn duplicate input and Board/List shared locking. Web types
pass. Services/account responses are controlled with zero API forwarding; native
column moves and persisted sibling ordering still require their own checks.

A fresh personal task then passed the real local native Work completion/Undo
sequence: exact completion201 at version2, done/100% and one timeline entry,
actual Done toast Undo201 at version3, original todo status and exactly two
entries, then settled primary readback with no further writes. Existing backend
status-only reopening preserves100% progress and increments reminder invalidation
once; every other field was compared to its expected preceding receipt. The
completion and Undo clicks were trusted native input. No errors, unexpected
requests, unknown outcomes or source drift occurred. The dark capture was
inspected, and only the confirmed version3 test task was deleted with204/404
verification. This is the same-account successful task path, not bulk, recurrence,
checklist, handoff or cross-account native qualification.

#### Stage 7 local checkpoint and native Board, ordering and bulk acceptance

Local checkpoint `e136e413010400b6ca710a45b8a042f542d08499` contains the verified
Stage 7 group. All seven required checkpoint gates passed against its exact staged
bytes: formatting, workspace types, code organization, current document links,
GitHub helper tests, production web build and backend week-scene tests. The
staged file set and blob hashes were checked against the gate receipt before
commit, and the clean committed tree was verified afterward. Nothing was pushed.

The native Board run passes three checks on a fresh personal task: trusted card
status drag to In progress, native Columns selection and Move menu to High
priority, and settled primary readbacks with unchanged persisted preferences.
The exact status POST returns version 2 and the priority PUT returns version 3;
unrelated fields are compared to preceding receipts. Only the confirmed version 3
fixture is removed with 204/404 proof. An earlier run passed both mutations but
its bubbling event observer lost the detached target's column identity; capture
phase fixed the private observer. That original task was independently reconciled
against its saved full version 3 fingerprint before cleanup. Application source
was unchanged by this qualification.

Manual ordering passes three checks with a fresh private list and exactly three
tasks: native Move up, trusted HTML drag before the first row, and reload with
persisted sibling ranks. Every sibling's rank and full primary record are checked;
only position and appropriate update timestamps change, with edit versions
remaining 1. The actual preferences remain unchanged; preference writes are
synthetic in this bounded test. The dark drag capture was inspected. All three
confirmed tasks and then the confirmed empty list were deleted with readback.
An earlier private-driver callback missed its browser argument; after correction,
that original cohort's arrow passed but its reload assertion rejected a valid 304. The exact saved fingerprints were reconciled and cleaned, and the complete
fresh run disabled browser caching to obtain explicit response bodies. Failed
attempts are retained; neither was an application ordering failure.

Native bulk status and Undo pass four checks: actual selection mode, labelled
checkbox and Select all five; five exact Done POSTs at version 2; native click on
the actual six-second success toast's Undo; and five todo version 3 primary
readbacks with trusted input, exactly ten forwarded status writes, unchanged
unrelated fields and no further effects. Transport stayed within four concurrent
requests; the fifth followed the first four response headers. Status-only Undo
preserves 100% progress under the existing backend contract, with two timeline
entries and one reminder-version increment. All five full final fingerprints were
confirmed before versioned cleanup, each returning 204 followed by 404.

The first bulk attempt hit the local session rate limit during safety reads;
all five status requests were refused before forwarding. The original journal
was retained, all five records were confirmed identical to their original version
1 fingerprints, and the same cohort was used after a full rate-limit window.
The successful run had no errors, violations, unresolved outcomes or source
changes. Account preference reads use a synthetic deterministic presentation in
this test, while actual persisted preferences are separately compared unchanged.
This qualifies bulk status/Undo, not other bulk fields, deletion or recurrence.
The full guarded backend suite and remaining parity/route acceptance are still
required before completion.

#### Stage 7 full backend result and MCP metadata correction

The complete default backend suite selected all 630 `tests/*.test.ts` files and
finished with 5,857 tests: 5,851 passed, six failed, zero skipped, cancelled or
todo. The complete log and terminal receipt were inspected. All tracked source
and package output hashes stayed unchanged during that run. Tests used only the
owner-verified `orbyn_test` database with its persisted `test` marker on the
loopback-only test container. App environment loading was masked in child
processes, with an allowlisted process environment and network isolation.

Three failures were in the private qualification environment: a global
PAGE_FILES_DIR override conflicted with agent-files' own temporary FILES_DIR,
and the TCP guard rejected two netguard tests before their explicit pinned
lookup could resolve a fake hostname to their own local HTTP server. The corrected
runner leaves PAGE_FILES_DIR unset. Its guard validates every actual address from
a supplied lookup before connecting; default external hostnames, public resolved
addresses and demo-service ports remain refused. Positive pinned-local HTTP and
negative external/protected-port controls all pass. The original failures remain
in the full-run log.

The other three failures exposed MCP metadata omissions from the saved-view
integration: generated catalog drift, workspace discovery exceeding its strict
28,200-character limit, and the new signed-in views/capabilities route missing
from the capability inventory. Seven descriptions are shorter without removing
any typed filter, parser, validation rule or feature. The interactive view
negotiation route now has an explicit protocol exclusion; connected agents use
the typed save_view schema and views specification. Catalog version/changelog
2026-11-02 records the changed view contract, and the canonical generator refreshed
all seven changed catalog/distribution outputs. These are local generated files,
not a published plugin or deployment.

All seven affected backend test files subsequently pass 70/70 with unchanged
source, no skips and no network refusals: agent files, netguard, MCP catalog,
toolsets, route inventory, MCP saved-view links and saved-view SQL/API contracts.
The same strict budgets and route ratchets remain. This is a completed full run
followed by passing affected rechecks, not a claimed uninterrupted green rerun of
the whole suite.

#### Stage 7 task-panel fork ownership and native recurrence edits

The actual TaskHost/TaskPanel baseline reproduced two defects under controlled
service boundaries: a dirty title followed by an immediate status change caused
an extra stale-status write, and a later Following split left the host on the old
ID while a subsequent save combined the new ID with the old version.

The corrected host conditionally adopts a successful save receipt only for its
exact current presentation and account generation. The returned series becomes
the host's task identity; mismatched detail/list records cannot merge, and the
old occurrence reference is cleared on a fork. Field save no longer interprets
a retained draft status as new status intent. Immediate status controls retain
their separate owner. A synchronous operation protects later reads, receipt
adoption and UI settlement across account ABA, unmount and host retirement.
Newer typing survives an earlier save receipt. A known successful write followed
by a failed detail read adopts its known ID and requires explicit read recovery
before another field write.

Web typechecking passes. The controlled actual-component/host run passes 14/14,
including repeat save/version/link/section targeting, stale old-series reads,
409 draft preservation, known-success/read-failure recovery, same-turn admission,
retired results and legitimate visible-pane focus loss. The two baseline checks
are defect reproductions, not qualification passes. The private runner originally
shadowed its report-save helper with its UI-save helper; root renamed the latter
before any execution. No API traffic was forwarded by these controlled checks.

A separate real local native run passes five checks: scope-dialog Cancel retains
the dirty title with zero edit; This at the current occurrence records exactly one
title override without changing the base title/rule; native Calendar navigation
opens the later occurrence; Following returns a distinct version-1 series while
the original becomes version 3 with the correct cutoff; and both primary records
and finite Calendar expansion remain exact with no status or planner writes.
The new series has four remaining occurrences and the original retains only its
first occurrence and override. Both full fingerprints are confirmed before any
cleanup, then each versioned deletion returns 204 followed by 404. No errors,
violations, unresolved outcomes or source drift occurred. Both dark desktop
captures were inspected. This qualifies successful title scopes and Cancel;
scoped deletions, lost-response recovery, other recurrence variants and the final
whole-client route/theme/phone acceptance remain open.

#### Stage 7 follow-up checkpoint and native scoped recurrence deletion

The task-panel ownership and MCP metadata group is committed locally as
`e48d38e8bf1e7e118cce2a4e509c71877bf5be96`. All seven required checkpoint gates
passed on its exact 14-file change set, with no source drift. The index was clean
before staging; the staged path set and every blob hash were verified against
the gate receipt before commit. Committed blob hashes and the clean worktree were
then verified. Nothing was pushed, merged or deployed.

A further real local native run passes eight checks, including its successful
Cancel/This/Following edit setup. It reopens the returned series at its third
original occurrence, cancels Delete with zero effects, then chooses Delete This.
The server returns 204; the series remains at version 2 with exactly that
occurrence excluded, unchanged status/progress and no other field changes.
Calendar readback excludes only that occurrence. Reopening the next occurrence
and choosing Delete This and following returns 204 and version 3 with the exact
cutoff and the earlier exclusion preserved. The final Calendar contains only the
original series' first occurrence and the fork's first occurrence.

Both full records are verified before either scoped deletion and before cleanup;
each final version-3 whole-series deletion returns 204 followed by 404. All input
is native, and the run reports zero errors, violations, unresolved outcomes or
source drift. Both Calendar captures were inspected. The private driver pauses
for a complete existing rate-limit window between setup and extra deletion reads;
no server limit is changed and no failed effect is replayed. This is successful
scoped deletion and Cancel evidence, not lost-response, cross-account or whole-
series Delete UI qualification. Lost field-write recovery, other parity cases and
the final all-route/theme/phone audit remain open.

#### Stage 7 uncertain field-save admission and recovery

The task editor now preserves the original ID/version and submitted draft when a
field save has no known receipt: network failures, timeouts and server errors do
not permit a second save. A synchronous ref latches that uncertainty before the
operation unlocks. Read-only Check state reads the captured original ID and
reports its version comparison; neither a changed nor an unchanged version
identifies a successful recurring fork, so neither unlocks Save or invents a
Saved result. Review calendar opens separately and preserves the current draft.
Known rejected writes and known saved receipts retain their existing recovery.

Newly initiated Star and Meeting note actions also check the current presentation
and operation ref. The first candidate's event probe exposed that rendered
unknown-state disabling alone left the earlier pending-save window open: both
actions ran and the note action retired the editor. The corrected live admission
checks block that same queued attempt while preserving idle favourites on readable
view-only items. Already-running action lifecycles are a separate contract.

The original source reproduces both blind Following-save attempts. The final
controlled actual-component run passes 20/20 checks, including the fourteen prior
fork/ownership cases, lost-response cases before and after modeled commits,
newer typing, account ABA, retirement, and queued event actions. Read-only checks
never replay the write. There are no script errors, forbidden requests or source
drift. These are actual React/DOM components with controlled transport and
planning adapters; no API write is forwarded and no backend execution result is
inferred from the model.

Root inspected the notice with the actual token, kit and task-panel styles at
1500px and 375px in both themes. The initial private capture omitted shared CSS
and was rejected as visual evidence; the corrected styled capture exposed a
16px calendar-link target. Reusing shared action styling now gives both recovery
actions 36px desktop and 44px phone targets. All four final captures are
contained and their programmatic focus checks pass. This is component layout
qualification, not native-input or full accessibility qualification. The final
private receipt is `stage7-taskpanel-unknown-after-5`; real local lost-response
recurrence, other parity flows and whole-client route acceptance remain open.

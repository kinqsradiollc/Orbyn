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

Not built, and showing "This screen hasn't been rebuilt yet": Teams, Booking,
OAuth consent and public booking pages. Admin and Developers are integrated locally
with scoped Stage 4 qualification recorded below. Settings now has its
modal and all six category implementations, including ChatGPT and legacy aliases.
This stage has completed its scoped interaction checks and required checkpoint gates.
External delivery/provider limits and the final whole-client checks remain open.

## How to run

    docker compose up -d postgres mailpit
    npm run migrate
    APP_URL=http://localhost:5175 PORT=8008 npm run dev:api
    API_PROXY_URL=http://127.0.0.1:8008 npm run dev -w web -- --host 127.0.0.1 --port 5175 --strictPort

## Parity gaps

Every capability of `desktop/` must exist in `web/` before cutover. The known gaps:

From Work and Lists:

- Row drag to calendar or a page was dropped. Needs an equivalent.
- Task completion uses the confirmation toast with Undo. The user explicitly
  approved this replacement for the celebration effect on 1 November 2026.
- Focus: custom rhythms, sound and notifications, and picking up a session running on another device.
- Peek for pages renders plain text, not blocks.
- Saved views: priority, size, single status; Today loses planned sessions; Tomorrow and Due soon approximate.
- Work quick line: `@name` needs team members loaded.
- Not exercised: board drag, bulk actions, Focus timer, Peek, Save as view, team-only flows, repeat scopes "this" and "following".

Cross-screen wiring:

- Calendar reads ?plan=<itemId> and ?date=YYYY-MM-DD.
- Assistant reads ?task=<id>.
- Library honours #blockId on /app/doc/:id.
- Cmd-click links and Cmd-K call tasks.peek. Command bar must search work, not only places.

From Calendar, built but not exercised:

- Plan: pin by dragging a proposal, estimate editing, What if, experiments, roll forward, stale banner.
- Alt-drag copy, dropping a task from the rail, touch drag on a phone.
- Rollback for an event move.
- Manage tabs: create, edit, delete for sets, subscriptions, feeds, frames, habits.
- Teammates overlay with people selected. Focus handover between devices. Find time with a task that needs time.
- Week starts Monday in every mode. The user confirmed this rule on 1 November 2026.

Shell parity (lead), from desktop/src/app and desktop/src/app/chrome:

- Command bar: page commands, pins and filters. Search, add and go-to work.
- Tabs and the tab strip, split panes (workspace duo), the side dock.
- Sidebar arrange, rail mode, resizer. Starred and pinned groups work.
- Update-available banner. Announcement, maintenance and email gates work.
- Shortcut sheet and custom shortcuts. Live events reconnect. What's new sheet. Activity dialog.

From Today, Projects, Views, Notifications:

- Character art (Character, CharacterEditor) not in web; Browse shows names only.
- Assistant proposals on projects: simplified, needs full ProposalReview diff. AssistantAgents dialog replaced by links.
- Unsaved link draft warning only on the back button, not sidebar navigation.
- View refinements (priority, size, status) in prefs only: not in CSV, shared viewers or server limit. Work SaveViewDialog must write them to view:<id>.
- First run: final step unverified on a fresh account; preset application unverified.
- Mock-only: Notifications actions, 409 move retry, session check-ins. Not exercised: project assistant drafting, file import, cover upload, claiming, promises, asks, agent questions, welcome back, 3D relation map node open.
- Shell: bell unread badge, pinned-views group, mount FirstRun, WhatsNew and pinned panel globally, Today search dialog pattern into command bar.
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

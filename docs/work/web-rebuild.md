# Web client rebuild

A new web client in `web/`, written from scratch to replace `desktop/`. No code is
copied from `desktop/`, which stays the behavior reference until cutover. Shared
`@orbyn/core` and `@orbyn/api-client` stay. This work is in progress and unfinished:
`web/` is not deployed and nothing points at it.

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

Not built, and showing "This screen hasn't been rebuilt yet": Assistant, Background,
Overnight, Review, Teams, Booking, Admin, Settings, Developers, OAuth consent and public
booking pages. `web/src/screens/agents-shared` holds an unfinished start on the Agents
screens that nothing imports yet.

## How to run

    docker compose up -d postgres mailpit
    npm run migrate
    PORT=8008 npm run dev:api
    API_PROXY_URL=http://127.0.0.1:8008 npm run dev:new-web

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

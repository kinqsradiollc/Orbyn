# Unified assistant conversation implementation

Owner: this implementation chat. Base: `db4eb64956cf7cbdeebc468d459c1deae2856440`.
Scope: all eleven acceptance cases in [the accepted ADR](adr-unified-assistant-conversation.md).
Status: implemented and locally qualified within the authorized web/Expo-web scope.
Rollout remains disabled. The final audit records the pre-commit qualification;
the user subsequently requested a separate implementation PR.

## Ownership and sequence

1. Establish shared contracts and transactional storage/lifecycle together. The
   backend owner also owns admission, completion and delivery; these writes are
   coupled and cannot be safely split between concurrent implementers.
2. Wire the feed, reply context, read cursor, notifications and recovery into the
   existing runtime. Keep foreground jobs independent of background execution.
3. Once transport contracts stabilize, update desktop/web and mobile clients.
4. Verify all ADR cases, review the actual diff and record remaining gaps.

The other session owns the existing policy/skills changes and audit documents.
Do not stage, reset or format them. Native delegation is unavailable under the
current host's advertised Priority-only processing contract and the repository's
standard-only policy; direct implementation uses the documented fallback.

## Storage decisions

- A destination has a stable stream ID, distinct from its execution chat ID.
  Deletion or sweeping retires it. Workers cannot create or replace destinations.
- Explicitly opening the personal conversation may create a new generation.
  Existing personal chats are not silently designated or bulk imported.
- Timeline history survives execution-history truncation. Retain it until the
  person deletes the conversation/account; no silent age-based expiration.
  Export must include retained timeline content with current authorization.
  Retirement must erase content and provenance while retaining only content-free
  identity needed to prevent stale delivery. No rollout before this is wired.
- Publication and alert delivery are distinct. Stable intent/event keys and
  per-stream sequence allocation belong to PostgreSQL transactions.
- Source dependencies belong to individual entries, not the canonical chat.
  Delivery, reads, replies and provider context must each check current access.

## Evidence ledger

| Unit                                  | Final state                     | Evidence                                                                                              |
| ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Shared schemas and storage            | Locally qualified               | Retained timeline, exact source graph, export, generations and fresh migrations through 289           |
| Admission and transactional delivery  | Locally qualified               | Independent executions, per-window/destination summaries, replay, retention and exact waiting answers |
| Authorized feed, reply and read state | Locally qualified               | Current per-entry authority, bounded context, shared cursors, legacy compatibility and derived Memory |
| Desktop/web and mobile UI             | Locally qualified               | Shared web and Expo web interaction checks; phone-width rendering at 320px and 390px                  |
| Attention and rollout                 | Locally qualified               | Quiet/DST/no-op/mute, one logical alert, rollback/re-enable and existing channel ownership            |
| ADR acceptance 1–11                   | Audited within authorized scope | Final matrix below; native and live-provider/OS-push qualification excluded                           |

This table is the final state. Earlier dated entries preserve development progress,
failures and then-open requirements; they do not supersede the final audit.

### Foundation checks — 21 October 2026

- `npm run build:packages`: passed.
- `npm run typecheck -w backend`: passed.
- Guarded disposable PostgreSQL: new migration successfully applied. The owned
  container is `orbyn-conversation-goal-test`, loopback port `55434`, tmpfs data;
  it has the repository test marker and contains no application data.
- Focused conversation suite: 7 passed. Covers concurrent explicit opens,
  cross-owner rejection, actual chat-writer truncation at 200 with 205 retained
  entries, monotonic shared read cursor, per-entry source deletion filtering,
  disabled accounts, transaction rollback, delete/sweep tombstones and malformed
  cursor rejection.
- Conversation + durable-job + chat-sweep + Memory regression command: 18 passed,
  0 failed, 0 skipped. Activity suite separately passed 7 cases alongside the
  earlier 6-case conversation suite before adding feed coverage.
- These are foundation checks, not proof of the full ADR cases. No HTTP feed,
  delivery publisher, model-context filtering, client UI, notification routing,
  maintained-page integration or rollout has been qualified yet.

### Next coupled implementation unit

Bind each new work admission to its origin or existing permitted personal
destination; persist intents with fenced state transitions; publish entries and
logical alert intents atomically. Wire all execution families, including
maintained-page runs, before enabling new admission. Keep old notification
ownership for unbound legacy work. Then expose authorized transport and replies.

### Delivery and context checks — 21 October 2026

- Migration `270_assistant_delivery_transitions.sql` persists delivery intent in
  the existing job/page state-transition transaction. Only newly bound work is
  affected. Workers retain separate execution chats and runtime slots.
- `ASSISTANT_CONVERSATION_ENABLED=false` is the default in environment parsing,
  the example and Compose. Disabling it parks existing bound delivery. The
  explicit home API reports disabled; ordinary legacy work remains available.
- The publisher writes entry, sequence, provenance, logical alert intent and
  publication receipt atomically. Logical alert intent is not OS push delivery.
- Direct automation admission now wraps chat, job, binding and scheduler callback
  in one transaction, including failure on an invalid explicit origin.
- Private HTTP home/open/feed/read operations and shared API-client methods are
  implemented. Home fetch does not create a destination or acknowledge content.
- Foreground requests can name `reply_to_entry_id`. The admitted context contains
  at most twelve authorized foreground entries plus that explicit target. Its
  stable identities and dependencies persist; new updates cannot join it. Lead
  and specialist provider attempts and the write boundary revalidate it.
- Latest command: guarded `tsx --test --test-concurrency=1` over
  `assistant-context-boundary.unit`, `chatgpt-loop-recovery.unit`,
  `assistant-conversation-delivery`, `assistant-conversation-routes`,
  `assistant-conversation-client.unit`, `assistant-conversation` and
  `durable-assistant-jobs`: **27 passed, 0 failed, 0 skipped**.
- Latest backend typecheck, shared-package builds, environment-template coverage
  and tracked diff whitespace checks passed. These checks do not establish UI,
  live-provider, notification, morning summary or full ADR acceptance.

### Remaining integration and audit

1. Qualify real foreground HTTP submission/retry/poll with targeted replies and
   current permission changes. Ensure old-client projections, saved outcomes,
   waiting projections, memory derivation and account export retain the correct
   per-entry contract and content erasure semantics.
2. Persist schedule routing and inherit handoff destinations. Scheduled nights
   now bind one summary at admission; standalone Overnight handoffs still need
   equivalent grouping without changing their existing execution admission.
   Audit explicitly configured external channel outboxes during migration.
3. Finish notification client deep links and qualify full send-time revocation,
   quiet/mute and rollback flows. Server timing, no-op suppression and scheduled
   summary revision are implemented; actual OS push remains unverified.
4. Implement conversation UI and retained transport state on web/desktop and
   mobile, including inline updates, explicit targets, Review, activity, stop and
   independent pause/schedule controls. Verify only authorized web/Expo web flows.
5. Complete export/retention, deletion, recovery/rollback and all eleven ADR cases.
   Keep rollout disabled until these units are implemented and qualified.

### Attention and scheduled-night delivery — 21 October 2026

- Migrations 271–272 add attention keys, observed source revisions, mute state,
  admitted night identity and a not-before boundary. Fingerprints use versions
  observed in tool output, never the later source state or model wording. Missing
  or conflicting evidence disables suppression rather than dropping a result.
- Existing notification quiet hours and the planner time zone own delivery
  timing. Walking actual instants handles skipped/repeated DST hours. Muting
  preserves timeline results and execution, while suppressing alerts.
- Logical alerts enter the existing notification outbox once with a generic
  body. Tray reads and transport recheck current permission. Acknowledging a
  displayed entry shares read state and cancels a still-pending push; already
  transmitted pushes cannot be recalled.
- New scheduled nights bind their destination generation at admission. Child
  results are classified by the isolated publisher and included in one morning
  summary. Late work revises the same entry/sequence and does not enqueue another
  logical alert. Legacy nights keep the old owner even if a personal home opens
  later. A failed publication is isolated from other updates and retries delivery
  without rerunning either job.
- Latest focused conversation/context/transport/time/recovery run: **37 passed,
  0 failed, 0 skipped**. Latest scheduled-night and existing Overnight/night-shift
  regression run: **62 passed, 0 failed, 0 skipped**. The runs overlap; counts are
  not additive. They include the real morning-notifier entry point, late summary
  revision, source-change-after-completion race and legacy-night routing.
- Shared builds, backend typecheck, environment-template coverage and tracked
  whitespace checks passed. No web/mobile UI, live-provider or real OS-push
  qualification is claimed. All eleven full ADR cases remain subject to the
  final requirement-by-requirement audit.

### Client history and inline updates — 21 October 2026

- Shared account-bound conversation store loads recent retained history, pins the
  upper cursor during multi-page refresh, and loads earlier pages explicitly.
  Refresh replaces the authorized projection, so revoked rows disappear. Known
  committed identities prevent stale local turns from restoring revoked content;
  optimistic foreground turns and proposal state retain separate ownership.
- Conversation switches cancel queued history/read operations. Account changes
  discard in-flight private results. Delayed acknowledgement receipts cannot
  rewind newer read/history cursors. Fetching alone never acknowledges an entry.
- Desktop/web and mobile hooks consume the feed independently of foreground
  execution. Both render inline updates and an explicit reply target; existing
  work views retain execution/review controls. Switching chats preserves drafts
  and reply targets in account-bound memory. Unsupported source kinds are not
  misrepresented as task links.
- Mobile presentation now includes updates, optional details, exact-job stop,
  earlier history and reply cancellation. Its read boundary measures rows against
  the actual chat viewport on layout/settled scrolling, gates on active app and
  unobscured conversation, and does not infer reads from polling. Web uses visible
  intersections and re-observes on focus/visibility changes.
- Shared API package build passed. Five new store regressions passed: revocation,
  conversation-switch races, account-switch races, delayed acknowledgements and
  bounded pagination/live-turn merge. Desktop and mobile typechecks passed after
  the implementation corrections. Initial mobile typecheck caught an incorrect
  AppState boolean comparison; it was corrected and the mobile check rerun green.
- These are source/type and focused behavior checks, not rendered acceptance.
  Still required: initialization/send readiness and error retry; per-row mobile
  visibility behavior and modal coverage; scroll anchoring/new-update affordance;
  notification deep links; terminal proposal outcome precedence; all server and
  export/routing integration gaps listed above; final eleven-case ADR audit.
  Rollout remains disabled. No commit, push, merge or deployment performed.

### Initialization and notification targets — 21 October 2026

- Added a private, no-store exact-entry location route and shared validated
  transport. It checks current destination and per-entry authority before exposing
  navigation identity. It never opens/recreates a destination. Clients reject
  mismatched chat/entry responses and pages beyond their pinned upper cursor.
- Web notification actions and mobile inbox/push routing now open the admitted
  conversation and load the target even when it is older than the recent window.
  Web scrolls to the sequence; mobile uses the existing measured scroll helper.
  Opening a notification does not itself acknowledge the entry.
- Sending waits for initial home/saved-chat discovery. Explicit home failures
  preserve drafts and expose recovery; initial restoration preserves text typed
  while discovery was pending. Remote applied/discarded outcomes override stale
  local proposal state without replacing parsed live proposals.
- Saved reply targets retain IDs, not cached update text. They resolve against the
  current authorized feed and exact-entry lookup, including older targets. While
  resolving or unavailable, Send remains blocked until resolution or explicit
  cancellation; the draft cannot silently become an untargeted request. Account
  and conversation changes discard stale resolution results.
- Latest focused route/transport/store run: **14 passed, 0 failed, 0 skipped**;
  log `/tmp/orbyn-conversation-navigation-checks.log`. Includes actual source
  deletion and destination deletion during exact-entry lookup, cross-owner denial,
  bounded navigation loading, mismatched responses and remote terminal outcomes.
  Shared builds and backend/desktop/mobile typechecks passed before the final
  reply-resolution UI correction; desktop/mobile typechecks were rerun afterward.
- Rendered initialization, old-target scroll/read behavior and reply recovery still
  require qualification. Remaining work includes scroll anchoring/new-update
  controls, modal visibility coverage, schedule/handoff routing, export/retention
  and the full eleven-case acceptance audit. No rollout/delivery claim follows
  from these focused checks. Other session's policy/skill edits remain untouched.

### Reading position and first rendered web checks — 21 October 2026

- Web follows incoming content only while near the bottom. It anchors the visible
  retained row while earlier history loads, offers Latest for content arriving
  below, and follows an explicitly submitted foreground question. Notification
  focus is consumed after scrolling, so it cannot permanently disable following.
- Mobile now tracks actual scroll position/content size, follows only near the
  bottom, exposes Latest, and captures/measures a stable row around earlier-history
  loading. Exact-entry focus and ordinary foreground submission use distinct scroll
  behavior. Mobile renderer qualification remains required.
- Isolated rendered preview: `http://127.0.0.1:15174/app`, 1340×1259 screenshot,
  light theme, disposable test DB on port 55434. Frontend process handle 79152;
  combined backend handle 98477 on port 18083. No automation workers/prober were
  started; AI routes nevertheless started their interactive consumer onReady
  (see the later isolation correction). Outbound service calls were trapped. Account metadata is in the private local
  `/tmp/orbyn-unified-preview-account.json`; no production account/config touched.
- First API-only preview returned 404 for saved chats because AI routes belong to
  another service. Corrected the harness to use `buildApp` without its service
  startup/prober, preserving the existing disposable account. This was a preview
  setup failure, not a product fix. The first seed attempt also failed the update
  intent constraint; subsequent fixture updates use real work admission, state
  transition and intent publication. Failed seed data remains only in the owned
  disposable database until its final cleanup.
- User explicitly confirmed signing in and accepting the displayed local QA Terms.
  Rendered checks: retained history and inline update; Reply selection; typed draft
  and reply target survive View work → Orbyn; Earlier messages expands history.
  Sequence 17's viewport offset changed from 55.9863px to 55.8691px (0.1172px).
- A later, stable background-arrival check retained scroll offset 1353.125px and
  first visible sequence 25, exposed Latest, and Latest returned to the new result.
  An earlier arrival observation coincided with a workspace-tab selection change;
  it was not counted as scroll-preservation evidence. Fixture results were real
  publisher entries, not live-provider execution or OS push evidence.
- Evidence screenshot: `/tmp/orbyn-unified-web-reply.png` (synthetic fixture
  content only). It shows inline results, the restored reply chip and unsent draft.
- Desktop/mobile typechecks and whitespace checks are being rerun on the final
  scroll changes. Remaining: Expo web/rendered modal/read/focus coverage; live
  foreground plus background interaction; schedule/handoff routing, export/history
  lifecycle and all remaining eleven-case acceptance evidence. Rollout stays off.

### Retained-history export and handoff routing — 21 October 2026

- JSON account export now includes retained conversation history beyond the
  execution window, through current destination/entry authorization and an extra
  personal-source restriction. Team-derived, revoked and retired content is
  excluded. Import does not restore execution or delivery identities.
- ZIP exports conversation pages as separate bounded files (at most 100 entries
  each), avoiding a duplicate full-history array in planner.json. Export keeps a
  fixed upper sequence per conversation while rechecking access on each page.
  The JSON endpoint now explicitly sends private/no-store cache headers.
- Existing account export rejects personal API keys before reaching the handler;
  the regression verifies this restriction. An initial test incorrectly expected
  a successful planner-only key export; corrected that assumption and retained
  the existing 403 boundary. A missing Scope.user type field was also corrected
  before the successful backend typecheck.
- Latest export/conversation/routes and existing ZIP/portability regression run:
  **24 passed, 0 failed, 0 skipped**, log
  `/tmp/orbyn-conversation-export-final.log`. Includes 205 retained entries,
  team-source exclusion, source deletion, destination deletion, bounded ZIP page
  content and real HTTP key-versus-session export authority.
- Handoff dispatch now inherits the producer's admitted destination after checking
  its current authority. A retired/revoked destination fails the receipt with
  access failure before creating a recipient job; it cannot switch to a new home.
  Newly requested handoffs from legacy results use their explicit execution-chat
  origin rather than adopting old results into the personal home.
- Latest handoff dispatch/request and conversation delivery regressions:
  **28 passed, 0 failed, 0 skipped**, log
  `/tmp/orbyn-conversation-handoff-checks.log`. Includes actual receiving-job
  admission into the origin while a different personal home exists, and failure
  after origin deletion. Backend typecheck passed. These focused results do not
  establish all schedule routing, standalone Overnight aggregation, foreground
  HTTP/provider interaction, modal/Expo rendering or full ADR acceptance.
- API export documentation updated. The source/lifecycle audit must still examine
  origin-chat dependency granularity, maintained-page revocation, derived memory,
  waiting/outcome projections and explicit execution-chat deletion semantics.
  Feature rollout remains disabled; changes are local and uncommitted.

### Schedule destination and scope snapshots — 21 October 2026

- Migrations 273–274 persist content-free task/goal/routine routing identities and
  personal-only source scope. Destination generation and scope travel together.
  Retired, deleted or originally absent destinations cannot become a later home.
  Existing schedules capture a snapshot at first new admission; night children
  without a snapshot inherit their admitted parent, including its retired state.
- Routine/goal creation and task handover record the snapshot in the owning write
  transaction. Foreground and reviewed assistant changes use server principal or
  separately checked proposal-guard job metadata, never tool-supplied routing IDs.
  Ordinary edits/pauses preserve the route. Explicit new assistant requests can
  change it after current owner/destination checks. New automation admission reads
  this snapshot without changing execution jobs, leases or scheduler controls.
- Handoffs also preserve a producer's personal-only routing scope. Review caught
  an intermediate bug where passing a captured personal destination as an explicit
  ID could classify it as schedule routing and drop its source restriction; fixed
  before qualification. Publication tests contrast unsolicited team-derived
  content (blocked) with explicitly originated/currently authorized content
  (published). Quiet hours are disabled in this fixture so they cannot mask the
  authority check; an earlier contrast failed because its default quiet window
  deferred publication and was corrected as a fixture timing issue.
- Latest isolated schedule/handoff/workspace/task/night/delivery/proposal run:
  **91 passed, 0 failed, 0 skipped**, log
  `/tmp/orbyn-conversation-schedule-isolated.log`. Covers real routine creation and
  new automation admission, retirement rollback with no orphan job, absent-home
  capture, transactional snapshot rollback, ordinary-edit preservation,
  cross-owner metadata rejection and personal-source publication restrictions.
  Backend typecheck and whitespace checks passed.
- Preserve failed receipt `/tmp/orbyn-conversation-schedule-qualified.log`:
  **90 passed, 1 failed**. Investigation found the combined UI preview's AI
  onReady hook had started an interactive consumer against the same disposable
  test database; it claimed a queued interactive fixture. The earlier statement
  that the preview had no consumers was incorrect. No automation worker/prober or
  live provider was running; outbound calls were trapped. Stopped the owned
  combined preview process (PID 14688, backend handle 98477) and reran serially;
  the isolated 91-case run above passed. Do not run previews and queue fixtures
  against this same database concurrently. The disposable account metadata remains
  in its private /tmp file for future verification; no production data was used.
- Deployment instructions now cover migrations 269–274 and routing snapshots.
  Remaining audit includes maintained-page schedule origins, origin-chat permission
  granularity, derived memory, retained waiting/outcome projections, feed-failure
  foreground display, independent mute/pause/stop/schedule UI, standalone Overnight
  aggregation, outward channel preservation and Expo web/rendered acceptance.
  Full eleven-case ADR completion is not claimed. Other session edits are preserved;
  rollout remains disabled, and all implementation changes remain uncommitted.

### Per-entry origin authority and foreground feed failure — 21 October 2026

- Registered origin conversations now keep project/task container authority separate
  from individual entry dependencies. Revoking one document hides dependent turns
  while unrelated retained turns remain readable, searchable and usable in bounded
  provider context. Keeping the project out of AI still rejects the entire container.
  Unregistered legacy chats retain their existing whole-history permission boundary.
- Saved-chat projections use authorized retained entries for every registered stream,
  not only the personal home. History counts and search no longer inspect revoked
  raw text. Unsafe legacy-derived titles become Conversation in saved-chat/list/export
  metadata; unknown-provenance traces are withheld. Polling registered streams now
  rejects unknown legacy results and rechecks known job source dependencies.
- A failed background feed preserves only unconfirmed foreground turns owned by
  the separate submit/poll path. It cannot restore previously committed local copies
  whose current permissions were not checked, and no longer erases an active answer
  merely because background refresh failed.
- Latest focused conversation/routes/export/store/delivery/context run: **42 passed,
  0 failed, 0 skipped**, log `/tmp/orbyn-conversation-entry-final.log`. Includes real
  project-origin source revocation across feed, read, search, export and context;
  container AI exclusion; raw search rejection; unchanged legacy behavior; actual
  HTTP polling of unknown versus checked/deleted-source results; and failed-feed
  foreground preservation. Separate existing chat/mode/sweep/maintenance regressions:
  **30 passed, 0 failed, 0 skipped**, log
  `/tmp/orbyn-conversation-legacy-chat-regressions.log`. Counts overlap earlier runs
  and are not additive with them. Backend, desktop and mobile typechecks passed;
  shared API package build and whitespace checks passed.
- Preserve initial failed receipts: `/tmp/orbyn-conversation-entry-boundary.log`
  (two test-fixture JSON array encoding failures) and
  `/tmp/orbyn-conversation-entry-boundary-final.log` (one fixture omitted the feature
  flag, so context preparation correctly returned null). Corrected those fixtures
  before the final runs; they were not provider or rendered acceptance failures.
- Next coupled reply unit: a person-question reply must resume its exact existing
  job/waiting ID and retain the answer in this destination, with a durable idempotent
  receipt. The current generic reply chip alone is insufficient to qualify this;
  approval questions must still use existing Review. Preserve foreground job/lane
  independence and reject stale/permission-revoked targets. Also audit bounded legacy
  history activation and automatic versus explicit sweep retention, maintained-page
  origins, derived Memory, standalone Overnight summaries, outward channels, separate
  controls and Expo web. Full ADR completion is still unproven. Rollout stays off;
  no commit/push/merge/deployment performed and other session edits remain untouched.

### Exact waiting-question answers — 21 October 2026

- Added a session-only answer endpoint targeting a retained entry and its exact
  job/waiting identity. It resumes the existing job, retains a source-dependent user
  answer with `reply_to_entry_id`, and writes a hashed idempotency receipt in one
  transaction. Concurrent identical retries return the same receipt; conflicting
  reuse, replaced/closed questions and approval requests cannot consume another
  wait. Current destination/entry/grant authority is checked before receipt replay.
- Migrations 275–276 add the resolved-intent reason and answer receipts, whose
  lifecycle follows deleted/swept destination entries. Resolved unpublished
  questions are suppressed; published question history remains with current
  `waiting_kind`/`actionable` metadata. Closed questions cannot enqueue/retry alerts.
  Origin notification checks now use container authority plus per-entry sources,
  matching the feed rather than a revoked dependency union on the entire chat.
- Web and mobile replies to person questions use the new transport without creating
  foreground work or adopting the background polling/thinking state. In-memory,
  account-bound retry IDs survive an ambiguous failure for the same answer/target;
  switched-chat failures restore the originating draft. Approval requests expose
  Review; closed questions show Closed. Ordinary result replies keep their existing
  foreground-context behavior. The legacy Details answer consumer now takes its
  execution-chat lock before the job, matching the new transaction's lock order.
- Focused delivery/routes/client/store/export verification: **41 passed, 0 failed,
  0 skipped**, `/tmp/orbyn-question-answer-qualified-final.log`. Includes actual
  HTTP concurrent retries, single execution-history append, exact job isolation,
  receipt collisions, stale/approval rejection, other-owner/API-key denial, grant
  revocation before new replies and receipt replay, rollback, resolved-intent/alert
  suppression and dynamic question metadata. Shared packages built; backend,
  desktop and mobile typechecks passed; whitespace check passed. Existing mocked
  provider question/answer regression: **1 passed**,
  `/tmp/orbyn-question-legacy-answer.log`; this is not live-provider evidence.
- Retain failed receipts: `/tmp/orbyn-question-answer-routes.log` used default quiet
  hours and deferred its fixture questions, corrected by explicit no-quiet settings;
  `/tmp/orbyn-question-answer-final.log` attempted to revoke the protected built-in
  assistant grant, corrected to a separate revocable OAuth grant. The intermediate
  corrected runs passed; counts overlap and must not be added together.
- Rendered web evidence: `/tmp/orbyn-question-answer-web.png`. In the disposable
  account, selected the person question, entered Review notes, submitted, and saw
  one retained answer, Closed on that question and Review request on the separate
  approval. Primary DB inspection confirmed selected job queued in background,
  other job still waiting in background, one receipt and zero personal foreground
  jobs. No background runner or real provider call was used. The preview's
  interactive runner was stopped before all DB tests; it was briefly restarted for
  the UI check and stopped again before final regression runs. One temporary seed
  attempt violated the runtime-lane invariant; corrected its automation checkpoint
  before seeding. No production configuration or user data changed.
- Still unqualified: rendered ambiguous-response retry and interrupted draft paths,
  Expo web/native behavior, active foreground/background overlap, direct Details
  answer retention parity, maintained-page recurring origin scope, automatic sweep
  retention/legacy history activation, derived Memory, standalone Overnight
  grouping, outward channel preservation and separate controls. Continue the full
  eleven-case ADR audit; this unit does not establish full completion. Rollout stays
  disabled, changes remain uncommitted, and the other session's edits are preserved.

### Retention, maintained-page schedules and work-view parity — 21 October 2026

- Found and removed silent age expiry for registered origins: weekly sweep claims
  exclude active retained streams, maintenance provider authority rejects newly
  registered sources, and both empty-chat cleanup and final summary persistence
  recheck registration. Protection remains during flag rollback and does not depend
  on pinning. Explicit deletion/sweep retirement remains authoritative.
- Migration 277 adds maintained-page bindings to saved schedule destinations.
  Creation and update capture only server principal job metadata; ordinary edits
  preserve the original generation/scope. Queue admission uses that snapshot and
  refuses to adopt a home opened later. Retired destination admission rolls back
  without another run. Existing schedules capture once at first new admission,
  using the same night inheritance helper as other schedule kinds. Rollback no
  longer creates new schedule snapshots through that helper.
- The existing Details/work-view question-answer endpoint now retains the answer
  and its job-source dependencies in the bound origin as well as any registered
  execution stream. A published exact question is linked by waiting ID. The new
  conversation endpoint supplies its stable turn ID to that common writer, so
  retention does not create a second answer. Chat locks use deterministic ID order.
  Retired/revoked bindings fail inside the transaction; raw history and queued job
  changes roll back together. Unknown registered execution provenance is rejected.
- Preserved explicitly configured Slack and Teams night outboxes when unified
  summary delivery owns Orbyn's app alerts. The night lock plus notified receipt
  and existing unique outbox keys prevent replay; legacy in-app/push notices remain
  suppressed for bound nights. No channel expansion or real message was sent.
- Current lifecycle run: **100 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-conversation-lifecycle-final.log`, covering conversation routes,
  delivery, schedule snapshots, sweep/maintenance authority and maintained-page
  run/binding regressions. Channel preservation plus existing mocked channel
  regressions: **30 passed**, `/tmp/orbyn-conversation-channel-preservation.log`.
  Existing mocked-provider question resume: **1 passed**,
  `/tmp/orbyn-question-legacy-parity.log`. Backend typecheck passed,
  `/tmp/orbyn-conversation-lifecycle-types-final.log`; whitespace check passed.
  Earlier subset runs (26 sweep/authority, 43 page/schedule, 64 lifecycle) overlap
  these runs and are not additional distinct coverage. No failures in this unit's
  recorded runs; no preview queue consumer was running during DB verification.
- Direct evidence includes old/unpinned and empty registered chats retained with
  rollout off; registration during the compactor call preventing summary effects;
  page origin/scope stable after ordinary edits and destination deletion; missing
  page destination not adopting a later home; HTTP work-view answer retention and
  post-answer source revocation hiding only dependent entries; retired work-view
  target rejecting rather than redirecting; and one durable outward night intent
  per configured channel without a legacy app alert after repeated notifier runs.
- Remaining work is still the full eleven-case audit: foreground overlap and HTTP
  retry/context effects, Expo web and interrupted-response rendering, bounded
  legacy-history links/activation, derived Memory provenance, independent mute and
  schedule/admission controls, standalone Overnight grouping and final rollout
  qualification. Page night inheritance uses the shared helper but does not yet
  have a dedicated rendered or full-night acceptance receipt. Rollout remains off;
  all changes are local/uncommitted and the other session's policy edits are intact.

### Independent work and alert controls — 21 October 2026

- Migration 278 adds per-lane admission pauses, separate from grant suspension,
  schedule settings and alert mute. Central automation/page admission checks lock
  the settings row, scanners exclude paused lanes, and insert triggers fence job,
  page-run and night admissions. Existing rows can still resume, stop or complete.
  Foreground execution and its version-6 Memory/compaction checkpoint continuation
  are exempt from new automation admission, preserving atomic answer storage.
- Added session-only work-controls GET/PATCH plus shared transport. Partial writes
  preserve the other lane. The API remains available during unified-delivery
  rollback; otherwise a paused lane could not be resumed from the new client.
- Upcoming contains one collapsed Assistant controls section on web and mobile.
  Its independent rows are Mute update alerts, Pause new Background work and Pause
  new Overnight work. The mute row appears only when unified delivery is enabled.
  Shared account-bound client state clears uncertain saves until a fresh read and
  rejects stale account responses. Already admitted work is explicitly described
  as continuing; individual jobs retain their existing Stop actions.
- Page schedule pause now preserves healthy queued/running/waiting runs and their
  captured context, advancing their binding fence for the control-only revision.
  Future occurrences remain blocked. Changed page sources/instructions still
  invalidate work; the existing pause-after-human-edit cancellation regression
  remains green. Broader deletion/cancellation UI semantics remain under audit.
- Rendered web check uncovered a real initialization race: a selected-chat restore
  could change the generation and discard account capability discovery, hiding the
  unified timeline and controls. Both hooks now record enabled capability before
  the selected-chat generation check. Reproduced the missing controls, confirmed
  the preview server returned enabled=true, then verified the corrected timeline
  and control section on reload.
- Web preview: toggled Background pause, closed/reopened Upcoming and observed the
  saved checked state with mute/Overnight unchanged. Toggled mute and Overnight
  separately, then restored all three QA values to false. Screenshot:
  `/tmp/orbyn-assistant-controls-web.png`. No background runner/provider work was
  started; the isolated interactive preview was stopped before DB checks.
- Final focused control/admission/scanner/page regressions: **103 passed, 0 failed,
  0 skipped**, `/tmp/orbyn-controls-final-qualified.log`. Covers actual HTTP control
  isolation and API-key denial, direct job/night insertion fences, existing waiting
  answer/history continuity, central automation/page no-orphan admission, healthy
  schedule pause, Memory checkpoint/foreground atomicity, shared-store ambiguous
  response/account reset and worker regressions. All shared/backend/web/mobile
  typechecks passed, `/tmp/orbyn-controls-final-types.log`; whitespace check passed.
- Corrected migration 278's version-6 maintenance exemption during this uncommitted
  development unit and applied only its replacement function to the guarded test
  DB for iteration. Then applied the complete migration set to a new disposable
  `orbyn_controls_20261021_test`: **14 route checks passed**,
  `/tmp/orbyn-controls-fresh-migration.log`; 238 migration records, latest
  `278_assistant_admission_controls.sql`. Dropped that additional DB after checking.
  The original QA/test DB remains. Earlier 43/49/102 runs overlap, not extra coverage.
- Preserve the initial typecheck receipt `/tmp/orbyn-work-controls-types.log`:
  mobile Retry omitted SmallAction's required disabled prop; fixed before the final
  checks. Initial review also identified the maintenance-checkpoint pause coupling
  before its regression was added. No production settings or user data changed.
- Next: derive Memory provenance, bounded legacy history, standalone Overnight,
  explicit schedule cancellation semantics, full foreground overlap/retry effects,
  Expo web and interruption/rendering acceptance. Full ADR completion remains
  unproven. Rollout is off, no commit/push/deployment, and the other session's
  policy/skill files remain untouched.

### Explicit previous saved history — 21 October 2026

- Registered chats continue to use authorized retained turns for the normal
  conversation and provider context. Added an explicit read-only path for valid,
  untracked messages still present in their existing 200-turn execution window.
  No history is copied into the timeline, no unread entries or alerts are created,
  and historical proposal/action fields are not returned to the viewer.
- GET `/me/assistant/conversations/:id/history` returns at most 50 messages (25 by
  default), ordered chronologically, with an earlier cursor and SHA-256 snapshot
  version. Earlier pages require that version; changed windows return 409 rather
  than silently skipping or duplicating messages. Current whole-history legacy
  authority and nudge/source access are rechecked. Existing destination retirement
  and owner/session checks apply. This read remains available during rollback.
- Saved-chat metadata advertises an authorized legacy-history target. Web chat
  history and the mobile drawer expose Previous saved history only for that target;
  this does not depend on unified feed availability during rollback. The shared
  history store has its own account-bound state and never writes into the normal
  conversation store. A changed/revoked window clears cached pages; focus/active
  view checks revalidate while the viewer stays open. Account changes replace its
  UI store immediately, and stale requests cannot restore text after reset.
- Mobile local sheets (Upcoming, saved history, rename and deletion) now suppress
  underlying conversation read/focus acknowledgements while obscuring the thread.
  Native/Expo rendering and modal coverage still require direct qualification.
- Focused history/routes/store/foundation/export/legacy chat and mode regressions:
  **45 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-saved-history-final-qualified.log`. Shared/backend/web/mobile checks
  passed, `/tmp/orbyn-saved-history-types-qualified.log`; whitespace check passed.
  Earlier 16/37/45 runs overlap this final run and are not additive. Tests cover
  complete ordered pagination, raw-window mutation conflict, cross-owner/API-key
  denial, rollback reads, source revocation while independent retained history
  remains readable, context/unread/intent isolation, account reset and authority
  rechecks. No migration was added for this unit.
- Rendered web check used only the disposable QA account and a synthetic
  Saved-history QA origin containing 60 old messages plus one retained turn.
  Opened its separate viewer and loaded an earlier page. Changed that fixture's
  raw window, observed old pages cleared with Reload, then loaded the current
  authorized window. Screenshot `/tmp/orbyn-previous-saved-history-web.png`.
  The preview interactive runner was stopped before final DB checks. No background
  worker, real provider, notification send or production data was used.
- Memory investigation is **not complete**. Current Memory notes link whole chats;
  `recordAssistantSources` recursively expands their chat dependencies. Trace
  generic document reads and already-derived jobs as well as Memory recall,
  especially source-chat deletion and revocation after a derived turn is stored.
  Do not replace the existing whole-chat guard with a container-only check: that
  would discard provenance. A dedicated per-entry lineage/retention design and
  before/after behavior evidence are still needed; no runtime leak claim is made
  from this source inspection alone.
- Remaining full-goal work: Memory provenance, standalone Overnight grouping,
  explicit schedule cancellation semantics, foreground streaming/admission/retry
  acceptance, Expo web, interruption states and final eleven-case qualification.
  Existing legacy turns already lost from the old window cannot be reconstructed;
  this is a bounded history link, not a new archive or bulk migration. Rollout stays
  off, all changes remain uncommitted, and other-session policy edits are intact.

### Memory dependency visibility — 21 October 2026

- Added a failing-before regression for a personal source chat, a Memory fact
  learned from it, and a retained answer derived from that Memory document.
  Deleting the source chat already hid the Memory item, but the derived job and
  answer remained authorized. Receipt: `/tmp/orbyn-memory-provenance-before.log`.
- The shared document source predicate now follows stored Memory and chat source
  edges before authorizing a derived job or retained entry. Memory list/read/recall
  reuse that predicate rather than maintaining a separate interpretation. A
  recursive SQL union terminates cycles; terminal access checks deliberately do
  not expand the graph again. Missing source-chat identities remain dependencies.
  This preserves the existing conservative whole-chat Memory boundary.
- Added a nested Memory → chat → Memory cycle regression. Deleting an intermediate
  document hides the root through both ordinary document-source authorization and
  Memory reads. The source-chat case confirms independent retained history stays
  readable after the dependent answer disappears.
- Focused provenance, Memory, maintenance, conversation foundation, delivery and
  export suites: **61 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-memory-provenance-qualified.log`. Backend typecheck passed,
  `/tmp/orbyn-memory-provenance-types.log`; changed-source whitespace checks passed.
  The initial combined run omitted serial test execution and had maintenance-worker
  interference (two failures), retained in `/tmp/orbyn-memory-provenance-after.log`.
  The serial repository test mode passed; earlier 31/2-pass runs overlap the final
  receipt and are not additive. No preview backend ran during these checks.
- Exact Memory turn/generation lineage remains unfinished. The queue currently
  captures a whole-chat prefix digest, and learned notes record a whole chat.
  This unit closes the reproduced source-deletion gap but does not claim that
  selected-update grant revocation, independently authorized Memory facts, or
  retained turns beyond the old raw window have complete lineage qualification.
  Follow the queued source identity through maintenance admission, post-provider
  publication, remembered source references and later derived-context reads before
  changing that contract. Do not weaken legacy provenance to container ownership.
- Rollout remains off. Changes are local and uncommitted; other-session policy
  edits remain intact. The full ADR goal remains active.

### Retained reply and Memory lineage — 21 October 2026

- Selected context now persists source entry identities in
  `assistant_turn_entry_sources`, alongside existing resource dependencies.
  The current grant, nested sources and source destination generation remain
  dependencies of derived jobs, turns and Memory. Source entry deletion does not
  cascade away the reference and accidentally restore authorization.
- Migrations 279–281 add these reference tables, a cached transitive authority
  function, and exact retained-turn Memory queue snapshots. The recursive graph
  carries the intersection of scopes through grant edges, handles cycles, and
  follows nested document sources through chats, records, goals, comments, page
  bindings and exams. The graph uses the existing visibility builders; terminal
  predicates deliberately do not recurse into another graph.
- `deliveryBindingVisible` moved unchanged in its public contract to the owning
  library so delivery, derived-source checks and job guards share it. The graph
  SQL is generated from its canonical builder. The provenance test checks the
  migration and installed function against that builder.
- The first inline graph implementation passed its three focused behavior cases
  but took about 32 seconds. Caching its plan in a stable database function reduced
  the same cases to about 2 seconds on this disposable DB. Receipts:
  `/tmp/orbyn-entry-lineage-after.log` and
  `/tmp/orbyn-entry-lineage-cached.log`. This is a local regression comparison,
  not a production load-test claim. Initial before attempts had fixture errors
  (missing chat title and incorrect publisher call signature), retained in
  `/tmp/orbyn-entry-lineage-before*.log`; they do not prove a runtime leak.
- New Memory for a registered conversation derives input from the exact authorized
  retained user/assistant turns, ignoring caller-supplied text. Its captured digest
  survives raw execution-window truncation, but source edits/removals and current
  permission changes invalidate extraction before publication. Remembered notes
  retain those entry references after queue completion. Newly covered sources may
  use this per-entry boundary; old or mixed untracked facts remain conservative
  whole-chat dependencies and are never silently upgraded.
- Direct checks prove grant revocation hides a selected update and its derived
  reply/Memory; newly learned independent facts remain readable. They also check
  source generation deletion, nested cycles, exact queue input, source edits,
  invalid/foreign retained-source rejection and raw-window truncation. Fake-provider
  worker tests prove successful extraction beyond the raw window and rejection
  when a retained source is edited during the provider call.
- Broader conversation, delivery, export, routes, schedules, visibility, Memory
  and maintenance suite: **97 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-lineage-qualified-final.log`. After adding retained-source argument
  validation, the affected provenance/Memory/maintenance suites passed **36/36**,
  `/tmp/orbyn-lineage-boundary-final.log`; backend typecheck passed,
  `/tmp/orbyn-lineage-boundary-types.log`. Counts overlap and are not additive.
- Full migrations from an empty marked disposable database plus provenance and
  maintenance suites passed **28/28**, `/tmp/orbyn-lineage-fresh-final.log`.
  Uncommitted migration 280 was refined during development; the main disposable
  test DB's function was refreshed explicitly, then the fresh-database run proved
  the complete migration path without that shortcut. The extra fresh database
  was dropped afterward. No production/configuration data was touched.
- Remaining source-inspection issue: `SWEEP_RULES` can delete finished execution
  jobs after a day, while `deliveryBindingVisible` still requires live execution
  rows. Reproduce this with the actual retention rule and preserve authorized
  retained timeline/history without retaining every execution payload forever.
  Standalone Overnight grouping, explicit schedule cancellation, foreground HTTP
  concurrency/recovery, Expo web and the final eleven-case audit remain pending.
  Rollout stays off; all changes remain local and other-session edits are intact.

### Execution retention and retained authority — 21 October 2026

- The regression using the actual `SWEEP_RULES.ai_jobs` predicate failed before
  the fix: removing an eligible finished execution job hid its published update.
  Receipt: `/tmp/orbyn-execution-retention-before.log` (19 passed, 1 failed).
- Migration 282 snapshots source-entry authority under the delivery binding when
  work transitions to a question or completion. These content-free references
  survive execution job/chat cleanup. Existing source/resource snapshots and
  current grant/scope checks remain mandatory. Missing execution rows are allowed
  only for already-published entries in an active destination, never to authorize
  a new publication. The authority-function migration and parity test were updated
  together; migration 280 remains unchanged by this unit.
- The real job retention rule now preserves pending/deferred publication. Legacy
  chat compaction also excludes these executions and rechecks that condition in
  the maintenance guard. Quiet deferral, a publisher outage or rollback therefore
  cannot consume the work authority before publication receives an outcome.
  Already-published executions remain eligible for ordinary cleanup.
- Migration 283 erases outgoing entry references when their owning stream is
  explicitly retired. Incoming references to erased source entries intentionally
  remain, so deletion cannot restore dependent access. Tests cover both directions.
- The legacy execution-chat read boundary now honors retained source-entry
  dependencies too. A grant-revoked update cannot remain readable through older
  work details. The feed clears links to missing/swept execution chats while
  preserving the stable work and timeline identities.
- Final delivery, compaction, provenance, maintenance, route and export suites:
  **72 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-execution-retention-final.log`. Backend typecheck passed,
  `/tmp/orbyn-execution-retention-types-qualified.log`; changed-source whitespace
  checks passed. Earlier overlapping 24/55-pass runs are not additive. The first
  combined 55-case run had a compaction fixture without an assistant grant, so
  its work never bound; that failed receipt is retained at
  `/tmp/orbyn-execution-retention-qualified.log`. The corrected fixture asserts
  the binding exists before checking compaction exclusion.
- Fresh marked disposable DB, full migrations and delivery/provenance cases:
  **26 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-execution-retention-fresh.log`. The extra DB was dropped afterward.
  No preview backend ran alongside these DB checks; no provider or external
  notification was used.
- Next source-lineage check: explicit automation admission and handoff dispatch
  currently copy resource dependencies, but must also inherit the originating
  turn's source-entry references before the first provider call. Trace
  `bindConversationWork`, `startAssistantAutomation.onQueued` and the handoff
  callback, then test revocation between admission and execution. Do not infer a
  latest turn or borrow another conversation when a trusted origin turn is absent.
  Standalone Overnight grouping, schedule cancellation, foreground concurrency
  and recovery, Expo web and the final eleven-case audit remain incomplete.
- Rollout remains disabled and changes remain local/uncommitted. Other-session
  policy and skill edits are preserved; no delegated review is claimed.

### Origin, schedule and handoff inheritance — 21 October 2026

- A new regression reproduced the explicit-admission gap: a Background child
  stayed source-authorized after its originating turn's selected update grant
  was revoked. Receipt: `/tmp/orbyn-admission-lineage-before.log` (22 passed,
  1 failed). The actual `startAssistantAutomation` path is used by the test.
- `bindConversationWork` now copies the exact origin turn's resource/entry
  dependencies to receiving work and snapshots entry identities on its binding.
  Supplied but unknown origin turns are rejected; missing turn metadata never
  chooses a latest turn. The job guard checks retained binding references too.
  The handoff callback copies entry references from both the producer turn and
  retained binding before the receiving job can be claimed.
- Tracing production task/goal/routine and page scheduling also found that routing
  metadata outlived the producer job but its entry provenance did not. Migration
  284 adds schedule and maintained-page-run entry reference tables. Schedule
  creation or explicit assistant reconfiguration captures these references in its
  owning transaction. Ordinary edits preserve them. Scheduled jobs and page runs
  inherit the snapshot, including when delivery is disabled or the producer job
  has been cleaned up. The maintained-page model/stage/review/apply guard checks
  the inherited references under the current principal's scope.
- Rollback no longer falls back to raw context for an already-retained foreground
  conversation: it continues to build a bounded currently authorized context.
  Explicit reply targeting remains disabled with the delivery feature. New tests
  cover source filtering during rollback, schedule creation/admission while off,
  and permission loss after queuing without changing delivery ownership.
- Active handoffs now protect their producer/recipient rows from finished-job
  cleanup until acknowledgement. Compaction guards also preserve the execution
  context. The handoff test verifies the real retention predicate for both sides
  and proves zero provider transmissions when compaction is attempted while the
  handoff remains active.
- Qualified conversation delivery, scheduling, handoff, provenance, maintained-page,
  routes, maintenance and compaction suites: **108 passed, 0 failed, 0 skipped**,
  `/tmp/orbyn-inherited-lineage-qualified-final.log`. Backend typecheck passed,
  `/tmp/orbyn-inherited-lineage-types-qualified.log`; changed-source whitespace
  checks passed. Earlier 31/40/79/11-case runs overlap this receipt and are not
  additive. The later rollback-creation assertions are included in this final run.
- Additional actual assistant-run and conversation regressions: **50 passed**,
  `/tmp/orbyn-inherited-lineage-legacy-final.log`. A new empty marked disposable
  DB applied the full migrations through 284 and passed **20 schedule/handoff/
  provenance checks**, `/tmp/orbyn-inherited-lineage-fresh-qualified.log`, including
  the final rollback and active-handoff assertions. That extra DB was dropped
  afterward. No preview backend ran against either test DB during qualification.
- Failed combined and diagnostic receipts are retained at
  `/tmp/orbyn-inherited-lineage-qualified.log`,
  `/tmp/orbyn-schedule-lineage-regressions.log` and
  `/tmp/orbyn-handoff-fixture-diagnostic.log`. The new revocation fixture initially
  left an accepted failed handoff for another test's global settler. Its isolated
  owner is now removed after that test's assertions; existing settling behavior
  was not changed to hide the fixture failure.
- Remaining acceptance work: inspect standalone Overnight and reflection provenance
  against the admitted-night summary contract, distinguish schedule cancellation
  from source deletion, complete foreground concurrency/recovery and Expo web
  checks, then audit all eleven requirements against the frozen candidate. No
  acceptance case is claimed complete from these component checks alone.
- All work remains local and the rollout flag remains off. No provider/external
  notification, deployment, PR, merge, new chat or delegated review occurred.
  The other session's edits remain intact.

### Reflection, MCP projection and summary ancestry — 21 October 2026

- Reproduced two defects before correction: MCP `get_chats` returned revoked raw
  turns, and reflection completion rejected its recorded chat source with a
  database constraint error. `/tmp/orbyn-reflection-mcp-before.log`: 16 passed,
  2 failed. Migration 285 aligns chat/entry source vocabulary and updates the
  generated cached authority function; source/migration/installed parity is checked.
- MCP reads/search now use the authorized retained turn projection and suppress
  raw traces. Server-only source targets carry the returned entry identities.
  Unknown automated transcripts remain unproven, rather than assuming no sources.
  Reflection captures exact checked job resources and entry ancestry. Its companion
  chat ID and incidental queued-job metadata do not widen that to every canonical
  turn. Tests include unrelated revoked turns and a second recorder invocation.
- Publication snapshots entry ancestry. Overnight summaries refresh on source-set
  changes even when counts are unchanged; old summary authority remains until the
  atomic replacement. Revoking either original or replacement sources hides the
  appropriate revision. Revisions retain one logical alert. Public navigation is
  bounded to 500 links while every dependency remains authorization-relevant.
- Qualified reflection/provenance/delivery/schedules/MCP suites: **70 passed,
  0 failed, 0 skipped**, `/tmp/orbyn-reflection-mcp-qualified.log`. A fresh marked
  disposable DB applied every migration through 285 and passed **42 checks**,
  `/tmp/orbyn-reflection-fresh-qualified.log`; it was dropped afterward. Earlier
  overlapping 35/41/23-case checks are not additive. Initial UNION parameter-type
  failures are retained in `/tmp/orbyn-reflection-mcp-after.log`; UUID casts fixed
  those errors, with no suppression of failed checks.
- Backend typecheck passed, `/tmp/orbyn-reflection-final-types.log`. Mobile Home's
  Upcoming now receives the same conversation rollout flag as the assistant's
  Upcoming; mobile typecheck passed, `/tmp/orbyn-mobile-home-types.log`.
- Expo web interaction checks, remaining foreground concurrency/recovery and the
  final eleven-case audit remain open. These component receipts do not qualify
  rollout. All changes remain local/uncommitted, rollout disabled, and concurrent
  policy/skill edits preserved. No independent delegated review is claimed.

#### Expo web interaction receipt

- Signed in to the approved disposable QA account. Expo web at
  `http://localhost:18084` uses the isolated API on `127.0.0.1:18083` with outbound
  service calls trapped. No native build was run. The loopback IPv4 attempt failed
  because Metro bound IPv6 localhost; localhost then loaded successfully.
- Home Upcoming exposed Mute update alerts and both independent admission pauses.
  Toggling mute in Home persisted when opening Upcoming from the assistant.
  Restored mute to off after the check. A selected background update's targeted
  reply and typed draft survived chat-menu/Upcoming open-close transitions.
  Screenshots: `/tmp/orbyn-expo-home-upcoming-controls.png` and
  `/tmp/orbyn-expo-targeted-reply-draft.png`.
- Observed viewport was **1600 × 900**. This proves Expo web interactions at that
  viewport, not phone-width layout, native keyboard/focus, or installed-device
  behavior. Phone-width, actual streaming/recovery and final acceptance audit
  remain open. QA draft is deliberately unsent; no live model call was made.
- Owned preview processes: current API command
  `/tmp/orbyn-unified-preview-combined.mts` (its SIGTERM handler deletes its QA
  user; use an intentional fixture-preserving stop before DB tests), Metro18084
  and Vite15174. No DB qualification should run against `orbyn_test` while the
  preview's interactive runner is active. Latest fresh proof DB was dropped.

### Concurrent execution, morning details and mobile reference — 21 October 2026

- A held-provider regression ran one interactive request and two independent
  background requests together. Completing/publishing the first background result
  did not alter the foreground request snapshot; a subsequent foreground request
  completed while the other background call remained held. Receipt:
  `/tmp/orbyn-concurrency-provider.log` (1 passed), also included in the broader
  qualification below. Existing chat progress is durable job polling; no new
  token-streaming transport was introduced.
- The SIGKILL-after-apply regression now includes unified delivery: it kills an
  actual isolated Background process after the action transaction commits, expires
  the old client-ref receipt, resumes the run, interrupts publisher commit and
  concurrently replays publication. It verifies one applied item, one saved answer,
  one update and one logical alert. `/tmp/orbyn-conversation-effect-crash.log`:
  **1 passed**. This covers the combined execution/publication boundary directly.
- Morning Details now contains up to 50 authorized per-run excerpts (4,000 chars
  each), with the full Overnight activity still reachable. Current questions and
  actionable failures keep their own entry identities and timing instead of being
  swallowed by counts. Two Overnight questions can be answered independently;
  `/tmp/orbyn-night-question-targets.log` passed. Pausing a routine prevents another
  occurrence while its admitted work completes and its history remains visible;
  `/tmp/orbyn-schedule-future-control.log` passed.
- Migration 286 captures contributing binding identities so a summary rechecks
  child grants as well as resource/entry sources. Migrations 287–288 preserve
  published child results after execution cleanup, including removal/reinclusion
  when a current grant changes. An atomic, content-free `summary_retained_at`
  receipt survives replacement of a summary projection; it never replaces current
  grant/source/destination checks. The installed authority function now matches
  source and migration 288. Failed development receipts are preserved in
  `/tmp/orbyn-night-binding-authority.log` (recursive SQL builder expansion) and
  `/tmp/orbyn-night-summary-retention.log` (child publication proof lost when a
  revised summary removed it). The final two-case receipt passed at
  `/tmp/orbyn-night-summary-receipts.log`.
- Broad qualification on the coupled backend/shared-source work: **217 passed,
  0 failed, 0 skipped**, `/tmp/orbyn-conversation-current-qualified.log`. A new
  empty marked disposable DB applied all migrations through 288 and passed the
  five new cross-system cases, `/tmp/orbyn-conversation-fresh-288.log`; that DB was
  dropped. These counts overlap earlier checks and are not additive.
- The user's two mobile references clarify that their named main assistant maps
  to Orbyn. Mobile now exposes that assistant first, removes its duplicate history
  row, puts New chat in the drawer footer, and uses the assistant's name in the
  main header. Returning from Work opens the same canonical conversation and
  preserves the draft; the hook also resets history mode so sending is not left
  behind an unrelated Choose project requirement. Both hosts share that mode fix.
- New clients explicitly request `conversation_only=true` history: person-origin
  and registered conversations remain in Recents; automation execution chats stay
  in work views. Omitted/false values and rollback preserve legacy listing behavior,
  and direct work reads retain their authorization. Client/route/foundation checks:
  **31 passed**, `/tmp/orbyn-history-separation-qualified-fixed.log`. The earlier
  `/tmp/orbyn-history-separation-qualified.log` used the API-only harness for an AI
  service route and failed on its 404; the corrected test uses the actual AI
  service and asserts HTTP status before interpreting its response.
- Expo web rendering checked at 390×844 and 320×640 with no horizontal overflow.
  The textarea now measures natural web content height before sizing: five lines
  cap at 104px and clearing returns to 44px. A targeted reply draft survived sheet
  transitions; a Work→Orbyn round trip retained its draft and restored the existing
  timeline without a project prerequisite. Screenshots:
  `/tmp/orbyn-mobile-primary-drawer.png`,
  `/tmp/orbyn-mobile-compact-conversation.png`,
  `/tmp/orbyn-expo-phone-320.png`, `/tmp/orbyn-expo-phone-upcoming.png`.
  Expanded night results were inspected on desktop too,
  `/tmp/orbyn-web-night-results.png`.
- The phone modal arrival receipt stayed unread at sequence 71 while Upcoming
  covered it, then acknowledged sequence 72 after dismissal/display. Metadata is
  `/tmp/orbyn-phone-arrival.json`. A second device was not allowed to acknowledge
  that receipt concurrently. Browser emulation pointer coordinates were unreliable;
  interactions were verified through keyboard/accessible controls. The IAB rejects
  `Input.dispatchTouchEvent`; no emulated-touch or native-device pass is claimed.
  Explicit CSS-bound CDP screenshots were used because the default emulated capture
  cropped/scaled the compositor. Device/touch overrides were restored afterward.
- Backend typecheck passed (`/tmp/orbyn-current-backend-types.log`); final desktop
  and mobile typechecks passed (`/tmp/orbyn-current-desktop-types-final.log`,
  `/tmp/orbyn-current-mobile-types-final.log`). Relevant source formatting and
  changed-line whitespace checks passed. No preview runner shared a test DB during
  qualification; the preview was restarted afterward and disposable typed drafts
  were deliberately cleared without submission.
- Remaining full-goal work is concrete: a standalone Overnight handoff currently
  carries its window end but no admitted night identity, so its ordinary result
  cannot join the morning aggregate. Also, a night parent binding is unique by
  `(owner,work_kind,work_id)`, which cannot represent the ADR's separate summary
  per destination when origin-scoped schedules return elsewhere. Resolve delivery
  grouping without changing execution scheduling/budgets or borrowing another
  destination, then audit all eleven cases against the final actual diff.
- Goal remains active, rollout disabled, all changes local/uncommitted. No PR,
  merge, deployment, native build, external notification, new chat or delegated
  review occurred. The other session's policy/skill edits remain preserved.

### Delivery-window aggregation — 21 October 2026

- Resolved the two remaining grouping defects: standalone Overnight handoffs now
  share the morning delivery window, and one window can publish a separate summary
  to each captured conversation. Migration 289 introduces an owner/window-end
  registry and per-destination parent identity. Execution nights remain unchanged;
  no execution night, new schedule, consent or budget is created for grouping.
- Explicit origin destinations do not become the default route for unsolicited
  work. A scheduled night captures that default separately. If a standalone window
  already exists, the scheduled night joins it without replacing its earlier
  summary identity. Missing/retired default destinations never select a new home.
- A summary's authority derives from its contributing bindings, including each
  child's current grant, source entries and personal/team scope. The default
  route's personal-only rule cannot invalidate explicitly requested scoped work.
  Questions and failures retain their individual targets. The normal bounded
  delivery worker now also queues due standalone summaries and late revisions.
- Focused new checks: **3 passed**, `/tmp/orbyn-window-regressions-fixed.log`.
  Covers no execution-night creation, shared identity and one alert for late work,
  standalone-first/scheduled-later admission, separate destinations, scoped team
  content, revocation and destination retirement. The first scope check failed
  because its helper expected an intent for deliberately unbound legacy work;
  corrected the helper to complete work without assuming publication. Preserve
  `/tmp/orbyn-window-scope.log` as the failed development receipt.
- Existing delivery/provenance checks after migration 289: **28 passed**,
  `/tmp/orbyn-window-first.log`. Fresh empty marked database applied every
  migration through 289 and passed the three window cases plus installed/source
  authority parity: **4 passed**, `/tmp/orbyn-window-fresh-289.log`. That extra
  database was dropped. Counts overlap and are not additive.
- Backend typecheck passed, `/tmp/orbyn-window-types-final.log`. Final broader
  qualification and the lead's eleven-case audit are in progress. The preview API
  remains stopped during database checks; no interactive runner shares that DB.

### Final acceptance audit — 21 October 2026

Candidate: local working changes on `main`, base
`db4eb64956cf7cbdeebc468d459c1deae2856440`. The 129 changed runtime/config/test files
are enumerated with SHA-256 values in
`/tmp/orbyn-conversation-final-source-sha256.txt`; manifest digest
`eb85ae00d581f9cb8af0ca72bff3cc90cceea20687eb936f9e83d3356f7ba7f6`.
Concurrent policy/skills edits are excluded from that candidate and remain preserved.
Documentation is outside this runtime fingerprint.

The lead reviewed the actual source and surrounding contracts, including explicit
home/origin admission, bounded foreground snapshots, exact waiting receipts,
publication/alert transactions, current grant/source graph, retirement, execution
cleanup, morning routing, legacy projections, both client hooks and mobile drawer.
That review caught a real standalone-window cleanup defect: a suppressed child
could become sweep-eligible before its summary committed. A failing regression
(`/tmp/orbyn-window-cleanup-before.log`) reproduced it. The cleanup owner now waits
for `summary_retained_at`; it allows normal cleanup after publication and preserves
the authorized summary afterward. No execution scheduling or budget changed.

| ADR case                               | Audited result within authorized scope                                                                                                                                                          | Direct evidence                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Foreground plus two background jobs | Independent request snapshots/slots; arrival does not replace the live answer or draft                                                                                                          | Held HTTP-provider concurrency case in `assistant-runs.test.ts`; client-store isolation; rendered web scroll/draft and Expo reply-draft receipts above |
| 2. Crash and replay                    | One applied item, saved answer, update and logical alert after a real process kill and publisher rollback/replay                                                                                | Final SIGKILL-after-apply check; transactional delivery rollback/replay checks                                                                         |
| 3. Exact replies and questions         | Each current waiting ID resumes only its job; stale/cross-owner/reused answer identities reject; approval stays in Review                                                                       | Conversation routes/delivery and existing durable-run stale/approval checks                                                                            |
| 4. Scoped routing                      | Explicit origin wins; unsolicited work uses its captured permitted personal route; no replacement fallback                                                                                      | Schedule, handoff, admission and per-window/destination regressions, including explicit team scope                                                     |
| 5. Revocation and derived context      | Current grants/source dependencies apply before publication/read/reply/provider/effect; independent history remains usable                                                                      | Delivery, routes, context-boundary, Memory graph, reflection and MCP projection checks; installed-source parity                                        |
| 6. Attention and Overnight             | Empty/unchanged checks stay quiet; quiet hours/DST defer; scheduled and standalone work share correctly scoped morning summaries; late results revise one alert identity                        | Delivery-time, fingerprints, logical-alert and four delivery-window/cleanup cases                                                                      |
| 7. Continuity and history              | Stable sequence/revision pagination, shared monotonic read state, no fetch acknowledgement, retained history beyond 200; reconnect does not replace live turns                                  | Conversation/store/export checks, web earlier-history anchor, Expo modal-arrival 71→72 receipt and loaded 320/390px previews                           |
| 8. Distinct controls                   | Exact Stop preserves truthful effects/history; lane pauses affect new admissions; schedule pause prevents future occurrences while admitted work completes                                      | Existing runner Stop/apply tests, route/control-store checks, routine future-occurrence and maintained-page pause checks, rendered Upcoming controls   |
| 9. Destination deletion                | Tombstones and captured generations prevent recreation or silent rerouting, including late window work                                                                                          | Foundation deletion/sweep, schedule retirement, handoff retirement, work-view answer and window retirement cases                                       |
| 10. Other producers and failures       | Maintained-page, provider-failure, disabled-owner, unknown-provenance and revoked-grant paths use the same current authority                                                                    | Page-run/delivery, runner failure, route legacy, source graph and notification checks                                                                  |
| 11. Compatibility and rollback         | Unbound legacy work retains its owner; old clients keep legacy list/read contracts; rollback parks bound delivery, re-enable reuses identities; configured channels have no duplicate app alert | Legacy-night, route/listing, delivery rollback/replay, Slack/Teams outbox checks                                                                       |

Final terminal receipts (overlapping coverage; do not sum):

- `/tmp/orbyn-conversation-final-289.log`: **205 passed, 0 failed, 0 skipped**;
  conversation/client/store/export/routes/schedules, controls/time/history,
  concurrency, provenance, reflection, handoffs, maintained pages and compaction.
- After the lead's cleanup correction,
  `/tmp/orbyn-conversation-final-retention-mcp.log`: **80 passed, 0 failed,
  0 skipped**; full delivery/retention, chat sweep, MCP tools and configured
  Slack/Teams outboxes. This qualifies the corrected owning boundary and keeps
  the prior broader receipt scoped to its unchanged contracts.
- `/tmp/orbyn-window-cleanup-fixed.log`: **5 passed, 0 failed, 0 skipped**;
  four window/cleanup cases plus installed authority parity on the additional
  marked disposable database. Its complete migration chain was installed from
  empty before the first checks; that extra database has been dropped.
- `/tmp/orbyn-conversation-final-crash.log`: **1 passed, 0 failed, 0 skipped**;
  actual Background SIGKILL-after-apply, resume, publisher rollback and concurrent
  replay, including action and alert cardinality.
- Shared core/API-client package builds passed, `/tmp/orbyn-conversation-final-packages.log`.
- Backend, desktop/web and mobile typechecks passed in
  `/tmp/orbyn-final-{backend,desktop,mobile}-types.log`. Relevant source/docs
  formatting passed (`/tmp/orbyn-conversation-final-format.log`), as did `git diff --check`.

The mobile screenshots are references for identity, hierarchy and compact layout,
not evidence of another product's backend. Orbyn's main assistant appears first;
its canonical conversation is not repeated in Recents. Work/activity remains
accessible, and the composer expands then shrinks without losing targeted drafts.
No screenshot-private message content was copied into the implementation.

Qualification limits: local fake HTTP providers exercise real orchestration and
DB transitions, not live model quality or provider reliability. Browser and Expo
web checks establish those renderers; no installed-native build, native keyboard,
physical-device/touch accessibility or real OS push transport was qualified.
Those were outside the accepted scope. No independent delegated review is claimed:
the host's advertised processing tier still cannot satisfy the standard-only
policy. No security scan, new project chat, external message, production change,
commit, push, PR or merge was performed.

The isolated API preview was restarted on loopback 18083 after tests, with outbound
calls trapped; Vite 15174 and Expo web localhost 18084 remain available. The owned
QA database/container are retained for that preview; no extra proof database
remains. Typed drafts were not submitted to a real provider. Implementation goal
is complete within this local, default-off delivery state. Deployment/rollout is
separate work.

### PR handoff requested — 21 October 2026

After the final qualification, the user requested committing and opening a PR for
this implementation. Delivery uses `feat/unified-assistant-conversation` from the
qualified base, with the same 129 runtime/config/test files and the four owning
contract/decision documents. The proposed Assistant UI refinement ADR and the
other session's policy/skills changes remain outside this implementation PR.
The pre-commit states and receipts above are historical qualification facts;
commit/push/PR results must be verified against Git/GitHub. No merge or rollout
was requested. No product source changed during PR preparation.

#### Final PR formatting correction

The staged commit-range check included newly tracked migration files, unlike the
earlier working-diff-only whitespace check, and found trailing whitespace in
seven generated, unreleased SQL migrations. Removed only trailing line whitespace.
No SQL token or execution behavior changed. The parity assertion now normalizes
that trailing whitespace in generated/source/installed SQL while preserving every
other character; `/tmp/orbyn-pr-sql-parity.log` passed its focused check on another
fresh marked database through migration 289. That temporary DB was dropped.
`/tmp/orbyn-pr-format-check.log` passed for all 111 owned files supported by
Prettier. The final staged range is checked separately before push. Prior runtime
qualification remains applicable to unchanged SQL semantics; the earlier digest
identifies the pre-formatting candidate rather than the final commit.

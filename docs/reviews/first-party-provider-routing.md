# First-party provider routing: remaining implementation

5 October 2026. Source inventory against `f8e1d632` on
`codex/chatgpt-execution`. This is a remaining-work contract, not delivered
functionality. It supplements ADR 001 and does not remove its other requirements.

## Observed gaps

| Caller                             | Current behavior                                                               | Required integration                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ai/routes.ts`, POST `/ai/project` | Calls managed `resolveAi` directly                                             | Capture the authenticated person's provider choice and team scope before generating the existing review proposal.                                                  |
| `ai/study.ts`, cards/grade/explain | Three direct managed resolutions                                               | Route through the selected provider; preserve page exclusion, readable links, card ownership and existing result schemas.                                          |
| `ai/docs.ts`, assist/ask           | Shared provider helper resolves managed AI                                     | Record the page as a source; recheck visibility and source revision before dispatch and before staging a replacement proposal.                                     |
| `ai/agenda-brief.ts`, `briefFor`   | Managed resolution; failures become no brief                                   | Bind the agenda owner and actual source identities. Separate explicit Rewrite from scheduled generation; defer unattended private work when its runtime is absent. |
| `docs/maintenance-model.ts`        | Infers choice from any saved account model preference; rejects private origins | Capture explicit provider choice independently of catalog preferences; execute personal calls through a durable scoped broker context.                             |
| `ai/capture.ts`                    | Direct managed text call                                                       | Route text interpretation through selected provider, retaining extraction bounds and response schema.                                                              |
| `ai/recording.ts`                  | Direct managed call for recorded material                                      | Inventory text summarization separately from audio transcription capabilities; preserve existing consent and do not add voice features to this ADR.                |

## Implementation contract

1. Introduce an owned durable feature-call context rather than passing an arbitrary
   job UUID to the existing broker. Current broker authorization requires a
   running, leased `ai_jobs` row, immutable captured provider choice and checked
   source dependencies. A feature call must establish these facts genuinely.
2. Keep existing synchronous route response schemas for current clients. A
   request gets a persisted operation identity before dispatch. Timeouts and
   cancellation must settle the context conservatively; unknown completion must
   not trigger another personal or managed charge. A durable asynchronous API,
   where necessary, requires versioned shared contracts and both-client polling.
3. Capture feature kind, actor, team scope, selected model/provider revision and
   exact source identities/revisions. Server-created feature contexts cannot
   grant tools, retrieve unrelated workspace context, or appear as ordinary chats.
4. Reuse the signed private transport and explicit fallback decisions. Defaults
   saved for an account do not themselves select that account as primary.
   Revocation, device replacement, settings changes and unavailable models cannot
   silently retarget a persisted call.
5. Recheck source authority immediately before dispatch, result acceptance and
   domain proposal/write. Preserve each existing proposal approval boundary.
   Scheduled pages retain their block binding, rule revision, work reservation,
   Night ownership and review/undo semantics.
6. Record completed-call usage and provider provenance once. Estimates, pending
   assignments and unknown completions cannot be reported as completed usage.
   Integrate retention with the central sweeper and account deletion.
7. Keep plugin calls and portable MCP authorization separate. Neither can create
   personal feature-call contexts by borrowing first-party session authority.

## Required acceptance evidence

- Each caller: managed primary, personal primary without a managed provider,
  authorized fallback, no-fallback failure, unavailable model and provider-change
  races; stable existing response/proposal contracts.
- Authenticated HTTP coverage: 401, 403, invalid input, 429, source exclusion,
  cross-user/source access, revoked sessions and changed team membership.
- Dispatch/recovery: distinct concurrent operation IDs, cancellation while locked,
  device loss before and after disclosure, accepted reply recovery, no repeated
  unknown charge, bounded payloads and durable retention.
- Scheduled work: unavailable runtime remains queued, no repeated notices,
  expired windows settle, source/rule edits invalidate stale work, existing
  budgets and review/undo survive worker restart.
- Cross-client acceptance: web/desktop and native mobile feature results, provider
  labels, actionable errors and usage; narrow layouts and keyboard/overlay states.
- Exact candidate full tests, workspace types/builds, migration upgrade and clean
  CI before promotion. Real-account completion remains an external acceptance
  gate while the connected account reports subscription-sharing exhaustion.

## Order

Build and test the durable feature-call contract first. Integrate Docs and Study,
then project/capture and explicit agenda rewriting. Integrate scheduled agenda
and maintained pages with their existing work reservations and Night policies.
Audit remaining direct provider callers after each checkpoint. Existing voice
or transcription code is not permission to expand the ADR into voice features.

## Docs / Study candidate checkpoint

A separate `codex/first-party-provider-routing` branch starts from `f8e1d632`
while the parent candidate's full tests run without source changes.
`completePageFeature` now creates a bounded owned feature context in `ai_jobs`,
captures provider consent through the existing database trigger and records
source dependencies before dispatch. Version 2 feature checkpoints are not
claimable by the version 1 chat runner. No chat or agent tool authority is
created. The existing stale-job path fails expired feature calls without
replaying them; central job retention also covers terminal feature contexts.

Docs assist/ask and all three Study AI operations use this context. Current page
revision, visibility, exclusion, team AI policy, captured consent and job lease
are checked before sending and before returning output. Accepted private replies
and fallback operations reuse the existing signed broker. Failed/unknown calls
are not retried by this synchronous feature context. Study recovery messages
use fixed approved text rather than reflecting arbitrary provider errors.

Focused Docs/Study tests pass21/21 without skips in
`/tmp/orbyn-page-feature-choice-tests.log`. They include managed operation
ownership, no chat creation, revoked personal choice without fallback, explicit
fallback, source-revision changes during inference and provider-choice changes
during inference. Backend typechecking passes after building this worktree's
shared packages. No new-source full-suite/CI or real-device inference acceptance
is claimed.

Remaining before delivery: signed-device feature acceptance and usage evidence,
feature-result provider provenance in both clients, source/session lifecycle
races, complete full/build/CI checks, and affected client runtime acceptance.
This checkpoint does not implement the other callers in the inventory or
maintained-page scheduling/private execution. It is not merged to main.

### Signed-device and provenance follow-up

Actual broker fixture tests now exercise first-party page dispatch, claim,
Ed25519 signed completion and once-only measured usage without creating a chat.
A changed page revision is rejected at private result acceptance, before usage
is recorded. This additionally fences feature revisions inside the broker's
job-live check; ordinary version 1 assistant behavior remains unchanged.

Completed feature provenance is recorded in the same transaction as accepted
private output or the managed fallback reply. Managed primary calls also record
it before terminal settlement. Optional shared response metadata reports the
actual provider/model/fallback, with compact Docs and Study labels on both
clients. Long labels wrap instead of widening a desktop panel.

Focused broker/Docs/Study checks pass38/38 without skips in
`/tmp/orbyn-feature-broker-final-tests.log`; all workspace typechecks pass in
`/tmp/orbyn-feature-metadata-final-types.log`. This is simulated-device inference,
not a successful real OpenAI account request or rendered UI acceptance.

Separately the unmodified parent `f8e1d632` finished2749/2749 full local checks,
no skips, in `/tmp/orbyn-f8e1-full-tests.log`; its production build and CI also
pass. Those results do not qualify this later feature source. Full combined
qualification and visual/platform acceptance remain open before main promotion.

### Native desktop inspection and contrast correction

The official native Electron QA app loads the actual first-party file build,
using the marked local preview database and disposable Preview Admin account.
A temporary local stand-in provider returned fixed fixture answers; no OpenAI
plan inference was requested. The Docs panel visibly rendered the actual managed
provider label beside a cited answer. Native screenshot inspection also revealed
that the global paragraph color overrode the outgoing bubble's foreground. The
scoped `.doc-chat-turn p { color: inherit; }` correction was built and inspected;
the question now uses the intended foreground and the answer remains readable.

Evidence: `evidence/page-feature-provider/desktop-doc-provider.png`. This proves
one wide desktop Docs fixture at this source; it does not establish narrow
layouts, Study rendering, mobile rendering or real-account inference. Simulator
Computer Use access timed out twice (display name and exact installed path).
No browser permission bypass was attempted.

The full local run on parent3ef30a27 remains running but has failed assertions
during database recovery. PostgreSQL's current log identifies its checkpointer
being killed by signal9 at2026-10-05 00:19:29 UTC, followed by server reinitialization.
This evidence does not identify a particular application query as the cause.
No timers, assertions, database/JIT settings or Docker limits were waived.
The previous2749/2749 parent result does not qualify this newer source.

### Project and capture routing candidate

The owned feature-call context now accepts bounded typed page or team sources;
prompt-only project/capture requests remain limited to those named features.
Page identities are normalized and version checks use UUID joins. Team project
calls require current membership, write permission and the team's AI policy at
admission, dispatch and result acceptance. Capture keeps page exclusion and
revision guards, and summaries/deadlines remain suggestions. Project creation
still requires the existing proposal approval.

Personal-plan feature admission additionally defaults to refusing callers that
have not supplied internal app-session authority. Route callers derive that
flag from the authenticated principal, never from body fields. The shared HTTP
auth guard already rejects personal API keys on all assistant routes; this
existing restriction remains in place for managed and personal providers.
Plugin/MCP credentials and defaults remain independent.

Project and capture responses carry the actual completed provider metadata;
shared proposal reviews and capture dialogs show it on desktop/web and mobile.
Focused provider/broker/Docs/Study/project/capture checks pass49/49 without skips
in `/tmp/orbyn-project-capture-qualified-focused.log`. All workspace typechecks
pass in `/tmp/orbyn-feature-principal-final-types.log`. These additions still
need combined qualification and rendered acceptance before main promotion.

Parent3ef30a27's full local result ended2741/2756 pass,15fail after PostgreSQL
checkpointer recovery. Parentc8554662's CI37247849840 passed all four jobs.
The assistant recovery-focused suite then passed40/41; its concurrent presence
assertion failed after the batch exceeded the ten-second write interval. The
same case also failed in isolation with unchanged deadlines. Read-only plans
for the sampled poll statements had costs below1500 and no JIT; this does not
establish the cause of the burst delay. The local failure remains unresolved;
no assertion, deadline or database setting has been relaxed.

### Transaction ownership and poll diagnostics

Feature source admission and rechecks now use one transaction connection for
page/team policy checks, instead of requesting another pooled connection while
holding the admission transaction. Focused checks remain49/49 without skips in
`/tmp/orbyn-feature-source-transaction-tests.log`; backend types pass in
`/tmp/orbyn-feature-source-transaction-types.log`.

The unchanged isolated poll test passed under CPU profiling:60 simultaneous
polls took9055ms; the read while the runner row was locked took68ms, within the
unchanged2000ms deadline, with one actual presence revision. The sampled Node
profiles were mostly idle (85.5% and94%). This observation does not identify the
cause of the earlier delayed batches or replace full qualification. Evidence:
`/tmp/orbyn-presence-profile-run.log` and `/tmp/orbyn-presence-cpu-profile/`.

### Combined automated verification and maintained-page choice correction

Exact ae02bd0e completed 2,765/2,765 local tests, no failures/skips/cancellations,
production build and all four CI37251178079 jobs. Evidence logs:
`/tmp/orbyn-ae02-full-tests.log`, `/tmp/orbyn-ae02-build.log`. The old full session
handle is no longer retained; terminal TAP totals and GitHub job states were read
again. PR196 remains draft, mergeable against main82576dfa; no deployment.

Maintained-page admission now uses the explicit provider choice, selecting only
that connection's model. A catalog preference alone no longer forces ChatGPT.
New origins capture provider consent revision; legacy hosted origins are usable
only while the user still has the untouched default choice. Changed consent
blocks dispatch and result staging, including change-away-and-back revisions.
An unavailable private choice remains private and cannot silently become hosted.
The existing selected-account regression fixtures now also establish explicit
provider choice. New checks cover preference-only default routing, consent revision
changes, missing private models and consent changing during a call. Private page
execution remains required and is not implemented by this selection correction.

Selection correction verification: 39/39 maintained-page consumer/run checks,
zero failures/skips, in `/tmp/orbyn-page-choice-final-tests.log`; all workspace
types passed in `/tmp/orbyn-page-choice-types.log` and subsequent backend types
in `/tmp/orbyn-page-choice-final-types.log`. No production main promotion is
claimed from these focused results.

### Docs workspace layout inspection

The native first-party desktop build was rebuilt against the marked local preview
API8027 and inspected with the disposable Preview Admin fixture. Docs, Memory
and Agent notes no longer repeat the workspace introduction above their own
library/editor. Library listings retain a heading, and page Trash now lives in
More, matching the existing mobile page action menu. Existing page modes, source
preview, updates, exports and publishing remain accessible.

Native screenshots in `evidence/docs-workspace-layout/` record before, after and
collapsed global/library navigation. The page and comments remain visibly separate
in these wide fixtures. Actual menu inspection confirmed Move to Trash; no page
was deleted. The initial native reload became blank, and restarting only the owned
QA process restored the updated renderer. The cause is not established. Narrow,
mobile and whole-app acceptance remain open. Simulator Computer Use timed out.
Desktop types, native build and26/26 existing source-view/edit checks passed in
`/tmp/orbyn-doc-layout-types.log`, `/tmp/orbyn-doc-layout-native-build.log` and
`/tmp/orbyn-doc-layout-focused.log`. These unit checks do not prove layout bounds.

Fresh full4bed2f5a qualification encountered checkpointer PID2291 killed bysignal9
at2026-10-05 01:59:20 UTC, database reinitialization and recovery. The poll burst
returned500 instead of200 and the test-file teardown also failed during recovery.
The process remains live at the latest observation; no full success is claimed,
and no timer/assertion/database setting was relaxed. Original evidence remains
in `/tmp/orbyn-4bed-full-tests.log`.

### Test fixture cleanup after database recovery

Full4bed qualification was intentionally stopped after its poll assertions and
after-hook failed; the owned HTTP fixtures remained open. The verified process
identities and stop reason are recorded in `/tmp/orbyn-4bed-failed-run-stop.json`.
The preserved `/tmp/orbyn-4bed-full-tests.log` is a failed/interrupted run, not a
passing full-suite result. CI37253216587 separately completed all four jobs on
exact4bed2f5a; that remote success does not erase the local failure.

The affected test teardown now attempts every cleanup and aggregates all errors,
so a database failure cannot skip closing the API, database pool or mock provider.
A unit test injects synchronous/asynchronous cleanup failures and verifies later
resources still close and both original errors survive. Focused unchanged
assistant-run assertions plus cleanup tests pass43/43 with no skips in
`/tmp/orbyn-fixture-cleanup-focused.log`. No deadline/assertion/database setting
was relaxed; Docker was not restarted or reconfigured.

## Recording text routing candidate — 5 October 2026

Recording summary text now uses the durable first-party feature context and
the person's explicit provider choice. It captures the live source page/version
and recording ID, records page dependencies, and checks file readiness, page
visibility, exclusion and team policy before dispatch and result acceptance.
The signed private broker also rejects output after the recording is removed.
No new audio or voice capability is added: existing managed audio transcription
is separate, and a selected ChatGPT connection requires a transcript instead
of silently sending audio to the managed service. Explicit managed fallback
remains available for text inference under the existing consent.

Both clients expose an optional transcript field and completed-provider caption.
Generation guards discard summary/task-result state after the target recording
changes. Known private errors use fixed messages; source/consent conflicts retain
their HTTP status. Focused provider/security/source tests pass 21/21 with no
skips in `/tmp/orbyn-recording-choice-focused.log`; source-shape tests separately
pass 2/2 without acquiring a database connection. Final workspace typechecks pass, the unchanged neatness suite passes 10/10,
and the native desktop build passes. Affected native/mobile layouts still
require inspection before delivery. No real
ChatGPT completed inference, full current-source qualification or main merge
is claimed by this candidate. Agenda and maintained-page private execution
remain open, together with the full ADR contract.

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

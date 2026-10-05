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

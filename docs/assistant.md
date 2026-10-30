# Assistant

Orbyn combines personal and project chats with durable Background and Overnight
work. The backend owns orchestration, provider calls, permissions and execution;
clients display retained messages and current work state.

## Chats and Activity

**Chats** groups the personal Orbyn conversation, project chats, pinned chats
and recent chats. New project chats require a project before sending. **Activity**
opens Background, Overnight and Upcoming work. Execution jobs remain independent
of the conversation that receives their results.

With unified conversations enabled, completed work, questions and summaries return
to the captured conversation. Scheduled nights group results by delivery window
and destination. They do not create a new sidebar chat for every run. When the
flag is off, the existing chat/activity paths remain available.

Messages offer Copy and Details. Details shows currently accessible sources and
work state; Answer resumes an available waiting question, and Review opens the
existing approval flow. Stop work is available through Details. Collapsed user
messages retain their full text for expansion and copying.

On web, selecting answer text offers **Ask Orbyn** after the selection settles.
On mobile, Message options opens an excerpt-selection sheet. Both add a removable
excerpt to the existing composer without sending it or discarding typed text.
The excerpt names an exact authorized entry and is limited to 2,000 characters.
Changed or unavailable source content cannot silently reuse that reply context.

The web workspace uses Chats and detail panels around one conversation scroller.
Narrow panes use local sheets/panels; mobile uses its own drawer and keyboard-aware
composer. Panels retain drafts and reading state when opened or closed.

## Background and Overnight

Background and Overnight run in separate service processes with persisted jobs,
checkpoints, leases, budgets and current-access checks. Interactive requests keep
their own reserved runtime capacity. A result's conversation destination does not
change which process owns its execution.

Overnight is opt-in. Its schedule, quiet hours and review controls belong to the
person's assistant settings. Upcoming can pause new Background or Overnight
admissions independently; pausing does not stop already-admitted jobs. Current-work
cards open the specific execution chat or request **Stop this run**. Acknowledging
a stop request is not confirmation that execution ended: **Stop requested** remains
visible until polling observes a terminal state. Stopping does not undo changes
already committed. Muting conversation alerts is separate from stopping execution
or revoking access.

Both lanes show current work, actionable results and bounded finished history.
Result previews use the authorized answer, with recorded outcome evidence available
in details; a failed run without a receipt still needs review. Missing worker
heartbeat evidence is shown as unavailable, not proof that the worker failed.

Creating a routine in Upcoming reviews its schedule, per-attempt token allowance,
active AI work time and optional automatic-change categories together. Active time
counts execution and resumes, excluding queueing and waiting for a decision.
Tighter account, Overnight and recovery limits can stop work sooner. Approving
saved changes can still finalize them; it does not give model work a fresh budget.
These creation limits do not enable retries, which remain a separate opt-in.

Upcoming offers lazy, paginated history for an individual routine. Each occurrence
shows its scheduled time, observed execution state and recorded recovery count.
Opening history does not rerun work or change the routine. Source/chat access is
checked when reading each page; unavailable results show **Result no longer
available** with occurrence metadata only, without output or an Open result action.
The ledger records admitted occurrences, not a complete archive of past schedules.

Overnight shows **Changes kept**, **Changes pending review** and Keep/Undo controls
only when an accessible run has an actual proposal, staged steps or recorded changes.
Informational answers do not acquire change claims from bookkeeping status alone.
Restricted results remain generic. Bulk review is offered when there are eligible
changes; mixed sets use neutral review wording and preserve the server's exact
finished-run snapshot and decision tokens.

Actions follow current assistant grants and team permissions. Unattended deletion,
outside email, teammate notifications and publishing require Review. An answer or
an excerpt is context for a request, never extra permission.

## Explicit goal work

A planner goal and an explicit goal execution are separate records. Starting goal
work requires the signed-in person to review its criteria, choose Background or
Overnight, and set an attempt limit, estimated token allowance and deadline. An
active planner goal does not start this execution implicitly. Existing weekly
check-ins remain a separate intent and do not compete with an open execution for
the same goal.

Each criterion has a stable work unit. A bounded job investigates or produces its
result, a read-only verification job checks it, and a repair job can revise an
existing bound output using its current version. Applied creation work is consumed;
changing a title or starting another job does not authorize creating a second copy.
Automatic repair currently supports versioned task updates and document edits.
Unsupported repairs, missing output identities or uncertain effects hold the work
for review. A structured blocked criterion may leave other criteria runnable.

The execution uses the existing Orbyn runtime, configured provider routing,
assistant grants, Review rules and result destinations. Starting or continuing work
does not broaden those permissions. Current goal requirements, sources, provider
choice and scope are checked again at execution boundaries. Changed or revoked
evidence cannot silently be replaced by a new context. Repeating failed work
requires positive no-effect or acknowledged-rollback evidence; an unknown effect
is held. Repair after a known applied result uses the bound outputs instead. Attempt and token bounds are cumulative across jobs and recovery,
with conservative reservations when usage is unknown; these are execution estimates,
not provider billing totals.

Each criterion has at most one open attempt. A job waiting for an answer or
approval parks that criterion while independent criteria may continue. Answer
resumes the same job and saved checkpoint; it does not create a replacement attempt
or grant more permission. Pending Review also keeps the original proposal and unit
identity. These jobs share the execution's cumulative attempt, token and deadline
allowance; a parked job retains its reservation. Existing lane limits still apply,
and two jobs for the same goal do not run simultaneously.

The current-job link is a presentation focus. Waiting results remain separately
available for every parked criterion. Budget settlement records a terminal job's
charge once; frontier consumption separately records that its result or Review
decision has been handled. A finished proposal may therefore be charged while its
unit stays open in Review. Pause blocks new admissions while already-admitted work
may finish. Stop invalidates the execution generation and requests cancellation of
all its admitted jobs, including parked ones, without undoing committed changes.
Terminal attempts still settle after Stop; late results cannot reopen work.

**Ready for your review** is not accepted completion. The person can accept only the
current criteria and evidence, after active work, unanswered questions, pending
approval, uncertain effects and nonpassing required checks have been resolved.
Acceptance records an explicit person attestation. Model text, a finished job,
opening a result, approving a proposal or manually marking the planner goal done
cannot create that attestation. Result details and attempt history recheck current
source access; restricted or pruned results retain metadata without content or
job/chat links.

These contracts do not establish full Open Duet behavior parity, a hosted worker
rollout or installed-native qualification. The existing runtime and provider
configuration remain sufficient; an external execution adapter is not required.

## Routine occurrence recovery

Routine retries are an optional person setting, disabled by default. When enabled,
a scheduled occurrence may make another bounded attempt after a classified transient
provider failure with confirmed no effects. It keeps the original scheduled time;
it does not count as a new scheduled occurrence or replay a saved plan. Existing
checkpoint recovery still resumes the same job and is separate from a fresh attempt.

The policy counts the initial attempt in its maximum, shares one estimated-token
allowance across attempts, and fixes a deadline at admission. Backoff grows between
attempts and never extends that deadline. Background and Overnight use their
existing workers, provider selection, consent, lane budgets and night windows.
Retry grants no additional action scope. Applied changes, pending Review, uncertain
effects, person Stop, changed authority/configuration and unqualified failures are
not automatically repeated.

History retains the original occurrence and first run. Its recovery details show
all bounded attempts, charges, next retry time and the recorded reason. Missing or
revoked source access leaves metadata without private results or chat links. A
finished occurrence is a process result; it does not establish accepted goal
completion or verified no-change coverage.

Editing, manually pausing or re-saving a routine, or changing its retry policy,
changes its intent version and holds captured recovery rather than silently using
new instructions. A final scheduled occurrence can still recover after the
scheduler automatically pauses an exhausted recurrence, provided that intent is
unchanged. Stop occurrence cancels all its queued, running or parked jobs and
prevents further attempts of that occurrence, while preserving committed changes
and accounting. Held recovery needs a deliberate decision; Stop releases it so a
later scheduled occurrence can proceed if the routine remains enabled.

## Configuration and rollout

Select providers and models in **Admin → AI**. Configure service encryption keys,
private service addresses and rollout flags in the server environment; see
[setup](setup.md#ai-providers) and [environment](environment.md). Provider availability
and personal-account transports have their own configuration and consent boundaries.

`ASSISTANT_CONVERSATION_ENABLED` defaults to `false`. The retained timeline and
associated UI are implemented in main, but a deployment must explicitly enable
the flag consistently for API, AI, Background and Overnight. Required migrations,
rollback behavior and history retention are documented in
[deployment](deployment.md#unified-conversation-rollout-opt-in).

The implementation records preserve local web/Expo-web qualification. They do not
establish the configuration of a hosted instance, installed-native behavior or a
live external provider's availability. See [verification](verification.md).

## Contract owners

| Contract                                                       | Source                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feed, source visibility, replies, read state and work controls | `backend/src/modules/assistant-workspace/`                                                                                                              |
| Interactive jobs and orchestration                             | `backend/src/modules/ai/`                                                                                                                               |
| Explicit goal work and person acceptance                       | `backend/src/modules/assistant-workspace/goal-executions.ts`, `backend/src/worker/goal-executions.ts`, `packages/core/src/assistant/goal-executions.ts` |
| Shared retained-entry and reply schemas                        | `packages/core/src/assistant/assistant-conversation.ts`, `packages/core/src/schemas.ts`                                                                 |
| Web UI                                                         | `desktop/src/features/assistant/`                                                                                                                       |
| Mobile UI                                                      | `mobile/src/features/assistant/AssistantScreen.tsx`, `mobile/src/features/assistant/AssistantDrawer.tsx`                                                |

See the [API contract](api.md#retained-assistant-conversations),
[architecture](architecture.md#assistant-conversations-and-execution) and
[mobile guide](mobile.md).

## Outcome presentation and external execution boundary

A run ending and a goal being accepted are different facts. The shared activity
label for `done` is **Run finished**. Interactive responses use structured stopped,
timed-out and error signals when available, and distinguish pending proposals,
applied changes and discarded changes. A response with no accepted-goal contract
is **Response ready**. Current jobs and authorized saved/retained turns can carry
an optional durable execution receipt; older turns may lack it. Clients must remain
neutral when that evidence is absent. Do not derive status from response prose.

Background/Overnight deliveries distinguish result, question, failure and morning
summary. A result links to its execution work when available, or the appropriate
activity view. A closed question is not an accepted goal. Waiting and failed runs
precede finished runs during review without rewriting their retained history.
Changing notification visibility, acknowledging a result or opening an artifact
must not promote an incomplete outcome to completed.

Today also reads the existing current-access assistant profile snapshot for
**Recent agent work**, independently of retained-conversation rollout. Decisions
and failure receipts remain visible; finished outputs group by existing chat
identity inside a default-collapsed Finished run history disclosure. Its latest
count and date describe the endpoint's bounded output window, not unread or
unreviewed work. Per-routine history is a separate read; the profile snapshot does
not supply goal/routine/project grouping or a last-visit watermark, so this is
recent observed work, not an unread count or proof of overnight completion. Each row opens its existing result or lane activity.
Failed reads expose Retry rather than an empty-success state. Web/mobile share
the profile derivation and retain account-generation cancellation fences.

Current-runtime execution receipts are stored on server-owned jobs, separate from
proposal decisions and process termination. A normal answer remains **Outcome not
verified**; budget limits and incomplete specialist reports produce **Partial
result**; explicit stop, runtime failure and restart interruption stay distinct.
Goal completion requires a trusted acceptance record and passing recorded checks.
Explicit goal executions provide first-party person acceptance; ordinary chats and
weekly check-ins do not acquire acceptance from their prose or process status.
Both clients expose the recorded reason, checks and open questions in Outcome
details. Reviewing a proposal resolves its waiting state without certifying the
goal, and a newer neutral response cannot bury an earlier partial result in a chat.

A failed acknowledgement does not prove that a change rolled back. The runtime
records the start of an apply separately from its atomic effect/result transaction,
then reconciles the same job's authorized receipt before revising or replaying.
A confirmed change or Review proposal is retained. An unreconciled apply or private
inference dispatch shows **Execution uncertain** and needs review; it cannot
silently become a fresh attempt. Internal terminal qualification distinguishes
provider configuration, transient failure, stop, deadline and recovery exhaustion.
It does not itself admit retries or continue a goal.

Receipts are projected onto currently accessible chat and retained-conversation
turns. The legacy stored turn shape is unchanged; client history imports cannot
create trusted receipts. First-party clients negotiate additive receipt fields with
`x-orbyn-outcomes: 1`, preserving strict older profile/conversation readers. Older
servers ignore that header and return their previous shape. Missing, malformed,
foreign-job or expired evidence stays neutral. Personal-only exports retain their
existing source projection and omit these optional runtime receipts.

The isolated execution protocol has local contract checks for lost acceptance,
reconciliation, event identity, generation fencing, cancellation and effect
admission. It registers no transport or scheduler. Those pure checks do not qualify
a real worker, atomic external effects, tenancy or an operational Duet pilot.

Open Duet remains a candidate isolated execution adapter. It is not enabled or
required for Orbyn's existing Background/Overnight runtime, manual planning,
presets, Library discovery or this presentation. Those execution lanes use Orbyn's
configured providers and service processes; their availability and admission rules
still apply.
Orbyn remains the schedule, job, grant and review authority. Before enabling an
adapter, demonstrate per-owner credential/workspace isolation, persisted dispatch
intent and reconciliation after a lost acceptance response, generation fencing,
duplicate-event/effect handling, restart recovery, budget exhaustion, cancellation
request versus confirmed stop, revoked-access handling and late-result rejection.
An accepted request or successful worker exit cannot establish an accepted goal.
Outputs need actual artifact/source versions, performed checks, uncertainty and
an actionable next step. Publishing, messaging, spending, access changes and
production effects retain their own authority. No duplicate scheduler, broad
computer use or automatic memory synchronization follows from an adapter.

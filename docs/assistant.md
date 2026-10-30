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

| Contract                                                       | Source                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Feed, source visibility, replies, read state and work controls | `backend/src/modules/assistant-workspace/`                                                               |
| Interactive jobs and orchestration                             | `backend/src/modules/ai/`                                                                                |
| Shared retained-entry and reply schemas                        | `packages/core/src/assistant/assistant-conversation.ts`, `packages/core/src/schemas.ts`                  |
| Web UI                                                         | `desktop/src/features/assistant/`                                                                        |
| Mobile UI                                                      | `mobile/src/features/assistant/AssistantScreen.tsx`, `mobile/src/features/assistant/AssistantDrawer.tsx` |

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
Goal completion requires a trusted acceptance record and passing recorded checks;
this change does not introduce an acceptance writer or infer acceptance from prose.
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

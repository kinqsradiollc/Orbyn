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
admissions independently; pausing does not stop already-admitted jobs. Muting
conversation alerts is also separate from stopping execution or revoking access.

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
is **Response ready**. Retained saved turns do not currently preserve a durable
accepted-goal outcome or every live stop/timeout flag; clients must remain neutral
when that evidence is absent. Do not derive status from response prose.

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
unreviewed work. The endpoint does not supply goal/routine/project grouping or a
last-visit watermark, so this is recent observed work, not an unread count or proof
of overnight completion. Each row opens its existing result or lane activity.
Failed reads expose Retry rather than an empty-success state. Web/mobile share
the profile derivation and retain account-generation cancellation fences.

Open Duet remains a candidate isolated execution adapter. It is not enabled or
required for manual planning, presets, Library discovery or this presentation.
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

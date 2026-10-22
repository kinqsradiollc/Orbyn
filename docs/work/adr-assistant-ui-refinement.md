# Assistant UI refinement: reading, composing and inspecting work

**Status: ACCEPTED — implemented locally; web/desktop and Expo web verified.**

Research: 21 October 2026, Australia/Melbourne. Source: `main` at
`db4eb64956cf7cbdeebc468d459c1deae2856440` plus the locally qualified unified
conversation implementation. This ADR builds on
[the unified-conversation ADR](adr-unified-assistant-conversation.md); it does not
reopen its delivery, permission, execution or retention decisions.

## Decision in plain language

Make the Assistant feel like one calm place to read, ask and follow up. Keep the
conversation central, use one compact header, and reveal tools or work details
when they are relevant. Preserve Orbyn's planner functions and visual tokens.

This is a focused redesign of the Assistant's presentation and interactions.
It does not need another orchestration rewrite. Most work belongs in the web and
mobile renderers. Message editing, branching and regeneration need separate
runtime decisions and remain excluded.

## What was actually inspected

The user supplied these two conversations, opened in **Chrome**:

- [Reference A](https://chatgpt.com/c/6ad6f02c-8fec-83ec-a488-c6afc052fc74)
- [Reference B](https://chatgpt.com/c/6ad6c562-b444-83ec-9599-6bb99f1c4b06)

Chrome's measured desktop viewport was 1672 × 947 CSS pixels, device pixel ratio 2.
These measurements are not a claim about browser zoom or mobile behavior. The
current Orbyn web preview was also inspected at `http://127.0.0.1:15174/app`;
its screenshot viewport was 1280 × 720. Different themes and widths prevent a
pixel-for-pixel comparison. Source review covered both clients.

### Evidence and limits

| ID  | Observation                                                                                                                                                                                  | Implication and limit                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Both supplied links opened with the signed-in ChatGPT shell, narrow app rail, conversation navigation and a bottom composer.                                                                 | Useful hierarchy reference. This inspection does not establish when a feature was released.                                                                                                                                  |
| R2  | Reference A showed one prompt and an unavailable assistant response. One reload retained that failure. Reference B also showed unavailable assistant responses.                              | Successful answer formatting, citation expansion, generated artifacts, reasoning progress and answer-selection interactions could not be qualified. No regeneration was triggered to manufacture evidence.                   |
| R3  | Scrolling up in B exposed an older-history loading state and a return-to-bottom control. That control returned to the latest area; the composer stayed at the bottom.                        | Observe the reading/navigation pattern. Successful loading of all earlier messages and arrival-during-generation behavior remain unverified.                                                                                 |
| R4  | A long prompt in B was visually abbreviated. Show more expanded it; Show less restored the collapsed state.                                                                                  | Long input can be readable without occupying most of the thread. No private prompt text is needed in this ADR.                                                                                                               |
| R5  | Message rows exposed compact copy/edit/share and response-action controls. The inspected response overflow contained a time and a branching command.                                         | Adopt compact, contextual actions where Orbyn can honor them. Presence of a command is not proof of its execution semantics. Edit/share/branch/regenerate were not invoked.                                                  |
| R6  | The composer kept its empty field compact and disclosed files/tools through a menu. Model and voice controls were separately visible.                                                        | Use progressive disclosure, not a permanent tool catalogue. The menu was inspected without selecting a tool, uploading, changing a model or sending a message. Those ChatGPT capabilities are not automatically Orbyn scope. |
| O1  | Orbyn's current web preview already has a flat answer surface, right-aligned user messages, a docked composer, inline proactive updates and collapsed details.                               | Preserve this foundation. This is not a proposal to add a second timeline or duplicate reply controls.                                                                                                                       |
| O2  | Orbyn's header combines Chat/Work, assistant identity, history/new-chat actions and Upcoming. Work here means project conversations, while Background/Overnight are separate activity views. | The terminology mixes conversation scope and execution mode. Simplifying this is a concrete improvement.                                                                                                                     |
| O3  | The current update renderer repeats lane/date metadata and Reply/Details for each update, and exposes generic Page/Task source labels.                                                       | Preserve useful origin/status but reduce repeated metadata and make the inspected source identifiable.                                                                                                                       |

No private conversation bodies, account data, screenshots or external transcripts
are stored in this repository. Reference UI was inspected through rendered Chrome
controls and screenshots, not private APIs, hidden app state or another person's
accounts. These are observations of this account on this date, not claims about
all ChatGPT clients. Native/mobile ChatGPT was not inspected in this pass; the
user's earlier mobile images remain visual references only.

Research was completed directly. The available delegate contract still advertises
Priority processing without a Standard selector; repository policy forbids that
substitution. No independent review, new chat, model panel or REA execution is
claimed. Ordinary rendered UI research did not require binary reverse engineering.

## Approved mockup contract — 22 October 2026

The reviewed interactive mockup is `assistant-ui-preview.html` in this chat's
visualization directory, SHA-256 to be recorded with implementation evidence.
It is a design reference, not application code or backend qualification.

- **Conversation** is the default wide layout: the current global navigation rail,
  a compact Chats sidebar, a single conversation header, flat assistant messages,
  grouped dates, right-aligned user messages and a docked composer. Chat groups
  are main Orbyn, Projects, Pinned and Recent. New chat has one visible home.
- **Focus** is the same production conversation with Chats closed, not another
  mode, model or separate conversation. Opening or resizing panels preserves the
  person's draft, exact reply target, selection and reading anchor.
- **Mobile** uses the same information hierarchy with native components. Chats
  opens as a drawer; details becomes a sheet; existing app-level navigation remains.
  Do not ship the mockup's disabled surrounding-app controls.
- Activity is one compact header action. It exposes Background and Overnight;
  Upcoming and its independent controls remain reachable from the conversation
  menu/activity. Remove the ambiguous Chat/Work switch while preserving project
  creation, project scope and project conversation history.
- Message actions are Copy, relevant Reply/Answer/Review and one Details surface.
  Long user text expands reversibly. Details uses identifiable, currently authorized
  sources, per-run results and factual completion/delivery times.
- Selected-text follow-up uses one settled Ask Orbyn action and an editable/removable
  excerpt target in the existing composer. It must not submit automatically or
  bypass question/Review semantics. A bound server excerpt identity is required;
  arbitrary cached selection text is not provenance.
- Actual application messages, sources, replies, controls and work actions must use
  current server data and existing authorization. Do not transfer synthetic sample
  messages, canned responses, local-only state transitions or mock timestamps.
- Keep the existing neutral surfaces, restrained blue accent, theme tokens,
  typography and accessible targets. Exact mockup pixel values are illustrative;
  real pane width, text scaling, safe areas and reduced motion own behavior.

## Existing Orbyn capabilities to reuse

| Owner                                                                                                                                                       | Already present                                                                                                                                                   | Proposed change                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AssistantView](../../desktop/src/features/assistant/AssistantView.tsx), [styles](../../desktop/src/features/assistant/assistant.css)                       | One scrollable thread, 760px maximum reading column, sticky composer, compact history overlay, Latest control, anchored earlier messages, scope and project mode. | Simplify header and navigation; retain scroll, drafts and container-width adaptation. Tune spacing by real pane width, not by copying a different viewport.                              |
| [ProposalReview](../../desktop/src/components/ProposalReview.tsx), [shared rich-text parser](../../packages/core/src/richText.ts)                           | Headings, paragraphs, lists, inline formatting and locally scrolling tables.                                                                                      | Audit and reuse these renderers. Give plain answers and automated results consistent presentation without merging their action semantics. Do not add another Markdown parser by default. |
| [ConversationUpdate](../../desktop/src/features/assistant/ConversationUpdate.tsx), [mobile counterpart](../../mobile/src/components/ConversationUpdate.tsx) | Exact Reply/Review targets, expandable results, current closed state, sources and work navigation.                                                                | One compact action treatment; clearer details sections and source labels; retain stable IDs, state and authority.                                                                        |
| [Mobile Assistant](../../mobile/src/screens/AssistantScreen.tsx), [drawer](../../mobile/src/components/AssistantDrawer.tsx)                                 | Primary assistant above history, separate activity destinations, selectable messages, compact composer and retained targeted drafts.                              | Match web terminology and action placement using native components, sheets and accessible targets. No web-only hover dependency.                                                         |
| [Web hook](../../desktop/src/hooks/useAssistant.ts), [mobile hook](../../mobile/src/hooks/useAssistant.ts)                                                  | Canonical home, retained feed, independent live turns, exact replies, retry state and saved history.                                                              | Preserve the state owners. Presentation changes must not reinterpret an update as a new foreground job.                                                                                  |
| [Settled document selection](../../desktop/src/features/docs/useSettledSelection.ts), [document assistant](../../desktop/src/features/docs/DocChat.tsx)     | Existing selection settling and selected-text assistant workflows.                                                                                                | Reuse the underlying settling behavior if selection follow-up is approved. Do not render an additional document toolbar globally.                                                        |

## Accepted design

### 1. One header; separate conversation scope from work activity

Recommended default:

- One compact Assistant header: Chats entry, active conversation/assistant title,
  and one overflow control. Put New chat in the Chats surface; do not repeat it
  in the drawer footer, header and composer at the same breakpoint.
- Keep the main named assistant first in the drawer. Follow with project
  conversations, pinned chats and recent chats as applicable. Do not duplicate
  the canonical conversation in history.
- Replace the top-level Chat/Work mode switch with clear conversation grouping.
  A new project conversation chooses its project once. Existing project chats
  retain their scope; returning to Orbyn never requires choosing a project.
- Keep Background and Overnight clearly named as activity destinations. Use a
  compact Activity entry to reach them; do not call both project chat and worker
  execution simply Work. Upcoming remains reachable from the conversation menu
  or Activity surface, with one route to its existing controls.
- Preserve current workspace tabs, pane alignment and user-selected widths.
  The Assistant must not add another app sidebar or reset the global rail.

This is a navigation change, not deletion of project conversations or work views.
Whether the wide Assistant history stays pinned or is manually opened must follow
the available **pane** width and existing sidebar preference.

### 2. Improve the reading rhythm and long-message behavior

- Keep assistant answers on the flat reading surface and user messages visually
  distinct. Retain the current readable column; refine measured gaps and line
  height before changing typography tokens.
- Add a shared date separator for chronological groups, while keeping a subtle
  Background/Overnight label on automated entries. Exact completion/publication
  times remain discoverable in details; delayed delivery must not imply work
  completed at publication time.
- Add reversible long-user-message expansion. Proposed starting point: clamp
  ordinary pasted text after roughly eight visible lines, measured at the actual
  pane width. This threshold is a product choice to verify, not a standard.
  Preserve full text for copy and accessibility. Expanding/collapsing preserves
  reading position; do not truncate stored messages or hide errors/approval terms.
- Reuse the existing rich-text renderer for authorized automated-result text
  where supported. Keep tables locally scrollable. Code blocks, math and richer
  artifacts require a demonstrated content need and a separate renderer decision;
  no claim is made that they are currently supported or observed in these references.
- Keep Latest and anchored earlier-history loading. Preserve the explicit previous
  saved-history boundary: visual polish must not silently import legacy content
  into the canonical timeline or model context.

### 3. Compact, consistent message actions

Recommended action contract:

| Message                     | Primary available action              | Secondary actions                                                       |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| Person's message            | Copy                                  | Expand/collapse when long; other commands only if implemented safely    |
| Foreground answer           | Copy                                  | Sources or changes when present; existing relevant follow-up actions    |
| Background/Overnight result | Reply                                 | Copy, Sources and Activity/details                                      |
| Current person question     | Answer                                | Details and exact Stop                                                  |
| Approval request            | Review                                | Details; never an apparent one-click plain-text approval                |
| Closed/replaced question    | Closed state                          | Details; no active Answer affordance                                    |
| Failed work                 | Factual failure and relevant recovery | Activity/details; any rerun requires explicit intent and current checks |

Use one message-action component contract in each client, with shared capability
calculation where useful. On desktop, reveal low-frequency actions on hover **and
keyboard focus**, with the latest/relevant action discoverable. On touch, provide
an accessible menu/button; long press may supplement it. Copy gives brief local
confirmation. Do not add rating, sharing, voice or regeneration merely because
ChatGPT displays them. Never use Copy to transmit content to another service.

Selection follow-up is a second-stage recommendation: after a selection settles,
show **one** contextual Ask Orbyn action that quotes the selected authorized entry
in the existing composer. Do not send automatically or open competing toolbars
while dragging. It must coexist with browser/native text selection and existing
note-selection tools. If permission is lost, clear the target rather than send
cached text. A reply excerpt should identify its entry and be removable.

### 4. One composer with concise context and factual progress

- Keep the existing compact dock, growth cap and shrink-on-clear behavior.
  Use one short removable target/scope chip when needed, without rebuilding or
  clearing the draft when panels open.
- Keep Send and exact Stop visible for their real states. Progress belongs near
  the active response; avoid repeating the same state in the header, thread and
  composer. Do not invent token streaming, thought text or progress percentages.
- Existing suggestions and scope tools should be disclosed through one compact
  control where useful. Only show actions the configured account can actually
  perform. Do not add inactive attachment/model/voice icons as visual decoration.
- Keep material provider/data-sharing context discoverable and concise. Removing
  routine explanatory clutter must not conceal recipient, sensitive scope or
  approval consequences.
- Use focused status announcements rather than re-announcing an entire growing
  timeline. Preserve keyboard submission, multiline composition, IME behavior,
  focus return and mobile text scaling. Native keyboard/safe-area checks need
  separate authorization and evidence during implementation.

### 5. Better source and activity details without another permanent panel

Use the existing details affordance as one coherent inspector:

1. Useful result and current state.
2. Identifiable sources with current authorized titles, not a row of identical
   generic Page labels. A title projection is a contract change: the server must
   resolve it under current entry/source access. Do not cache hidden titles in a
   UI-only map or infer them from another conversation.
3. Relevant changes and the exact work link; Overnight can expose its per-run
   excerpts without creating separate default conversations.

Recommended presentation: a lightweight details popover/sheet when sufficient;
use the existing right-panel system only when sustained reading needs it. On a
narrow pane use a sheet with focus return. On wide layouts, panel resizing must
preserve the thread anchor and composer draft. Reuse the current shell panel owner
rather than implement a competing resizer/tab stack inside the Assistant.

## Layout sketch

```text
Existing workspace tabs remain unchanged
┌──────────────────────────────────────────────────────────────────┐
│ Chats     Orbyn / current conversation                     ⋯      │
├──────────────────────────────────────────────────────────────────┤
│ Optional Chats     │           date group                         │
│ drawer/panel       │                         person's message     │
│                    │ assistant answer                             │
│ Orbyn              │ copy · sources/details when relevant         │
│ Project chats      │                                              │
│ Pinned             │ Background  useful update                    │
│ Recent             │ Reply · details                              │
│                    │                       Latest if away          │
│ Activity           │ [optional reply/scope chip]                  │
│ New chat           │ [tools] Message Orbyn…                Send   │
└──────────────────────────────────────────────────────────────────┘
```

This is an information-hierarchy sketch, not a final pixel specification. Existing
Orbyn tokens, platform controls and real pane measurements own implementation.

## Alternatives and consequences

| Option                                          | Outcome                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy ChatGPT's full shell, tools and controls   | Rejected. It would duplicate Orbyn navigation and advertise unsupported functions. The unavailable responses also make full parity unevidenced. |
| Apply cosmetic spacing changes only             | Insufficient. It leaves the Chat/Work ambiguity, missing message actions and generic source inspection unchanged.                               |
| Refine the existing Assistant in bounded stages | Recommended. Reuses the qualified timeline/runtime and existing renderers while making the interaction hierarchy consistent.                    |

Consequences: fewer visible controls, better long-conversation scanning and more
work details on demand. Secondary functions become one step deeper, so keyboard,
touch and new-user discoverability must be checked. Long-message collapse needs
reliable anchoring. Source titles need a small authorized server projection;
selection follow-up needs an exact excerpt contract. Neither is merely CSS.

## Implementation sequence

1. **Shell and reading:** header/drawer terminology, date grouping, long-message
   expansion, restrained spacing. Preserve all currently qualified state owners.
2. **Message actions and details:** Copy, exact Answer/Review labels, coherent
   source/activity details and authorized source-title projection.
3. **Selection and composer refinement:** settled-selection excerpt contract,
   contextual follow-up and tool disclosure, after agreeing its scope. No duplicate
   selection surfaces across documents and chat.

Each stage includes both web/desktop and mobile renderers. Reuse the repository's
TypeScript/Zod/API client, React/CSS and Expo/React Native stack. No new UI kit,
remote assets, orchestration framework, database migration or provider is assumed.
Separate any actual shared API/schema change before implementation.

## Acceptance criteria

- The person can identify the current conversation, open its history, start a
  project conversation and inspect Background/Overnight without ambiguous Work
  destinations or duplicate canonical rows.
- At narrow pane widths, history/details use one overlay at a time and return
  focus. Wide inspectors leave the composer visible; closing a narrow sheet
  restores its draft and quote. Panels do not resize the global sidebar.
- Long pasted messages expand/collapse without losing text, focus, reply targets
  or scroll position. Wide tables do not widen the page.
- Copy works for user text, answers and authorized updates; feedback is local.
  Keyboard and touch can reach every action without hover-only dependencies.
- Selection controls appear only after selection settles; there is no flashing
  during drag and no duplicate toolbar from the document editor.
- Incoming results do not replace the foreground answer, draft, selection or
  reading anchor. Latest remains usable; fetched-but-covered entries stay unread.
- Date grouping and source-title disclosure preserve completion/publication
  meaning and current permission checks. Revocation removes dependent titles,
  selected excerpts and content before a new send/provider request.
- Answer targets the exact current question. Review keeps existing approval/version
  semantics. Stop, pause, mute and cancel retain their different effects.
- Check shared web/desktop and Expo web with long content, current/closed questions,
  permission loss, loading/error, split panes, details and normal text scaling.
  Include 320/390px phone-width and a narrow split pane on a wide window, light
  and dark themes, keyboard focus and reduced motion where affected.
- Native integration, live providers, OS push, share/edit/branch/regenerate and
  new tools are not qualified by a browser layout check or authorized by this ADR.

## Approved defaults

The user approved the mockup and authorized full implementation on 22 October 2026:

1. Replace Chat/Work with conversation grouping; keep Activity distinct.
2. Keep the thread flat; group dates and collapse long user messages reversibly.
3. Add Copy and contextual actions; do not add rating/share/voice/regeneration.
4. Use one on-demand details surface with properly authorized source titles.
5. Include settled-selection follow-up as stage 3, using the existing composer.

The preceding unified-conversation implementation is in PR #222. This UI work
has its own local branch and does not change that PR until separately delivered.

## Evidence and delivery state

Research used rendered Chrome observations and current-source/web-preview
comparison. The approved mockup is the design reference; synthetic prototype
responses are not part of the product implementation. Current source ownership,
API contracts, rendered checks, limitations and delivery state are recorded in
[the implementation record](assistant-ui-implementation.md). No private reference
screenshots are committed.

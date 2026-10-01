# Web and settings redesign

Status: accepted user scope; design and implementation incomplete.
Governing contract: [DevDay implementation review](devday-2026-implementation-review.md),
U1 and M1. Complete that goal before declaring this release ready.

## Direction

Keep the current palette, bundled fonts and radius tokens. Improve the web app's
hierarchy, spacing and interaction design across every authenticated surface.
Retain mobile's visual design and bring the required functionality into it.
Use fewer competing containers, consistent page headers and a clear primary
action per view. Lists, editors and detail panes need deliberate layouts rather
than identical cards wrapped around every element.

## Settings structure

Settings uses a dedicated category rail and a readable content column on wide
screens. On narrow screens the category menu opens as a contained navigation
sheet, with the current category visible beside the page title. Settings search
remains accessible in both layouts and navigates to the actual control. Deep
links and existing command-palette entries retain their destinations.

| Destination    | Controls                                                               |
| -------------- | ---------------------------------------------------------------------- |
| Account        | Identity, email and account information                                |
| Appearance     | Theme, reading, start page, layout and shortcuts                       |
| Planning       | Working hours, scheduling preferences, frames, habits and tags         |
| Notifications  | Reminders, delivery channels and quiet hours                           |
| AI & models    | Personal ChatGPT connections, account/device status and model defaults |
| Connections    | Calendars, external agents, clipper and other integrations             |
| Security       | Password/sign-in methods, two-factor, passkeys, sessions and devices   |
| Privacy & data | Visibility, consent, portability and account deletion                  |

These are proposed destinations, not current supported tab IDs. Updating the
shared settings index, search, legacy links and both clients is part of the
implementation. Controls with existing semantics must preserve them. Avoid
placing all useful controls behind a long sequence of collapsed sections;
keep the most important controls visible and group advanced choices locally.

## ChatGPT experience

The AI & models page opens with a connection list and an identifiable Connect
ChatGPT action. Connect launches the implemented eligible authorization flow;
cancel and failure preserve other connections. Show account/workspace identity,
connection health, credential-owning device, last catalog refresh and the saved
default. Multiple accounts and devices require explicit selection.

The model chooser searches the account catalog and preserves the provider's
ordering. Display the current choice even when it becomes unavailable, with a
clear action to choose a replacement. Do not silently select a different model.
Use the same persisted default in settings and the assistant composer. Handle
version conflicts by refetching state rather than overwriting another device.

Reconnect and disconnect belong in each connection's management menu. Explain
offline device status alongside the affected models. Web/mobile must show their
actual available actions; they must not imply that the browser owns desktop
credentials. A connection to ChatGPT as an outside MCP agent is described
separately from using a ChatGPT plan for Orbyn inference.

## Provider administration

Admin AI has a searchable list of saved provider connections, with a new
connection flow. Support multiple connections of one provider kind, local
servers and custom compatible endpoints. Each connection displays health,
capabilities and its discovered models. Keys are masked; connection tests and
model refreshes have explicit pending, success and failure states.

Separate text-generation and embedding selections. Embedding controls show
provider, model, verified dimensions and indexing status. Explain the existing
content-sharing consent using the selected embedding provider. Replacing the
model must safely invalidate or rebuild incompatible vectors. Generation and
embedding settings cannot assume the same adapter or credentials.

### Confirmed current gaps

- `SettingsView.tsx` describes AI only as an admin-managed provider; it has no
  personal ChatGPT plan connection UI.
- `AI_PROVIDER_KINDS` already contains twenty definitions. Adding names to that
  list alone does not provide tested adapters or improve discovery.
- `SemanticSetup.tsx` asks for an embedding model name but uses the assistant's
  provider; `resolveAi()` selects the global `ai_settings.provider_id`.
- The session-only catalog/default backend is integrated locally on main.
  Packaging, connection settings, composer/default state and real provider
  interaction remain incomplete.

## Full web audit

Record defects and before/after evidence for the shell/navigation, Home, Agenda,
tasks, calendar, projects, Docs, memory, agent notes, views, study, lists,
assistant, Overnight, teams, booking, notifications, review, settings and admin.
Use a shared component inventory to catch regressions in consumers. Each
surface needs intentional empty/error/loading states, long-content containment,
accessible labels and focus, and consistent management menus.

## Delivery evidence

Keep implementation status per destination and per surface. Require focused
tests, shared/client/backend typechecks, builds and the full suite before a
production checkpoint. Exercise real web interactions at phone, tablet and
desktop widths, both themes, large text, long labels and large model catalogs.
Verify focus, search, saves, account switching, offline behavior and nested
overlays. Verify mobile feature parity and native behavior separately.

This document does not claim any redesigned screen is implemented or tested.

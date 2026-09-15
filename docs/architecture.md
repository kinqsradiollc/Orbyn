# Architecture

Orbyn is a set of backend services, two client apps and PostgreSQL. The clients never talk to the
database or to AI providers directly; everything goes through the gateway.

```
 web / Electron ─┐                  ┌─► api ─────┐
                 ├─► load balancer ─► gateway ──┼─► ai ──────┼─► PgBouncer ─► Postgres primary
 mobile (Expo) ──┘    (production)  └─► status ──┘                  │        └─► read replicas
                                       notifier ─► SMTP, Expo Push ┘
```

## Services

One backend image runs each service with a different command. They scale independently and can
live on different machines; see [scalability.md](scalability.md).

| Service    | Entry point            | Owns                                                                       |
| ---------- | ---------------------- | -------------------------------------------------------------------------- |
| `api`      | `services/api.ts`      | Auth, profile, items, steps and updates, teams, admin console, devices     |
| `ai`       | `services/ai.ts`       | Assistant chat, proposals, AI provider settings (`/ai/*`)                  |
| `status`   | `services/status.ts`   | Probes every service every 30 s and serves the public `GET /status` report |
| `notifier` | `services/notifier.ts` | Reminder scheduling and delivery; heartbeat for the status page            |
| `migrate`  | `migrate.ts`           | Applies `migrations/*.sql` in order under an advisory lock, then exits     |
| gateway    | `gateway/` (nginx)     | Routes `/ai/*` to ai, `/status` to status, everything else to api          |

`server.ts` runs every module in one process for local development and tests.
`services/http.ts` gives every HTTP service the same setup: CORS, rate limiting, conditional GETs
with `ETag`, `GET /live` (liveness, no database) and `GET /health` (readiness).

## Backend (`backend/src`)

| Path              | Responsibility                                                                  |
| ----------------- | ------------------------------------------------------------------------------- |
| `config/env.ts`   | Loads `.env` and validates configuration with zod                               |
| `db/pool.ts`      | Primary and optional read-replica pools, `reader()`, `transaction()`            |
| `modules/<name>/` | One folder per area (auth, items, teams, admin, ai, status, notifications, ...) |
| `modules/items/`  | `mutate()`, the single write path with optimistic locking, plus progress        |
| `modules/ai/`     | Provider adapters (OpenAI, Anthropic, Azure formats), resolution, admin routes  |
| `worker/`         | Reminder scheduler and delivery lanes                                           |
| `app.ts`          | Which modules each service mounts (`serviceModules`)                            |

Several notifier instances can run at once: scheduling is serialized with a Postgres advisory lock,
while delivery uses `FOR UPDATE SKIP LOCKED` so instances never process the same notification
twice. Reads that tolerate brief replication lag use `reader()`, which picks the replica unless the
client has just written (read-your-writes).

### Authentication

Register and login return an opaque random token. Only its SHA-256 digest is stored in the
`sessions` table with a 30-day expiry. Passwords are hashed with argon2. Login uses a dummy hash
for unknown emails so response timing does not leak whether an account exists. Auth routes are
rate limited separately from the rest of the API.

### Data model

| Table           | Purpose                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `users`         | Account, argon2 password hash, `email_reminders` preference.                                |
| `sessions`      | Hashed bearer tokens with expiry.                                                           |
| `items`         | Tasks and events. `version` for optimistic locking, `reminder_version` for reminder dedupe. |
| `devices`       | Expo push tokens per user. A token belongs to exactly one user.                             |
| `notifications` | Reminder outbox. One row per item version, channel, and destination. Also the in-app tray.  |
| `proposals`     | AI-suggested action batches awaiting user approval. Expire after 15 minutes.                |
| `migrations`    | Applied migration file names.                                                               |

Every item write goes through `mutate()` and requires the current `version`. A stale write returns
HTTP 409 so two clients cannot silently overwrite each other. Ownership is enforced in every SQL
statement with `user_id`, and cross-tenant access returns 404 rather than 403.

### Access control

Roles and permissions are defined once in `packages/core/src/rbac.ts` and enforced only on the
server; the clients use the same helpers to decide what to show.

**System roles.** `admin` or `member`. The first account on a fresh database, and any email in
`ADMIN_EMAILS`, becomes an admin. Admins can open the admin console: see counts, list and search
accounts, change roles, disable or delete accounts, manage any team, and read the audit log.
Disabling an account signs it out everywhere and stops its reminders. The last active admin
cannot be demoted, disabled, or deleted.

**Team roles.**

| Permission                   | Owner | Admin | Member | Viewer |
| ---------------------------- | :---: | :---: | :----: | :----: |
| See the team and its members |   ✓   |   ✓   |   ✓    |   ✓    |
| Read team items              |   ✓   |   ✓   |   ✓    |   ✓    |
| Create, edit, delete items   |   ✓   |   ✓   |   ✓    |        |
| Add, change, remove members  |   ✓   |  ✓\*  |        |        |
| Rename the team              |   ✓   |   ✓   |        |        |
| Delete the team              |   ✓   |       |        |        |

\* Team admins manage members and viewers only and cannot grant admin or owner. A team always keeps
at least one owner.

**Privacy.** System admins manage every team as an owner would, but the override never covers
reading or writing items: admins cannot see anyone's personal items or a team's items unless they
are a member. Non-members get `404` for a team, so team existence does not leak.

**Enforcement points.** `lib/auth.ts` rejects disabled accounts and checks system permissions;
`lib/teams.ts` resolves team roles; `modules/items/service.ts` checks them on every item write,
including AI proposals, so the assistant can never do more than the person approving it. Moving an
item into a team needs write access there; moving it out needs member-management rights in the
team it leaves.

### Reminder pipeline

1. Every 10 seconds the worker runs `enqueue()`. For each open item whose `due_at` minus
   `reminder_minutes` has passed, it inserts one notification per channel: `inapp` always,
   `email` if the user has email reminders on and SMTP is configured, and `push` for every
   registered device. Personal items notify their owner; team items notify every active member. The unique key `(item_id, item_version, channel, destination)` makes this
   idempotent, so restarting or running many workers never double-sends.
2. `deliverOne()` claims a pending row with `SKIP LOCKED`, re-checks that the item is still open,
   still on the same `reminder_version`, that the recipient is still active and can still see the
   item, and that the destination is still valid. If not, the row
   is cancelled. This is how completing a task or changing its date suppresses stale reminders.
3. Email goes out over SMTP with a stable `Message-ID`. Push goes to the Expo push service; the
   ticket id is stored and the row moves to `receipt` state, then the receipt is checked 15 minutes
   later. A `DeviceNotRegistered` receipt removes the device.
4. Failures back off exponentially (30s, 60s, ... capped at 1h) and give up after 8 attempts.

`reminder_version` only increments when the due date, reminder window, or done-to-todo status
changes. Editing a title or notes does not resend a reminder that was already delivered.

### AI assistant

The assistant is deliberately a **propose-then-approve** agent, built like BrainRouter's agent
loop (`backend/src/modules/ai/agent/`):

1. `POST /ai/chat` runs a short tool loop. The model gets a system prompt with the user's local
   date, a small planner overview and tools, and calls the tools until it can answer: at most 8
   model calls, the last with tools turned off. Before the first call, the server looks up the
   user's items whose titles share words with the request. It adds them to the overview as
   `matching_request`, with their ids, so a change like "move buy groceries to Thursday" usually
   needs no search round trip. This keeps weaker tool users such as Matilda steady.
   - **Read tools:** `get_overview`, `search_items` (words, status, type, priority, team, due-date
     range), `get_item` (notes, checklist, recent updates) and `list_teams`. Every query is scoped on
     the server, using the session's user id, to the user's own personal items and their teams'
     items. Ids from anywhere else look like missing items, and nothing the model sends can widen
     the scope.
   - **Proposal tools:** `propose_create` (several items per call), `propose_update` (by id, with
     only the fields that change merged onto the saved item; two calls for one item combine),
     `propose_delete`, and `ask_clarification`. `ask_clarification` asks one question with up to 4
     options, returned as `follow_ups`, and ends the turn.
   - **Per-item results:** each proposed item is validated on its own. The tool reports what was
     accepted and why the rest was not, so the model can fix it in the same turn. Reasons include
     an event with no start, a duplicate, a team the user can only view, or more than 20 changes.
     Nothing is written at this stage; the accepted actions are stored as a `proposal`.
2. Guards from BrainRouter keep the loop stable:
   - An empty answer, or a reply that only announces what it will do, gets a nudge (two in
     total).
   - The same call repeated a third time is refused.
   - Several items with the same title can't all be changed or deleted when the user named one
     ("cancel the gym session"). The model is told to ask which one, unless the message says
     all, both, every or each, or uses the plural.
   - Tool results are capped at 8,000 characters.
   - Unknown tools and invalid arguments come back as errors the model can correct.
   - A provider failure is retried once, then answered with HTTP 502.
3. The client shows the summary and the proposed changes. When the user accepts,
   `POST /ai/proposals/:id/apply` runs every action through `mutate()` inside one transaction. A
   single failing action (wrong version, item belonging to someone else) rolls back the whole batch.
   Applying is idempotent.

**Consistent with BrainRouter.** The provider catalog in `packages/core/src/aiProviders.ts`
mirrors BrainRouter's: its built-in chat providers in the same order, then its declarative starter
set, with the same ids, labels, endpoints and picker visibility (a test pins this). Calls follow
BrainRouter's common OpenAI-compatible profile: `Authorization: Bearer`, a blank key sent as
`local` for local servers and as opencode's `public` key, model lists read from `data[]` or
`models[]`, error-envelope and empty-choice replies treated as failures, reasoning text used when
`content` is empty, and `finish_reason: "length"` treated as a cut-off reply. OpenAI uses the
Responses API for GPT and o-series models on its own endpoint, as in BrainRouter; Anthropic's
native API gets `max_tokens: 8192`. Cloud keys are required (except opencode) and must be at
least 16 characters; known prefixes (`sk-`, `sk-or-v1-`, `dsk-`, `mc_live_`) only produce a
warning. Deliberate differences: Matilda uses its OpenAI-compatible endpoint, with the agent's tool calls
carried inside a JSON-schema reply. BrainRouter drives Matilda's native SSE chat for tool calls
instead, but there the platform web-searches client tool results on every round trip, which
cannot be switched off. That would send private planner data to a web search, so Orbyn does not
use it. Azure keeps its `api-key` header; and
Anthropic model listing uses `x-api-key`, which its API requires.

Providers are added by admins in the admin console and stored in `ai_providers`; the active
provider and model live in `ai_settings`. There is no server-settings fallback: with no provider
chosen the assistant answers 503. Adapters speak the OpenAI, Anthropic and Azure OpenAI formats,
so any OpenAI-compatible service (including local LM Studio or Ollama) works too. Some providers need
more: Maincode's Matilda answers in prose unless it is given the reply schema, so providers flagged
`structuredOutput` receive it as `response_format` (strict JSON Schema), and providers with request
`limits` get messages clipped and the oldest history dropped first.

**Matilda gets a fixed graph** (`agent/graph.ts`), used for providers flagged `structuredOutput`.
Matilda ignores native tools. In live tests under every JSON tool protocol it wandered between
tools, asked the user which tool to use, and invented items. It does write reliable single plans
under a schema, so the server does the looking up and the model decides once:

1. **Retrieve:** the server gathers the overview plus the items matching the request. They go into
   the user message with the request, where Matilda reads them; it gives system-prompt data little
   weight. The server also works out the days the request names ("tomorrow = Wed 16 Sept
   (2026-09-16)"; "next Tuesday" is the Tuesday of the following week), because Matilda misplaced
   them even with a calendar.
2. **Answer:** a question gets one plain Markdown answer.
3. **Plan:** a change request gets one `{summary, actions}` plan under a strict JSON Schema.
4. **Validate:** the actions go through the same proposal tools as the agent: each create on its
   own, all updates in one call and all deletes in another. So scoping, per-item checks, delete
   intent and the same-title rule all apply to the whole plan. Validation also corrects for common
   model mistakes:
   - Items are shown to the model with short ids (`i1`, `i2`, …) that the server maps back,
     because Matilda mistyped full UUIDs.
   - When an update's title names a different shown item, and exactly one, that item is the one
     changed, because Matilda once copied the id from the neighbouring item.
   - Empty notes in an update keep the saved notes.
   - An update refused only for an end before its start is retried without the end.
5. **Repair:** if anything was refused, one repair call gets the reasons. Whatever is still refused
   is listed to the user under "Not proposed".

That is at most three model calls, each retried once within the same deadline.

The agent's JSON tool protocol remains as a fallback for providers that reject native tools with a
400:

- **Step format:** one field per tool plus `answer`, enforced by a strict schema, with every tool
  described in the system message.
- **History:** earlier calls are replayed as sentences, and results as `[Tool result: name]`
  messages.

Guards on proposals and the older format:

- **Changes:** proposal tools only work when the latest message asks for a change: a change word,
  a plan with a day or time, or a polite request ("can you move…"). Questions ("what's the
  launch plan about?") never count, even when they contain a change word.
- **Deletions:** only when the message asks to delete, remove or cancel something.
- **Clarifications:** a turn that ends in a question carries no proposals. Questions about tools,
  or about which date "tomorrow" is, are refused. A short reply to the assistant's own question
  counts together with the question it answers.
- **Older format:** a provider that still replies with a single `{summary, actions}` object keeps
  working. Those actions are vetted as before: only items the user can see, no edits that change
  nothing, no duplicates.

Times and history:

- Timestamps without an offset get the user's local offset.
- Tool results use the user's local time and only the fields the model needs.
- Each earlier reply in the history carries a note saying whether its changes were approved or
  discarded, so a model never repeats them.

Each provider
attempt gets 45 seconds within a 110-second deadline (BrainRouter's 120-second chat timeout and
45-second Matilda stall limit); the API client allows 120 seconds and the proxies 125. Replies are
rendered on web and mobile by one shared parser (`parseRichText` in `@orbyn/core`): headings,
paragraphs, bulleted and numbered lists, tables, bold, italic and code. Planner content
is passed to the model as data, and the prompt instructs it to treat titles and notes as untrusted.

## Desktop / web (`desktop/`)

A single-page React app built with Vite. `src/features/<view>/` holds one folder per view
(overview, tasks, calendar, assistant, notifications, settings, auth), `src/components/` the
shared UI (item row, editor modal, proposal review, sidebar, topbar), `src/hooks/usePlanner.ts` the
data layer (session, polling every 30 seconds while visible, optimistic-lock aware mutations), and
`src/lib/api.ts` the configured `OrbynClient`. Session tokens live in `sessionStorage`.

The same bundle runs three ways:

- **Dev**: Vite on port 5173 proxying `/api` to the backend.
- **Docker**: nginx serves the static build and proxies `/api/` to the `api` service with a
  per-client rate limit and security headers.
- **Electron**: `electron.cjs` loads `dist/index.html` from disk in a sandboxed window with no
  Node integration. Since the origin is `file://`, the app calls `http://localhost:8008` unless
  `VITE_API_URL` was baked in at build time.

## Mobile (`mobile/`)

An Expo app with tabs for Today, Tasks, Calendar, Assistant, Inbox, and Settings, organised as
`src/screens/`, `src/components/`, `src/hooks/`, `src/lib/` (API client, session, push), and
`src/theme/`. The session token is stored with `expo-secure-store`. On login the app requests
notification permission, obtains an Expo push token, and registers it with `POST /devices`. On
logout it deletes the device registration so reminders stop. Push notifications include the item id
so tapping one can open the right task.

### Design system

The mobile app shares its look with the web app so both read as one product:

- **Tokens.** `src/theme/index.ts` mirrors the desktop palette in `desktop/src/styles/global.css`
  (accent `#376c51`, text `#27382f`, muted `#849089`, border `#e8ece9`, background `#f7f8fa`) plus
  the priority pill colours.
- **Type.** DM Sans for interface text and Manrope for headings and the wordmark, loaded with
  `expo-font` from `@expo-google-fonts/*` in `src/app/App.tsx`.
- **Icons and logo.** `src/components/Icon.tsx` draws the same lucide icons the desktop uses with
  `react-native-svg`; only the shapes the app needs are included rather than the whole icon pack.
  `src/components/Brand.tsx` is the Orbit mark, the "orbyn" wordmark, and the green dot, matching
  the desktop `.brand`.
- **Motion.** `motion` and `staggerDelay` in `packages/core/src/presentation.ts` define one set of
  durations, stagger, travel distance, press scale, and easing curves. The web app exposes them as
  CSS variables and keyframes in `desktop/src/styles/motion.css`; the mobile app uses them with
  React Native's `Animated` and `LayoutAnimation`, with no extra animation library. Both apps turn
  animation off when the user has asked their system for reduced motion.
- **Full screen.** The app draws edge to edge. The header extends under the status bar, the tab bar
  under the home indicator, and each applies safe-area insets itself. Landscape and iPad
  multitasking are enabled in `app.json`; content is capped at 720 points wide and centred on large
  screens. The item editor is a native page sheet on iOS and a full-screen modal on Android.

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

| Service    | Entry point            | Owns                                                                           |
| ---------- | ---------------------- | ------------------------------------------------------------------------------ |
| `api`      | `services/api.ts`      | Auth, profile, items, steps and updates, teams, admin console, devices         |
| `ai`       | `services/ai.ts`       | Assistant chat, proposals, AI provider settings (`/ai/*`)                      |
| `realtime` | `services/realtime.ts` | Long-lived streams: live news (`/events`) and live documents                   |
| `status`   | `services/status.ts`   | Probes every service every 30 s and serves the public `GET /status` report     |
| `notifier` | `services/notifier.ts` | Reminder scheduling and delivery; heartbeat for the status page                |
| `migrate`  | `migrate.ts`           | Applies `migrations/*.sql` in order under an advisory lock, then exits         |
| gateway    | `gateway/` (nginx)     | Routes `/ai/*` to ai, `/events*` to realtime, `/status` to status, rest to api |

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
| `worker/`         | Reminder scheduler, planner upkeep and notices, delivery lanes                  |
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

| Table                                                          | Purpose                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `users`                                                        | Account, argon2 password hash, `email_reminders` preference.                                    |
| `sessions`                                                     | Hashed bearer tokens with expiry.                                                               |
| `items`                                                        | Tasks and events. `version` for optimistic locking, `reminder_version` for reminder dedupe.     |
| `devices`                                                      | Expo push tokens per user. A token belongs to exactly one user.                                 |
| `notifications`                                                | Reminder and notice outbox, one row per channel and destination; also the in-app tray.          |
| `proposals`                                                    | AI-suggested action batches awaiting user approval. Expire after 15 minutes.                    |
| `lists`, `tags`, `item_tags`                                   | Personal or team lists and tags on items.                                                       |
| `time_blocks`                                                  | Time each person set aside to work on a task.                                                   |
| `planner_prefs`, `frames`, `places`                            | How each person works: hours, padding, breaks, buffers, travel, notices, frames, places.        |
| `plans`                                                        | Generated plans waiting to be applied, with their inputs. Expire after an hour.                 |
| `booking_pages`, `booking_hosts`, `bookings`, `booking_events` | Public booking pages, their hosts, the bookings made on them, and each booking's timeline.      |
| `api_keys`, `webhooks`, `webhook_deliveries`                   | Personal API keys (hashed), outgoing webhooks, and their delivery queue.                        |
| `item_overrides`                                               | One occurrence of a repeating item changed on its own, keyed by its original start.             |
| `item_attendees`                                               | People invited to an event by email, their answer, and their RSVP token (hashed and encrypted). |
| `calendar_subscriptions`, `external_events`                    | Calendars read by ICS link, and their events as last fetched (read-only).                       |
| `item_links`                                                   | Web links on a task, in order.                                                                  |
| `deleted_items`                                                | Items deleted in the last 90 days and who could see them, for incremental sync.                 |
| `open_invites`                                                 | One-off links offering hand-picked windows, their link (hashed and encrypted) and booking.      |
| `migrations`                                                   | Applied migration file names.                                                                   |

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

1. Every 10 seconds the worker runs `enqueue()`. An item has up to five `alerts` (minutes before
   `due_at`). For each open item whose latest passed alert hasn't been sent, it inserts one
   notification per channel: `inapp` always, `email` if the user has email reminders on and SMTP
   is configured, and `push` for every registered device. Personal items notify their owner; team
   items notify every active member. The reminder's `ref` is the alert's minutes, and the unique
   key `(item_id, item_version, channel, destination, kind, ref)` makes this idempotent, so
   restarting or running many workers never double-sends. An item created after several of its
   alerts have passed gets one reminder, not all of them. A repeating item's current occurrence
   uses its own time, title and alerts when it was changed on its own, and gets none when it was
   removed.
2. `deliverOne()` claims a pending row with `SKIP LOCKED`, re-checks that the item is still open,
   still on the same `reminder_version`, that the recipient is still active and can still see the
   item, and that the destination is still valid. If not, the row
   is cancelled. This is how completing a task or changing its date suppresses stale reminders.
3. Email goes out over SMTP with a stable `Message-ID`. Push goes to the Expo push service; the
   ticket id is stored and the row moves to `receipt` state, then the receipt is checked 15 minutes
   later. A `DeviceNotRegistered` receipt removes the device.
4. Failures back off exponentially (30s, 60s, ... capped at 1h) and give up after 8 attempts.

`reminder_version` only increments when the due date, the alerts, or done-to-todo status
changes (or the current occurrence is changed or removed on its own). Editing a title or notes does not resend a reminder that was already delivered. Reminder
text shows the due time in each recipient's planner time zone (`orbyn_local_time()`, which falls
back to UTC for a zone Postgres doesn't know).

Reminders to bookers use the email lane too (`booker_reminder`, never in the app): each cycle
queues, for every confirmed booking starting within 8 days, the latest of its page's (or open
invite's) `remind_before_minutes` whose time has come and hadn't yet when it was booked. The
`ref` is `<booking>:<start>:<minutes>`, unique among booker reminders, so each goes once per
booking, start time and value. The email is written at delivery (`bookerReminder()`), so it
carries the current manage link without storing it, and is cancelled when the booking was
cancelled or moved, has started, or SMTP is gone.

Planner notices (`conflict`, `rollforward`, `at_risk`, `deadline`) use the same outbox and lanes.
They are always in-app, and go to push and email when the person's `planner_notices` preference
allows (email also needs SMTP). Their `item_version` is 0 and their `ref` is the block (conflicts)
or the person's local date, so `notifications_once` keeps them to one per task per day; roll-forward
notices have no item and are kept to one per day by `notifications_planner_once`. Delivery
re-checks them against that preference instead of `email_reminders`, and cancels a notice that was
dealt with in the app (a rescheduled block marks its conflict read), whose task is done or out of
reach, or whose block is gone.

### AI assistant

The assistant is deliberately a **propose-then-approve** agent, built like BrainRouter's agent
loop (`backend/src/modules/ai/agent/`):

1. `POST /ai/chat/start` runs a short tool loop in the background (the apps poll `GET /ai/chat/:id`; `POST /ai/chat` does the same in one request). The model gets a system prompt with the user's local
   date, a small planner overview and tools, and calls the tools until it can answer: at most 8
   model calls, the last with tools turned off. Before the first call, the server looks up the
   user's items whose titles share words with the request. It adds them to the overview as
   `matching_request`, with their ids, so a change like "move buy groceries to Thursday" usually
   needs no search round trip. This keeps weaker tool users such as Matilda steady.
   - **Read tools:** `get_overview` (with a suggested order and the tasks that have no date),
     `search_items` (words, status, type, priority, team, project, list, due-date range, or no due
     date), `get_item` (notes, checklist, recent updates), `list_teams`, `rank_tasks` (open tasks in
     the app's own priority-score order, each with why), `list_projects` and `get_project` (progress,
     risk, stages, and decisions no task delivers), `find_free_time` (free stretches in working
     hours), `get_calendar` (your events and subscribed calendars' events, with titles; subscribed
     ones read only) and `get_follow_through` (asks, promises, undelivered decisions, how plans held).
     Asking what to do first ("help me prioritise") is advice: the guard allows no proposals for it
     unless the message also names a change. Every query is scoped on
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
   - An update or delete of a shown item must be of an item the request names, meaning its title
     shares words with the request, unless the user asked for all, both or every one. Matilda
     once moved the gym session when asked to move the groceries, and proposed deleting the
     groceries along with "the gym session".
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

### Planning

Everything planning needs lives on this server; nothing syncs with Google, Microsoft or iCloud.
Other tools read Orbyn through the calendar feed, API keys and webhooks instead, and Orbyn reads
other calendars only through their ICS links.

- **Time zones and repeats** (`packages/core/src/time.ts`): wall-clock conversion that survives
  daylight-saving changes, and a subset of RFC 5545 RRULE (daily, weekly on chosen days, monthly
  on month days or weekdays with set positions such as "the last weekday", yearly; interval;
  count or until). A repeating item keeps `series_start` and its own time zone;
  `due_at` is the current occurrence. The notifier moves ended event occurrences on (bumping the
  reminder version, so every occurrence gets its reminder). Completing a repeating task moves it
  to its next occurrence.
- **The calendar** (`modules/planner/calendar.ts`): expands occurrences for a range, adds the
  person's time blocks, and works out buffers and travel from their settings and places on the
  fly, so they never go stale. `busyIntervals()` merges events, buffers, travel and blocks into
  plain intervals; the planner, team time and booking pages all use it, and nothing but intervals
  leaves it. Team time and booking pages also ask it to count busy frames; the planner never does.
- **Frames** (`modules/planner/frames.ts`): recurring windows for a kind of work. They repeat on
  weekdays or by a rule (which counts from `series_start`), skip dates (`exdates`), keep their own
  time zone if they have one, and can be marked busy. `frameSpans()` expands them for the
  planner's windows, busy time and the calendar view.
- **The planner** (`modules/planner/scheduler.ts`): a pure, deterministic function. Free time is
  frames (or working hours) minus busy time and keep-free times. Tasks go in order of the priority
  score (`3 × priority + 4 × urgency + 2 if overdue + 1 × size_fit`, where `size_fit` is 1 when
  the remaining estimate fits the first planned day's largest free slot, 0.5 when it doesn't and
  0.75 without an estimate; blocked tasks last), padded, split into sessions with breaks, into the
  earliest slot that ends before the due time. Tasks that don't fit are listed with a reason, and
  ones that can't make their due time are flagged at risk. Task lists show and sort by the same
  score (`GET /items?sort=score`), comparing with today's largest free slot. Previews are stored
  as `plans` for an hour, with everything they were made from, and applied in one transaction
  that skips any block that has started to clash. The assistant uses the same engine through its
  `plan_schedule` tool (Matilda's graph plans directly), so it never places times itself.
- **Tuning a plan** (`modules/planner/plans.ts`): `PATCH /planner/plans/:id` makes the plan again
  from its stored inputs with tasks added or left out, estimates changed (optionally saved through
  `mutate()`), keep-free times, a scope, and pinned blocks, which the engine keeps in place and
  plans around. The result is a new plan; the old one expires and points at it. Each plan keeps a
  fingerprint of its busy time, frames, hours and tasks, so `GET /planner/plans/:id/stale` can
  tell the apps to make it again when something changed. Every plan lists each task considered,
  whether it's in, and why it wasn't (fully) planned.
- **Conflicts and review**: once a minute the notifier looks for events that now overlap a
  future block and sends one notice per block, with a one-tap reschedule to the next free
  working time. The review lists unfinished past blocks (to roll forward into a new plan), tasks
  whose remaining estimate exceeds the free time before they're due, and current conflicts.
- **Planner notices** (`worker/planning.ts`, every 15 minutes): for people with planner activity
  (saved settings or recent blocks, plus recent blocks or tasks due within two weeks),
  `scanPlanningNotices()` sends a roll-forward notice from their working start on a working day
  when earlier blocks are unfinished, an at-risk notice for each task whose remaining estimate is
  more than the free time before it's due, and a due-soon notice for tasks due within
  `deadline_notice_days` that have no time set aside for what's left. Each is idempotent through
  the outbox's unique keys, and delivered like conflicts.
- **Blocks**: besides moving and rescheduling, a block can be duplicated at a chosen time or into
  the next free working time after it, for another session on the same task.
- **Subtasks and order** (`modules/items/service.ts`): a subtask is a task with a `parent_id`
  in the same space as its parent, three levels at most and without loops (`checkParent()`, on
  every write through `mutate()`). Deleting a task deletes its subtasks. The planner, at-risk and
  due-soon notices and team workload all count a task's own work with `remainingOf()`
  (`scheduler.ts`): while it has open subtasks, only what its estimate has beyond theirs, so the
  work counted is the larger of the two and never both. Manual order (`position`) is kept per
  place (the parent, else the list, else the space); `moveItem()` renumbers a place under an
  advisory lock and, like checklist steps, leaves `version` alone.
- **Closed tasks**: `done` and `cancelled` both close a task (`isClosed()` in `@orbyn/core`):
  the planner, busy time, reminders, notices, scores and counts treat them alike. Only completing
  counts progress, fires `item.completed`, moves a repeating task on and, with
  `count_blocks_as_spent`, adds its blocks' past time to `spent_minutes` (each block once, marked
  `counted`).
- **Buffers and travel**: `derivedBlocks()` gives buffers only to events in the person's
  `buffer_scope` (personal, teams, lists, a minimum length, meetings with others: invitees, a
  meeting link or a team), and times each travel leg with the place's `peak_minutes` when it
  touches weekday peak hours (07:00–09:00, 16:00–18:00 local), plus `travel_padding_minutes`.
  A place's `mode` is only a label; there's no routing service.
- **Team time**: availability returns busy intervals only; workload compares each member's free
  working time with the estimates of this team's open tasks assigned to them, and lists the tasks
  at risk (those due soonest take the free time first); meeting suggestions intersect everyone's
  free time and rank slots that would split someone's focus time last.
- **Booking pages**: free slots (`booking/availability.ts`) intersect the page's hours (custom
  weekly hours or each host's working hours, with date overrides) with every required host's free
  time, minus held bookings, keeping the page's buffers, notice, interval and daily and weekly
  limits. Bookings take an advisory lock per page, so two people can't book the same time. With
  SMTP set up a booking waits for its email link; pages that need approval hold the time until a
  host decides. `booking/service.ts` owns every step (confirm, approve, decline, cancel,
  reschedule): each lands on `booking_events`, the confirmed booking becomes an event on each
  host's calendar through `mutate()`, and moves update those events in place. Bookers manage a
  booking through one link whose token is kept encrypted, so every email repeats it.
- **Open invites, team pages and profiles** (`booking/invites.ts`, `pages.ts`, `profile.ts`): an
  open invite stands in for a page (`inviteAsPage()`) whose hours are its windows, so the same
  booking steps, manage link, timeline, webhooks and inbox serve it; `availableSlots()` gives an
  invite the windows minus every host's busy time, on the quarter hour. Picking a time books it
  in the same transaction under the invite's advisory lock; a booker cancelling reopens it, and
  the notifier marks it expired at `expires_at`. A page with a `team_id` is managed by the team's
  owners and admins and hosted by its members. `/u/<handle>` lists the active pages someone owns
  or hosts. Public booking, invite, profile and RSVP responses carry `X-Robots-Tag: noindex`, and
  only those web pages may be framed (the web container's nginx).
- **API keys and webhooks**: keys (`ok_…`) are stored hashed and act as their owner, except in
  the admin console. Webhook events are queued in the same transaction as the change (so a
  rolled-back change sends nothing) and delivered by the notifier's lanes with an HMAC-SHA256
  signature and backoff. Webhook URLs must resolve to public addresses, checked on save and before
  every delivery (`lib/netguard.ts`), so users can't make the server call its own network.
  `event.starting` and `block.started` are found by the notifier every minute
  (`worker/webhookEvents.ts`) and `task.at_risk` comes with the at-risk notice; a delivery's
  `dedupe_key` (unique per webhook) keeps each to once per occurrence, block start or task and
  day. Rate limits count API-key requests per key (its id, looked up once a minute) and others per
  address, with `RateLimit-*` headers. `GET /openapi.yaml` serves `docs/openapi.yaml`.
- **Incremental sync**: `GET /items?updated_after=` reads items by `(updated_at, id)` from a
  cursor holding the exact microsecond, merged with `deleted_items`, the tombstones `mutate()` (and
  booking cancellations) write before deleting, with the audience at the time. Changes that
  don't touch the version (steps, time logged, order, a subtask's status on its parent) still move
  `updated_at`, so sync sees them.
- **Events**: all-day items store local midnights in their zone (their end is the midnight after
  the last day, counted in days so daylight saving can't move it) and are never busy; events
  marked free aren't either, and neither gets buffers or travel. `busyIntervals()` is where both
  rules live, so the planner, team time, booking pages and the busy feed agree.
- **One occurrence or the rest** (`modules/items/occurrences.ts`): changing one occurrence of a
  series writes an `item_overrides` row (only what differs from the series); removing one adds an
  exdate, as `skip` always did. `expandSeries()` in `calendar.ts` applies both, including
  occurrences moved into or out of a range, so every reader (calendar, busy time, conflicts,
  search, the feed) sees the same thing; the notifier joins the current occurrence's row.
  "This and following" ends the series with an `UNTIL` just before the occurrence and creates the
  rest through `mutate()`. An edit to the whole series drops changes to occurrences that no
  longer exist.
- **Invitations** (`modules/items/attendees.ts`): `mutate()` keeps an event's invitees and, in
  the same transaction, queues iCalendar emails (`REQUEST` or `CANCEL`) as `invite` rows in the
  notifications outbox, so a rolled-back edit sends nothing and a mail outage never fails one; the
  email lane sends the calendar part with nodemailer's `icalEvent` and drops invitations for
  people since taken off. Each invitee's RSVP token is hashed for lookups and kept encrypted so
  every email repeats the same link. Nothing is queued without SMTP.
- **Calendar feed**: a private, rotatable iCalendar link (`/calendar/feed/<token>.ics`, only the
  token's hash is stored) with repeating items as RRULEs in their own time zone, changed
  occurrences as `RECURRENCE-ID` events, all-day dates, free time, alerts and invitees, and
  optionally time blocks. A second link shows only busy intervals, taken from `busyIntervals()`.
- **Subscriptions** (`modules/planner/subscriptions.ts`, `icsParse.ts`): calendars read by ICS
  link. The notifier claims due subscriptions (new ones, then hourly) and fetches them with the
  same public-address guard as webhooks, re-checked on every redirect, with time and size limits
  and conditional requests. A small parser reads events, zones, repeats in Orbyn's subset,
  exdates and changed occurrences; the events replace the old ones in one transaction, and a
  failure keeps them. They're expanded on read like items, and reach `busyIntervals()` only when
  the subscription counts as busy.
- **Search and overlays**: `GET /calendar/search` expands only the items whose words match, so
  each occurrence is found with its own changes; `GET /availability` gives the busy intervals of
  people who share a team with you, for drawing over your own calendar.

## Desktop / web (`desktop/`)

A single-page React app built with Vite. `src/features/<view>/` holds one folder per view
(overview, tasks, calendar, assistant, notifications, settings, auth), `src/components/` the
shared UI (item row, editor modal, proposal review, sidebar, topbar), `src/hooks/usePlanner.ts` the
data layer (session, polling every 30 seconds while visible, optimistic-lock aware mutations), and
`src/lib/api.ts` the configured `OrbynClient`. Session tokens live in `localStorage`, so a sign-in survives closing the tab and is shared by every tab; signing out in one tab signs them all out. A session expires after 30 days without use (each request slides it forward).

The same bundle runs three ways:

- **Dev**: Vite on port 5173 proxying `/api` to the backend.
- **Docker**: nginx serves the static build and proxies `/api/` to the `api` service with a
  per-client rate limit and security headers.
- **Electron**: `electron.cjs` loads `dist/index.html` from disk in a sandboxed window with no
  Node integration. Since the origin is `file://`, the app calls `http://localhost:8008` unless
  `VITE_API_URL` was baked in at build time. It also adds a system-tray
  icon: closing the window hides Orbyn to the tray (Dock on macOS) instead of quitting, the tray
  menu opens the window or quits, and a left-click on the icon toggles the window.

## Mobile (`mobile/`)

An Expo app with tabs for Today, Tasks, Calendar, Assistant, Inbox, and Settings, organised as
`src/screens/`, `src/components/`, `src/hooks/`, `src/lib/` (API client, session, push), and
`src/theme/`. The session token is stored with `expo-secure-store`. On login the app requests
notification permission, obtains an Expo push token, and registers it with `POST /devices`. On
logout it deletes the device registration so reminders stop. Push notifications include the item id
so tapping one can open the right task.

The app is offline-first for reading: after every successful load it saves a snapshot of the
planner data (items, profile, notifications, teams, lists, tags) to the device with
`@react-native-async-storage/async-storage`. On a cold start with a restored session it shows that
snapshot immediately, so the app is usable before — or without — a network round-trip; the next
successful refresh replaces it, and a failed refresh leaves the cached data in place. The
snapshot's versioning, staleness (14 days) and shape checks live in `@orbyn/core` (`offline.ts`)
and are unit-tested. Making changes while offline still needs a connection; an offline write queue
is a planned follow-up.

Quick capture works through a deep link: opening `orbyn://add?text=…` (the app's URL scheme)
creates a task from the text via `POST /items/quick` and refreshes. Because the iOS/Android
Shortcuts app can open a URL — and Siri can run a Shortcut — people can say "add to Orbyn" and
capture a task hands-free with no native extension. The link parser (`parseAddDeepLink` in
`@orbyn/core`) is unit-tested; the handler lives in `usePlanner`.

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

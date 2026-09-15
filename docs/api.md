# API reference

Base URL: `http://localhost:8008` in Docker, `http://localhost:8000` when running locally. Through
the web container it is also reachable at `http://localhost:8080/api`.

All request and response bodies are JSON. Authenticated routes need
`Authorization: Bearer <token>`. Errors have the shape `{ "message": "..." }`.

| Status | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| 401    | Missing, expired, or revoked session                                |
| 403    | Signed in but not allowed: wrong role, or the account is disabled   |
| 404    | Not found, including records that belong to another user            |
| 409    | Version conflict, duplicate record, or expired proposal             |
| 422    | Validation error; `message` lists the failing rules                 |
| 429    | Rate limited (180 req/min per IP; 10 req/min on auth and AI routes) |
| 502    | AI provider returned an error or invalid plan                       |
| 503    | AI is not configured on the server                                  |

## Health

- `GET /live`: liveness. Answers `{"status":"ok","service":"api"}` without touching the database.
  Use it for restart decisions.
- `GET /health`: readiness. Checks the database; answers `503` when this instance cannot serve.
  Through the gateway, `GET /health` is answered by the gateway itself.

## Caching and consistency

- **Conditional GETs.** Successful `GET` responses carry a weak `ETag`. Send it back as
  `If-None-Match`; when nothing changed the API answers `304 Not Modified` with no body.
  `@orbyn/api-client` does this automatically.
- **Read-your-writes.** With a read replica configured, lists and details may lag the primary by
  a moment. Send `X-Orbyn-Consistency: primary` to read from the primary; the shared client does
  so for 5 seconds after each of its own writes.

## Auth

### `POST /auth/register`

```json
{
  "email": "you@example.com",
  "password": "at least 10 characters",
  "name": "My space"
}
```

→ `201 { "token": "...", "user": { "id", "email", "name", "email_reminders" } }`

### `POST /auth/login`

Same body shape (`name` is ignored). → `200` with the same response as register.

### `POST /auth/logout` (auth)

Revokes the current session. → `204`

## Profile

### `GET /me` (auth)

→ `{ "id", "email", "name", "email_reminders", "role" }`. `role` is `admin` or `member`.

### `PUT /me` (auth)

```json
{ "email_reminders": false }
```

## Items

An item:

```json
{
  "id": "uuid",
  "title": "Ship v1",
  "notes": "",
  "kind": "task",
  "status": "todo",
  "priority": "medium",
  "due_at": "2026-09-20T09:00:00+10:00",
  "end_at": null,
  "reminder_minutes": 30,
  "version": 1,
  "created_at": "...",
  "updated_at": "..."
}
```

`team_id` is null for a personal item or the id of a team the item is shared with. List responses
also include `team_name` and `user_id` (the creator).

Planning fields, all optional:

| Field              | Meaning                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `estimate_minutes` | How long the task takes (1 to 10080); the planner uses it.                                            |
| `spent_minutes`    | Read-only: minutes logged with the focus timer (`POST /items/:id/time`).                              |
| `list_id`          | A list from `GET /lists`: your own for personal items, the team's for team ones.                      |
| `tag_ids`          | Up to 20 tags, with the same rule as lists.                                                           |
| `assignee_id`      | Who on the team is doing a team task. Responses also carry `assignee_name`.                           |
| `location`         | Where an event happens; drives travel time.                                                           |
| `meeting_url`      | A video-call link (`https://…`); the apps show Join from 5 minutes before.                            |
| `rrule`            | How it repeats: `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`, `INTERVAL`, `BYDAY` (weekly), `COUNT` or `UNTIL`. |
| `timezone`         | The IANA zone a repeating item keeps its wall-clock time in.                                          |

Rules: `kind` is `task` or `event`; events require `due_at`; `end_at` requires `due_at` and must be
later; timestamps are ISO 8601 with an offset; `reminder_minutes` is 0 to 10080 (one week); a
repeating item needs `due_at`; only team items can have an assignee, who must be in the team.

A repeating item's `due_at` is its current occurrence and `series_start` its first. Completing a
repeating task moves it to the next occurrence (its checklist resets and the timeline notes the
completed one) instead of closing it. Completing any task removes its future time blocks.

### `GET /items?limit=200&offset=0&team_id=` (auth)

Newest first. `limit` max 500. Returns your personal items plus items of every team you belong to.
Pass `team_id` to list only one team's items (requires membership). Other filters: `q` (words in
the title or notes), `list_id`, `tag_id` and `assignee_id`.

### `POST /items/:id/time` (auth)

`{ "minutes": 25 }` adds focus time to `spent_minutes`. It doesn't change the item's `version`. →
the item detail.

### `POST /items/:id/skip` (auth)

`{ "occurrence": "2026-09-22T07:00:00+10:00" }` removes one occurrence from a repeating item. →
the item detail; `409` for an item that doesn't repeat.

### `POST /items` (auth)

Body: item fields without `id`, `version`, timestamps. Only `title` is required. → `201` item.

### `PUT /items/:id` (auth)

Body: **all** item fields plus the current `version`. → `200` item with `version + 1`, or `409` if
the version is stale. Planning fields you leave out keep their saved values.

### `DELETE /items/:id?version=N` (auth)

→ `204`, or `409` if stale.

## Teams

Team roles: `owner`, `admin`, `member`, `viewer`. See [architecture](architecture.md#access-control)
for what each can do. Non-members get `404` for a team and its items.

| Method and path                     | Who                           | Body / result                                              |
| ----------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `GET /teams`                        | any user                      | Your teams with your `role`, `member_count`, `item_count`  |
| `POST /teams`                       | any user                      | `{ "name" }` → `201` team; you become its owner            |
| `GET /teams/:id`                    | members, system admins        | Team plus `members[]` (`user_id`, `name`, `email`, `role`) |
| `PUT /teams/:id`                    | team owner/admin              | `{ "name" }`                                               |
| `DELETE /teams/:id`                 | team owner                    | `204`; deletes the team's items                            |
| `POST /teams/:id/members`           | team owner/admin              | `{ "email", "role" }` → `201` member                       |
| `PUT /teams/:id/members/:userId`    | team owner/admin              | `{ "role" }`                                               |
| `DELETE /teams/:id/members/:userId` | team owner/admin, or yourself | `204`; removing yourself leaves the team                   |

Team admins can only add, change, or remove members and viewers, and cannot grant admin or owner.
A team must always keep an owner (`409`). System admins can manage any team as an owner would.

## Admin console

All routes require a system admin (`403` otherwise). Admins see accounts, teams, membership, and
counts, but never the contents of personal or team items.

| Method and path           | Body / result                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `GET /admin/overview`     | Counts of users, admins, disabled users, teams, items, open items, reminders       |
| `GET /admin/users`        | `?search=&limit=&offset=` → `{ rows: AdminUser[], total }`                         |
| `PUT /admin/users/:id`    | `{ "role"?: "admin" \| "member", "disabled"?: boolean }`; disabling signs them out |
| `DELETE /admin/users/:id` | `204`; their sole-owned teams pass to the next most senior member                  |
| `GET /admin/teams`        | Every team with counts                                                             |
| `GET /admin/audit`        | `?limit=&offset=` → `{ rows: AuditEntry[], total }`, newest first                  |

The last active admin cannot be demoted, disabled, or deleted (`409`), and admins cannot delete
their own account here.

### Task progress

`status` is `todo`, `in_progress`, `blocked`, or `done`, and `progress` is 0 to 100. List
responses also include `steps_total`, `steps_done`, `updates_count`, and `last_update_at`.

| Method and path                   | Body / result                                                                |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `GET /items/:id`                  | The item with `steps[]` and its 100 most recent `updates[]`, newest first    |
| `POST /items/:id/steps`           | `{ "title" }` adds a checklist step; returns the item detail                 |
| `PUT /items/:id/steps/:stepId`    | `{ "title"?, "done"? }`; returns the item detail                             |
| `DELETE /items/:id/steps/:stepId` | Removes a step; returns the item detail                                      |
| `POST /items/:id/updates`         | `{ "body"?, "status"?, "progress"? }` posts a timeline entry; returns detail |

When a task has steps, its progress is the share of steps done, and ticking the first step moves a
`todo` task to `in_progress`. Manual progress is refused (`409`) while a checklist exists. Marking a
task done sets progress to 100; reopening it re-arms its reminder. Steps and updates do not change
the item's `version`, so an open editor never conflicts because of them, and `PUT /items/:id`
without `progress` keeps the saved value. Viewers can read steps and updates but not change them.

## Devices (mobile push)

### `POST /devices` (auth)

```json
{ "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

→ `204`. Returns `409` if the token is already registered to a different account.

### `DELETE /devices` (auth)

Same body. → `204`

## Notifications

### `GET /notifications` (auth)

Up to 100 most recent in-app reminders: `{ "id", "title", "body", "read", "created_at" }[]`.

### `POST /notifications/:id/read` (auth)

→ `204`

## AI assistant

### `POST /ai/chat` (auth, 10/min)

```json
{
  "message": "Move everything due Friday to next Monday",
  "timezone": "Australia/Melbourne"
}
```

→

```json
{
  "id": "proposal uuid",
  "summary": "I will move 3 tasks to Monday 21 Sep.",
  "actions": [
    {
      "operation": "update",
      "item_id": "uuid",
      "version": 2,
      "data": {
        "title": "...",
        "notes": "",
        "kind": "task",
        "status": "todo",
        "priority": "medium",
        "due_at": "...",
        "end_at": null,
        "reminder_minutes": 30
      }
    },
    { "operation": "create", "data": { "title": "..." } },
    { "operation": "delete", "item_id": "uuid", "version": 1 }
  ],
  "follow_ups": []
}
```

Nothing is saved by this call.

- **Answers:** pure summaries return an empty `actions` array.
- **Lookups:** the assistant looks things up with tools that only see the caller's own and team
  items.
- **Several changes:** one message can hold up to 20 changes.
- **Clarifying questions:** when the request is ambiguous, `summary` is a question and
  `follow_ups` holds up to 4 suggested replies to send back as the next `message`.

An optional `history` (up to 12 earlier `{ "role": "user" | "assistant", "content" }` turns) gives
the conversation context. Returns `502` when the provider fails twice or returns an invalid plan,
and `503` when no provider is set up.

When the message asks to plan time ("plan my day"), the reply also carries `plan`: the same object
as `POST /planner/preview`, ready for `POST /planner/plans/:id/apply`. The planner places every
block; the assistant only chooses the days and times to keep free.

### `POST /ai/proposals/:id/apply` (auth)

Applies every action in one transaction. → `{ "applied": true }`. Idempotent. Returns `409` if the
proposal expired (15 minutes) or an item version is stale, and `404` if any action targets an item
the user does not own, in which case nothing is applied.

## Lists and tags

Personal lists and tags belong to you; team ones follow team roles (viewers read, members and
above change them). Deleting a list or tag keeps its items.

| Method and path                     | Body / result                                                        |
| ----------------------------------- | -------------------------------------------------------------------- |
| `GET /lists`                        | Your lists and your teams' lists, with `team_name`, `item_count`     |
| `POST /lists`                       | `{ "name", "color"?, "team_id"? }` → `201` list                      |
| `PUT /lists/:id`                    | `{ "name"?, "color"?, "position"? }`                                 |
| `DELETE /lists/:id`                 | `204`                                                                |
| `GET /tags`                         | Your tags and your teams' tags                                       |
| `POST /tags`                        | `{ "name", "color"?, "team_id"? }` → `201`; `409` if the name exists |
| `PUT /tags/:id`, `DELETE /tags/:id` | Rename or recolor; delete                                            |

## Calendar and time blocks

### `GET /calendar?from=&to=` (auth)

At most 62 days. → `{ from, to, timezone, entries, blocks, derived }`:

- `entries`: one per occurrence of every dated item you can see. Repeating items appear once per
  occurrence with `occurrence` set.
- `blocks`: your time blocks, with their task's title and status.
- `derived`: buffers and travel time around events, worked out from your planner settings and
  places (never stored, so they always follow the events).

### Time blocks

Time you set aside to work on a task. Each person has their own.

| Method and path               | Body / result                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `GET /blocks?from=&to=`       | Your blocks in the range                                                            |
| `POST /blocks`                | `{ "item_id", "start_at", "end_at" }` (a task you can see; at most 24 hours)        |
| `PUT /blocks/:id`             | `{ "start_at", "end_at" }`                                                          |
| `DELETE /blocks/:id`          | `204`                                                                               |
| `POST /blocks/:id/reschedule` | Moves it to your next free working time of the same length; `409` if none in 7 days |

## Planner

| Method and path                                              | Body / result                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /planner/prefs`, `PUT /planner/prefs`                   | Time zone, working days and hours, padding, splitting, breaks, buffers, travel, extra time zones, calendar sets, pinned people |
| `GET/POST /planner/frames`, `PUT/DELETE /planner/frames/:id` | Recurring windows for kinds of work, with task filters                                                                         |
| `GET/POST /planner/places`, `PUT/DELETE /planner/places/:id` | Places (`label`, `match` text in a location, `travel_minutes`)                                                                 |
| `POST /planner/preview`                                      | A plan (below). Nothing is saved.                                                                                              |
| `GET /planner/plans/:id`                                     | A plan you made in the last hour                                                                                               |
| `POST /planner/plans/:id/apply`                              | Saves its blocks → `{ blocks, skipped }` (blocks that now clash are skipped); `409` if already applied or expired              |
| `GET /planner/review`                                        | `{ unfinished, at_risk, conflicts }`                                                                                           |
| `POST /planner/roll-forward`                                 | `{ "block_ids"? }` → a plan for unfinished work                                                                                |

`POST /planner/preview` body, all optional: `start_date` (`YYYY-MM-DD`, today when omitted),
`days` (1 to 7), `pad_percent`, `split`, `break_level`, `use_frames` (default true), `keep_free`
(`[{ "start_at", "end_at" }]`), `item_ids` (only these tasks), `exclude_item_ids`, and `timezone`
(the device's, used until you save one). A plan:

```json
{
  "id": "uuid",
  "starts_on": "2026-09-16",
  "days": 1,
  "blocks": [
    {
      "item_id": "uuid",
      "title": "Quarterly report",
      "start_at": "2026-09-16T00:00:00.000Z",
      "end_at": "2026-09-16T01:00:00.000Z",
      "frame_id": null,
      "frame_name": null,
      "part": 1,
      "parts": 2,
      "score": 13.4
    }
  ],
  "unplaced": [],
  "at_risk": [],
  "capacity_minutes": 420,
  "planned_minutes": 150,
  "applied": false,
  "expires_at": "…",
  "summary": "2 tasks in 3 blocks over 1 day, using 2 h 30 min of 7 h free."
}
```

The planner considers your open personal tasks and team tasks assigned to you (or exactly the
`item_ids` you name). Tasks without an estimate count as 30 minutes.

## Team time

Teammates see each other's busy intervals only, never what the time is for.

| Method and path                                        | Result                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /teams/:id/availability?from=&to=`                | Each member's working hours and busy intervals                                                         |
| `GET /teams/:id/workload?from=&to=`                    | Capacity, assigned estimates, load, `overloaded`, `at_risk` per member                                 |
| `GET /teams/:id/suggest?from=&to=&duration=&user_ids=` | Up to 20 times everyone chosen is free; `disruption` counts people whose focus time a slot would split |

## Booking pages

| Method and path                                       | Who            | Body / result                                                                                                      |
| ----------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /booking-pages`                                  | signed in      | Pages you own or host, each with `counts` (`upcoming`, `needs_approval`)                                           |
| `POST /booking-pages`                                 | signed in      | The page (see below) and `co_hosts` (from your teams) → `201`; `409` if the slug is taken                          |
| `PUT/DELETE /booking-pages/:id`                       | owner          | Change any of the same fields, or delete                                                                           |
| `GET /bookings?view=&page_id=&q=&limit=&offset=`      | owner, hosts   | Bookings across your pages → `{ rows, total }`; `view` is `upcoming`, `needs_approval`, `past`, `cancelled`, `all` |
| `GET /bookings/stats?page_id=`                        | owner, hosts   | Counts, cancellation rate, the next booking and per-page totals                                                    |
| `GET /bookings/export.csv?view=&page_id=&q=`          | owner, hosts   | The same bookings as CSV (up to 5,000)                                                                             |
| `GET /bookings/:id`                                   | owner, hosts   | One booking with its answers, the page's questions and its timeline                                                |
| `POST /bookings/:id/approve` · `/decline`             | owner, hosts   | Decide on a request; decline takes `{ reason? }` and emails the booker                                             |
| `POST /bookings/:id/cancel`                           | owner, hosts   | `{ reason? }`: removes the events and emails the booker                                                            |
| `POST /bookings/:id/reschedule`                       | owner, hosts   | `{ start_at }`: moves the booking and its events; `409` if the time isn't free                                     |
| `PUT /bookings/:id/no-show` · `/note`                 | owner, hosts   | `{ no_show }` once a confirmed booking has started; `{ host_note }` (private to hosts)                             |
| `GET /booking-pages/:id/bookings`                     | owner, hosts   | Older apps: one page's upcoming and recent bookings                                                                |
| `POST /booking-pages/:id/bookings/:bookingId/cancel`  | owner, hosts   | Older apps: cancel one                                                                                             |
| `GET /book/:slug?duration=&date=&days=&timezone=`     | anyone         | Title, hosts, colour, questions and free `slots`                                                                   |
| `POST /book/:slug`                                    | anyone, 10/min | `{ start_at, duration, name, email, note?, timezone?, answers? }` → `201` receipt; `409` if the time was taken     |
| `POST /book/confirm/:token`                           | anyone         | The link from the confirmation email                                                                               |
| `GET /book/manage/:token`                             | anyone         | The booker's own booking, from the link in every email                                                             |
| `GET /book/manage/:token/slots?date=&days=&timezone=` | anyone         | Free times to move it to                                                                                           |
| `POST /book/manage/:token/reschedule` · `/cancel`     | anyone, 10/min | `{ start_at }` to move (if the page allows it), `{ reason? }` to cancel                                            |
| `POST /book/cancel/:token`                            | anyone         | The cancel link from older booking emails                                                                          |

A page sets its `durations`, `window_days`, `min_notice_minutes`, `buffer_before_minutes`,
`buffer_after_minutes`, `slot_interval_minutes` (5–60), `max_per_day` and `max_per_week`; its
hours (`availability`: the hosts' working hours, or `{ mode: "custom", timezone, weekly }`) and
`date_overrides` (`{ date, hours }`, where no hours closes the day); up to ten `questions` (`text`,
`long_text`, `choice`, `phone`, each optionally required); `requires_approval`,
`allow_reschedule`, `color`, `event_title` (with `{page}`, `{name}`, `{email}`) and
`confirmation_message`.

Free slots are the page's hours that every required host has free (events, buffers, travel and
time blocks count as busy), minus bookings still held, keeping the page's buffers either side, its
notice and its limits. Start times step by the interval from local midnight. With SMTP set up a
booking waits for its email link (the time is held for 30 minutes); without it, it goes straight
on. Pages that need approval then hold the time until a host approves or declines, or until it
starts. A confirmed booking adds an event to every host's calendar; every step lands on the
booking's timeline, and hosts get in-app notices (`kind: "booking"`, `ref` = the booking) for new,
requested, moved and cancelled bookings.

## API keys, webhooks and the calendar feed

Other tools reach Orbyn through these; nothing is synced out of this server.

| Method and path                 | Body / result                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /me/api-keys`              | Your keys (name, prefix, last used)                                                   |
| `POST /me/api-keys`             | `{ "name" }` → `201` with `key` (shown once; send it as `Authorization: Bearer ok_…`) |
| `DELETE /me/api-keys/:id`       | `204`                                                                                 |
| `GET /me/webhooks`              | Your webhooks with their last delivery status                                         |
| `POST /me/webhooks`             | `{ "url", "events" }` → `201` with `secret` (shown once)                              |
| `PUT /me/webhooks/:id`          | `{ "url"?, "events"?, "active"? }`                                                    |
| `DELETE /me/webhooks/:id`       | `204`                                                                                 |
| `POST /me/webhooks/:id/test`    | Sends a `ping` now → `{ ok, status, error }`                                          |
| `POST /me/calendar-feed`        | Creates or replaces your private feed link → `{ url }`                                |
| `DELETE /me/calendar-feed`      | Turns the feed off                                                                    |
| `GET /calendar/feed/:token.ics` | The feed, as iCalendar, for other calendar apps to subscribe to                       |

API keys act as you, except in the admin console. Webhook events: `item.created`,
`item.updated`, `item.completed`, `item.deleted`, `block.scheduled`, `booking.requested`,
`booking.confirmed`, `booking.rescheduled` and `booking.cancelled`.
Each delivery is a JSON `POST` of `{ event, occurred_at, data }` with `X-Orbyn-Event`,
`X-Orbyn-Delivery`, `X-Orbyn-Timestamp` and `X-Orbyn-Signature: sha256=<hex>`, where the hex is
HMAC-SHA256 of `"<timestamp>.<body>"` with your webhook secret. Failed deliveries are retried
with backoff for up to 8 attempts. Webhooks must reach a public address.

## Example session

```bash
API=http://localhost:8008
TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"a-long-password","name":"Me"}' | jq -r .token)

curl -s -X POST $API/items -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Pay rent","due_at":"2026-10-01T09:00:00+10:00","reminder_minutes":1440}'

curl -s $API/items -H "Authorization: Bearer $TOKEN"
```

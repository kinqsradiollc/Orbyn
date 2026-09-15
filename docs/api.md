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
  "alerts": [30],
  "all_day": false,
  "busy": true,
  "color": null,
  "version": 1,
  "created_at": "...",
  "updated_at": "..."
}
```

`team_id` is null for a personal item or the id of a team the item is shared with. List responses
also include `team_name` and `user_id` (the creator).

Planning fields, all optional:

| Field              | Meaning                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `estimate_minutes` | How long the task takes (1 to 10080); the planner uses it.                                                                                                                                 |
| `spent_minutes`    | Read-only: minutes logged with the focus timer (`POST /items/:id/time`).                                                                                                                   |
| `list_id`          | A list from `GET /lists`: your own for personal items, the team's for team ones.                                                                                                           |
| `tag_ids`          | Up to 20 tags, with the same rule as lists.                                                                                                                                                |
| `assignee_id`      | Who on the team is doing a team task. Responses also carry `assignee_name`.                                                                                                                |
| `location`         | Where an event happens; drives travel time.                                                                                                                                                |
| `meeting_url`      | A video-call link (`https://…`); the apps show Join from 5 minutes before.                                                                                                                 |
| `rrule`            | How it repeats: `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`, `INTERVAL`, `BYDAY` (weekly, monthly), `BYMONTHDAY` (monthly, yearly; `-1` is the last day), `BYSETPOS` (monthly), `COUNT` or `UNTIL`. |
| `timezone`         | The IANA zone a repeating or all-day item keeps its wall-clock time in.                                                                                                                    |
| `all_day`          | A whole-day item: `due_at` is midnight in its `timezone` (your planner zone when not given) and `end_at` the midnight after its last day (one day for an event when omitted). Never busy.  |
| `busy`             | Whether an event counts as busy (default true). Free events don't block the planner, booking pages or teammates, and get no buffers or travel.                                             |
| `color`            | `#rrggbb` for the calendar, or null.                                                                                                                                                       |
| `alerts`           | Minutes before `due_at` to remind: up to 5, each 0 to 40320 (four weeks), sorted and without repeats.                                                                                      |
| `attendees`        | Events only: up to 50 `{ "email", "name"? }` to invite by email (see [Invitations](#invitations)). Sending the list replaces it.                                                           |

Rules: `kind` is `task` or `event`; events require `due_at`; `end_at` requires `due_at` and must be
later; timestamps are ISO 8601 with an offset; a repeating item needs `due_at`; only team items can
have an assignee, who must be in the team.

Alerts: a new item given no `alerts` gets your `default_alerts` (30 minutes before, until you change
them). `reminder_minutes` (0 to 10080) is kept for older apps: sent without `alerts` it sets the
alert on a new item and, on an edit, replaces the smallest alert when it changed. Responses carry
it as the smallest alert, or null when there are none.

A repeating item's `due_at` is its current occurrence and `series_start` its first. Completing a
repeating task moves it to the next occurrence (its checklist resets and the timeline notes the
completed one) instead of closing it. Completing any task removes its future time blocks.

### `GET /items?limit=200&offset=0&team_id=&sort=` (auth)

Newest first. `limit` max 500. Returns your personal items plus items of every team you belong to.
Pass `team_id` to list only one team's items (requires membership). Other filters: `q` (words in
the title or notes), `list_id`, `tag_id` and `assignee_id`.

`sort` is `newest` (the default), `score` (priority score, highest first; events and finished
tasks last), `due` (soonest first, undated last), `priority` (high to low), `estimate` (shortest
first, unestimated last), `title` (A to Z) or `created` (oldest first). Every item carries its
`score`, worked out on read (null for events and finished tasks):

```
score = 3 × priority (low 1, medium 2, high 3) + 4 × urgency + 2 if overdue + 1 × size_fit
        + 0.5 if in progress − 3 if blocked
```

Urgency rises from 0 a week before the due time to 1 at it. `size_fit` is 1 when the remaining
estimate (estimate − time spent) fits the largest free working slot left today (or on the next
working day once today's hours are over), 0.5 when it doesn't, and 0.75 for a task without an
estimate. The planner ranks tasks with the same score, comparing with the first planned day.

### `POST /items/:id/time` (auth)

`{ "minutes": 25 }` adds focus time to `spent_minutes`. It doesn't change the item's `version`. →
the item detail.

### `POST /items/:id/skip` (auth)

`{ "occurrence": "2026-09-22T07:00:00+10:00" }` removes one occurrence from a repeating item. →
the item detail; `409` for an item that doesn't repeat.

### Repeating items: this one, this and following, or all

`PUT /items/:id` and `DELETE /items/:id` take `?scope=this|following|all&occurrence=<start>`.
`occurrence` is the occurrence's original start (a calendar entry's `occurrence`); `all`, the
default, is the whole item as before. `422` when `occurrence` isn't one of the item's.

- **this**: the body's `title`, `notes`, `due_at` and `end_at` (the occurrence's own times),
  `location`, `meeting_url`, `busy`, `color` and `alerts` are saved for that occurrence alone.
  Other fields belong to the series and are ignored. An edit that matches the series again removes
  the change. Deleting it removes the occurrence (like `skip`). Either answers with the item, one
  version on.
- **following**: the series ends just before the occurrence and a new series starts there with
  the body's changes (fields left out, such as the list, tags, alerts and invitees, are carried
  over; a `COUNT` keeps what's left of it). Answers with the new series. Deleting ends the series
  before the occurrence. From the first occurrence (a task's current one) it's the same as `all`.

The calendar, busy time, the planner, reminders and the feed all use each occurrence's own
changes. The item detail lists them as `overrides`: `{ occurrence, ...changes }`.

### `POST /items/quick` (auth)

`{ "text": "Lunch with @anna tomorrow 1pm ;Cafe Roma", "timezone"?: "Australia/Melbourne",
"preview"?: false }` creates an item from one line, parsed without AI (`parseQuickAdd` in
`@orbyn/core`, which the apps use too), → `201 { item, chips }`. With `preview: true` nothing is
saved → `{ input, chips }`. `timezone` defaults to your planner zone. `422` when no title is left.

| Write          | Means                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `;Cafe Roma`   | Location, up to the next marker, date or time (or a closing `;`)                                                           |
| `@anna`        | Someone you share a team with (by name or email): the assignee of a team item, otherwise invited                           |
| `@a@b.com`     | Invite anyone by email                                                                                                     |
| `>Work`        | A list you can see, by name (a team's list makes it a team item)                                                           |
| `#urgent`      | Tags, by name                                                                                                              |
| `!` `!!` `!!!` | Low, medium, high priority (`!low`, `!high` work too)                                                                      |
| dates          | `today`, `tonight`, `tomorrow`, `fri`, `next friday`, `sep 20`, `20/9`, `2026-09-20`, `in 3 days`, `next week`; `.fri` too |
| times          | `3pm`, `15:30`, `at 9` (1 to 7 without am/pm are afternoon), `noon`, ranges `3-4pm`, `15:00-16:30`                         |
| `for 2h` `45m` | An event's length, or a task's estimate                                                                                    |
| `~45m`         | Always an estimate                                                                                                         |
| `all day`      | A whole-day event                                                                                                          |

A time range, a start with a length, `all day`, someone invited or the word "meeting" makes an
event; anything else is a task. A date without a time is a whole day; a time without a date is
its next one. `chips` are `{ kind, text, value }` for what was recognised (`kind` is `kind`,
`date`, `time`, `duration`, `estimate`, `all_day`, `location`, `person`, `list`, `tag` or
`priority`).

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

| Method and path                   | Body / result                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /items/:id`                  | The item with `steps[]`, its 100 most recent `updates[]` (newest first), `attendees[]` and `overrides[]` |
| `POST /items/:id/steps`           | `{ "title" }` adds a checklist step; returns the item detail                                             |
| `PUT /items/:id/steps/:stepId`    | `{ "title"?, "done"? }`; returns the item detail                                                         |
| `DELETE /items/:id/steps/:stepId` | Removes a step; returns the item detail                                                                  |
| `POST /items/:id/updates`         | `{ "body"?, "status"?, "progress"? }` posts a timeline entry; returns detail                             |

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

Up to 100 most recent in-app notices:
`{ "id", "title", "body", "read", "created_at", "kind", "item_id", "ref" }[]`.

| `kind`        | About                                                                  | `ref`               | Suggested action |
| ------------- | ---------------------------------------------------------------------- | ------------------- | ---------------- |
| `reminder`    | An item's reminder; the due time is in your planner time zone          | the alert (minutes) | Open the item    |
| `rsvp`        | Someone you invited answered (one notice per person, updated)          | the attendee        | Open the event   |
| `conflict`    | An event now overlaps a future time block                              | the block           | Reschedule       |
| `booking`     | A booking was made, requested, moved or cancelled                      | the booking         | Open the booking |
| `rollforward` | Blocks from earlier days are unfinished (from your working start)      | the local date      | Roll forward     |
| `at_risk`     | A task's remaining estimate is more than the free time before it's due | the local date      | Plan it          |
| `deadline`    | A task is due within `deadline_notice_days` with no time set aside     | the local date      | Plan it          |

Planner notices (`conflict`, `rollforward`, `at_risk`, `deadline`) come at most once a day per
task (once per block for conflicts, once per day for roll-forward). They also go to push and email
as your `planner_notices` preference says (push on and email off by default; email needs SMTP).

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
  occurrence with `occurrence` set, and `overridden: true` on one changed on its own. Each also
  has `all_day`, `busy` (false for free events, all-day items and tasks), `color`, `alerts` and
  `attendee_count`.
- `blocks`: your time blocks, with their task's title and status.
- `derived`: buffers and travel time around events, worked out from your planner settings and
  places (never stored, so they always follow the events).
- `frames`: each occurrence of your frames in the range:
  `{ frame_id, name, color, start_at, end_at, busy, date }` (`date` is the frame's local date, the
  one `skip` takes).
- `external`: each occurrence of events from calendars you subscribe to (read-only):
  `{ subscription_id, name, color, title, start_at, end_at, all_day, location, busy }`.

### `GET /calendar/search?q=&from=&to=` (auth)

Your events and dated tasks, and subscribed events, whose title, notes or location contain every
word of `q`, a year either side of today unless `from`/`to` are given (800 days at most). Each
occurrence of a repeating item is its own result, with its own changes. → `{ q, from, to, results }`,
soonest first, up to 100; each result is a calendar entry with `source: "item"` or an external
entry with `source: "external"`.

### `GET /availability?user_ids=&from=&to=` (auth)

Busy intervals of up to 10 people you share a team with (or yourself), to lay over your calendar,
31 days at most: `[{ user_id, name, timezone, busy }]`. Anyone else is left out. Like team
availability, only the times are shared, never what they're for.

### Time blocks

Time you set aside to work on a task. Each person has their own.

| Method and path               | Body / result                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /blocks?from=&to=`       | Your blocks in the range                                                                                                                                                                   |
| `POST /blocks`                | `{ "item_id", "start_at", "end_at" }` (a task you can see; at most 24 hours)                                                                                                               |
| `PUT /blocks/:id`             | `{ "start_at", "end_at" }`                                                                                                                                                                 |
| `DELETE /blocks/:id`          | `204`                                                                                                                                                                                      |
| `POST /blocks/:id/reschedule` | Moves it to your next free working time of the same length; `409` if none in 7 days                                                                                                        |
| `POST /blocks/:id/duplicate`  | `{ "start_at"? }` → `201` a new block for the same task and length, at `start_at` or the next free working time after the original; `409` if the task is done or nothing is free in 7 days |

## Planner

| Method and path                                              | Body / result                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /planner/prefs`, `PUT /planner/prefs`                   | Time zone, working days and hours, padding, splitting, breaks, buffers, travel, extra time zones, calendar sets, pinned people |
| `GET/POST /planner/frames`, `PUT/DELETE /planner/frames/:id` | Recurring windows for kinds of work, with task filters (below)                                                                 |
| `POST /planner/frames/:id/skip` · `/unskip`                  | `{ "date": "YYYY-MM-DD" }` skips one date of a frame, or brings it back → the frame                                            |
| `GET/POST /planner/places`, `PUT/DELETE /planner/places/:id` | Places (`label`, `match` text in a location, `travel_minutes`)                                                                 |
| `POST /planner/preview`                                      | A plan (below). Nothing is saved.                                                                                              |
| `GET /planner/plans/:id`                                     | A plan you made in the last hour                                                                                               |
| `PATCH /planner/plans/:id`                                   | Tune a plan (below) → a new plan that replaces it; `409` if it was applied, replaced or expired                                |
| `GET /planner/plans/:id/stale`                               | `{ "stale" }`: true when the calendar, frames, hours or tasks changed since it was made, or it expired or was replaced         |
| `POST /planner/plans/:id/apply`                              | Saves its blocks → `{ blocks, skipped }` (blocks that now clash are skipped); `409` if already applied or expired              |
| `GET /planner/review`                                        | `{ unfinished, at_risk, conflicts }`                                                                                           |
| `POST /planner/roll-forward`                                 | `{ "block_ids"? }` → a plan for unfinished work                                                                                |

Planner preferences also hold `deadline_notice_days` (0 to 14, default 1; 0 turns due-soon
notices off), `planner_notices` (`{ "push": true, "email": false }`; send either key to change
it) and `default_alerts` (`{ "event": [30], "task": [30], "all_day": [30] }`, the alerts new items
get; send any key to change it).

A frame has `name`, `start_time`, `end_time`, `filters`, `color`, and either `days` (weekdays,
0 = Sunday) or an `rrule` (which wins; for example `FREQ=MONTHLY;BYMONTHDAY=-1` for the last day
of each month, or `FREQ=WEEKLY;BYDAY=MO,TU,TH,FR` for every weekday but Wednesday). Optional:
`busy` (default false: a busy frame blocks booking pages and teammates' meeting times, but the
planner still plans inside it), `exdates` (skipped dates) and `timezone` (null: your planner
zone). Responses also carry `series_start`, the day a rule counts from.

`POST /planner/preview` body, all optional: `start_date` (`YYYY-MM-DD`, today when omitted),
`days` (1 to 7), `pad_percent`, `split`, `break_level`, `use_frames` (default true), `keep_free`
(`[{ "start_at", "end_at" }]`), `item_ids` (only these tasks), `exclude_item_ids`, `timezone`
(the device's, used until you save one), and `scope`: `{ "personal"?: true, "team_ids"?: [],
"list_ids"?: [] }` limits the plan to your personal tasks, team tasks assigned to you in the
teams named (all your teams when `team_ids` is omitted, none when it's empty) and, when
`list_ids` isn't empty, tasks in those lists. A plan:

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

Plans also carry `options` (what the plan was made with: `start_date`, `days`, `pad_percent`,
`split`, `break_level`, `use_frames`, `timezone`, `scope`, `keep_free`, `item_ids`,
`include_item_ids`, `exclude_item_ids`, `estimates`, `pinned_blocks`), `superseded_by`,
`estimates_saved`, and `tasks`, a checklist of every task considered: `{ item_id, title, due_at,
priority, team_id, list_id, estimate_minutes, estimate_tuned, included, planned_minutes, reason,
at_risk }`, where `reason` says why a task wasn't (fully) planned or was left out.

`PATCH /planner/plans/:id` (the owner, before the plan is applied or expires) makes the plan again
with some tuning. Each field given replaces the plan's current value; `estimates` merge by task:

| Field              | Meaning                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include_item_ids` | Tasks to add, even ones outside the scope or not assigned to you (any task you can see)                                                                                                       |
| `exclude_item_ids` | Tasks to leave out                                                                                                                                                                            |
| `estimates`        | `{ "<item id>": minutes }` to plan for instead of the task's estimate                                                                                                                         |
| `save_estimates`   | Also save those estimates on the tasks you can edit (listed in `estimates_saved`)                                                                                                             |
| `keep_free`        | Times to leave empty                                                                                                                                                                          |
| `pinned_blocks`    | `[{ "item_id", "start_at", "end_at" }]` kept exactly where they are (`pinned: true`); they take their time out of what's free and count towards their task. `422` if outside the days planned |
| `scope`            | As in the preview; `null` removes it                                                                                                                                                          |

The answer is a new plan with a new id; the old one expires and points at it (`superseded_by`).

## Team time

Teammates see each other's busy intervals only, never what the time is for. Busy frames count as
busy in availability and meeting suggestions. `at_risk_items` lists each member's tasks that can't
get enough time before they're due (tasks due soonest take the free time first):
`{ id, title, assignee_id, assignee_name, due_at, remaining_minutes }`.

| Method and path                                        | Result                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /teams/:id/availability?from=&to=`                | Each member's working hours and busy intervals                                                         |
| `GET /teams/:id/workload?from=&to=`                    | Capacity, assigned estimates, load, `overloaded`, `at_risk` and `at_risk_items` per member             |
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
| `GET /bookings/:id/slots?date=&days=&timezone=`       | owner, hosts   | Times a host can move it to (its own time, notice and a switched-off page don't get in the way)                    |
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

Free slots are the page's hours that every required host has free (events, buffers, travel, time
blocks and busy frames count as busy), minus bookings still held, keeping the page's buffers either side, its
notice and its limits. Start times step by the interval from local midnight. With SMTP set up a
booking waits for its email link (the time is held for 30 minutes); without it, it goes straight
on. Pages that need approval then hold the time until a host approves or declines, or until it
starts. A confirmed booking adds an event to every host's calendar; every step lands on the
booking's timeline, and hosts get in-app notices (`kind: "booking"`, `ref` = the booking) for new,
requested, moved and cancelled bookings.

## API keys, webhooks and the calendar feed

Other tools reach Orbyn through these; nothing is synced out of this server.

| Method and path                               | Body / result                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /me/api-keys`                            | Your keys (name, prefix, last used)                                                                       |
| `POST /me/api-keys`                           | `{ "name" }` → `201` with `key` (shown once; send it as `Authorization: Bearer ok_…`)                     |
| `DELETE /me/api-keys/:id`                     | `204`                                                                                                     |
| `GET /me/webhooks`                            | Your webhooks with their last delivery status                                                             |
| `POST /me/webhooks`                           | `{ "url", "events" }` → `201` with `secret` (shown once)                                                  |
| `PUT /me/webhooks/:id`                        | `{ "url"?, "events"?, "active"? }`                                                                        |
| `DELETE /me/webhooks/:id`                     | `204`                                                                                                     |
| `POST /me/webhooks/:id/test`                  | Sends a `ping` now → `{ ok, status, error }`                                                              |
| `GET /me/calendar-feed`                       | `{ enabled, busy_enabled, include_blocks }`                                                               |
| `PUT /me/calendar-feed`                       | `{ "include_blocks" }`: add your time blocks as "Focus: {task}"                                           |
| `POST /me/calendar-feed`                      | Creates or replaces your private feed link → `{ url, busy }`; `{ "busy": true }` makes the busy-only link |
| `DELETE /me/calendar-feed`                    | Turns the feed off; `?busy=1` turns the busy-only link off                                                |
| `GET /calendar/feed/:token.ics`               | The feed, as iCalendar, for other calendar apps to subscribe to (`?busy=1` for busy only)                 |
| `GET /me/calendar-subscriptions`              | Calendars you subscribe to by link, with `last_fetched_at`, `last_error`, `event_count`                   |
| `POST /me/calendar-subscriptions`             | `{ "url", "name", "color"?, "busy"? }` → `201`; `422` for a private address, `409` past 20                |
| `PUT/DELETE /me/calendar-subscriptions/:id`   | Change `url`, `name`, `color`, `busy`; or remove it and its events                                        |
| `POST /me/calendar-subscriptions/:id/refresh` | Fetch it now (10/min) → the subscription                                                                  |
| `GET /rsvp/:token`                            | Anyone with the link: the invitation (see below)                                                          |
| `POST /rsvp/:token`                           | Anyone with the link, 10/min: `{ "status": "accepted" \| "declined" \| "tentative" }`                     |

API keys act as you, except in the admin console. Webhook events: `item.created`,
`item.updated`, `item.completed`, `item.deleted`, `block.scheduled`, `booking.requested`,
`booking.confirmed`, `booking.rescheduled` and `booking.cancelled`.
Each delivery is a JSON `POST` of `{ event, occurred_at, data }` with `X-Orbyn-Event`,
`X-Orbyn-Delivery`, `X-Orbyn-Timestamp` and `X-Orbyn-Signature: sha256=<hex>`, where the hex is
HMAC-SHA256 of `"<timestamp>.<body>"` with your webhook secret. Failed deliveries are retried
with backoff for up to 8 attempts. Webhooks must reach a public address.

**The feed** has all-day items as dates, free events and tasks as `TRANSP:TRANSPARENT`, a
`VALARM` per alert, invitees (`ORGANIZER`, `ATTENDEE` with their answers), repeating items as
RRULEs in their own zone with `EXDATE`s, and occurrences changed on their own as extra events with
`RECURRENCE-ID`. The busy-only link has its own token (so it can be shared without the full one)
and lists nothing but "Busy" intervals: the same busy time teammates see, 30 days back to 180
ahead.

**Subscribing to other calendars.** Any iCalendar link (`https://` or `webcal://`) that reaches a
public address: timetables, public holidays, a work calendar. The notifier fetches it soon after
it's added and then hourly (asking only for changes), following up to 3 redirects, each checked
again, within 15 seconds and 5 MB. A failed fetch keeps the last events and says why in
`last_error`. Its events show in `GET /calendar` as `external`; they count as busy (for the
planner, booking pages and teammates, as intervals only) only when `busy` is on, never when
all-day or marked free, and they never leave the server otherwise.

### Invitations

Events can invite people by email (`attendees`); they need no account. With SMTP set up, each gets
an email with an iCalendar invitation (`METHOD:REQUEST`, the event's UID, `SEQUENCE` = its
version) their calendar app can add, and a private link, `<APP_URL>/rsvp/<token>?r=accepted`
(or `tentative`, `declined`), where the web app shows the invitation and posts the answer (opening
the link never answers by itself). New times, a new title, place or link, or a changed repeat
send an updated invitation; people taken off, or everyone when the event is deleted, get a
`METHOD:CANCEL`. Invitations wait in the notifier's email lane; without SMTP none are sent and
nothing else changes. `GET /rsvp/:token` → `{ title, start_at, end_at, all_day, timezone, rrule,
organizer, location, meeting_url, name, email, status }`. Each answer gives the organizer an
in-app `rsvp` notice.

## Example session

```bash
API=http://localhost:8008
TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"a-long-password","name":"Me"}' | jq -r .token)

curl -s -X POST $API/items -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Pay rent","due_at":"2026-10-01T09:00:00+10:00","reminder_minutes":1440}'

curl -s $API/items -H "Authorization: Bearer $TOKEN"
```

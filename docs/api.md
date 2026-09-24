# API reference

Base URL: `http://localhost:8008` in Docker, `http://localhost:8000` when running locally. Through
the web container it is also reachable at `http://localhost:8080/api`. A proxy that serves the API
under a path sends `X-Forwarded-Prefix` (and keeps `X-Forwarded-Proto`), so links the API builds,
such as the calendar feed, point at that path.

All request and response bodies are JSON. Authenticated routes need
`Authorization: Bearer <token>`. Errors have the shape `{ "message": "...", "request_id": "..." }`.
The `message` is written for people: a rejected field says which one and what to do ("Title is
too long: 200 characters at most."), a server error says to try again, and an address nothing
answers is a `404` with "That isn't here any more." `request_id` finds the request in the server
log. With `DEBUG_ERRORS=true` (development and test servers only) a `detail` field adds what went
wrong technically: the raw validation issues, or a server error's own message.

| Status | Meaning                                                                       |
| ------ | ----------------------------------------------------------------------------- |
| 401    | Missing, expired, or revoked session                                          |
| 403    | Signed in but not allowed: wrong role, or the account is disabled             |
| 404    | Not found, including records that belong to another user                      |
| 409    | Version conflict, duplicate record, or expired proposal                       |
| 422    | Validation error; `message` names each failing field and rule, e.g. `slug: …` |
| 429    | Rate limited (see [Rate limits](#rate-limits))                                |
| 502    | AI provider returned an error or invalid plan                                 |
| 503    | AI is not configured on the server                                            |

## Rate limits

Requests signed with a personal API key (`ok_…`) count against that key, wherever they come
from; every other request counts against its IP address. The limit is 180 requests a minute by
default (Admin → System, `rate_limit_per_minute`); sign-in, the assistant, creating API keys and
webhooks, and the public booking, invite and RSVP answers allow 10 a minute. Every response
carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the window
starts again); a `429` also carries `Retry-After` in seconds. The gateway adds its own per-address
burst limit in front.

## Automation (OpenAPI)

`GET /openapi.yaml` (no sign-in) serves a hand-maintained OpenAPI 3.1 description
([`docs/openapi.yaml`](openapi.yaml)) of what automation tools use: auth and API keys, items
(with quick add, manual order and incremental sync), lists, tags, sessions, the calendar and
event search, and webhooks with every event's payload. The usual recipes:

- **Triggers:** webhooks such as `item.created`, `item.completed` and `event.starting`.
- **Actions:** create a task or event (`POST /items`, or `POST /items/quick` from one line of
  text) and find events (`GET /calendar/search`).
- **Polling:** incremental sync (`GET /items?updated_after=…&include_deleted=1`).

**Priorities on a 0–9 scale.** Orbyn has three. Tools that number them 1 (highest) to 9 (lowest),
with 0 for none, map 1–3 to `high`, 4–6 and 0 to `medium` and 7–9 to `low`; going the other way,
`high` is 1, `medium` 5 and `low` 9. The API only accepts the three names.

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
  "name": "My space",
  "accept_terms": "2026-09-23"
}
```

→ `201 { "token": "...", "user": { "id", "email", "name", "email_reminders", "email_verified", "role", "handle", "bio", "terms_version", "analytics_opt_out" } }`

The email is trimmed and lowercased; a blank or missing `name` becomes "My space".

`accept_terms` is the agreement version (`GET /legal` → `terms_version`) the person agreed to on the
sign-up form, having confirmed they are 16 or older. It is recorded only when it matches the current
version; without it (older apps) the account is made with `terms_version: null` and the apps ask for
agreement once signed in.

When a mail server is configured, a new member starts with `email_verified: false` and gets a
confirmation email; until they confirm (or an admin does), every route except `GET /me`,
`POST /auth/logout`, `POST /auth/verify-email` and `POST /auth/resend-verification` answers `403`.
The first admin (and any address in `ADMIN_EMAILS`) is always created verified, and with no mail
server configured every account is verified at once (there would be no way to confirm it).

### `POST /auth/login`

`{ "email", "password" }` (`name` is ignored). → `200` with the same response as register. A wrong
email or password is always `401`, whatever its length: the sign-up password rules aren't applied.

### `POST /auth/logout` (auth)

Revokes the current session. → `204`

### `GET /me/chat` (auth) → `{ kind }`

The connected chat webhook's service (`slack` | `discord`), or `null`.

### `PUT /me/chat` (auth)

`{ "kind": "slack" | "discord", "url" }`. Connects an incoming webhook (validated to the real Slack/Discord hosts over https). → `{ kind }`.

### `DELETE /me/chat` (auth) → `204`. `POST /me/chat/test` (auth) posts a test message (`502` if the webhook can't be reached).

The daily digest is posted to a connected webhook as well as (or instead of) email.

### `GET /me/inbox` (auth) → `{ address, configured }`

Your email-to-task address (null until turned on), and whether the server has inbound mail set up.

### `POST /me/inbox/rotate` (auth)

Turn email-to-task on, or roll to a fresh address if one leaks. → `{ address, configured }`.

### `DELETE /me/inbox` (auth)

Turn it off. → `204`.

### `POST /inbound/mail`

Called by the mail server, guarded by `X-Inbound-Secret: <MAIL_INBOUND_SECRET>` (the endpoint is off unless the secret is set). Body `{ to, from, subject, text }`: the recipient's local part selects the person, the subject becomes a task (dates and #tags parsed as in quick-add) and the body its notes. Only the account's own email may send. Always `202` (so the mail server never retries or bounces); `401` on a bad secret.

### `GET /me/export` (auth)

Downloads a JSON archive of your personal data — lists, tags, habits and items — for keeping or moving.

### `POST /me/import` (auth)

`{ "format": "orbyn" | "csv", "data": string, "dry_run"?: bool }`. Brings items in; lists and tags are matched by name and created when missing. CSV needs a `title` column (optional `notes`, `due`, `priority`, `list`, `tags`). `dry_run` (default true) returns `{ created, skipped, lists_added, tags_added, sample, errors }` without writing.

### `GET /me/sessions` (auth)

Where the account is signed in: `[{ id, created_at, last_seen_at, user_agent, current }]`, newest activity first. `current` marks the session making the request.

### `DELETE /me/sessions/:id` (auth)

Sign out one other device. → `204`; `404` for an unknown session or the current one (use `/auth/logout` for that).

### `POST /me/sessions/revoke-others` (auth)

Sign out everywhere except here. → `{ "signed_out": n }`.

### `POST /auth/login` — two-step

When an account has two-step on, `POST /auth/login` also takes `code` (a TOTP or a one-time recovery code). Without it the response is `401 { "message": "totp_required" }`, which tells the app to ask for the code; a wrong code is a `401` with a different message.

### `GET /me/2fa` (auth) → `{ "enabled": bool }`

### `POST /me/2fa/setup` (auth)

Begin setup: `{ "secret", "otpauth_uri" }` to add to an authenticator app (by QR of the URI, or by typing the key). Nothing is enforced until enabled. `409` if two-step is already on.

### `POST /me/2fa/enable` (auth)

`{ "code" }` from the app. Confirms and returns `{ "recovery_codes": [...] }` (ten, shown once). `422` if the code is wrong.

### `POST /me/2fa/disable` (auth)

`{ "password" }`. Turns two-step off. → `204`; `403` if the password is wrong.

### `POST /auth/verify-email`

`{ "token" }` from a confirmation link. Marks the address confirmed. → `204`. Works signed in or
not, so the link opens in any browser. A spent or expired link is `410`.

### `POST /auth/resend-verification` (auth)

Sends the signed-in, unconfirmed user a fresh confirmation email (the newest link is the only one
that works). → `204`, including when already confirmed.

### `POST /auth/forgot-password`

`{ "email" }`. Sends a reset link when the address belongs to an active account and mail is set up.
Always → `204`, so it never reveals whether an account exists. Rate-limited.

### `POST /auth/reset-password`

`{ "token", "password" }` from a reset link. Sets the new password, confirms the address, ends
every other session, and signs in. → `200` with the same response as register. A spent or expired
link is `410`. The `password` must meet the sign-up rules.

### Passkeys (WebAuthn)

Passkeys let people sign in with a device — Touch ID, Windows Hello, a phone or a security key —
alongside their password, which keeps working. The relying-party id is the app's domain, so these
only work once `APP_URL` is the address people actually open.

Signed-in management:

- `GET /me/passkeys` → `[ { "id", "name", "created_at", "last_used_at" } ]`.
- `POST /me/passkeys/options` → the JSON creation options; call the browser's WebAuthn API with them.
- `POST /me/passkeys` with `{ "response", "name" }` (the browser's attestation) → `201 { "ok": true }`.
  An attestation that fails to verify is `400`.
- `DELETE /me/passkeys/:id` → `204`.

Sign-in (no auth):

- `POST /auth/passkey/options` with `{ "email"? }` → `{ "handle", "options" }`. The optional email
  narrows the credential list; omit it for a discoverable passkey.
- `POST /auth/passkey` with `{ "handle", "response" }` (the browser's assertion) → `200` with the
  same response as register. A bad handle or assertion is `401`.

Challenges are single-use and expire after five minutes.

## Terms, privacy and consent

The Terms of Service and Privacy Policy ship with Orbyn as starting texts (`packages/core/src/legal.ts`)
with `{{placeholders}}` an admin fills in. People agree to one **agreement version** — the newer of the
two documents' versions — so publishing either document asks everyone to review it again. Both apps
hold a signed-in person at a consent screen while `user.terms_version` differs from it. The API does
not block other routes on it.

### `GET /legal` → `{ company, contact_email, terms_version, privacy_version, minimum_age }`

Public. `terms_version` is the agreement version.

### `GET /legal/:doc` → `{ doc, title, version, body }`

Public. `doc` is `terms` or `privacy`; `body` is Markdown with the placeholders filled. `404` otherwise.

### `POST /me/consent` (auth)

`{ "terms_version": "2026-09-23" }` → `{ terms_version }`. `409` when it isn't the current version.
Recorded in `consent_log`.

### `GET /me/privacy` (auth) / `PUT /me/privacy` (auth)

→ `{ terms_version, terms_accepted_at, current_terms_version, analytics_opt_out, history }`.
`PUT` takes `{ "analytics_opt_out": bool }`. Opting out stops counting the account in
`daily_activity` (requests are still logged in `request_log` for security) and deletes what was
already counted. Each change is recorded in `consent_log`.

### `DELETE /me` (auth)

Delete your own account: `{ "password": "..." }` → `204`. `401` for a wrong password, `409` for the
last active admin. Teams you solely own pass to their most senior remaining member (a team left with
nobody is deleted) and team items move to an owner, as with the admin delete.

### `GET /admin/legal` / `PUT /admin/legal` (`system:manage`)

→ `{ settings, defaults, missing, accepted_current, users, analytics_opted_out }`. `PUT` takes any of
`{ company, contact_email, jurisdiction, processors, terms_body, privacy_body, publish }`: a `null`
body goes back to the starting text, and `publish: ["terms"|"privacy"]` gives those documents a new
version newer than the current agreement (today's date, `.2`, `.3`… on the same day). Audited.

## Study

Flashcards from the person's own pages, reviewed with spaced repetition, and revision planned around
exams (`packages/core/src/study.ts`, `backend/src/modules/study/`). Everything is free, and cards
come only from Orbyn pages: nothing is imported from other apps.

A **card** is any paragraph, bullet or numbered line written `Question :: Answer`. `Front ::: Back`
makes a card in each direction, and `The {{leader}} sends heartbeats` (a cloze) makes one card per
`{{…}}`, with that part hidden. `$…$` in a card is rendered as maths. Each person keeps
their own review state for the cards on the pages they can see (a team page's cards are studied by
each member separately). A named line keeps its card and history when its wording changes; a line
without a name is matched by its question. Removing the line removes the card. Scheduling is FSRS
v4.5 with the standard parameters, aiming for 90% recall: Again brings a card back in 10 minutes,
and the others in days. At most 20 new cards are introduced a day.

| Method and path                           | Body / result                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /study`                              | `{ due_today, new_cards, reviewed_today, streak, decks[], exams[], weak[], forecast[] }`                       |
| `GET /study/queue`                        | `?doc_id=&limit=&ahead=true` → cards to review now (due, then today's new ones), each with `next` per rating   |
| `POST /study/cards/:id/review`            | `{ "rating": "again" \| "hard" \| "good" \| "easy" }` → the card, rescheduled                                  |
| `PUT /study/exams`                        | `{ key, title, starts_at, doc_ids }`: the pages you're revising for an exam → the overview                     |
| `POST /study/revision/plan`               | `{ key, minutes?, timezone }` → proposed sessions in free working time before the exam (nothing saved)         |
| `POST /study/revision/apply`              | `{ key, sessions[] }` → `201`: a "Revise for …" task due at the exam, with the sessions on your calendar       |
| `POST /ai/study/pages/:id/cards` (10/min) | → `{ cards: [{ question, answer, source }] }` suggested from the page alone; the apps add only the ticked ones |
| `POST /ai/study/grade` (10/min)           | `{ card_id, answer }` → `{ verdict, feedback, suggested_rating }`, judged against the card and its page        |
| `POST /ai/study/cards/:id/explain`        | → `{ explanation, beyond_notes }`; `beyond_notes` is true when it needed more than the page                    |

**Exams** are upcoming events (60 days) from a subscribed calendar of the Exams kind, or events named
like one (exam, midterm, final, test, quiz). Each has a `key` built from its source and start.
`readiness` is the share of the attached pages' cards known well (stable for a week or more).
`projected` is the share known well by the exam if every review is done when due and new cards are
learnt 20 a day. `forecast` gives reviews due on each of the next 7 days, with overdue ones counted
today. Each deck also has `next_due_at` and `imported_from`.

The AI routes answer `503` without a provider. Reviewing never calls the AI. The agenda gets a
**Study** section (cards to review, exams within two weeks), the morning digest counts cards due,
the evening digest counts cards reviewed, the assistant gets a `study` summary in its overview and a
read-only `get_study` tool, and the sweeper keeps review history for 400 days (configurable) and
exam attachments for 30 days after the exam.

## Importing files into Docs

A PDF, a Word document (`.docx`) or a photo of notes (PNG, JPEG) becomes an ordinary page in the
**Uploads** section of Docs, and the file itself is deleted
(`packages/core/src/imports.ts`, `backend/src/modules/imports/`). Import is free.

1. `POST /imports` gives an upload link for one file.
2. The app `PUT`s the file's bytes to that link. The link goes to the **file store**, not the API.
   It works once and for ten minutes.
3. The file store queues the file for the **converter**, which reads each page the cheapest way
   that works:
   - **Word files:** read directly. Equations become exact LaTeX.
   - **PDF pages with real text:** read with their fonts. Columns come out in order, and repeated
     headers, footers and page numbers are dropped. Bold, headings, lists and tables are kept.
     Maths in maths fonts becomes LaTeX.
   - **Scanned pages and photos:** read with the built-in Tesseract (English), then laid out the
     same way.
   - **Equations on scans:** read with the optional formula model when it's on; otherwise each
     keeps a placeholder.
   - **The heavy OCR model** replaces Tesseract only where it's configured, which it isn't by
     default.
4. The finished page is created with `in_uploads: true`, an in-app notice (`kind: "import"`) says
   it's ready, and the file is deleted.

| Method and path             | Body / result                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /imports`             | `{ file_name, bytes, mime? }` → `201 { import, upload_path, expires_at }`; `503` when importing isn't set up             |
| `PUT {upload_path}`         | The file's bytes, any `Content-Type` → `201 { id, bytes }`. Reached through the gateway (`/files/u/…`, `/api/files/u/…`) |
| `GET /imports`              | Your imports still going, and the last 7 days' → `[ImportJob]`                                                           |
| `GET /imports/:id`          | → `ImportJob`                                                                                                            |
| `DELETE /imports/:id`       | Cancels an import still going, or clears a finished one → `204`                                                          |
| `GET /imports/capabilities` | What this server can read → `{ enabled, scans, formulas, photos, limits }`                                               |

`scans` is how pages without their own text are read:

- `"tesseract"`: built in; printed text, no maths.
- `"full"`: the heavy OCR model.
- `"none"`.
- `"unknown"`: the converter hasn't reported in the last 2 minutes.

The apps use this to say what will import before an upload, not after.

An `ImportJob` has these fields:

- `status`: `waiting`, `queued`, `reading`, `ocr`, `ready`, `failed` or `cancelled`.
- `pages`, `ocr_pages` and `ocr_done`: the page counts.
- `queue_ahead` and `estimate_seconds`: set while `ocr`, from measured seconds per page.
- `doc_id`: set once `ready`.
- `error`: why it failed, in words for the person.
- `notes`: what changed on the way in, such as "2 tables kept as lists" or "1 figure left out".

**Maths.** An equation read from a PDF's fonts, or from a scan, whose layout was a guess (a stacked
fraction, a matrix, limits above and below) is a math block with `check: true`. The apps show a
**Check** mark on it, and the page's note says how many there are. Editing the equation clears the
mark. Equations from Word are exact and never marked.

**Pages** carry `imported_from` (`{ file_name, file_type, pages, ocr_pages, imported_at }`) and
`in_uploads`. Moving a page into a folder (or Unfiled) or a project with `PUT /docs/:id` sets
`in_uploads` to false, which takes it out of Uploads. Orbyn pages have no table or image blocks
yet, so each table row becomes one bullet (`Term: CAP · Meaning: …`) and each figure becomes a
placeholder line.

**Limits:**

- 50 MB and 200 pages per file.
- Scanned pages: up to 200 per file and 400 per person per day with Tesseract. With the heavy OCR
  model it's 40 per file and 60 per day. Pages read directly don't count.
- Two files importing at once per person.
- The upload is refused when its first bytes don't match its type. A password-protected PDF, a
  `.doc` file, or a scanned PDF on a server without OCR each fails with a message saying what to do.

**Deleting files:** the file store deletes a file when its import ends, whether it's ready, failed
or cancelled. A sweep every 10 minutes also removes anything older than 24 hours, and uploads that
never arrived after 30 minutes. It refuses new uploads when less than `FILES_MIN_FREE_MB` (1 GB)
would be left on its disk. The sweeper keeps the `imports` rows (file name and outcome) for 30 days.

### Admin → Storage (`system:manage`)

These show information about stored files, never their contents. Admins can delete a file but not
open one.

| Method and path                         | Body / result                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /admin/storage`                    | See the list below                                                                             |
| `DELETE /admin/storage/files/:importId` | Deletes the stored file now and cancels its import → `204` (audited as `storage.file_deleted`) |
| `POST /admin/storage/sweep`             | Runs the file store's sweep now → `{ removed }` (audited as `storage.swept`)                   |

`GET /admin/storage` returns:

- `database`: its size in bytes.
- `files`: count, bytes, the oldest file, and free disk space.
- `reading`: how scans are read, whether equations on scans are, the number of workers, and the
  converter's last report.
- `queue`: imports waiting and reading, pages waiting, seconds per page, and failures today with
  their reasons.
- `stored`: each file with its owner, name, size, status, and when it will be deleted.
- `history`: the last 30 days of imports, with which reader handled each page.

## Profile

### `GET /me` (auth)

→ `{ "id", "email", "name", "email_reminders", "email_verified", "role" }`. `role` is `admin` or `member`.

### `PUT /me` (auth)

```json
{ "email_reminders": false }
```

## Agenda and meeting notes

Two kinds of document Orbyn writes for you. Both are ordinary documents once created, so they can
be edited like any other page. The agenda is built from the calendar; with an AI provider connected
it also opens with a few sentences the assistant writes about the day.

### `GET /agenda/today` (auth)

Today's agenda, in the person's planner time zone, written from the calendar as it actually is. Its
sections: a summary line (the assistant's, when connected), Top priorities, Schedule (Morning,
Afternoon, Evening; all-day first; no calendar names), Focus time (time set aside and free
stretches), Due today, Carried over, Coming up, Notes and End of day. It reads
(`packages/core/src/agenda.ts`, `backend/src/modules/docs/agenda.ts`) your events with repeats on
the day they fall and the calendars you subscribe to, time set aside for tasks and habits, what's
due, what slipped, exams and all-day events in the coming week, and how much working time is free. Written the first time it's asked for each day, never waiting on the AI
provider, and returned unchanged after that, so edits are never overwritten. → a document with
`kind` `agenda`, titled like "Sunday 20 September".

The worker writes each active person's page between 5 and 11 in their own zone (at most 25 per
15-minute pass, five at a time), opening with the assistant's summary of the day when a provider is
connected.

### `POST /me/timezone` (auth)

`{ "timezone": "Australia/Melbourne" }` → `{ adopted, timezone }`. Both apps send the device's zone
when they start. It becomes the planner zone unless the person picked one in Planning settings
(`planner_prefs.timezone_chosen`); before this, anyone who never did was treated as UTC for
everything the server writes. On a change, subscribed calendars are read again and today's agenda,
if untouched, is written again. `GET /agenda/today?timezone=` and `POST /ai/agenda/today`
`{ timezone }` do the same first.

In the library, agendas have their own **Agendas** section, filed by year, month and week (Monday
first), and are left out of "All documents" and "Unfiled".

### `POST /ai/agenda/today` (auth, 10/min)

Writes today's agenda again from the calendar as it is now, replacing the page's content (the apps
ask first), and opens it with the assistant's summary when a provider is connected. The provider is
sent the day as facts only (times already in your zone). → the document plus `brief`: whether the
assistant wrote the summary.

### `POST /items/:id/note` (auth)

The meeting note for an event, created from a template (Agenda, Notes, Decisions, Action items)
the first time and returned as-is afterwards. → `201` when created, `200` when it already existed.
A note for a team event belongs to the team, so one shared meeting keeps one shared note.

### `POST /docs/:id/tasks` (auth)

Turns the document's unticked, non-empty checklist lines into planner tasks (in the document's
team, if it has one). → `{ "created": 2, "items": [ … ], "doc": { … } }`. Blank, already-ticked
and already-linked lines are skipped. An agenda answers `422`: its lines copy tasks you already
have, so making them would only make each one twice.

## Projects

A project groups planner tasks into a named piece of work with ordered stages. Tasks are not
copied — a project sets `project_id` and `stage_id` on the items that belong to it — so
scheduling, reminders and the calendar keep working unchanged. Personal projects belong to their
creator; team projects follow the same team roles as team items.

### `GET /projects` (auth)

→ `[ { "id", "name", "summary", "status", "deadline", "doc_id", "stages": [...], "task_count",
"done_count", … } ]`. Archived projects sort last. The counts are the project's open and done
tasks: cancelled tasks and events filed in it aren't counted.

A `deadline` is one moment. The apps save a picked day as 5 pm in the picker's own time zone
unless a time is picked too (`projectDeadlineAt` and `changeProjectDeadline` in `@orbyn/core`),
and always show it in the viewer's zone.

### `POST /projects` (auth)

```json
{
  "name": "Email campaign",
  "deadline": null,
  "stages": ["Planning", "Content"]
}
```

Without `stages` a project starts with Planning, In progress, Review and Done. → `201`.

### `GET /projects/:id` (auth)

→ the project with its stages and task counts. `404` when it isn't yours.

### `GET /projects/:id/activity?limit=100` (auth)

→ recent project, task, linked-note and work-record changes, newest first (maximum 200). The timeline contains
titles and planning fields only; task notes and document bodies are never included. Access follows
the same personal-project or team membership rules as `GET /projects/:id`.

### `GET /projects/:id/time-machine/checkpoints?before=&limit=100` (auth)

Lists changes newest first with a stable decimal `event_order`, timestamp, summary and actor name.
Pass the oldest returned `event_order` as `before` to fetch an earlier page. The default page
contains 100 changes; the maximum is 200. Invalid cursors return `422`. Access follows the
project's personal ownership or team membership rules.
For projects created before history logging, the first checkpoint is "Project history starts here";
earlier activity cannot be reconstructed and is not offered as a snapshot.

### `GET /projects/:id/time-machine/:eventOrder` (auth)

Returns a read-only planning snapshot immediately after that change: project name, summary,
status and deadline, plus its stages, tasks, linked note titles and work-record titles at that
point. Task notes and document bodies are omitted. A change outside the visible project returns
`404`; invalid event orders return `422`. Historical planning state cannot be edited through
this endpoint.

### `PUT /projects/:id` (auth)

`name`, `summary`, `status` (`active`, `done`, `archived`), `deadline`, `doc_id` and `stages` are
each optional. Sending `stages` replaces the set: entries with an `id` are renamed and reordered,
entries without one are created, and any left out are removed — tasks in a removed stage stay in
the project with no stage.

### `DELETE /projects/:id` (auth)

→ `204`. The project's tasks are kept and become unfiled.

### `PUT /items/:id/project` (auth)

```json
{ "project_id": "uuid", "stage_id": "uuid" }
```

Moves a task into a project and stage. `project_id: null` takes it out of the project. A stage
that belongs to a different project is `422`.

### Work records (auth)

Promises, decisions, experiments and meeting outcomes live beside personal or team work.
`GET /work-records` lists visible records, optionally filtered by `kind`, `project_id`,
`owner_id` or `source_item_id` (up to 200). `source_item_id` finds what came out of one
meeting: the event's detail uses it to show the outcomes recorded for that event. `GET /work-records/:id` reads one record. Personal records are visible
only to their creator; team records follow team membership. Linked projects, notes and tasks
must belong to the same personal or team space.

`POST /work-records` accepts `kind`, `title`, optional `details`, `team_id`, `project_id`,
`owner_id`, `due_at`, `review_at`, `source_doc_id`, `source_block_id`, `source_item_id` and
`linked_item_id`. Meeting outcomes may also include `meeting_minutes` and `participant_count`
together; their product is the meeting's person-minutes. A promise assigned to another team member starts as `proposed`; other
records start as `open`. `PUT /work-records/:id` accepts a required optimistic `version`
and optional title, details, status, dates, linked task and outcome. Stale versions return
`409`. `POST /work-records/:id/respond` with `{ "decision": "accept" | "decline" }` is
available to the proposed promise's owner. Acceptance opens the promise; declining it
keeps the response visible in the record and project history.

Offering a promise to someone else sends them a notification (kind `promise`, `ref` = the
record's id), in the app and as a push to their devices; their answer sends one back to
whoever offered it. A notice whose record has since been deleted is dropped before delivery.

A decision with no linked task is shown as "No task delivers this yet" with a **Make a task**
action. That is two ordinary calls: `POST /items` for the task, then `PUT /items/:id/project`
and `PUT /work-records/:id` with its `linked_item_id`.

### `GET /work-records/:id/evidence` (auth)

For an experiment: the same numbers for the same span of days before it started and while it
ran — from `created_at` to its `review_at`, or to today, at least seven days either side.

```json
{
  "before": {
    "from": "…",
    "to": "…",
    "kept_rate": 0.72,
    "focus_minutes_per_week": 240,
    "tasks_done_per_week": 9
  },
  "during": {
    "from": "…",
    "to": "…",
    "kept_rate": 0.81,
    "focus_minutes_per_week": 410,
    "tasks_done_per_week": 11
  }
}
```

`kept_rate` is the share of planned blocks that were kept (`null` with no plan in that span).
The numbers belong to the experiment's owner, or its creator. It is `404` to anyone who can't
see the record. The verdict stays the person's — the client shows the numbers beside the
"What did you learn?" field rather than judging the experiment itself.

## Page history

Each time someone sits down and changes a document, the state they started from is kept. Saves
arrive every second or so while someone types, so a state is kept only when the previous kept one
is by someone else or more than five minutes old — history reads as sittings, not keystrokes.

### `GET /docs/:id/export?format=` (auth)

`format` is `md` (the default), `txt`, `html`, `docx` or `pdf`; anything else is `422`. The reply
carries a `content-disposition` with the file name, so every client saves the same file under the
same name.

`docx` and `pdf` are written directly rather than through a library — a `.docx` is a zip of XML and
Node already has DEFLATE in `zlib`, and a PDF with the standard fourteen fonts needs no font
embedded. That keeps the backend on the ten dependencies it has. The PDF carries headings, lists,
checklists, quotes, code, rules, and bold and italic within a line; it has no images (a page has
none) and writes a formula as the symbols it reads as, the same as everywhere outside the editor.

### `GET /docs/:id/markdown` (auth)

Kept for anything already pointing at it; `export?format=md` is the same bytes.

### `GET /docs/:id/versions` (auth)

→ `[ { "version", "title", "author", "user_id", "created_at", "blocks" } ]`, newest first, without
content. Empty until the document has been changed at least once.

### `GET /docs/:id/versions/:version` (auth)

→ the same fields plus `content`, the blocks as they were. `404` when that version is not kept.

### `POST /docs/:id/versions/:version/restore` (auth)

Puts that state back **as a new version on top** — history is only ever added to, and the state
being replaced is kept like any other. → the document as it now is. Announced on the live channel,
so other open tabs pick it up.

## Live changes to a document

Editors that have a document open follow it, so two people can work on the same page at once.

### `GET /events/docs/:id` (auth)

Served by the realtime service. `GET /docs/:id/live` is the same stream at the path older apps
use.

A server-sent event stream. Each event says only that the document moved on and to which version:

```
data: {"docId":"…","version":7,"by":"e4f1c2ab"}
```

The reader then re-reads the document and folds the new copy into what is on screen. Keeping the
payload to a version number means a reader that misses an event still catches up on the next one.

`by` is the editor that saved — a per-tab id sent as `X-Orbyn-Editor` on writes and on this
request — or `"task"` when a task tied to one of its lines was finished or reopened somewhere else,
or `"agenda"` when the day's agenda was written again from the calendar. A tab is never told about
its own save. When only a task's tick moved (`onlyTaskTicksMoved` in `@orbyn/core`), Orbyn's
editors re-read quietly if `by` is `"task"`, and otherwise say "A task on this page changed." rather
than that someone else edited it. `404` when the document isn't yours to read.

The stream is read with `fetch`, not `EventSource`, because `EventSource` cannot carry an
`Authorization` header and the token must not travel in the URL.

Changes travel between API copies on a Postgres `LISTEN`/`NOTIFY` channel. A transaction pooler
cannot hold a `LISTEN` open, so where `DATABASE_URL` points at PgBouncer, set
`DATABASE_LISTEN_URL` to the primary directly.

### Two people editing the same line

Each save carries the version it was made against, so the second one is refused with `409`. The
editor answers a `409` by re-reading the document and merging: lines only one side touched are
kept as they are, and where both rewrote the same line the saved version stands and the other
follows it on the page, marked in a note. Nothing typed is dropped.

## Comments on a document

A comment is either about one line or about the page as a whole. Anyone who can read the document
can comment on it; only the person who wrote a remark can withdraw it.

### `GET /docs/:id/comments` (auth)

→ `[ { "id", "author", "body", "resolved_at", "created_at", … } ]`, oldest first.

### `POST /docs/:id/comments` (auth)

`{ "body", "block_id"?, "quote"?, "range_start"?, "range_end"?, "parent_id"?, "mentions"? }` → `201`.
An empty body is `422`, and so is half a range.

`block_id` ties the remark to one line, using the name that block carries in the document's content
rather than its position, because editing moves blocks around. `range_start` and `range_end` narrow
it to a stretch of that line, as character offsets into the line's **Markdown source** — so
`**bold**` is eight characters, not four. `quote` is what those characters said at the time, and is
what the remark is followed by. Leave the range out for a remark about the whole line, and the
`block_id` out too for one about the page.

`parent_id` makes the remark a reply. Threads are one deep: replying to a reply joins the same
thread rather than nesting further, because a margin has nowhere to put a third level.

`mentions` are user ids, and only people who can already read the page are accepted — naming
someone is not a way to show them a document. Each one gets an `inapp` notification of kind
`mention`.

**Following the words.** Every save re-anchors the open remarks on the lines that changed: the quote
still at those offsets means nothing to do; the quote found elsewhere in the line moves the offsets
to the nearest occurrence; the quote gone altogether sets `detached`. A detached remark is kept, with
its `quote`, so it can be shown apart rather than disappearing. Restoring an old version runs the
same pass.

## Proposed changes

A suggestion is a change to one line that lives beside the document until an editor takes it or
leaves it. The document is untouched and its `version` unspent while a suggestion is open, so two
people can propose changes to the same sentence without one of them losing a version race.

**Anyone who can read a document may propose; only `items:write` may decide.** That is the whole
difference between suggesting and editing.

### `GET /docs/:id/suggestions` (auth)

→ `[ { "id", "author", "block_id", "kind", "range_start", "range_end", "text", "quote", "note",
"status", "detached", "created_at" } ]`, oldest first. `kind` is `replace`, `insert` or `delete`;
`status` is `open`, `accepted` or `rejected`.

### `POST /docs/:id/suggestions` (auth)

`{ "changes": [ { "block_id", "kind", "range_start", "range_end", "text", "quote" } ], "note"? }`
→ `201` with the rows created. Up to 50 changes in one call, because one edit to a page can touch
several lines.

### `POST /docs/:id/suggestions/:sid` (auth, `items:write`)

`{ "take": true }` writes the change into the line, bumps the document's `version`, records who took
it, and returns `{ "doc": … }`. `{ "take": false }` marks it rejected and returns `{ "doc": null }`.

Deciding one that is already decided is `409`. So is taking one whose words have gone (`detached`),
because there is nothing left to apply it to. Taking a proposal **unsettles** any other open one over
the same characters — it stays `open` and becomes `detached`, so its author is told to look again
rather than having it decided for them.

### `DELETE /docs/:id/suggestions/:sid` (auth)

→ `204`. Only its author, and only while it is still open.

## The assistant, inside a page

Separate from the Assistant tab, which is about your schedule. These two only ever work on one page,
and **neither can change it**: an answer comes back as a proposal to take or leave.

### `POST /docs/:id/assist` (auth, 10/min)

`{ "block_id", "range_start", "range_end", "action", "instruction"? }` → `201` with a suggestion.

`action` is one of `improve`, `shorten`, `expand`, `fix`, `formal`, `friendly`, `direct`,
`summarise`, `checklist`, `continue` or `custom`; `instruction` is what was asked for when the action
is `custom`. The provider is given the passage, the page's title and twenty lines either side —
never the workspace.

An answer identical to the passage is `409` rather than a proposal that would change nothing. A
`block_id` that is not on the page is `404`, and an empty range is `422`. With no provider connected
the route is `503` and says who can connect one.

### `POST /docs/:id/ask` (auth, 10/min)

`{ "question" }` → `{ "answer", "sources": [ { "block_id", "quote" } ] }`.

Answered from that page and nothing else, and the sources are the lines the answer rests on so it
can be checked. A provider that will not return JSON still has its words passed through, with no
sources.

### The assistant writing things down

Two tools let the assistant put words on a page, and neither writes on its own.

`propose_note` drafts a note. The draft travels back with the reply as `notes: [{title, content,
project_id, project_name, item_id, team_id, note}]` and becomes a page only when someone keeps it —
the client then calls `POST /docs` with `kind: "note"`. A project or task id the model names is
checked against what the asker can actually see and dropped when it is not theirs; at most three
drafts in a turn.

It rides with the reply rather than through the proposal system on purpose: `actionSchema`, the
proposals table, the apply route and both clients' review cards are all typed for items, and a
document is a different animal.

`propose_doc_edit` proposes changes to words on an existing page. These are written as ordinary
`doc_suggestions`, so they wait **beside the page** with the same Take or Leave as a colleague's —
which is where a change to a sentence should be read. The words to change are looked for in the page
as it stands; anything that does not match comes back in `not_found` rather than being guessed at.

## Search

### `GET /search?q=&type=&kind=&project=&tag=&team=&updated_after=&limit=` (auth)

→ `[ { "id", "type", "title", "kind", "team_id", "project_id", "project_name", "updated_at",
"snippet", "block_id", "rank" } ]`, best first.

`type` is `doc` or `task`; leave it out for both, ranked together on one scale. Pages are matched on
a weighted `tsvector` — title A, headings B, tags and project name C, body D — and on the **letters**
of the title as well, so `Lanch breif` finds Launch brief. Rank is the text match lifted for a
recently edited page, plus a little for a title that merely looks like what was typed.

`block_id` is the line that matched, so a hit can open where the words are. `snippet` wraps the
matched words in `[[` and `]]` — markers rather than markup, so nothing has to trust a string from
the database as HTML.

A search only ever returns what the searcher can already see.

### Finding a page by meaning

Off by default, and impossible at all on a Postgres without `pgvector` — which the stock
`postgres:17-alpine` image is. Migration 041 asks for the extension, notices when it is not there, and
creates nothing; the word search above carries on alone, which is how the workspace already worked.
Swapping the image to `pgvector/pgvector:pg17` and re-running migrations creates the tables; nothing
else changes.

Turning it on is `PUT /ai/settings` with `semantic_search: true`, and `GET /ai/settings` reports both
`semantic_search` (whether it is wanted) and `semantic_possible` (whether this database could).
It stays off until asked for because measuring a page means **sending its words to whichever AI
provider is configured**, which is a decision for whoever runs the workspace rather than a default.

Once on, editing a page queues it; the worker measures its lines a minute at a time, and only the
lines whose words actually changed. Meaning is then **added to** the word search, never used instead
of it: a page the words already found is lifted a little, and a page only meaning found joins the end
rather than displacing a plain match. If the provider is unreachable the search still returns its word
results — losing meaning is not losing the search.

### `PUT /docs/:id/comments/:commentId` (auth)

`{ "resolved": true }` stamps the time it was resolved; `false` brings it back.

### `DELETE /docs/:id/comments/:commentId` (auth)

→ `204`, and `404` when the remark is someone else's.

## Folders and favourites

Folders group documents inside a workspace; they are flat by design, since one level is enough to
tidy a workspace without becoming a filing cabinet. Favourites pin the few things someone keeps
coming back to, and are private to whoever starred them.

### `GET /folders` (auth)

→ `[ { "id", "name", "team_id", "position", "doc_count", … } ]`, personal folders first.

### `POST /folders` (auth)

`{ "name", "team_id"? }` → `201`. New folders go to the end of the list.

### `PUT /folders/:id` (auth)

`{ "name"?, "position"? }` → the folder.

### `DELETE /folders/:id` (auth)

→ `204`. The folder's documents are kept and become unfiled.

### `GET /favourites` (auth)

→ `[ { "kind", "target_id", "created_at" } ]`. `kind` is `doc` or `project`.

### `PUT /favourites` (auth)

`{ "kind", "target_id", "starred" }` → `204`. Starring something already starred is harmless.

A document is filed by sending `folder_id` to `POST /docs` or `PUT /docs/:id`; `null` unfiles it,
and leaving the field out keeps it where it is.

## Documents

Notes, briefs and agendas that live beside the planner. A document is a list of blocks
(`heading`, `paragraph`, `bullet`, `numbered`, `todo`, `quote`, `code`, `math`, `divider`).
`math` blocks hold LaTeX without the `$$` fences, and inline maths lives between single `$`
signs inside any text block, so a document always round-trips to Markdown with its formulas
intact. Personal documents belong to their author; team documents follow the same team roles
as team items (viewers read, members and above write).

### `GET /docs` (auth)

→ `[ { "id", "title", "kind", "team_id", "team_name", "preview", "version", "updated_at", … } ]`,
newest edit first. The body is left out and `preview` carries the first ~120 characters, so a
list stays light.

### `POST /docs` (auth)

```json
{
  "title": "Convergence notes",
  "content": [{ "type": "math", "text": "E = mc^2" }]
}
```

`kind` is `doc` (default), `agenda` or `meeting`; `team_id` puts it in a team; `item_id` links a
meeting note to its event. → `201` with the full document.

### `GET /docs/:id` (auth)

→ the full document, including `content` and `linked_block_ids`: the checklist lines tied to a
task, by block id. Any line can carry an id (a remark needs one), so only these are tasks.
`PUT /docs/:id` and the other routes that return one page include it too; `GET /docs` doesn't.
`404` when it isn't yours.

### `GET /docs/:id/markdown` (auth)

→ `text/markdown` of the document, title first, with any LaTeX kept as source.

### `PUT /docs/:id` (auth)

```json
{ "title": "New title", "content": [], "version": 3 }
```

`version` is the version the edit was made against; a mismatch answers `409` rather than
overwriting, so two open tabs can't clobber each other. `title` and `content` are each optional.

Ticking or unticking a line tied to a task finishes or reopens the task the same way as anywhere
else: its future sessions are removed, a repeating task moves on to its next occurrence, and
webhooks, your other devices and the other pages showing the task hear about it. What counts is a
tick the person made, not one the page is still carrying (a repeating task that moved on reads
unticked again, and a refused tick reads as the task really is), so saving the page again never
finishes a task twice:

- An editor sends `X-Orbyn-Ticks-From: <version>`, the version of the page its ticks were taken
  from: the last copy it read, saved or merged whose lines tied to tasks it showed exactly as that
  copy had them. While a tick made on the page is unsaved, that stays put, even as newer copies
  are merged in: sent as if made on the newer copy, a tick already counted (a save whose answer
  was lost, or another open copy ticking the same line) would count again. `ticksTakenFrom` in
  `@orbyn/core` keeps it. A save queued behind one still running sends the version from before
  that one's answer. A line whose `done` differs
  from its task counts when its ticks were taken from the first version that shows the line as
  the task now stands, or a later one. So ticking a line on a page opened afresh, or again after
  the save that took the last answer was lost, finishes the next occurrence.
- Without the header (older apps), a line's `done` counts only when it differs from its task and
  from the tick the page last sent for that line, which starts again from the task whenever the
  task is finished or reopened anywhere else. Restoring a version goes by this rule too.

A line whose task you can no longer change is left alone rather than failing the save.

The response, like every route that returns one page, shows each line tied to a task as its task
now stands, and the page is stored that way: a repeating task that moved on reads unticked for its
next occurrence. An editor should take `done` for those lines from the response (unless the line
was ticked again meanwhile; `adoptTaskTicks` in `@orbyn/core`) and save once it has. Accepting a
suggestion changes words only and never finishes or reopens a task.

When a task tied to a page's line is finished or reopened anywhere else (the planner, another
page, the assistant), every page showing it moves on a version (without changing `updated_at`) and
open copies hear about it on the live stream. An editor still showing the old tick gets `409` on
its next save, re-reads, and merges, so it can't save the old tick back over the change. A save of
the page running at that moment isn't waited for: it gives the page its next version, waits for
the task itself, and reads the task as it now stands, so an old tick it carries doesn't count.

### `DELETE /docs/:id` (auth)

→ `204`.

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
| `parent_id`        | Tasks only: the task this one is a subtask of (see [Subtasks](#subtasks)); null for a top-level task.                                                                                      |
| `links`            | Up to 20 `{ "url", "title"? }` web links (`http://` or `https://`). Sending the list replaces it; the item detail returns them with `id` and `position`.                                   |

Read-only fields on every item: `remaining_minutes` (`max(0, estimate − spent)`, null without an
estimate), `position` (its manual order), `child_count` (subtasks that aren't cancelled) and
`children_done` (of those, the ones done).

Rules: `kind` is `task` or `event`; events require `due_at`; `end_at` requires `due_at` and must be
later; timestamps are ISO 8601 with an offset; a repeating item needs `due_at`; only team items can
have an assignee, who must be in the team.

Alerts: a new item given no `alerts` gets your `default_alerts` (30 minutes before, until you change
them). `reminder_minutes` (0 to 10080) is kept for older apps: sent without `alerts` it sets the
alert on a new item and, on an edit, replaces the smallest alert when it changed. Responses carry
it as the smallest alert, or null when there are none.

A repeating item's `due_at` is its current occurrence and `series_start` its first. Completing a
repeating task moves it to the next occurrence (its checklist resets and the timeline notes the
completed one) instead of closing it. Completing any task removes its future sessions.

**Done or cancelled.** Both close a task: it leaves the planner, at-risk and due-soon notices,
workload and the score (null), its reminders stop, and its future sessions are removed.
Completing (`done`) also sets progress to 100, sends `item.completed`, moves a repeating task to
its next occurrence and, with `count_blocks_as_spent` on, counts its blocks' time as spent.
Cancelling (`cancelled`) does none of those: progress stays, no `item.completed`, and a repeating
task stops for good. Reopening either re-arms its reminders. Cancelled events don't count as busy.

**Blocks as time spent.** With the planner preference `count_blocks_as_spent` on (off by
default), completing a task adds the past part of each of its sessions (up to now) to
`spent_minutes`. Each block counts once, even if the task is reopened and completed again.

### Subtasks

A subtask is a task of its own with a `parent_id`: it has its own dates, estimate, status,
blocks and reminders. The parent must be a task you can see in the same space (the same team, or
both your personal tasks); there's no loop, and a tree has three levels at most (a task, its
subtasks, and theirs). `422` otherwise. A subtask moved to another team leaves its parent; a task
with subtasks can't move to another team or become an event until they're moved or detached.
Deleting a task deletes its subtasks.

**How the planner counts them.** A task's estimate covers its subtasks. Subtasks are planned on
their own; while a task has open subtasks it's only planned for what its estimate has beyond
theirs (their remaining estimates, 30 minutes for one without an estimate), and for nothing when
it has no estimate itself. So the work counted is the sum of the subtasks' remaining estimates or
the parent's own, whichever is more, and never twice. At-risk and due-soon notices and team
workload use the same rule. Subtasks keep their own due times.

### `PUT /items/:id/position` (auth)

`{ "before_id" }`, `{ "after_id" }` or `{ "position" }` (one of them) moves an item in its manual
order: before or after another item in the same place (the same parent, else the same list, else
your personal items or the team's items), or to an index. → the item. The items there are numbered
again from 0. Like checklist steps this doesn't change `version`, so an open editor never
conflicts because of a drag (it does change `updated_at`, so sync sees it). `422` for an item from
another place. New items go to the end of their place.

### `GET /items?limit=200&offset=0&team_id=&sort=` (auth)

Newest first. `limit` max 500. Returns your personal items plus items of every team you belong to.
Pass `team_id` to list only one team's items (requires membership). Other filters: `q` (words in
the title or notes), `list_id`, `tag_id`, `assignee_id` and `parent_id` (a task's subtasks).

`sort` is `newest` (the default), `score` (priority score, highest first; events and finished
tasks last), `due` (soonest first, undated last), `priority` (high to low), `estimate` (shortest
first, unestimated last), `title` (A to Z), `created` (oldest first) or `position` (the manual
order). Every item carries its `score`, worked out on read (null for events and closed tasks):

```
score = 3 × priority (low 1, medium 2, high 3) + 4 × urgency + 2 if overdue + 1 × size_fit
        + 0.5 if in progress − 3 if blocked
```

Urgency rises from 0 a week before the deadline to 1 at it, and a task is overdue once its deadline
has passed; the deadline follows the one rule in [Sessions](#sessions-blocks) (the end of the day
for an all-day task, the end time for a task that has one). `size_fit` is 1 when the remaining
estimate (estimate − time spent) fits the largest free working slot left today (or on the next
working day once today's hours are over), 0.5 when it doesn't, and 0.75 for a task without an
estimate. The planner ranks tasks with the same score, comparing with the first planned day.

### Incremental sync: `GET /items?updated_after=&cursor=&include_deleted=1` (auth)

For tools that poll. With `updated_after` (an ISO time) the answer is the items changed after it,
oldest change first, `limit` at a time (the other filters work too):

```json
{
  "items": [],
  "deleted": [{ "id": "uuid", "deleted_at": "…" }],
  "next_cursor": "…",
  "has_more": false
}
```

Pass `next_cursor` back as `cursor` for the next page, and keep the last one to ask later for
what changed since (it's stable: an empty page gives the same cursor back). With
`include_deleted=1`, items deleted since are listed in `deleted` for whoever could see them when
they were deleted (the owner of a personal item, or the team's members); deleting a task lists
its subtasks too. Deletions are kept for 90 days. Only `team_id` filters `deleted`. An item moved
out of a team shows as changed to its new audience, not as deleted to the old one. Without
`updated_after` or `cursor`, `GET /items` pages by offset as before.

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
the version is stale. Planning fields you leave out keep their saved values. Moving it to another
space (a different `team_id`) takes it out of its project and stage. Completing a repeating task
moves it on to its next occurrence; only the sessions before the finished occurrence's deadline
are removed, so the next one's stay.

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

| Method and path                         | Body / result                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /admin/overview`                   | Counts of users, admins, disabled users, teams, items, open items, reminders                                                                                 |
| `GET /admin/users`                      | `?search=&limit=&offset=` → `{ rows: AdminUser[], total }`                                                                                                   |
| `PUT /admin/users/:id`                  | `{ "role"?: "admin" \| "member", "disabled"?: boolean, "email_verified"?: boolean }`; disabling signs them out; `email_verified` confirms an address by hand |
| `DELETE /admin/users/:id`               | `204`; their sole-owned teams pass to the next most senior member                                                                                            |
| `GET /admin/teams`                      | Every team with counts                                                                                                                                       |
| `GET /admin/audit`                      | `?limit=&offset=` → `{ rows: AuditEntry[], total }`, newest first                                                                                            |
| `GET /admin/database/tables`            | Public-schema table names, approximate row counts, sizes and comments; requires `system:manage`                                                              |
| `GET /admin/database/tables/:name`      | Columns, types, defaults, primary keys and indexes for one table; requires `system:manage`                                                                   |
| `GET /admin/database/tables/:name/rows` | Read-only, redacted 25-row preview; `?offset=0..10000`; requires `system:manage`                                                                             |

| `GET /admin/users/:id` | One account in full: sessions, sign-in methods, teams, counts, 30 days of activity and its audit history (never item contents) |
| `PUT /admin/users/:id/profile` | `{ "name"?, "email"? }`; a new email must be unused (`409`), and is unverified again when mail is set up |
| `POST /admin/users/:id/sign-out` | Ends every session → `{ ended }`; not for your own account (`409`) |
| `DELETE /admin/users/:id/sessions/:sid` | Ends one session → `204` |
| `POST /admin/users/:id/reset-link` | A one-hour, single-use password reset link to pass on → `{ link, expires_in_minutes, emailed }` (also emailed when mail is set up) |
| `POST /admin/users/:id/reset-2fa` | Clears two-step verification for someone locked out → `{ cleared }`; passkeys stay |
| `GET /admin/users/:id/export` | Everything the account holds, as `/me/export` gives it (a file download) |
| `GET /admin/requests/summary` | `?hours=1..168` → per service: requests, 4xx/5xx, p50/p95/max latency, copies; hourly timeline; slowest and failing routes. `requests:read` |
| `GET /admin/requests` | The request log, newest first: `?service=&status=2xx\|3xx\|4xx\|5xx&route=&user=&request_id=&slow=true&before=<id>&limit=` → `{ rows, more }` |
| `GET /admin/analytics` | `?days=7..365` → totals (active today/7/30 days, signups, items, tasks done, pages, AI requests, focus, bookings, reminders) and a daily series; `analytics:read` |
| `PUT /admin/announcement` | `{ "message", "tone": "info"\|"warning", "until"? }`; an empty message removes it. `system:manage` |
| `GET /admin/sweep` | What the sweeper keeps: each kind of record with its keep time, table size and the last run. `system:manage` |
| `PUT /admin/sweep/retention` | `{ "<rule>": days }`; 0 keeps forever; below a rule's minimum is `422` |
| `POST /admin/sweep/run` | Sweeps now → the same view with the result; `409` while another sweep runs |

Every account action is confirmed in the apps and written to the audit log with who did it.

`GET /announcement` is public: the admins' notice (`{ message, tone, until, updated_at }`) or
`null` once removed or past `until`. The apps show it at the top until dismissed.

**Request tracing.** Every service records the requests it answers, batched every two seconds off
the request path: the matched route pattern (never the raw URL), status, duration, service and
copy, the gateway's `X-Request-Id` (echoed on every response, so an error a person reports can be
found by its id) and who asked. No IP addresses. `REQUEST_LOG_SAMPLE` (0–1, default 1) keeps a
share of ordinary requests; errors and requests over a second are always kept. Health probes and
live streams are left out. Daily roll-ups per route (`request_daily`) and per person
(`daily_activity`) keep the long view for analytics.

**The sweeper.** The worker clears outdated records hourly, a few thousand rows at a time, under an
advisory lock so one copy sweeps: request traces (7 days), status checks (90), finished reminders
(90), webhook deliveries (30), deletion records (90), expired plan drafts (7), old presence (30),
the audit log (730), daily roll-ups (400), and always expired sessions, email links, passkey
challenges, assistant proposals and jobs, and replay keys. Page history and project timelines are
kept forever unless an admin sets a keep time.

The last active admin cannot be demoted, disabled, or deleted (`409`), and admins cannot delete
their own account here.

The database explorer does not accept SQL or mutations. It masks private content,
password hashes, tokens and other secrets in row previews; only operational
identifiers, states and timestamps plus fields already visible in the admin
console are shown. Table structure and indexes remain visible to help diagnose
schema and migration issues.

### Task progress

`status` is `todo`, `in_progress`, `blocked`, `done` or `cancelled` (see
[Done or cancelled](#items)), and `progress` is 0 to 100. List
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
task done sets progress to 100; reopening it re-arms its reminder. A `status` sent with an update
is saved the same way as `PUT /items/:id`: a finished task's future sessions are removed, a
repeating task moves on to its next occurrence (keeping the sessions planned for it, and saying so
in its timeline), and `item.updated` and `item.completed` webhooks fire. Steps, notes and progress
do not change the item's `version`, so an open editor never conflicts because of them (a status
change does, like any edit), and `PUT /items/:id` without `progress` keeps the saved value.
Viewers can read steps and updates but not change them.

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

| `kind`        | About                                                                   | `ref`               | Suggested action |
| ------------- | ----------------------------------------------------------------------- | ------------------- | ---------------- |
| `reminder`    | An item's reminder; the due time is in your planner time zone           | the alert (minutes) | Open the item    |
| `rsvp`        | Someone you invited answered (one notice per person, updated)           | the attendee        | Open the event   |
| `conflict`    | An event now overlaps a future session                                  | the session         | Reschedule       |
| `booking`     | A booking was made, requested, moved or cancelled                       | the booking         | Open the booking |
| `rollforward` | Sessions from earlier days are unfinished (from your working start)     | the local date      | Roll forward     |
| `at_risk`     | A task's remaining estimate is more than the free time before it's due  | the local date      | Plan it          |
| `deadline`    | A task is due within `deadline_notice_days` and isn't planned before it | the local date      | Plan it          |

Planner notices (`conflict`, `rollforward`, `at_risk`, `deadline`) come at most once a day per
task (once per block for conflicts, once per day for roll-forward). They also go to push and email
as your `planner_notices` preference says (push on and email off by default; email needs SMTP).

All three planning notices follow one rule: **only time that ends by the deadline counts as
planned** (see [Sessions and deadlines](#planner)). A session after the deadline never silences
them: the due-soon notice then says "…but its session ends after the deadline. Plan it?", or
"…and 1 h of it isn't planned before then" when only part is planned. Once a deadline has passed,
sessions still to come are catch-up time: they keep that work from rolling forward again.

### `POST /notifications/:id/read` (auth)

→ `204`

### Booking pages — assignment

Round-robin pages also take `routing`: `[{ question_id, equals, host_user_id }]` — when a booking's answer to that question equals the value, that host is preferred (if free at the slot), otherwise the fair pick still applies. Booking pages take `assignment`: `"collective"` (default — a time is offered only when every required host is free, and it goes on all their calendars) or `"round_robin"` (a time is offered when any host is free, and each booking goes to the host with the fewest so far; `bookings.assigned_user_id` records who). Set it on `POST`/`PUT /booking-pages`.

## Model Context Protocol (MCP)

`POST /mcp` is a small MCP server (JSON-RPC 2.0 over HTTP) so a person's own AI tools — Claude, Cursor, ChatGPT — can act on their planner. Authenticate with a personal API key as the `Authorization: Bearer ok_…` header. Point the client at `<APP_URL>/api/mcp`.

Handled methods: `initialize`, `ping`, `tools/list`, `tools/call`. Tools: `search_items` (query, limit?), `add_task` (title, notes?, due_at?, priority?), `get_agenda` (days?). Notifications (no `id`) get `202` with no body. Everything runs as the key's owner, with the same access their API key has.

## AI assistant

### `PUT /planner/prefs` — daily digest

Planner preferences now include `digest`: `{ "morning": bool, "evening": bool, "morning_time": "HH:MM", "evening_time": "HH:MM" }`. Both digests are **off by default**. When a mail server is configured, the worker emails each enabled digest once a day at its local time — a morning agenda (today's events, due tasks, set-aside time, habits, at-risk warnings) and an evening review (what's still open, tomorrow's start).

### `GET /planner/analytics` (auth)

`?days=` (default 30). Where your set-aside time went: `{ from, to, days, planned_minutes, completed, by_list: [{name, minutes}], by_tag: [{name, minutes}] }`, from your own sessions and finished tasks. Private to you.

### `GET /planner/estimates` (auth)

What the planner has learned about how long tasks really take: `{ overall: { ratio, samples, range }, tags: [{ tag_id, name, ratio, samples }], lists: [{ list_id, name, ratio, samples }], typical_minutes, applied }`. `ratio` is actual ÷ estimated over finished tasks with time logged, averaged in log space, weighted towards recent tasks (45-day half-life) and shrunk towards 1 while there are few of them (clamped 0.5–3; held at 1 below 3 samples). `range` is the middle half of how tasks go (a quarter run shorter, a quarter longer). Tags and lists (3 or more tasks) shrink towards the overall ratio. `typical_minutes` is how long a task usually takes you (from 5 finished tasks). With `learn_estimates` on in planner prefs, the planner scales each task's estimate by its tags' and list's ratios, weighted by how many tasks each rests on, else the overall one, and plans a task with no estimate from finished tasks with similar titles, else its list's or tag's usual length, else `typical_minutes`. The stored estimate is never changed.

### `GET /planner/learning` (auth)

Everything the planner has learned from your own history (nothing is stored; it's worked out
from your tasks, blocks and focus sessions each time):

```json
{
  "estimates": {
    "overall": { "ratio": 1.3, "samples": 14, "range": [1.1, 1.6] },
    "tags": [],
    "lists": [],
    "typical_minutes": 45,
    "applied": false
  },
  "rhythm": {
    "hours": [0, 0, "…24 values, -1 to 1"],
    "confidence": 0.8,
    "evidence_minutes": 960,
    "peak": { "start_hour": 10, "end_hour": 12 },
    "applied": true
  },
  "load": {
    "typical_day_minutes": 210,
    "follow_through": 0.72,
    "days": 12,
    "applied": true
  }
}
```

`rhythm.hours[h]` is how the local hour `h` usually goes, from -1 (time planned then usually
slips) to 1 (usually goes into the work, where focus sessions cluster), learned from the last 8
weeks of blocks and focus sessions and smoothed towards your own average; `confidence` (0–1)
grows with evidence, and `peak` names the best two hours once there's enough. `load` is the
upper quartile of planned time you got through per day (from 5 days with at least an hour
planned; never below 2 hours) and the share of planned time done. `applied` follows the prefs
`learn_estimates`, `learn_rhythm` and `balance_load`.

### `GET /planner/next` (auth)

What to do now: `{ at, window, suggestions }`. `window` is the free time from now to the next
event (or the end of the working day), `{ start_at, end_at, minutes, until }` with `until` the
event's title (null for the end of the day); null during an event or outside working hours.
`suggestions` holds up to three open tasks: `{ item_id, title, due_at, priority, minutes,
reasons, planned_now }`. A task with a block right now comes first (`planned_now`); then the
priority score, lifted for a task that fits the window, a demanding task at an hour that usually
goes well for you, and one that keeps slipping (two or more past blocks that mostly didn't go into
it: `minutes` is then at most 25). `reasons` are short sentences, most important first
("Due today, 17:00", "Fits the 45 min before Standup", "Your focus usually goes well around now",
"Planned 3 times without getting done: try 25 minutes of it").

### `POST /planner/digest/test` (auth)

`{ "kind": "morning" | "evening" }` (default `morning`). Emails you that digest now from your live data, to preview it. → `204`; `503` when no mail server is set up.

### `POST /ai/project` (auth, 10/min)

`{ "prompt", "timezone", "team_id"? }`. With `team_id` (you need write access to that team) the project and its tasks become the team's once approved. Drafts a project from the prompt: the AI provider returns a title and a set of subtasks with estimates and due-date offsets, which come back as a **proposal** (`{ id, summary, actions }`) — the same shape as `/ai/chat`, nothing saved until `POST /ai/proposals/:id/apply`. `502` if the provider fails or returns an unreadable plan, `503` when no provider is set up.

### `POST /ai/chat/start` (auth, 10/min)

Starts an assistant turn and returns `202 { "id": "job uuid" }` at once. The body is the same as
`POST /ai/chat` below. The turn runs on the server for as long as the model needs (up to ten
minutes), so a proxy's limit on one request (Cloudflare gives an origin 100 seconds) never cuts
it off. Returns `503` when no provider is set up.

### `GET /ai/chat/:id` (auth)

The turn's state, for polling every second or two:

```json
{ "state": "running" }
{ "state": "done", "proposal": { "...": "the POST /ai/chat reply" } }
{ "state": "failed", "status": 502, "message": "The AI provider could not answer. Please try again." }
```

`status` and `message` are what `POST /ai/chat` would have answered with. A turn whose server copy
stopped mid-way (a deploy) is reported as `failed` with status `503`. Only the user who started a
turn can read it; turns are kept for a day. The apps use start + poll; `POST /ai/chat` remains for
scripts that prefer one request.

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

## Calendar and sessions

### `GET /calendar?from=&to=` (auth)

At most 62 days. → `{ from, to, timezone, entries, blocks, derived }`:

- `entries`: one per occurrence of every dated item you can see. Repeating items appear once per
  occurrence with `occurrence` set, and `overridden: true` on one changed on its own. Each also
  has `all_day`, `busy` (false for free events, all-day items and tasks), `color`, `alerts` and
  `attendee_count`.
- `blocks`: your sessions, with their task's title and status, and what each is for (see
  [Sessions](#sessions-blocks)).
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

### Sessions (`/blocks`)

A session is time planned for working on a task; the API calls it a block. Each person has their
own. Moving, rescheduling or deleting one sends `block.updated` or `block.deleted` to your
webhooks and refreshes your other devices, like any other change.

**Due means the deadline.** A task is due at its due time; a task with an end time (drawn as a
span) is due when it ends; an all-day task is due at the end of its day (its `due_at` is the
local midnight it starts), so sessions on the day itself are on time. Planned time and the
deadline stay separate: the planner never moves a deadline. Every "is this after the
deadline?" check, in the planner, the at-risk and due-soon notices, the priority `score`, the
apps' "Overdue", "due today" and due filters (task lists, Overview, Today and the widget
glance), the daily agenda's "Due today" and "Carried over", the project timeline, the
welcome-back brief, the assistant's ranking and overview counts, the team workload's at-risk
check and the fields below, uses this rule (`deadlineOf` in `@orbyn/core`). Lists put a task
under the day its deadline falls on (`dueDayAt`): an all-day task over several days under its
last day, a span under the day it ends. A task is overdue once that day is before today
(`dueBeforeToday`), so one due earlier today isn't yet. The task panels and Focus mode say "Due
Fri 2 Oct, 5 pm" (`dueLine`); list lines (Tasks to place, plans, the team's at-risk list) say
"due Fri 2 Oct, 5 pm", or "due Fri 2 Oct" for a whole day (`dueDateOf`).

Sessions from `GET /blocks`, `GET /calendar`, `GET /items/:id/sessions`, the answers of the
routes below and the `block.*` webhooks carry, besides the session and its task's `title`,
`status`, `kind`, `priority`, `team_id`, `list_id` and `estimate_minutes`:

| Field            | Meaning                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `due_at`         | When the task is due, as it shows it; null without a date. For a repeating task, the occurrence this session is for: the first one whose deadline it ends by, so time after one occurrence's deadline is for the next |
| `due_all_day`    | That due date is a whole day (due by the end of it)                                                                                                                                                                   |
| `deadline_at`    | The moment it's due by, by the rule above                                                                                                                                                                             |
| `after_deadline` | The session ends after `deadline_at`                                                                                                                                                                                  |
| `part`, `parts`  | "Session 2 of 3": its number among all of your sessions for the task (past ones too; for a repeating task, those for the same occurrence), in time order                                                              |
| `project_id`     | The task's project, or null                                                                                                                                                                                           |

| Method and path               | Body / result                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /blocks?from=&to=`       | Your sessions in the range                                                                                                                                                                                                                                                                                                                      |
| `GET /items/:id/sessions`     | One task's sessions (yours), below. Reading them never makes a plan. `404` when you can't see the task                                                                                                                                                                                                                                          |
| `POST /blocks`                | `{ "item_id", "start_at", "end_at" }` (a task you can see; at most 24 hours)                                                                                                                                                                                                                                                                    |
| `PUT /blocks/:id`             | `{ "start_at", "end_at" }`. The session counts as placed by hand from then on (`source: "manual"`)                                                                                                                                                                                                                                              |
| `DELETE /blocks/:id`          | `204`; `404` when the session isn't yours                                                                                                                                                                                                                                                                                                       |
| `POST /blocks/:id/reschedule` | `{ "before_deadline"? }` → moves it to your next free working time of the same length, one that ends by its task's deadline when there is one (it looks up to a month ahead for that). With `before_deadline: true` only such a time will do: `409` when there's none, or the deadline has passed. Otherwise `409` if nothing is free in 7 days |
| `POST /blocks/:id/duplicate`  | `{ "start_at"? }` → `201` a new block for the same task and length, at `start_at` or the next free working time after the original; `409` if the task is done or nothing is free in 7 days                                                                                                                                                      |

`GET /items/:id/sessions` → `{ item_id, due_at, due_all_day, deadline_at, project_deadline,
sessions, planned_minutes, late_minutes, fit }`: your sessions for the task, oldest first, past ones
too (for a repeating task, those for its current occurrence and later ones);
`planned_minutes` is the time still to come in sessions that end by the deadline (all of it
without one), and `late_minutes` the time still to come in sessions that end after it.
`project_deadline` is the deadline of the task's project, a latest date for its tasks that never
becomes the task's own.

**Does it fit?** `fit` is the task's one status against its deadline (`deadlineFit` in
`@orbyn/core`), or null for a finished task or one that isn't yours to plan (a teammate's, when
you have no sessions for it):

```json
{
  "status": "late_session",
  "label": "Session after the deadline",
  "needed_minutes": 120,
  "planned_minutes": 60,
  "late_minutes": 60,
  "short_minutes": 60,
  "free_minutes": 300,
  "deadline_at": "2026-10-02T07:00:00.000Z"
}
```

| `status`       | `label`                    | When                                                                        |
| -------------- | -------------------------- | --------------------------------------------------------------------------- |
| `on_track`     | On track                   | What it still needs is planned before the deadline                          |
| `short`        | Short 2h                   | Some of it is planned before the deadline, not all                          |
| `late_session` | Session after the deadline | A session falls after the deadline, and that time is missing before it      |
| `unplanned`    | Nothing planned            | No time before the deadline                                                 |
| `at_risk`      | At risk                    | There isn't enough free working time before the deadline for what's missing |
| `overdue`      | Deadline passed            | The deadline has passed; sessions still to come count as catch-up time      |
| `no_deadline`  | No deadline                | Nothing to measure against                                                  |

`needed_minutes` is the estimate minus the time logged (a past session isn't assumed done; a
parent adds up its subtasks). Only time still to come that ends by the deadline counts in
`planned_minutes` (for a repeating task, a session after this occurrence's deadline counts toward
the next one). Without an estimate a task counts as 30 minutes, a guess, so `short` is only said
within a week of the deadline. `free_minutes` (working hours less your events, up to two weeks
ahead) is looked up only when the task is short and due within two weeks; otherwise null. The
apps show the status on a task's Sessions card; task rows show it only within a week of the
deadline or when a session falls after it (`fitChipShown`).

## Planner

| Method and path                                              | Body / result                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /planner/prefs`, `PUT /planner/prefs`                   | Time zone, working days and hours, padding, splitting, breaks, buffers, travel, extra time zones, calendar sets, pinned people                                                                                                           |
| `GET/POST /planner/frames`, `PUT/DELETE /planner/frames/:id` | Recurring windows for kinds of work, with task filters (below)                                                                                                                                                                           |
| `POST /planner/frames/:id/skip` · `/unskip`                  | `{ "date": "YYYY-MM-DD" }` skips one date of a frame, or brings it back → the frame                                                                                                                                                      |
| `GET/POST /planner/places`, `PUT/DELETE /planner/places/:id` | Places (`label`, `match` text in a location, `travel_minutes`, `mode`, `peak_minutes`)                                                                                                                                                   |
| `POST /planner/preview`                                      | A plan (below). Nothing is saved.                                                                                                                                                                                                        |
| `GET /planner/plans/:id`                                     | A plan you made in the last hour                                                                                                                                                                                                         |
| `PATCH /planner/plans/:id`                                   | Tune a plan (below) → a new plan that replaces it; `409` if it was applied, replaced or expired                                                                                                                                          |
| `GET /planner/plans/:id/stale`                               | `{ "stale" }`: true when the calendar, frames, hours or tasks changed since it was made, or it expired or was replaced                                                                                                                   |
| `POST /planner/plans/:id/apply`                              | `{ "moves"? }` → saves its blocks and moves the late sessions named (below) → `{ blocks, skipped, moved, moves_skipped }`; `409` if already applied, expired, or there's nothing to add or move; `422` for a move the plan doesn't offer |
| `GET /planner/review`                                        | `{ unfinished, at_risk, conflicts }`; an `at_risk` task has its `deadline_at`, and `due_all_day: true` when due on a whole day                                                                                                           |
| `POST /planner/roll-forward`                                 | `{ "block_ids"? }` → a plan for unfinished work                                                                                                                                                                                          |

Planner preferences also hold `deadline_notice_days` (0 to 14, default 1; 0 turns due-soon
notices off), `planner_notices` (`{ "push": true, "email": false }`; send either key to change
it) and `default_alerts` (`{ "event": [30], "task": [30], "all_day": [30] }`, the alerts new items
get; send any key to change it), `count_blocks_as_spent` (default false; see
[Blocks as time spent](#items)), `buffer_scope` and `travel_padding_minutes`, and three learning switches: `learn_estimates`
(default false), `learn_rhythm` (default true: put demanding work in the hours that usually go
well) and `balance_load` (default true: spread plans over several days so no day asks much more
than you usually get through). The last two do nothing until there's enough history; see
[`GET /planner/learning`](#get-plannerlearning-auth).

**Which events get buffers** (`buffer_scope`, replaced as a whole when sent):
`{ "personal": true, "team_ids": null, "list_ids": [], "min_minutes": 0, "only_with_others": false }`
by default, so every timed busy event gets them. `personal: false` leaves out your personal
events; `team_ids` lists the teams whose events get them (null: all your teams; empty: none); a
non-empty `list_ids` keeps only events in those lists; `min_minutes` skips shorter events; and
`only_with_others` keeps only meetings: events with people invited, a meeting link, or a team.
The scope decides buffers only; travel goes before any located event.

**Travel.** A place's `mode` (`walk`, `cycle`, `transit` or `drive`, or null) is a label only;
there's no routing service. `peak_minutes` (null: the same as usual) is used for a leg that, at its
usual length, touches 07:00–09:00 or 16:00–18:00 on a weekday in your planner zone (the leg there
ends at the event's start; the leg back starts after it and its buffer). `travel_padding_minutes`
(0 to 30, default 0) is added to every leg.

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
  "unplaced": [
    {
      "item_id": "uuid",
      "title": "Tax return",
      "due_at": "2026-09-15T14:00:00.000Z",
      "deadline_at": "2026-09-16T14:00:00.000Z",
      "due_all_day": true,
      "reason": "Not enough free time in the days planned."
    }
  ],
  "at_risk": [],
  "capacity_minutes": 420,
  "planned_minutes": 150,
  "applied": false,
  "expires_at": "…",
  "summary": "2 tasks in 3 blocks over 1 day, using 2 h 30 min of 7 h free."
}
```

The planner considers your open personal tasks and team tasks assigned to you (or exactly the
`item_ids` you name). Tasks without an estimate count as 30 minutes. A block's `part` and `parts`
count the sessions the task already has too, the way they'll be numbered once saved, so "Session
3 of 4" in a preview is session 3 of 4 on the calendar.

**Only time before the deadline counts.** A task's sessions that end after its deadline don't
count as time set aside, so the planner still plans for that time. It first offers to move each
late session that hasn't started to free time before the deadline, in `moves`:

```json
"moves": [
  {
    "block_id": "uuid",
    "item_id": "uuid",
    "title": "Quarterly report",
    "from_start_at": "2026-10-03T00:00:00.000Z",
    "from_end_at": "2026-10-03T01:00:00.000Z",
    "start_at": "2026-09-30T06:00:00.000Z",
    "end_at": "2026-09-30T07:00:00.000Z",
    "deadline_at": "2026-10-02T07:00:00.000Z",
    "due_all_day": false,
    "source": "planner",
    "selected": true
  }
]
```

Sessions the planner made are ticked (`selected: true`); sessions you placed by hand (or moved by
hand) are offered unticked. A moved session covers its own length; only what's still missing
becomes new blocks, so a plan may hold only moves. A late session that can't fit before the
deadline stays where it is, and the task is `at_risk` with `remaining_minutes` and `free_minutes`
and the same words as the daily notice ("Needs 2 h more, with 45 min free before it's due.").
New time goes before the deadline first; the time a late session that stays already holds is never
added again after the deadline, so planning again doesn't pile up late sessions.
Nothing is refused and deadlines never move. Once a deadline has passed, time found is catch-up:
nothing is moved or flagged.

`POST /planner/plans/:id/apply` takes `{ "moves": ["<block id>", …] }`, the sessions to move
(the ticked ones when omitted; `[]` moves none). Each is checked again first: it must still be
yours, unchanged since the plan was made, its task open and the new time free; otherwise it's
counted in `moves_skipped` and left where it is. `moved` lists the sessions moved, as `GET
/blocks` returns them; each also sends `block.updated`. Moves never count as slips.

Plans also carry `options` (what the plan was made with: `start_date`, `days`, `pad_percent`,
`split`, `break_level`, `use_frames`, `timezone`, `scope`, `keep_free`, `item_ids`,
`include_item_ids`, `exclude_item_ids`, `estimates`, `pinned_blocks`), `superseded_by`,
`estimates_saved`, and `tasks`, a checklist of every task considered: `{ item_id, title, due_at,
deadline_at, due_all_day, priority, team_id, list_id, estimate_minutes, estimate_tuned, included,
planned_minutes, moved_minutes, reason, at_risk, fit, estimate_guess }`, where `deadline_at` is the moment the task is
due by (the end of its day when `due_all_day` is true, its end time when it has one; null without
a date), `reason` says why a task wasn't (fully) planned or was left out and `estimate_guess`
(`{ minutes, basis }`, basis `similar`, `list`, `tag` or `typical`) is set when a task with no
estimate was planned for a learned length. `planned_minutes` includes the sessions the plan
offers to move (`moved_minutes`), and `fit` is the task's status once the plan is applied as
proposed (ticked moves in). `unplaced` and `at_risk` rows (`{ item_id, title,
due_at, reason }`) carry `deadline_at` and `due_all_day` too, and `at_risk` rows
`remaining_minutes` and `free_minutes`; a plan saved before they were added
may leave them out, so name `due_at` then. Blocks are placed at the best time
rather than simply the earliest (see [Planning in the architecture notes](architecture.md#planning)),
and `summary` says so when learning moved something ("Thesis chapter is in your best hours
(10:00–12:00).") or a day asks for more than you usually get through.

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
`{ id, title, assignee_id, assignee_name, due_at, deadline_at, due_all_day, remaining_minutes }`.
"Due" is the deadline, as everywhere: only free time before `deadline_at` (the end of the day for
an all-day task, when it ends for a task with an end time) counts, and the list is in deadline
order.

| Method and path                                        | Result                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /teams/:id/availability?from=&to=`                | Each member's working hours and busy intervals                                                         |
| `GET /teams/:id/workload?from=&to=`                    | Capacity, assigned estimates, load, `overloaded`, `at_risk` and `at_risk_items` per member             |
| `GET /teams/:id/suggest?from=&to=&duration=&user_ids=` | Up to 20 times everyone chosen is free; `disruption` counts people whose focus time a slot would split |

## Booking pages

| Method and path                                       | Who            | Body / result                                                                                                      |
| ----------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /booking-pages`                                  | signed in      | Pages you own or host and your teams' pages, each with `counts` (`upcoming`, `needs_approval`) and `can_edit`      |
| `POST /booking-pages`                                 | signed in      | The page (see below) and `co_hosts` (from your teams) → `201`; `409` if the slug is taken                          |
| `PUT/DELETE /booking-pages/:id`                       | owner          | Change any of the same fields, or delete (a team page: its owner, or the team's owners and admins)                 |
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
`allow_reschedule`, `color`, `event_title` (with `{page}`, `{name}`, `{email}`),
`confirmation_message`, `team_id` and `remind_before_minutes`.

**Team pages.** A page with a `team_id` belongs to the team: its owners and admins create, edit and
delete it (`403` for members making one, `404` for them editing), every member sees it in their
list (`can_edit` says who can change it), and its hosts must be members of the team. Owners,
admins and hosts see and act on its bookings. A page moves into a team when an owner or admin of
that team saves it with the `team_id`, and back to its owner with `team_id: null` (the owner
only). Pages without a team work as before.

**Reminders for bookers.** `remind_before_minutes` (up to 3 values, 10 to 10080; a day and an hour
before by default) emails the booker before a confirmed booking, with its manage link. Each value
goes once per booking and start time (a moved booking is reminded again for its new time), only
the latest one due is sent when several are, none whose time had passed when it was booked, and
none at all without SMTP or once the booking is cancelled or declined. They go through the
notifier's email lane (`kind: "booker_reminder"`, never in the app). Open invites have the same
setting.

Free slots are the page's hours that every required host has free (events, buffers, travel, time
blocks and busy frames count as busy), minus bookings still held, keeping the page's buffers either side, its
notice and its limits. Start times step by the interval from local midnight. With SMTP set up a
booking waits for its email link (the time is held for 30 minutes); without it, it goes straight
on. Pages that need approval then hold the time until a host approves or declines, or until it
starts. A confirmed booking adds an event to every host's calendar; every step lands on the
booking's timeline, and hosts get in-app notices (`kind: "booking"`, `ref` = the booking) for new,
requested, moved and cancelled bookings.

**Public pages.** API responses for `/book/*`, `/invite/*`, `/u/*` and `/rsvp/*` carry
`X-Robots-Tag: noindex, nofollow`. The web app's pages at those paths can be embedded in other
sites (`Content-Security-Policy: frame-ancestors *`, no `X-Frame-Options`); every other page keeps
`X-Frame-Options: DENY`.

### Open invites

A one-off private link offering hand-picked windows. The person it's sent to picks a free time
inside them and it's booked at once (no email check: the link went to someone you chose). Every
host (you and any co-hosts) must be free; their busy time, frames marked busy and bookings still
held count, and start times fall on the quarter hour in your planner zone. The booker gets the
usual confirmation and manage link and can move the booking, but only within the same windows.
If they cancel, the invite opens again while it lasts; if you cancel, it's withdrawn.

| Method and path            | Who            | Body / result                                                                                                                                                   |
| -------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /open-invites`        | signed in      | Your invites, newest first                                                                                                                                      |
| `POST /open-invites`       | signed in      | `{ title, duration, windows: [{ start_at, end_at }], location?, meeting_url?, co_host_ids?, expires_at?, remind_before_minutes? }` → `201` invite               |
| `GET /open-invites/:id`    | owner          | One invite                                                                                                                                                      |
| `DELETE /open-invites/:id` | owner          | Withdraw it → `204`; a booking made from it is cancelled and the booker told; `409` once it has been used                                                       |
| `GET /invite/:token`       | anyone         | `?timezone=` → `{ title, hosts, duration, location, has_meeting_link, status, expires_at, timezone, slots }` (slots only while open); `404` for an unknown link |
| `POST /invite/:token`      | anyone, 10/min | `{ start_at, name, email, note?, timezone? }` → `201` receipt; `409` if the time isn't free or it was already used, `410` if it expired or was withdrawn        |

Windows: 1 to 20, each ending after it starts, the last within 90 days, at least one long enough
for the meeting; those already over are dropped (`422` when none is left). Co-hosts (up to 10)
share a team with you. An invite: `{ id, title, duration, windows, location, meeting_url, co_hosts,
remind_before_minutes, status, expires_at, url, booking, created_at }`, where `status` is `open`,
`booked`, `expired` (at `expires_at`, the end of the last window at the latest) or `cancelled`,
`url` is the link to send and `booking` the booking made from it. Bookings from invites show in
the host's bookings inbox with `invite_id` set and `page_id` null; their webhooks carry
`invite_id` and `page: null`.

### Profile page

| Method and path   | Who       | Body / result                                                                                                                       |
| ----------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/profile` | signed in | `{ handle, bio, url }`                                                                                                              |
| `PUT /me/profile` | signed in | `{ handle?, bio? }` (`handle: null` removes the page) → the profile; `409` if the handle is taken                                   |
| `GET /u/:handle`  | anyone    | `{ name, handle, bio, pages: [{ title, slug, description, durations, color }] }`: the active pages you own or host; `404` otherwise |

A handle is 3 to 40 lowercase letters, numbers and single dashes (saved lowercase), and can't be
one of the web app's own paths (`book`, `invite`, `u`, `rsvp`, `admin`, `api`, `settings` and a
few more). A bio is up to 300 characters. `GET /me` also carries `handle` and `bio`.

## API keys, webhooks and the calendar feed

Other tools reach Orbyn through these; nothing is synced out of this server.

| Method and path                               | Body / result                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /me/api-keys`                            | Your keys (name, prefix, last used)                                                                       |
| `POST /me/api-keys`                           | `{ "name" }` → `201` with `key` (shown once; send it as `Authorization: Bearer ok_…`)                     |
| `DELETE /me/api-keys/:id`                     | `204`                                                                                                     |
| `GET /me/webhooks`                            | Your webhooks with their last delivery status                                                             |
| `POST /me/webhooks`                           | `{ "url", "events", "lead_minutes"? }` → `201` with `secret` (shown once)                                 |
| `PUT /me/webhooks/:id`                        | `{ "url"?, "events"?, "active"?, "lead_minutes"? }`                                                       |
| `DELETE /me/webhooks/:id`                     | `204`                                                                                                     |
| `POST /me/webhooks/:id/test`                  | Sends a `ping` now → `{ ok, status, error }`                                                              |
| `GET /me/calendar-feed`                       | `{ enabled, busy_enabled, include_blocks }`                                                               |
| `PUT /me/calendar-feed`                       | `{ "include_blocks" }`: add your sessions as "Focus: {task}"                                              |
| `POST /me/calendar-feed`                      | Creates or replaces your private feed link → `{ url, busy }`; `{ "busy": true }` makes the busy-only link |
| `DELETE /me/calendar-feed`                    | Turns the feed off; `?busy=1` turns the busy-only link off                                                |
| `GET /calendar/feed/:token.ics`               | The feed, as iCalendar, for other calendar apps to subscribe to (`?busy=1` for busy only)                 |
| `GET /me/calendar-subscriptions`              | Calendars you subscribe to by link, with their settings, `last_fetched_at`, `last_error`, `event_count`   |
| `POST /me/calendar-subscriptions`             | `{ "url", "name", "color"?, "kind"?, settings… }` → `201`, read at once; `422` private address, `409` >20 |
| `PUT/DELETE /me/calendar-subscriptions/:id`   | Change `url`, `name`, `color`, `kind` or any setting; or remove it and its events                         |
| `POST /me/calendar-subscriptions/:id/refresh` | Fetch it now (10/min) → the subscription                                                                  |
| `GET /rsvp/:token`                            | Anyone with the link: the invitation (see below)                                                          |
| `POST /rsvp/:token`                           | Anyone with the link, 10/min: `{ "status": "accepted" \| "declined" \| "tentative" }`                     |

### Subscribed calendars

A subscription has a `kind` — `classes`, `exams`, `work`, `meetings`, `holidays` or `other` — which
sets its defaults when it's added (`CALENDAR_KIND_DEFAULTS` in `packages/core/src/calendar-kinds.ts`);
anything sent explicitly wins, and every setting can be changed later:

| Setting            | Meaning                                                                                 | Default                             |
| ------------------ | --------------------------------------------------------------------------------------- | ----------------------------------- |
| `busy`             | Its timed events count as busy (planner, booking pages, teammates)                      | on, except `holidays`               |
| `all_day_busy`     | Its all-day events block the whole day (when `busy`)                                    | on for `exams`                      |
| `visible`          | Shown on your calendar, in search and in agendas; hidden ones still count as busy       | on                                  |
| `sharing`          | `busy`: teammates and your busy-only feed see when; `hidden`: they see nothing          | `busy`                              |
| `reminder_minutes` | A reminder (in the app, push, and email if on) this long before each event; `null` none | 1440 for `exams`, 10 for `meetings` |

A subscription is read as soon as it's added and hourly after. A feed whose text hasn't changed
isn't rewritten (most feeds, Google's included, send no ETag); a changed one tells your open apps
(`changed` on `/events`). Changing your time zone reads every subscription again. The reader
handles the calendar's own `X-WR-TIMEZONE`, monthly "2nd Tuesday" / "last Friday" rules, `RDATE`,
and `RANGE=THISANDFUTURE` changes.

Subscribed events reach every part of Orbyn that reads your day: busy time (planner, booking
pages, team availability and capacity, the busy-only feed — times only, never titles), the clash
review and clash notices, the morning and evening digests, the assistant's `get_calendar` tool,
MCP `get_agenda`, and the iOS widget and Watch "next event". Calendar sets can include or leave
out each subscription (`subscription_ids`; missing means all). They are never re-exported in your
own feed or CalDAV, which would duplicate them in the apps they came from.

API keys act as you, except in the admin console (and count against their own rate limit). Webhook
events: `item.created`, `item.updated`, `item.completed`, `item.deleted` (once for each subtask
too), `block.scheduled`, `booking.requested`, `booking.confirmed`, `booking.rescheduled`,
`booking.cancelled`, and three the notifier sends on a schedule, each at most once per webhook:

- `event.starting`: `lead_minutes` (0 to 120, default 15, per webhook) before each busy event
  you can see (team events too; not free, all-day or closed ones), once per occurrence and again
  if it's moved. `data`: `item_id`, `title`, `start_at`, `end_at`, `occurrence`, `location`,
  `meeting_url`, `team_id`, `lead_minutes`.
- `block.started`: when one of your sessions starts. `data`: `id`, `item_id`, `title`,
  `start_at`, `end_at`.
- `task.at_risk`: with the planner's at-risk notice, at most once a day per task. `data`:
  `item_id`, `title`, `due_at`, `deadline_at` (the moment it's due by), `remaining_minutes`,
  `free_minutes`, `reason`.

Sessions also send `block.updated` when one is moved, resized or rescheduled (`data`: the
session, as `GET /blocks` returns it, with its deadline and number) and `block.deleted` when one
is removed (`data`: `id`, `item_id`, `start_at`, `end_at`). `block.scheduled` carries the new
sessions the same way.

The notifier looks for starting events and sessions every minute, so a delivery can come up to a
minute late; one that started up to 5 minutes ago still goes.
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

### `GET /teams/:id/analytics` (auth, owners/admins)

`?days=` (default 30). Set-aside time on the team's items, per member, with completed counts and a team total — aggregates only, never item titles. Owners and admins only.

## CalDAV

`/dav/` is a CalDAV server so Apple Calendar, Thunderbird and DAVx5 can subscribe to a person's events natively — and, for events (`VEVENT`), create, edit and delete them back. Clients authenticate with **HTTP Basic**, username = your email, password = a **personal API key** (`ok_…`). Point the client at `<APP_URL>/dav/` (or the well-known `/.well-known/caldav`).

- `PROPFIND`, `REPORT`, `GET` read the calendar and its events.
- `PUT` an `.ics` (one `VEVENT`) creates or replaces an event; the client's `UID` becomes the resource's href, so later edits map back to it. → `201` on create, `204` on replace. An unreadable body is `400`.
- `DELETE` removes an event (`204`; `404` when it's already gone).
- Making or renaming calendars (`MKCALENDAR`, `PROPPATCH`) is refused (`403`) — there's one calendar per person.

Tasks and other kinds are read-only over CalDAV; only events accept writes. Real-client interop (Apple Calendar, Thunderbird, DAVx5) is verified by hand.

## Repeats and habits in quick add

`POST /items/quick` also reads repeats: "every weekday at 9am", "every other Friday", "the first
Tuesday of every month", "until December", "for 6 weeks", "10 times". A repeat with a clock time
(or on set days of the month) makes a repeating item with an `rrule`. One that says how often but
not when — "3 times a week", "read 20 minutes every day" — makes a habit instead: the answer is
`{ "item": null, "habit": {…}, "chips": […] }`, and a `preview` carries `habit`. Email-to-task
never makes habits.

## Focus sessions

### `POST /focus/sessions` (auth)

One finished (or cut short) phase: `{ id, item_id, kind: "work"|"short_break"|"long_break",
started_at, ended_at, planned_minutes, minutes, completed }`. `id` is made on the device: sending
the same session again answers `200` with the first one and logs nothing twice. Work minutes are
added to the task's time spent (`items:write` on it). → `{ session, item }`.

### `GET /focus/summary?from=&to=` (auth)

Up to three months: work minutes, sessions finished and cut short, breaks taken, minutes by day
(in your planner's zone) and by task, and the 20 newest sessions.

### `GET` / `PUT` / `DELETE /focus/current` (auth)

The phase running now, so your other devices can show it: `PUT { state, device, device_id }`.
Only you see it.

## Presence

### `POST /presence/heartbeat` (auth)

About once a minute while an app is open: `{ device_id, platform, label?, active, doc_id?,
pending_changes, failed_changes, synced_at? }`. `doc_id` must be a page you can see.
`POST /presence/leave { device_id }` on sign-out.

### `GET /presence/devices` (auth)

Your devices: online, active, changes waiting or needing you, last synced. Only yours.
`DELETE /presence/devices/:deviceId` forgets one.

### `GET` / `PUT /presence/settings` (auth) → `{ share_presence }`

Off by default. On, your teams see you as `active` or `away` — never a time.

### `GET /teams/:id/presence` (auth, `items:read`)

`[{ user_id, status }]`, `status` one of `active`, `away`, `offline`, or `hidden` for members who
don't share it.

### `GET /docs/:id/presence` (auth)

Who else has the page open now: `[{ user_id, name }]`.

### `GET /events` (auth)

Served by the realtime service. A server-sent event stream of news for you and your teams:
`{"kind":"changed"|"focus"|"presence"|"doc_presence", "team"?, "doc"?, "by"?}`. The news only
says what to re-read; `by` is the device that caused it, so it can skip its own.

## Idempotency keys

Any write can carry `Idempotency-Key` (8–100 letters, digits, `-`, `_`). The first answer is kept
for a day; the same key again gets it back with `Idempotent-Replay: true`, a repeat that arrives
while the first is still running gets `409`, and the key used for a different request gets `422`.
Keys belong to the credentials they came with. `POST /items` also accepts an `id` made on the
device: sending it again answers `200` with the same item.

## Team capacity

### `GET /teams/:id/capacity?from=&to=` (auth, `items:read`)

Up to a month. For each member and day (in your zone): `level` 0–3 (none, under 2 h, 2–5 h, 5 h+
free), `off`, `over` (booked past working hours). Owners and admins also get `working_minutes`,
`free_minutes`, `team_minutes` (planned for this team), `over_minutes`, and each member's
`unplaced_minutes` of assigned team work not on any day yet; for others these are `null`. Busy
time is never described.

## Project templates

### `GET /templates` (auth)

Yours, your teams', and the starters (`id` like `starter:retro`), each with `source`, `tasks`,
`page`, `rrule`, `next_at` and `can_edit`.

### `POST /templates` (auth)

`{ name, description?, team_id?, tasks: [{ id, title, notes?, estimate_minutes, due_in_days,
depends_on?, target_value?, value_unit? }], page?: { title, content }, rrule? }`. A team's
templates are made by its owners and admins. The tasks must not wait on each other in a loop.
`PUT` and `DELETE /templates/:id` for its maker or the team's owners and admins.

### `POST /templates/from-project/:id` (auth)

Save a project as a template: its tasks, their estimates, when each was due counted from the
first, what waits on what, numbers to reach, and its brief (checked items unchecked).

### `POST /templates/:id/use` (auth) → proposal

`{ title?, team_id? }`. A proposal with a schedule to review, applied with
`POST /ai/proposals/:id/apply`; nothing is made until then. Applying makes the project, its tasks
(with their order and numbers to reach), their sessions, and the brief as the project's page.

A template with an `rrule` sends a `template` notice (`ref` = the template) when its next run is
due; opening it starts a fresh review.

## Numbers to reach

Tasks take `target_value`, `current_value` and `value_unit` (up to 16 characters). While a target
is set, `progress` follows `current_value / target_value`.

## Follow-through

### `GET /planner/reality` (auth)

How plans went over the last 28 days: for each weekday, minutes planned and minutes kept. A
session counts in full when its task was finished by the end of that day, otherwise the focus time
logged on the task that day counts, up to the session's length. `enough` is false (and `rate`
null) under three hours of planned time; apps say nothing until then. `realityCheck()` in
`@orbyn/core` holds a plan up against it.

### `POST /planner/what-if` (auth) → `{ before, after, newly_late, relieved, verdict }`

`{ days?, add_tasks?: [{ title, estimate_minutes, due_at?, priority? }], days_off?: [day],
move_due?: [{ item_id, due_at }], drop_item_ids? }`. Two plans are worked out — as things are, and
with the change — and compared. Nothing is saved; no plan is stored.

### `GET /me/reentry` (auth) → brief or `null`

After 36 hours or more away (measured from presence check-ins), for three days or until
dismissed: `assigned`, `changed` (by others, on your tasks), `asks` waiting on you, `mentions`,
`due` (overdue, that is past its deadline, or within three days) and team `pages` changed, five
of each at most.
`POST /me/reentry/dismiss` puts it away.

### `GET /docs/fading?team_id=` (auth)

Pages (kind `doc`) nobody has changed or confirmed in 90 days, oldest first; `freshness.state` is
`fading` from 90 days and `stale` from 180. Documents carry `reviewed_at`.

### `POST /docs/:id/review` (auth, `items:write`)

`{ verdict: "still_true" }` confirms it without changing it (the version stays), or
`{ verdict: "needs_update", note? }` makes a task "Update “title”", assigned to its author on a
team when they're still on it.

### Asks

A team task created with, or changed to, an assignee other than the person saving is an ask.
`GET /asks` → `{ to_me, from_me, recent }`; `GET /items/:id/ask`.
`POST /asks/:id/reply` (the person asked): `{ action: "accept" }`,
`{ action: "counter", due_at?, estimate_minutes?, message? }` or
`{ action: "decline", message }` (unassigns the task).
`POST /asks/:id/settle` (the asker): `agree` (applies the suggestion to the task), `keep` (back
to them as asked) or `withdraw` (unassigns). Each step sends an `ask` notice to the other person.

### Meeting budget

`GET /teams/:id/attention?week=YYYY-MM-DD` → each member's meeting minutes that week against
`budget_minutes`. Meetings are timed, busy events that are a team's or have people invited.
`PUT /teams/:id/attention { meeting_budget_minutes | null }` (owners and admins).
`POST /teams/:id/attention/check { start_at, end_at, user_ids?, item_id? }` → who a meeting
would take over the budget.

### Proof of progress

`GET`/`POST /items/:id/proofs` — `{ url?, note? }`, one or both, up to 20 a task (`items:write`
to add); `DELETE /items/:id/proofs/:proofId`.
`GET /progress?from=&to=&team_id=` → what got done, by person, with each task's proof, and the
same as `markdown`. Without `team_id`, your own personal tasks.

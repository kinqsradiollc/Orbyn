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

## Personal assistant identity and character

`GET /me/agent` returns `{ name, persona, character, named_at, updated_at }`.
`PUT /me/agent` accepts `{ name, persona?, character? }` and returns the same shape.
These routes require an Orbyn app session; personal API keys are refused (`403`).
Writes allow 30 requests per minute per address and are audited. Unknown fields or
invalid choices return `422`; malformed JSON returns `400`.

The optional `character` object contains curated choices:

| Field       | Choices                                                                                 | Default    |
| ----------- | --------------------------------------------------------------------------------------- | ---------- |
| `body`      | `orb`, `pebble`, `spark`, `cloud`, `bean`, `heart`, `pudding`, `diamond`, `marshmallow` | `orb`      |
| `palette`   | `fern`, `sage`, `ink`, `honey`, `coral`, `paper`                                        | `fern`     |
| `eyes`      | `round`, `soft`, `bright`, `sleepy`, `starry`, `wink`                                   | `round`    |
| `ears`      | `sprout`, `none`, `bunny`, `cat`, `bear`, `fox`, `antenna`                              | `sprout`   |
| `tail`      | `none`, `curl`, `fluffy`, `fin`, `comet`                                                | `none`     |
| `headwear`  | `none`, `beanie`, `crown`, `bucket`, `wizard`, `beret`, `flower`, `bow`                 | `none`     |
| `eyewear`   | `none`, `spectacles`, `sunglasses`, `heart-shades`, `monocle`, `visor`                  | `none`     |
| `neckwear`  | `none`, `scarf`, `bowtie`, `ribbon`, `bell`, `bandana`, `tie`                           | `none`     |
| `outfit`    | `none`, `hoodie`, `overalls`, `sweater`, `tuxedo`, `raincoat`, `spacesuit`              | `none`     |
| `backwear`  | `none`, `wings`, `cape`, `backpack`, `leaf-wings`                                       | `none`     |
| `markings`  | `plain`, `freckles`, `stars`, `stripes`, `patch`, `heart-mark`                          | `plain`    |
| `ring`      | `orbit`, `halo`, `none`                                                                 | `orbit`    |
| `accessory` | `none`, `glasses`, `headphones`, `cap`                                                  | `none`     |
| `movement`  | `gentle`, `bouncy`, `floaty`                                                            | `gentle`   |
| `presence`  | `animated`, `static`, `hidden`                                                          | `animated` |

Slots combine independently. Explicit headwear/eyewear take visual precedence over
legacy cap/glasses accessories; the stored legacy values remain valid. Existing JSON
records gain defaults for the new fields without a new migration. Eight starter looks
and randomization are client-side conveniences. Presets, randomization and Reset look
preserve presence and movement preferences. Preview expressions never change the real
assistant's activity state.

Omitting `character` preserves a saved appearance. Supplying it replaces the
appearance, with omitted fields receiving the defaults above. Legacy records return
these defaults. Appearance is scoped to the signed-in person and rendered locally
from shared vector artwork; no external asset URLs are accepted. MCP identity edits
continue to accept only name/persona and preserve the appearance.

## ChatGPT identity connections

These first-party routes run in the AI service. They require an active, verified
Orbyn app session; personal API keys and outside-agent/plugin credentials cannot
use them. Identity verification is a backend foundation, not a complete OAuth or
plan-inference flow. Clients must implement their eligible provider flow before
offering a sign-in control.

| Method | Path                                 | Body / result                                                                                                                                                      |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/ai/connections/chatgpt/challenges` | `{client_id?: string}` → `{id, nonce, expires_at}`. Omit the issued client ID for initial dynamic registration. Never send the `dynamic_agent_client` placeholder. |
| POST   | `/ai/connections/chatgpt/complete`   | `{challenge_id, client_id, id_token}` → `{id, issuer, subject, client_id}` after signature/issuer/audience/nonce verification.                                     |
| GET    | `/ai/connections/chatgpt`            | Active connections with `{id, issuer, subject, client_id, verified_at}`.                                                                                           |
| DELETE | `/ai/connections/chatgpt/:id`        | Owner-only disconnect, `204`. Also consumes that owner's pending challenges so an old callback cannot reconnect.                                                   |

Challenge ownership includes the exact Orbyn session. Challenges expire after ten
minutes and can be consumed once; at most five unconsumed, unexpired challenges
may exist per user. Challenge start, completion and disconnect allow ten requests
per minute per address. A verified registration cannot be silently linked to a
second Orbyn account. These routes return `Cache-Control: no-store` and bypass the
general 24-hour idempotency response cache so every operation checks its current
session. Invalid proof is `400`; missing/foreign challenge or connection is `404`;
expired, consumed, changed-registration or conflicting-owner proof is `409`;
malformed fields and unexpected fields are `422`. No email-based linking occurs.
Access and refresh tokens are rejected, and identity tokens are never stored.

## Rate limits

Requests signed with a personal API key (`ok_…`) count against that key, wherever they come
from. Global app requests with a verified live session count against that device session,
so devices and people sharing an IP do not consume one another's app allowance. Anonymous,
expired, disabled and invalid sessions count against their IP. A route's stricter session
limit still counts per IP; personal API keys and MCP connections retain their existing buckets.
The global limit is 180 requests a minute by
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

### `GET /me/export.zip` (auth, 10/min)

Everything you own, pages included, as a `.zip` (`orbyn-export-YYYY-MM-DD.zip`): every personal
page as Markdown in `pages/<folder>/` with front matter (title, kind, dates, folder, project, tags,
the file it was imported from), agendas in `pages/Agendas/<date>.md`, pages in Trash in
`pages/Trash/`, plus `planner.json` (the same archive as `/me/export`, importable),
`projects.json`, `folders.json`, `attachments.json` (what was imported and which page it became;
the files themselves are never kept) and `consent.json` (your terms and analytics decisions). Team
pages stay with their team. Personal API keys get `403`, as for `/me/export`.

The archive is streamed as it is written (no `content-length`): pages are read 200 at a time and
each file is deflated off the main thread, so a large account never sits in memory whole. Past
65,535 files or 4 GB it carries zip64 records.

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

A card line may end with a link to the notes line it was made from,
`[src: Lecture 5 › Cells make energy](orbyn://doc/<id>#<line>)` (never part of the question or
answer): each card then has `source { doc_id, block_id, doc_title, text }`, shown as "from: …" once
the answer is revealed (only where the person can read that page). A card line right under a picture
line asks about that picture (`picture`, a page file id). Every Again counts as a miss (`misses`);
`weak[]` lists what the person keeps getting wrong, most misses first, with the notes to re-read
(`source`). An outside agent can mark a card "needs work" (its explanation fell short): it comes
first in the agent's next quiz and is cleared by a Good or Easy.

Cards follow their pages, not the reading of Study: saving a page (and restoring a version or a
page from Trash, taking a proposal or adding tasks from its lines) updates its cards for everyone
who can read it before the answer comes back, and joining or leaving a team does the same for the
team's pages. Pages written any other way (imports, templates, the assistant) are synced by the
notifier within a few seconds. `GET /study` and `GET /study/queue` only read.

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
like one (exam, midterm, final, test, quiz), and exams named in Study itself by an outside agent
(`own:<id>` keys). Each has a `key` built from its source and start, and an optional `target`.
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

**Keep the original** (off by default): with the person's setting on (`PUT /me/originals { keep }`, which a personal API key may read but not change), or `keep_original: true` on `POST /imports` for one file (`false` overrides the setting), the file is kept after it becomes a page, encrypted in
the file store's `kept/` folder, within `FILES_KEEP_QUOTA_MB` per person (over it, the page is still
made and its notes say the original wasn't kept). `GET /me/originals` → `{ keep, used_bytes,
quota_bytes, files }`. A page's `original` field names it; `GET /docs/:id/original` downloads it for
anyone who can open the page, `DELETE /docs/:id/original` deletes it (the importer, or an editor of a
team page). Originals come with `/me/export.zip` (`originals/`), and go when their page is deleted for
good or the account is deleted.

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
   it's ready, and the file is deleted. With `project_id`, the page instead lands in that project
   with `in_uploads: false`. The caller needs project edit access when starting the import and when
   conversion finishes. A project import must include `project_team_id`, the team shown in the
   upload confirmation (or `null` for a personal project). For a team project, the team must still
   be the same; otherwise conversion
   fails without sharing the page. The source file is deleted in either case.

| Method and path             | Body / result                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /imports`             | `{ file_name, bytes, mime?, project_id?, project_team_id?, keep_original? }` → `201 { import, upload_path, expires_at }`; `503` when importing isn't set up |
| `PUT {upload_path}`         | The file's bytes, any `Content-Type` → `201 { id, bytes }`. Reached through the gateway (`/files/u/…`, `/api/files/u/…`)                                    |
| `GET /imports`              | Your imports still going, and the last 7 days' → `[ImportJob]`                                                                                              |
| `GET /imports/:id`          | → `ImportJob`                                                                                                                                               |
| `DELETE /imports/:id`       | Cancels an import still going, or clears a finished one → `204`                                                                                             |
| `GET /imports/capabilities` | What this server can read → `{ enabled, scans, formulas, photos, limits }`                                                                                  |

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
- `notes`: what changed on the way in, such as "2 tables kept as tables" or "1 figure left out".

**Keep the original**: the person's setting (`PUT /me/originals { keep }`) decides, unless the
import says otherwise (`keep_original: true` or `false` on `POST /imports`, as an agent's
`start_import` can). A kept file is the page's `original` (see above), not one of its pictures and
files. Tables in Word files, PDFs and OCR output are kept as tables.

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

### `POST /agenda/today` (auth)

`{ "timezone"?: "Australia/Melbourne" }` (the device's zone, adopted like `POST /me/timezone`).
Today's agenda, in the person's planner time zone, written from the calendar as it actually is. Its
sections: a summary line (the assistant's, when connected), Top priorities, Schedule (Morning,
Afternoon, Evening; all-day first; no calendar names), Focus time (time set aside and free
stretches), Due today, Carried over, Coming up, Notes and End of day. It reads
(`packages/core/src/agenda.ts`, `backend/src/modules/docs/agenda.ts`) your events with repeats on
the day they fall and the calendars you subscribe to, time set aside for tasks and habits, what's
due, what slipped, exams and all-day events in the coming week, and how much working time is free. Written the first time it's asked for each day (`201`), never waiting on the AI
provider, and returned unchanged after that (`200`), so edits are never overwritten. → a document
with `kind` `agenda`, titled like "Sunday 20 September".

`GET /agenda/today?timezone=` does the same for app builds from before 26 September 2026. Because
it writes, it answers with `Deprecation` (RFC 9745) and a `Link` to the POST, and goes once those
builds are gone.

The worker writes each active person's page between 5 and 11 in their own zone (at most 25 per
15-minute pass, five at a time), opening with the assistant's summary of the day when a provider is
connected.

### `POST /me/timezone` (auth)

`{ "timezone": "Australia/Melbourne" }` → `{ adopted, timezone }`. Both apps send the device's zone
when they start. It becomes the planner zone unless the person picked one in Planning settings
(`planner_prefs.timezone_chosen`); before this, anyone who never did was treated as UTC for
everything the server writes. On a change, subscribed calendars are read again and today's agenda,
if untouched, is written again. `POST /agenda/today`, `POST /agenda/:date` and
`POST /ai/agenda/today` `{ timezone }` do the same first.

In the library, agendas have their own **Agendas** section, filed by year, month and week (Monday
first), and are left out of "All documents" and "Unfiled".

### `GET /agenda/:date` (auth)

One day's agenda, for stepping back and forward (`date` like `2026-09-24`, at most a year back and
two months ahead, else `422`). → `{ date, title, today, doc }`. It only reads: a day's `doc`,
today's included, is `null` until it is written with the POST below (the apps write today's at
once, as `POST /agenda/today` does, and offer to write any other day's). Every agenda carries
`agenda_date`, the day it is for, and the library files it under that day.

### `POST /agenda/:date` (auth)

`{ "timezone"? }`, adopted as above. Writes that day's agenda from the calendar if it isn't there yet (`201`), or returns the one there
(`200`). A past day reads as the calendar has it now, with no free time; a day ahead shows what's
planned so far. A page written ahead that nobody changes is written again on its day.

### `POST /ai/agenda/today` (auth, 10/min)

Writes today's agenda again from the calendar as it is now, replacing everything above its Notes
heading (the apps ask first). Notes and everything under it — your notes and the end-of-day
answers — are kept exactly as written. It opens with the assistant's summary when a provider is connected. The provider is
sent the day as facts only (times already in your zone). → the document plus `brief`: whether the
assistant wrote the summary.

### `POST /items/:id/note` (auth)

The meeting note for an event, created from a template (Agenda, Notes, Decisions, Action items)
the first time and returned as-is afterwards. → `201` when created, `200` when it already existed.
A note for a team event belongs to the team, so one shared meeting keeps one shared note. A note in
Trash doesn't count: the event gets a fresh one. If the old one is restored while the fresh one was
written in, both are kept and the event opens the one written in last. Two first opens at once (or
one and a page made from a template for the same event) still make only one note.

A repeating event keeps a note per time (each lecture of a term, each standup): the body
`{ "occurrence": "<start>" }` — a calendar entry's `occurrence`, or the new start of a time moved
on its own — opens that time's note, titled with its day ("Physics lecture · 25 September 2026")
and carrying `occurrence`, with that time's own title, start and location. Without a body the
note is the whole series' own. `422` for a time the event doesn't have. A note's `occurrence` is
`null` for any other page.

A series' own note (`occurrence` `null`) is what the event opens from anywhere that doesn't name a
time: Overview, ⌘K, notices. Every note written before times had their own is one, and so is a
one-off event's note after the event starts repeating. Opening one time of the event from the
calendar never opens it (that time gets its own note), so the apps point to it instead: the task
panel shows "Series note: “…”" beside Meeting note, and New page from a template says so when a
time is chosen (`seriesNoteFor(notes, entry)` in `packages/core/src/docs.ts`).

Notes stay with their times when the series changes. A "this and following" edit moves the notes
of the times from there on to the new series, each to the matching time (the n-th time after the
edit is the n-th of the new series, so a move to another hour or day, or across a clock change,
keeps them lined up). Moving or re-timing the whole series (`all`, a new start or time zone) moves
each note to its time's new start the same way; with a new pattern (say weekly to daily) each moves
by as much as the series did. A note whose time no longer exists (deleted, skipped, not in the
new pattern, or the repeat taken off) is kept as a note of the whole event it was made on (not the
new series of a split), rather than pointing at a time nothing opens. It remembers the time it was
for, and it never outranks the series' own note: the event opens it (and the apps point to it as
the series note) only when the series has no note of its own.

### `GET /docs/event-notes?items=<id,id,…>&from=&to=` (auth)

The notes some events have, to mark them:
`[ { doc_id, title, item_id, occurrence, team_id, class_was } ]`, latest edited first, for at most
200 event ids. `class_was` is the time a note was for when that time is gone (the note is then the
whole event's, and `occurrence` is `null`); those come after the event's own notes. Only notes you can see in each event's own space,
none in Trash. `from`/`to` keep a repeating event's per-time notes to those first starts (series
notes always come back). `eventNoteFor(notes, entry)` in `packages/core/src/docs.ts` picks the one
a calendar entry opens, by the same rule as the server. `422` for no ids, a bad id or more than 200.

### `POST /docs/:id/tasks` (auth)

Turns the document's unticked, non-empty checklist lines into planner tasks (in the document's
team, if it has one). → `{ "created": 2, "items": [ … ], "doc": { … } }`. Blank and
already-ticked lines, and lines that are already tasks, are skipped. An agenda answers `422`: its
lines copy tasks you already have, so making them would only make each one twice. The page is read and written
back under its lock, so a save that arrives meanwhile waits and then merges (`409`) rather than
being overwritten.

An optional body `{ "block_ids": ["b1"] }` (1–200 line ids) turns only those lines into tasks:
"Make task" on selected words and "New task" in the `/` menu use it. Anything else in the body
answers `422`; a page in Trash answers `404`.

## Sharing into Orbyn

What the phone's share sheet sends ("Save to Orbyn"): a link or some text, and where it goes
(`packages/core/src/share.ts`, `backend/src/modules/capture/`).

### `POST /capture/preview` (auth, 30/min)

`{ "url": "https://…" }` → `{ url, title, site }`. The start of the page (up to 256 KB of HTML)
is read over https at public addresses only (netguard, every redirect checked, 5 s), for its
`og:title` or `<title>` and its `og:site_name` or host. An `http` link is read at its `https`
address. A link that can't be read — private, slow, not a web page, an error — is not an error:
`title` is `null` and `site` is the host. `422` for anything but an http(s) link.

### `POST /capture` (auth)

`{ url?, text?, title?, to, timezone? }` → `201 { to, note, item?, doc? }`, where `note` says
where it went, in a sentence. At least one of `url` and `text`; without `title` the server looks
it up as above. `to` is one of:

- `{ "kind": "inbox" }`: a task of your own, "Read: <title>" with the link on it and any text
  as its notes (text alone: its first line is the title, the rest the notes).
- `{ "kind": "project", "project_id": "…" }`: the same task in the project's first stage (a team
  project's task is the team's).
- `{ "kind": "agenda" }`: list lines (the link, then the text) at the end of today's agenda's
  Notes, before the end-of-day questions; `timezone` is adopted like `POST /agenda/today`'s.
- `{ "kind": "page", "doc_id": "…" }`: the lines at the end of a page (a page that is one empty
  line takes them in its place). Saved as any edit is: a new version, kept in history, and open
  editors are told.
- `{ "kind": "new_page", "folder_id": "…" | null }`: a new page titled after the link, in the
  folder's space (a team folder makes a team page).

`403` where you may only read (a team viewer), `404` for a page, folder or project you can't see
(or a page in Trash), `422` for a bad body.

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

### Project Home links (auth)

`GET /projects/:id/links` lists up to 20 pinned web links for a visible project. Each link has
`id`, `project_id`, `url`, `title`, and `created_at`. `POST /projects/:id/links` accepts
`{ "url": "https://example.com", "title": "Reference" }` and requires project write access.
Only HTTP(S) URLs without embedded credentials are accepted. Posting the same URL updates its
title. `DELETE /projects/:id/links/:linkId` requires write access. Inaccessible projects return
`404`; a full project returns `409` when adding a new link.

### `GET /projects/:id/planning` (auth)

→ `{ project_id, deadline, task_count, needed_minutes, planned_minutes, unplanned_minutes,
late_session_count, planned_finish_at, unestimated_tasks, team_planned_minutes? }`.
The first counts and minutes cover only your open tasks and your own sessions. Each task's planned
time counts only before its earliest task, project or dependent target. Excess sessions on one
task cannot cover another. `planned_finish_at` is present only when all estimated work is covered;
tasks without an estimate are named in `unestimated_tasks` and excluded from the hour totals.
On a team project, `team_planned_minutes` is returned only to owners and admins, as an aggregate
without names or session times. `404` when the project is not visible to you.

### `POST /projects/:id/plan` (auth)

Body: `{ "timezone": "Australia/Melbourne", "claim_item_ids": ["…"] }` (both optional). Needs
edit rights (`403` for a viewer). Creates an expiring plan preview for your open tasks in an
active project, plus the unassigned team tasks in `claim_item_ids` (up to 50): claiming makes you
their assignee in the same transaction, writing only the assignee (and version), so other edits
to those tasks are kept. Other people's tasks are excluded, including when the preview is tuned.
The horizon ends on the project's deadline if it is within two weeks; otherwise it covers two
weeks and the summary starts "Planned the next 2 weeks." Returns the usual planner `Plan`. The
preview does not change sessions. `404` when the project is not visible; `409` when a task to
claim was taken or finished meanwhile; `422` for an inactive project, invalid time zone, a
personal project with claims, or no assigned work.

Clients put Home together from `GET /projects/:id`, `/planning`, `/sessions`, `/links`, `/visit`
and the page and task lists rather than one `GET /projects/:id/home` payload (a recorded
deviation from the plan: each piece is cached and refreshed on its own).

### `GET /projects/:id/sessions` (auth)

→ up to 500 of your saved sessions for tasks in this project, newest first, as
`{ id, item_id, start_at, end_at }`. Used for exact ticks on the project timeline.
Other team members' session times are not returned. `404` when the project is not visible.

### `POST /projects/:id/visit` (auth)

Marks the project as visited by this person and returns `{ "since_at", "visited_at" }`.
`since_at` is the visit before this one, or `null` on the first visit. Reopening within five
minutes keeps the same catch-up point. The prior visit is kept on the server for both clients
and for later "what changed?" answers. `404` when the project is not visible.

The planner's daily worker also creates one `project` notification per person and local day
when that person's work remains unplanned within seven days of an active project deadline.
Its `ref` is `<project id>:<local day>`; the action opens the project. Team members do not
receive one another's session times.
When a project deadline moves earlier, a person with sessions newly after that deadline gets
the same day's project notice updated with the change; sessions are not moved automatically.
When a task deadline moves earlier, a person with sessions newly after it gets one `deadline`
notice for that change's local day. A due-soon notice for the same task and day is updated
in place; the sessions stay at their saved times for review.
`GET /items/:id/sessions` also returns `assigned_to_me`, so a person can remove their old
sessions after the task changes hands.

### `GET /projects/:id/activity?limit=100` (auth)

→ recent project, task, linked-note and work-record changes, newest first (maximum 200). The timeline contains
titles and planning fields only; task notes and document bodies are never included. Access follows
the same personal-project or team membership rules as `GET /projects/:id`.

Rows now say how a change was made (`origin`: `app`, `planner`, `assistant`, `agent`, `reminder`)
and name a connected agent (`via_agent`). Sessions are listed too (`entity_type: "session"`,
`entity_id` = the task; kinds `session_planned`, `session_moved`, `session_started`,
`session_removed`), one row per task per change ("3 sessions planned: …"), and only to the person
whose sessions they are — teammates, owners and admins included never see them.

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

### Milestones (auth)

A project's own dated list of checkpoints (never dates on stages; a milestone never writes a task's
deadline). `GET /projects/:id/milestones` lists them soonest first, each rolled up for the viewer:
`task_count`, `done_count` (everyone's tasks), and for your part only `needed_minutes`,
`planned_minutes`, `planned_finish_at` and `unestimated_count`, plus a `status` (`done`, `on_track`,
`not_planned`, `late`, `passed`, `empty`). `POST` `{ name, due_on: "YYYY-MM-DD", item_ids? }` (edit
rights, at most 50), `PUT /projects/:id/milestones/:milestoneId` `{ name?, due_on?, done? }`,
`DELETE` (its tasks stay). `PUT /items/:id/milestone` `{ milestone_id | null }` puts one task in a
milestone of its own project (`422` for another project's). A task that leaves its project leaves the
milestone. Changes show in the project's History.

### `PUT /projects/:id/assistant` (auth) → the project

`{ "off": true }` keeps the project out of the assistant: nothing in it (tasks, pages, records, its
title) reaches any AI — the assistant's tools and preload, a chat scope (`422`), page help and Study
(`422` for its pages), the morning agenda's summary, search by meaning (its measurements are
forgotten) and connected agents (every agent query leaves it out). Only the owner of a personal
project, or a team's owners and admins, may change it (`403`), and only signed in: a personal API
key is refused (`403`). Projects carry `assistant_off`.

### Saved project chats (auth, ai service)

Each person's own conversations with the assistant about a project. `GET /ai/projects/:id/chats`
lists yours (newest 50), `GET /ai/chats/:id` reads one with its `turns` (`{ role, text, sources? }`),
`PUT /ai/chats/:id` `{ project_id, title?, turns }` saves after each reply (the app makes the id;
`422` for a project kept out of the assistant; `404` for a chat or project that isn't yours),
`DELETE /ai/chats/:id`. Pending changes are never saved. The sweeper removes chats a year after they
were last used.

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
that belongs to a different project is `422`. Leaving `stage_id` out keeps the stage when the
project stays the same; a different project starts with no stage. The response is
`{ "ok": true, "item": <updated item> }`, including its new edit version.

### `GET /items/:id/context` (auth)

Returns the task's project and stage, the readable page and line from which it was made, and
other readable pages tied to the task. `came_from.quote` is null when that line has since been
removed. Personal pages belonging to someone else are never included, even when the task is
shared in a team. An inaccessible task returns `404`.

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

### `PUT /docs/:id/tags` (auth, `items:write`)

`{ "tags": ["<tag id>", …] }` (up to 20) → `{ tags }`. Sets exactly these tags on the page, from
its own space: your personal tags on a personal page, the team's on a team page (a tag the page
already carries may stay). Any other tag is `404`. Tags aren't the page's words, so its version
doesn't change; the page's live stream (`/events/docs/:id`) sends `{ version, tags: true }` so
other open editors refresh their tag row.

### `POST /docs/:id/tags` (auth, `items:write`)

`{ "names": ["physics", …] }` → `{ tags, added }`. Adds tags by name, as typing `#physics` in a
line does; a name the page's space has no tag for yet makes one there. Names compare without case;
past 20 tags the rest are left off, and a tag is only made when it goes on the page. The apps call
this when a line with a new `#tag` is left (`addedInlineTags` in `packages/core/src/page-tags.ts`).
When something was added, open editors hear `{ tags: true }` as for `PUT`.

### Page templates (auth)

A page kept to start the next one from (`packages/core/src/page-templates.ts`). Blanks `{date}`,
`{title}`, `{project}` and `{event}` fill themselves in; double braces (cloze) and `::` are never
touched. Starters: Lecture notes, Lab report, Essay plan, Meeting, Weekly review, One-to-one.

- `GET /page-templates` → your templates, your teams', then the starters (`id` `starter:…`).
- `POST /page-templates` `{ name, description?, team_id?, title?, content?, folder_id?, tags? }`
  → `201`. Folder and tags must be in the template's space (`404` otherwise). Any team member who
  can write may make a team's.
- `PUT /page-templates/:id`, `DELETE /page-templates/:id` — its maker, or a team's owners and
  admins (`403` otherwise).
- `POST /page-templates/from-doc/:docId` `{ name?, description?, personal? }` → `201`. Saves a
  page as a template with its folder and tags, boxes unticked. A team page makes a team template
  unless `personal`.
- `POST /page-templates/:id/use` `{ title?, team_id?, folder_id?, project_id?, event_id?,
event_at?, occurrence?, make_tasks? }` → `201 { doc, tasks_created, existing: false }`. Any template (a starter
  too) makes a page in your space or, with `team_id`, a team's you can write in (`403` for a
  viewer); without `team_id` it goes where the event, else the template, is. Event, project and
  folder must be in that space (`404`). With a project the page belongs to it; with `make_tasks`
  its to-do lines become tasks in that project's first stage, tied to their lines. With an event
  the page is that event's note and `{event}` is its title — unless the event already has a note:
  then nothing is made and the answer is `200 { doc: <that note>, tasks_created: 0, existing:
true }`, the same note `POST /items/:id/note` opens. For a repeating event, `occurrence` (else
  `event_at`) says which time the page is the note for, so each lecture gets its own page; with
  neither, it is the series' note. `422` for a time the event doesn't have. A line that only labels blanks left empty
  (`Course: {project}` with no project) is left off the page.

### Richer pages (D4b)

Besides headings, lists, to-dos, quotes, code, maths and dividers, a page's lines can be:

| Line                                       | Markdown                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `{ type: "callout", kind, text, folded? }` | `> [!tip] words` (`note`, `tip`, `warning`, `question`, `summary`; `-` after the kind folds it) |
| `{ type: "table", text }`                  | a pipe table; `text` is its Markdown                                                            |
| `{ type: "image", file, text, width? }`    | `![caption](orbyn://file/<id>?w=60)`                                                            |
| `{ type: "file", file, text }`             | `[name](orbyn://file/<id>)`                                                                     |
| `{ type: "footnote", label, text }`        | `[^1]: words`; the marker `[^1]` sits in a line                                                 |

A code block marked `mermaid` is drawn as a diagram; `orbyn-embed` shows another page's section
(`orbyn://doc/<id>#<line>`) or the tasks the page links to (`tasks: linked`), read-only and live.
Inline, `~~words~~` is struck through and `=={green}words==` / `=={rose}words==` are the other
highlighter colours.

| Method and path                | Body / result                                                                                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /docs/:id/section?block=` | A heading's section (or one line; without `block`, the first 60 lines) → `{ doc_id, title, block_id, missing, more, blocks, references }`                                                                                                                                                |
| `POST /docs/:id/anchor`        | `{ index, text }` names that line (when it still says `text`) → `{ block_id }`; `409` when the page moved on; anyone who can read the page may                                                                                                                                           |
| `POST /docs/:id/extract`       | "Move to new page": `{ block_ids, title?, version }` → `201 { doc, source }`; comments, suggestions, task lines and pictures go with the lines, and a link takes their place                                                                                                             |
| `POST /docs/:id/merge`         | "Merge into…": `{ into, version }` → `{ doc, relinked }`; same space only (`422`); this page goes to Trash with `merged_into`, its pictures belong to `into`, and links in pages you can change are pointed at `into` (a renamed line under its new name, each page keeping its history) |
| `GET` / `PUT /docs/:id/folds`  | The headings you folded (`{ block_ids }`, at most 200), yours on every device                                                                                                                                                                                                            |
| `PUT /docs/:id/aliases`        | `{ aliases }` (at most 8, each once): other names, such as a course code; the version stays                                                                                                                                                                                              |

`PUT /projects/:id` takes `aliases` too. Every write but `anchor` needs `items:write` on the page
(`403` for a viewer, `404` for a page you can't open) and goes through its history, as a save does.

### Pictures and files in pages

Kept in Orbyn's own file store (the `files` service, on its own `page_files` volume), encrypted,
for as long as a page shows them; never a third-party store. Each person has `PAGE_FILES_QUOTA_MB` of space
and a file is at most `PAGE_FILES_MAX_MB`. Pictures are PNG, JPEG, GIF and WebP; files are PDF,
Word, Excel, PowerPoint, text, CSV and Markdown, checked by their first bytes.

| Method and path          | Body / result                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /docs/:id/files`   | `{ name, bytes, mime?, width?, height? }` → `201 { file, upload_path, expires_at }` (`413` over the limit or your space, `415` for another kind of file)                                 |
| `PUT {upload_path}`      | The bytes (`/files/p/…` through the gateway), once, within ten minutes → `201 { id, bytes }`                                                                                             |
| `GET /docs/files/:id`    | → `{ file, url_path, expires_at }`: `GET {url_path}` (`/files/r/…`) shows or (`?download=1`) downloads it for an hour, for its uploader or anyone who can read a live page that shows it |
| `GET /docs/:id/files`    | The pictures and files added to the page or shown on it → `[PageFile]`                                                                                                                   |
| `DELETE /docs/files/:id` | Deletes one for good, freeing its space (its uploader, or `items:write` on the page it was added to; `403` from a page it was only pasted into) → `204`                                  |
| `GET /files/usage`       | → `{ used_bytes, quota_bytes }`                                                                                                                                                          |

Which pages show a file is kept by a trigger (`page_file_refs`, migrations 114 and 115), so a
picture moved, merged or pasted into another page keeps working there. A save links a page to a
file only when the person saving can already read it (the uploader, or a reader of a live page it
is on); an id copied from anywhere else stays unlinked and shows as gone, and leaving a team unlinks
that team's files from your own pages. A file no page shows any more goes at the
sweep 30 days after its last line was removed (time for undo and history), or at the next sweep
when its page is deleted for good. Parallel uploads are counted one at a time against the space.

### `GET /docs/:id/export?format=` (auth)

`format` is `md` (the default), `txt`, `html`, `docx` or `pdf`; anything else is `422`. The reply
carries a `content-disposition` with the file name, so every client saves the same file under the
same name.

Optional `version` is a positive safe integer identifying the editor's confirmed saved revision.
A visible page at another version returns `409`; an inaccessible page still returns `404` before
any revision comparison. Invalid versions return `422`. Omitting it keeps the existing latest
saved-page behavior. A conflict must not be silently retried against a different revision.

File exports and the legacy Markdown export read document visibility, content, linked task
state and link visibility from the primary database. They do not depend on a client consistency
header or a read replica catching up after a save or permission change.

`docx` is a zip of XML using Node's `zlib`. PDF uses the private offline renderer
and includes LaTeX math and ten Mermaid diagram families. PDF and HTML embed
currently authorized PNG, JPEG, GIF and WebP picture bytes with captions. They
recheck page visibility/revision and included file access before delivery, even
without `version`. Missing or revoked pictures return `404` rather than a partial
file; changed metadata returns `409`, unsupported metadata `422`, oversized
pictures `413`, and unavailable/invalid picture bytes `503`. Limits are 32 unique
pictures, 4 MiB each and 8 MiB combined, with a 15-second combined fetch deadline.
Duplicate references share one embedded data URI. Only signed first-party file
paths are fetched; redirects and arbitrary authored URLs are refused. Word,
Markdown and plain-text exports retain their existing picture representations.

### `GET /docs/:id/markdown` (auth)

Kept for anything already pointing at it; `export?format=md` is the same bytes.

### `GET /docs/:id/info` (auth)

A page's Info panel in one request (NAV-04):
`{ id, kind, team, project, event, folder, tags, linked_here, versions: { count, recent }, updated_at, reviewed_at, can_write, sources }`.
`team`, `project`, `event` (`{ id, title, due_at }`) and `folder` are `null` when the page has none;
`recent` is the latest three versions as `GET /docs/:id/versions` lists them. `linked_here` counts only
places the reader can open. `sources` are web sources an agent read and saved for the page
(save_source): `[ { id, url, title, site, author, quote, accessed_on, lines } ]`, newest first, where
`lines` are the anchors of the lines that use each one; Orbyn never opens them. `404` for a page the
reader can't open or one in the Trash.

### `DELETE /docs/:id/sources/:sourceId` (auth)

Takes a source off the page (page Info → Sources): its lines' uses of it go, the page's words don't
change and the source stays for other pages that cite it. Whoever can change the page. `204`; `404`
when the source isn't on the page or the page can't be changed by the reader.

### `GET /docs/:id/versions` (auth)

→ `[ { "version", "title", "author", "user_id", "created_at", "blocks" } ]`, newest first, without
content. Empty until the document has been changed at least once.

### `GET /docs/:id/versions/:version` (auth)

→ the same fields plus `content`, the blocks as they were. `404` when that version is not kept.

### `GET /docs/:id/versions/:version/changes` (auth)

What "Show changes" reads, in one request: →
`{ "version", "older", "sittings" }`. `version` is that version with `content`; `older` is the
version kept before it (with `content`), or `null` for the first; `sittings` is
`[ { "content", "author" } ]` from that version to the newest kept, oldest first, so the apps can
say who changed each line since — or `null` when more than 20 versions were kept since. `404` when
that version is not kept, `422` when it is not a version number.

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

When the page is moved to Trash the event also carries `"trashed": true`; an editor that has it
open lets it go and says where it went, rather than finding out from a save that fails.

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

`type` is `doc`, `task`, `project` or `record`; leave it out for pages, tasks and projects, ranked
together on one scale (projects match on their name and summary, and aren't included when `tag`,
`kind` or `project` narrows the search). `q` may be left out when another filter is set: the search
then lists what fits, newest first (the filter chips use this: "Pages and tasks tagged physics");
with nothing at all to go on it answers 422. `tag` narrows pages (`doc_tags`) and tasks (`item_tags`),
and leaves projects out. `team` is a team's id, or `personal` for what belongs to no team (the
`team:personal` operator). `project` limits results to that project's pages and tasks, and adds its work records
(decisions, promises…) as `record` hits, ranked on the same scale; records are otherwise only
searched with `type=record`. ⌘K and the phone's Search open a record hit's project. Every hit still passes the caller's normal visibility check, and
pages in the Trash are never found. The assistant's `search_docs` uses the same page search.
Renaming a project reindexes its pages, which are found by their project's name. Pages are matched on a weighted `tsvector` — title A, headings B, tags and project name C,
body D — and on the **letters**
of the title as well, so `Lanch breif` finds Launch brief. Rank is the text match lifted for a
recently edited page, plus a little for a title that merely looks like what was typed.

`block_id` is the line that matched, so a hit can open where the words are. `snippet` wraps the
matched words in `[[` and `]]` — markers rather than markup, so nothing has to trust a string from
the database as HTML.

A search only ever returns what the searcher can already see.

### `GET /find?q=&type=&limit=` (auth)

The quick switcher (⌘K on the web, Search on the phone). → `[ { "id", "type", "title", "hint",
"team_id", "updated_at", "recent" } ]`. `type` (`doc`, `task` or `project`) narrows it; a hit's
`type` is `doc`, `task`, `event` or `project`. `q` (up to 200 characters) matches **names** from the
first letter: the whole name, its start, anywhere in it (`%` and `_` are letters), then names that
look alike, lifted for what you opened lately (`recent: true`) and for what changed lately; done
tasks and archived projects sink. With no `q` it lists what you opened last, newest first, topped up
with your latest pages, open tasks and active projects. `limit` 1–30 (default 12). Only what you can
see, never a page in the Trash.

### `POST /recents` (auth)

`{ "kind": "doc" | "task" | "project", "id" }` → 204. Something was opened: it goes to the top of
your recent list. The apps call it when a page, task or project opens. Only the newest 50 are kept
per person, and the sweeper clears entries untouched for 90 days (`recent_opens`). An id you can't see
is never listed.

## Links between things

A link made with the link picker (`[[` in a page, "Link" in the `/` menu and on the phone's
toolbar) is kept in the page as an ordinary Markdown link to `orbyn://<kind>/<id>` — `doc`, `task`,
`event`, `project`, `person` or `date` (`orbyn://date/2026-09-26`). The words in the brackets are
only what it said when it was made: the apps show the thing's live title, so renaming never breaks a
link. Exports (`/docs/:id/export`, `/docs/:id/markdown`) turn pages, tasks and projects into web app
links (`APP_URL/app/<kind>/<id>`) and people and dates into their words.

Saving a page (any way: the editor, a restore, a suggestion, an import) fills the `object_links`
index, beside the fixed connections: a checklist line that became a task, a meeting note, a page in
a project, a task that waits for another and a person mentioned in a comment. Nothing is shown to
someone who can't open both ends.

**Link words are private to who can open the target (D3aF).** A reader who can't open what a link
points to (someone's personal page, another team's task or project, a page deleted for good — the
same things `/links/resolve` calls `missing`) never gets its bracket words: every answer that
carries a page's words shows them as `Private page`, `Private task`, `Private event`,
`Private project` or `Someone` instead — `GET /docs/:id` and its list previews, saves, versions,
comments and suggestions, exports, `/links/here` lines, hover cards, headings, search hits, the
assistant and agent `fetch`/`search` (an agent connection also can't read what lies outside its
spaces) and published pages (a visitor can open only published pages). The stored page keeps the
words: a save that hands back `Private …` for a link the page has keeps the page's own words, and
comment and suggestion ranges are counted in the words the reader was shown and carried to the
stored line (and back). Pages are found by search on their own words only, never by a link's.

### `GET /links/here?kind=&id=` (auth)

"Linked here" for a page, task, event, project or person (`kind` `doc`, `task`, `event`, `project`
or `person`). → `{ "count", "items": [ { "kind": "doc" | "task", "id", "title", "hint", "source",
"block_id", "context": { "before", "linked", "after" } } ] }`, one entry per place, newest first (at
most 100). `source` is `link`, `mention`, `task_line`, `dependency`, `project` or `meeting`;
`block_id` opens a page at the line. Places you can't open are neither listed nor counted. 404 when
the thing itself isn't yours to open.

### `GET /links/resolve?refs=` (auth)

Link pills as they stand now. `refs` is up to 60 `kind:id` pairs, comma separated. → one
`{ "kind", "id", "state", "title", "done"?, "due_at"?, "can_restore"? }` per ref, in order.
`state` is `ok`; `deleted` for a page in the Trash you could open (`can_restore` when you may restore
it); or `missing`, with no title, for anything gone for good or not yours to see (the two look
alike). Tasks carry their tick and deadline.

### `GET /links/pick?q=&limit=` (auth)

What the link picker offers for the words typed: pages, tasks, events and projects by name (the
quick switcher's ranking; with no `q`, what you opened last) with each task's `done` and `due_at`,
then teammates by name. → `[ { "kind", "id", "title", "hint", "done"?, "due_at"? } ]`. `limit`
1–30 (default 12). Dates are the app's own. Pages and projects are found by their other names too
(`aliases`), with the hint "Also called …".

### Links to one line (D4b)

A link can point at one heading or line of a page: `orbyn://doc/<id>#<line>` (and
`APP_URL/app/doc/<id>#<line>` on the web). It opens the page there, lit for a moment; `/links/here`
lists it on the page. In `/links/resolve`, `refs` may name a line (`doc:<id>#<line>`), and its pill
carries `block` and `block_title` (null once the line has gone). A page merged into another (below)
resolves as `ok` with `moved_to`, the page it went into.

### `GET /links/headings?doc=&q=` (auth)

A page's headings, for `[[Page#`; with `q`, the headings and then the other lines that say it (at
most 30). → `[ { "block_id", "index", "level", "text" } ]`. `block_id` is null for a line with no name
yet: `POST /docs/:id/anchor` names it.

### `GET /links/card?kind=&id=&block=` (auth)

A link's hover card (`kind` `doc`, `task`, `event` or `project`) → `LinkCard`: `state`, `title`,
`can_write`, and by kind: a page's `kind_label`, `folder`, `project`, `preview` and (with `block`)
`section`; a page merged into another answers with the page it went into and `moved_from`; a task's
`done`, `due_at`, `all_day`, `estimate_minutes`, `repeats`, `project`, `planned` (your next session
only) and `time_zone` (your account's, which "Reschedule" moves the deadline in); an event's `start_at`, `end_at` and `note_id`; a project's
`progress`, `next` and `deadline`. Something you can't open is `{ "state": "missing" }` and nothing
else.

### `GET /links/mentions?kind=&id=` (auth)

"Mentioned without a link": pages that say a page's or project's name, or one of its other names, as
words of their own (not in code, maths or links) without linking to it. → `[ { "doc_id", "title",
"hint", "block_id", "matched", "context", "can_link" } ]`, at most 20.

### `POST /links/mentions/link` (auth)

`{ doc_id, block_id, matched, target: { kind: "doc" | "project", id } }` makes the first such mention
in that line a link (a new version of that page) → `{ doc_id, version }`. `403` for a page you may
only read, `404` for a target you can't open, `409` when the words aren't there any more.

### `GET /links/related?kind=doc&id=` (auth)

"Related": pages that read like this one and aren't linked either way — by meaning when the
workspace measures pages (from the page's stored measurements; no provider is asked), then the same
tags, links to the same things, and similar titles. → `[ { "doc_id", "title", "hint", "reason" } ]`,
at most 6.

## Links into the apps

### `GET /.well-known/apple-app-site-association`, `GET /.well-known/assetlinks.json` (public)

The files iOS and Android check before opening the web app's `/app/…` links in the Orbyn app
(universal links and verified app links), served from the web host through the gateway. Built from
`APPLE_TEAM_ID` (`<team>.com.orbyn.planner`, paths `/app/*`) and `ANDROID_CERT_FINGERPRINTS` (the
signing certificates' SHA-256, comma separated). Unset, they are empty and links stay in the browser.

### Finding a page by meaning

Off by default, and impossible at all on a Postgres without `pgvector` — which the stock
`postgres:17-alpine` image is. Migration 041 asks for the extension, notices when it is not there, and
creates nothing; the word search above carries on alone, which is how the workspace already worked.
Swapping the image to `pgvector/pgvector:pg17` and re-running migrations creates the tables; nothing
else changes.

Turning it on is its own setup, `PUT /ai/settings/semantic` (`ai:manage`) with
`{ "on": true, "embedding_model": "…", "accept": true }`: it needs `pgvector` (`409` without it), a
connected provider (`409`), a model that measures text (`422`) and the admin's agreement that every
page is sent to the provider to be measured (`422` without `accept`). `{ "on": false }` turns it off
and **forgets every measurement**. `PUT /ai/settings` no longer turns it on (`422`). `GET /ai/settings`
reports `semantic_search`, `semantic_possible` (whether this database could), `embedding_model`,
`semantic_accepted_at` and `measure_running` (whether the measuring service reported in lately).
It stays off until asked for because measuring a page means **sending its words to whichever AI
provider is configured**, which is a decision for whoever runs the workspace rather than a default.
Pages in projects kept out of the assistant are never measured.

Once on, editing a page queues it; the **measuring service** (`node dist/services/measure.js`,
Compose `measure`, profile `semantic`, never the reminder loop) measures its lines a minute at a time,
and only the lines whose words actually changed. Meaning is then **added to** the word search, never used instead
of it: a page the words already found is lifted a little, and a page only meaning found joins the end
rather than displacing a plain match. If the provider is unreachable the search still returns its word
results — losing meaning is not losing the search.

### @mentions in a page, and `GET /me/mentions` (auth)

Typing `@` in a line offers the people who can already open the page; picking one writes an ordinary
Markdown link, `[@Anna Lee](/app/person/<id>)` (a relative path, never an `orbyn:` address). On every
save, from any write path, who a page names is read again: a person named for the first time is told
once in Notifications (`kind: "mention"`, `ref: "doc:<page>:<line>"`), and someone who can't open the
page is never recorded or told. `GET /me/mentions?limit=50` → `[{ doc_id, title, block_id, quote,
mentioned_by, project_id, created_at }]`, newest first: "Mentioned in". A page you can no longer
open drops out, so its title never shows.

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

→ `[ { "kind", "target_id", "created_at" } ]`. `kind` is `doc`, `project` or `view` (a saved view).

### `PUT /favourites` (auth)

`{ "kind", "target_id", "starred" }` → `204`. Starring something already starred is harmless.

A document is filed by sending `folder_id` to `POST /docs` or `PUT /docs/:id`; `null` unfiles it,
and leaving the field out keeps it where it is.

Pages inside pages (W5): `parent_id` on `POST /docs` or `PUT /docs/:id` puts a page inside another
page of the same space (your own, or one team's) and library (Memory and Agent notes keep to their
own kind); it takes that page's folder, and pages inside a page follow it to any folder. `null`
brings it to its folder's top level; a new `folder_id` alone leaves a parent filed elsewhere.
`position` (0 first) places it among the pages beside it. A loop, another space or another library
is `422`; a parent you can't see (or in Trash) is `404`. `GET /docs` lists `parent_id` and
`sort_order`. A page in Trash keeps its pages (the apps show them at the top level until it's
back); deleted for good, they move up a level.

## Saved views and your own fields

A saved view (DATA-01) is a named filter, sort, grouping and layout over tasks, pages or projects.
Its `definition` is the one language the apps, the live list block in a page and the agents' `query`
and `save_view` share (`viewDefinition` in `packages/core/src/views.ts`):

```json
{
  "source": "tasks",
  "filters": {
    "due_within_days": 7,
    "project": "<id>",
    "fields": [{ "field": "<id>", "op": "is", "value": "Final" }]
  },
  "sort": { "by": "due", "dir": "asc" },
  "group_by": "project",
  "layout": "table",
  "columns": ["done", "title", "due", "estimate", "spent", "tags", "days_left"],
  "date_by": "due"
}
```

- `filters`: `text`, `status` (`open` by default for tasks and projects, `done`, `any`), `team`
  (`"personal"` or a team id), `project`, `list`, `tag`, `assignee` (`"me"` or an id),
  `due_after` / `due_before` (days), `due_within_days`, `overdue`, `no_due`, `folder`, `kind`,
  `updated_within_days`, and up to ten `fields` filters (`is`, `is_not`, `empty`, `not_empty`,
  `before`, `after`, `contains`).
- `sort.by`: `due`, `updated`, `created`, `priority`, `title`, `estimate`, `days_left` or
  `field:<id>`. Things without a value sort last either way.
- `group_by`: tasks group as the task list does (`status`, `list`, `tag`, `size`, `priority`,
  `project`, `due_week`, `assignee`); pages by `kind`, `folder`, `project`, `team`, `tag`; projects
  by `status`, `team`; pages and projects also by `field:<id>`.
- `layout`: `list`, `board`, `table`, `calendar`, or `gallery` (pages only). `columns` include the
  ready-made computed columns `days_left`, `overdue` and `spent_vs_estimate` (no formula language).
- A definition that doesn't fit its source is refused with `422`.

A view is yours (`team_id` null) or shared with a team. It always runs as the person looking: a shared
view shares its definition, never anyone's rows.

### `GET /views` (auth)

→ `[ SavedView ]`: yours and your teams', each with `pinned` (your own sidebar) and `can_edit`.

### `POST /views` (auth)

`{ "name", "team_id"?, "definition" }` → `201` the view. Sharing with a team needs permission to
change the team's things (`403` for a viewer, `404` outside the team). At most 200 views per person
(`409`).

### `PUT /views/:id` (auth)

`{ "name"?, "team_id"?, "definition"? }` → the view. Its maker, or the team's owners and admins
(`403` otherwise). Only its maker shares it or takes it back; a view keeps its `source` (`400`).

### `DELETE /views/:id` (auth)

→ `204`, with everyone's stars and pins of it.

### `PUT /views/:id/pin` (auth)

`{ "pinned": bool }` → `204`. Pins are each person's own.

### `POST /views/run` (auth)

`{ "id", "limit"? }` or `{ "definition", "limit"? }` → `{ source, rows, truncated, fields, people,
time_zone, view? }`. Rows are tasks, pages or projects in one shape (`ViewRow`); a task's row carries
the task and its `end_at`, `all_day` and `timezone`, so "due" and "overdue" follow the task list's
rule (an all-day task is due by the end of its day, a task with an end time when it ends, and a task
due earlier today isn't overdue yet). Days are read in the account's time zone, returned as
`time_zone` so the apps draw and edit in the same one. A page's `cover` is its first image only when
it is in Orbyn's own file store (`/files/…`). At most 500 rows. Nothing is written.

### `GET /views/:id/export.csv` (auth)

The view as CSV with the columns it shows. Text that would start a spreadsheet formula is kept as
text.

### `GET /fields` (auth) · `POST /fields` · `PUT /fields/:id` · `DELETE /fields/:id`

Your own typed fields (ORG-02) for pages or projects in a space (yours, or a team's):
`{ "name", "type": "text"|"number"|"date"|"select"|"person"|"checkbox", "applies_to": "page"|"project",
"team_id"?, "options"? (choices), "on_calendar"? (date fields) }`. One name per space and kind
(`409`), 40 per space. Anyone who can change the team's things adds one; renaming, changing choices
and removing it is for its maker and the team's owners and admins. A choice taken away is cleared
where it was picked; removing a field clears every value.

### `GET /fields/values?target=page|project&id=` (auth)

A page's or project's fields and values, for its Info panel: `{ fields, values, can_write, people }`.
Only the fields of its own space count.

### `PUT /fields/:id/value` (auth)

`{ "target", "target_id", "value" }` → `{ field_id, value }`. Checked by type (`400`): a choice must
be one of the field's, a person someone in the team. `null` or empty text clears it. Needs
permission to change the page or project (`403`). It counts as a change: the page's or project's
`updated_at` moves (a page's `version` stays, so an open editor saves on), and open pages hear of it
on their live stream as `{ fields: true }`.

### `GET /fields/dates?from=YYYY-MM-DD&to=YYYY-MM-DD` (auth)

Date fields shown on the calendar as deadlines (DATA-07), on the pages and projects you can open:
`[ { field_id, field_name, target, target_id, title, date, team_id } ]`. The agents' `get_calendar`
lists them as `deadline` entries.

### A live list in a page (SRCH-02)

A fenced block with the language `orbyn-list` whose text is `view:<id>` or a definition (with an
optional `title` and `limit`). The apps draw it as live rows with working ticks; everything else
keeps it as a code block.

## Documents

Notes, briefs and agendas that live beside the planner. A document is a list of blocks
(`heading`, `paragraph`, `bullet`, `numbered`, `todo`, `quote`, `code`, `math`, `divider`).
`math` blocks hold LaTeX without the `$$` fences, and inline maths lives between single `$`
signs inside any text block, so a document always round-trips to Markdown with its formulas
intact. Personal documents belong to their author; team documents follow the same team roles
as team items (viewers read, members and above write).

List lines nest: `bullet`, `numbered` and `todo` blocks take an optional `depth` (1–3; left out
at the top level). A numbered line shows its place in its list, counted from 1 — or from
`start`, kept only on the first line of a list that begins elsewhere (`{ "type": "numbered",
"text": "…", "start": 5 }`). Markdown exports write the real numbers and indent nested items by
four spaces a level; reading Markdown back takes nesting from relative indentation, so two-space,
four-space and tab-indented lists all come in the same. Inline, `==words==` is a highlight.

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

### `DELETE /docs/:id` (auth, `items:write`)

Moves the page to **Trash** → `204`. It is kept for 30 days with its history, comments and task
links, and meanwhile every other route (lists, search, comments, history, exports, study, the
assistant, presence) answers as if it didn't exist. The sweeper deletes it for good after 30 days.
Anyone with it open is told on its live stream (`"trashed": true`); a project page shows as "Note
moved to Trash" in the project's history, and it isn't measured for semantic search while there.

### `GET /docs/trash` (auth)

→ `[ { "id", "title", "kind", "team_id", "team_name", "deleted_at", "deleted_by", "purge_at",
"preview", "can_restore" } ]`, most recently deleted first: your own pages and your teams'.
`deleted_by` is a name; `can_restore` is false for a team viewer.

### `POST /docs/:id/restore` (auth, `items:write`)

Brings a page back from Trash, as it was → the full document. `404` for a page that isn't in
Trash (or isn't yours to see), `403` for a team viewer. A project page shows as "Note restored" in
the project's history. Today's agenda, or an event's meeting note, brought back replaces a copy
that Agenda or the event wrote meanwhile, if nobody wrote in that copy.

### `DELETE /docs/:id/forever` (auth, `items:write`)

Deletes a page that is already in Trash, for good → `204`. `404` for a page not in Trash. A project
page purged from Trash (here or by the 30-day sweep) adds nothing more to the project's history.

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

| Field                    | Meaning                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `estimate_minutes`       | How long the task takes (1 to 10080); the planner uses it.                                                                                                                                 |
| `project_id`, `stage_id` | File a task in a visible project and one of its stages. Omit to keep the saved place; `project_id: null` removes it. Moving the task to another space removes its old project.             |
| `spent_minutes`          | Read-only: minutes logged with the focus timer (`POST /items/:id/time`).                                                                                                                   |
| `list_id`                | A list from `GET /lists`: your own for personal items, the team's for team ones.                                                                                                           |
| `tag_ids`                | Up to 20 tags, with the same rule as lists.                                                                                                                                                |
| `assignee_id`            | Who on the team is doing a team task. Responses also carry `assignee_name`.                                                                                                                |
| `location`               | Where an event happens; drives travel time.                                                                                                                                                |
| `meeting_url`            | A video-call link (`https://…`); the apps show Join from 5 minutes before.                                                                                                                 |
| `rrule`                  | How it repeats: `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`, `INTERVAL`, `BYDAY` (weekly, monthly), `BYMONTHDAY` (monthly, yearly; `-1` is the last day), `BYSETPOS` (monthly), `COUNT` or `UNTIL`. |
| `timezone`               | The IANA zone a repeating or all-day item keeps its wall-clock time in.                                                                                                                    |
| `all_day`                | A whole-day item: `due_at` is midnight in its `timezone` (your planner zone when not given) and `end_at` the midnight after its last day (one day for an event when omitted). Never busy.  |
| `busy`                   | Whether an event counts as busy (default true). Free events don't block the planner, booking pages or teammates, and get no buffers or travel.                                             |
| `color`                  | `#rrggbb` for the calendar, or null.                                                                                                                                                       |
| `alerts`                 | Minutes before `due_at` to remind: up to 5, each 0 to 40320 (four weeks), sorted and without repeats.                                                                                      |
| `attendees`              | Events only: up to 50 `{ "email", "name"? }` to invite by email (see [Invitations](#invitations)). Sending the list replaces it.                                                           |
| `parent_id`              | Tasks only: the task this one is a subtask of (see [Subtasks](#subtasks)); null for a top-level task.                                                                                      |
| `links`                  | Up to 20 `{ "url", "title"? }` web links (`http://` or `https://`). Sending the list replaces it; the item detail returns them with `id` and `position`.                                   |

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
for an all-day task, the end time for a task that has one), or is the task's project deadline when
that comes first. Every item carries `project_deadline` (its project's deadline, or null): the
apps sort by the same latest date (`latestDates` in `@orbyn/core`, which also counts tasks waiting
on it). Changing a project's deadline touches its open tasks' `updated_at` (not their version) so
synced copies pick it up. `size_fit` is 1 when the remaining
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

| `GET /admin/users/:id` | One account in full: sessions, sign-in methods, personal API keys (`keys`: name, prefix, created, last used; never the key), teams, counts, 30 days of activity and its audit history, its keys' included (never item contents) |
| `PUT /admin/users/:id/profile` | `{ "name"?, "email"? }`; a new email must be unused (`409`), and is unverified again when mail is set up |
| `POST /admin/users/:id/sign-out` | Ends every session → `{ ended }`; not for your own account (`409`) |
| `DELETE /admin/users/:id/sessions/:sid` | Ends one session → `204` |
| `DELETE /admin/users/:id/api-keys/:keyId` | Revokes one of their personal API keys → `204`; whatever used it stops at once; `404` for another person's key |
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
| `POST /items/:id/agent`           | Hands a task to your own agent (W3): queued for the worker; 409 at 5 at once, kept-out or paused         |
| `DELETE /items/:id/agent`         | Takes it back from your agent and stops its run; returns the item                                        |
| `GET /me/agent-work`              | Connected agents that made or changed tasks you see in the last day, for the board's lanes               |

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

Outside AI agents (Claude Code, Codex, Cursor and others) connect to the **mcp service** at `MCP_PUBLIC_URL` (`https://mcp.orbyn.dev/mcp`). Older setups that use `<APP_URL>/api/mcp` reach the same server. The full reference is generated from the tools themselves: [mcp.md](mcp.md) (and [mcp-catalog.json](mcp-catalog.json)). In short:

- Sign in with an **agent key** (`Authorization: Bearer oak_…`) made in Settings → Connected agents ([below](#connected-agents)). Old personal API keys (`ok_`) still work here for 90 days as a legacy connection, with `Deprecation` and `Sunset` headers, and keep the first endpoint's `search_items`, `add_task` and `get_agenda`. After that they work only with the REST API and CalDAV. App session tokens are refused (`401`). Signing in from claude.ai and ChatGPT (OAuth) comes in phase A2.
- Agent credentials (`oak_`, `oat_`, `ort_`) are refused (`401`) by every REST route and by CalDAV: they work only at the MCP address.
- The protocol is `2026-07-28`, served statelessly, plus `initialize` and `ping` for the 2025-11-25, 2025-06-18 and 2025-03-26 revisions. There are no sessions. `GET`/`DELETE` get `405`, batches get `400`, and a page not on the Origin list gets `403`. A missing or wrong credential gets `401` with `WWW-Authenticate: Bearer resource_metadata=…`.
- 51 tools: 21 core ones every connection has (reads, changes, planning sessions and `propose_changes`), and 30 in toolsets (workspace, planner, study, follow-through, teams, bookings, files) chosen when an app signs in or in Settings. `X-MCP-Toolsets` and `X-MCP-Readonly` narrow a call. Resources (the Today list, the guides at `orbyn://spec/markdown`, `orbyn://spec/views` and `orbyn://guide/planning`, pages, tasks, projects, views, days, templates, records), completions from titles the connection can see, and eleven prompts. Every result carries typed ids, `orbyn://` URIs and links to `/app/task/<id>`, `/app/doc/<id>#<line>`, `/app/project/<id>` and `/app/today`. Text written by someone else arrives fenced as untrusted content.
- The public developer page is `<APP_URL>/developers/mcp`, read from `GET /developers/mcp` (no sign-in: the catalog, this server's address and live limits, the versioning policy and the changelog). `GET /.well-known/security.txt` says where to report a security problem (`SECURITY_CONTACT`).
- Limits are per connection, never per address. A `429` carries `Retry-After` and a JSON-RPC body.
- `GET /.well-known/oauth-protected-resource[/mcp]` is the protected-resource metadata (RFC 9728). Other `/.well-known/*` paths are `404`.

## Connected agents

| Method and path               | Body / result                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/agents`              | `{ mcp_url, legacy_keys_until, grants }`: your connections (agent keys, old keys used over MCP), each with `access`, `personal`, `teams`, `toolsets`, `hide_outside_content`, `prefix`, `expires_at`, `last_used_at`, `suspended_at`                                                                                                                                                                                                                                                     |
| `POST /me/agent-keys`         | `{ "name", "access"?: "read"\|"suggest"\|"write", "personal"?, "team_ids"?, "toolsets"?, "expires_in_days"?, "hide_outside_content"? }` → `201` `{ grant, key }` (the key is shown once). 30 days by default, never past the admin's limit. `hide_outside_content` leaves out the text of subscribed calendar events, imported files, emailed tasks and booking answers (imported pages keep their titles).                                                                              |
| `DELETE /me/agents/:id`       | Revokes it: `204`. It stops working on its next call. For an old API key, this removes only its MCP access.                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /me/agents/:id/restore` | Restores a connection Orbyn paused (`suspended_at`) after it kept going over its limits or being refused: `204`. Audited.                                                                                                                                                                                                                                                                                                                                                                |
| `PUT /me/agents/:id/toolsets` | `{ "toolsets": [...] }` → the connection, with `core` always on. Bookings can be added to an agent key; a connection that signed in gets them only by signing in again (`422`). Every copy of the service hears of it at once; agents see it the next time they list their tools. Audited.                                                                                                                                                                                               |
| `PUT /me/agents/:id/trust`    | `{ "trust"?: "full"\|"ask"\|"suggest", "spaces"?: { "personal"\|<team id>: level or null }, "acts_alone"?: [ask-first items] }` → the connection. How much it does alone (full power by default; `ask` asks before every change; `suggest` sends everything to review), per space, and which ask-first items (`teammates`, `people`, `publishing`, `bookings`, `team_admin`, `profile`, `bulk`) it may do alone. Full and ask need a connection that may change things (`422`). Audited. |
| `GET /me/agents/:id/activity` | What it did, newest first. Each change is one line, and reads are counted per minute: `[{ at, tool, outcome, summary, calls, target_ids }]`                                                                                                                                                                                                                                                                                                                                              |
| `PUT /teams/:id/agent-access` | Owners and admins: `{ "agent_access": "role"\|"suggest"\|"read"\|"off" }`. This caps every agent in the team. `off` hides the team from agents.                                                                                                                                                                                                                                                                                                                                          |
| `POST /proposals/:id/respond` | `{ "decision": "approve"\|"decline" }` → `{ status }`, from a notification's Approve and Decline (signed in as you; keys refused). A proposal already decided answers how it ended.                                                                                                                                                                                                                                                                                                      |
| `GET` / `PUT /admin/agents`   | Admins: `agents_enabled`, `agents_writes_enabled`, `blocked_client_ids`, `allowed_client_hosts`, `dcr_enabled`, `max_grant_days` and `agent_limits`. They apply within 10 s, with no deploy. Changes are audited.                                                                                                                                                                                                                                                                        |

### Agents' inboxes (H0)

Everything that happens in Orbyn for you goes to your agents first: each connection has an inbox (read with the MCP tools `get_inbox` and `ack_inbox`, and the resource `orbyn://inbox`), only for the spaces it reaches, never from projects kept out of the assistant, kept 14 days. These routes are for you, signed in (keys refused).

| Method and path                      | Body / result                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /me/agents/:id/inbox`           | `{ muted, wake_url, wake_last_status, wake_last_error, wake_last_sent_at, unread }`                                                                                                                                                                                |
| `PUT /me/agents/:id/inbox`           | `{ "muted": [kinds] }` → the same. Kinds: `booking`, `mention`, `invite`, `deadline`, `import`, `study`, `email_task`, `review`, `ask`, `answer`. Audited.                                                                                                         |
| `PUT /me/agents/:id/wake`            | `{ "url" }` (https, public address) → `{ settings, secret }`; the signing secret is shown once. Orbyn POSTs `{ grant, count, inbox_url, kinds }` (never content) signed like webhooks (`X-Orbyn-Signature`, event `agent.wake`), at most every 5 minutes. Audited. |
| `DELETE /me/agents/:id/wake`         | No more wake-ups → the settings.                                                                                                                                                                                                                                   |
| `POST /me/agents/:id/wake/test`      | Calls the address now → `{ ok, status, error }`.                                                                                                                                                                                                                   |
| `GET` / `POST /me/agent-rules`       | Your standing rules for agents: `[{ id, kind, text }]`; `{ "kind"?: kind\|null, "text" }` → `201`. At most 50. Agents get them with each inbox item.                                                                                                               |
| `PUT` / `DELETE /me/agent-rules/:id` | Change (`{ kind, text }`) or remove (`204`) a rule.                                                                                                                                                                                                                |
| `GET /me/questions`                  | Questions your agents asked (`ask_person`) that wait: `[{ id, agent, question, detail, choices, yes_no, default_choice, expires_at }]`.                                                                                                                            |
| `POST /me/questions/:id/answer`      | `{ "answer", "via"?: "app"\|"push" }` → the question. One of its choices (yes/no also as approve/decline); the asking agent gets it as an `answer` item. One already answered says how it ended.                                                                   |

### Sign in with Orbyn (OAuth)

Apps can also connect by signing in with Orbyn (OAuth 2.1 with PKCE S256 for every app, no client secrets). An app is a public client (`none`), or, with a client ID metadata document that publishes its keys (`jwks` or `jwks_uri`), signs in with a key (`private_key_jwt`, RFC 7523). A document declaring `client_secret_basic` or `client_secret_post` is served as a public app; any other method is refused by name. The metadata is at `<APP_URL>/.well-known/oauth-authorization-server`; everything below is also in docs/openapi.yaml.

- `GET /oauth/authorize/check?…` — what the consent page shows: the app (verified for a client ID metadata document, unverified for a registered one), `requested_access`, `requested_bookings`, and with a session your spaces and any earlier connection. 30 a minute.
- `POST /oauth/authorize` `{ request, access, personal?, team_ids?, toolsets?, bookings?, notify_teammates?, hide_outside_content?, expires_in_days? }` → `{ redirect_to }` with a 60-second code. Needs a session; write access or bookings need `POST /me/reauth` in the last 10 minutes (`403 reauth_required`). Sign-ins allowed but never finished don't count towards the 50 connections and are cleared after a day; the limit is checked again when the code is exchanged, so consents given at once can't all finish past it (`invalid_grant`).
- `POST /oauth/authorize/deny` `{ request }` → `{ redirect_to }` with `error=access_denied`.
- `POST /oauth/token` (form): `grant_type=authorization_code` (code, redirect_uri, client_id, code_verifier, resource) or `refresh_token`. An app that signs in with a key adds `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and `client_assertion` to both: RS256, PS256 or ES256, `iss` = `sub` = its client_id, `aud` the token endpoint (or the issuer), at most an hour long, each `jti` once (`401 invalid_client` otherwise). Access tokens (`oat_`) last an hour and work only at the MCP address; refresh tokens (`ort_`) rotate. A spent refresh token presented again within 60 seconds (twice at most, for retries) gets another pair; after that it counts as copied: the family is revoked, the connection paused and its owner told.
- `POST /oauth/revoke` (form, RFC 7009): a refresh token takes its family; unknown tokens answer `200`.
- `POST /oauth/register` (RFC 7591), when `dcr_enabled`: public clients only, 10 an hour per address and 20 a day. Every redirect address must be on one website (or all back to this computer, or all to one app scheme); a list that mixes them is refused with `invalid_redirect_uri`.
- `POST /me/reauth` `{ password, code? }` or `{ handle, response }` (after `POST /me/reauth/options`) → `{ reauth_until }`. Open during maintenance.

`allowed_client_hosts` applies to every website an app could send a code to: a registered app must be allowed for each https address it declared. Narrowing the list stops refreshes and MCP calls from apps no longer allowed.

| Method and path                           | Body / result                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /teams/:id/agents`                   | Team settings → Outside agents: the cap for everyone; for owners and admins also which members' agents reach the team and when an agent first used it. |
| `GET /admin/agents/clients`               | Admins: apps that signed in, with kind, host, blocked and connections.                                                                                 |
| `GET /admin/agents/usage?days=30`         | Admins (`analytics:read`): `{ apps }`, connections, people, calls and writes per app.                                                                  |
| `DELETE /admin/users/:id/agents/:grantId` | Admins: end one of an account's agent connections: `204`.                                                                                              |

Only a person signed in to Orbyn can use these: personal API keys get `403`, and agent credentials get `401`. Making and revoking a key is in the audit log (`agent_key.created`, `agent_key.revoked`), with the request id. A connection that goes over its limits more than 5 times, or is refused more than 50 times, within ten minutes is paused until you restore it (`agent_grant.suspended`, `agent_grant.restored`).

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

`{ "prompt", "timezone", "team_id"?, "summary"?, "deadline"? }`. With `team_id` (you need write access to that team) the project and its tasks become the team's once approved. `summary` is saved on the project and as its brief page; `deadline` is the project's latest finish time. Drafts a project from the prompt: the AI provider returns a title and a set of tasks with estimates and due-date offsets, which come back as a **proposal** (`{ id, summary, actions, project }`) — the same shape as `/ai/chat`, nothing saved until `POST /ai/proposals/:id/apply`. `502` if the provider fails or returns an unreadable plan, `503` when no provider is set up.

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

Optional body `{ "give_tasks_deadlines": false }` creates a proposed project's tasks without their suggested due dates; the reviewed sessions are still created. The default is `true`. Applies every action in one transaction. → `{ "applied": true, "project_id": "…" | null }`
(`project_id` is the project a drafted project made; the same on a repeat). Idempotent. Project
history names the person who applied it as the author of the project and its stages. Returns `409` if the
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

#### `POST /blocks` with a day (auth)

`{ "item_id", "day": "2026-10-02", "minutes"? }` instead of `start_at`/`end_at`: a task dropped on a
calendar day (ORG-06). The session goes in the first free working time that day in the person's zone
(from now on for today), `minutes` long (default: the task's estimate, or 30). `201` with the session;
`409` when the day is over or has no free working time for it. The task's deadline is never written;
a session after it is kept and flagged late like any other.

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

| Method and path               | Body / result                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /blocks?from=&to=`       | Your sessions in the range                                                                                                                                                                                                                                                                                                                                                         |
| `GET /items/:id/sessions`     | One task's sessions (yours), below. Reading them never makes a plan. `404` when you can't see the task                                                                                                                                                                                                                                                                             |
| `POST /blocks`                | `{ "item_id", "start_at", "end_at" }` (a task you can see; at most 24 hours)                                                                                                                                                                                                                                                                                                       |
| `PUT /blocks/:id`             | `{ "start_at", "end_at" }`. The session counts as placed by hand from then on (`source: "manual"`)                                                                                                                                                                                                                                                                                 |
| `DELETE /blocks/:id`          | `204`; `404` when the session isn't yours                                                                                                                                                                                                                                                                                                                                          |
| `POST /blocks/:id/reschedule` | `{ "before_deadline"? }` → moves it to your next free working time of the same length, one that ends by the earlier task or project deadline when there is one (it looks up to a month ahead for that). With `before_deadline: true` only such a time will do: `409` when there's none, or the deadline has passed. Otherwise `409` if nothing is free in 7 days                   |
| `POST /blocks/:id/duplicate`  | `{ "start_at"? }` → `201` a new block for the same task and length, at `start_at` or the next free working time after the original; `409` if the task is done or nothing is free in 7 days                                                                                                                                                                                         |
| `GET /blocks/check-ins`       | Sessions that ended in the last 3 days, not answered yet, whose task is open → `[SessionCheckIn]`                                                                                                                                                                                                                                                                                  |
| `POST /blocks/:id/check-in`   | `{ "outcome": "done" \| "more" \| "skipped", "more_minutes"? }` → `{ id, outcome, counted_minutes, remaining_minutes }`. Done and more count the session's time into the task once (less focus time already logged inside it); more also sets what is still needed; skip counts nothing. Answering again takes back what the first answer counted. `409` before the session starts |
| `POST /blocks/:id/start`      | `{ "from"?: "app" \| "reminder" }` → marks the session started (from 15 minutes before it until it ends; `409` otherwise). Focus mode started on its task while it runs does the same                                                                                                                                                                                              |

`GET /items/:id/sessions` → `{ item_id, due_at, due_all_day, deadline_at, project_deadline,
dependent_deadline, planning_deadline_at, sessions, planned_minutes, late_minutes, fit, time_zone }`: your sessions for the task, oldest first, past ones
too (for a repeating task, those for its current occurrence and later ones);
`planned_minutes` is the time still to come in sessions that end by the deadline (all of it
without one), and `late_minutes` the time still to come in sessions that end after it.
`project_deadline` is the deadline of the task's project. `dependent_deadline` is the earliest
deadline of an open task downstream of this prerequisite. `planning_deadline_at` is the earliest
of those dates and the task's own deadline while that date is still ahead; once an earlier
project or dependent date has passed, it is the task's own deadline again (`fitDeadline` in
`@orbyn/core`), so "Deadline passed" is only said once the moment the task is due by has passed.
It caps the time that counts as planned and never changes `due_at` or `deadline_at`. `time_zone`
is the account's planning zone (null when unset), the zone the apps name the deadline in.

**Does it fit?** `fit` is the task's one status against its planning deadline (`deadlineFit` in
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
within a week of the deadline. `free_minutes` (working hours less your events and your sessions, the
task's own included since those before the deadline already count as planned; up to two weeks
ahead) is looked up only when the task is short and due within two weeks; otherwise null. The
review's and the daily notice's at-risk check and a plan whose days reach the deadline measure the
same room. The
apps show the status on a task's Sessions card; task rows show it only within a week of the
deadline or when a session falls after it (`fitChipShown`).

## Today and planned time

Planned time (sessions) and the deadline stay separate. These two reads put them side by side:
one Today list, and the planned time behind "Planned 9:15" and the status chips on task rows. Both
only read. A malformed query string is `400`; an account that hasn't confirmed its email gets
`403`, as everywhere.

### `GET /today?timezone=` (auth)

The day's events, your sessions, your tasks due today and late ones, in one list (`todayList` in
`@orbyn/core`). The day is your account's (the planner zone, the same day the agenda and agents
use); `timezone` (send the device's) counts only while the account has no zone of its own yet.

```json
{
  "day": "2026-09-24",
  "timezone": "Australia/Melbourne",
  "now": "2026-09-24T02:00:00.000Z",
  "from": "2026-09-23T14:00:00.000Z",
  "to": "2026-09-24T14:00:00.000Z",
  "rows": [
    {
      "key": "task:…",
      "kind": "task",
      "at": "2026-09-24T01:00:00.000Z",
      "item_id": "…",
      "title": "Send invoice",
      "due": "today",
      "deadline_at": "2026-09-24T07:00:00.000Z",
      "due_all_day": false,
      "sessions": [{ "id": "…", "start_at": "…", "end_at": "…" }],
      "fit": { "status": "on_track", "label": "On track", "…": "…" },
      "chips": [
        { "kind": "planned", "starts": ["2026-09-24T01:00:00.000Z"] },
        {
          "kind": "due",
          "deadline_at": "2026-09-24T07:00:00.000Z",
          "all_day": false
        }
      ],
      "action": "focus",
      "past": false
    }
  ],
  "late_total": 1,
  "unfinished": [
    {
      "block_id": "…",
      "item_id": "…",
      "title": "Competitor review",
      "start_at": "…",
      "end_at": "…",
      "yesterday": true
    }
  ]
}
```

`rows` run in time order: all-day events first, then events (yours, your teams' and the calendars
you subscribe to and show; `calendar` names a subscribed one, whose `item_id` is null), your
sessions (`block_id`, `part`/`parts`, `deadline_at`, `after_deadline`) and your tasks due today
(yours, or assigned to you). A task due today sits at its first session today, or at its deadline
when it has none. A task that is both planned and due today is **one row with two chips**
(`planned` and `due`), never a session row as well. Late tasks (due on an earlier day) come last,
latest deadline first: at most 20, with `late_total` counting them all; a late task with a session
today joins that session's place instead. A task due today that isn't on track has a `fit` chip
("Nothing planned", "Short 1h", "At risk"). Finished tasks and their sessions, and cancelled
events, are left out.

Every row has the same fields (null or empty when they don't apply). `action` is `"focus"` when
time is planned now or later today, `"plan"` for a task due today or late with time still missing
(`fit.short_minutes > 0`), or null. `past` marks an event or session that's over. `unfinished`
holds sessions from earlier days whose task is still open with no time planned since (the review's
rule, latest first); the apps offer Plan again (`POST /planner/roll-forward` with its `block_id`).
`todayRowWords`, `todayChipText` and `unfinishedHeading` in `@orbyn/core` give the words both apps
use ("9:15–10:00 · Session 1 · due Tue 6 Oct", "Due today 5 pm", "Late · due Tue 22 Sep",
"Not finished yesterday").

### `GET /planned?item_ids=&from=&to=` (auth)

Your planned time, task by task, kept apart from the task itself (sessions change without the task
changing, and devices sync tasks by `updated_at`):

- `item_ids` (comma-separated, up to 200): those tasks, any you can see;
- without it: every open task that's yours to plan (your own, or assigned to you), plus any task
  with a session of yours in the window;
- `from` and `to` (together, at most 62 days): each task lists your sessions in that window.

→ `{ from, to, tasks: [{ item_id, sessions, next, planned_minutes, late_minutes, fit }] }`.
`sessions` are `{ id, start_at, end_at, after_deadline }` in the window, soonest first (none
without one). `next` is your next session still to come or under way. `planned_minutes`,
`late_minutes` and `fit` follow the rule above (the Sessions card's), with `fit` null for a
finished task or one that isn't yours to plan and has none of your sessions. The apps ask for the
device's day: a task row shows "Planned 9:15" for a session today (`plannedLabel`), its status only
within a week of the deadline or when a session falls after it (`rowFitChip`), and "Tasks to
place" hides tasks already on track and says "2 h still to plan" (`stillToPlan`).

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
added again after the deadline, so planning again doesn't pile up late sessions. This applies only
when the deadline falls within the days planned: when it's later, the days after the plan still
count, so what doesn't fit is `unplaced` ("Not enough free time in the days planned.") and never
`at_risk`. Nothing is refused and deadlines never move. Once a deadline has passed, time found is catch-up:
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
estimate was planned for a learned length. `planned_minutes` includes the ticked sessions the
plan moves (`moved_minutes`; one of yours it offers unticked isn't counted), and `fit` is the task's status once the plan is applied as
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

Other tools reach your Orbyn account through these. Nothing here sends your data anywhere until you connect it, and each one can be turned off at any time.

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
| `PUT /me/calendar-feed`                       | `{ "include_blocks" }`: add your sessions as "Session: {task}"                                            |
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
MCP `get_today`, `get_calendar` and `get_agenda` (marked as outside content), and the iOS widget and Watch "next event". Calendar sets can include or leave
out each subscription (`subscription_ids`; missing means all). They are never re-exported in your
own feed or CalDAV, which would duplicate them in the apps they came from.

API keys act as you for items, pages, projects, the calendar and CalDAV, and count against their
own rate limit. A key is refused (`403`) wherever it could take over or change the account, send
data somewhere new or spend the hosted assistant: creating keys (`POST /me/api-keys`), deleting
any key but itself (`DELETE /me/api-keys/:id`), `/me/webhooks*`, `/me/chat*`, `/me/sessions*`,
`/me/2fa*`, `/me/passkeys*`, `/me/agents*`, `/me/agent-keys`, `/me/export`, `PUT /me`, `DELETE /me`, `PUT /me/profile`,
`PUT /me/privacy`, `POST /me/timezone`, `POST /me/consent`, `POST /me/inbox/rotate`,
`DELETE /me/inbox`, `POST`/`PUT`/`DELETE /me/calendar-feed`, `/devices` (a phone added by a key
would keep getting reminders after the key is gone), every `/ai/*` route (the assistant, drafts,
study help and applying proposals), `/docs/:id/assist`, `/docs/:id/ask`, and the admin console.
Reading those settings is fine. An admin's key
carries none of an admin's powers: it can't manage teams its owner isn't on, and it doesn't get
past maintenance mode. Making and deleting a key is in the audit log (`api_key.created`,
`api_key.deleted`), and admins can see a person's keys and revoke one (`api_key.revoked`). Webhook
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
with backoff for up to 8 attempts. Webhooks must be `https://` and reach a public address (checked
when saved and again before every delivery, and the delivery then connects to the address that
was checked). Redirects aren't followed. A webhook saved on `http://` before this rule was turned
off (`active: false`) with a `last_error` saying to add it again with `https://`; a subscribed
calendar saved on `http://` moved to `https://` and was read again (migration `071_https_links`).

**The feed** has all-day items as dates, free events and tasks as `TRANSP:TRANSPARENT`, a
`VALARM` per alert, invitees (`ORGANIZER`, `ATTENDEE` with their answers), repeating items as
RRULEs in their own zone with `EXDATE`s, and occurrences changed on their own as extra events with
`RECURRENCE-ID`. The busy-only link has its own token (so it can be shared without the full one)
and lists nothing but "Busy" intervals: the same busy time teammates see, 30 days back to 180
ahead.

**Subscribing to other calendars.** Any iCalendar link (`https://` or `webcal://`, never plain
`http://`) that reaches a public address: timetables, public holidays, a work calendar. The notifier fetches it soon after
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

It shows the same events the app's calendar does, by the same rule: your personal events, and your teams' events for as long as you're on the team (an event you made in a team you've since left stays with that team). Members can edit and delete team events from their calendar app as they can in Orbyn, and viewers can read them but not change them (`403`). An edit changes only what the `.ics` carries (title, times, repeat rule, notes and place): the event stays in its team, with its creator, status, priority, list, tags, alerts, people invited, colour and meeting link.

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

## Later pages, navigation and capture (D5)

### Stars (NAV-07)

- `PUT /favourites` `{ kind, target_id, block_id?, starred }`: `kind` is `doc`, `project`, `view`,
  `task` or `heading` (a heading's star is its page's id plus the line's `block_id`, and only a
  heading's star has one). 404 for something you can't open; at most 500 stars.
- `GET /starred` → `StarredItem[]`: every star with its live title and where it is, newest first.
  Stars on things you can no longer open, and headings whose line is gone, are left out.

### Choices that follow the account (NAV-08, NAV-09, SHR-08)

- `GET /me/prefs` → `{ sidebar: { order, hidden }, shortcuts, views, updated_at }` (defaults
  until something is chosen).
- `PUT /me/prefs` `{ sidebar?, shortcuts?, views? }`: the sidebar's arrangement and shortcuts are
  replaced whole; view choices are merged by place (`null` clears one). A shortcut must name a
  command and keys can do only one thing (400). Refused for personal API keys. 30 a minute.
- `DELETE /me/prefs`: everything back as it came.
- `home` (W1), in both: `{ hubs: [{ id, title, cover_file_id, icon, auto, links: [{ kind:
project|deck|page|view, id, label, tag? }] }], order, hidden, quote: { on, doc_id } }`, replaced
  whole. At most 8 hubs of 6 links; a hub's cover must be a picture you can see (404).

What opens at start (NAV-12), the theme and text size stay on each device.

### Home (W1)

- `GET /me/home` → `{ today, timezone, goals, routines, brief, agenda_doc_id, reflection }`:
  active goals (those tied to a project kept out of AI left out) with `progress` (0–1, from the
  project's tasks or the plan's ticks, else null) and `next_checkin`; the next five unpaused
  routine runs; today's morning brief; the lines under Reflection on today's agenda.
- `POST /me/home/reflection` `{ text }` (1–500) → `201 { doc_id, reflection }`: adds the line
  under a Reflection heading on today's agenda page (written first if need be), as one save of
  yours. 30 a minute.

### Covers and icons (W6)

- `PUT /docs/:id/look` `{ cover_file_id?, icon? }` → `{ cover_file_id, icon }`; `PUT /projects/:id`
  takes the same two fields. `null` takes one off. A cover is a picture you can see (404
  otherwise); an icon is one emoji or `icon:<name>` (422 otherwise). The page's version stays.
  Whoever can see the page or project can see its cover.
- `GET /me/pictures` → your pictures on pages you can open, newest first (60), to choose from.

### Archiving and tidying the library (SRCH-03, ORG-03)

- `PUT /docs/:id/archive` and `PUT /folders/:id/archive` `{ archived }`. Archived pages (and pages
  in an archived folder) leave `GET /docs`, `/find`, `/search`, the link picker and "Mentioned
  without a link"; they still open, and their links still work. `GET /docs?archived=include|only`,
  `/find?include_archived=true` and `/search?include_archived=true` include them.
- `POST /docs/bulk` `{ ids (≤100), folder_id?, archived?, tag_id? }` → `{ done, skipped }`: each
  page is checked as if changed alone; one you can't change is skipped, not an error.

### The Connections map (CNV-02)

`GET /links/map?kind=doc|project&id=&depth=1|2` → `{ nodes, edges, truncated }`: what a page or
project is linked to, from the link index and a project's own tasks, at most 36 things. Only what
the reader can open is on it; people and dates are ends.

### A team's switches (OTH-04)

`GET /teams/:id/policies` → `{ publishing, assistant, booking, can_change }`; `PUT` (owners and
admins) with any of the three. With `assistant` off, the page assistant, assistant chips, Study's
suggestions and the chat's page tools refuse or leave out the team's pages, and semantic search
doesn't measure them. With `booking` off, the team's public booking pages answer 404 until it's
on again.

### Recordings (CAP-10)

Recordings are page files (`audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/wav`,
`audio/aac`) and play in the page. `POST /ai/recordings/:fileId/summary` `{ transcript? }` →
`{ transcript, summary, actions[] }`, only when asked: the recording is written out by the
assistant's provider (`AI_TRANSCRIBE_MODEL`, default `whisper-1`, on its `/audio/transcriptions`;
the ai service fetches the file from the file store at `FILES_URL` and needs `FILES_SECRET`), then
summarised. Nothing changes on the page until the person adds the summary.

### The Orbyn Clipper (CAP-02, CAP-03, CAP-04)

- `GET` / `POST /me/clip-keys`, `DELETE /me/clip-keys/:id` (signed in; refused for API keys): a
  Clipper key (`ocl_…`) is shown once.
- `GET /clips/destinations` and `POST /clips` accept a Clipper key (or a session). A Clipper key is
  refused everywhere else (401). `POST /clips` `{ type: article|paper|assignment|read_later|
highlights, url, title?, html?, selection?, highlights?, highlights_as?, folder_id?, project_id?,
team_id?, doc_id?, due_at?, time_zone?, dry_run? }`. The page's HTML is cleaned here: only its
  readable part is kept, with web links; `orbyn://` in clipped words is written harmlessly. An
  assignment's deadline is read only from a full date on the page. 60 a minute.

## First-party ChatGPT executor catalogs

These routes require a live, verified Orbyn app session. Personal API keys and
MCP/OAuth connector grants cannot use them. Provider access/refresh tokens are
never accepted or returned. Responses use `Cache-Control: no-store`.

| Method | Path                                              | Purpose                                                                                    |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/ai/connections/chatgpt/executors/challenges`    | Start exact-session public-key enrollment with `connection_id`, `host_id`, `public_key`.   |
| POST   | `/ai/connections/chatgpt/executors/complete`      | Complete the server proof with `challenge_id`, `signature`.                                |
| POST   | `/ai/connections/chatgpt/leases/challenges`       | Start a one-use lease proof for an enrolled `executor_id`.                                 |
| POST   | `/ai/connections/chatgpt/leases/complete`         | Claim the next lease generation with `challenge_id`, `signature`.                          |
| POST   | `/ai/connections/chatgpt/leases/heartbeat`        | Renew a live lease with signed `heartbeat: {executor_id, lease_epoch, sequence}`.          |
| POST   | `/ai/connections/chatgpt/catalog`                 | Publish `{catalog, signature}` for the current lease.                                      |
| GET    | `/models?connection_id=<uuid>&executor_id=<uuid>` | Read an explicitly selected owned account/device catalog and persisted default.            |
| PUT    | `/models/default`                                 | Update `{selection: {connection_id, executor_id}, preference: {binding, model, version}}`. |

Proofs expire after five minutes and are one-use. Lease claims are bound to the
current enrollment epoch, exact app session and expected lease generation.
Leases last two minutes; only a signed heartbeat with a higher sequence extends
an unexpired lease. Catalog signatures cover the shared canonical account,
executor, lease generation, publication sequence and ordered model metadata.
Key renewal, disconnect, session revocation, stale generations and replay fence
old publications. Catalog bodies are capped at 2 MiB and at 1,000 model entries.
Expired proof rows are removed by the central sweeper.

`GET /models` returns credential-free `binding`, `executor_id`, `models`,
`preference`, `published_at`, `expires_at`, `sequence`, optional `capabilities`
and `status`. Capability metadata comes from the signed device publication;
omission means no capability is established. Bounded scheduled work requires
`plan_inference_limits_v1` as well as a ready catalog and reviewed default. A
login or visible model does not establish hard output-limit support.

Catalog status:

- `unavailable`: no published snapshot exists.
- `offline`: the owning device has no current live session/lease.
- `stale`: a live device's snapshot belongs to another generation or is over five minutes old.
- `ready`: the current live device has a fresh matching snapshot.

Offline/stale responses can retain the last model metadata for display. They
cannot authorize a new default. A default is scoped to the verified connection
binding and updated by version comparison under the same lock as publication
and disconnect. A removed model remains the saved default until the person
chooses another model or explicitly clears it (`model: null`). It is never
silently replaced. Repeating an old version returns 409, including requests
with the same Idempotency-Key; cached write receipts cannot bypass live checks.
A new non-null default requires a ready catalog containing its slug.

Catalog metadata reported by a signed device is not proof of provider
entitlement. The credential-owning runtime must recheck model availability
before inference. These APIs do not start inference or use managed provider
credentials as an automatic fallback.

### Personal ChatGPT routing and completed usage

These endpoints require a verified first-party app session and return `no-store`.
Personal API keys, MCP grants and plugin credentials cannot read or change them.

| Method | Path                                       | Purpose                                                                                                                                           |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/ai/provider-choice`                      | Read the person's primary provider, selected device, explicit fallback and version.                                                               |
| PUT    | `/ai/provider-choice`                      | CAS update using `expected_version`; choose `default` with fallback false, or `chatgpt` with owned connection/executor IDs and explicit fallback. |
| POST   | `/ai/connections/chatgpt/inference/claim`  | Exact enrolled session claims one authorized runner assignment using `executor_id`.                                                               |
| POST   | `/ai/connections/chatgpt/inference/result` | Publish the device-signed completion/failure receipt for that captured assignment.                                                                |
| GET    | `/ai/connections/chatgpt/usage`            | Owner-only completed-request measurements from the last 30 days, with at most ten recent records. No query parameters.                            |

Only the internal assistant runner queues prompt input. Assignments capture the
current provider-choice revision, model, executor and lease generation; provider,
session, source or device changes fence later claim/read/publication. Signed
catalog capability `plan_inference_v1` is required before a device can act as an
inference provider. Old catalogs remain readable without this capability.

Fallback is explicit. A confirmed admission rejection may use the configured
default provider; a partial or unknown completion cannot automatically retry
through another provider. Changing the choice cannot recall content already sent.
MCP and plugin grants remain separate.

Usage returns `since`, `until`, `recording_enabled`, `completed_requests`,
`measured_requests`, decimal-string `input_tokens`, `output_tokens`, `total_tokens`
and `recent: [{request_id, model, completed_at, usage}]`. Each recent `usage` is
either measured integer token counts or null, never guessed. Decimal totals avoid
Number precision loss. Only accepted signed completions are counted once; failure
or replay does not add measurements. Opted-out users get no new records. This
history is content-free, deleted after 30 days by the central sweeper and on
account deletion, and is not account-wide ChatGPT quota, tier or remaining usage.

#### Scheduled Agenda permission

`GET /ai/agenda/private-permission` and `PUT /ai/agenda/private-permission` require
a first-party app session, return `Cache-Control: no-store`, and are limited to
10 requests/minute. Personal API keys, portable MCP and plugins cannot grant this
permission. GET accepts no query fields and returns
`{ id, enabled, active, version, model }`; no setting means disabled/version0.
`active` means the saved permission still matches the account/device/model
selection, not that a device is online or a scheduled run has completed.

PUT accepts only `{ enabled, expected_version, expected_provider_choice_version,
expected_preference_version? }`. Enabling requires the current provider and model
versions plus an available bounded-inference-capable ChatGPT catalog. A stale
permission/selection returns409; unavailable capability/catalog returns503.
Disabling requires the permission version but does not require the old device to
remain available. Re-enabling advances version and cannot revive older grants.

Morning-email preferences and recent activity do not grant private inference.
Permission alone does not immediately run a summary. The morning producer queues
one summary per owner/local day for an untouched generated personal Agenda page;
only the Background runtime executes it, within the morning window. The transport
uses a stable operation ID and preserves unrelated human Notes. Changed sources,
target paragraph or permission invalidate acceptance. An undisclosed offline call
can wait; an already claimed/unknown model call is not issued a second time.

`GET /ai/agenda/private-summary` is an owner-only app-session read with no query
fields or request body, `Cache-Control: no-store`, and 10 requests/minute. Keys,
MCP and plugins cannot read it. It returns `{ run: null }` or the most recent
currently visible run: `{ id, doc_id, local_day, state, expires_at, updated_at,
reason, provider }`. Dates are ISO timestamps except `local_day` (YYYY-MM-DD).
States are queued/running/waiting/done/failed; fixed reasons are device_required,
expired, completion_unknown, authority_changed, usage_limit or provider_failed (or null).
Provider metadata is the accepted result's source/model/fallback, not a promise
about pending execution. Captured facts, credentials and permission snapshots
are never included. A past run retains its date; it is not today's status.

Web/desktop/mobile permission and status controls are candidates pending final
runtime/recovery and visual/native acceptance. This API is independent of hosted
ChatGPT website OAuth eligibility and does not expose ChatGPT account-wide quota.

### Document PDF delivery

`GET /docs/:id/export?format=pdf` uses an authorized, primary-read snapshot and a
private offline renderer. LaTeX math and ten Mermaid diagram families are rendered
in the file. Optional `version` fencing remains supported. Before PDF delivery,
access, source revision and included picture permissions are checked again: deleted/inaccessible pages return404
and changed pages409, including when an older caller omitted `version`. Oversized
input returns413; unconfigured/unavailable/busy rendering returns503 without a
partial file. Client disconnects cancel owned work. Standalone HTML uses the same private renderer to embed inert diagram SVGs,
MathML and authorized raster images, with escaped source in details and a resource-
denying CSP installed before content. It requires the configured renderer and
shares its bounded concurrency; failures return503 without a partial file.
No executable scripts or private file links are added. Native download/share interaction and complete publication/Markdown
parity remain separate acceptance gates.

For page section embeds, `references` contains `[normalized_label, destination]` pairs from the authorized source page, including definitions outside the selected section. The complete page is projected through current link privacy before the section is selected. Inaccessible object destinations are omitted from the reference map; their displayed words are neutral. Clients must use this section context rather than definitions from the containing page. Older responses without `references` fall back to definitions inside the section.

## Agent channel installation candidate

These API paths are session-only and excluded from portable MCP/plugin grants.
They return metadata, never bot credentials. Requests reject extra input keys;
status/request reads are fresh and all responses use `Cache-Control: no-store`.

| Method/path                                            | Input/result                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /agent-channels/slack`                            | `configured` and this owner's nullable connection: workspace/account/scopes, connection revision, DM permission, disconnection flag, token expiry and `token_state` (`ready`, `refreshing`, `unknown`, `reconnect`) |
| `POST /agent-channels/slack/installations`             | Empty object; returns request UUID, fixed Slack authorization URL and expiry                                                                                                                                        |
| `GET /agent-channels/slack/installations/:id`          | Only the initiating owner/session can review request status and verified workspace/account/scopes                                                                                                                   |
| `POST /agent-channels/slack/installations/:id/confirm` | Exact reviewed `workspace_id`, `external_user_id`, `expected_bot_scopes`, `expected_version` and explicit `dm_enabled`; returns connection metadata                                                                 |
| `POST /agent-channels/slack/permission`                | `expected_version`, `dm_enabled`; returns the new revision. Enabling requires configured, available credentials; disabling remains available without app configuration                                              |
| `POST /agent-channels/slack/disconnect`                | `expected_version`; erases credentials and fences old delivery consent                                                                                                                                              |
| `GET /agent-channels/slack/callback`                   | Public single-use OAuth capture by state; cannot link an Orbyn account or enable messages. Returns static HTML with no-store/no-referrer/restrictive CSP                                                            |

OAuth attempts expire after ten minutes. Confirmation requires the original
live session. Callback retries cannot repeat a code exchange. Bot-token rotation
has a durable one-use claim; uncertainty clears local credentials and requires
explicit reconnect. This candidate's DMs link to in-app review; no signed reply
endpoint is mounted yet. Current source/qualification and remaining provider,
shared-workspace, native/visual gates are in
[agent channel evidence](reviews/evidence/agent-channels.md).

### Signed Slack question callbacks (candidate)

- `POST /agent-channels/slack/interactions`: bounded raw form payload, Slack v0 HMAC,
  five-minute timestamp window and configured app identity; minted option buttons only.
- `POST /agent-channels/slack/events`: bounded signed JSON; URL challenge or human
  DM-thread answer for the exact committed question card. Unrelated signed events
  are acknowledged without storing their text.

These provider-authenticated public callbacks cannot be substituted with an Orbyn
session, API key or MCP grant. Responses are uncached and gateway retry is disabled.
The receipt and eventual current-question answer have separate durable stages;
consumption clears encrypted answer content and commits the receipt with the job
and chat history in one transaction. One sent card accepts at most one decision.
Permission changes, source loss, question edits, expiry and configuration rotation
refuse queued answers. No callback grants standing approval.

### Teams account and personal messaging connection (candidate)

| Method and path                                        | Behavior                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /agent-channels/teams`                            | Owned connection status; no private challenge or conversation contents                                               |
| `POST /agent-channels/teams/installations`             | Empty body; original-session OAuth attempt                                                                           |
| `GET /agent-channels/teams/installations/:id`          | Original-session encrypted identity review                                                                           |
| `POST /agent-channels/teams/installations/:id/confirm` | Exact `tenant_id`, `object_id`, `expected_version`; returns one-use personal-link challenge, DMs off                 |
| `POST /agent-channels/teams/disconnect`                | Current `expected_version`; clears conversation, challenge and pending identity authority                            |
| `POST /agent-channels/teams/conversation-link`         | Current `expected_version`; replaces an expired/lost challenge and clears old conversation permission                |
| `PUT /agent-channels/teams/permission`                 | Current `expected_version`, `dm_enabled`; enabling requires both configurations and a proved personal route          |
| `POST /agent-channels/teams/activities`                | Public provider-authenticated raw JSON; links the exact reviewed personal actor or revokes its current removed route |
| `GET /agent-channels/teams/callback`                   | Public state-bound capture; never grants ownership or DM permission                                                  |

All owned routes require live app sessions, exclude API keys/MCP/plugin credentials,
reject extra input and use strict rate limits with uncached responses. Callback
code/state are omitted from gateway and request URL logs, with upstream retry
disabled. OAuth capture, explicit identity review and personal conversation proof
are separate boundaries. Bot transport credentials are independent of user identity
OAuth. The activity endpoint authenticates the Connector JWT before parsing bounded
JSON; unknown personal text is acknowledged without storage. Owned changes use
10/minute limits; the provider activity endpoint uses120/minute/IP. Delivery is
configured only when both configurations are valid and still requires the owner's
separate versioned permission. Background and morning intents recheck live source,
owner, grant, conversation proof and revision at dispatch. Accepted-but-uncertain
sends are terminal, with no automatic replay. Teams question replies are not yet
implemented; decisions open Orbyn.

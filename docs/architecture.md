# Architecture

Orbyn is three deployables plus PostgreSQL. The clients never talk to the database or to the AI
provider directly; everything goes through the backend API.

```
 desktop (web / Electron)  ──┐
                             ├──► api (Fastify) ──► PostgreSQL ◄── worker (reminders)
 mobile (Expo)             ──┘        │                               │
                                      ▼                               ├──► SMTP (email)
                         OpenAI-compatible provider                   └──► Expo Push (mobile)
```

## Backend (`backend/`)

| File             | Responsibility                                                                     |
| ---------------- | ---------------------------------------------------------------------------------- |
| `src/config.ts`  | Loads `.env` and validates configuration with zod.                                 |
| `src/db.ts`      | pg connection pool and a `transaction()` helper.                                   |
| `src/migrate.ts` | Applies `migrations/*.sql` in order under an advisory lock. Idempotent.            |
| `src/schemas.ts` | zod schemas for credentials, items, AI actions, device tokens.                     |
| `src/planner.ts` | `mutate()`: the single code path for create/update/delete with optimistic locking. |
| `src/app.ts`     | Fastify app: auth, items, devices, notifications, AI chat and proposal apply.      |
| `src/ai.ts`      | Calls any OpenAI-compatible `/chat/completions` endpoint and validates the reply.  |
| `src/worker.ts`  | Reminder scheduler and delivery loop.                                              |
| `src/server.ts`  | Process entry for the API.                                                         |

The API and worker are the same Docker image with different commands, so they scale
independently. Several worker replicas can run at once: scheduling is serialized with a Postgres
advisory lock, while delivery uses `FOR UPDATE SKIP LOCKED` so replicas never process the same
notification twice.

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

### Reminder pipeline

1. Every 10 seconds the worker runs `enqueue()`. For each open item whose `due_at` minus
   `reminder_minutes` has passed, it inserts one notification per channel: `inapp` always,
   `email` if the user has email reminders on and SMTP is configured, and `push` for every
   registered device. The unique key `(item_id, item_version, channel, destination)` makes this
   idempotent, so restarting or running many workers never double-sends.
2. `deliverOne()` claims a pending row with `SKIP LOCKED`, re-checks that the item is still open,
   still on the same `reminder_version`, and that the destination is still valid. If not, the row
   is cancelled. This is how completing a task or changing its date suppresses stale reminders.
3. Email goes out over SMTP with a stable `Message-ID`. Push goes to the Expo push service; the
   ticket id is stored and the row moves to `receipt` state, then the receipt is checked 15 minutes
   later. A `DeviceNotRegistered` receipt removes the device.
4. Failures back off exponentially (30s, 60s, ... capped at 1h) and give up after 8 attempts.

`reminder_version` only increments when the due date, reminder window, or done-to-todo status
changes. Editing a title or notes does not resend a reminder that was already delivered.

### AI assistant

The assistant is deliberately a **propose-then-approve** loop:

1. `POST /ai/chat` sends the user's message, timezone, and a snapshot of up to 100 most recently
   updated items to the configured provider with a system prompt that demands strict JSON matching
   the `agentReply` schema (a `summary` plus up to 20 `actions`).
2. The reply is validated with zod. Anything malformed is rejected with HTTP 502; nothing is
   written to the planner at this stage. The validated actions are stored as a `proposal`.
3. The client shows the summary and the proposed changes. When the user accepts,
   `POST /ai/proposals/:id/apply` runs every action through `mutate()` inside one transaction. A
   single failing action (wrong version, item belonging to someone else) rolls back the whole batch.
   Applying is idempotent.

Because the provider only needs the OpenAI chat completions shape, `AI_BASE_URL` can point at
OpenAI, Azure, OpenRouter, Groq, Together, a local Ollama or vLLM server, and so on. Planner
content is passed to the model as data, and the prompt instructs it to treat titles and notes as
untrusted.

## Desktop / web (`desktop/`)

A single-page React app built with Vite. Views: Overview, My tasks, Calendar, AI assistant,
Notifications, Settings. Session tokens live in `sessionStorage`. The app polls the API every 30
seconds while visible.

The same bundle runs three ways:

- **Dev**: Vite on port 5173 proxying `/api` to the backend.
- **Docker**: nginx serves the static build and proxies `/api/` to the `api` service with a
  per-client rate limit and security headers.
- **Electron**: `electron.cjs` loads `dist/index.html` from disk in a sandboxed window with no
  Node integration. Since the origin is `file://`, the app calls `http://localhost:8008` unless
  `VITE_API_URL` was baked in at build time.

## Mobile (`mobile/`)

An Expo app with tabs for Today, Tasks, Calendar, Assistant, and Settings. The session token is
stored with `expo-secure-store`. On login the app requests notification permission, obtains an
Expo push token, and registers it with `POST /devices`. On logout it deletes the device
registration so reminders stop. Push notifications include the item id so tapping one can open the
right task.

# API reference

Base URL: `http://localhost:8008` in Docker, `http://localhost:8000` when running locally. Through
the web container it is also reachable at `http://localhost:8080/api`.

All request and response bodies are JSON. Authenticated routes need
`Authorization: Bearer <token>`. Errors have the shape `{ "message": "..." }`.

| Status | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| 401    | Missing, expired, or revoked session                                |
| 404    | Not found, including records that belong to another user            |
| 409    | Version conflict, duplicate record, or expired proposal             |
| 422    | Validation error; `message` lists the failing rules                 |
| 429    | Rate limited (180 req/min per IP; 10 req/min on auth and AI routes) |
| 502    | AI provider returned an error or invalid plan                       |
| 503    | AI is not configured on the server                                  |

## Health

`GET /health` → `{ "status": "ok" }` after a successful database round trip.

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

→ `{ "id", "email", "name", "email_reminders" }`

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

Rules: `kind` is `task` or `event`; events require `due_at`; `end_at` requires `due_at` and must be
later; timestamps are ISO 8601 with an offset; `reminder_minutes` is 0 to 10080 (one week).

### `GET /items?limit=200&offset=0` (auth)

Newest first. `limit` max 500.

### `POST /items` (auth)

Body: item fields without `id`, `version`, timestamps. Only `title` is required. → `201` item.

### `PUT /items/:id` (auth)

Body: **all** item fields plus the current `version`. → `200` item with `version + 1`, or `409` if
the version is stale.

### `DELETE /items/:id?version=N` (auth)

→ `204`, or `409` if stale.

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
  ]
}
```

Nothing is saved by this call. Pure summaries return an empty `actions` array.

### `POST /ai/proposals/:id/apply` (auth)

Applies every action in one transaction. → `{ "applied": true }`. Idempotent. Returns `409` if the
proposal expired (15 minutes) or an item version is stale, and `404` if any action targets an item
the user does not own, in which case nothing is applied.

## Example session

```bash
API=http://localhost:8008
TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"a-long-password","name":"Me"}' | jq -r .token)

curl -s -X POST $API/items -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Pay rent","due_at":"2026-10-01T09:00:00+10:00","reminder_minutes":1440}'

curl -s $API/items -H "Authorization: Bearer $TOKEN"
```

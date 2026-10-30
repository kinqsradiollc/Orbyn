# Local demo accounts and data

The canonical development fixture is `backend/scripts/seed-ui-demo.mjs`, exposed
as `npm run dev:seed`. It uses the existing local stack and database migrations.
It creates fictional data for development without calling AI providers or sending mail.

## Quick setup

Complete the README local-development setup first, including `npm ci`,
`npm run build:packages` and migrations. The seed runs on the host and imports
the installed PostgreSQL/Argon2 dependencies and built shared packages, even if
the API runs in Docker. Start PostgreSQL using that setup, then verify that
the selected database belongs to your local development stack, then mark that
specific database once. For the default Compose configuration:

```sh
docker compose exec postgres psql -U orbyn -d orbyn -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE orbyn SET orbyn.ui_fixture = 'development-demo';"
npm run dev:seed
npm run dev:seed -- --apply
```

Use your actual database and user names if changed. The seed never sets this marker
itself. It requires a persisted database-level marker, a loopback connection, and
`orbyn` or a database name ending `_local`, `_dev`, or `_test`. Production process,
environment-file and database markers are refused. Preview is read-only by default.

The default environment file is `.env` at the repository root. For a separate
Compose environment, supply its path and the published loopback database endpoint:

```sh
npm run dev:seed -- --env-file path/to/local.env --db-host 127.0.0.1 --db-port 5433
npm run dev:seed -- --env-file path/to/local.env --db-host 127.0.0.1 --db-port 5433 --apply
```

Paths are relative to the repository root. Optional `--date=YYYY-MM-DD` fixes the
catalog's reference day; otherwise it uses the current Melbourne date.

## Accounts

| Email                | Role   | Scenario                                    |
| -------------------- | ------ | ------------------------------------------- |
| `admin@orbyn.local`  | Admin  | Rich workspace and admin navigation         |
| `member@orbyn.local` | Member | Personal and team work                      |
| `empty@orbyn.local`  | Member | Empty workspace, onboarding already skipped |
| `new@orbyn.local`    | Member | First-run onboarding                        |

Initial password for all four: **`Orbyn-Demo-2026!`**. These are public local-only
credentials. Normal product consent gates still apply. Fixture accounts have verified
email and opt out of analytics and reminder email. Existing passwords and roles
are never reset; conflicting account identities are refused rather than promoted.

To add the catalog to an established `demo@orbyn.local` member, pass
`--existing-member-id <verified-uuid>`. The script checks the email, UUID and member
role. It preserves that user's settings, original data, password and role.

## Scenarios and reruns

Rich accounts include projects, overdue/in-progress/blocked/completed tasks, long
and Unicode titles, events, manual focus sessions, private/team/project pages,
structured notes, memory, study cards, saved views, goals, habits, fictional chats,
Review proposals, paused routines and inactive booking pages.

Background and Overnight examples are terminal-only and visibly labeled
“Demo fixture — no model was run.” They do not represent verified outcomes,
heartbeats, active work or recovery checkpoints. Automation admission is paused
for newly created rich accounts; existing member settings remain unchanged.
For running, waiting, crash recovery and provider behavior, use the guarded runtime
qualification fixtures described in the verification guide and their owning tests.

The seed uses stable namespaced IDs, a transaction and an advisory lock. Reruns
insert missing fixture records and preserve edits to existing ones. They do not
clear data, reset passwords, change roles, grant provider access, enable booking
pages or start agent work. To inspect first-run again after completing it, use a
fresh disposable development database rather than resetting a shared account.

## Script qualification

```sh
node --test backend/scripts/seed-ui-demo-support.test.mjs
node backend/scripts/seed-ui-demo.integration.mjs --env-file path/to/local.env --db-host 127.0.0.1 --db-port 5433
```

The integration helper creates and migrates its own isolated test database, checks
refusal and idempotence behavior, and removes only that owned database after
verifying its ownership comment. It requires local database-creation privileges.

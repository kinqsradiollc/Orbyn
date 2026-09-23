# Debugging and Error Recovery Skill

## Overview

Guides systematic debugging and error recovery in the Orbyn codebase.

## Workflow

### Step 1: Identify the Problem
- Check `docker compose ps` to see if all services are healthy
- Check service logs: `docker compose logs <service-name>`
- Check health endpoints:
  - `curl http://localhost:8008/health`
  - `curl http://localhost:8080/health`

### Step 2: Categorize the Error
- **Build errors:** Check `npm run typecheck` output
- **Test failures:** Run `npm test` with verbose output
- **Runtime errors:** Check `docker compose logs`
- **Database errors:** Verify Postgres is running and migrations applied
- **AI errors:** Check that provider keys are configured via Admin → AI

### Step 3: Common Orbyn Issues

#### Database Connection Issues
- Verify `.env` has correct `POSTGRES_PASSWORD` and `DATABASE_URL`
- Check `docker compose ps` for Postgres health
- Verify PgBouncer is running: `docker compose logs pgbouncer`
- Check migration status: `docker compose logs migrate`

#### API Errors
- Verify `npm run build:packages` was run
- Check `backend/src/config/env.ts` for env var validation errors
- Verify CORS origins in `.env` match the client URL
- Check gateway routing in `gateway/`

#### AI Provider Errors
- Verify provider is added via Admin → AI in the web app
- Check that keys are encrypted in database
- Verify the provider adapter format matches the expected format
- Check `backend/src/modules/ai/` for adapter issues

#### Notification Errors
- Check `docker compose logs notifier`
- Verify SMTP settings in `.env`
- Check Expo push tokens in `backend/src/modules/devices/`
- Verify `backend/src/worker/` scheduler is running

#### Migration Issues
- Run `npm run migrate` with a clean database
- Check `backend/src/migrations/` for additive-only violations
- Verify advisory lock is not blocking

### Step 4: Fix and Verify
- Apply the fix
- Run `npm run typecheck`
- Run `npm test`
- Run `npm run build`
- Verify the fix resolves the issue

## Orbyn-Specific Notes

- All backend services run from the same image with different commands
- The gateway routes `/ai/*` to ai, `/status` to status, everything else to api
- Notifier instances use advisory locks and `SKIP LOCKED` for concurrency
- Read replicas are optional and use `reader()` in `db/pool.ts`
- Migrations run under an advisory lock and are additive only

## When to Use
- Debugging any Orbyn issue
- Recovering from deployment failures
- Fixing build or test errors
- Investigating runtime issues

## Verification
- [ ] Root cause identified
- [ ] Fix applied and verified
- [ ] All verification steps pass

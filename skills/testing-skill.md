# Testing Skill

## Overview

Applies testing standards to all new code in the Orbyn codebase. Load this before writing tests or conducting code reviews.

## Workflow

### [TEST-001] Security Shield Verification

Cover applicable ingress behavior for new or changed endpoints; choose relevant cases,
not every status in every individual test:

- Confirm `401 Unauthorized` responses when requests are unauthenticated
- Confirm `403 Forbidden` responses when requests lack required roles
- Confirm `429 Too Many Requests` when rate limits are exceeded (using mocks)
- Confirm `400 Bad Request` when structural input validation fails (Zod)

### [TEST-002] Isolation

- Never use a production database or send real external requests in deterministic tests.
- Unit tests isolate database and external dependencies with appropriate mocks.
- Integration/migration/runtime tests may use guarded disposable PostgreSQL fixtures:
  `TEST_DATABASE_URL`, a database name ending in `_test`, and the server-side test marker.
  Follow `docs/setup.md#4-tests`; never mark a real-data database as a test database.
- Mock external providers/email/storage for deterministic tests. Authorized live
  measurements are separate evidence, not a replacement for regression tests.

### [TEST-003] Response Schema Consistency

- Ensure API responses precisely match active specifications
- Use the existing Node test/assert conventions and explicit response assertions

### [TEST-004] Error Case Coverage

- Exercise failure branches
- Tests must cover `catch` blocks, invalid formats, entity-not-found exceptions, and rate limit occurrences

## Orbyn-Specific Notes

- Backend tests are in `backend/tests/` — integration tests using `tsx --test`
- Test database: `orbyn_test` (started via `docker compose --profile test up -d postgres-test`)
- Match fixtures to the contract: mocks for unit isolation, guarded test DB for real SQL behavior
- AI provider calls must be mocked — never hit real endpoints in tests
- Test the security shield (auth, roles, rate limits) for every new endpoint

## Running Tests

```bash
# Build packages first, then run backend tests
npm test

# With guarded disposable test Docker services
docker compose --profile test up -d postgres-test
TEST_DATABASE_URL=postgres://orbyn:orbyn-test@localhost:55434/orbyn_test npm test
```

## Required Checks

- [ ] Security shield verification for every new endpoint
- [ ] No production database or real external provider calls in deterministic tests
- [ ] Response schema matches active specs
- [ ] Error cases are covered

## When to Use

- Writing new integration tests
- Adding endpoints to the API
- Reviewing existing test coverage
- Any backend code changes

## NOT for

- Simple documentation-only changes
- Config-only modifications

## Verification

- [ ] All security shield checks pass
- [ ] No live connections in test code
- [ ] Response schema matches specs
- [ ] Error cases covered
